export interface ConnectorObservation {
  source: string;
  title: string;
  value: string;
  date: string | null;
  url: string;
}

export interface ConnectorResult {
  source: string;
  ok: boolean;
  fetched_at: string;
  notes: string;
  observations: ConnectorObservation[];
  error: string | null;
  cached?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

const CONNECTOR_CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const RETRY_DELAYS_MS = [350, 900];
const CONNECTOR_MIN_INTERVAL_MS: Record<string, number> = {
  fred: 1000,
  data_gov: 500,
};
const CONNECTOR_CACHE_KEY = "arx-business-connector-cache";
const connectorCache = new Map<string, { timestamp: number; value: unknown }>();
const sourceLastCallAt = new Map<string, number>();
let cacheHydrated = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureHydrated(): void {
  if (cacheHydrated) return;
  cacheHydrated = true;
  try {
    const raw = localStorage.getItem(CONNECTOR_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, { timestamp: number; value: unknown }>;
    for (const [key, entry] of Object.entries(parsed)) {
      if (entry && typeof entry.timestamp === "number") {
        connectorCache.set(key, { timestamp: entry.timestamp, value: entry.value });
      }
    }
  } catch {
    // Ignore malformed cache state and start fresh.
  }
}

function flushCache(): void {
  try {
    const serializable: Record<string, { timestamp: number; value: unknown }> = {};
    for (const [key, entry] of connectorCache.entries()) {
      serializable[key] = entry;
    }
    localStorage.setItem(CONNECTOR_CACHE_KEY, JSON.stringify(serializable));
  } catch {
    // Ignore quota/storage errors; connector behavior still works in-memory.
  }
}

async function scheduleByRateLimit(source: string): Promise<void> {
  const minInterval = CONNECTOR_MIN_INTERVAL_MS[source] ?? 0;
  if (minInterval <= 0) return;
  const last = sourceLastCallAt.get(source) ?? 0;
  const delta = Date.now() - last;
  if (delta < minInterval) {
    await sleep(minInterval - delta);
  }
  sourceLastCallAt.set(source, Date.now());
}

function getCached(key: string): unknown | null {
  ensureHydrated();
  const entry = connectorCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CONNECTOR_CACHE_TTL_MS) {
    connectorCache.delete(key);
    flushCache();
    return null;
  }
  return entry.value;
}

function setCached(key: string, value: unknown): void {
  ensureHydrated();
  connectorCache.set(key, { timestamp: Date.now(), value });
  flushCache();
}

async function safeJsonFetch(url: string, source: string): Promise<{ payload: unknown; cached: boolean }> {
  const cached = getCached(url);
  if (cached !== null) {
    return { payload: cached, cached: true };
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    await scheduleByRateLimit(source);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as unknown;
      setCached(url, payload);
      return { payload, cached: false };
    } catch (error) {
      clearTimeout(timeout);
      lastError = error instanceof Error ? error : new Error("unknown_error");
      if (attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  throw (lastError ?? new Error("request_failed"));
}

function readLatestValue(payload: unknown): { value: string; date: string | null } | null {
  if (!payload || typeof payload !== "object") return null;
  const observations = (payload as { observations?: Array<{ value?: string; date?: string }> }).observations;
  if (!Array.isArray(observations) || observations.length === 0) return null;
  const latest = [...observations].reverse().find((item) => item.value && item.value !== ".");
  if (!latest) return null;
  return {
    value: latest.value ?? "n/a",
    date: latest.date ?? null,
  };
}

export async function fetchFredMacroSnapshot(apiKey?: string): Promise<ConnectorResult> {
  if (!apiKey?.trim()) {
    return {
      source: "fred",
      ok: false,
      fetched_at: nowIso(),
      notes: "Missing FRED API key. Add key to pull macro indicators.",
      observations: [],
      error: "missing_api_key",
      cached: false,
    };
  }
  try {
    const series = [
      { id: "UNRATE", label: "US Unemployment Rate" },
      { id: "GDP", label: "US Gross Domestic Product" },
      { id: "CPIAUCSL", label: "US CPI (All Urban Consumers)" },
    ];
    let usedCache = false;
    const results = await Promise.all(
      series.map(async (item) => {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${item.id}&api_key=${encodeURIComponent(
          apiKey
        )}&file_type=json&sort_order=asc`;
        const result = await safeJsonFetch(url, "fred");
        if (result.cached) usedCache = true;
        const latest = readLatestValue(result.payload);
        return latest
          ? {
              source: "fred",
              title: item.label,
              value: latest.value,
              date: latest.date,
              url,
            }
          : null;
      })
    );
    const observations = results.filter((item): item is ConnectorObservation => Boolean(item));
    return {
      source: "fred",
      ok: observations.length > 0,
      fetched_at: nowIso(),
      notes: observations.length > 0
        ? `Macro indicators loaded from FRED${usedCache ? " (cache)" : ""}.`
        : "No usable observations returned.",
      observations,
      error: observations.length > 0 ? null : "no_observations",
      cached: usedCache,
    };
  } catch (error) {
    return {
      source: "fred",
      ok: false,
      fetched_at: nowIso(),
      notes: "Failed to fetch FRED data.",
      observations: [],
      error: error instanceof Error ? error.message : "unknown_error",
      cached: false,
    };
  }
}

export async function fetchDataGovBusinessSnapshot(query = "small business"): Promise<ConnectorResult> {
  const url = `https://catalog.data.gov/api/3/action/package_search?q=${encodeURIComponent(query)}&rows=5`;
  try {
    const result = await safeJsonFetch(url, "data_gov");
    const payload = result.payload;
    const rows = (
      payload as {
        result?: {
          results?: Array<{
            title?: string;
            metadata_created?: string;
            notes?: string;
          }>;
        };
      }
    ).result?.results;
    const observations: ConnectorObservation[] = Array.isArray(rows)
      ? rows.map((row, idx) => ({
          source: "data_gov",
          title: row.title ?? `Dataset ${idx + 1}`,
          value: (row.notes ?? "").slice(0, 140) || "dataset metadata available",
          date: row.metadata_created ?? null,
          url,
        }))
      : [];
    return {
      source: "data_gov",
      ok: observations.length > 0,
      fetched_at: nowIso(),
      notes: observations.length > 0
        ? `Public dataset metadata loaded from data.gov${result.cached ? " (cache)" : ""}.`
        : "No datasets returned.",
      observations,
      error: observations.length > 0 ? null : "no_observations",
      cached: result.cached,
    };
  } catch (error) {
    return {
      source: "data_gov",
      ok: false,
      fetched_at: nowIso(),
      notes: "Failed to fetch data.gov datasets.",
      observations: [],
      error: error instanceof Error ? error.message : "unknown_error",
      cached: false,
    };
  }
}
