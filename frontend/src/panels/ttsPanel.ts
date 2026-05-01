import type { PrimaryPanelRenderState } from "./types";
import { escapeHtml } from "./utils";
import { iconHtml } from "../icons";
import { getTtsEngineUiConfig, KOKORO_BUNDLE_OPTIONS, TTS_ENGINE_OPTIONS, type TtsEngine } from "../tts/engineRules";

function resolveTtsCompatHint(
  message: string | null,
  engine: TtsEngine
): string | null {
  const text = (message || "").toLowerCase();
  if (!text) return null;
  if (engine === "kokoro" && text.includes("missing required metadata key 'sample_rate'")) {
    return "Selected ONNX is not a sherpa-compatible Kokoro model. Use kokoro-v1.0.int8.onnx with matching bundle files.";
  }
  if (engine === "kokoro" && text.includes("incompatible kokoro bundle")) {
    return "Model and voice files appear mismatched. Keep model/voices/tokens/espeak-ng-data from the same release bundle.";
  }
  if (text.includes("missing tokens.txt") || text.includes("missing espeak-ng-data")) {
    return "Model folder is incomplete. Ensure tokens.txt and espeak-ng-data are present beside the selected model.";
  }
  if (text.includes("selected model file does not exist") || text.includes("missing model file")) {
    return "Model file path is invalid. Re-select an existing ONNX model file.";
  }
  return null;
}

function bundleDirFromUrl(url: string): string {
  const fileName = url.split("/").pop() || "";
  return fileName.replace(/\.tar\.bz2$/, "");
}

function isBundleInstalled(bundleDir: string, availableModelPaths: string[]): boolean {
  return availableModelPaths.some((p) => p.replace(/\\/g, "/").includes("/" + bundleDir + "/"));
}

function bundleLabelFromModelPath(modelPath: string): string {
  const normalized = modelPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "(unset)";
  const parts = normalized.split("/").filter(Boolean);
  const file = parts[parts.length - 1] || normalized;
  const parent = parts.length >= 2 ? parts[parts.length - 2] : "";
  if (file === "model.onnx" && parent === "base") return "base";
  return parent ? `${parent} (${file})` : file;
}

function formatBytes(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN) || !value) return "";
  const mb = value / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

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
  const compatHint = resolveTtsCompatHint(tts.message, tts.engine);
  const engineLabel = engineUi.engineLabel;
  const engineHint = engineUi.engineHint;
  const trustedSourceUrl = engineUi.trustedSourceUrl;
  const downloadActionLabel = engineUi.downloadActionLabel;
  const secondaryLabel = engineUi.secondaryLabel;
  const secondaryRequired = engineUi.secondaryRequired;
  const showSecondaryPath = engineUi.showSecondaryPath;
  const secondaryPath = tts.secondaryPath || (tts.engine === "piper" ? "" : tts.voicesPath || "");
  const showDownloadProgress = busy && (tts.downloadPercent !== null || tts.downloadReceivedBytes !== null);
  const progressValue = Number.isFinite(tts.downloadPercent ?? NaN)
    ? Math.max(0, Math.min(100, tts.downloadPercent ?? 0))
    : null;
  const progressLabel =
    progressValue !== null
      ? `${progressValue.toFixed(0)}%`
      : tts.downloadReceivedBytes
      ? formatBytes(tts.downloadReceivedBytes)
      : "Downloading";
  const progressDetail =
    tts.downloadTotalBytes && tts.downloadReceivedBytes
      ? `${formatBytes(tts.downloadReceivedBytes)} of ${formatBytes(tts.downloadTotalBytes)}`
      : tts.downloadReceivedBytes
      ? formatBytes(tts.downloadReceivedBytes)
      : "";
  const modelPathOptions = Array.from(
    new Set([...(tts.availableModelPaths || []), ...(tts.modelPath ? [tts.modelPath] : [])])
  );
  const bundleOptions = modelPathOptions
    .map((modelPath) => {
      const selected = modelPath === tts.modelPath ? "selected" : "";
      return `<option value="${escapeHtml(modelPath)}" ${selected}>${escapeHtml(bundleLabelFromModelPath(modelPath))}</option>`;
    })
    .join("");

  const needsSetup = !tts.modelPath && !modelPathOptions.length;
  const showSetupModal = needsSetup && tts.ttsSetupModalOpen;
  const showInlineBanner = needsSetup && !showSetupModal;

  const setupModalHtml = showSetupModal
    ? `<div class="tts-setup-modal-backdrop">
        <div class="tts-setup-modal-box">
          <button type="button" class="tts-setup-modal-close" data-tts-action="close-setup-modal">${iconHtml("x", { size: 16, tone: "dark", label: "Close" })}</button>
          <div class="tts-setup-modal-title">Install ${engineLabel} Model</div>
          <div class="tts-setup-modal-desc">${tts.engine === "kokoro"
            ? "Download a compatible sherpa-onnx Kokoro model bundle to get started."
            : `A compatible sherpa-onnx ${engineLabel} model bundle is required. Download one from the trusted source and place the files in the bundle path.`}</div>
          ${tts.engine === "kokoro"
            ? `<div class="tts-setup-modal-bundles">
                ${KOKORO_BUNDLE_OPTIONS.map((bundle) => `
                  <button type="button" class="tts-setup-modal-bundle-btn kokoro-bundle-btn" data-url="${bundle.url}" ${busy ? "disabled" : ""}>
                    <span class="tts-setup-modal-bundle-name">${bundle.label}</span>
                    <span class="tts-setup-modal-bundle-size">${bundle.sizeLabel}</span>
                  </button>
                `).join("")}
              </div>`
            : `<div class="tts-setup-modal-bundles">
                <a class="tts-setup-modal-bundle-btn tts-setup-modal-source-link" href="${trustedSourceUrl}" target="_blank" rel="noreferrer noopener">
                  <span class="tts-setup-modal-bundle-name">${downloadActionLabel}</span>
                  <span class="tts-setup-modal-bundle-size">opens in browser</span>
                </a>
              </div>`}
          <div class="tts-setup-modal-actions">
            <a class="tts-setup-modal-link" href="${trustedSourceUrl}" target="_blank" rel="noreferrer noopener">View all bundles on GitHub</a>
            <button type="button" class="tts-setup-modal-cancel-btn" data-tts-action="close-setup-modal">Cancel</button>
          </div>
        </div>
      </div>`
    : "";

  return `
    <div class="primary-pane-body">
      <div class="config-table tts-engine-table">
        <div class="config-row tts-config-row">
          <span class="config-key">Model Bundle</span>
          <span class="config-value">${tts.ready ? "Installed" : "Missing / Invalid"}</span>
          <span class="config-meta">sherpa-onnx ${engineLabel}</span>
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
      
        <div class="config-row tts-config-row">
          <label class="config-key" for="ttsBundleSelect">Bundle</label>
          <span class="config-value">
            <select id="ttsBundleSelect" class="settings-select" ${busy || !modelPathOptions.length ? "disabled" : ""}>
              <option value="" ${tts.modelPath ? "" : "selected"}>${modelPathOptions.length ? "Select bundle..." : "No bundles found"}</option>
              ${bundleOptions}
            </select>
          </span>
          <span class="config-meta">${modelPathOptions.length} found</span>
         <span class="config-value"></span>
         
          <span class="config-meta">      
 ${
        tts.engine === "kokoro" && KOKORO_BUNDLE_OPTIONS.some((b) => !isBundleInstalled(bundleDirFromUrl(b.url), modelPathOptions))
          ? `<div class="tts-bundle-links">
              ${KOKORO_BUNDLE_OPTIONS
                .filter((b) => !isBundleInstalled(bundleDirFromUrl(b.url), modelPathOptions))
                .map((b) => `<a href="#" class="tts-bundle-link" data-url="${b.url}">${b.label} (${b.sizeLabel})</a>`)
                .join("")}
            </div>`
          : ""
      }
</span>
          <span>
      ${
        showInlineBanner
          ? `<div class="tts-download-banner">
              <div class="tts-download-copy">
                <strong>Model Setup</strong>
                <span>TTS ${engineLabel} model is missing. Download a compatible sherpa-onnx bundle.</span>
                <a class="tts-trusted-link" href="${trustedSourceUrl}" target="_blank" rel="noreferrer noopener">Trusted source for ${engineLabel} bundles</a>
              </div>
              ${
                tts.engine === "kokoro"
                  ? `<div class="tts-kokoro-downloads">
                      ${KOKORO_BUNDLE_OPTIONS.map((bundle) => `
                        <button type="button" class="tool-action-btn tts-download-btn kokoro-bundle-btn" data-url="${bundle.url}" ${busy ? "disabled" : ""}>
                          ${bundle.label} (${bundle.sizeLabel})
                        </button>
                      `).join("")}
                     </div>`
                  : `<button type="button" class="tool-action-btn tts-download-btn" id="ttsDownloadModelBtn" ${busy ? "disabled" : ""}>${downloadActionLabel}</button>`
              }
            </div>`
          : ""
      }</span>
          
      </div>
       </div>

      ${setupModalHtml}

      ${compatHint ? `<div class="tts-compat-hint">${escapeHtml(compatHint)}</div>` : ""}

      ${
        showDownloadProgress
          ? `<div class="tts-download-progress" role="status" aria-live="polite">
              <div class="tts-download-progress-top">
                <span>Downloading model bundle</span>
                <span>${escapeHtml(progressLabel)}</span>
              </div>
              <progress ${progressValue !== null ? `value="${progressValue.toFixed(2)}" max="100"` : ""}></progress>
              ${progressDetail ? `<div class="tts-download-progress-detail">${escapeHtml(progressDetail)}</div>` : ""}
            </div>`
          : ""
      }

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
        ${
          showSecondaryPath
            ? `<div class="config-row tts-config-row">
          <span class="config-key">${secondaryLabel}</span>
          <span class="config-value tts-path-cell">
            <span class="tts-path-text">${escapeHtml(secondaryPath || "(unset)")}</span>
            <button
              type="button"
              class="tts-model-browse-btn"
              id="ttsSecondaryBrowseBtn"
              aria-label="Browse TTS secondary path"
              title="Browse TTS secondary path"
              ${busy ? "disabled" : ""}
            >
              ${iconHtml("folder-open", { size: 16, tone: "dark", label: "Browse TTS secondary path" })}
            </button>
          </span>
          <span class="config-meta">${secondaryPath ? "OK" : secondaryRequired ? "Missing" : "Optional"}</span>
        </div>`
            : ""
        }
        <div class="config-row tts-config-row">
          <span class="config-key">Tokens Path</span>
          <span class="config-value">${escapeHtml(tts.tokensPath || "(unset)")}</span>
          <span class="config-meta">${tts.tokensPath ? "OK" : "Missing"}</span>
        </div>
        <div class="config-row tts-config-row">
          <span class="config-key">Data Dir</span>
          <span class="config-value">${escapeHtml(tts.dataDir || "(unset)")}</span>
          <span class="config-meta">${tts.dataDir ? "OK" : "Missing"}</span>
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
