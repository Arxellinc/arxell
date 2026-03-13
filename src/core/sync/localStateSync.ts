import { useBusinessAnalystStore } from "../../store/businessAnalystStore";
import { useEmailStore } from "../../store/emailStore";
import { useMcpStore } from "../../store/mcpStore";
import { usePremiumStore } from "../../store/premiumStore";
import { useTaskStore, type AgentTask } from "../../store/taskStore";

const SYNCED_LOCAL_STORAGE_KEYS = [
  "arx-email-store",
  "arx-premium-store",
  "arx-business-analyst-store",
  "arx-mcp-store",
] as const;

export interface LocalSyncSnapshot {
  version: 1;
  exported_at: string;
  stores: Partial<Record<(typeof SYNCED_LOCAL_STORAGE_KEYS)[number], string>>;
  tasks: AgentTask[];
}

function safeGetLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocalStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota/privacy mode errors
  }
}

function tryRehydratePersistStore(rehydrate: undefined | (() => void | Promise<void>)) {
  if (!rehydrate) return;
  try {
    const result = rehydrate();
    if (result && typeof (result as Promise<void>).then === "function") {
      void result;
    }
  } catch {
    // no-op
  }
}

export function collectLocalSyncSnapshot(): LocalSyncSnapshot {
  const stores: LocalSyncSnapshot["stores"] = {};
  for (const key of SYNCED_LOCAL_STORAGE_KEYS) {
    const value = safeGetLocalStorage(key);
    if (typeof value === "string") stores[key] = value;
  }

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    stores,
    tasks: useTaskStore.getState().tasks,
  };
}

export function applyLocalSyncSnapshot(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  const data = snapshot as Partial<LocalSyncSnapshot>;
  if (data.version !== 1 || !data.exported_at || !Array.isArray(data.tasks)) return false;

  const stores = data.stores && typeof data.stores === "object" ? data.stores : {};
  for (const key of SYNCED_LOCAL_STORAGE_KEYS) {
    const value = stores[key];
    if (typeof value === "string") {
      safeSetLocalStorage(key, value);
    }
  }

  useTaskStore.setState({ tasks: data.tasks as AgentTask[] });

  tryRehydratePersistStore(useEmailStore.persist?.rehydrate);
  tryRehydratePersistStore(usePremiumStore.persist?.rehydrate);
  tryRehydratePersistStore(useBusinessAnalystStore.persist?.rehydrate);
  tryRehydratePersistStore(useMcpStore.persist?.rehydrate);
  return true;
}

