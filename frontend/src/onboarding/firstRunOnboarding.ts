import { iconHtml } from "../icons";
import { escapeHtml } from "../panels/utils";
import { isFirstRunPrimaryActionDisabled } from "./firstRunOnboardingRules";

export type FirstRunOnboardingStep = "welcome" | "model";

export interface FirstRunModelOption {
  id: string;
  name: string;
  size: string;
  description: string;
  custom?: boolean;
  repoId?: string;
  fileName?: string;
}

export interface FirstRunOnboardingState {
  firstRunOnboardingOpen: boolean;
  firstRunOnboardingStep: FirstRunOnboardingStep;
  firstRunSelectedModelId: string;
  firstRunTermsAccepted: boolean;
  firstRunCustomModelPath: string;
  firstRunBusy: boolean;
  firstRunMessage: string | null;
}

export function renderFirstRunOnboardingModal(
  state: FirstRunOnboardingState,
  modelOptions: readonly FirstRunModelOption[]
): string {
  if (!state.firstRunOnboardingOpen) return "";
  const selectedModel =
    modelOptions.find((model) => model.id === state.firstRunSelectedModelId) ??
    modelOptions[0];
  const busyAttr = state.firstRunBusy ? " disabled" : "";
  const step = state.firstRunOnboardingStep;
  const nextDisabledAttr = isFirstRunPrimaryActionDisabled({
    step,
    busy: state.firstRunBusy,
    termsAccepted: state.firstRunTermsAccepted,
    customModelSelected: Boolean(selectedModel?.custom),
    customModelPath: state.firstRunCustomModelPath
  }) ? " disabled" : "";
  const stepsHtml = ["welcome", "model"]
    .map((item, idx) => `<span class="first-run-step${step === item ? " is-active" : ""}">${idx + 1}</span>`)
    .join("");
  const messageHtml = state.firstRunMessage
    ? `<div class="first-run-message">${escapeHtml(state.firstRunMessage)}</div>`
    : "";

  const bodyHtml =
    step === "welcome"
      ? `<div class="tts-setup-modal-title">Welcome to Arxell</div>
        <div class="tts-setup-modal-desc">Arxell is a local-first AI workstation for chat, voice, tools, files, terminals, and agent workflows. It is under active development and some tools may be incomplete.</div>
        <div class="first-run-checklist">
          <div><strong>Features.</strong> Local GGUF models, API models, voice input/output, workspace tools, and configurable guardrails.</div>
          <div><strong>Setup.</strong> Pick a starter model that fits your RAM/VRAM. Voice output ships pre-bundled.</div>
          <div><strong>Safety.</strong> This software is experimental and provided with no guarantees. You are responsible for reviewing output and using guardrails before autonomous workflows.</div>
          <div><strong>License.</strong> Personal use is free. Commercial use requires a valid license. Review the <a href="https://www.arxell.com/legal" target="_blank" rel="noreferrer noopener">Terms</a>.</div>
        </div>
        <label class="first-run-terms"><input type="checkbox" id="firstRunTermsCheckbox" ${state.firstRunTermsAccepted ? "checked" : ""}${busyAttr} /> I have read and agree to the terms of use.</label>`
      : `<div class="tts-setup-modal-title">Choose your first model</div>
        <div class="tts-setup-modal-desc">Download a starter model or select an existing local .gguf file. Use Finish when you are ready to continue.</div>
        <div class="first-run-model-list">
          ${modelOptions.map((model) => `
            <div class="first-run-model-option${model.id === state.firstRunSelectedModelId ? " is-selected" : ""}">
              <label class="first-run-model-choice">
                <input type="radio" name="firstRunModel" value="${escapeHtml(model.id)}" ${model.id === state.firstRunSelectedModelId ? "checked" : ""}${busyAttr} />
                <span class="first-run-model-copy">
                  <span class="first-run-model-title">${escapeHtml(model.name)} <small>${escapeHtml(model.size)}</small></span>
                  <span class="first-run-model-desc">${escapeHtml(model.description)}</span>
                </span>
              </label>
              ${model.custom ? `<div class="first-run-model-actions">
                <button type="button" class="tts-setup-modal-cancel-btn first-run-open-model-browser"${busyAttr}>Download</button>
                <button type="button" class="tts-setup-modal-cancel-btn first-run-select-custom-model"${busyAttr}>Browse...</button>
              </div>` : ""}
            </div>
          `).join("")}
        </div>
        ${state.firstRunSelectedModelId === "custom-gguf" ? `<div class="first-run-custom-path">${escapeHtml(state.firstRunCustomModelPath || "No local model selected yet.")}</div>` : ""}`;

  const primaryAction =
    step === "welcome"
      ? `<button type="button" class="tts-setup-modal-bundle-btn first-run-next"${nextDisabledAttr}>Next</button>`
      : `<button type="button" class="tts-setup-modal-bundle-btn first-run-next"${nextDisabledAttr}>Finish</button>`;
  const stepAction =
    step === "model"
      ? !selectedModel?.custom
        ? `<button type="button" class="tts-setup-modal-cancel-btn first-run-download-model"${busyAttr}>${state.firstRunBusy ? "Downloading..." : "Download"}</button>`
        : ""
      : "";

  return `<div class="tts-setup-modal-backdrop first-run-backdrop">
    <div class="tts-setup-modal-box first-run-modal-box">
      <button type="button" class="tts-setup-modal-close first-run-skip"${busyAttr}>${iconHtml("x", { size: 16, tone: "dark", label: "Close" })}</button>
      <div class="first-run-steps">${stepsHtml}</div>
      ${bodyHtml}
      ${messageHtml}
      <div class="tts-setup-modal-actions first-run-actions">
        ${step !== "welcome" ? `<button type="button" class="tts-setup-modal-cancel-btn first-run-skip-step"${busyAttr}>Skip step</button>` : ""}
        <div class="first-run-action-group">
          ${step !== "welcome" ? `<button type="button" class="tts-setup-modal-cancel-btn first-run-back"${busyAttr}>Back</button>` : ""}
          ${stepAction}
          ${primaryAction}
        </div>
      </div>
    </div>
  </div>`;
}

export { bindFirstRunOnboardingInteractions } from "./firstRunOnboardingInteractions";
