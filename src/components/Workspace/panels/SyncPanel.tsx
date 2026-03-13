import { RefreshCcw, Unplug, Wifi } from "lucide-react";
import { useAuth } from "@clerk/react-router";
import { PanelWrapper } from "./shared";
import { useSyncStore } from "../../../store/syncStore";
import { connectSyncSignal, disconnectSyncSignal } from "../../../core/sync/signalClient";

export function SyncPanel() {
  const { isSignedIn, getToken } = useAuth();
  const {
    deviceId,
    mode,
    signalServerUrl,
    connectionState,
    lastError,
    peers,
    setMode,
    setSignalServerUrl,
  } = useSyncStore();

  const onConnect = () => {
    void (async () => {
      const token = (await getToken({ template: "premium_api" })) ?? (await getToken());
      if (!token) return;
      connectSyncSignal({
        signalServerUrl,
        token,
        deviceId,
        appVersion: "0.1.8",
      });
    })();
  };

  const onDisconnect = () => {
    disconnectSyncSignal();
  };

  return (
    <PanelWrapper
      title="Sync"
      icon={<Wifi size={16} className="text-accent-primary" />}
      actions={
        <div className="flex items-center gap-1">
          <button
            onClick={onConnect}
            disabled={!isSignedIn || mode === "off"}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark disabled:opacity-60"
          >
            <RefreshCcw size={12} />
            Connect
          </button>
          <button
            onClick={onDisconnect}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-accent-red/12 text-accent-red hover:bg-accent-red/20"
          >
            <Unplug size={12} />
            Disconnect
          </button>
        </div>
      }
    >
      <div className="p-3 space-y-3 text-xs text-text-med">
        <div className="rounded border border-line-med bg-line-light p-3 space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-text-dark">Mode</div>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as "off" | "p2p" | "cloud")}
            className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
          >
            <option value="off">Off</option>
            <option value="p2p">P2P (Free)</option>
            <option value="cloud">Cloud (Commercial)</option>
          </select>
          <input
            type="text"
            value={signalServerUrl}
            onChange={(event) => setSignalServerUrl(event.target.value)}
            placeholder="https://sync-signal.example.com"
            className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
          />
          <div className="text-[11px] text-text-dark">Device ID: {deviceId}</div>
          <div className="text-[11px] text-text-dark">Status: {connectionState}</div>
          {lastError ? <div className="text-[11px] text-accent-red">{lastError}</div> : null}
        </div>

        <div className="rounded border border-line-med bg-line-light p-3">
          <div className="text-[11px] uppercase tracking-wider text-text-dark mb-2">Peers</div>
          {peers.length === 0 ? (
            <div className="text-[11px] text-text-dark">No peers online.</div>
          ) : (
            <div className="space-y-1">
              {peers.map((peer) => (
                <div key={peer.device_id} className="text-[11px] text-text-med">
                  {peer.device_id} {peer.meta?.platform ? `(${peer.meta.platform})` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PanelWrapper>
  );
}
