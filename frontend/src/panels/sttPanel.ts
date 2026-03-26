import type { PrimaryPanelRenderState } from "./types";
import { escapeHtml } from "./utils";

const DEFAULT_WHISPER_DOWNLOAD_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q8_0.bin?download=true";

export function renderSttActions(state: PrimaryPanelRenderState): string {
  return `
    <div class="tts-actions">
      <button type="button" class="tool-action-btn ${state.sttRunning ? "is-danger" : "is-success"}" id="sttToggleBtn">
        ${state.sttRunning ? "Stop Listening" : "Start Listening"}
      </button>
      <button type="button" class="tool-action-btn" id="sttRefreshBtn">Refresh</button>
    </div>
  `;
}

export function renderSttBody(state: PrimaryPanelRenderState): string {
  const statusText = state.sttReady
    ? state.sttRunning
      ? `Listening (${escapeHtml(state.sttState)})`
      : `Ready (${escapeHtml(state.sttState)})`
    : `Not ready (${escapeHtml(state.sttLastError || "model missing")})`;
  const modelOptions = state.sttModels.length
    ? state.sttModels
        .map((m) => {
          const selected = m.path === state.sttSelectedModelPath ? "selected" : "";
          const tag = m.isBundled ? "bundled" : "local";
          return `<option value="${escapeHtml(m.path)}" ${selected}>${escapeHtml(m.name)} (${m.sizeMb} MB, ${tag})</option>`;
        })
        .join("")
    : '<option value="">No models discovered</option>';
  const consoleLines = state.sttConsoleLines.length
    ? state.sttConsoleLines
        .slice(-80)
        .map((line) => `<div class="stt-console-line">${escapeHtml(line)}</div>`)
        .join("")
    : '<div class="stt-console-line stt-console-placeholder">No STT events yet.</div>';

  return `
    <div class="primary-pane-body">
      <div class="config-table">
        <div class="config-row">
          <span class="config-key">Engine</span>
          <span class="config-value">${escapeHtml(state.sttEngine)}</span>
          <span class="config-meta">${state.sttReady ? "Local" : "Unavailable"}</span>
        </div>
        <div class="config-row">
          <span class="config-key">Status</span>
          <span class="config-value">${statusText}</span>
          <span class="config-meta">${state.sttRunning ? "Active" : "Idle"}</span>
        </div>
        <div class="config-row">
          <span class="config-key">Active Model</span>
          <span class="config-value">${escapeHtml(state.sttModelPath || "(unresolved)")}</span>
          <span class="config-meta">Whisper.cpp</span>
        </div>
      </div>

      <div class="tts-settings">
        <label class="tts-setting">
          <span class="tts-setting-label">Model Selector</span>
          <select class="llama-input tts-voice-select" id="sttModelSelect">
            ${modelOptions}
          </select>
        </label>
        <div class="tts-setting">
          <span class="tts-setting-label">Model Downloader</span>
          <input
            id="sttModelUrlInput"
            class="llama-input tts-setting-input"
            type="text"
            value="${escapeHtml(DEFAULT_WHISPER_DOWNLOAD_URL)}"
            spellcheck="false"
          />
          <input
            id="sttModelFileNameInput"
            class="llama-input tts-setting-input"
            type="text"
            placeholder="Optional filename (e.g. ggml-base-q8_0.bin)"
            spellcheck="false"
          />
          <div class="tts-actions">
            <button type="button" class="tool-action-btn ${state.sttDownloadBusy ? "is-warning" : ""}" id="sttDownloadModelBtn" ${state.sttDownloadBusy ? "disabled" : ""}>
              ${state.sttDownloadBusy ? "Downloading..." : "Download Model"}
            </button>
            <button type="button" class="tool-action-btn" id="sttApplyModelBtn">Apply Selected</button>
          </div>
          <div class="config-meta">${escapeHtml(state.sttDownloadMessage || "Download to app_data/whisper and apply automatically.")}</div>
        </div>
      </div>

      <div class="tts-settings">
        <label class="tts-setting">
          <span class="tts-setting-label">Auto-submit transcript</span>
          <select class="llama-input tts-voice-select" id="sttAutoSubmitSelect">
            <option value="1" ${state.sttAutoSubmit ? "selected" : ""}>Enabled</option>
            <option value="0" ${!state.sttAutoSubmit ? "selected" : ""}>Disabled</option>
          </select>
        </label>
        <label class="tts-setting">
          <span class="tts-setting-label">VAD Threshold (Silero prob)</span>
          <input
            id="sttVadThresholdInput"
            class="llama-input tts-setting-input"
            type="number"
            min="0.05"
            max="0.95"
            step="0.001"
            value="${state.sttVadThreshold.toFixed(3)}"
          />
        </label>
        <label class="tts-setting">
          <span class="tts-setting-label">Min Silence (ms)</span>
          <input
            id="sttMinSilenceInput"
            class="llama-input tts-setting-input"
            type="number"
            min="250"
            max="5000"
            step="50"
            value="${Math.trunc(state.sttMinSilenceMs)}"
          />
        </label>
      </div>

      <div class="config-table">
        <div class="config-row">
          <span class="config-key">Last Transcript</span>
          <span class="config-value">${escapeHtml(state.sttLastTranscript || "(none)")}</span>
          <span class="config-meta">Latest</span>
        </div>
      </div>

      <div class="stt-console-wrap">
        <div class="config-key">STT Process Console (read-only)</div>
        <div class="stt-console" id="sttConsole">
          ${consoleLines}
        </div>
      </div>
    </div>
  `;
}
