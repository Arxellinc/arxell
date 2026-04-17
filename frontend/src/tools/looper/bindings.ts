import type { LooperToolState } from "./state";
import { LOOPER_PHASES } from "./state";
import type { LooperActionsDeps } from "./actions";
import { LOOPER_DATA_ATTR, LOOPER_UI_ID } from "../ui/constants";

export function handleLooperClick(
  target: HTMLElement,
  state: LooperToolState,
  deps: LooperActionsDeps
): boolean {
  const actionEl = target.closest(`[${LOOPER_DATA_ATTR.action}]`);
  if (actionEl) {
    const actionValue = (actionEl as HTMLElement).getAttribute(LOOPER_DATA_ATTR.action);
    if (actionValue === "new-loop") {
      void import("./actions").then(({ createLoop }) => {
        void createLoop(state, deps);
      });
      return true;
    }
    if (actionValue === "start-loop") {
      const loopId = state.activeLoopId;
      if (loopId) {
        void import("./actions").then(({ startLoop }) => {
          void startLoop(state, deps, loopId);
        });
      }
      return true;
    }
    if (actionValue === "pause-loop") {
      const loopId = state.activeLoopId;
      if (loopId) {
        void import("./actions").then(({ setLoopPaused }) => {
          void setLoopPaused(state, deps, loopId, true);
        });
      }
      return true;
    }
    if (actionValue === "resume-loop") {
      const loopId = state.activeLoopId;
      if (loopId) {
        void import("./actions").then(({ setLoopPaused }) => {
          void setLoopPaused(state, deps, loopId, false);
        });
      }
      return true;
    }
    if (actionValue === "stop-loop") {
      const loopId = state.activeLoopId;
      if (loopId) {
        void import("./actions").then(({ stopLoop }) => {
          void stopLoop(state, deps, loopId);
        });
      }
      return true;
    }
    if (actionValue === "close-loop") {
      const loopId = state.activeLoopId;
      if (loopId) {
        void import("./actions").then(({ closeLoop }) => {
          void closeLoop(state, deps, loopId);
        });
      }
      return true;
    }
    if (actionValue === "open-config") {
      void import("./actions").then(({ openConfig }) => {
        openConfig(state);
        deps.renderAndBind();
      });
      return true;
    }
    if (actionValue === "close-config") {
      void import("./actions").then(({ closeConfig }) => {
        closeConfig(state);
        deps.renderAndBind();
      });
      return true;
    }
    if (actionValue === "apply-config") {
      void import("./actions").then(({ applyConfig }) => {
        applyConfig(state);
        deps.renderAndBind();
      });
      return true;
    }
    if (actionValue === "dismiss-install") {
      void import("./actions").then(({ dismissInstall }) => {
        dismissInstall(state);
        deps.renderAndBind();
      });
      return true;
    }
    if (actionValue === "recheck-install") {
      void import("./actions").then(({ recheckInstall }) => {
        void recheckInstall(state, deps);
      });
      return true;
    }
    if (actionValue === "toggle-prompt") {
      const phase = (actionEl as HTMLElement).getAttribute(LOOPER_DATA_ATTR.phase);
      if (phase) {
        const loopId = state.activeLoopId;
        if (loopId) {
          void import("./actions").then(({ togglePhasePromptEdit }) => {
            togglePhasePromptEdit(state, loopId, phase as any);
            deps.renderAndBind();
          });
        }
      }
      return true;
    }
  }

  const loopEl = target.closest(`[${LOOPER_DATA_ATTR.loopId}]`);
  if (loopEl) {
    const closeEl = target.closest(`[${LOOPER_DATA_ATTR.closeLoopId}]`);
    if (closeEl) {
      const loopId = (closeEl as HTMLElement).getAttribute(LOOPER_DATA_ATTR.closeLoopId);
      if (loopId) {
        void import("./actions").then(({ closeLoop }) => {
          void closeLoop(state, deps, loopId);
        });
      }
      return true;
    }
    const loopId = (loopEl as HTMLElement).getAttribute(LOOPER_DATA_ATTR.loopId);
    if (loopId && loopId !== state.activeLoopId) {
      void import("./actions").then(({ switchLoop }) => {
        switchLoop(state, loopId);
        deps.renderAndBind();
      });
      return true;
    }
  }

  return false;
}

export function handleLooperInput(
  target: HTMLElement,
  state: LooperToolState
): { handled: boolean; rerender: boolean } {
  const action = target.closest(`[${LOOPER_DATA_ATTR.action}]`);
  if (!action) {
    const promptArea = target.closest(`[${LOOPER_DATA_ATTR.phase}]`);
    if (promptArea) {
      const phase = (promptArea as HTMLElement).getAttribute(LOOPER_DATA_ATTR.phase);
      if (phase) {
        const loopId = state.activeLoopId;
        if (loopId) {
          const textarea = target as HTMLTextAreaElement;
          void import("./actions").then(({ updatePhasePromptDraft }) => {
            updatePhasePromptDraft(state, loopId, phase as any, textarea.value);
          });
          return { handled: true, rerender: false };
        }
      }
    }
    return { handled: false, rerender: false };
  }

  const actionValue = (action as HTMLElement).getAttribute(LOOPER_DATA_ATTR.action);
  if (actionValue === "splash-project-name") {
    state.projectNameDraft = (target as HTMLInputElement).value;
    return { handled: true, rerender: false };
  }
  if (actionValue === "splash-project-type") {
    state.projectTypeDraft = (target as HTMLSelectElement).value;
    return { handled: true, rerender: true };
  }
  if (actionValue === "splash-project-icon") {
    state.projectIconDraft = (target as HTMLInputElement).value;
    return { handled: true, rerender: false };
  }
  if (actionValue === "splash-project-description") {
    state.projectDescriptionDraft = (target as HTMLTextAreaElement).value;
    return { handled: true, rerender: false };
  }
  if (actionValue === "set-phase-model") {
    const phaseModelSelect = target as HTMLSelectElement;
    const phase = phaseModelSelect.getAttribute(LOOPER_DATA_ATTR.phase);
    const value = phaseModelSelect.value || "auto";
    if (phase === "__all") {
      state.phaseModels = {
        planner: value,
        executor: value,
        validator: value,
        critic: value
      };
    } else if (phase) {
      state.phaseModels = {
        ...state.phaseModels,
        [phase]: value
      };
    }
    return { handled: true, rerender: true };
  }
  if (actionValue === "config-cwd") {
    state.configCwdDraft = (target as HTMLInputElement).value;
    return { handled: true, rerender: false };
  }
  if (actionValue === "config-task-path") {
    state.configTaskPathDraft = (target as HTMLInputElement).value;
    return { handled: true, rerender: false };
  }
  if (actionValue === "config-specs-glob") {
    state.configSpecsGlobDraft = (input(target)).value;
    return { handled: true, rerender: false };
  }
  if (actionValue === "config-max-iterations") {
    const val = parseInt((target as HTMLInputElement).value, 10);
    if (!isNaN(val) && val > 0) {
      state.configMaxIterationsDraft = val;
    }
    return { handled: true, rerender: false };
  }

  return { handled: false, rerender: false };
}
function input(target: HTMLElement): HTMLInputElement {
  return target as HTMLInputElement;
}
