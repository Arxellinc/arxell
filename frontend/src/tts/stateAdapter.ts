import type { TtsSettingsGetResponse, TtsStatusResponse } from "../contracts";
import type { ChatIpcClient } from "../ipcClient";
import type { TtsState } from "../panels/types";

export function applyTtsSnapshot(
  tts: TtsState,
  payload: {
    status: TtsStatusResponse;
    settings: TtsSettingsGetResponse;
    voices: { voices: string[]; selectedVoice: string };
  }
): void {
  const { status, settings, voices } = payload;
  tts.engineId = status.engineId;
  tts.engine = (status.engine as TtsState["engine"]) || "kokoro";
  tts.ready = status.ready;
  tts.modelPath = status.modelPath;
  tts.voices = voices.voices.length ? voices.voices : status.availableVoices;
  tts.selectedVoice = status.selectedVoice || voices.selectedVoice || settings.voice;
  tts.speed = settings.speed || status.speed || tts.speed;
  tts.lexiconStatus = status.lexiconStatus || "";
  tts.status = status.ready ? "ready" : "idle";
  tts.message = status.message;
}

export async function refreshTtsStateFromIpc(deps: {
  client: ChatIpcClient;
  tts: TtsState;
  nextCorrelationId: () => string;
}): Promise<void> {
  const [status, settings, voices] = await Promise.all([
    deps.client.ttsStatus({ correlationId: deps.nextCorrelationId() }),
    deps.client.ttsSettingsGet({ correlationId: deps.nextCorrelationId() }),
    deps.client.ttsListVoices({ correlationId: deps.nextCorrelationId() })
  ]);
  applyTtsSnapshot(deps.tts, { status, settings, voices });
}
