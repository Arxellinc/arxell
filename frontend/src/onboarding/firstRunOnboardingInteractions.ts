import type { FirstRunModelOption, FirstRunOnboardingState } from "./firstRunOnboarding";
import { isFirstRunPrimaryActionDisabled, isValidFirstRunCustomGgufPath } from "./firstRunOnboardingRules.js";
import { openFirstRunModelCatalog } from "./firstRunModelBrowser.js";

export interface FirstRunOnboardingDeps {
  state: FirstRunOnboardingState & { llamaRuntimeModelPath: string };
  modelOptions: readonly FirstRunModelOption[];
  getClient: () => { modelManagerDownloadHf: (request: { correlationId: string; repoId: string; fileName: string }) => Promise<{ model: { path: string; name: string } }> } | null;
  nextCorrelationId: () => string;
  browseModelPath: () => Promise<string | null>;
  openModelCatalog?: () => Promise<void>;
  persistLlamaModelPath: (path: string) => void;
  refreshModelManagerInstalled: () => Promise<void>;
  persistFirstRunOnboardingDismissed: () => void;
  autoStartLlamaRuntimeIfConfigured: () => Promise<void>;
  render: () => void;
}

export function bindFirstRunOnboardingInteractions(deps: FirstRunOnboardingDeps): void {
  const selectedModel = () => deps.modelOptions.find((model) => model.id === deps.state.firstRunSelectedModelId) ?? deps.modelOptions[0];
  const dismiss = () => {
    if (!deps.state.firstRunOnboardingOpen || deps.state.firstRunBusy) return;
    deps.state.firstRunOnboardingOpen = false;
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
      if (deps.state.firstRunBusy) return;
      deps.state.firstRunTermsAccepted = termsCheckbox.checked;
      deps.state.firstRunMessage = null;
      deps.render();
    };
  }

  const firstRunSkipStep = document.querySelector<HTMLButtonElement>(".first-run-skip-step");
  if (firstRunSkipStep) {
    firstRunSkipStep.onclick = () => {
      if (deps.state.firstRunBusy) return;
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
      if (!deps.state.firstRunOnboardingOpen) return;
      const model = selectedModel();
      if (isFirstRunPrimaryActionDisabled({
        step: deps.state.firstRunOnboardingStep,
        busy: deps.state.firstRunBusy,
        termsAccepted: deps.state.firstRunTermsAccepted,
        customModelSelected: Boolean(model?.custom),
        customModelPath: deps.state.firstRunCustomModelPath
      })) return;
      if (deps.state.firstRunOnboardingStep === "welcome") {
        deps.state.firstRunOnboardingStep = "model";
      } else {
        // Restore the selected custom path if a preset was downloaded meanwhile.
        if (model?.custom) {
          const path = deps.state.firstRunCustomModelPath.trim();
          deps.persistLlamaModelPath(path);
          deps.state.llamaRuntimeModelPath = path;
        }
        dismiss();
        void deps.autoStartLlamaRuntimeIfConfigured();
        return;
      }
      deps.state.firstRunMessage = null;
      deps.render();
    };
  }

  const firstRunBack = document.querySelector<HTMLButtonElement>(".first-run-back");
  if (firstRunBack) {
    firstRunBack.onclick = () => {
      if (deps.state.firstRunBusy) return;
      deps.state.firstRunOnboardingStep = "welcome";
      deps.state.firstRunMessage = null;
      deps.render();
    };
  }

  document.querySelectorAll<HTMLInputElement>('input[name="firstRunModel"]').forEach((input) => {
    input.onchange = () => {
      if (deps.state.firstRunBusy) return;
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
      const model = selectedModel();
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
        deps.render();
      }
    };
  }

  const firstRunOpenModelBrowser = document.querySelector<HTMLButtonElement>(".first-run-open-model-browser");
  if (firstRunOpenModelBrowser) {
    firstRunOpenModelBrowser.onclick = async () => {
      if (deps.state.firstRunBusy) return;
      deps.state.firstRunBusy = true;
      deps.state.firstRunMessage = null;
      deps.render();
      try {
        await (deps.openModelCatalog ?? openFirstRunModelCatalog)();
        deps.state.firstRunMessage = "Download a GGUF file from the catalog, then use Browse to select it.";
      } catch (error) {
        deps.state.firstRunMessage = `Could not open the model catalog: ${String(error)}`;
      } finally {
        deps.state.firstRunBusy = false;
        deps.render();
      }
    };
  }

  const firstRunSelectCustomModel = document.querySelector<HTMLButtonElement>(".first-run-select-custom-model");
  if (firstRunSelectCustomModel) {
    firstRunSelectCustomModel.onclick = async () => {
      if (deps.state.firstRunBusy) return;
      deps.state.firstRunBusy = true;
      deps.state.firstRunMessage = null;
      deps.render();
      try {
        const selectedPath = await deps.browseModelPath();
        if (!selectedPath) return;
        if (!isValidFirstRunCustomGgufPath(selectedPath)) {
          deps.state.firstRunMessage = "Please select a valid .gguf model file.";
          return;
        }
        const path = selectedPath.trim();
        deps.persistLlamaModelPath(path);
        deps.state.firstRunSelectedModelId = deps.modelOptions.find((model) => model.custom)?.id ?? "custom-gguf";
        deps.state.firstRunCustomModelPath = path;
        deps.state.llamaRuntimeModelPath = path;
        deps.state.firstRunMessage = `Selected local model: ${path}`;
      } catch (error) {
        deps.state.firstRunMessage = `Model selection failed: ${String(error)}`;
      } finally {
        deps.state.firstRunBusy = false;
        deps.render();
      }
    };
  }
}
