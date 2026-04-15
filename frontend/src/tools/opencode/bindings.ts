import type { OpenCodeToolState } from "./state";
import type { OpenCodeActionsDeps } from "./actions";
import { OPENCODE_DATA_ATTR, OPENCODE_UI_ID } from "../ui/constants";

export function handleOpenCodeClick(
  target: HTMLElement,
  state: OpenCodeToolState,
  deps: OpenCodeActionsDeps
): boolean {
  const actionEl = target.closest(`[${OPENCODE_DATA_ATTR.action}]`);
  if (actionEl) {
    const actionValue = (actionEl as HTMLElement).getAttribute(OPENCODE_DATA_ATTR.action);
    if (actionValue === "dismiss-install") {
      state.installModalOpen = false;
      deps.renderAndBind();
      return true;
    }
    if (actionValue === "recheck-install") {
      void import("./actions").then(({ recheckAfterInstall }) => {
        void recheckAfterInstall(state, deps);
      });
      return true;
    }
    if (actionValue === "new-agent") {
      void import("./actions").then(({ openSpawnModal }) => {
        openSpawnModal(state);
        deps.renderAndBind();
      });
      return true;
    }
    if (actionValue === "cancel-spawn") {
      state.spawnModalOpen = false;
      deps.renderAndBind();
      return true;
    }
    if (actionValue === "confirm-spawn") {
      const labelEl = document.querySelector<HTMLInputElement>(`#${OPENCODE_UI_ID.spawnLabelInput}`);
      const cwdEl = document.querySelector<HTMLInputElement>(`#${OPENCODE_UI_ID.spawnCwdInput}`);
      const promptEl = document.querySelector<HTMLTextAreaElement>(`#${OPENCODE_UI_ID.spawnPromptInput}`);
      const label = labelEl?.value ?? state.spawnLabelDraft;
      const cwd = cwdEl?.value ?? state.spawnCwdDraft;
      const prompt = promptEl?.value ?? state.spawnPromptDraft;
      void import("./actions").then(({ spawnAgent }) => {
        const opts: { label: string; cwd?: string; prompt?: string } = { label };
        const cwdVal = cwd.trim();
        if (cwdVal) opts.cwd = cwdVal;
        const promptVal = prompt.trim();
        if (promptVal) opts.prompt = promptVal;
        void spawnAgent(state, deps, opts);
      });
      return true;
    }
  }

  const agentEl = target.closest(`[${OPENCODE_DATA_ATTR.agentId}]`);
  if (agentEl) {
    const closeEl = target.closest(`[${OPENCODE_DATA_ATTR.closeAgentId}]`);
    if (closeEl) {
      const agentId = (closeEl as HTMLElement).getAttribute(OPENCODE_DATA_ATTR.closeAgentId);
      if (agentId) {
        void import("./actions").then(({ closeAgent }) => {
          void closeAgent(state, deps, agentId);
          deps.renderAndBind();
        });
      }
      return true;
    }
    const agentId = (agentEl as HTMLElement).getAttribute(OPENCODE_DATA_ATTR.agentId);
    if (agentId && agentId !== state.activeAgentId) {
      void import("./actions").then(({ switchAgent }) => {
        switchAgent(state, agentId);
        deps.renderAndBind();
      });
      return true;
    }
  }

  return false;
}

export function handleOpenCodeInput(
  target: HTMLElement,
  state: OpenCodeToolState
): { handled: boolean; rerender: boolean } {
  const action = target.closest(`[${OPENCODE_DATA_ATTR.action}]`);
  if (!action) return { handled: false, rerender: false };

  const actionValue = (action as HTMLElement).getAttribute(OPENCODE_DATA_ATTR.action);
  if (actionValue === "spawn-label") {
    const input = target as HTMLInputElement;
    state.spawnLabelDraft = input.value;
    return { handled: true, rerender: false };
  }
  if (actionValue === "spawn-cwd") {
    const input = target as HTMLInputElement;
    state.spawnCwdDraft = input.value;
    return { handled: true, rerender: false };
  }
  if (actionValue === "spawn-prompt") {
    const textarea = target as HTMLTextAreaElement;
    state.spawnPromptDraft = textarea.value;
    return { handled: true, rerender: false };
  }

  return { handled: false, rerender: false };
}
