import { escapeHtml } from "./utils";
import type { PrimaryPanelRenderState } from "./types";

export function renderTtsActions(state: PrimaryPanelRenderState): string {
  return `
    <button type="button" class="tool-action-btn" id="ttsCheckBtn">Check</button>
    <button type="button" class="tool-action-btn" id="ttsTestBtn" ${
      state.ttsBusy ? "disabled" : ""
    }>Speak Test</button>
  `;
}

export function renderTtsBody(state: PrimaryPanelRenderState): string {
  const status = state.ttsEngineStatus;
  const readyLabel = status ? (status.ready ? "Ready" : "Not Ready") : "Unknown";
  const reason = status?.reason?.trim() || state.ttsLastError || "None";
  const voiceOptions = state.ttsVoices.length ? state.ttsVoices : ["af_heart"];
  const selected = state.ttsSelectedVoice || "af_heart";
  const languageOptions = ["en-us", "en-gb", "en"];
  return `
    <div class="primary-pane-body">
      <div class="config-table">
        <div class="config-row">
          <span class="config-key">Auto Speak</span>
          <span class="config-value">${
            state.ttsEnabled ? "Speak assistant responses automatically." : "Do not auto-play responses."
          }</span>
          <span class="config-meta">
            <button type="button" class="tool-action-btn" id="ttsToggleBtn">${
              state.ttsEnabled ? "Turn Off" : "Turn On"
            }</button>
          </span>
        </div>
      </div>
      <h3 class="config-section-title">Settings</h3>
      <div class="config-table">
        <div class="config-row">
          <span class="config-key">Engine</span>
          <span class="config-value">Kokoro Quantized ONNX</span>
          <span class="config-meta">${escapeHtml(readyLabel)}</span>
        </div>
        <div class="config-row">
          <span class="config-key">Voice</span>
          <span class="config-value">
            <select id="ttsVoiceSelect" class="tool-action-btn tts-voice-select" ${state.ttsBusy ? "disabled" : ""}>
              ${voiceOptions
                .map(
                  (voice) =>
                    `<option value="${escapeHtml(voice)}" ${
                      voice === selected ? "selected" : ""
                    }>${escapeHtml(voice)}</option>`
                )
                .join("")}
            </select>
          </span>
          <span class="config-meta">Available</span>
        </div>
        <div class="config-row">
          <span class="config-key">Language</span>
          <span class="config-value">
            <select id="ttsLanguageSelect" class="tool-action-btn tts-voice-select" ${state.ttsBusy ? "disabled" : ""}>
              ${languageOptions
                .map(
                  (lang) =>
                    `<option value="${lang}" ${
                      lang === state.ttsLanguage ? "selected" : ""
                    }>${lang}</option>`
                )
                .join("")}
            </select>
          </span>
          <span class="config-meta">G2P</span>
        </div>
        <div class="config-row">
          <span class="config-key">Chunk Size</span>
          <span class="config-value">
            <input id="ttsChunkMaxCharsInput" class="tool-action-btn tts-setting-input" type="number" min="80" max="2000" step="20" value="${state.ttsChunkMaxChars}" />
          </span>
          <span class="config-meta">chars</span>
        </div>
        <div class="config-row">
          <span class="config-key">Speed</span>
          <span class="config-value">
            <input id="ttsSpeedInput" class="tool-action-btn tts-setting-input" type="number" min="0.7" max="1.4" step="0.05" value="${state.ttsSpeed}" />
          </span>
          <span class="config-meta">1.00x</span>
        </div>
        <div class="config-row">
          <span class="config-key">Chunk Pause</span>
          <span class="config-value">
            <input id="ttsChunkPauseMsInput" class="tool-action-btn tts-setting-input" type="number" min="0" max="2000" step="25" value="${state.ttsChunkPauseMs}" />
          </span>
          <span class="config-meta">ms</span>
        </div>
        <div class="config-row">
          <span class="config-key">Output</span>
          <span class="config-value">16-bit PCM / 24 kHz</span>
          <span class="config-meta">Realtime</span>
        </div>
        <div class="config-row">
          <span class="config-key">Last Error</span>
          <span class="config-value">${escapeHtml(reason)}</span>
          <span class="config-meta">${state.ttsBusy ? "Working" : "Idle"}</span>
        </div>
      </div>
    </div>
  `;
}
