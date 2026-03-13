import {
  Server,
  Plus,
  RefreshCw,
  Loader2,
  Check,
  CheckCircle2,
  Pencil,
  Trash2,
  XCircle,
  Mic,
  Database,
  Volume2,
  MessageSquare,
  Image,
  Cloud,
  KeyRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../../../lib/utils";
import {
  llmModelListAll,
  llmModelAdd,
  llmModelUpdate,
  llmModelDelete,
  llmModelSetPrimary,
  llmModelVerify,
  browserSearchKeyStatus,
  browserSearchKeySet,
  browserSearchKeyValidate,
  type ModelConfig,
} from "../../../core/tooling/client";
import {
  DEFAULT_API_FORM,
  type ApiFormState,
  type VerifyState,
  PanelWrapper,
  normalizeApiBaseUrl,
  toOptionalNumber,
  extractLatencyLabel,
  maskApiKey,
  formatSizeBillions,
  formatUsd,
} from "./shared";

function ApiTypeIcon({ type }: { type: string }) {
  switch (type) {
    case "voice":
      return <Mic size={14} className="text-cyan-300" />;
    case "data":
      return <Database size={14} className="text-accent-gold" />;
    case "speech":
      return <Volume2 size={14} className="text-rose-300" />;
    case "chat":
      return <MessageSquare size={14} className="text-accent-primary" />;
    default:
      return <Server size={14} className="text-text-dark" />;
  }
}

export function ApiPanel() {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [activeAddSection, setActiveAddSection] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ApiFormState>(DEFAULT_API_FORM);
  const [verifyMap, setVerifyMap] = useState<Record<string, VerifyState>>({});
  const [serperModalOpen, setSerperModalOpen] = useState(false);
  const [serperApiKeyInput, setSerperApiKeyInput] = useState("");
  const [serperConfigured, setSerperConfigured] = useState(false);
  const [serperMasked, setSerperMasked] = useState("");
  const [serperValidationState, setSerperValidationState] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [serperValidationLabel, setSerperValidationLabel] = useState("");
  const modelsJson = useMemo(
    () =>
      JSON.stringify(
        configs.map((cfg) => ({
          id: cfg.id,
          name: cfg.name,
          api_type: cfg.api_type,
          model_id: cfg.model_id,
          base_url: cfg.base_url,
          context_length: cfg.context_length,
          parameter_count: cfg.parameter_count,
          size_billions:
            cfg.parameter_count !== null && cfg.parameter_count !== undefined
              ? Number((cfg.parameter_count / 1_000_000_000).toFixed(1))
              : null,
          speed_tps: cfg.speed_tps,
          monthly_cost_usd: cfg.monthly_cost,
          cost_per_million_tokens_usd: cfg.cost_per_million_tokens,
          is_primary: cfg.is_primary,
          last_available: cfg.last_available,
          last_check_message: cfg.last_check_message,
          last_check_at: cfg.last_check_at,
        })),
        null,
        2
      ),
    [configs]
  );

  const getSectionKeyForConfig = useCallback((cfg: ModelConfig): string => {
    const haystack = `${cfg.name} ${cfg.model_id} ${cfg.base_url}`.toLowerCase();
    const isImage = /(image|img|sdxl|stable diffusion|dall[- ]?e|midjourney|flux)/.test(haystack);
    if (isImage) return "image";
    const isCloud = /(aws|amazon|azure|gcp|google cloud|vertex|bedrock|cloud|sagemaker)/.test(haystack);
    if (isCloud) return "cloud";
    if ((cfg.api_type || "chat") === "chat") return "chat";
    if (cfg.api_type === "speech") return "speech";
    if (cfg.api_type === "voice") return "voice";
    if (cfg.api_type === "data") return "data";
    return "other";
  }, []);

  const loadConfigs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await llmModelListAll();
      setConfigs(next);
      console.info(`[api-panel] loaded ${next.length} API account(s)`);
    } catch (e) {
      const message = String(e);
      setError(message);
      console.error("[api-panel] failed to load API accounts:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  const refreshSerperStatus = useCallback(async () => {
    try {
      const status = await browserSearchKeyStatus();
      setSerperConfigured(Boolean(status.configured));
      setSerperMasked(status.masked ?? "");
    } catch {
      setSerperConfigured(false);
      setSerperMasked("");
    }
  }, []);

  useEffect(() => {
    void refreshSerperStatus();
  }, [refreshSerperStatus]);

  useEffect(() => {
    if (!serperModalOpen) return;
    const key = serperApiKeyInput.trim();
    if (!key) {
      setSerperValidationState("idle");
      setSerperValidationLabel("");
      return;
    }
    setSerperValidationState("checking");
    setSerperValidationLabel("Checking key...");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await browserSearchKeyValidate(key);
          setSerperValidationState(result.ok ? "valid" : "invalid");
          setSerperValidationLabel(result.message || (result.ok ? "Valid key" : "Invalid key"));
        } catch (e) {
          setSerperValidationState("invalid");
          setSerperValidationLabel(e instanceof Error ? e.message : "Validation failed");
        }
      })();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [serperApiKeyInput, serperModalOpen]);

  const saveSerperKey = async () => {
    await browserSearchKeySet(serperApiKeyInput.trim());
    setSerperApiKeyInput("");
    setSerperValidationState("idle");
    setSerperValidationLabel("");
    await refreshSerperStatus();
    setSerperModalOpen(false);
  };

  const resetForm = () => {
    setForm(DEFAULT_API_FORM);
    setEditingId(null);
    setShowForm(false);
    setActiveAddSection(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.model_id.trim() || !form.base_url.trim()) return;

    try {
      const payload = {
        name: form.name.trim(),
        model_id: form.model_id.trim(),
        base_url: normalizeApiBaseUrl(form.base_url),
        api_key: form.api_key.trim(),
        api_type: form.api_type,
        parameter_count: toOptionalNumber(form.parameter_count),
        speed_tps: toOptionalNumber(form.speed_tps),
        context_length: toOptionalNumber(form.context_length),
        monthly_cost: toOptionalNumber(form.monthly_cost),
        cost_per_million_tokens: toOptionalNumber(form.cost_per_million_tokens),
        is_primary: form.is_primary,
      };

      let targetId = editingId;
      if (editingId) {
        console.info(`[api-panel] updating API account: ${editingId}`);
        await llmModelUpdate(editingId, payload);
      } else {
        console.info(`[api-panel] adding API account: ${form.name}`);
        const created = await llmModelAdd(payload);
        targetId = created.id;
      }
      if (targetId) {
        await handleVerify(targetId, true);
      }
      resetForm();
      await loadConfigs();
    } catch (e) {
      setError(String(e));
      console.error("[api-panel] failed to save API account:", e);
    }
  };

  const startEdit = (cfg: ModelConfig) => {
    setEditingId(cfg.id);
    setForm({
      name: cfg.name,
      api_type: (cfg.api_type as ApiFormState["api_type"]) ?? "chat",
      model_id: cfg.model_id,
      base_url: normalizeApiBaseUrl(cfg.base_url),
      api_key: cfg.api_key,
      parameter_count: cfg.parameter_count?.toString() ?? "",
      speed_tps: cfg.speed_tps?.toString() ?? "",
      context_length: cfg.context_length?.toString() ?? "",
      monthly_cost: cfg.monthly_cost?.toString() ?? "",
      cost_per_million_tokens: cfg.cost_per_million_tokens?.toString() ?? "",
      is_primary: cfg.is_primary,
    });
    setActiveAddSection(getSectionKeyForConfig(cfg));
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try {
      console.info(`[api-panel] deleting API account: ${id}`);
      await llmModelDelete(id);
      setVerifyMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await loadConfigs();
    } catch (e) {
      setError(String(e));
      console.error("[api-panel] failed to delete API account:", e);
    }
  };

  const handleSetPrimary = async (id: string) => {
    try {
      console.info(`[api-panel] setting API account as primary: ${id}`);
      await llmModelSetPrimary(id);
      await loadConfigs();
    } catch (e) {
      setError(String(e));
      console.error("[api-panel] failed to set API account as primary:", e);
    }
  };

  const handleVerify = async (id: string, testResponse = false) => {
    setVerifyMap((prev) => ({
      ...prev,
      [id]: { state: "checking", message: "Checking..." },
    }));
    try {
      console.info(`[api-panel] verifying API account: ${id} (response=${testResponse})`);
      const result = await llmModelVerify(id, testResponse);
      setVerifyMap((prev) => ({
        ...prev,
        [id]: {
          state: result.ok ? "ok" : "fail",
          message: result.message,
        },
      }));
      if (result.ok) {
        console.info(`[api-panel] verify passed for ${id}: ${result.message}`);
      } else {
        console.warn(`[api-panel] verify failed for ${id}: ${result.message}`);
      }
      await loadConfigs();
    } catch (e) {
      const message = String(e);
      setVerifyMap((prev) => ({
        ...prev,
        [id]: { state: "fail", message: "Verification failed" },
      }));
      console.error(`[api-panel] verify error for ${id}:`, e);
      setError(message);
    }
  };

  const openAddConnectionForm = (sectionKey: string, defaultType: ApiFormState["api_type"]) => {
    setShowForm((v) => (activeAddSection === sectionKey ? !v : true));
    setActiveAddSection(sectionKey);
    setEditingId(null);
    setForm({ ...DEFAULT_API_FORM, api_type: defaultType });
  };

  const renderConfigCard = (cfg: ModelConfig) => {
    const verify = verifyMap[cfg.id] ?? {
      state: cfg.last_available ? "ok" : cfg.last_check_message ? "fail" : "idle",
      message: cfg.last_check_message || "Not verified",
    };
    const latencyLabel = verify.state === "ok" ? extractLatencyLabel(verify.message) : null;
    const shortKey = maskApiKey(cfg.api_key);
    const specs = [
      `Context Length: ${cfg.context_length?.toLocaleString() ?? "-"}`,
      `Size: ${formatSizeBillions(cfg.parameter_count)}`,
      `speed: ${cfg.speed_tps ? `${cfg.speed_tps.toFixed(1)} t/s` : "-"}`,
      `$/month: ${formatUsd(cfg.monthly_cost)}`,
      `$/M tokens: ${formatUsd(cfg.cost_per_million_tokens)}`,
    ].join(" · ");

    return (
      <div
        key={cfg.id}
        className="rounded border border-line-med bg-line-light px-2 py-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ApiTypeIcon type={cfg.api_type} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-1.5 text-[11px] text-text-norm min-w-0">
              <span className="font-medium truncate">{cfg.name}</span>
              <span className="text-text-dark truncate">{cfg.model_id}</span>
              <span className="text-text-dark truncate">
                {cfg.base_url}
                {latencyLabel ? ` (${latencyLabel})` : ""}
              </span>
              {cfg.is_primary && (
                <span className="rounded bg-accent-green/20 px-1 py-0.5 text-[9px] text-accent-green shrink-0">
                  Primary
                </span>
              )}
            </div>
            <div className="text-[10px] text-text-dark truncate">
              {specs} · key {shortKey}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => void handleVerify(cfg.id, true)}
              className="rounded p-1 text-text-dark hover:text-text-norm hover:bg-line-med transition-colors"
              title="Verify API"
            >
              {verify.state === "checking" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Check size={12} />
              )}
            </button>
            {!cfg.is_primary && (
              <button
                onClick={() => void handleSetPrimary(cfg.id)}
                className="rounded p-1 text-text-dark hover:text-accent-green hover:bg-accent-green/10 transition-colors"
                title="Set as primary"
              >
                <CheckCircle2 size={12} />
              </button>
            )}
            <button
              onClick={() => startEdit(cfg)}
              className="rounded p-1 text-text-dark hover:text-text-norm hover:bg-line-med transition-colors"
              title="Edit API"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={() => void handleDelete(cfg.id)}
              className="rounded p-1 text-text-dark hover:text-accent-red hover:bg-accent-red/10 transition-colors"
              title="Delete API"
            >
              <Trash2 size={12} />
            </button>
          </div>
          <div className="w-[120px] flex items-center justify-end gap-1 text-[10px] shrink-0">
            {verify.state === "checking" && (
              <Loader2 size={12} className="text-accent-gold animate-spin" />
            )}
            {verify.state === "ok" && (
              <CheckCircle2 size={16} className="text-accent-green" />
            )}
            {verify.state === "fail" && (
              <XCircle size={12} className="text-accent-red" />
            )}
            {verify.state !== "ok" && (
              <span
                className={cn(
                  "truncate",
                  verify.state === "fail" && "text-accent-red",
                  verify.state === "checking" && "text-accent-gold",
                  verify.state === "idle" && "text-text-dark"
                )}
                title={verify.message}
              >
                {verify.message}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const sections = useMemo(
    () => [
      {
        key: "chat",
        title: "Language Models",
        icon: <MessageSquare size={13} className="text-accent-primary" />,
        items: configs.filter((cfg) => getSectionKeyForConfig(cfg) === "chat"),
      },
      {
        key: "voice",
        title: "Voice Transcription (STT)",
        icon: <Mic size={13} className="text-cyan-300" />,
        items: configs.filter((cfg) => getSectionKeyForConfig(cfg) === "voice"),
      },
      {
        key: "data",
        title: "Search / Data APIs",
        icon: <Database size={13} className="text-accent-gold" />,
        items: configs.filter((cfg) => getSectionKeyForConfig(cfg) === "data"),
      },
      {
        key: "speech",
        title: "Speech Generation (TTS)",
        icon: <Volume2 size={13} className="text-rose-300" />,
        items: configs.filter((cfg) => getSectionKeyForConfig(cfg) === "speech"),
      },
      {
        key: "image",
        title: "Image Generation",
        icon: <Image size={13} className="text-fuchsia-300" />,
        items: configs.filter((cfg) => getSectionKeyForConfig(cfg) === "image"),
      },
      {
        key: "cloud",
        title: "Cloud Services",
        icon: <Cloud size={13} className="text-sky-300" />,
        items: configs.filter((cfg) => getSectionKeyForConfig(cfg) === "cloud"),
      },
      {
        key: "other",
        title: "Omni / Multimodal",
        icon: <Server size={13} className="text-violet-300" />,
        items: configs.filter((cfg) => getSectionKeyForConfig(cfg) === "other"),
      },
    ],
    [configs, getSectionKeyForConfig]
  );

  return (
    <PanelWrapper
      title="Available APIs"
      icon={<Server size={16} className="text-accent-primary" />}
      actions={
        <>
          <button
            onClick={() => void loadConfigs()}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
          <button
            onClick={() => openAddConnectionForm("chat", "chat")}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 transition-colors"
          >
            <Plus size={12} />
            Add
          </button>
        </>
      }
    >
      <div className="p-4 h-full min-h-0 flex flex-col gap-4">
        {error && (
          <div className="text-[11px] text-accent-red/80 bg-accent-red/10 border border-accent-red/20 rounded px-2 py-1.5">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          {isLoading ? (
            <div className="text-xs text-text-dark italic">Loading API accounts...</div>
          ) : (
            sections.map((section) => (
              <section key={section.key} className="border-t border-line-med pt-2">
                <div className="mb-2 flex items-center gap-2 text-[11px] text-text-med">
                  {section.icon}
                  <span className="font-medium">{section.title}</span>
                  <span className="text-text-dark">({section.items.length})</span>
                </div>
                {section.key === "data" ? (
                  <div className="mb-2 rounded border border-line-med bg-line-light p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] text-text-med">
                        Serper search API {serperConfigured ? `configured (${serperMasked || "saved"})` : "not configured"}.
                      </div>
                      <button
                        onClick={() => setSerperModalOpen(true)}
                        className="inline-flex items-center gap-1 rounded border border-line-med px-2 py-1 text-[10px] text-text-med hover:text-text-norm hover:bg-line-med"
                      >
                        <KeyRound size={11} />
                        {serperConfigured ? "Update Key" : "Setup Serper"}
                      </button>
                    </div>
                  </div>
                ) : null}
                {section.items.length > 0 ? (
                  <div className="space-y-1">
                    {section.items.map((cfg) => renderConfigCard(cfg))}
                  </div>
                ) : (
                  <div className="text-xs text-text-dark italic">No connections configured.</div>
                )}
                <div className="pt-2 pb-3 space-y-2">
                  <button
                    onClick={() =>
                      openAddConnectionForm(
                        section.key,
                        section.key === "speech"
                          ? "speech"
                          : section.key === "voice"
                            ? "voice"
                            : section.key === "image"
                              ? "other"
                              : section.key === "cloud"
                                ? "data"
                              : section.key === "data"
                                ? "data"
                                : section.key === "other"
                                ? "other"
                                : "chat"
                      )
                    }
                    className="inline-flex w-fit items-center gap-1 px-2 py-1 rounded text-[11px] bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 transition-colors"
                  >
                    <Plus size={12} />
                    Add API Connection
                  </button>

                  {showForm && activeAddSection === section.key && (
                      <form onSubmit={handleSubmit} className="space-y-2 rounded border border-line-med bg-line-light p-3">
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={form.name}
                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                            className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                            placeholder="Display name"
                          />
                          <input
                            type="text"
                            value={form.model_id}
                            onChange={(e) => setForm((prev) => ({ ...prev, model_id: e.target.value }))}
                            className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                            placeholder="Model ID"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <select
                            value={form.api_type}
                            onChange={(e) =>
                              setForm((prev) => ({
                                ...prev,
                                api_type: e.target.value as ApiFormState["api_type"],
                              }))
                            }
                            className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                          >
                            <option value="chat" className="bg-bg-norm text-text-norm">Chat</option>
                            <option value="voice" className="bg-bg-norm text-text-norm">Voice</option>
                            <option value="data" className="bg-bg-norm text-text-norm">Data</option>
                            <option value="speech" className="bg-bg-norm text-text-norm">Speech</option>
                            <option value="other" className="bg-bg-norm text-text-norm">Other</option>
                          </select>
                          <input
                            type="number"
                            step="1"
                            value={form.parameter_count}
                            onChange={(e) => setForm((prev) => ({ ...prev, parameter_count: e.target.value }))}
                            className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                            placeholder="Parameter count (optional)"
                          />
                        </div>
                        <input
                          type="text"
                          value={form.base_url}
                          onChange={(e) => setForm((prev) => ({ ...prev, base_url: e.target.value }))}
                          onBlur={() =>
                            setForm((prev) => ({ ...prev, base_url: normalizeApiBaseUrl(prev.base_url) }))
                          }
                          className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                          placeholder="Endpoint URL (e.g. http://127.0.0.1:1234/v1)"
                        />
                        <input
                          type="password"
                          value={form.api_key}
                          onChange={(e) => setForm((prev) => ({ ...prev, api_key: e.target.value }))}
                          className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                          placeholder="API key (optional)"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="number"
                            step="0.01"
                            value={form.speed_tps}
                            onChange={(e) => setForm((prev) => ({ ...prev, speed_tps: e.target.value }))}
                            className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                            placeholder="Speed tokens/s (optional)"
                          />
                          <input
                            type="number"
                            step="1"
                            value={form.context_length}
                            onChange={(e) => setForm((prev) => ({ ...prev, context_length: e.target.value }))}
                            className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                            placeholder="Context length (optional)"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="number"
                            step="0.01"
                            value={form.monthly_cost}
                            onChange={(e) => setForm((prev) => ({ ...prev, monthly_cost: e.target.value }))}
                            className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                            placeholder="Monthly cost USD (optional)"
                          />
                          <input
                            type="number"
                            step="0.01"
                            value={form.cost_per_million_tokens}
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, cost_per_million_tokens: e.target.value }))
                            }
                            className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                            placeholder="Cost / 1M tokens (optional)"
                          />
                        </div>
                        <label className="flex items-center gap-2 text-[11px] text-text-med">
                          <input
                            type="checkbox"
                            checked={form.is_primary}
                            onChange={(e) => setForm((prev) => ({ ...prev, is_primary: e.target.checked }))}
                            className="accent-indigo-500"
                          />
                          Set as primary
                        </label>
                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            className="px-2 py-1 rounded text-[11px] bg-accent-primary/25 text-accent-primary hover:bg-accent-primary/35 transition-colors"
                          >
                            {editingId ? "Save" : "Add API"}
                          </button>
                          <button
                            type="button"
                            onClick={resetForm}
                            className="px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                  )}
                </div>
              </section>
            ))
          )}
        </div>

        <details className="sticky bottom-0 mt-auto rounded border border-line-med bg-black/20 px-2 py-1.5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-[10px] text-text-med">
            <span className="font-medium uppercase tracking-wider">Models JSON</span>
            <span className="text-text-dark">
              {configs.length} model{configs.length === 1 ? "" : "s"}
            </span>
          </summary>
          <pre className="mt-1.5 max-h-28 overflow-auto rounded bg-black/30 p-2 text-[10px] leading-4 text-accent-green/90">
            {modelsJson}
          </pre>
        </details>
      </div>
      {serperModalOpen ? (
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded border border-line-med bg-bg-norm">
            <div className="flex items-center justify-between border-b border-line-light px-3 py-2">
              <div className="text-sm text-text-norm">Serper API Key</div>
              <button
                onClick={() => setSerperModalOpen(false)}
                className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-line-light text-text-med"
              >
                <XCircle size={13} />
              </button>
            </div>
            <div className="p-3 space-y-2">
              <div className="text-xs text-text-dark">
                Current: {serperConfigured ? serperMasked || "Configured" : "Not set"}
              </div>
              <input
                type="password"
                value={serperApiKeyInput}
                onChange={(e) => setSerperApiKeyInput(e.target.value)}
                placeholder="Enter Serper API key"
                className="w-full rounded border border-line-med bg-line-light px-2 py-1.5 text-xs text-text-norm outline-none"
              />
              {serperValidationLabel ? (
                <div
                  className={cn(
                    "text-xs",
                    serperValidationState === "valid"
                      ? "text-accent-green"
                      : serperValidationState === "invalid"
                      ? "text-accent-red"
                      : "text-text-med"
                  )}
                >
                  {serperValidationLabel}
                </div>
              ) : null}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => void saveSerperKey()}
                  disabled={serperValidationState !== "valid"}
                  className="px-2 py-1 rounded text-xs bg-accent-primary/30 text-accent-primary hover:bg-accent-primary/40 disabled:opacity-60"
                >
                  Save and Exit
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </PanelWrapper>
  );
}
