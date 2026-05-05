import { iconHtml } from "../icons";
import { escapeHtml } from "../panels/utils";

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
  const nextDisabledAttr = state.firstRunBusy || (step === "welcome" && !state.firstRunTermsAccepted) ? " disabled" : "";
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
        <div class="tts-setup-modal-desc">Download a starter model or select an existing local .gguf file. Use Next when you are ready to continue.</div>
        <div class="first-run-model-list">
          ${modelOptions.map((model) => `
            <label class="first-run-model-option${model.id === state.firstRunSelectedModelId ? " is-selected" : ""}">
              <input type="radio" name="firstRunModel" value="${escapeHtml(model.id)}" ${model.id === state.firstRunSelectedModelId ? "checked" : ""}${busyAttr} />
              <span class="first-run-model-copy">
                <span class="first-run-model-title">${escapeHtml(model.name)} <small>${escapeHtml(model.size)}</small></span>
                <span class="first-run-model-desc">${escapeHtml(model.description)}</span>
              </span>
            </label>
          `).join("")}
        </div>
        ${state.firstRunSelectedModelId === "custom-gguf" ? `<div class="first-run-custom-path">${escapeHtml(state.firstRunCustomModelPath || "No local model selected yet.")}</div>` : ""}`;

  const primaryAction =
    step === "welcome"
      ? `<button type="button" class="tts-setup-modal-bundle-btn first-run-next"${nextDisabledAttr}>Next</button>`
      : `<button type="button" class="tts-setup-modal-bundle-btn first-run-next"${busyAttr}>Finish</button>`;
  const stepAction =
    step === "model"
      ? selectedModel?.custom
        ? `<button type="button" class="tts-setup-modal-cancel-btn first-run-select-custom-model"${busyAttr}>Select GGUF</button>`
        : `<button type="button" class="tts-setup-modal-cancel-btn first-run-download-model"${busyAttr}>${state.firstRunBusy ? "Downloading..." : "Download"}</button>`
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

export function bindFirstRunOnboardingInteractions(deps: {
  state: FirstRunOnboardingState & { llamaRuntimeModelPath: string };
  modelOptions: readonly FirstRunModelOption[];
  getClient: () => { modelManagerDownloadHf: (request: { correlationId: string; repoId: string; fileName: string }) => Promise<{ model: { path: string; name: string } }> } | null;
  nextCorrelationId: () => string;
  browseModelPath: () => Promise<string | null>;
  persistLlamaModelPath: (path: string) => void;
  refreshModelManagerInstalled: () => Promise<void>;
  persistFirstRunOnboardingDismissed: () => void;
  render: () => void;
}): void {
  const dismiss = () => {
    deps.state.firstRunOnboardingOpen = false;
    deps.state.firstRunBusy = false;
    deps.state.firstRunMessage = null;
    deps.persistFirstRunOnboardingDismissed();
    deps.render();
  };

  document.querySelectorAll<HTMLButtonElement>(".first-run-skip").forEach((btn) => {
    btn.onclick = dismiss;
  });

  const termsCheckbox = document.querySelector<HTMLInputElement>("#firstRunTermsCheckbox");
  if (termsCheckbox) {
    termsCheckbox.onchange = () => {
      deps.state.firstRunTermsAccepted = termsCheckbox.checked;
      deps.state.firstRunMessage = null;
      deps.render();
    };
  }

  const firstRunSkipStep = document.querySelector<HTMLButtonElement>(".first-run-skip-step");
  if (firstRunSkipStep) {
    firstRunSkipStep.onclick = () => {
      if (deps.state.firstRunOnboardingStep === "welcome") {
        deps.state.firstRunOnboardingStep = "model";
      } else {
        dismiss();
        return;
      }
      deps.state.firstRunMessage = null;
      deps.render();
    };
  }

  const firstRunNext = document.querySelector<HTMLButtonElement>(".first-run-next");
  if (firstRunNext) {
    firstRunNext.onclick = () => {
      if (deps.state.firstRunOnboardingStep === "welcome" && !deps.state.firstRunTermsAccepted) return;
      if (deps.state.firstRunOnboardingStep === "welcome") {
        deps.state.firstRunOnboardingStep = "model";
      } else {
        dismiss();
        return;
      }
      deps.state.firstRunMessage = null;
      deps.render();
    };
  }

  const firstRunBack = document.querySelector<HTMLButtonElement>(".first-run-back");
  if (firstRunBack) {
    firstRunBack.onclick = () => {
      deps.state.firstRunOnboardingStep = "welcome";
      deps.state.firstRunMessage = null;
      deps.render();
    };
  }

  document.querySelectorAll<HTMLInputElement>('input[name="firstRunModel"]').forEach((input) => {
    input.onchange = () => {
      deps.state.firstRunSelectedModelId = input.value;
      deps.state.firstRunMessage = null;
      deps.render();
    };
  });

  const firstRunDownloadModel = document.querySelector<HTMLButtonElement>(".first-run-download-model");
  if (firstRunDownloadModel) {
    firstRunDownloadModel.onclick = async () => {
      const client = deps.getClient();
      if (!client || deps.state.firstRunBusy) return;
      const model = deps.modelOptions.find((item) => item.id === deps.state.firstRunSelectedModelId) ?? deps.modelOptions[0];
      if (!model || model.custom || !model.repoId || !model.fileName) return;
      deps.state.firstRunBusy = true;
      deps.state.firstRunMessage = `Downloading ${model.name}...`;
      deps.render();
      try {
        const response = await client.modelManagerDownloadHf({
          correlationId: deps.nextCorrelationId(),
          repoId: model.repoId,
          fileName: model.fileName
        });
        deps.state.llamaRuntimeModelPath = response.model.path;
        deps.persistLlamaModelPath(response.model.path);
        await deps.refreshModelManagerInstalled();
        deps.state.firstRunMessage = `Downloaded ${response.model.name}.`;
      } catch (error) {
        deps.state.firstRunMessage = `Model download failed: ${String(error)}`;
      } finally {
        deps.state.firstRunBusy = false;
      }
      deps.render();
    };
  }

  const firstRunSelectCustomModel = document.querySelector<HTMLButtonElement>(".first-run-select-custom-model");
  if (firstRunSelectCustomModel) {
    firstRunSelectCustomModel.onclick = async () => {
      if (deps.state.firstRunBusy) return;
      const selectedPath = await deps.browseModelPath();
      if (!selectedPath) return;
      deps.state.firstRunCustomModelPath = selectedPath;
      deps.state.llamaRuntimeModelPath = selectedPath;
      deps.persistLlamaModelPath(selectedPath);
      deps.state.firstRunMessage = `Selected local model: ${selectedPath}`;
      deps.render();
    };
  }

  const firstRunFinish = document.querySelector<HTMLButtonElement>(".first-run-finish");
  if (firstRunFinish) {
    firstRunFinish.onclick = dismiss;
  }
}
