import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { settingsGetAll, settingsSet } from "../../lib/tauri";
import { cn } from "../../lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VadParams {
  vad_threshold: number;
  vad_min_silence_ms: number;
  vad_speech_pad_pre_ms: number;
  vad_min_speech_ms: number;
  vad_max_speech_s: number;
  vad_amplitude_threshold: number;
  vad_mode: "auto" | "onnx" | "amplitude";
  prefill_enabled: boolean;
  barge_in_enabled: boolean;
  stable_tail_words: number;
  prefill_min_words: number;
  prefill_divergence_threshold: number;
}

const DEFAULTS: VadParams = {
  vad_threshold:               0.35,
  vad_min_silence_ms:          1200,
  vad_speech_pad_pre_ms:       150,
  vad_min_speech_ms:           50,
  vad_max_speech_s:            30.0,
  vad_amplitude_threshold:     0.005,
  vad_mode:                    "auto",
  prefill_enabled:             true,
  barge_in_enabled:            true,
  stable_tail_words:           6,
  prefill_min_words:           3,
  prefill_divergence_threshold: 0.8,
};

// ── Slider param descriptor ───────────────────────────────────────────────────

interface ParamSpec {
  key: keyof VadParams;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  recMin: number;
  recMax: number;
  unit: string;
  decimals: number;
}

const PARAMS: ParamSpec[] = [
  {
    key: "vad_threshold",
    label: "Speech Threshold",
    description: "Silero probability score above which a frame is classified as speech.",
    min: 0.05, max: 1.0, step: 0.01, recMin: 0.4, recMax: 0.7,
    unit: "", decimals: 2,
  },
  {
    key: "vad_min_silence_ms",
    label: "Silence Duration",
    description: "Continuous silence required to mark the end of an utterance.",
    min: 50, max: 3000, step: 10, recMin: 300, recMax: 1000,
    unit: "ms", decimals: 0,
  },
  {
    key: "vad_speech_pad_pre_ms",
    label: "Pre-speech Buffer",
    description: "Audio prepended before the speech onset from a rolling ring buffer, capturing the beginning of words.",
    min: 0, max: 500, step: 10, recMin: 50, recMax: 200,
    unit: "ms", decimals: 0,
  },
  {
    key: "vad_min_speech_ms",
    label: "Min Speech Duration",
    description: "Utterances shorter than this are discarded as noise or accidental triggers.",
    min: 0, max: 1000, step: 10, recMin: 50, recMax: 300,
    unit: "ms", decimals: 0,
  },
  {
    key: "vad_max_speech_s",
    label: "Max Speech Duration",
    description: "Utterance is force-ended and sent for transcription when this length is reached.",
    min: 5, max: 120, step: 1, recMin: 15, recMax: 45,
    unit: "s", decimals: 1,
  },
  {
    key: "vad_amplitude_threshold",
    label: "Amplitude Fallback",
    description: "RMS energy threshold used when the Silero ONNX model is unavailable.",
    min: 0.001, max: 0.05, step: 0.001, recMin: 0.002, recMax: 0.015,
    unit: "RMS", decimals: 3,
  },
];

// ── Slider component ──────────────────────────────────────────────────────────

function SliderParam({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec;
  value: number;
  onChange: (v: number) => void;
}) {
  const { min, max, step, recMin, recMax, unit, decimals, label, description } = spec;

  // Normalised positions for CSS custom properties
  const pct    = (value  - min) / (max - min);
  const recLo  = (recMin - min) / (max - min);
  const recHi  = (recMax - min) / (max - min);

  const handleTextChange = (raw: string) => {
    const n = parseFloat(raw);
    if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  return (
    <div className="space-y-1">
      {/* Label row */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] font-medium text-text-med">{label}</span>
        {unit && <span className="text-[8px] text-text-dark flex-shrink-0">{unit}</span>}
      </div>

      {/* Value + slider row */}
      <div className="flex items-center gap-2">
        {/* Literal value field — LEFT of slider */}
        <input
          type="number"
          value={value.toFixed(decimals)}
          min={min}
          max={max}
          step={step}
          onChange={(e) => handleTextChange(e.target.value)}
          className="w-[52px] flex-shrink-0 bg-line-light border border-line-med rounded px-1.5 py-0.5 text-[9px] text-text-med font-mono outline-none focus:border-accent-primary/50 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {/* Slider */}
        <div className="flex-1 relative py-1">
          <input
            type="range"
            className="vad-slider"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleSliderChange}
            style={{
              "--pct":    pct.toFixed(4),
              "--rec-lo": recLo.toFixed(4),
              "--rec-hi": recHi.toFixed(4),
            } as React.CSSProperties}
          />
          {/* Recommended-range tick marks below the track */}
          <div className="relative h-[3px] mt-0.5 pointer-events-none">
            {/* shaded zone */}
            <div
              className="absolute top-0 h-full bg-line-med rounded"
              style={{
                left:  `${recLo * 100}%`,
                width: `${(recHi - recLo) * 100}%`,
              }}
            />
            {/* left tick */}
            <div
              className="absolute top-0 h-[3px] w-px bg-line-dark"
              style={{ left: `${recLo * 100}%` }}
            />
            {/* right tick */}
            <div
              className="absolute top-0 h-[3px] w-px bg-line-dark"
              style={{ left: `${recHi * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-[8px] text-text-dark leading-snug">{description}</p>
    </div>
  );
}

// ── Prefill slider param descriptors ─────────────────────────────────────────

const PREFILL_PARAMS: ParamSpec[] = [
  {
    key: "stable_tail_words",
    label: "Stable Zone",
    description: "Words withheld from the trailing edge of partial transcripts before sending a warmup request — guards against mid-word corruption.",
    min: 1, max: 15, step: 1, recMin: 4, recMax: 8,
    unit: "words", decimals: 0,
  },
  {
    key: "prefill_min_words",
    label: "Min Words to Prefill",
    description: "Minimum stable-zone word count required before firing a KV-cache warmup request.",
    min: 1, max: 10, step: 1, recMin: 2, recMax: 5,
    unit: "words", decimals: 0,
  },
  {
    key: "prefill_divergence_threshold",
    label: "Divergence Tolerance",
    description: "Minimum word-prefix overlap ratio between the stable zone and the final transcript required to count as a cache hit.",
    min: 0.5, max: 1.0, step: 0.05, recMin: 0.7, recMax: 0.9,
    unit: "", decimals: 2,
  },
];

// ── Mode selector ─────────────────────────────────────────────────────────────

const VAD_MODES = [
  { value: "auto",      label: "Auto",      desc: "Use Silero ONNX, fall back to amplitude" },
  { value: "onnx",      label: "ONNX only", desc: "Require Silero model (still falls back if missing)" },
  { value: "amplitude", label: "Amplitude", desc: "RMS energy only — no ONNX model needed" },
] as const;

// ── Main component ────────────────────────────────────────────────────────────

export function VadSettings() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [params, setParams] = useState<VadParams>(DEFAULTS);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load current settings from DB
  useEffect(() => {
    settingsGetAll().then((all) => {
      setParams({
        vad_threshold:               parseFloat(all["vad_threshold"]               ?? "0.35"),
        vad_min_silence_ms:          parseFloat(all["vad_min_silence_ms"]          ?? "1200"),
        vad_speech_pad_pre_ms:       parseFloat(all["vad_speech_pad_pre_ms"]       ?? "150"),
        vad_min_speech_ms:           parseFloat(all["vad_min_speech_ms"]           ?? "50"),
        vad_max_speech_s:            parseFloat(all["vad_max_speech_s"]            ?? "30.0"),
        vad_amplitude_threshold:     parseFloat(all["vad_amplitude_threshold"]     ?? "0.005"),
        vad_mode:                    (all["vad_mode"] as VadParams["vad_mode"])     ?? "auto",
        prefill_enabled:             (all["prefill_enabled"]  ?? "true") === "true",
        barge_in_enabled:            (all["barge_in_enabled"] ?? "true") === "true",
        stable_tail_words:           parseFloat(all["stable_tail_words"]           ?? "6"),
        prefill_min_words:           parseFloat(all["prefill_min_words"]           ?? "3"),
        prefill_divergence_threshold: parseFloat(all["prefill_divergence_threshold"] ?? "0.8"),
      });
    }).catch(console.error);
  }, []);

  const update = useCallback(<K extends keyof VadParams>(key: K, val: VadParams[K]) => {
    setParams((p) => ({ ...p, [key]: val }));
    setDirty(true);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        settingsSet("vad_threshold",               params.vad_threshold.toString()),
        settingsSet("vad_min_silence_ms",          params.vad_min_silence_ms.toString()),
        settingsSet("vad_speech_pad_pre_ms",       params.vad_speech_pad_pre_ms.toString()),
        settingsSet("vad_min_speech_ms",           params.vad_min_speech_ms.toString()),
        settingsSet("vad_max_speech_s",            params.vad_max_speech_s.toString()),
        settingsSet("vad_amplitude_threshold",     params.vad_amplitude_threshold.toString()),
        settingsSet("vad_mode",                    params.vad_mode),
        settingsSet("prefill_enabled",             params.prefill_enabled.toString()),
        settingsSet("barge_in_enabled",            params.barge_in_enabled.toString()),
        settingsSet("stable_tail_words",           params.stable_tail_words.toString()),
        settingsSet("prefill_min_words",           params.prefill_min_words.toString()),
        settingsSet("prefill_divergence_threshold", params.prefill_divergence_threshold.toString()),
      ]);
      setDirty(false);
    } catch (e) {
      console.error("VAD settings save failed:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setParams(DEFAULTS);
    setDirty(true);
  };

  return (
    <div className="border-b border-line-light">
      {/* Header */}
      <div
        className="flex items-center gap-1.5 px-3 py-2 cursor-pointer hover:bg-line-light transition-colors"
        onClick={() => setIsExpanded((v) => !v)}
      >
        {isExpanded
          ? <ChevronDown size={11} className="text-text-dark flex-shrink-0" />
          : <ChevronRight size={11} className="text-text-dark flex-shrink-0" />}
        <span className="sidebar-header-title text-[10px] font-medium uppercase tracking-wider flex-1">
          VAD
        </span>
        {dirty && (
          <span className="w-1.5 h-1.5 rounded-full bg-accent-gold/70 flex-shrink-0" title="Unsaved changes" />
        )}
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-3">

          {/* Legend */}
          <div className="flex items-center gap-3 pt-0.5">
            <div className="flex items-center gap-1">
              <div className="w-5 h-0.5 bg-line-dark rounded" />
              <span className="text-[8px] text-text-dark">recommended range</span>
            </div>
          </div>

          {/* VAD Mode — segmented toggle */}
          <div className="space-y-1">
            <span className="text-[9px] font-medium text-text-med">Detection Backend</span>
            <div className="flex gap-1">
              {VAD_MODES.map((m) => (
                <button
                  key={m.value}
                  title={m.desc}
                  onClick={() => update("vad_mode", m.value)}
                  className={cn(
                    "flex-1 py-0.5 text-[8px] rounded border transition-colors leading-tight",
                    params.vad_mode === m.value
                      ? "bg-accent-primary/20 border-accent-primary/40 text-accent-primary"
                      : "border-line-med text-text-dark hover:text-text-med hover:bg-line-light"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-[8px] text-text-dark">
              {VAD_MODES.find((m) => m.value === params.vad_mode)?.desc}
            </p>
          </div>

          {/* Divider */}
          <div className="border-t border-line-light" />

          {/* Sliders */}
          <div className="space-y-3.5">
            {PARAMS.map((spec) => (
              <SliderParam
                key={spec.key}
                spec={spec}
                value={params[spec.key] as number}
                onChange={(v) => update(spec.key, v as VadParams[typeof spec.key])}
              />
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-line-light" />

          {/* Prefill & Barge-in */}
          <div className="space-y-2.5">
            {/* Section header */}
            <span className="sidebar-header-title text-[9px] font-medium uppercase tracking-wider">
              Prefill &amp; Barge-in
            </span>

            {/* Toggles row */}
            <div className="flex gap-2">
              {(["prefill_enabled", "barge_in_enabled"] as const).map((key) => {
                const label = key === "prefill_enabled" ? "Prefill" : "Barge-in";
                const desc  = key === "prefill_enabled"
                  ? "Send 1-token warmup requests during speech to prime the backend KV cache."
                  : "Interrupt TTS playback when the user starts speaking again.";
                const active = params[key];
                return (
                  <button
                    key={key}
                    title={desc}
                    onClick={() => update(key, !active)}
                    className={cn(
                      "flex-1 py-0.5 text-[8px] rounded border transition-colors leading-tight",
                      active
                        ? "bg-accent-primary/20 border-accent-primary/40 text-accent-primary"
                        : "border-line-med text-text-dark hover:text-text-med hover:bg-line-light"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Prefill sliders — only visible when prefill is enabled */}
            {params.prefill_enabled && (
              <div className="space-y-3.5">
                {PREFILL_PARAMS.map((spec) => (
                  <SliderParam
                    key={spec.key}
                    spec={spec}
                    value={params[spec.key] as number}
                    onChange={(v) => update(spec.key, v as VadParams[typeof spec.key])}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Action row */}
          <div className="flex gap-1.5 pt-1">
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className={cn(
                "flex-1 py-1 text-[9px] rounded transition-colors",
                dirty
                  ? "bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
                  : "bg-line-light text-text-dark cursor-default"
              )}
            >
              {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
            <button
              onClick={handleReset}
              title="Reset to defaults"
              className="flex items-center gap-1 px-2 py-1 text-[9px] text-text-dark hover:text-text-med hover:bg-line-light rounded transition-colors"
            >
              <RotateCcw size={9} />
              Defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
