import { iconHtml } from "../icons";
import { escapeHtml } from "../panels/utils";
import type { LlamaRuntimeStatusResponse } from "../contracts";
import { isFirstRunPrimaryActionDisabled } from "./firstRunOnboardingRules";

export type FirstRunOnboardingStep = "welcome" | "runtime" | "model";

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
  llamaRuntime?: LlamaRuntimeStatusResponse | null;
  llamaRuntimeSelectedEngineId?: string;
  tts?: { ready: boolean; engine: string } | null;
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
  const stepsHtml = (["welcome", "runtime", "model"] as const)
    .map((item, idx) => `<span class="first-run-step${step === item ? " is-active" : ""}">${idx + 1}</span>`)
    .join("");
  const messageHtml = state.firstRunMessage
    ? `<div class="first-run-message">${escapeHtml(state.firstRunMessage)}</div>`
    : "";

  const engines = state.llamaRuntime?.engines.filter((engine) => engine.isApplicable) ?? [];
  const selectedEngine =
    engines.find((engine) => engine.engineId === state.llamaRuntimeSelectedEngineId) ??
    engines[0] ??
    null;
  const llamaInstalled = Boolean(selectedEngine?.isInstalled);
  const llamaLabel = selectedEngine?.label ?? "llama.cpp Runtime";
  const kokoroInstalled = Boolean(state.tts?.ready);
  const llamaInstallDisabledAttr = state.firstRunBusy || llamaInstalled ? " disabled" : "";
  const kokoroInstallDisabledAttr = state.firstRunBusy || kokoroInstalled ? " disabled" : "";

  const bodyHtml =
    step === "welcome"
      ? `<div class="tts-setup-modal-title">Welcome to Arxell</div>
        <div class="tts-setup-modal-desc">Arxell is a local-first AI workstation for chat, voice, tools, files, terminals, and agent workflows. It is under active development and some tools may be incomplete.</div>
        <div class="first-run-checklist">
          <div><strong>Features.</strong> Local GGUF models, API models, voice input/output, workspace tools, and configurable guardrails.</div>
          <div><strong>Setup.</strong> Install the local llama.cpp engine and optional Kokoro voice pack on demand, then pick a starter model that fits your RAM/VRAM.</div>
          <div><strong>Safety.</strong> This software is experimental and provided with no guarantees. You are responsible for reviewing output and using guardrails before autonomous workflows.</div>
          <div><strong>License.</strong> Personal use is free. Commercial use requires a valid license. Review the <a href="https://www.arxell.com/legal" target="_blank" rel="noreferrer noopener">Terms</a>.</div>
        </div>
        <label class="first-run-terms"><input type="checkbox" id="firstRunTermsCheckbox" ${state.firstRunTermsAccepted ? "checked" : ""}${busyAttr} /> I have read and agree to the terms of use.</label>`
      : step === "runtime"
        ? `<div class="tts-setup-modal-title">Install Local Runtimes</div>
        <div class="tts-setup-modal-desc">Download the local inference engine and optional voice output pack now, or skip and install them later from notifications or settings.</div>
        <div class="first-run-model-list">
          <div class="first-run-model-option${llamaInstalled ? " is-selected" : ""}">
            <div class="first-run-model-choice">
              <span class="first-run-model-copy">
                <span class="first-run-model-title">${escapeHtml(llamaLabel)} <small>${llamaInstalled ? "Installed" : "~25–35 MB"}</small></span>
                <span class="first-run-model-desc">Required to run local .gguf models on your machine (${llamaInstalled ? "ready" : "not installed"}).</span>
              </span>
            </div>
            <div class="first-run-model-actions">
              <button type="button" class="tts-setup-modal-cancel-btn first-run-install-llama-runtime"${llamaInstallDisabledAttr}>${llamaInstalled ? "Installed ✓" : state.firstRunBusy ? "Working..." : "Install Engine"}</button>
            </div>
          </div>
          <div class="first-run-model-option${kokoroInstalled ? " is-selected" : ""}">
            <div class="first-run-model-choice">
              <span class="first-run-model-copy">
                <span class="first-run-model-title">Kokoro Voice Pack (TTS) <small>${kokoroInstalled ? "Installed" : "~115 MB"}</small></span>
                <span class="first-run-model-desc">Neural text-to-speech model and multi-speaker voice embeddings (${kokoroInstalled ? "ready" : "not installed"}).</span>
              </span>
            </div>
            <div class="first-run-model-actions">
              <button type="button" class="tts-setup-modal-cancel-btn first-run-install-kokoro"${kokoroInstallDisabledAttr}>${kokoroInstalled ? "Installed ✓" : state.firstRunBusy ? "Working..." : "Install Voice"}</button>
            </div>
          </div>
        </div>`
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
    step === "model"
      ? `<button type="button" class="tts-setup-modal-bundle-btn first-run-next"${nextDisabledAttr}>Finish</button>`
      : `<button type="button" class="tts-setup-modal-bundle-btn first-run-next"${nextDisabledAttr}>Next</button>`;
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
