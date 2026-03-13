import { RefreshCw, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { settingsGetAll, settingsSet } from "../../../lib/tauri";
import {
  SAFE_SETTINGS,
  type SafeSettingKey,
  getSafeSettingDefinition,
  pickSafeSettings,
  sanitizeSafeSettingValue,
} from "../../../lib/safeSettings";
import { useVoiceStore } from "../../../store/voiceStore";
import { cn } from "../../../lib/utils";
import { PanelWrapper } from "./shared";

type ValueMap = Record<SafeSettingKey, string>;
type StatusMap = Partial<Record<SafeSettingKey, string>>;

function applyVoiceCache(key: SafeSettingKey, value: string): void {
  const update: {
    bargeInEnabled?: boolean;
    prefillEnabled?: boolean;
    stableTailWords?: number;
    prefillMinWords?: number;
    prefillDivergenceThreshold?: number;
  } = {};

  if (key === "barge_in_enabled") update.bargeInEnabled = value === "true";
  if (key === "prefill_enabled") update.prefillEnabled = value === "true";
  if (key === "stable_tail_words") update.stableTailWords = Number(value);
  if (key === "prefill_min_words") update.prefillMinWords = Number(value);
  if (key === "prefill_divergence_threshold") update.prefillDivergenceThreshold = Number(value);

  if (Object.keys(update).length > 0) {
    useVoiceStore.getState().setPrefillConfig(update);
  }
}

export function SafeSettingsPanel() {
  const [values, setValues] = useState<ValueMap>(() =>
    pickSafeSettings({})
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<StatusMap>({});
  const [status, setStatus] = useState<StatusMap>({});

  const load = async () => {
    setLoading(true);
    try {
      const all = await settingsGetAll();
      setValues(pickSafeSettings(all));
      setStatus({});
    } catch (error) {
      console.error("Failed to load safe settings:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const dirtySet = useMemo(() => {
    const set = new Set<SafeSettingKey>();
    for (const key of Object.keys(status) as SafeSettingKey[]) {
      if (status[key] === "dirty") set.add(key);
    }
    return set;
  }, [status]);

  const updateValue = (key: SafeSettingKey, next: string) => {
    setValues((prev) => ({ ...prev, [key]: next }));
    setStatus((prev) => ({ ...prev, [key]: "dirty" }));
  };

  const saveKey = async (key: SafeSettingKey) => {
    const normalized = sanitizeSafeSettingValue(key, values[key]);
    if (!normalized.ok) {
      setStatus((prev) => ({ ...prev, [key]: normalized.error }));
      return;
    }

    setSaving((prev) => ({ ...prev, [key]: "saving" }));
    try {
      await settingsSet(key, normalized.value);
      setValues((prev) => ({ ...prev, [key]: normalized.value }));
      setStatus((prev) => ({ ...prev, [key]: "saved" }));
      applyVoiceCache(key, normalized.value);
    } catch (error) {
      setStatus((prev) => ({ ...prev, [key]: `save failed: ${String(error)}` }));
    } finally {
      setSaving((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  return (
    <PanelWrapper
      title="Safe Settings"
      icon={<Settings2 size={16} className="text-accent-green" />}
      actions={(
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-text-med hover:text-text-norm hover:bg-line-light transition-colors"
          title="Reload safe settings"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      )}
      fill
    >
      <div className="flex-1 overflow-auto p-3">
        <p className="text-[11px] text-text-dark mb-3">
          Lightweight settings for primary-agent-safe updates only.
        </p>

        <div className="space-y-2">
          {SAFE_SETTINGS.map((def) => {
            const key = def.key;
            const current = values[key];
            const state = status[key];
            const isSaving = Boolean(saving[key]);

            return (
              <div key={key} className="grid grid-cols-[180px_1fr_auto] gap-2 items-center border border-line-light rounded px-2 py-2">
                <div className="min-w-0">
                  <div className="text-[11px] text-text-med font-medium">{def.label}</div>
                  <div className="text-[10px] text-text-dark truncate" title={def.description}>{def.description}</div>
                  <div className="text-[10px] text-text-dark font-mono">{key}</div>
                </div>

                <div>
                  {def.kind === "boolean" && (
                    <label className="inline-flex items-center gap-2 text-[11px] text-text-med">
                      <input
                        type="checkbox"
                        checked={current === "true"}
                        onChange={(e) => updateValue(key, e.target.checked ? "true" : "false")}
                      />
                      <span>{current === "true" ? "enabled" : "disabled"}</span>
                    </label>
                  )}

                  {def.kind === "enum" && (
                    <select
                      value={current}
                      onChange={(e) => updateValue(key, e.target.value)}
                      className="h-7 rounded border border-line-light bg-transparent px-2 text-[11px] text-text-med outline-none"
                    >
                      {(def.options ?? []).map((option) => (
                        <option key={option} value={option} className="bg-bg-dark text-text-med">
                          {option}
                        </option>
                      ))}
                    </select>
                  )}

                  {def.kind === "number" && (
                    <input
                      type="number"
                      value={current}
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      onChange={(e) => updateValue(key, e.target.value)}
                      className="h-7 w-40 rounded border border-line-light bg-transparent px-2 text-[11px] text-text-med outline-none"
                    />
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void saveKey(key)}
                    disabled={isSaving || !dirtySet.has(key)}
                    className={cn(
                      "h-7 rounded px-2 text-[11px] transition-colors",
                      isSaving || !dirtySet.has(key)
                        ? "text-text-dark border border-line-light cursor-not-allowed"
                        : "text-text-med border border-line-med hover:bg-line-light hover:text-text-norm"
                    )}
                  >
                    {isSaving ? "Saving" : "Save"}
                  </button>
                  <span className="min-w-24 text-[10px] text-text-dark truncate" title={state}>
                    {state === "dirty" ? "unsaved" : state === "saved" ? "saved" : state || ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {loading && <p className="text-[11px] text-text-dark mt-3">Loading...</p>}
      </div>
    </PanelWrapper>
  );
}
