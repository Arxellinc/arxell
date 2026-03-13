import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type SyncMode = "off" | "p2p" | "cloud";
export type SyncConnectionState = "idle" | "connecting" | "connected" | "error";

export interface SyncPeer {
  device_id: string;
  connected_at: string;
  last_seen: string;
  meta?: {
    platform?: string | null;
    app_version?: string | null;
  } | null;
}

interface SyncState {
  deviceId: string;
  mode: SyncMode;
  signalServerUrl: string;
  connectionState: SyncConnectionState;
  lastError: string | null;
  lastSyncAt: string | null;
  peers: SyncPeer[];
  setMode: (mode: SyncMode) => void;
  setSignalServerUrl: (value: string) => void;
  setConnectionState: (value: SyncConnectionState, error?: string | null) => void;
  setLastSyncAt: (value: string | null) => void;
  setPeers: (peers: SyncPeer[]) => void;
  upsertPeer: (peer: SyncPeer) => void;
  removePeer: (deviceId: string) => void;
  resetPeers: () => void;
}

function makeDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `device_${crypto.randomUUID()}`;
  }
  return `device_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

const DEFAULT_SYNC_SIGNAL_URL =
  normalizeServerUrl(import.meta.env.VITE_SYNC_SIGNAL_URL ?? "https://sync-signal-production.up.railway.app");

export const useSyncStore = create<SyncState>()(
  persist(
    (set) => ({
      deviceId: makeDeviceId(),
      mode: "off",
      signalServerUrl: DEFAULT_SYNC_SIGNAL_URL,
      connectionState: "idle",
      lastError: null,
      lastSyncAt: null,
      peers: [],

      setMode: (mode) => set({ mode }),
      setSignalServerUrl: (value) => set({ signalServerUrl: normalizeServerUrl(value) }),
      setConnectionState: (connectionState, error = null) => set({ connectionState, lastError: error }),
      setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
      setPeers: (peers) => set({ peers }),
      upsertPeer: (peer) =>
        set((state) => {
          const existing = state.peers.find((item) => item.device_id === peer.device_id);
          if (!existing) return { peers: [...state.peers, peer] };
          return {
            peers: state.peers.map((item) => (item.device_id === peer.device_id ? { ...item, ...peer } : item)),
          };
        }),
      removePeer: (deviceId) =>
        set((state) => ({ peers: state.peers.filter((item) => item.device_id !== deviceId) })),
      resetPeers: () => set({ peers: [] }),
    }),
    {
      name: "arx-sync-store",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        deviceId: state.deviceId,
        mode: state.mode,
        signalServerUrl: state.signalServerUrl,
        lastSyncAt: state.lastSyncAt,
      }),
    }
  )
);
