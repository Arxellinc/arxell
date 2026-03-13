import { create } from "zustand";
import type { VoiceState } from "../types";

export type PipelineState =
  | "idle"
  | "user_speaking"
  | "processing"
  | "agent_speaking"
  | "interrupted";

interface VoiceStore {
  state: VoiceState;
  amplitude: number;
  transcript: string | null;
  partialText: string | null; // interim transcription shown while speaking
  voiceMode: boolean;
  isSpeaking: boolean;
  error: string | null;
  useBrowserSR: boolean; // true when browser SpeechRecognition is handling STT

  // ── Pipeline state machine ───────────────────────────────────────────────
  pipelineState: PipelineState;
  agentSpeakingSince: number;
  setPipelineState: (s: PipelineState) => void;

  // ── Active voice model selection (shared between VoiceStatus & StatusBar) ─
  // sttModel: "whisper:<size>" | "external"
  sttModel: string;
  ttsEngine: string;
  sttLoading: boolean;
  ttsLoading: boolean;
  setSttModel: (m: string) => void;
  setTtsEngine: (e: string) => void;
  setSttLoading: (v: boolean) => void;
  setTtsLoading: (v: boolean) => void;

  // ── TTS audio control (for barge-in interruption) ────────────────────────
  stopCurrentAudio: (() => void) | null;
  setStopCurrentAudio: (fn: (() => void) | null) => void;

  // ── TTS lipsync state (driven by audio analysis + phoneme scheduler) ─────
  /** Real-time RMS amplitude of the TTS audio being played (0-1). */
  ttsAmplitude: number;
  setTtsAmplitude: (v: number) => void;
  /** Currently scheduled ARPAbet phoneme from the text-based phoneme scheduler. */
  activeViseme: string | null;
  setActiveViseme: (v: string | null) => void;
  /** How many ms early to fire phoneme visemes relative to audio position (default 50). */
  phonemeLead: number;
  setPhonemeLead: (v: number) => void;

  // ── Prefill/barge-in settings cache (loaded from DB, refreshed on save) ──
  bargeInEnabled: boolean;
  prefillEnabled: boolean;
  stableTailWords: number;
  prefillMinWords: number;
  prefillDivergenceThreshold: number;
  setPrefillConfig: (cfg: {
    bargeInEnabled?: boolean;
    prefillEnabled?: boolean;
    stableTailWords?: number;
    prefillMinWords?: number;
    prefillDivergenceThreshold?: number;
  }) => void;

  setState: (state: VoiceState) => void;
  setAmplitude: (level: number) => void;
  setTranscript: (text: string | null) => void;
  setPartialText: (text: string | null) => void;
  setVoiceMode: (on: boolean) => void;
  setIsSpeaking: (on: boolean) => void;
  setError: (msg: string | null) => void;
  setUseBrowserSR: (v: boolean) => void;
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  state: "idle",
  amplitude: 0,
  transcript: null,
  partialText: null,
  voiceMode: false,
  isSpeaking: false,
  error: null,
  useBrowserSR: false,

  sttModel: "",
  ttsEngine: "",
  sttLoading: false,
  ttsLoading: false,
  setSttModel: (sttModel) => set({ sttModel }),
  setTtsEngine: (ttsEngine) => set({ ttsEngine }),
  setSttLoading: (sttLoading) => set({ sttLoading }),
  setTtsLoading: (ttsLoading) => set({ ttsLoading }),

  pipelineState: "idle",
  agentSpeakingSince: 0,
  setPipelineState: (pipelineState) =>
    set((s) => ({
      pipelineState,
      agentSpeakingSince:
        pipelineState === "agent_speaking"
          ? (s.pipelineState === "agent_speaking" ? s.agentSpeakingSince : Date.now())
          : 0,
    })),

  stopCurrentAudio: null,
  setStopCurrentAudio: (stopCurrentAudio) => set({ stopCurrentAudio }),

  ttsAmplitude: 0,
  setTtsAmplitude: (ttsAmplitude) => set({ ttsAmplitude }),
  activeViseme: null,
  setActiveViseme: (activeViseme) => set({ activeViseme }),
  phonemeLead: 50,
  setPhonemeLead: (phonemeLead) => set({ phonemeLead }),

  bargeInEnabled: true,
  prefillEnabled: true,
  stableTailWords: 6,
  prefillMinWords: 3,
  prefillDivergenceThreshold: 0.8,
  setPrefillConfig: (cfg) => set((s) => ({
    bargeInEnabled:             cfg.bargeInEnabled             ?? s.bargeInEnabled,
    prefillEnabled:             cfg.prefillEnabled             ?? s.prefillEnabled,
    stableTailWords:            cfg.stableTailWords            ?? s.stableTailWords,
    prefillMinWords:            cfg.prefillMinWords            ?? s.prefillMinWords,
    prefillDivergenceThreshold: cfg.prefillDivergenceThreshold ?? s.prefillDivergenceThreshold,
  })),

  setState: (state) => set({ state }),
  setAmplitude: (amplitude) => set({ amplitude }),
  setTranscript: (transcript) => set({ transcript }),
  setPartialText: (partialText) => set({ partialText }),
  setVoiceMode: (voiceMode) => set({ voiceMode }),
  setIsSpeaking: (isSpeaking) => set({ isSpeaking }),
  setError: (error) => set({ error }),
  setUseBrowserSR: (useBrowserSR) => set({ useBrowserSR }),
}));
