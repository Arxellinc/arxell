import type { PrimaryPanelRenderState } from "./types";
import { escapeHtml } from "./utils";

export function renderSttActions(): string {
  return `
    <button type="button" class="tool-action-btn" id="sttToggleBtn">Start</button>
  `;
}

function renderVadRow(args: {
  id: string;
  label: string;
  value: number;
  step: string;
  min?: string;
  max?: string;
  hint?: string;
}): string {
  const minAttr = args.min ? ` min="${args.min}"` : "";
  const maxAttr = args.max ? ` max="${args.max}"` : "";
  return `
    <div class="config-row stt-vad-row">
      <label class="config-key stt-vad-label" for="${args.id}">${args.label}</label>
      <span class="config-value stt-vad-value">
        <input class="stt-vad-input" id="${args.id}" type="number" value="${args.value}" step="${args.step}"${minAttr}${maxAttr} />
      </span>
      <span class="config-meta stt-vad-hint">${args.hint ?? ""}</span>
    </div>
  `;
}

export function renderSttBody(state: PrimaryPanelRenderState): string {
  const stt = state.stt;
  const statusClass = stt.status === "error" ? "stt-status-error" : stt.status === "running" ? "stt-status-running" : stt.status === "starting" ? "stt-status-starting" : "stt-status-idle";
  const statusText = stt.status === "idle" ? "Not started" : stt.status === "starting" ? "Starting..." : stt.status === "running" ? "Listening" : `Error: ${stt.message || "Unknown"}`;

  const micPermissionClass = stt.microphonePermission === "enabled" ? "stt-mic-permission-granted" : stt.microphonePermission === "no_device" ? "stt-mic-permission-nodevice" : "stt-mic-permission-denied";
  const micPermissionText = stt.microphonePermission === "enabled" ? "Microphone access granted" : stt.microphonePermission === "no_device" ? "No microphone device detected" : "Microphone access not granted";
  const micButtonText = stt.microphonePermission === "enabled" ? "Granted" : "Grant Access";
  const sttConsoleEntries = state.consoleEntries
    .filter((entry) => /(^|\s)STT\b|\[stt\]|pipeline\.error/i.test(entry.message))
    .slice(-80);
  const sttConsoleHtml = sttConsoleEntries.length
    ? sttConsoleEntries
        .map((entry) => {
          const time = new Date(entry.timestampMs).toLocaleTimeString();
          return `<div class="stt-console-line is-${entry.level}">${escapeHtml(`${time} [${entry.source}] ${entry.level.toUpperCase()} ${entry.message}`)}</div>`;
        })
        .join("")
    : `<div class="stt-console-empty">No STT console output yet.</div>`;

  return `
    <div class="primary-pane-body">
      <div class="stt-mic-permission ${micPermissionClass}">
        <span class="stt-mic-permission-icon">🎤</span>
        <span class="stt-mic-permission-text">${micPermissionText}</span>
        <button type="button" class="stt-mic-permission-btn" id="sttRequestMicBtn">
          ${micButtonText}
        </button>
      </div>

      <div class="stt-status ${statusClass}">
        <span class="stt-status-indicator"></span>
        <span class="stt-status-text">${statusText}</span>
      </div>

      <div class="config-table">
        <div class="config-row">
          <span class="config-key">Input Device</span>
          <span class="config-value">Default microphone</span>
          <span class="config-meta">Ready</span>
        </div>
        <div class="config-row">
          <span class="config-key">Recognition Model</span>
          <span class="config-value">whisper-base</span>
          <span class="config-meta">Local</span>
        </div>
        <div class="config-row">
          <span class="config-key">Language</span>
          <span class="config-value">Auto-detect</span>
          <span class="config-meta">Enabled</span>
        </div>
      </div>

      ${stt.lastTranscript ? `
        <div class="stt-transcript">
          <div class="stt-transcript-label">Last Transcript:</div>
          <div class="stt-transcript-text">${stt.lastTranscript}</div>
        </div>
      ` : ""}

      <div class="stt-controls">
        <button type="button" class="tool-action-btn ${stt.isListening ? "is-warning" : ""}" id="sttToggleBtn">
          ${stt.isListening ? "Stop Listening" : "Start Listening"}
        </button>
      </div>

      <section class="stt-vad-section" aria-label="VAD Settings">
        <h3 class="stt-vad-title">VAD Settings</h3>
        <p class="stt-vad-note">All settings below are active immediately for detection and chunking.</p>
        <div class="config-table stt-vad-table">
          ${renderVadRow({ id: "sttVadBaseThresholdInput", label: "Base Threshold", value: stt.vadBaseThreshold, step: "0.0005", min: "0", max: "0.2", hint: "RMS floor" })}
          ${renderVadRow({ id: "sttVadDynamicMultiplierInput", label: "Dynamic Multiplier", value: stt.vadDynamicMultiplier, step: "0.1", min: "1", max: "10", hint: "noise floor factor" })}
          ${renderVadRow({ id: "sttVadNoiseAdaptationAlphaInput", label: "Noise Adaptation Alpha", value: stt.vadNoiseAdaptationAlpha, step: "0.01", min: "0", max: "1", hint: "EMA blend" })}
          ${renderVadRow({ id: "sttVadStartFramesInput", label: "Start Frames", value: stt.vadStartFrames, step: "1", min: "1", max: "100", hint: "speech-on hysteresis" })}
          ${renderVadRow({ id: "sttVadEndFramesInput", label: "End Frames", value: stt.vadEndFrames, step: "1", min: "1", max: "200", hint: "speech-off hysteresis" })}
          ${renderVadRow({ id: "sttVadPreSpeechMsInput", label: "Pre-Speech (ms)", value: stt.vadPreSpeechMs, step: "10", min: "0", max: "2000", hint: "prefix capture" })}
          ${renderVadRow({ id: "sttVadMinUtteranceMsInput", label: "Min Utterance (ms)", value: stt.vadMinUtteranceMs, step: "10", min: "0", max: "5000", hint: "drop too-short segments" })}
          ${renderVadRow({ id: "sttVadForceFlushSInput", label: "Force Flush (s)", value: stt.vadForceFlushS, step: "0.25", min: "0.25", max: "30", hint: "chunk while speaking" })}
          ${renderVadRow({ id: "sttVadMaxUtteranceSInput", label: "Max Utterance (s)", value: stt.vadMaxUtteranceS, step: "1", min: "1", max: "120", hint: "hard cap" })}
        </div>
      </section>

      <section class="stt-console-section" aria-label="STT Console">
        <h3 class="stt-console-title">STT Console</h3>
        <div class="stt-console-panel">${sttConsoleHtml}</div>
      </section>
    </div>
  `;
}
