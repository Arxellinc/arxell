export type TtsEngine = "kokoro" | "piper" | "matcha" | "kitten" | "pocket";

export interface TtsEngineOption {
  value: TtsEngine;
  label: string;
}

export interface KokoroBundleOption {
  label: string;
  url: string;
  sizeLabel: string;
}

export interface TtsEngineUiConfig {
  engineLabel: string;
  engineHint: string;
  trustedSourceUrl: string;
  downloadActionLabel: string;
  secondaryLabel: string;
  secondaryRequired: boolean;
  showSecondaryPath: boolean;
  kokoroBundles?: KokoroBundleOption[];
}

export const KOKORO_BUNDLE_OPTIONS: readonly KokoroBundleOption[] = [
  {
    label: "v1.1 Multi-Lang (~109 MB)",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2",
    sizeLabel: "109 MB"
  },
  {
    label: "v0.19 English (~128 MB)",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-en-v0_19.tar.bz2",
    sizeLabel: "128 MB"
  }
] as const;

export interface TtsEngineResettableState {
  status: "idle" | "ready" | "busy" | "error";
  message: string | null;
  engineId: string;
  engine: TtsEngine;
  ready: boolean;
  runtimeArchivePresent: boolean;
  availableModelPaths: string[];
  modelPath: string;
  secondaryPath: string;
  voicesPath: string;
  tokensPath: string;
  dataDir: string;
  pythonPath: string;
  scriptPath: string;
  voices: string[];
  selectedVoice: string;
  speed: number;
  lexiconStatus?: string;
  testText: string;
  lastDurationMs: number | null;
  lastBytes: number | null;
  lastSampleRate: number | null;
  downloadReceivedBytes?: number | null;
  downloadTotalBytes?: number | null;
  downloadPercent?: number | null;
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
      engineHint: "Piper uses model + tokens + espeak-ng-data. Lexicon is optional and inferred when possible.",
      trustedSourceUrl: "https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/vits.html",
      downloadActionLabel: "Open Trusted Source",
      secondaryLabel: "Lexicon Path",
      secondaryRequired: false,
      showSecondaryPath: false
    };
  }
  if (engine === "matcha") {
    return {
      engineLabel: "Matcha",
      engineHint: "Matcha expects model + vocoder + tokens + espeak-ng-data.",
      trustedSourceUrl: "https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/matcha.html",
      downloadActionLabel: "Open Trusted Source",
      secondaryLabel: "Vocoder Path",
      secondaryRequired: true,
      showSecondaryPath: true
    };
  }
  if (engine === "kitten") {
    return {
      engineLabel: "KittenTTS",
      engineHint: "Kitten expects model + voices + tokens + espeak-ng-data.",
      trustedSourceUrl: "https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/index.html",
      downloadActionLabel: "Open Trusted Source",
      secondaryLabel: "Voices Path",
      secondaryRequired: true,
      showSecondaryPath: true
    };
  }
  if (engine === "pocket") {
    return {
      engineLabel: "PocketTTS",
      engineHint: "PocketTTS expects lm_main + lm_flow + encoder + decoder + text_conditioner + vocab.json + token_scores.json in one bundle folder.",
      trustedSourceUrl: "https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/index.html",
      downloadActionLabel: "Open Trusted Source",
      secondaryLabel: "Bundle Path",
      secondaryRequired: false,
      showSecondaryPath: false
    };
  }
  return {
    engineLabel: "Kokoro",
    engineHint: "Kokoro expects model + voices + tokens + espeak-ng-data.",
    trustedSourceUrl: "https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models",
    downloadActionLabel: "Download Model Bundle",
    secondaryLabel: "Voices Path",
    secondaryRequired: true,
    showSecondaryPath: true,
    kokoroBundles: [...KOKORO_BUNDLE_OPTIONS]
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
    runtimeArchivePresent: false,
    availableModelPaths: [],
    modelPath: "",
    secondaryPath: "",
    voicesPath: "",
    tokensPath: "",
    dataDir: "",
    pythonPath: "",
    scriptPath: "",
    voices,
    selectedVoice: voices[0] ?? defaultVoiceForEngine(engine),
    speed: 1,
    lexiconStatus: "",
    lastBytes: null,
    lastDurationMs: null,
    lastSampleRate: null,
    downloadReceivedBytes: null,
    downloadTotalBytes: null,
    downloadPercent: null
  };
}
