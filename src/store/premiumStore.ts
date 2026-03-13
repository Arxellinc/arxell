import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type PremiumToolKey = "business_analyst" | "commercial_license";

export interface PremiumEntitlement {
  tool: PremiumToolKey;
  active: boolean;
  plan: string;
  price_label: string;
  quota_limit: number;
  quota_used: number;
  period_end_iso: string | null;
  updated_at: string;
}

interface PremiumState {
  apiBaseUrl: string;
  entitlements: Partial<Record<PremiumToolKey, PremiumEntitlement>>;
  loading: boolean;
  lastError: string | null;
  setApiBaseUrl: (value: string) => void;
  refreshEntitlements: (token?: string) => Promise<void>;
  createCheckoutSession: (tool: PremiumToolKey, token?: string, promoCode?: string) => Promise<string | null>;
  refreshCommercialLicense: (token?: string) => Promise<void>;
  createCommercialLicenseCheckout: (token?: string) => Promise<string | null>;
  preflightBusinessReport: (token?: string) => Promise<{ allowed: boolean; reason?: string }>;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

async function httpJson<T>(url: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (init.headers && typeof init.headers === "object" && !Array.isArray(init.headers)) {
    Object.assign(headers, init.headers as Record<string, string>);
  }
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  const resp = await fetch(url, { ...init, headers });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

export const usePremiumStore = create<PremiumState>()(
  persist(
    (set, get) => ({
      apiBaseUrl: "",
      entitlements: {},
      loading: false,
      lastError: null,

      setApiBaseUrl: (value) => set({ apiBaseUrl: value }),

      refreshEntitlements: async (token) => {
        const base = normalizeBaseUrl(get().apiBaseUrl);
        if (!base) {
          set({ lastError: "Set Premium API base URL first." });
          return;
        }
        if (!token?.trim()) {
          set({ lastError: "Sign in required to load premium entitlements." });
          return;
        }
        set({ loading: true, lastError: null });
        try {
          const data = await httpJson<{
            entitlements?: Array<{
              tool_key?: string;
              active?: boolean;
              quota_limit?: number;
              quota_used?: number;
              period_end_iso?: string | null;
              plan?: string;
              price_label?: string;
            }>;
            tools?: Partial<Record<PremiumToolKey, Omit<PremiumEntitlement, "tool" | "updated_at">>>;
          }>(`${base}/entitlements/me`, { method: "GET" }, token);

          const next: Partial<Record<PremiumToolKey, PremiumEntitlement>> = {};
          const now = new Date().toISOString();
          const tool =
            data.tools?.business_analyst ??
            data.entitlements?.find((item) => item.tool_key === "business_analyst");
          const commercial =
            data.entitlements?.find((item) => item.tool_key === "commercial_license");
          if (tool) {
            next.business_analyst = {
              tool: "business_analyst",
              active: Boolean(tool.active),
              plan: tool.plan ?? "business_analyst_monthly",
              price_label: tool.price_label ?? "$29/mo",
              quota_limit: Number(tool.quota_limit ?? 5),
              quota_used: Number(tool.quota_used ?? 0),
              period_end_iso: tool.period_end_iso ?? null,
              updated_at: now,
            };
          }
          if (commercial) {
            next.commercial_license = {
              tool: "commercial_license",
              active: Boolean(commercial.active),
              plan: commercial.plan ?? "commercial_license_monthly",
              price_label: commercial.price_label ?? "$49/mo",
              quota_limit: Number(commercial.quota_limit ?? 1),
              quota_used: Number(commercial.quota_used ?? 0),
              period_end_iso: commercial.period_end_iso ?? null,
              updated_at: now,
            };
          }
          set({ entitlements: next, loading: false });
        } catch (error) {
          set({ loading: false, lastError: error instanceof Error ? error.message : "Failed to load entitlements." });
        }
      },

      createCheckoutSession: async (tool, token, promoCode) => {
        const base = normalizeBaseUrl(get().apiBaseUrl);
        if (!base) {
          set({ lastError: "Set Premium API base URL first." });
          return null;
        }
        if (!token?.trim()) {
          set({ lastError: "Sign in required before checkout." });
          return null;
        }
        set({ loading: true, lastError: null });
        try {
          const data = await httpJson<{ checkout_url?: string }>(
            `${base}/billing/create-checkout-session`,
            {
              method: "POST",
              body: JSON.stringify({ tool, promo_code: promoCode?.trim() || undefined }),
            },
            token
          );
          set({ loading: false });
          return data.checkout_url ?? null;
        } catch (error) {
          set({ loading: false, lastError: error instanceof Error ? error.message : "Failed to create checkout." });
          return null;
        }
      },

      refreshCommercialLicense: async (token) => {
        const base = normalizeBaseUrl(get().apiBaseUrl);
        if (!base) {
          set({ lastError: "Set Premium API base URL first." });
          return;
        }
        if (!token?.trim()) {
          set({ lastError: "Sign in required to load commercial license status." });
          return;
        }
        set({ loading: true, lastError: null });
        try {
          const data = await httpJson<{
            entitlement?: {
              active?: boolean;
              quota_limit?: number;
              quota_used?: number;
              period_end_iso?: string | null;
              plan?: string;
              price_label?: string;
            };
          }>(`${base}/licensing/commercial/status`, { method: "GET" }, token);
          const existing = get().entitlements.commercial_license;
          set({
            entitlements: {
              ...get().entitlements,
              commercial_license: {
                tool: "commercial_license",
                active: Boolean(data.entitlement?.active ?? existing?.active ?? false),
                plan: data.entitlement?.plan ?? existing?.plan ?? "commercial_license_monthly",
                price_label: data.entitlement?.price_label ?? existing?.price_label ?? "$49/mo",
                quota_limit: Number(data.entitlement?.quota_limit ?? existing?.quota_limit ?? 1),
                quota_used: Number(data.entitlement?.quota_used ?? existing?.quota_used ?? 0),
                period_end_iso: data.entitlement?.period_end_iso ?? existing?.period_end_iso ?? null,
                updated_at: new Date().toISOString(),
              },
            },
            loading: false,
          });
        } catch (error) {
          set({ loading: false, lastError: error instanceof Error ? error.message : "Failed to load license status." });
        }
      },

      createCommercialLicenseCheckout: async (token) => {
        const base = normalizeBaseUrl(get().apiBaseUrl);
        if (!base) {
          set({ lastError: "Set Premium API base URL first." });
          return null;
        }
        if (!token?.trim()) {
          set({ lastError: "Sign in required before checkout." });
          return null;
        }
        set({ loading: true, lastError: null });
        try {
          const data = await httpJson<{ checkout_url?: string }>(
            `${base}/licensing/commercial/create-checkout-session`,
            { method: "POST" },
            token
          );
          set({ loading: false });
          return data.checkout_url ?? null;
        } catch (error) {
          set({ loading: false, lastError: error instanceof Error ? error.message : "Failed to create license checkout." });
          return null;
        }
      },

      preflightBusinessReport: async (token) => {
        const base = normalizeBaseUrl(get().apiBaseUrl);
        if (!base) return { allowed: false, reason: "Premium API is not configured." };
        if (!token?.trim()) return { allowed: false, reason: "Sign in required before starting a premium report." };
        try {
          const data = await httpJson<{
            allowed: boolean;
            reason?: string;
            quota_limit?: number;
            quota_used?: number;
            period_end_iso?: string | null;
          }>(
            `${base}/usage/business-analyst/report-start`,
            { method: "POST" },
            token
          );
          const payloadEntitlement = (data as { entitlement?: Partial<PremiumEntitlement> }).entitlement;
          const existing = get().entitlements.business_analyst;
          set({
            entitlements: {
              ...get().entitlements,
              business_analyst: {
                tool: "business_analyst",
                active: payloadEntitlement?.active ?? (data.allowed ? true : existing?.active ?? false),
                plan: existing?.plan ?? "business_analyst_monthly",
                price_label: existing?.price_label ?? "$29/mo",
                quota_limit: Number(payloadEntitlement?.quota_limit ?? data.quota_limit ?? existing?.quota_limit ?? 5),
                quota_used: Number(payloadEntitlement?.quota_used ?? data.quota_used ?? existing?.quota_used ?? 0),
                period_end_iso: (payloadEntitlement?.period_end_iso as string | null | undefined) ?? data.period_end_iso ?? existing?.period_end_iso ?? null,
                updated_at: new Date().toISOString(),
              },
            },
          });
          return { allowed: Boolean(data.allowed), reason: data.reason };
        } catch (error) {
          return { allowed: false, reason: error instanceof Error ? error.message : "Preflight check failed." };
        }
      },
    }),
    {
      name: "arx-premium-store",
      version: 1,
      storage: createJSONStorage(() => localStorage),
    }
  )
);
