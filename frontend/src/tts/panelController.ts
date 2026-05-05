import type { ChatIpcClient } from "../ipcClient";
import type { PrimaryPanelBindings, TtsState } from "../panels/types";
import { resetTtsStateForEngine, type TtsEngine } from "./engineRules";

type TtsBindingsSubset = Pick<PrimaryPanelBindings,
  | "onTtsRefresh"
  | "onTtsStart"
  | "onTtsSetVoice"
  | "onTtsSetEngine"
  | "onTtsSetSpeed"
  | "onTtsSetTestText"
  | "onTtsBrowseModelPath"
  | "onTtsSpeakTest"
  | "onTtsStop"
  | "onTtsSelfTest"
>;

export function createTtsPanelBindings(deps: {
  state: { tts: TtsState };
  getClient: () => ChatIpcClient | null;
  nextCorrelationId: () => string;
  refreshTtsState: () => Promise<void>;
  browseTtsModelPath: (currentValue: string) => Promise<string | null>;
  playTtsAudio: (audioBytes: number[], correlationId: string | null, originalText: string) => Promise<void>;
  stopTtsPlaybackLocal: () => void;
  formatTtsError: (error: unknown) => string;
  render: () => void;
}): TtsBindingsSubset {
  const { state } = deps;
  return {
    onTtsRefresh: async () => {
      const client = deps.getClient();
      if (!client) return;
      state.tts.status = "busy";
      state.tts.message = "Refreshing TTS status...";
      deps.render();
      try {
        await deps.refreshTtsState();
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `TTS refresh failed: ${deps.formatTtsError(error)}`;
      }
      deps.render();
    },
    onTtsStart: async () => {
      const client = deps.getClient();
      if (!client) return;
      state.tts.status = "busy";
      state.tts.message = `Starting ${state.tts.engine} TTS engine...`;
      deps.render();
      try {
        const response = await client.ttsSelfTest({
          correlationId: deps.nextCorrelationId()
        });
        await deps.refreshTtsState();
        state.tts.status = response.ok ? "ready" : "error";
        state.tts.message = response.ok
          ? `${state.tts.engine} TTS engine ready.`
          : response.message || `${state.tts.engine} TTS engine failed to start.`;
        state.tts.lastBytes = response.bytes;
        state.tts.lastDurationMs = response.durationMs;
        state.tts.lastSampleRate = response.sampleRate;
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `TTS start failed: ${deps.formatTtsError(error)}`;
      }
      deps.render();
    },
    onTtsSetVoice: async (voice: string) => {
      state.tts.selectedVoice = voice.trim() || state.tts.selectedVoice;
      const client = deps.getClient();
      if (!client) {
        deps.render();
        return;
      }
      try {
        await client.ttsSettingsSet({
          correlationId: deps.nextCorrelationId(),
          voice: state.tts.selectedVoice
        });
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Failed saving voice: ${String(error)}`;
      }
      deps.render();
    },
    onTtsSetEngine: async (engine: TtsEngine) => {
      state.tts = resetTtsStateForEngine(state.tts, engine);
      const client = deps.getClient();
      if (!client) {
        deps.render();
        return;
      }
      state.tts.status = "busy";
      state.tts.message = `Switching TTS engine to ${engine}...`;
      deps.render();
      try {
        await client.ttsSettingsSet({
          correlationId: deps.nextCorrelationId(),
          engine
        });
        await deps.refreshTtsState();
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Failed switching engine: ${deps.formatTtsError(error)}`;
      }
      deps.render();
    },
    onTtsSetSpeed: async (speed: number) => {
      const normalized = Math.max(0.5, Math.min(2, speed));
      state.tts.speed = normalized;
      const client = deps.getClient();
      if (!client) {
        deps.render();
        return;
      }
      try {
        await client.ttsSettingsSet({
          correlationId: deps.nextCorrelationId(),
          speed: normalized
        });
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Failed saving speed: ${String(error)}`;
      }
      deps.render();
    },
    onTtsSetTestText: async (text: string) => {
      state.tts.testText = text;
      deps.render();
    },
    onTtsBrowseModelPath: async () => {
      const selectedPath = await deps.browseTtsModelPath(state.tts.modelPath);
      if (!selectedPath) return;
      const client = deps.getClient();
      if (!client) {
        state.tts.modelPath = selectedPath;
        state.tts.message = `Selected model: ${selectedPath}`;
        deps.render();
        return;
      }
      state.tts.status = "busy";
      state.tts.message = "Saving TTS model path...";
      deps.render();
      try {
        await client.ttsSettingsSet({
          correlationId: deps.nextCorrelationId(),
          modelPath: selectedPath
        });
        await deps.refreshTtsState();
        state.tts.message = `Selected model: ${selectedPath}`;
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Failed setting model path: ${deps.formatTtsError(error)}`;
      }
      deps.render();
    },
    onTtsSpeakTest: async () => {
      const client = deps.getClient();
      if (!client) return;
      const text = state.tts.testText.trim();
      if (!text) {
        state.tts.status = "error";
        state.tts.message = "Enter text to speak.";
        deps.render();
        return;
      }
      state.tts.status = "busy";
      state.tts.message = "Synthesizing...";
      deps.render();
      try {
        const response = await client.ttsSpeak({
          correlationId: deps.nextCorrelationId(),
          text,
          voice: state.tts.selectedVoice,
          speed: state.tts.speed
        });
        state.tts.status = "ready";
        state.tts.message = `Spoke with ${response.voice}`;
        state.tts.selectedVoice = response.voice;
        state.tts.speed = response.speed;
        state.tts.lastBytes = response.audioBytes.length;
        state.tts.lastDurationMs = response.durationMs;
        state.tts.lastSampleRate = response.sampleRate;
        await deps.playTtsAudio(response.audioBytes, null, text);
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Speak failed: ${deps.formatTtsError(error)}`;
      }
      deps.render();
    },
    onTtsStop: async () => {
      deps.stopTtsPlaybackLocal();
      const client = deps.getClient();
      if (!client) {
        deps.render();
        return;
      }
      try {
        await client.ttsStop({ correlationId: deps.nextCorrelationId() });
        state.tts.status = state.tts.ready ? "ready" : "idle";
        state.tts.message = "Stopped.";
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Stop failed: ${String(error)}`;
      }
      deps.render();
    },
    onTtsSelfTest: async () => {
      const client = deps.getClient();
      if (!client) return;
      state.tts.status = "busy";
      state.tts.message = "Running self-test...";
      deps.render();
      try {
        const response = await client.ttsSelfTest({
          correlationId: deps.nextCorrelationId()
        });
        state.tts.status = response.ok ? "ready" : "error";
        state.tts.message = response.message;
        state.tts.lastBytes = response.bytes;
        state.tts.lastDurationMs = response.durationMs;
        state.tts.lastSampleRate = response.sampleRate;
      } catch (error) {
        state.tts.status = "error";
        state.tts.message = `Self-test failed: ${deps.formatTtsError(error)}`;
      }
      deps.render();
    }
  };
}
