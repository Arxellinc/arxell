import { escapeHtml } from "./utils";
import { iconHtml } from "../icons";
import type { PrimaryPanelBindings, PrimaryPanelRenderState } from "./types";

function formatBytes(bytes: number | null): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "n/a";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1000 && idx < units.length - 1) {
    value /= 1000;
    idx += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[idx]}`;
}

function formatInstallPhaseLabel(phase: string | null, currentFileName: string | null): string {
  const base =
    phase === "preflight"
      ? "Preflight"
      : phase === "download"
        ? "Downloading"
        : phase === "validate"
          ? "Validating"
          : phase === "activating"
            ? "Activating"
            : phase === "complete"
              ? "Complete"
              : "Installing";
  if (base === "Downloading" && currentFileName) {
    return `${base} ${currentFileName}`;
  }
  return base;
}

function statusLabel(state: PrimaryPanelRenderState): { label: string; tone: string } {
  const status = state.images.status;
  if (!status) return { label: "Checking", tone: "info" };
  if (status.disabled) return { label: "Disabled", tone: "warn" };
  if (status.installState === "installed" && status.runtimeState === "error") {
    return { label: "Runtime Error", tone: "error" };
  }
  if (status.installState === "installed" && status.runtimeState === "ready") {
    return { label: "Ready", tone: "success" };
  }
  if (status.installState === "installed" && status.runtimeState === "probe_only") {
    return { label: "Probe Only", tone: "warn" };
  }
  if (status.installState === "error") return { label: "Package Error", tone: "error" };
  return { label: "Not Installed", tone: "info" };
}

export function renderImagesActions(state: PrimaryPanelRenderState): string {
  const label = statusLabel(state);
  return `
    <div class="images-actions">
      <span class="images-status-pill is-${escapeHtml(label.tone)}">${escapeHtml(label.label)}</span>
      <button type="button" class="topbar-icon-btn" id="imagesRefreshBtn" aria-label="Refresh images status" data-title="Refresh Images" title="Refresh Images">${iconHtml("refresh-cw", { size: 16, tone: "dark" })}</button>
    </div>
  `;
}

export function renderImagesBody(state: PrimaryPanelRenderState): string {
  const images = state.images;
  const status = images.status;
  const pkg = status?.package;
  const installed = status?.installState === "installed";
  const disabled = status?.disabled === true;
  const installBusy = images.installBusy;
  const generateDisabled = !status?.generationReady || disabled || images.generateBusy;
  const percent = images.installPercent !== null ? `${Math.max(0, Math.min(100, images.installPercent)).toFixed(1)}%` : "n/a";
  const progressLabel = formatInstallPhaseLabel(images.installPhase, images.installCurrentFileName);
  const progressHtml = installBusy
    ? `<div class="tts-download-progress images-progress" role="status" aria-live="polite">
        <div class="tts-download-progress-top">
          <span>${escapeHtml(progressLabel)}</span>
          <span>${escapeHtml(percent)}</span>
        </div>
        <progress ${images.installPercent !== null ? `value="${escapeHtml(String(Math.max(0, Math.min(100, images.installPercent))))}" max="100"` : ""}></progress>
        <div class="mm-download-progress-bottom">
          <div class="tts-download-progress-detail">
            ${escapeHtml(formatBytes(images.installReceivedBytes))} / ${escapeHtml(formatBytes(images.installTotalBytes))}
            ${images.installSpeedBytesPerSec !== null ? ` (${escapeHtml(formatBytes(images.installSpeedBytesPerSec))}/s)` : ""}
          </div>
          <button type="button" class="tool-action-btn mm-download-cancel-btn" id="imagesCancelInstallBtn">Cancel</button>
        </div>
      </div>`
    : "";
  const installHtml = !installed
    ? `<button type="button" class="tool-action-btn images-primary-btn" id="imagesInstallBtn" ${installBusy ? "disabled" : ""}>
        ${installBusy ? "Installing..." : "Download and Install"}
      </button>`
    : "";
  const message = images.message || status?.message || "";
  return `
    <div class="images-panel">
      <section class="images-topbar">
        <label class="images-disable-row">
          <input type="checkbox" id="imagesDisableToggle" ${disabled ? "checked" : ""} ${installed ? "" : "disabled"} />
          <span>Disable image generation</span>
        </label>
        ${installHtml}
        ${progressHtml}
      </section>

      <section class="images-section">
        <div class="images-section-title">Package</div>
        <div class="images-meta-grid">
          <span>Model</span><strong>${escapeHtml(pkg?.name || "FLUX.1 Schnell ONNX FP4")}</strong>
          <span>Source</span><a href="${escapeHtml(pkg?.sourceUrl || "https://huggingface.co/Futuremark/FLUX.1-schnell-onnx")}" target="_blank" rel="noreferrer">${escapeHtml(pkg?.repoId || "Futuremark/FLUX.1-schnell-onnx")}</a>
          ${pkg?.upstreamUrl ? `<span>Upstream</span><a href="${escapeHtml(pkg.upstreamUrl)}" target="_blank" rel="noreferrer">black-forest-labs/FLUX.1-schnell-onnx</a>` : ""}
          <span>License</span><strong>${escapeHtml(pkg?.license || "Apache-2.0")}</strong>
          <span>Precision</span><strong>${escapeHtml(pkg?.precisionLabel || "FP4 transformer")}</strong>
          <span>Core model</span><strong>${escapeHtml(formatBytes(pkg?.coreModelBytes ?? null))}</strong>
          <span>Total install</span><strong>${escapeHtml(formatBytes(pkg?.totalInstallBytes ?? null))}</strong>
          <span>Location</span><code title="${escapeHtml(status?.installedPath || "")}">${escapeHtml(status?.installedPath || "Not installed")}</code>
        </div>
        ${message ? `<div class="images-message">${escapeHtml(message)}</div>` : ""}
      </section>

      <section class="images-section">
        <div class="images-section-title">Generate</div>
        <label class="field">
          <span>Prompt</span>
          <textarea class="field-textarea-soft images-prompt" id="imagesPromptInput" rows="5" placeholder="Describe the image">${escapeHtml(images.prompt)}</textarea>
        </label>
        <div class="images-size-row" role="group" aria-label="Image size">
          ${renderSizeButton(images.width, images.height, 512, 512)}
          ${renderSizeButton(images.width, images.height, 768, 768)}
          ${renderSizeButton(images.width, images.height, 1024, 1024)}
          ${renderSizeButton(images.width, images.height, 768, 1024)}
          ${renderSizeButton(images.width, images.height, 1024, 768)}
        </div>
        <div class="images-settings-grid">
          <label class="field">
            <span>Steps</span>
            <input class="field-input-soft" id="imagesStepsInput" type="number" min="1" max="12" value="${escapeHtml(String(images.steps))}" />
          </label>
          <label class="field">
            <span>Guidance</span>
            <input class="field-input-soft" id="imagesGuidanceInput" type="number" min="0" max="10" step="0.1" value="${escapeHtml(String(images.guidance))}" />
          </label>
          <label class="field">
            <span>Seed</span>
            <input class="field-input-soft" id="imagesSeedInput" type="text" value="${escapeHtml(images.seed)}" placeholder="random" />
          </label>
        </div>
        <button type="button" class="tool-action-btn images-primary-btn" id="imagesGenerateBtn" ${generateDisabled ? "disabled" : ""}>Generate</button>
      </section>

      <section class="images-section">
        <button type="button" class="tool-action-btn" id="imagesAdvancedToggleBtn">${images.advancedOpen ? "Hide" : "Show"} Advanced</button>
        ${images.advancedOpen ? `<div class="images-advanced">
          <div class="images-message">Manual package folder selection belongs here after the runtime probe is complete.</div>
        </div>` : ""}
      </section>

      <section class="images-remove-section">
        <button type="button" class="tool-action-btn is-danger" id="imagesRemovePackagesBtn" ${images.removing || !installed ? "disabled" : ""}>Remove image packages</button>
      </section>
    </div>
  `;
}

function renderSizeButton(currentW: number, currentH: number, width: number, height: number): string {
  const active = currentW === width && currentH === height ? " is-active" : "";
  return `<button type="button" class="images-size-btn${active}" data-images-size="${width}x${height}">${width}x${height}</button>`;
}

export function bindImagesPanel(bindings: PrimaryPanelBindings): void {
  const refreshBtn = document.querySelector<HTMLButtonElement>("#imagesRefreshBtn");
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      void bindings.onImagesRefresh();
    };
  }
  const installBtn = document.querySelector<HTMLButtonElement>("#imagesInstallBtn");
  if (installBtn) {
    installBtn.onclick = () => {
      void bindings.onImagesInstall();
    };
  }
  const cancelInstallBtn = document.querySelector<HTMLButtonElement>("#imagesCancelInstallBtn");
  if (cancelInstallBtn) {
    cancelInstallBtn.onclick = () => {
      void bindings.onImagesCancelInstall();
    };
  }
  const disableToggle = document.querySelector<HTMLInputElement>("#imagesDisableToggle");
  if (disableToggle) {
    disableToggle.onchange = (event) => {
      const input = event.currentTarget as HTMLInputElement;
      void bindings.onImagesSetDisabled(input.checked);
    };
  }
  const removeBtn = document.querySelector<HTMLButtonElement>("#imagesRemovePackagesBtn");
  if (removeBtn) {
    removeBtn.onclick = () => {
      void bindings.onImagesRemovePackages();
    };
  }
  const generateBtn = document.querySelector<HTMLButtonElement>("#imagesGenerateBtn");
  if (generateBtn) {
    generateBtn.onclick = () => {
      void bindings.onImagesGenerate();
    };
  }
  document.querySelector<HTMLTextAreaElement>("#imagesPromptInput")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLTextAreaElement;
    void bindings.onImagesSetPrompt(input.value);
  });
  document.querySelector<HTMLInputElement>("#imagesStepsInput")?.addEventListener("change", (event) => {
    const value = Number.parseInt((event.currentTarget as HTMLInputElement).value, 10);
    if (Number.isFinite(value)) void bindings.onImagesSetSteps(value);
  });
  document.querySelector<HTMLInputElement>("#imagesGuidanceInput")?.addEventListener("change", (event) => {
    const value = Number.parseFloat((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value)) void bindings.onImagesSetGuidance(value);
  });
  document.querySelector<HTMLInputElement>("#imagesSeedInput")?.addEventListener("change", (event) => {
    void bindings.onImagesSetSeed((event.currentTarget as HTMLInputElement).value);
  });
  const advancedBtn = document.querySelector<HTMLButtonElement>("#imagesAdvancedToggleBtn");
  if (advancedBtn) {
    advancedBtn.onclick = () => {
      void bindings.onImagesToggleAdvanced();
    };
  }
  document.querySelectorAll<HTMLButtonElement>("[data-images-size]").forEach((button) => {
    button.onclick = () => {
      const raw = button.dataset.imagesSize || "";
      const [w, h] = raw.split("x").map((part) => Number.parseInt(part, 10));
      if (typeof w === "number" && typeof h === "number" && Number.isFinite(w) && Number.isFinite(h)) {
        void bindings.onImagesSetSizePreset(w, h);
      }
    };
  });
}
