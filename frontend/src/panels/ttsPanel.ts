import type { PrimaryPanelRenderState } from "./types";
import { escapeHtml } from "./utils";
import { iconHtml } from "../icons";
import { getTtsEngineUiConfig, TTS_ENGINE_OPTIONS } from "../tts/engineRules";

export function renderTtsActions(): string {
  return `
    <button type="button" class="tool-action-btn" id="ttsStartBtn">Start</button>
    <button type="button" class="tool-action-btn" id="ttsRefreshBtn">Refresh</button>
  `;
}

export function renderTtsBody(state: PrimaryPanelRenderState): string {
  const tts = state.tts;
  const engineUi = getTtsEngineUiConfig(tts.engine);
  const voices = tts.voices.length ? tts.voices : [tts.engine === "kokoro" ? "af_heart" : "speaker_0"];
  const voiceMeta =
    tts.engine === "piper" && voices.length <= 1
      ? "Single-speaker model"
      : tts.engine === "piper"
      ? `${voices.length} speakers`
      : "Selected";
  const busy = tts.status === "busy";
  const engineLabel = engineUi.engineLabel;
  const engineHint = engineUi.engineHint;

  return `
    <div class="primary-pane-body">
      <div class="config-table tts-engine-table">
        <div class="config-row tts-config-row">
          <span class="config-key">Model</span>
          <span class="config-value">${tts.ready ? "Installed" : "Missing / Invalid"}</span>
          <span class="config-meta">${engineLabel}</span>
        </div>
        <div class="config-row tts-config-row">
          <label class="config-key" for="ttsEngineSelect">Engine</label>
          <span class="config-value">
              <select id="ttsEngineSelect" class="settings-select" ${busy ? "disabled" : ""}>
              ${TTS_ENGINE_OPTIONS
                .map((engine) => `<option value="${engine.value}" ${engine.value === tts.engine ? "selected" : ""}>${engine.label}</option>`)
                .join("")}
            </select>
          </span>
          <span class="config-meta">${tts.ready ? "Ready" : "Not Ready"}</span>
        </div>
      </div>

      <div class="config-table">
        <div class="config-row tts-config-row">
          <label class="config-key" for="ttsVoiceSelect">Voice</label>
          <span class="config-value">
            <select id="ttsVoiceSelect" class="settings-select" ${busy ? "disabled" : ""}>
              ${voices
                .map(
                  (voice) =>
                    `<option value="${escapeHtml(voice)}" ${
                      voice === tts.selectedVoice ? "selected" : ""
                    }>${escapeHtml(voice)}</option>`
                )
                .join("")}
            </select>
          </span>
          <span class="config-meta">${escapeHtml(voiceMeta)}</span>
        </div>
        <div class="config-row tts-config-row">
          <label class="config-key" for="ttsSpeedInput">Speed</label>
          <span class="config-value">
            <input id="ttsSpeedInput" type="number" min="0.5" max="2" step="0.05" value="${tts.speed.toFixed(2)}" ${busy ? "disabled" : ""} />
          </span>
          <span class="config-meta">0.5x - 2.0x</span>
        </div>
      </div>
      <div class="tts-compat-hint">${escapeHtml(engineHint)}</div>
      ${tts.lexiconStatus ? `<div class="tts-compat-hint">${escapeHtml(tts.lexiconStatus)}</div>` : ""}

      <div class="config-table" style="margin-top: 12px;">
        <div class="config-row tts-config-row">
          <span class="config-key">Model Path</span>
          <span class="config-value tts-path-cell">
            <span class="tts-path-text">${escapeHtml(tts.modelPath || "(unset)")}</span>
            <button
              type="button"
              class="tts-model-browse-btn"
              id="ttsModelBrowseBtn"
              aria-label="Browse TTS model path"
              title="Browse TTS model path"
              ${busy ? "disabled" : ""}
            >
              ${iconHtml("folder-open", { size: 16, tone: "dark", label: "Browse TTS model path" })}
            </button>
          </span>
          <span class="config-meta">${tts.modelPath ? "OK" : "Missing"}</span>
        </div>
      </div>

      <div class="config-table" style="margin-top: 12px;">
        <div class="config-row tts-config-row tts-test-row">
          <label class="config-key" for="ttsTestTextInput">Test Text</label>
          <span class="config-value">
            <textarea id="ttsTestTextInput" class="tts-test-input" rows="1" ${busy ? "disabled" : ""}>${escapeHtml(tts.testText)}</textarea>
          </span>
          <span class="config-meta">
            <button type="button" class="tool-action-btn" id="ttsSpeakBtn" ${busy ? "disabled" : ""}>Speak</button>
          </span>
        </div>
      </div>

      <div class="config-table" style="margin-top: 12px;">
        <div class="config-row tts-config-row">
          <span class="config-key">Last Audio</span>
          <span class="config-value">${
            tts.lastBytes === null ? "None" : `${tts.lastBytes} bytes`
          }</span>
          <span class="config-meta">${
            tts.lastSampleRate === null ? "-" : `${tts.lastSampleRate} Hz`
          }</span>
        </div>
        <div class="config-row tts-config-row">
          <span class="config-key">Last Duration</span>
          <span class="config-value">${
            tts.lastDurationMs === null ? "-" : `${tts.lastDurationMs} ms`
          }</span>
          <span class="config-meta">${tts.selectedVoice || "-"}</span>
        </div>
      </div>
    </div>
  `;
}
