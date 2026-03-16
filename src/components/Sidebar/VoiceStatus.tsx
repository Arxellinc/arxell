import { useState, useEffect } from "react";
import { RefreshCw, Play, ChevronDown, ChevronRight } from "lucide-react";
import {
  checkVoiceEndpoints,
  settingsSet,
  settingsGetAll,
  ttsSpeak,
  checkTtsEngines,
  checkSttEngines,
  listWhisperModels,
  listTtsVoices,
} from "../../lib/tauri";
import type { VoiceEndpointStatus, TtsEngineStatus, SttEngineStatus } from "../../lib/tauri";
import { useVoiceStore } from "../../store/voiceStore";
import { playAudioBytes } from "../../lib/voice";
import { cn } from "../../lib/utils";
import { VadSettings } from "./VadSettings";

type TtsEngine = "kokoro" | "external";
type SttEngine = "whisper_rs" | "external";

/** Extract a short human name from a whisper model filename.
 *  "ggml-base-q8_0.bin" → "base"
 *  "ggml-tiny.en-q8_0.bin" → "tiny"
 *  "ggml-large-v3-turbo-q5_0.bin" → "large-v3-turbo"
 */
export function whisperModelName(path: string): string {
  const file = path.split("/").pop() ?? path;
  // strip ggml- prefix, .en locale, quantization suffix (-qN_N or -fN), .bin
  return file
    .replace(/^ggml-/, "")
    .replace(/\.en(?=-|$)/, "")
    .replace(/-[qfQF]\d+_\d+/, "")
    .replace(/\.bin$/, "")
    || file;
}
type VadPresetKey = "default" | "responsive" | "quiet_room" | "noisy" | "long_form" | "custom";
type KokoroLanguageId =
  | "american_english"
  | "british_english"
  | "japanese"
  | "mandarin_chinese"
  | "spanish"
  | "french"
  | "hindi"
  | "italian"
  | "brazilian_portuguese";

interface VadPresetValues {
  vad_threshold: number;
  vad_min_silence_ms: number;
  vad_speech_pad_pre_ms: number;
  vad_min_speech_ms: number;
  vad_max_speech_s: number;
  vad_amplitude_threshold: number;
  vad_mode: "auto" | "onnx" | "amplitude";
}

const VAD_PRESETS: Record<Exclude<VadPresetKey, "custom">, { label: string; desc: string; values: VadPresetValues }> = {
  default: {
    label: "Default",
    desc: "Balanced settings for general use",
    values: {
      vad_threshold: 0.35, vad_min_silence_ms: 1200, vad_speech_pad_pre_ms: 150,
      vad_min_speech_ms: 50, vad_max_speech_s: 30.0, vad_amplitude_threshold: 0.005, vad_mode: "auto",
    },
  },
  responsive: {
    label: "Responsive",
    desc: "Short silence window — fast end-of-utterance for commands",
    values: {
      vad_threshold: 0.25, vad_min_silence_ms: 600, vad_speech_pad_pre_ms: 100,
      vad_min_speech_ms: 30, vad_max_speech_s: 20.0, vad_amplitude_threshold: 0.004, vad_mode: "auto",
    },
  },
  quiet_room: {
    label: "Quiet Room",
    desc: "High sensitivity for low-noise environments",
    values: {
      vad_threshold: 0.20, vad_min_silence_ms: 1000, vad_speech_pad_pre_ms: 200,
      vad_min_speech_ms: 40, vad_max_speech_s: 30.0, vad_amplitude_threshold: 0.002, vad_mode: "auto",
    },
  },
  noisy: {
    label: "Noisy Environment",
    desc: "Raised thresholds to suppress ambient noise triggers",
    values: {
      vad_threshold: 0.60, vad_min_silence_ms: 1500, vad_speech_pad_pre_ms: 150,
      vad_min_speech_ms: 100, vad_max_speech_s: 30.0, vad_amplitude_threshold: 0.015, vad_mode: "onnx",
    },
  },
  long_form: {
    label: "Long Form",
    desc: "Patient silence detection for dictation or monologue",
    values: {
      vad_threshold: 0.35, vad_min_silence_ms: 2500, vad_speech_pad_pre_ms: 200,
      vad_min_speech_ms: 50, vad_max_speech_s: 90.0, vad_amplitude_threshold: 0.005, vad_mode: "auto",
    },
  },
};

const KOKORO_LANG_LABELS: Record<KokoroLanguageId, string> = {
  american_english: "American English",
  british_english: "British English",
  japanese: "Japanese",
  mandarin_chinese: "Mandarin Chinese",
  spanish: "Spanish",
  french: "French",
  hindi: "Hindi",
  italian: "Italian",
  brazilian_portuguese: "Brazilian Portuguese",
};

const PRIMARY_KOKORO_LANGUAGES: KokoroLanguageId[] = ["american_english", "british_english"];
const OTHER_KOKORO_LANGUAGES: KokoroLanguageId[] = [
  "japanese",
  "mandarin_chinese",
  "spanish",
  "french",
  "hindi",
  "italian",
  "brazilian_portuguese",
];

const KOKORO_VOICES_BY_LANGUAGE: Record<KokoroLanguageId, string[]> = {
  american_english: [
    "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore",
    "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky", "am_adam",
    "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx",
    "am_puck", "am_santa",
  ],
  british_english: [
    "bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable",
    "bm_george", "bm_lewis",
  ],
  japanese: ["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo"],
  mandarin_chinese: [
    "zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi", "zm_yunjian",
    "zm_yunxi", "zm_yunxia", "zm_yunyang",
  ],
  spanish: ["ef_dora", "em_alex", "em_santa"],
  french: ["ff_siwis"],
  hindi: ["hf_alpha", "hf_beta"],
  italian: ["if_sara", "if_nicola"],
  brazilian_portuguese: ["pf_dora", "pm_alex", "pm_santa"],
};

const KOKORO_VOICE_TO_LANGUAGE: Record<string, KokoroLanguageId> = Object.entries(KOKORO_VOICES_BY_LANGUAGE)
  .reduce<Record<string, KokoroLanguageId>>((acc, [language, voices]) => {
    for (const voice of voices) {
      acc[voice] = language as KokoroLanguageId;
    }
    return acc;
  }, {});

function getKokoroLanguageByVoice(voice: string): KokoroLanguageId {
  return KOKORO_VOICE_TO_LANGUAGE[voice] ?? "american_english";
}

function getKokoroVoicesForLanguage(
  language: KokoroLanguageId,
  discoveredVoices: string[],
): string[] {
  if (discoveredVoices.length === 0) {
    return [...KOKORO_VOICES_BY_LANGUAGE[language]];
  }
  return discoveredVoices.filter((voice) => getKokoroLanguageByVoice(voice) === language);
}

export function VoiceStatus() {
  const [status, setStatus] = useState<VoiceEndpointStatus | null>(null);
  const [ttsEngines, setTtsEngines] = useState<TtsEngineStatus | null>(null);
  const [sttEngines, setSttEngines] = useState<SttEngineStatus | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "browser" | "fail" | null>(null);

  // STT settings
  const [sttEngine, setSttEngine] = useState<SttEngine>("whisper_rs");
  const [sttUrl, setSttUrl] = useState("");
  const [whisperRsModelPath, setWhisperRsModelPath] = useState("");
  const [whisperRsLanguage, setWhisperRsLanguage] = useState("en");
  const [whisperRsModels, setWhisperRsModels] = useState<string[]>([]);

  // TTS settings
  const [ttsEngine, setTtsEngine] = useState<TtsEngine>("kokoro");
  const [ttsUrl, setTtsUrl] = useState("");
  const [ttsVoice, setTtsVoice] = useState("alloy");
  const [kokoroModelPath, setKokoroModelPath] = useState("");
  const [kokoroVoicesPath, setKokoroVoicesPath] = useState("");
  const [kokoroVoice, setKokoroVoice] = useState("af_heart");
  const [kokoroLanguage, setKokoroLanguage] = useState<KokoroLanguageId>("american_english");
  const [availableTtsVoices, setAvailableTtsVoices] = useState<string[]>([]);
  const [isLoadingTtsVoices, setIsLoadingTtsVoices] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(true);
  const [showTtsVoiceSettings, setShowTtsVoiceSettings] = useState(false);
  const [vadPreset, setVadPreset] = useState<VadPresetKey>("default");
  // Incrementing this forces VadSettings to remount and reload from the DB
  // after a preset is applied.
  const [vadKey, setVadKey] = useState(0);

  const {
    setSttModel: setStoreSttModel,
    setTtsEngine: setStoreTtsEngine,
    setSttLoading: setStoreSttLoading,
    setTtsLoading: setStoreTtsLoading,
  } = useVoiceStore();

  useEffect(() => {
    loadSettings();
    checkAll();
  }, []);

  const loadSettings = async () => {
    try {
      const all = await settingsGetAll();
      const rawSttEng = all["stt_engine"] ?? "whisper_rs";
      // migrate legacy "whisper" (python) → "whisper_rs"
      const sttEng = (rawSttEng === "whisper" ? "whisper_rs" : rawSttEng) as SttEngine;
      const rawTtsEng = all["tts_engine"] ?? "kokoro";
      const ttsEng = (["kokoro", "external"].includes(rawTtsEng) ? rawTtsEng : "kokoro") as TtsEngine;
      setSttEngine(sttEng);
      setSttUrl(all["stt_url"] ?? "");
      const rsModelPath = all["whisper_rs_model_path"] ?? "";
      setWhisperRsModelPath(rsModelPath);
      setWhisperRsLanguage(all["whisper_rs_language"] ?? "en");
      // Scan the directory containing the configured model for all .bin files
      const rsDir = rsModelPath.includes("/")
        ? rsModelPath.substring(0, rsModelPath.lastIndexOf("/"))
        : "";
      if (rsDir) {
        listWhisperModels(rsDir)
          .then(setWhisperRsModels)
          .catch(() => {});
      } else {
        setWhisperRsModels([]);
      }
      setTtsEngine(ttsEng);
      setTtsUrl(all["tts_url"] ?? "");
      setTtsVoice(all["tts_voice"] ?? "alloy");
      setKokoroModelPath(all["kokoro_model_path"] ?? "");
      setKokoroVoicesPath(all["kokoro_voices_path"] ?? "");
      const savedKokoroVoice = all["kokoro_voice"] ?? "af_heart";
      setKokoroVoice(savedKokoroVoice);
      setKokoroLanguage(getKokoroLanguageByVoice(savedKokoroVoice));
      setVadPreset((all["vad_preset"] as VadPresetKey) ?? "default");
      // Sync initial selection into the shared store so StatusBar can read it.
      setStoreSttModel(sttEng === "external" ? "external" : rsModelPath);
      setStoreTtsEngine(ttsEng);
    } catch (e) {
      console.error("Failed to load voice settings:", e);
    }
  };

  const checkAll = async () => {
    setIsChecking(true);
    try {
      const [endpointResult, ttsResult, sttResult] = await Promise.allSettled([
        checkVoiceEndpoints(),
        checkTtsEngines(),
        checkSttEngines(),
      ]);
      if (endpointResult.status === "fulfilled") setStatus(endpointResult.value);
      if (ttsResult.status === "fulfilled") setTtsEngines(ttsResult.value);
      if (sttResult.status === "fulfilled") setSttEngines(sttResult.value);
    } finally {
      setIsChecking(false);
    }
  };

  const handleSave = async () => {
    await settingsSet("stt_engine", sttEngine);
    await settingsSet("stt_url", sttUrl);
    await settingsSet("whisper_rs_model_path", whisperRsModelPath);
    await settingsSet("whisper_rs_language", whisperRsLanguage);
    // Update store so StatusBar reflects the new selection immediately
    setStoreSttModel(sttEngine === "external" ? "external" : whisperRsModelPath);
    await settingsSet("tts_engine", ttsEngine);
    await settingsSet("tts_url", ttsUrl);
    await settingsSet("tts_voice", ttsVoice);
    await settingsSet("kokoro_model_path", kokoroModelPath);
    await settingsSet("kokoro_voices_path", kokoroVoicesPath);
    await settingsSet("kokoro_voice", kokoroVoice);
    setIsEditing(false);
    checkAll();
  };

  const handleTestSpeaker = async () => {
    setIsTesting(true);
    setTestResult(null);
    const testPhrase = "Voice is online";
    try {
      const result = await ttsSpeak(testPhrase);
      if (result.audioBytes.length > 0) {
        await playAudioBytes(result.audioBytes);
        setTestResult("ok");
      } else {
        throw new Error("empty");
      }
    } catch {
      try {
        await new Promise<void>((resolve) => {
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(testPhrase);
          u.onend = () => resolve();
          u.onerror = () => resolve();
          window.speechSynthesis.speak(u);
        });
        setTestResult("browser");
      } catch {
        setTestResult("fail");
      }
    } finally {
      setIsTesting(false);
    }
  };

  // Quick-select key: model path (for whisper_rs) or "external"
  const sttModelKey = sttEngine === "external" ? "external" : whisperRsModelPath;

  const handleSttModelChange = async (key: string) => {
    setStoreSttLoading(true);
    if (key === "external") {
      setSttEngine("external");
      await settingsSet("stt_engine", "external");
      setStoreSttModel("external");
    } else {
      // key is a model path
      setSttEngine("whisper_rs");
      setWhisperRsModelPath(key);
      await settingsSet("stt_engine", "whisper_rs");
      await settingsSet("whisper_rs_model_path", key);
      setStoreSttModel(key);
    }
    try {
      const result = await checkSttEngines();
      setSttEngines(result);
    } catch {}
    setStoreSttLoading(false);
  };

  const handleTtsEngineChange = async (engine: TtsEngine) => {
    setStoreTtsLoading(true);
    setTtsEngine(engine);
    await settingsSet("tts_engine", engine);
    try {
      const result = await checkTtsEngines();
      setTtsEngines(result);
    } catch {}
    setStoreTtsEngine(engine);
    setStoreTtsLoading(false);
  };

  const loadTtsVoices = async () => {
    setIsLoadingTtsVoices(true);
    try {
      const voices = await listTtsVoices();
      setAvailableTtsVoices(voices);
    } catch {
      setAvailableTtsVoices([]);
    } finally {
      setIsLoadingTtsVoices(false);
    }
  };

  const handleTtsVoiceChange = async (voice: string) => {
    if (!voice) return;
    if (ttsEngine === "kokoro") {
      setKokoroVoice(voice);
      await settingsSet("kokoro_voice", voice);
      return;
    }
    if (ttsEngine === "external") {
      setTtsVoice(voice);
      await settingsSet("tts_voice", voice);
      return;
    }
  };

  const handleKokoroLanguageChange = async (language: KokoroLanguageId) => {
    setKokoroLanguage(language);
    const nextVoices = getKokoroVoicesForLanguage(language, availableTtsVoices);
    if (!nextVoices.includes(kokoroVoice) && nextVoices.length > 0) {
      const nextVoice = nextVoices[0];
      setKokoroVoice(nextVoice);
      await settingsSet("kokoro_voice", nextVoice);
    }
  };

  const handleVadPresetChange = async (key: VadPresetKey) => {
    setVadPreset(key);
    if (key === "custom") return;
    const { values } = VAD_PRESETS[key];
    await Promise.all([
      settingsSet("vad_threshold",           values.vad_threshold.toString()),
      settingsSet("vad_min_silence_ms",      values.vad_min_silence_ms.toString()),
      settingsSet("vad_speech_pad_pre_ms",   values.vad_speech_pad_pre_ms.toString()),
      settingsSet("vad_min_speech_ms",       values.vad_min_speech_ms.toString()),
      settingsSet("vad_max_speech_s",        values.vad_max_speech_s.toString()),
      settingsSet("vad_amplitude_threshold", values.vad_amplitude_threshold.toString()),
      settingsSet("vad_mode",                values.vad_mode),
      settingsSet("vad_preset",              key),
    ]);
    // Force VadSettings to remount so it reloads the freshly-saved values.
    setVadKey((k) => k + 1);
  };

  const toggleExpanded = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      if (!next) {
        // Prevent stale nested state from causing awkward reopen behavior.
        setIsEditing(false);
        setShowAdvanced(false);
      }
      return next;
    });
  };

  const expandModelSettings = () => {
    setShowModelSettings((prev) => {
      const next = !prev;
      if (next) setShowTtsVoiceSettings(false);
      return next;
    });
  };

  const expandTtsVoiceSettings = () => {
    setShowTtsVoiceSettings((prev) => {
      const next = !prev;
      if (next) setShowModelSettings(false);
      return next;
    });
  };

  useEffect(() => {
    if (!isExpanded) return;
    void loadTtsVoices();
  }, [isExpanded, ttsEngine]);

  const kokoroVoiceOptions = getKokoroVoicesForLanguage(kokoroLanguage, availableTtsVoices);
  kokoroVoiceOptions.sort();
  const selectedKokoroVoice = kokoroVoiceOptions.includes(kokoroVoice)
    ? kokoroVoice
    : (kokoroVoiceOptions[0] ?? "af_heart");
  const selectedTtsVoice =
    (ttsEngine === "kokoro")
      ? selectedKokoroVoice
      : ttsVoice;
  const voiceOptions = (ttsEngine === "kokoro")
    ? (kokoroVoiceOptions.length > 0 ? kokoroVoiceOptions : [selectedTtsVoice || "af_heart"])
    : (availableTtsVoices.length > 0 ? availableTtsVoices : [selectedTtsVoice || "default"]);

  return (
    <>
    <div className="border-b border-line-light">
      {/* Header row */}
      <div
        className="flex items-center gap-1.5 px-3 py-2 hover:bg-line-light transition-colors"
      >
        <button
          type="button"
          onClick={toggleExpanded}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "Collapse voice panel" : "Expand voice panel"}
        >
          {isExpanded ? (
            <ChevronDown size={11} className="text-text-dark flex-shrink-0" />
          ) : (
            <ChevronRight size={11} className="text-text-dark flex-shrink-0" />
          )}
          <span className="sidebar-header-title text-[10px] font-medium uppercase tracking-wider">
            Voice
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); checkAll(); }}
          disabled={isChecking}
          className="p-0.5 hover:bg-line-med rounded transition-colors"
          title="Re-check"
        >
          <RefreshCw size={10} className={cn("text-text-dark", isChecking && "animate-spin")} />
        </button>
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 space-y-2.5">

          <div className="space-y-1.5">
            <button
              type="button"
              onClick={expandModelSettings}
              className="sidebar-header-title ml-1 flex w-full items-center gap-1 text-[10px] font-medium transition-colors hover:opacity-80"
            >
              {showModelSettings ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              Models
            </button>
            {showModelSettings && (
              <div className="space-y-1 pl-2">
                <div className="flex items-center gap-2">
                  <label className="w-16 flex-shrink-0 text-[9px] text-text-dark whitespace-nowrap">STT</label>
                  <select
                    value={sttModelKey}
                    onChange={(e) => handleSttModelChange(e.target.value)}
                    className="min-w-0 flex-1 bg-transparent border border-line-light rounded px-1.5 py-0.5 text-[9px] text-text-med outline-none focus:border-accent-primary/50"
                  >
                    {whisperRsModels.length > 0
                      ? whisperRsModels.map((m) => (
                          <option key={m} value={m}>
                            {`Whisper.cpp — ${whisperModelName(m)}`}
                          </option>
                        ))
                      : (
                          <option value={whisperRsModelPath}>
                            {whisperRsModelPath
                              ? `Whisper.cpp — ${whisperModelName(whisperRsModelPath)}`
                              : "Whisper.cpp (no model found)"}
                          </option>
                        )
                    }
                    <option value="external">External HTTP</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-16 flex-shrink-0 text-[9px] text-text-dark whitespace-nowrap">TTS</label>
                  <select
                    value={ttsEngine}
                    onChange={(e) => handleTtsEngineChange(e.target.value as TtsEngine)}
                    className="min-w-0 flex-1 bg-transparent border border-line-light rounded px-1.5 py-0.5 text-[9px] text-text-med outline-none focus:border-accent-primary/50"
                  >
                    <option value="kokoro">Kokoro (Python)</option>
                    <option value="external">External HTTP</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="w-16 flex-shrink-0 text-[9px] text-text-dark whitespace-nowrap">VAD</label>
                  <select
                    value={vadPreset}
                    onChange={(e) => handleVadPresetChange(e.target.value as VadPresetKey)}
                    className="min-w-0 flex-1 bg-transparent border border-line-light rounded px-1.5 py-0.5 text-[9px] text-text-med outline-none focus:border-accent-primary/50"
                  >
                    {(Object.entries(VAD_PRESETS) as [Exclude<VadPresetKey, "custom">, typeof VAD_PRESETS[keyof typeof VAD_PRESETS]][]).map(
                      ([key, { label, desc }]) => (
                        <option key={key} value={key} title={desc}>{label}</option>
                      )
                    )}
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={expandTtsVoiceSettings}
                className="sidebar-header-title ml-1 flex items-center gap-1 text-[10px] font-medium transition-colors hover:opacity-80"
              >
                {showTtsVoiceSettings ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                TTS Voice Settings
              </button>
              {showTtsVoiceSettings && (
                <button
                  type="button"
                  onClick={() => void loadTtsVoices()}
                  disabled={isLoadingTtsVoices}
                  className="p-0.5 rounded transition-colors disabled:opacity-50"
                  title="Refresh voices"
                >
                  <RefreshCw size={9} className={cn("text-text-dark", isLoadingTtsVoices && "animate-spin")} />
                </button>
              )}
            </div>

            {showTtsVoiceSettings && (
              <div className="space-y-1 pl-2">
                <>
                    {ttsEngine === "kokoro" && (
                      <div className="flex items-center gap-2">
                        <label className="w-16 flex-shrink-0 text-[9px] text-text-dark whitespace-nowrap">Language</label>
                        <select
                          value={kokoroLanguage}
                          onChange={(e) => void handleKokoroLanguageChange(e.target.value as KokoroLanguageId)}
                          className="min-w-0 flex-1 bg-transparent border border-line-light rounded px-1.5 py-0.5 text-[9px] text-text-med outline-none focus:border-accent-primary/50"
                        >
                          {PRIMARY_KOKORO_LANGUAGES.map((language) => (
                            <option key={language} value={language}>{KOKORO_LANG_LABELS[language]}</option>
                          ))}
                          <optgroup label="Other Languages">
                            {OTHER_KOKORO_LANGUAGES.map((language) => (
                              <option key={language} value={language}>{KOKORO_LANG_LABELS[language]}</option>
                            ))}
                          </optgroup>
                        </select>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <label className="w-16 flex-shrink-0 text-[9px] text-text-dark whitespace-nowrap">Voice</label>
                      <select
                        value={selectedTtsVoice}
                        onChange={(e) => void handleTtsVoiceChange(e.target.value)}
                        disabled={isLoadingTtsVoices}
                        className="min-w-0 flex-1 bg-transparent border border-line-light rounded px-1.5 py-0.5 text-[9px] text-text-med outline-none focus:border-accent-primary/50 disabled:opacity-60"
                      >
                        {voiceOptions.map((voice) => (
                          <option key={voice} value={voice}>{voice}</option>
                        ))}
                      </select>
                    </div>
                  </>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="sidebar-header-title flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider transition-colors hover:opacity-80"
          >
            {showAdvanced ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
            Advanced
          </button>

          {showAdvanced && (
            <div className="space-y-2.5 pt-0.5">
              {/* Speaker test */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestSpeaker}
                  disabled={isTesting}
                  className="flex items-center gap-1.5 px-2 py-0.5 text-[9px] border border-line-light text-text-dark hover:text-text-med rounded transition-colors disabled:opacity-50"
                >
                  <Play size={9} />
                  {isTesting ? "Testing…" : "Test Speaker"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing((v) => !v)}
                  className="px-2 py-0.5 text-[9px] border border-line-light text-text-dark hover:text-text-med rounded transition-colors"
                >
                  {isEditing ? "Hide Config" : "Configure Voice"}
                </button>
                {testResult === "ok" && (
                  <span className="text-[9px] text-accent-green">TTS ✓</span>
                )}
                {testResult === "browser" && (
                  <span className="text-[9px] text-accent-gold/80">browser speech</span>
                )}
                {testResult === "fail" && (
                  <span className="text-[9px] text-accent-red/70">failed</span>
                )}
              </div>

              {isEditing && (
                <div className="space-y-3 border-l border-line-light pl-2">
                  <div className="space-y-1.5">
                    <p className="sidebar-header-title text-[9px] font-medium uppercase tracking-wider">STT (Speech → Text)</p>
                    <div className="flex gap-1">
                      {(["whisper_rs", "external"] as SttEngine[]).map((e) => (
                        <button
                          key={e}
                          onClick={() => setSttEngine(e)}
                          className={cn(
                            "flex-1 py-0.5 text-[9px] rounded border transition-colors",
                            sttEngine === e
                              ? "bg-accent-primary/20 border-accent-primary/40 text-accent-primary"
                              : "border-line-med text-text-dark hover:text-text-med hover:bg-line-light"
                          )}
                        >
                          {e === "whisper_rs" ? "Whisper.cpp" : "External API"}
                        </button>
                      ))}
                    </div>

                    {sttEngine === "whisper_rs" && (
                      <div className="space-y-1.5 pl-1 border-l border-line-light">
                        <div className="space-y-0.5">
                          <label className="text-[9px] text-text-dark">Model</label>
                          {whisperRsModels.length > 0 ? (
                            <select
                              value={whisperRsModelPath}
                              onChange={(e) => setWhisperRsModelPath(e.target.value)}
                              className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-[10px] text-text-norm outline-none focus:border-accent-primary/50 font-mono"
                            >
                              {whisperRsModels.map((m) => (
                                <option key={m} value={m}>
                                  {`Whisper.cpp — ${whisperModelName(m)}`}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={whisperRsModelPath}
                              onChange={(e) => setWhisperRsModelPath(e.target.value)}
                              placeholder="<app-data>/whisper/ggml-base-q8_0.bin"
                              className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-[10px] text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 font-mono"
                            />
                          )}
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[9px] text-text-dark">Language</label>
                          <input
                            type="text"
                            value={whisperRsLanguage}
                            onChange={(e) => setWhisperRsLanguage(e.target.value)}
                            placeholder="en"
                            className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-[10px] text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 font-mono"
                          />
                        </div>
                        {sttEngines !== null && !sttEngines.whisper_rs ? (
                          <p className="text-[8px] text-accent-red">
                            Not compiled in. Rebuild: <code>cargo tauri dev --features whisper-rs-stt</code>
                          </p>
                        ) : sttEngines !== null && sttEngines.whisper_rs ? (
                          <p className="text-[8px] text-accent-green">Ready — model loaded on first use</p>
                        ) : null}
                      </div>
                    )}

                    {sttEngine === "external" && (
                      <div className="space-y-0.5 pl-1 border-l border-line-light">
                        <label className="text-[9px] text-text-dark">STT URL</label>
                        <input
                          type="text"
                          value={sttUrl}
                          onChange={(e) => setSttUrl(e.target.value)}
                          placeholder="http://127.0.0.1:1234/v1/audio/transcriptions"
                          className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-[10px] text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 font-mono"
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <p className="sidebar-header-title text-[9px] font-medium uppercase tracking-wider">TTS (Text → Speech)</p>
                    <div className="flex gap-1">
                      {(["kokoro", "external"] as TtsEngine[]).map((e) => (
                        <button
                          key={e}
                          onClick={() => setTtsEngine(e)}
                          className={cn(
                            "flex-1 py-0.5 text-[9px] rounded border transition-colors",
                            ttsEngine === e
                              ? "bg-accent-primary/20 border-accent-primary/40 text-accent-primary"
                              : "border-line-med text-text-dark hover:text-text-med hover:bg-line-light"
                          )}
                        >
                          {e === "kokoro" ? "Kokoro (Python)" : "External"}
                        </button>
                      ))}
                    </div>

                    {ttsEngine === "kokoro" && (
                      <div className="space-y-1.5 pl-1 border-l border-line-light">
                        <div className="space-y-0.5">
                          <label className="text-[9px] text-text-dark">Model Path (.onnx)</label>
                          <input
                            type="text"
                            value={kokoroModelPath}
                            onChange={(e) => setKokoroModelPath(e.target.value)}
                            placeholder="<app-data>/kokoro/model_quantized.onnx"
                            className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-[10px] text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 font-mono"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[9px] text-text-dark">Voices Path (.bin)</label>
                          <input
                            type="text"
                            value={kokoroVoicesPath}
                            onChange={(e) => setKokoroVoicesPath(e.target.value)}
                            placeholder="<app-data>/kokoro/voices-v1.0.bin"
                            className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-[10px] text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 font-mono"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[9px] text-text-dark">Voice</label>
                          <input
                            type="text"
                            value={kokoroVoice}
                            onChange={(e) => setKokoroVoice(e.target.value)}
                            placeholder="af_heart"
                            className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-[10px] text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 font-mono"
                          />
                          <p className="text-[8px] text-text-dark">af_heart · af_bella · am_adam · bf_emma · …</p>
                        </div>
                      </div>
                    )}

                    {ttsEngine === "external" && (
                      <div className="space-y-0.5 pl-1 border-l border-line-light">
                        <label className="text-[9px] text-text-dark">TTS URL</label>
                        <input
                          type="text"
                          value={ttsUrl}
                          onChange={(e) => setTtsUrl(e.target.value)}
                          placeholder="http://127.0.0.1:1234/v1/audio/speech"
                          className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-[10px] text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 font-mono"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex gap-1 pt-0.5">
                    <button
                      onClick={handleSave}
                      className="flex-1 py-1 text-[10px] bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 rounded transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setIsEditing(false); loadSettings(); }}
                      className="px-2 py-1 text-[10px] text-text-dark hover:text-text-med hover:bg-line-light rounded transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      )}
    </div>
    {/* VadSettings integrated at the bottom of the Voice section, full-bleed.
        key={vadKey} forces a remount (and settings reload) after a preset is applied. */}
    {isExpanded && <VadSettings key={vadKey} />}
    </>
  );
}
