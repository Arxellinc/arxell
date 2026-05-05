export type TtsEngine = "kokoro" | "piper" | "matcha" | "kitten" | "pocket";

export interface TtsEngineOption {
  value: TtsEngine;
  label: string;
}

export interface TtsEngineUiConfig {
  engineLabel: string;
  engineHint: string;
}

export interface TtsEngineResettableState {
  status: "idle" | "ready" | "busy" | "error";
  message: string | null;
  engineId: string;
  engine: TtsEngine;
  ready: boolean;
  modelPath: string;
  voices: string[];
  selectedVoice: string;
  speed: number;
  lexiconStatus?: string;
  testText: string;
  lastDurationMs: number | null;
  lastBytes: number | null;
  lastSampleRate: number | null;
}

export const TTS_ENGINE_OPTIONS: readonly TtsEngineOption[] = [
  { value: "kokoro", label: "Kokoro" },
  { value: "piper", label: "Piper (VITS)" },
  { value: "matcha", label: "Matcha" },
  { value: "kitten", label: "KittenTTS" },
  { value: "pocket", label: "PocketTTS" }
] as const;

export function defaultVoiceForEngine(engine: TtsEngine): string {
  return engine === "kokoro" ? "af_heart" : "speaker_0";
}

export function defaultVoicesForEngine(engine: TtsEngine): string[] {
  return [defaultVoiceForEngine(engine)];
}

export function getTtsEngineUiConfig(engine: TtsEngine): TtsEngineUiConfig {
  if (engine === "piper") {
    return {
      engineLabel: "Piper",
      engineHint: "Piper voice output is bundled with the app."
    };
  }
  if (engine === "matcha") {
    return {
      engineLabel: "Matcha",
      engineHint: "Matcha voice output is bundled with the app."
    };
  }
  if (engine === "kitten") {
    return {
      engineLabel: "KittenTTS",
      engineHint: "Kitten voice output is bundled with the app."
    };
  }
  if (engine === "pocket") {
    return {
      engineLabel: "PocketTTS",
      engineHint: "PocketTTS voice output is bundled with the app."
    };
  }
  return {
    engineLabel: "Kokoro",
    engineHint: "Kokoro model is bundled with the app."
  };
}

export function resetTtsStateForEngine<T extends TtsEngineResettableState>(
  tts: T,
  engine: TtsEngine
): T {
  const voices = defaultVoicesForEngine(engine);
  return {
    ...tts,
    status: "idle",
    message: null,
    engine,
    ready: false,
    modelPath: "",
    voices,
    selectedVoice: voices[0] ?? defaultVoiceForEngine(engine),
    speed: 1,
    lexiconStatus: "",
    lastBytes: null,
    lastDurationMs: null,
    lastSampleRate: null
  };
}
