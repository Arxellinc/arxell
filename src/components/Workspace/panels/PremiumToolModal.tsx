import { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { usePremiumStore, type PremiumToolKey } from "../../../store/premiumStore";
import { useToolCatalogStore } from "../../../store/toolCatalogStore";
import { useOptionalAuth } from "../../../lib/auth";

interface PremiumToolMeta {
  key: PremiumToolKey | null;
  title: string;
  description: string;
  priceLabel: string;
  quotaLabel: string;
  comingSoon: boolean;
}

interface PremiumToolModalProps {
  open: boolean;
  tool: PremiumToolMeta | null;
  onClose: () => void;
}

export function PremiumToolModal({ open, tool, onClose }: PremiumToolModalProps) {
  const { isSignedIn, getToken } = useOptionalAuth();
  const {
    apiBaseUrl,
    entitlements,
    loading,
    lastError,
    setApiBaseUrl,
    refreshEntitlements,
    createCheckoutSession,
  } = usePremiumStore();
  const { installOptionalTool, setOptionalToolEnabled, optionalTools } = useToolCatalogStore();
  const [localBaseUrl, setLocalBaseUrl] = useState(apiBaseUrl);
  const [promoCode, setPromoCode] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocalBaseUrl(apiBaseUrl);
    setPromoCode("");
    if (isSignedIn) {
      void (async () => {
        const token = await getToken({ template: "premium_api" });
        await refreshEntitlements(token ?? undefined);
      })();
    }
  }, [apiBaseUrl, getToken, isSignedIn, open, refreshEntitlements]);

  const entitlement = useMemo(
    () => (tool?.key ? entitlements[tool.key] ?? null : null),
    [entitlements, tool]
  );
  const businessOptional = optionalTools.find((item) => item.id === "premium-business-analyst") ?? null;

  if (!open || !tool) return null;

  const saveConfig = () => {
    setApiBaseUrl(localBaseUrl.trim());
    setActionMessage("Premium API config saved.");
  };

  const openCheckout = async () => {
    if (tool.comingSoon || !tool.key) {
      setActionMessage("Coming soon. Purchases are not enabled yet for this tool.");
      return;
    }
    const token = await getToken({ template: "premium_api" });
    const url = await createCheckoutSession(tool.key, token ?? undefined, promoCode);
    if (!url) {
      setActionMessage("Could not start Stripe checkout.");
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch {
      window.open(url, "_blank");
    }
    setActionMessage("Checkout opened. Complete payment, then refresh entitlement.");
  };

  const activateTool = () => {
    if (tool.comingSoon || !tool.key) {
      setActionMessage("Coming soon. This premium tool cannot be unlocked yet.");
      return;
    }
    if (!entitlement?.active) {
      setActionMessage("Subscription is required before unlocking.");
      return;
    }
    if (businessOptional && !businessOptional.installed) {
      installOptionalTool(businessOptional.id);
    }
    if (businessOptional) {
      setOptionalToolEnabled(businessOptional.id, true);
    }
    setActionMessage("Tool unlocked and enabled.");
  };

  const remaining = entitlement ? Math.max(0, entitlement.quota_limit - entitlement.quota_used) : null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl mx-4 rounded-2xl border border-line-dark bg-bg-light shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line-med">
          <div>
            <h3 className="text-sm font-semibold text-text-norm">{tool.title}</h3>
            <p className="text-[11px] text-text-dark">{tool.priceLabel} · {tool.quotaLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-line-med text-text-dark hover:text-text-med"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-text-med">{tool.description}</p>
          {tool.comingSoon ? (
            <div className="rounded border border-accent-gold/20 bg-accent-gold/[0.08] p-3 text-xs text-accent-gold/80">
              Coming soon. Checkout and unlock are not available yet for this premium tool.
            </div>
          ) : null}
          <div className="rounded border border-line-med bg-line-light p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-text-dark">Premium Backend Config</div>
            <input
              type="text"
              value={localBaseUrl}
              onChange={(e) => setLocalBaseUrl(e.target.value)}
              placeholder="https://your-premium-api.example.com"
              className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-gold/60"
            />
            <button
              onClick={saveConfig}
              className="px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:bg-line-dark"
            >
              Save Config
            </button>
            <div className="text-[11px] text-text-dark">
              Auth token is provided automatically when cloud auth is configured.
            </div>
          </div>

          <div className="rounded border border-line-med bg-line-light p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-text-dark">Optional Promo Code</div>
            <input
              type="text"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              placeholder="ARX1DOLLAR"
              disabled={tool.comingSoon}
              className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-gold/60"
            />
            <div className="text-[11px] text-text-dark">
              Applied only at checkout when allowed by server policy.
            </div>
          </div>

          <div className="rounded border border-accent-gold/20 bg-accent-gold/[0.08] p-3">
            <div className="text-[11px] uppercase tracking-wider text-accent-gold/80 mb-1">Entitlement</div>
            {entitlement ? (
              <div className="text-xs text-accent-gold/85 space-y-1">
                <div>Status: {entitlement.active ? "Active" : "Inactive"}</div>
                <div>Usage: {entitlement.quota_used}/{entitlement.quota_limit} reports</div>
                <div>Remaining: {remaining}</div>
                <div>Period end: {entitlement.period_end_iso ? new Date(entitlement.period_end_iso).toLocaleString() : "-"}</div>
              </div>
            ) : (
              <div className="text-xs text-accent-gold/70">No entitlement loaded yet.</div>
            )}
          </div>

          {lastError ? <p className="text-[11px] text-accent-red">{lastError}</p> : null}
          {actionMessage ? <p className="text-[11px] text-accent-green">{actionMessage}</p> : null}
        </div>

        <div className="px-5 py-4 border-t border-line-med flex items-center gap-2 justify-end">
          <button
            onClick={() => {
              void (async () => {
                const token = await getToken({ template: "premium_api" });
                await refreshEntitlements(token ?? undefined);
              })();
            }}
            disabled={loading || tool.comingSoon || !isSignedIn}
            className="px-2.5 py-1.5 rounded text-[11px] bg-line-med text-text-med hover:bg-line-dark disabled:opacity-60"
          >
            <RefreshCw size={11} className="inline mr-1" />
            Refresh
          </button>
          <button
            onClick={() => void openCheckout()}
            disabled={loading || tool.comingSoon || !isSignedIn}
            className="px-2.5 py-1.5 rounded text-[11px] bg-accent-gold/25 text-accent-gold hover:bg-accent-gold/35 disabled:opacity-60"
          >
            <ExternalLink size={11} className="inline mr-1" />
            {tool.comingSoon ? "Coming soon" : "Buy with Stripe"}
          </button>
          <button
            onClick={activateTool}
            disabled={tool.comingSoon}
            className="px-2.5 py-1.5 rounded text-[11px] bg-accent-green/20 text-accent-green hover:bg-accent-green/30"
          >
            {tool.comingSoon ? "Coming soon" : "Unlock Tool"}
          </button>
        </div>
      </div>
    </div>
  );
}
