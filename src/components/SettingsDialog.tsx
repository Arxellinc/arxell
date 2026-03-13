import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, RefreshCw, Save, X } from "lucide-react";
import { modelsList, settingsGetAll, settingsSet } from "../lib/tauri";
import { useThemeStore, type Theme } from "../store/themeStore";
import { cn } from "../lib/utils";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const DEFAULTS: Record<string, string> = {
  ui_theme: "dark",
  base_url: "http://127.0.0.1:1234/v1",
  api_key: "lm-studio",
  model: "zai-org/glm-4.6v-flash",
  system_prompt: "You are Arxell, a helpful AI assistant. Be concise and clear.",
  stt_engine: "whisper_rs",
  stt_url: "http://127.0.0.1:1234/v1/audio/transcriptions",
  whisper_model_size: "tiny",
  whisper_model_dir: "",
  whisper_rs_model_path: "~/.local/share/arx/whisper/ggml-base.en.bin",
  whisper_rs_language: "en",
  tts_engine: "kokoro",
  tts_url: "http://127.0.0.1:1234/v1/audio/speech",
  tts_voice: "alloy",
  kokoro_model_path: "~/.local/share/arx/kokoro/kokoro-v1.0.onnx",
  kokoro_voices_path: "~/.local/share/arx/kokoro/voices-v1.0.bin",
  kokoro_voice: "af_heart",
  vad_threshold: "0.35",
  vad_min_silence_ms: "1200",
  vad_speech_pad_pre_ms: "320",
  vad_min_speech_ms: "50",
  vad_max_speech_s: "30.0",
  vad_amplitude_threshold: "0.005",
  vad_mode: "auto",
  prefill_enabled: "true",
  barge_in_enabled: "true",
  stable_tail_words: "6",
  prefill_min_words: "3",
  prefill_divergence_threshold: "0.8",
  coder_pi_executable: "",
  coder_model: "",
  coder_mode: "shell",
  coder_path_guard_enabled: "false",
  full_auto_idle_minutes: "5",
};

const MANAGED_KEYS = new Set(Object.keys(DEFAULTS));

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-line-med p-4">
      <h3 className="text-xs font-medium text-text-norm">{title}</h3>
      {children}
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "number";
  hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-text-med">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-line-dark bg-transparent px-2.5 py-2 text-xs text-text-norm outline-none focus:border-line-dark font-mono"
      />
      {hint ? <p className="text-[10px] text-text-dark">{hint}</p> : null}
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-text-med">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-line-dark bg-transparent px-2.5 py-2 text-xs text-text-norm outline-none focus:border-line-dark"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <p className="text-[10px] text-text-dark">{hint}</p> : null}
    </label>
  );
}

function BoolField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 rounded border border-line-med px-2.5 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span className="space-y-0.5">
        <span className="block text-[11px] text-text-norm">{label}</span>
        {hint ? <span className="block text-[10px] text-text-dark">{hint}</span> : null}
      </span>
    </label>
  );
}

const THEME_OPTIONS: {
  id: Theme;
  label: string;
  description: string;
  swatches: { bg: string; norm: string; primary: string; accent: string };
}[] = [
  {
    id: "dark",
    label: "Dark",
    description: "Near-black with white text",
    swatches: { bg: "#111111", norm: "#1c1c1c", primary: "#6366f1", accent: "#4ade80" },
  },
  {
    id: "light",
    label: "Light",
    description: "White surface with dark text",
    swatches: { bg: "#f5f5f5", norm: "#ffffff", primary: "#4f46e5", accent: "#16a34a" },
  },
  {
    id: "tron",
    label: "Tron",
    description: "Sci-fi terminal with cyan grid",
    swatches: { bg: "#001520", norm: "#002535", primary: "#00f0ff", accent: "#00ff9d" },
  },
];

function ThemePicker({ onChange }: { onChange?: (theme: Theme) => void }) {
  const { theme, setTheme } = useThemeStore();

  const handleThemeClick = (nextTheme: Theme) => {
    setTheme(nextTheme);
    onChange?.(nextTheme);
  };

  return (
    <div className="grid grid-cols-3 gap-3">
      {THEME_OPTIONS.map((opt) => {
        const active = theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => handleThemeClick(opt.id)}
            className={cn(
              "relative rounded-lg border p-3 text-left transition-all",
              active
                ? "border-accent-primary bg-accent-primary/10"
                : "border-line-med bg-line-light hover:border-line-dark hover:bg-line-med"
            )}
          >
            {/* Mini preview */}
            <div
              className="mb-2.5 h-12 w-full rounded overflow-hidden flex flex-col gap-0.5 p-1.5"
              style={{ backgroundColor: opt.swatches.bg }}
            >
              {/* Simulated top bar */}
              <div className="flex gap-0.5 items-center mb-0.5">
                <div className="h-1 w-8 rounded-full" style={{ backgroundColor: opt.swatches.norm }} />
                <div className="ml-auto h-1 w-3 rounded-full" style={{ backgroundColor: opt.swatches.primary }} />
              </div>
              {/* Simulated content rows */}
              <div className="flex-1 flex flex-col gap-0.5 justify-center">
                <div className="h-1 w-full rounded-full" style={{ backgroundColor: opt.swatches.norm, opacity: 0.5 }} />
                <div className="h-1 w-2/3 rounded-full" style={{ backgroundColor: opt.swatches.norm, opacity: 0.3 }} />
              </div>
              {/* Accent bar */}
              <div className="h-1 w-4 rounded-full" style={{ backgroundColor: opt.swatches.accent }} />
            </div>

            <div className="flex items-start justify-between gap-1">
              <div>
                <div className="text-[11px] font-medium text-text-norm">{opt.label}</div>
                <div className="text-[10px] text-text-dark">{opt.description}</div>
              </div>
              {active && (
                <Check size={12} className="mt-0.5 flex-shrink-0 text-accent-primary" />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(DEFAULTS);
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fetchedForUrl = useRef<string | null>(null);

  const handleThemeChange = (nextTheme: Theme) => {
    setValues((prev) => ({ ...prev, ui_theme: nextTheme }));
  };

  useEffect(() => {
    if (open) {
      setSaveError(null);
      setSaved(false);
      settingsGetAll()
        .then((all) => setValues({ ...DEFAULTS, ...all }))
        .catch(console.error);
    }
  }, [open]);

  // Auto-fetch models when base_url becomes available
  useEffect(() => {
    const base_url = values["base_url"];
    if (base_url && base_url !== fetchedForUrl.current) {
      fetchModels(base_url);
    }
  }, [values["base_url"]]);

  const fetchModels = async (base_url?: string) => {
    const url = base_url ?? values["base_url"];
    if (!url) return;
    fetchedForUrl.current = url;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const list = await modelsList();
      setModels(list);
    } catch (e) {
      setModelsError(String(e));
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      const results = await Promise.allSettled(
        Object.entries(values).map(([key, value]) => settingsSet(key, value ?? ""))
      );
      const failedCount = results.filter((r) => r.status === "rejected").length;
      if (failedCount > 0) {
        setSaveError(`Failed to save ${failedCount} setting${failedCount === 1 ? "" : "s"}.`);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } catch (error) {
      setSaveError(String(error));
    } finally {
      setSaving(false);
    }
  };

  const currentModel = values["model"] ?? "";
  // Ensure current model appears in the list even if not returned by API
  const modelOptions =
    models.length > 0
      ? models.includes(currentModel)
        ? models
        : [currentModel, ...models].filter(Boolean)
      : currentModel
        ? [currentModel]
        : [];

  const otherKeys = Object.keys(values)
    .filter((key) => !MANAGED_KEYS.has(key))
    .sort();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="settings-dialog mx-4 w-full max-w-5xl rounded-xl border border-line-dark bg-bg-light shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line-med px-5 py-4">
          <h2 className="text-sm font-semibold text-text-norm">Global Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-dark transition-colors hover:bg-line-med hover:text-text-med"
          >
            <X size={16} />
          </button>
        </div>

        {/* Fields */}
        <div className="max-h-[78vh] space-y-4 overflow-y-auto px-5 py-4">
          <Section title="Appearance">
            <ThemePicker onChange={handleThemeChange} />
            <p className="text-[10px] text-text-dark">Theme applies immediately and is saved automatically.</p>
          </Section>

          <Section title="Language Model">
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                label="Base URL"
                value={values.base_url ?? ""}
                onChange={(v) => setValues((prev) => ({ ...prev, base_url: v }))}
                placeholder="http://127.0.0.1:1234/v1"
                hint="OpenAI-compatible endpoint."
              />
              <TextField
                label="API Key"
                type="password"
                value={values.api_key ?? ""}
                onChange={(v) => setValues((prev) => ({ ...prev, api_key: v }))}
                placeholder="lm-studio"
              />
            </div>
            <div className="space-y-1">
              <span className="text-[11px] text-text-med">Model</span>
              <div className="flex gap-2">
                {modelOptions.length > 0 ? (
                  <select
                    value={currentModel}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, model: e.target.value }))
                    }
                    className="flex-1 rounded border border-line-dark bg-transparent px-2.5 py-2 text-xs text-text-norm outline-none focus:border-line-dark"
                  >
                    {modelOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={currentModel}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, model: e.target.value }))
                    }
                    className="flex-1 rounded border border-line-dark bg-transparent px-2.5 py-2 text-xs text-text-norm outline-none focus:border-line-dark font-mono"
                  />
                )}
                <button
                  type="button"
                  onClick={() => {
                    fetchedForUrl.current = null;
                    fetchModels();
                  }}
                  disabled={modelsLoading}
                  title="Refresh model list"
                  className="inline-flex h-8 w-8 items-center justify-center rounded border border-line-dark text-text-med hover:bg-line-med disabled:opacity-40"
                >
                  <RefreshCw size={14} className={modelsLoading ? "animate-spin" : ""} />
                </button>
              </div>
              {modelsError ? (
                <p className="text-[10px] text-accent-red/80">{modelsError}</p>
              ) : (
                <p className="text-[10px] text-text-dark">
                  {models.length > 0
                    ? `${models.length} model${models.length === 1 ? "" : "s"} available`
                    : "Enter manually or refresh to load models."}
                </p>
              )}
            </div>
            <label className="block space-y-1">
              <span className="text-[11px] text-text-med">System Prompt</span>
              <textarea
                value={values.system_prompt ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, system_prompt: e.target.value }))
                }
                rows={4}
                className="w-full resize-y rounded border border-line-dark bg-transparent px-2.5 py-2 text-xs text-text-norm outline-none focus:border-line-dark"
              />
            </label>
            <TextField
              label="Full-Auto Idle Timeout (minutes)"
              type="number"
              value={values.full_auto_idle_minutes ?? "5"}
              onChange={(v) => setValues((prev) => ({ ...prev, full_auto_idle_minutes: v }))}
              placeholder="5"
              hint="Minutes of inactivity before the agent shows the full-auto warning in Full-Auto mode."
            />
          </Section>

          <Section title="Coder">
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                label="Coder Executable"
                value={values.coder_pi_executable ?? ""}
                onChange={(v) => setValues((prev) => ({ ...prev, coder_pi_executable: v }))}
                placeholder="codex"
                hint="Binary or absolute path used by the Coder panel and coder_run tool."
              />
              <TextField
                label="Coder Model Override"
                value={values.coder_model ?? ""}
                onChange={(v) => setValues((prev) => ({ ...prev, coder_model: v }))}
                placeholder="Optional model id for codex exec --model"
                hint="Leave blank to auto-pick a coding model from your configured list."
              />
            </div>
          </Section>

          <Section title="Speech To Text">
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                label="STT Engine"
                value={values.stt_engine ?? "whisper"}
                onChange={(v) => setValues((prev) => ({ ...prev, stt_engine: v }))}
                options={[
                  { value: "whisper", label: "Whisper (local)" },
                  { value: "whisper_rs", label: "Whisper-rs (local)" },
                  { value: "external", label: "External API" },
                ]}
              />
              <TextField
                label="STT URL"
                value={values.stt_url ?? ""}
                onChange={(v) => setValues((prev) => ({ ...prev, stt_url: v }))}
                placeholder="http://127.0.0.1:1234/v1/audio/transcriptions"
              />
              <SelectField
                label="Whisper Model Size"
                value={values.whisper_model_size ?? "tiny"}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, whisper_model_size: v }))
                }
                options={[
                  { value: "tiny", label: "tiny" },
                  { value: "tiny.en", label: "tiny.en" },
                  { value: "base", label: "base" },
                  { value: "base.en", label: "base.en" },
                  { value: "small", label: "small" },
                  { value: "small.en", label: "small.en" },
                  { value: "medium", label: "medium" },
                  { value: "large-v2", label: "large-v2" },
                  { value: "large-v3", label: "large-v3" },
                ]}
              />
              <TextField
                label="Whisper Model Directory"
                value={values.whisper_model_dir ?? ""}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, whisper_model_dir: v }))
                }
                placeholder="~/.cache/huggingface"
              />
              <TextField
                label="Whisper-rs Model Path"
                value={values.whisper_rs_model_path ?? ""}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, whisper_rs_model_path: v }))
                }
                placeholder="~/.local/share/arx/whisper/ggml-base.en.bin"
              />
              <TextField
                label="Whisper-rs Language"
                value={values.whisper_rs_language ?? "en"}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, whisper_rs_language: v }))
                }
                placeholder="en"
              />
            </div>
          </Section>

          <Section title="Text To Speech">
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                label="TTS Engine"
                value={values.tts_engine ?? "kokoro"}
                onChange={(v) => setValues((prev) => ({ ...prev, tts_engine: v }))}
                options={[
                  { value: "kokoro", label: "Kokoro (Python)" },
                  { value: "external", label: "External API" },
                ]}
              />
              <TextField
                label="TTS URL"
                value={values.tts_url ?? ""}
                onChange={(v) => setValues((prev) => ({ ...prev, tts_url: v }))}
                placeholder="http://127.0.0.1:1234/v1/audio/speech"
              />
              <TextField
                label="External TTS Voice"
                value={values.tts_voice ?? ""}
                onChange={(v) => setValues((prev) => ({ ...prev, tts_voice: v }))}
                placeholder="alloy"
              />
              <TextField
                label="Kokoro Voice"
                value={values.kokoro_voice ?? ""}
                onChange={(v) => setValues((prev) => ({ ...prev, kokoro_voice: v }))}
                placeholder="af_heart"
              />
              <TextField
                label="Kokoro Model Path"
                value={values.kokoro_model_path ?? ""}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, kokoro_model_path: v }))
                }
              />
              <TextField
                label="Kokoro Voices Path"
                value={values.kokoro_voices_path ?? ""}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, kokoro_voices_path: v }))
                }
              />
            </div>
          </Section>

          <Section title="Voice Detection And Prefill">
            <div className="grid gap-2 md:grid-cols-2">
              <BoolField
                label="Enable Prefill Warmup"
                checked={(values.prefill_enabled ?? "true") === "true"}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, prefill_enabled: String(v) }))
                }
              />
              <BoolField
                label="Enable Barge-in"
                checked={(values.barge_in_enabled ?? "true") === "true"}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, barge_in_enabled: String(v) }))
                }
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <TextField
                label="VAD Mode"
                value={values.vad_mode ?? "auto"}
                onChange={(v) => setValues((prev) => ({ ...prev, vad_mode: v }))}
                hint="auto | onnx | amplitude"
              />
              <TextField
                label="VAD Threshold"
                type="number"
                value={values.vad_threshold ?? "0.35"}
                onChange={(v) => setValues((prev) => ({ ...prev, vad_threshold: v }))}
              />
              <TextField
                label="Amplitude Threshold"
                type="number"
                value={values.vad_amplitude_threshold ?? "0.005"}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, vad_amplitude_threshold: v }))
                }
              />
              <TextField
                label="Min Silence (ms)"
                type="number"
                value={values.vad_min_silence_ms ?? "1200"}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, vad_min_silence_ms: v }))
                }
              />
              <TextField
                label="Speech Pad Pre (ms)"
                type="number"
                value={values.vad_speech_pad_pre_ms ?? "320"}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, vad_speech_pad_pre_ms: v }))
                }
              />
              <TextField
                label="Min Speech (ms)"
                type="number"
                value={values.vad_min_speech_ms ?? "50"}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, vad_min_speech_ms: v }))
                }
              />
              <TextField
                label="Max Speech (s)"
                type="number"
                value={values.vad_max_speech_s ?? "30.0"}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, vad_max_speech_s: v }))
                }
              />
              <TextField
                label="Stable Tail Words"
                type="number"
                value={values.stable_tail_words ?? "6"}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, stable_tail_words: v }))
                }
              />
              <TextField
                label="Prefill Min Words"
                type="number"
                value={values.prefill_min_words ?? "3"}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, prefill_min_words: v }))
                }
              />
              <TextField
                label="Prefill Divergence Threshold"
                type="number"
                value={values.prefill_divergence_threshold ?? "0.8"}
                onChange={(v) =>
                  setValues((prev) => ({ ...prev, prefill_divergence_threshold: v }))
                }
              />
            </div>
          </Section>

          {otherKeys.length > 0 ? (
            <Section title="Other Settings">
              <div className="grid gap-3 md:grid-cols-2">
                {otherKeys.map((key) => (
                  <TextField
                    key={key}
                    label={key}
                    value={values[key] ?? ""}
                    onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
                  />
                ))}
              </div>
            </Section>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-line-med px-5 py-3">
          {saveError ? (
            <p className="mr-auto self-center text-[11px] text-accent-red/90">{saveError}</p>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line-dark px-3 py-1.5 text-xs text-text-med hover:bg-line-med"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "flex items-center gap-2 rounded px-3 py-1.5 text-xs font-medium transition-all",
              saved
                ? "bg-accent-green text-text-norm"
                : "bg-accent-primary text-text-norm hover:bg-accent-primary",
              saving && "opacity-70"
            )}
            style={{
              backgroundColor: saved
                ? "var(--color-accent-green)"
                : "var(--color-accent-primary)",
            }}
          >
            <Save size={14} />
            {saved ? "Saved" : saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
