export type SafeSettingKind = "boolean" | "number" | "enum";

export type SafeSettingKey =
  | "prefill_enabled"
  | "barge_in_enabled"
  | "vad_mode"
  | "vad_min_silence_ms"
  | "vad_end_silence_grace_ms"
  | "stable_tail_words"
  | "prefill_min_words"
  | "prefill_divergence_threshold";

export interface SafeSettingDefinition {
  key: SafeSettingKey;
  label: string;
  kind: SafeSettingKind;
  defaultValue: string;
  description: string;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
}

export const SAFE_SETTINGS: readonly SafeSettingDefinition[] = [
  {
    key: "prefill_enabled",
    label: "Prefill",
    kind: "boolean",
    defaultValue: "true",
    description: "Allow prefill warmup before final submit.",
  },
  {
    key: "barge_in_enabled",
    label: "Barge-in",
    kind: "boolean",
    defaultValue: "true",
    description: "Interrupt TTS when user starts speaking.",
  },
  {
    key: "vad_mode",
    label: "VAD Mode",
    kind: "enum",
    defaultValue: "auto",
    options: ["auto", "onnx", "amplitude"],
    description: "Voice activity detection backend strategy.",
  },
  {
    key: "vad_min_silence_ms",
    label: "VAD Silence (ms)",
    kind: "number",
    defaultValue: "1200",
    min: 250,
    max: 4000,
    step: 50,
    description: "Silence window needed before finalizing speech.",
  },
  {
    key: "vad_end_silence_grace_ms",
    label: "VAD End Grace (ms)",
    kind: "number",
    defaultValue: "320",
    min: 80,
    max: 1500,
    step: 20,
    description: "Additional hold-off at end of speech to reduce cutoffs.",
  },
  {
    key: "stable_tail_words",
    label: "Stable Tail Words",
    kind: "number",
    defaultValue: "6",
    min: 2,
    max: 16,
    step: 1,
    description: "How many stable trailing words trigger partial prefill.",
  },
  {
    key: "prefill_min_words",
    label: "Prefill Min Words",
    kind: "number",
    defaultValue: "3",
    min: 1,
    max: 16,
    step: 1,
    description: "Minimum word count before speculative prefill starts.",
  },
  {
    key: "prefill_divergence_threshold",
    label: "Prefill Divergence",
    kind: "number",
    defaultValue: "0.8",
    min: 0.1,
    max: 2,
    step: 0.05,
    description: "Allowed drift before prefill prefix is replaced.",
  },
];

const SAFE_SETTING_MAP: Record<SafeSettingKey, SafeSettingDefinition> = Object.fromEntries(
  SAFE_SETTINGS.map((s) => [s.key, s])
) as Record<SafeSettingKey, SafeSettingDefinition>;

export function isSafeSettingKey(value: string): value is SafeSettingKey {
  return value in SAFE_SETTING_MAP;
}

export function getSafeSettingDefinition(key: SafeSettingKey): SafeSettingDefinition {
  return SAFE_SETTING_MAP[key];
}

export function sanitizeSafeSettingValue(
  key: SafeSettingKey,
  rawValue: string
): { ok: true; value: string } | { ok: false; error: string } {
  const def = SAFE_SETTING_MAP[key];
  const trimmed = rawValue.trim();

  if (def.kind === "boolean") {
    const normalized = trimmed.toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return { ok: true, value: "true" };
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return { ok: true, value: "false" };
    }
    return { ok: false, error: `${key} expects a boolean value` };
  }

  if (def.kind === "enum") {
    const normalized = trimmed.toLowerCase();
    if (!def.options?.includes(normalized)) {
      return { ok: false, error: `${key} must be one of: ${(def.options ?? []).join(", ")}` };
    }
    return { ok: true, value: normalized };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: `${key} expects a numeric value` };
  }
  if (def.min !== undefined && parsed < def.min) {
    return { ok: false, error: `${key} must be >= ${def.min}` };
  }
  if (def.max !== undefined && parsed > def.max) {
    return { ok: false, error: `${key} must be <= ${def.max}` };
  }

  return { ok: true, value: String(parsed) };
}

export function parseSafeSettingValue(key: SafeSettingKey, value: string): string {
  const normalized = sanitizeSafeSettingValue(key, value);
  return normalized.ok ? normalized.value : getSafeSettingDefinition(key).defaultValue;
}

export function pickSafeSettings(settings: Record<string, string>): Record<SafeSettingKey, string> {
  const out = {} as Record<SafeSettingKey, string>;
  for (const def of SAFE_SETTINGS) {
    const raw = settings[def.key] ?? def.defaultValue;
    out[def.key] = parseSafeSettingValue(def.key, raw);
  }
  return out;
}
