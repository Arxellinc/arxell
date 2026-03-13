import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { usePremiumStore } from "../store/premiumStore";
import { useOptionalAuth } from "../lib/auth";

interface CommercialLicenseModalProps {
  open: boolean;
  onClose: () => void;
}

export function CommercialLicenseModal({ open, onClose }: CommercialLicenseModalProps) {
  const { isSignedIn, getToken } = useOptionalAuth();
  const {
    apiBaseUrl,
    entitlements,
    loading,
    lastError,
    setApiBaseUrl,
    refreshCommercialLicense,
    createCommercialLicenseCheckout,
  } = usePremiumStore();
  const [localBaseUrl, setLocalBaseUrl] = useState(apiBaseUrl);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocalBaseUrl(apiBaseUrl);
    if (!isSignedIn) return;
    void (async () => {
      const token = await getToken({ template: "premium_api" });
      await refreshCommercialLicense(token ?? undefined);
    })();
  }, [apiBaseUrl, getToken, isSignedIn, open, refreshCommercialLicense]);

  const entitlement = useMemo(() => entitlements.commercial_license ?? null, [entitlements]);

  if (!open) return null;

  const saveConfig = () => {
    setApiBaseUrl(localBaseUrl.trim());
    setMessage("Premium API config saved.");
  };

  const refresh = () => {
    void (async () => {
      const token = await getToken({ template: "premium_api" });
      await refreshCommercialLicense(token ?? undefined);
    })();
  };

  const startCheckout = () => {
    void (async () => {
      const token = await getToken({ template: "premium_api" });
      const url = await createCommercialLicenseCheckout(token ?? undefined);
      if (!url) {
        setMessage("Could not start commercial license checkout.");
        return;
      }
      try {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(url);
      } catch {
        window.open(url, "_blank");
      }
      setMessage("Checkout opened. Complete payment, then refresh license status.");
    })();
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg mx-4 rounded-2xl border border-line-dark bg-bg-light shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line-med">
          <div>
            <h3 className="text-sm font-semibold text-text-norm">Commercial License</h3>
            <p className="text-[11px] text-text-med">$49/month · Required for business/commercial use</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-line-med text-text-med hover:text-text-norm">
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-text-med">
            Personal use is free. Business and commercial use requires an active commercial license subscription.
          </p>

          <div className="rounded border border-line-med bg-line-light p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-text-med">Premium Backend Config</div>
            <input
              type="text"
              value={localBaseUrl}
              onChange={(event) => setLocalBaseUrl(event.target.value)}
              placeholder="https://your-premium-api.example.com"
              className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-gold/60"
            />
            <button
              onClick={saveConfig}
              className="px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:bg-line-dark"
            >
              Save Config
            </button>
          </div>

          <div className="rounded border border-accent-gold/20 bg-accent-gold/[0.08] p-3">
            <div className="text-[11px] uppercase tracking-wider text-accent-gold/80 mb-1">License Status</div>
            {entitlement ? (
              <div className="text-xs text-accent-gold/85 space-y-1">
                <div>Status: {entitlement.active ? "Active" : "Inactive"}</div>
                <div>Plan: {entitlement.plan || "commercial_license_monthly"}</div>
                <div>Period end: {entitlement.period_end_iso ? new Date(entitlement.period_end_iso).toLocaleString() : "-"}</div>
              </div>
            ) : (
              <div className="text-xs text-accent-gold/70">No commercial license loaded yet.</div>
            )}
          </div>

          {lastError ? <p className="text-[11px] text-accent-red">{lastError}</p> : null}
          {message ? <p className="text-[11px] text-accent-green">{message}</p> : null}
        </div>

        <div className="px-5 py-4 border-t border-line-med flex items-center gap-2 justify-end">
          <button
            onClick={refresh}
            disabled={loading || !isSignedIn}
            className="px-2.5 py-1.5 rounded text-[11px] bg-line-med text-text-med hover:bg-line-dark disabled:opacity-60"
          >
            <RefreshCw size={11} className="inline mr-1" />
            Refresh
          </button>
          <button
            onClick={startCheckout}
            disabled={loading || !isSignedIn}
            className="px-2.5 py-1.5 rounded text-[11px] bg-accent-gold/25 text-accent-gold hover:bg-accent-gold/35 disabled:opacity-60"
          >
            <ExternalLink size={11} className="inline mr-1" />
            Buy License
          </button>
        </div>
      </div>
    </div>
  );
}
