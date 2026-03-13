import {
  RotateCw,
  Home,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  Loader2,
  KeyRound,
  Search,
  Image,
  Newspaper,
  MapPinned,
  MapPin,
  Video,
  ShoppingCart,
  GraduationCap,
  X,
  Settings,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../../lib/utils";
import { type BrowserMode, type BrowserSafetySettings, proxyUrl } from "./shared";
import { useWebPanelStore } from "../../../store/webPanelStore";
import { useToolPanelStore } from "../../../store/toolPanelStore";
import {
  browserFetch,
  browserSearch,
  browserSearchKeyValidate,
  browserSearchKeyStatus,
  browserSearchSetKey,
  type BrowserSearchResult,
  settingsGet,
  settingsSet,
} from "../../../lib/tauri";

const SEARCH_HOME = "arx://search";
type SearchMode = "search" | "images" | "news" | "maps" | "places" | "videos" | "shopping" | "scholar";

const SEARCH_MODES: Array<{ id: SearchMode; label: string; icon: JSX.Element }> = [
  { id: "search", label: "Search", icon: <Search size={12} /> },
  { id: "images", label: "Images", icon: <Image size={12} /> },
  { id: "news", label: "News", icon: <Newspaper size={12} /> },
  { id: "maps", label: "Maps", icon: <MapPinned size={12} /> },
  { id: "places", label: "Places", icon: <MapPin size={12} /> },
  { id: "videos", label: "Videos", icon: <Video size={12} /> },
  { id: "shopping", label: "Shopping", icon: <ShoppingCart size={12} /> },
  { id: "scholar", label: "Scholar", icon: <GraduationCap size={12} /> },
];

function isSearchRoute(value: string) {
  return value.trim().toLowerCase().startsWith(SEARCH_HOME);
}

function parseSearchQuery(route: string): string {
  const lower = route.trim();
  const idx = lower.indexOf("?");
  if (idx < 0) return "";
  const query = new URLSearchParams(lower.slice(idx + 1)).get("q");
  return (query ?? "").trim();
}

function parseSearchMode(route: string): SearchMode {
  const lower = route.trim();
  const idx = lower.indexOf("?");
  if (idx < 0) return "search";
  const raw = new URLSearchParams(lower.slice(idx + 1)).get("m");
  const normalized = (raw ?? "search").trim().toLowerCase();
  return (SEARCH_MODES.find((m) => m.id === normalized)?.id ?? "search") as SearchMode;
}

function encodeSearchRoute(query: string, mode: SearchMode): string {
  const q = query.trim();
  if (!q) return SEARCH_HOME;
  return `${SEARCH_HOME}?q=${encodeURIComponent(q)}&m=${encodeURIComponent(mode)}`;
}

function searchCacheKey(query: string, mode: SearchMode): string {
  return `${mode}::${query.trim().toLowerCase()}`;
}

function looksLikeUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (/^https?:\/\//i.test(v)) return true;
  if (/\s/.test(v)) return false;
  return v.includes(".");
}

function getField(item: Record<string, unknown>, key: string): string {
  const v = item[key];
  return typeof v === "string" ? v : "";
}

function GoogleWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <svg
      className={cn("lnXdpd", compact ? "h-[31px] w-[92px]" : "h-[92px] w-[272px] mx-auto")}
      aria-label="Google"
      role="img"
      viewBox="0 0 272 92"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M115.75 47.18c0 12.77-9.99 22.18-22.25 22.18s-22.25-9.41-22.25-22.18C71.25 34.32 81.24 25 93.5 25s22.25 9.32 22.25 22.18zm-9.74 0c0-7.98-5.79-13.44-12.51-13.44S80.99 39.2 80.99 47.18c0 7.9 5.79 13.44 12.51 13.44s12.51-5.55 12.51-13.44z" fill="#EA4335"></path>
      <path d="M163.75 47.18c0 12.77-9.99 22.18-22.25 22.18s-22.25-9.41-22.25-22.18c0-12.85 9.99-22.18 22.25-22.18s22.25 9.32 22.25 22.18zm-9.74 0c0-7.98-5.79-13.44-12.51-13.44s-12.51 5.46-12.51 13.44c0 7.9 5.79 13.44 12.51 13.44s12.51-5.55 12.51-13.44z" fill="#FBBC05"></path>
      <path d="M209.75 26.34v39.82c0 16.38-9.66 23.07-21.08 23.07-10.75 0-17.22-7.19-19.66-13.07l8.48-3.53c1.51 3.61 5.21 7.87 11.17 7.87 7.31 0 11.84-4.51 11.84-13v-3.19h-.34c-2.18 2.69-6.38 5.04-11.68 5.04-11.09 0-21.25-9.66-21.25-22.09 0-12.52 10.16-22.26 21.25-22.26 5.29 0 9.49 2.35 11.68 4.96h.34v-3.61h9.25zm-8.56 20.92c0-7.81-5.21-13.52-11.84-13.52-6.72 0-12.35 5.71-12.35 13.52 0 7.73 5.63 13.36 12.35 13.36 6.63 0 11.84-5.63 11.84-13.36z" fill="#4285F4"></path>
      <path d="M225 3v65h-9.5V3h9.5z" fill="#34A853"></path>
      <path d="M262.02 54.48l7.56 5.04c-2.44 3.61-8.32 9.83-18.48 9.83-12.6 0-22.01-9.74-22.01-22.18 0-13.19 9.49-22.18 20.92-22.18 11.51 0 17.14 9.16 18.98 14.11l1.01 2.52-29.65 12.28c2.27 4.45 5.8 6.72 10.75 6.72 4.96 0 8.4-2.44 10.92-6.14zm-23.27-7.98l19.82-8.23c-1.09-2.77-4.37-4.7-8.23-4.7-4.95 0-11.84 4.37-11.59 12.93z" fill="#EA4335"></path>
      <path d="M35.29 41.41V32H67c.31 1.64.47 3.58.47 5.68 0 7.06-1.93 15.79-8.15 22.01-6.05 6.3-13.78 9.66-24.02 9.66C16.32 69.35.36 53.89.36 34.91.36 15.93 16.32.47 35.3.47c10.5 0 17.98 4.12 23.6 9.49l-6.64 6.64c-4.03-3.78-9.49-6.72-16.97-6.72-13.86 0-24.7 11.17-24.7 25.03 0 13.86 10.84 25.03 24.7 25.03 8.99 0 14.11-3.61 17.39-6.89 2.66-2.66 4.41-6.46 5.1-11.65l-22.49.01z" fill="#4285F4"></path>
    </svg>
  );
}

export function WebPanel() {
  const defaultSafety = useMemo<BrowserSafetySettings>(
    () => ({
      disableJavascript: true,
      allowHttpHttpsOnly: true,
      redirectRecheck: true,
      blockPrivateTargets: false,
      timeoutMs: 20_000,
      maxRedirects: 5,
      maxResponseBytes: 5_000_000,
      maxConcurrency: 6,
    }),
    []
  );
  const [url, setUrl] = useState(SEARCH_HOME);
  const [inputUrl, setInputUrl] = useState(SEARCH_HOME);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<BrowserMode>("browser");
  const [searchMode, setSearchMode] = useState<SearchMode>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<BrowserSearchResult | null>(null);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [keyMasked, setKeyMasked] = useState("");
  const [keyValidationState, setKeyValidationState] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [keyValidationLabel, setKeyValidationLabel] = useState("");
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [safety, setSafety] = useState<BrowserSafetySettings>(defaultSafety);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<BrowserMode>(mode);
  const historyRef = useRef<string[]>([SEARCH_HOME]);
  const historyIndexRef = useRef(0);
  const searchCacheRef = useRef<Map<string, BrowserSearchResult>>(new Map());
  const pendingUrl = useWebPanelStore((s) => s.pendingUrl);
  const setNavigateUrl = useWebPanelStore((s) => s.setNavigateUrl);
  const setSearchContext = useWebPanelStore((s) => s.setSearchContext);
  const setPageContext = useWebPanelStore((s) => s.setPageContext);
  const clearContext = useWebPanelStore((s) => s.clearContext);
  const setToolPanel = useToolPanelStore((s) => s.setPanel);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    void (async () => {
      const [
        disableJavascript,
        allowHttpHttpsOnly,
        redirectRecheck,
        blockPrivateTargets,
        timeoutMs,
        maxRedirects,
        maxResponseBytes,
        maxConcurrency,
      ] = await Promise.all([
        settingsGet("web_disable_javascript"),
        settingsGet("web_allow_http_https_only"),
        settingsGet("web_redirect_recheck"),
        settingsGet("web_block_private_targets"),
        settingsGet("web_timeout_ms"),
        settingsGet("web_max_redirects"),
        settingsGet("web_max_response_bytes"),
        settingsGet("web_max_concurrency"),
      ]);
      setSafety({
        disableJavascript: disableJavascript ? disableJavascript !== "false" : defaultSafety.disableJavascript,
        allowHttpHttpsOnly: allowHttpHttpsOnly ? allowHttpHttpsOnly !== "false" : defaultSafety.allowHttpHttpsOnly,
        redirectRecheck: redirectRecheck ? redirectRecheck !== "false" : defaultSafety.redirectRecheck,
        blockPrivateTargets: blockPrivateTargets ? blockPrivateTargets === "true" : defaultSafety.blockPrivateTargets,
        timeoutMs: Number(timeoutMs || defaultSafety.timeoutMs),
        maxRedirects: Number(maxRedirects || defaultSafety.maxRedirects),
        maxResponseBytes: Number(maxResponseBytes || defaultSafety.maxResponseBytes),
        maxConcurrency: Number(maxConcurrency || defaultSafety.maxConcurrency),
      });
    })();
  }, [defaultSafety]);

  useEffect(() => {
    void Promise.all([
      settingsSet("web_disable_javascript", String(safety.disableJavascript)),
      settingsSet("web_allow_http_https_only", String(safety.allowHttpHttpsOnly)),
      settingsSet("web_redirect_recheck", String(safety.redirectRecheck)),
      settingsSet("web_block_private_targets", String(safety.blockPrivateTargets)),
      settingsSet("web_timeout_ms", String(Math.max(3000, Math.min(120000, Math.round(safety.timeoutMs))))),
      settingsSet("web_max_redirects", String(Math.max(0, Math.min(20, Math.round(safety.maxRedirects))))),
      settingsSet(
        "web_max_response_bytes",
        String(Math.max(100000, Math.min(25000000, Math.round(safety.maxResponseBytes))))
      ),
      settingsSet("web_max_concurrency", String(Math.max(1, Math.min(64, Math.round(safety.maxConcurrency))))),
    ]).catch(() => undefined);
  }, [safety]);

  const refreshKeyStatus = useCallback(async () => {
    try {
      const status = await browserSearchKeyStatus();
      setKeyConfigured(Boolean(status.configured));
      setKeyMasked(status.masked ?? "");
    } catch {
      setKeyConfigured(false);
      setKeyMasked("");
    }
  }, []);

  useEffect(() => {
    void refreshKeyStatus();
  }, [refreshKeyStatus]);

  const runSearch = useCallback(async (query: string, nextMode: SearchMode) => {
    const q = query.trim();
    if (!q) {
      setSearchResult(null);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    setSearchResult(null);
    try {
      const result = await browserSearch(q, nextMode, 10, 1);
      setSearchResult(result);
      searchCacheRef.current.set(searchCacheKey(q, nextMode), result);
      const rows = (result.items.length > 0 ? result.items : result.organic).map((row) => {
        const item = row as Record<string, unknown>;
        return {
          title:
            getField(item, "title") ||
            getField(item, "source") ||
            getField(item, "query") ||
            "(untitled)",
          link: getField(item, "link") || getField(item, "website") || getField(item, "url"),
          snippet: getField(item, "snippet") || getField(item, "description"),
        };
      });
      setSearchContext({
        route: encodeSearchRoute(q, nextMode),
        query: q,
        mode: nextMode,
        results: rows,
      });
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, [setSearchContext]);

  const navigateTo = useCallback((target: string, newMode?: BrowserMode, options?: { pushHistory?: boolean }) => {
    const pushHistory = options?.pushHistory !== false;
    const trimmed = target.trim();
    if (isSearchRoute(trimmed)) {
      const q = parseSearchQuery(trimmed);
      const m = parseSearchMode(trimmed);
      const route = encodeSearchRoute(q, m);
      setSearchMode(m);
      setUrl(route);
      setInputUrl(route);
      setSearchQuery(q);
      setIsLoading(false);
      if (pushHistory) {
        const base = historyRef.current.slice(0, historyIndexRef.current + 1);
        if (base[base.length - 1] !== route) {
          base.push(route);
          historyRef.current = base;
          historyIndexRef.current = base.length - 1;
        }
      }
      if (q) {
        const cached = searchCacheRef.current.get(searchCacheKey(q, m));
        if (cached) {
          setSearchError(null);
          setSearchResult(cached);
          setSearching(false);
          const rows = (cached.items.length > 0 ? cached.items : cached.organic).map((row) => {
            const item = row as Record<string, unknown>;
            return {
              title:
                getField(item, "title") ||
                getField(item, "source") ||
                getField(item, "query") ||
                "(untitled)",
              link: getField(item, "link") || getField(item, "website") || getField(item, "url"),
              snippet: getField(item, "snippet") || getField(item, "description"),
            };
          });
          setSearchContext({
            route,
            query: q,
            mode: m,
            results: rows,
          });
        } else {
          void runSearch(q, m);
        }
      }
      return;
    }

    const finalUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : "https://" + trimmed;
    const activeMode = newMode ?? modeRef.current;
    setUrl(finalUrl);
    setInputUrl(finalUrl);
    setIsLoading(true);
    if (pushHistory) {
      const base = historyRef.current.slice(0, historyIndexRef.current + 1);
      if (base[base.length - 1] !== finalUrl) {
        base.push(finalUrl);
        historyRef.current = base;
        historyIndexRef.current = base.length - 1;
      }
    }
    if (iframeRef.current) iframeRef.current.src = proxyUrl(finalUrl, activeMode, safety);
  }, [runSearch, safety, setSearchContext]);

  useEffect(() => {
    if (isSearchRoute(url)) return;
    setIsLoading(true);
    if (iframeRef.current) iframeRef.current.src = proxyUrl(url, mode, safety);
  }, [mode, safety, url]);

  useEffect(() => {
    if (!url || isSearchRoute(url)) return;
    let cancelled = false;
    const target = url;
    // Fetch a markdown snapshot for agent/context visibility when browsing web pages.
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const markdown = await browserFetch(target, "markdown");
          if (!cancelled && target === url) {
            setPageContext({ url: target, markdown });
          }
        } catch {
          // Keep previous context on fetch errors; user still sees current page in iframe.
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [setPageContext, url]);

  useEffect(() => {
    if (isSearchRoute(url)) return;
    clearContext();
  }, [clearContext, url]);

  useEffect(() => {
    if (!pendingUrl) return;
    navigateTo(pendingUrl);
    setNavigateUrl(null);
  }, [pendingUrl, navigateTo, setNavigateUrl]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "webproxy:navigate" && typeof e.data.url === "string") {
        const newUrl = e.data.url;
        setUrl(newUrl);
        setInputUrl(newUrl);
        setIsLoading(true);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    if (!keyModalOpen) return;
    const key = apiKeyInput.trim();
    if (!key) {
      setKeyValidationState("idle");
      setKeyValidationLabel("");
      return;
    }
    setKeyValidationState("checking");
    setKeyValidationLabel("Checking key...");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await browserSearchKeyValidate(key);
          setKeyValidationState(result.ok ? "valid" : "invalid");
          setKeyValidationLabel(result.message || (result.ok ? "Valid key" : "Invalid key"));
        } catch (e) {
          setKeyValidationState("invalid");
          setKeyValidationLabel(e instanceof Error ? e.message : "Validation failed");
        }
      })();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [apiKeyInput, keyModalOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!settingsMenuRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [settingsOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = inputUrl.trim();
    if (!raw) return;
    if (isSearchRoute(raw)) {
      navigateTo(raw);
      return;
    }
    if (!looksLikeUrl(raw)) {
      navigateTo(encodeSearchRoute(raw, "search"));
      return;
    }
    navigateTo(raw);
  };

  const handleRefresh = () => {
    if (isSearchRoute(url)) {
      const q = parseSearchQuery(url);
      const m = parseSearchMode(url);
      if (q) void runSearch(q, m);
      return;
    }
    setIsLoading(true);
    if (iframeRef.current) {
      try {
        iframeRef.current.contentWindow?.location.reload();
      } catch {
        iframeRef.current.src = proxyUrl(url, mode, safety);
      }
    }
  };

  const handleHome = () => navigateTo(SEARCH_HOME);

  const handleOpenExternal = async () => {
    if (isSearchRoute(url)) return;
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  const handleBack = () => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const previous = historyRef.current[historyIndexRef.current];
    if (previous) navigateTo(previous, undefined, { pushHistory: false });
  };

  const handleForward = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const next = historyRef.current[historyIndexRef.current];
    if (next) navigateTo(next, undefined, { pushHistory: false });
  };

  const saveApiKey = async () => {
    await browserSearchSetKey(apiKeyInput.trim());
    setApiKeyInput("");
    await refreshKeyStatus();
    setKeyValidationState("idle");
    setKeyValidationLabel("");
    setKeyModalOpen(false);
  };

  const searchActive = useMemo(() => isSearchRoute(url), [url]);
  const resultsQuery = useMemo(() => (searchActive ? parseSearchQuery(url).trim() : ""), [searchActive, url]);
  const resultsView = resultsQuery.length > 0;
  const modeLabels: { id: BrowserMode; label: string; title: string }[] = [
    { id: "browser", label: "Browser", title: "Full page view" },
    { id: "reader", label: "Reader", title: "Clean article view — removes ads, nav, scripts" },
    { id: "markdown", label: "Markdown", title: "Plain text for AI agent access" },
  ];

  return (
    <div className="flex flex-col h-full bg-bg-dark">
      {!keyConfigured && !bannerDismissed ? (
        <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-amber-400/50 bg-black/80">
          <div className="text-[11px] text-amber-300">
            Serper key required for search mode. Get one at{" "}
            <a href="https://serper.dev" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-amber-200">
              serper.dev
            </a>
            .
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setKeyModalOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-400/60 text-amber-300 hover:bg-amber-400/10"
              title="Configure Serper API key"
            >
              <KeyRound size={12} />
              <span className="text-[11px]">Set Key</span>
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              className="h-6 w-6 inline-flex items-center justify-center rounded text-amber-300 hover:bg-amber-400/10"
              title="Dismiss"
              aria-label="Dismiss Serper key notice"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-1 px-2 py-2 border-b border-line-med bg-bg-norm flex-shrink-0">
        <button onClick={handleRefresh} className="p-1.5 rounded text-text-med hover:text-text-norm hover:bg-line-med transition-colors" title="Refresh">
          <RotateCw size={14} className={isLoading || searching ? "animate-spin" : ""} />
        </button>
        <button onClick={handleHome} className="p-1.5 rounded text-text-med hover:text-text-norm hover:bg-line-med transition-colors" title="Home">
          <Home size={14} />
        </button>
        <button
          onClick={handleBack}
          disabled={historyIndexRef.current <= 0}
          className="p-1.5 rounded text-text-med hover:text-text-norm hover:bg-line-med transition-colors disabled:opacity-50"
          title="Back"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={handleForward}
          disabled={historyIndexRef.current >= historyRef.current.length - 1}
          className="p-1.5 rounded text-text-med hover:text-text-norm hover:bg-line-med transition-colors disabled:opacity-50"
          title="Forward"
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={handleOpenExternal}
          className="p-1.5 rounded text-text-med hover:text-text-norm hover:bg-line-med transition-colors disabled:opacity-60"
          title="Open in external browser"
          disabled={searchActive}
        >
          <ExternalLink size={14} />
        </button>

        <form onSubmit={handleSubmit} className="flex-1 mx-1">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-line-light border border-line-med rounded-full">
            <Globe size={12} className="text-text-dark flex-shrink-0" />
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              className="flex-1 bg-transparent text-xs text-text-med outline-none"
              placeholder="Enter URL or search..."
            />
          </div>
        </form>

        {!searchActive ? (
          <div className="flex items-center gap-0.5 bg-line-light rounded p-0.5 flex-shrink-0">
            {modeLabels.map(({ id, label, title }) => (
              <button
                key={id}
                onClick={() => setMode(id)}
                title={title}
                className={cn(
                  "px-2 py-1 rounded text-[10px] transition-colors",
                  mode === id ? "bg-accent-primary/30 text-accent-primary" : "text-text-dark hover:text-text-med"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="relative ml-1" ref={settingsMenuRef}>
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            className="p-1.5 rounded text-text-med hover:text-text-norm hover:bg-line-med transition-colors"
            title="Browser settings"
            aria-label="Browser settings"
          >
            <Settings size={14} />
          </button>
          {settingsOpen ? (
            <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-56 rounded border border-line-med bg-bg-norm p-1.5 shadow-xl">
              <button
                onClick={() => {
                  setKeyModalOpen(true);
                  setSettingsOpen(false);
                }}
                className="w-full text-left px-2 py-1.5 rounded text-xs text-text-med hover:bg-line-light hover:text-text-norm"
              >
                Configure Serper API key
              </button>
              <button
                onClick={() => {
                  setToolPanel("llm");
                  setSettingsOpen(false);
                }}
                className="w-full text-left px-2 py-1.5 rounded text-xs text-text-med hover:bg-line-light hover:text-text-norm"
              >
                Open API panel
              </button>
              <div className="my-1 border-t border-line-med" />
              <div className="px-2 pb-1 text-[10px] uppercase tracking-wide text-text-dark">Security</div>
              <label className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-text-med">
                <span>Disable JavaScript</span>
                <input
                  type="checkbox"
                  checked={safety.disableJavascript}
                  onChange={(e) => setSafety((prev) => ({ ...prev, disableJavascript: e.target.checked }))}
                />
              </label>
              <label className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-text-med">
                <span>Only allow HTTP/HTTPS</span>
                <input
                  type="checkbox"
                  checked={safety.allowHttpHttpsOnly}
                  onChange={(e) => setSafety((prev) => ({ ...prev, allowHttpHttpsOnly: e.target.checked }))}
                />
              </label>
              <label className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-text-med">
                <span>Redirect re-check</span>
                <input
                  type="checkbox"
                  checked={safety.redirectRecheck}
                  onChange={(e) => setSafety((prev) => ({ ...prev, redirectRecheck: e.target.checked }))}
                />
              </label>
              <label className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-text-med">
                <span>Block private/local targets</span>
                <input
                  type="checkbox"
                  checked={safety.blockPrivateTargets}
                  onChange={(e) => setSafety((prev) => ({ ...prev, blockPrivateTargets: e.target.checked }))}
                />
              </label>
              <div className="my-1 border-t border-line-med" />
              <div className="px-2 pb-1 text-[10px] uppercase tracking-wide text-text-dark">Limits</div>
              <label className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-text-med">
                <span>Timeout (ms)</span>
                <input
                  type="number"
                  min={3000}
                  max={120000}
                  value={safety.timeoutMs}
                  onChange={(e) =>
                    setSafety((prev) => ({ ...prev, timeoutMs: Number(e.target.value || prev.timeoutMs) }))
                  }
                  className="w-20 rounded border border-line-med bg-line-light px-1 py-0.5 text-right text-xs text-text-norm"
                />
              </label>
              <label className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-text-med">
                <span>Max redirects</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={safety.maxRedirects}
                  onChange={(e) =>
                    setSafety((prev) => ({ ...prev, maxRedirects: Number(e.target.value || prev.maxRedirects) }))
                  }
                  className="w-20 rounded border border-line-med bg-line-light px-1 py-0.5 text-right text-xs text-text-norm"
                />
              </label>
              <label className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-text-med">
                <span>Max response (bytes)</span>
                <input
                  type="number"
                  min={100000}
                  max={25000000}
                  step={100000}
                  value={safety.maxResponseBytes}
                  onChange={(e) =>
                    setSafety((prev) => ({
                      ...prev,
                      maxResponseBytes: Number(e.target.value || prev.maxResponseBytes),
                    }))
                  }
                  className="w-24 rounded border border-line-med bg-line-light px-1 py-0.5 text-right text-xs text-text-norm"
                />
              </label>
              <label className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-text-med">
                <span>Max concurrency</span>
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={safety.maxConcurrency}
                  onChange={(e) =>
                    setSafety((prev) => ({ ...prev, maxConcurrency: Number(e.target.value || prev.maxConcurrency) }))
                  }
                  className="w-20 rounded border border-line-med bg-line-light px-1 py-0.5 text-right text-xs text-text-norm"
                />
              </label>
              <div className="my-1 border-t border-line-med" />
              <div className="px-2 pb-1 text-[10px] uppercase tracking-wide text-text-dark">Mock browser mode</div>
              <div className="grid grid-cols-3 gap-1 px-1 pb-1">
                {modeLabels.map(({ id, label }) => (
                  <button
                    key={`settings_mode_${id}`}
                    onClick={() => setMode(id)}
                    className={cn(
                      "rounded px-1.5 py-1 text-[10px]",
                      mode === id
                        ? "bg-accent-primary/30 text-accent-primary"
                        : "bg-line-light text-text-dark hover:text-text-med"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {searchActive ? (
          <div className="h-full overflow-y-auto bg-white text-black">
            <div className="min-h-full py-10">
              <div className="mx-auto w-full max-w-3xl">
                {!resultsView ? (
                  <>
                    <div className="text-center mb-8 mt-[150px]">
                      <GoogleWordmark />
                      <p className="mt-2 text-xs text-gray-500">Search (powered by Serper)</p>
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const q = searchQuery.trim();
                        if (!q) return;
                        navigateTo(encodeSearchRoute(q, searchMode));
                      }}
                      className="mb-[20px]"
                    >
                      <div className="mx-auto w-[70%] min-w-[350px] flex items-center gap-2 rounded-full border border-gray-300 px-3 py-2 shadow-sm">
                        <Search size={16} className="text-gray-500" />
                        <input
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search the web"
                          className="w-full bg-transparent outline-none text-sm text-gray-800"
                        />
                        <button
                          type="submit"
                          className="shrink-0 inline-flex items-center gap-1 rounded-full bg-[#1a73e8] px-3 h-[36px] leading-none text-xs text-white hover:bg-[#1669d5]"
                        >
                          <Search size={12} />
                          <span>Search</span>
                        </button>
                      </div>
                    </form>

                    <div className="mb-4 flex flex-col items-center gap-2">
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {SEARCH_MODES.slice(0, 5).map((m) => (
                          <button
                            key={m.id}
                            onClick={() => {
                              setSearchMode(m.id);
                              if (searchQuery.trim()) {
                                navigateTo(encodeSearchRoute(searchQuery, m.id));
                              }
                            }}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-[6px] border border-transparent bg-gray-100 px-2.5 py-1 text-xs text-gray-700 hover:border-gray-300",
                              searchMode === m.id && "text-[#1a73e8]"
                            )}
                          >
                            {m.icon}
                            <span>{m.label}</span>
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {SEARCH_MODES.slice(5).map((m) => (
                          <button
                            key={m.id}
                            onClick={() => {
                              setSearchMode(m.id);
                              if (searchQuery.trim()) {
                                navigateTo(encodeSearchRoute(searchQuery, m.id));
                              }
                            }}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-[6px] border border-transparent bg-gray-100 px-2.5 py-1 text-xs text-gray-700 hover:border-gray-300",
                              searchMode === m.id && "text-[#1a73e8]"
                            )}
                          >
                            {m.icon}
                            <span>{m.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="mb-4">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const q = searchQuery.trim();
                          if (!q) return;
                          navigateTo(encodeSearchRoute(q, searchMode));
                        }}
                      >
                        <div className="flex items-center gap-3 w-full">
                          <GoogleWordmark compact />
                          <div className="flex-1 min-w-[350px] flex items-center gap-2 rounded-full border border-gray-300 px-3 py-2 shadow-sm">
                            <Search size={16} className="text-gray-500" />
                            <input
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder="Search the web"
                              className="w-full bg-transparent outline-none text-sm text-gray-800"
                            />
                            <button
                              type="submit"
                              className="shrink-0 inline-flex items-center gap-1 rounded-full bg-[#1a73e8] px-3 h-[36px] leading-none text-xs text-white hover:bg-[#1669d5]"
                            >
                              <Search size={12} />
                              <span>Search</span>
                            </button>
                          </div>
                        </div>
                      </form>
                    </div>

                    <div className="mb-4 overflow-x-auto">
                      <div className="flex items-center gap-2 min-w-max">
                        {SEARCH_MODES.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => {
                              setSearchMode(m.id);
                              if (searchQuery.trim()) {
                                navigateTo(encodeSearchRoute(searchQuery, m.id));
                              }
                            }}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-[6px] border border-transparent bg-gray-100 px-2.5 py-1 text-xs text-gray-700 hover:border-gray-300",
                              searchMode === m.id && "text-[#1a73e8]"
                            )}
                          >
                            {m.icon}
                            <span>{m.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {!keyConfigured ? (
                  <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    Add your Serper API key to run searches.
                  </div>
                ) : null}

                {searchError ? (
                  <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{searchError}</div>
                ) : null}

                {searching ? (
                  <div className="mt-8 flex items-center gap-2 text-sm text-gray-600">
                    <Loader2 size={16} className="animate-spin" />
                    Searching...
                  </div>
                ) : null}

                {searchResult ? (
                  <div className="mt-4">
                    <div className="border-t border-gray-200 mb-4"></div>
                    <div className="space-y-5">
                    {(searchResult.items.length > 0 ? searchResult.items : searchResult.organic).map((row, idx) => {
                      const item = row as Record<string, unknown>;
                      const title =
                        getField(item, "title") ||
                        getField(item, "source") ||
                        getField(item, "query") ||
                        "(untitled)";
                      const link = getField(item, "link") || getField(item, "website") || getField(item, "url");
                      const snippet = getField(item, "snippet") || getField(item, "description");
                      return (
                        <div key={`result_${idx}`} className="border-b border-gray-100 pb-4">
                          {link ? (
                            <button onClick={() => navigateTo(link)} className="text-left text-xs text-green-700 hover:underline">
                              {link}
                            </button>
                          ) : null}
                          <div>
                            <button
                              onClick={() => link && navigateTo(link)}
                              className="text-left text-lg text-[#1a0dab] hover:underline"
                              disabled={!link}
                            >
                              {title}
                            </button>
                          </div>
                          {snippet ? <p className="mt-1 text-sm text-gray-700">{snippet}</p> : null}
                        </div>
                      );
                    })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <>
            <iframe
              ref={iframeRef}
              src={proxyUrl(url, mode, safety)}
              className="w-full h-full border-0"
              onLoad={() => setIsLoading(false)}
              onError={() => setIsLoading(false)}
              title="Web Browser"
            />
            {isLoading && (
              <div className="absolute inset-0 bg-bg-dark/60 flex items-center justify-center pointer-events-none z-10">
                <Loader2 size={24} className="text-accent-primary animate-spin" />
              </div>
            )}
          </>
        )}
      </div>

      {keyModalOpen ? (
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded border border-line-med bg-bg-norm">
            <div className="flex items-center justify-between border-b border-line-light px-3 py-2">
              <div className="text-sm text-text-norm">Serper API Key</div>
              <button onClick={() => setKeyModalOpen(false)} className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-line-light text-text-med">
                <X size={13} />
              </button>
            </div>
            <div className="p-3 space-y-2">
              <div className="text-xs text-text-dark">Current: {keyConfigured ? keyMasked || "Configured" : "Not set"}</div>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Enter Serper API key"
                className="w-full rounded border border-line-med bg-line-light px-2 py-1.5 text-xs text-text-norm outline-none"
              />
              {keyValidationLabel ? (
                <div
                  className={cn(
                    "text-xs",
                    keyValidationState === "valid" ? "text-accent-green" : keyValidationState === "invalid" ? "text-accent-red" : "text-text-med"
                  )}
                >
                  {keyValidationLabel}
                </div>
              ) : null}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => void saveApiKey()}
                  disabled={keyValidationState !== "valid"}
                  className="px-2 py-1 rounded text-xs bg-accent-primary/30 text-accent-primary hover:bg-accent-primary/40 disabled:opacity-60"
                >
                  Save and Exit
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
