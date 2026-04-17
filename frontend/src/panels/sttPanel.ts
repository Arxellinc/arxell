import type { PrimaryPanelRenderState } from "./types";
import { escapeHtml } from "./utils";

export function renderSttActions(): string {
  return `
    <button type="button" class="tool-action-btn" id="sttToggleBtn">Start</button>
  `;
}

export function renderVadActions(): string {
  return "";
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
  const backendLabel = stt.backend === "sherpa_onnx" ? "sherpa-onnx" : "whisper.cpp";
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

  const availableModels = stt.availableModels.length > 0 ? stt.availableModels : ["auto"];
  const languages = ["auto", "en", "es", "fr", "de", "it", "pt", "ru", "zh", "ja", "ko", "ar"];
  const threadOptions = [1, 2, 4, 6, 8];
  const sttModels: Array<{name: string; fileName: string}> = [
    {
      name: "Sherpa Streaming Zipformer (English)",
      fileName: "sherpa-onnx-rk3588-streaming-zipformer-en-2023-06-26.tar.bz2"
    },
    {
      name: "Sherpa Moonshine Base (Quantized)",
      fileName: "sherpa-onnx-moonshine-base-en-quantized-2026-02-27.tar.bz2"
    }
  ];

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
          <span class="config-key">Backend</span>
          <span class="config-value">
            <select id="sttBackendSelect" class="control-select">
              <option value="whisper_cpp"${stt.backend === "whisper_cpp" ? " selected" : ""}>whisper.cpp</option>
              <option value="sherpa_onnx"${stt.backend === "sherpa_onnx" ? " selected" : ""}>sherpa-onnx</option>
            </select>
          </span>
          <span class="config-meta">${backendLabel}</span>
        </div>
        <div class="config-row">
          <span class="config-key">Recognition Model</span>
          <span class="config-value">
            <select id="sttModelSelect" class="control-select">
              ${availableModels.map(model => `<option value="${model}"${stt.selectedModel === model ? " selected" : ""}>${model}</option>`).join("")}
            </select>
          </span>
          <span class="config-meta">Local</span>
        </div>
        <div class="config-row">
          <span class="config-key">Language</span>
          <span class="config-value">
            <select id="sttLanguageSelect" class="control-select">
              ${languages.map(lang => `<option value="${lang}"${stt.language === lang ? " selected" : ""}>${lang === "auto" ? "Auto-detect" : lang.toUpperCase()}</option>`).join("")}
            </select>
          </span>
          <span class="config-meta">Recognition</span>
        </div>
        <div class="config-row">
          <span class="config-key">Threads</span>
          <span class="config-value">
            <select id="sttThreadsSelect" class="control-select">
              ${threadOptions.map(threads => `<option value="${threads}"${stt.threads === threads ? " selected" : ""}>${threads}</option>`).join("")}
            </select>
          </span>
          <span class="config-meta">CPU cores</span>
        </div>
      </div>

      <div class="stt-advanced-toggle">
        <button type="button" class="stt-advanced-toggle-btn" id="sttAdvancedToggleBtn">
          <span class="stt-advanced-toggle-icon">${stt.showAdvancedSettings ? "▼" : "▶"}</span>
          <span class="stt-advanced-toggle-text">Advanced Settings</span>
        </button>
      </div>

      ${stt.showAdvancedSettings ? `
      <section class="stt-advanced-section" aria-label="Advanced STT Settings">
        <h3 class="stt-advanced-title">Advanced Settings</h3>
        <div class="config-table">
          <div class="config-row">
            <span class="config-key">Sample Rate</span>
            <span class="config-value">16000 Hz</span>
            <span class="config-meta">Fixed</span>
          </div>
          <div class="config-row">
            <span class="config-key">Audio Format</span>
            <span class="config-value">PCM Float32</span>
            <span class="config-meta">16-bit</span>
          </div>
          <div class="config-row">
            <span class="config-key">Backend</span>
            <span class="config-value">${backendLabel}</span>
            <span class="config-meta">Active</span>
          </div>
        </div>
        <details class="stt-model-downloads" style="margin-top: 16px;" open>
          <summary class="stt-advanced-title">Model Downloads</summary>
          <table class="config-table" style="width: 100%; margin-top: 8px;">
            <tbody>
              ${sttModels.map(model => `
                <tr class="config-row">
                  <td class="config-key">${escapeHtml(model.name)}</td>
                  <td class="config-value" style="text-align: right;">
                    <button type="button" class="tool-action-btn" data-stt-model-download="${model.fileName}">
                      Download
                    </button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </details>
        ${stt.modelDownloadProgress !== null ? `
          <div class="config-table" style="margin-top: 8px;">
            <div class="config-row">
              <span class="config-key">Download Progress</span>
              <span class="config-value">
                <progress value="${stt.modelDownloadProgress}" max="100" style="width: 100%; height: 8px;"></progress>
                ${stt.modelDownloadProgress}%
              </span>
              <span class="config-meta">Downloading...</span>
            </div>
          </div>
        ` : ""}
        ${stt.modelDownloadError ? `
          <div class="config-table" style="margin-top: 8px;">
            <div class="config-row">
              <span class="config-key">Error</span>
              <span class="config-value" style="color: var(--error);">${escapeHtml(stt.modelDownloadError)}</span>
              <span class="config-meta">Failed</span>
            </div>
          </div>
        ` : ""}
      </section>
      ` : ""}

      ${stt.lastTranscript ? `
        <div class="stt-transcript">
          <div class="stt-transcript-label">Last Transcript:</div>
          <div class="stt-transcript-text">${escapeHtml(stt.lastTranscript)}</div>
        </div>
      ` : ""}

      <div class="stt-controls">
        <button type="button" class="tool-action-btn ${stt.isListening ? "is-warning" : ""}" id="sttToggleBtn">
          ${stt.isListening ? "Stop Listening" : "Start Listening"}
        </button>
      </div>

      <section class="stt-console-section" aria-label="STT Console">
        <h3 class="stt-console-title">STT Console</h3>
        <div class="stt-console-panel">${sttConsoleHtml}</div>
      </section>
    </div>
  `;
}

function renderVadSettingsSection(stt: PrimaryPanelRenderState["stt"]): string {
  return `
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
  `;
}

export function renderVadBody(state: PrimaryPanelRenderState): string {
  const selectedMethod = state.vadMethods.find((method) => method.id === state.vadSelectedMethod);
  const statusText = selectedMethod?.status ?? "stable";
  const config = state.vadSettings?.vadMethods[state.vadSelectedMethod] ?? selectedMethod?.defaultConfig ?? {};
  const sessionActive = state.voiceRuntimeState !== "idle";
  const capabilityLabels = selectedMethod
    ? [
        selectedMethod.capabilities.supportsEndpointing ? "endpointing" : null,
        selectedMethod.capabilities.supportsInterruptionSignals ? "interruptions" : null,
        selectedMethod.capabilities.supportsMicroTurns ? "micro-turns" : null,
        selectedMethod.capabilities.supportsSpeechProbability ? "probability" : null,
        selectedMethod.capabilities.supportsPartialSegmentation ? "partial segments" : null
      ].filter((label): label is string => Boolean(label))
    : [];
  return `
    <div class="primary-pane-body">
      <section class="stt-vad-section" aria-label="VAD Method">
        <h3 class="stt-vad-title">VAD Method</h3>
        <p class="stt-vad-note">Switching is locked while a voice session is active.</p>
        <div class="config-table stt-vad-table">
          <div class="config-row stt-vad-row">
            <label class="config-key stt-vad-label" for="vadMethodSelect">Method</label>
            <span class="config-value stt-vad-value">
              <select id="vadMethodSelect" class="control-select" ${sessionActive ? "disabled" : ""}>
                ${state.vadMethods.map((method) => `<option value="${escapeHtml(method.id)}"${method.id === state.vadSelectedMethod ? " selected" : ""}>${escapeHtml(method.displayName)}</option>`).join("")}
              </select>
            </span>
            <span class="config-meta stt-vad-hint">${escapeHtml(statusText)}</span>
          </div>
          <div class="config-row stt-vad-row">
            <span class="config-key stt-vad-label">Runtime</span>
            <span class="config-value stt-vad-value">${escapeHtml(state.voiceRuntimeState)}</span>
            <span class="config-meta stt-vad-hint">${sessionActive ? "switching locked" : "switching available"}</span>
          </div>
          <div class="config-row stt-vad-row">
            <label class="config-key stt-vad-label" for="vadExperimentalToggle">Experimental</label>
            <span class="config-value stt-vad-value">
              <input id="vadExperimentalToggle" type="checkbox" ${state.vadIncludeExperimental ? "checked" : ""} />
            </span>
            <span class="config-meta stt-vad-hint">show experimental methods</span>
          </div>
        </div>
        ${selectedMethod ? `<p class="stt-vad-note">${escapeHtml(selectedMethod.description)}</p>` : ""}
        ${capabilityLabels.length ? `<div class="stt-vad-note">${capabilityLabels.map((label) => `<span class="vad-capability-badge">${escapeHtml(label)}</span>`).join(" ")}</div>` : ""}
        ${state.vadMessage ? `<p class="stt-vad-note">${escapeHtml(state.vadMessage)}</p>` : ""}
      </section>
      ${renderVadMethodConfigSection(config)}
    </div>
  `;
}

function renderVadMethodConfigSection(config: Record<string, unknown>): string {
  const rows = Object.entries(config).map(([key, raw]) => {
    const value = typeof raw === "number" ? raw : Number(raw);
    const safeValue = Number.isFinite(value) ? value : 0;
    const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
    return renderVadRow({
      id: `vadConfig_${key}`,
      label,
      value: safeValue,
      step: Number.isInteger(safeValue) ? "1" : "0.0005",
      hint: key
    }).replace("stt-vad-input", "stt-vad-input vad-method-config-input").replace(
      "<input",
      `<input data-vad-config-key="${escapeHtml(key)}"`
    );
  });
  return `
    <section class="stt-vad-section" aria-label="VAD Method Settings">
      <h3 class="stt-vad-title">Method Settings</h3>
      <p class="stt-vad-note">These settings are stored per method.</p>
      <div class="config-table stt-vad-table">
        ${rows.length ? rows.join("") : `<div class="config-row"><span class="config-key">No settings</span><span class="config-value">Defaults</span><span class="config-meta">method</span></div>`}
      </div>
    </section>
  `;
}
