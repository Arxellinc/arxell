import type { AppEvent } from "../../contracts";
import type { ToolModule } from "./types";

export interface ToolHostStore {
  readonly states: Map<string, unknown>;
  register: <TState>(module: ToolModule<TState>) => void;
  getState: <TState>(toolId: string) => TState | null;
  setState: <TState>(toolId: string, state: TState) => void;
  applyEvent: (event: AppEvent) => void;
}

export function createWorkspaceToolHostStore(): ToolHostStore {
  const modules = new Map<string, ToolModule<unknown>>();
  const states = new Map<string, unknown>();

  return {
    states,
    register<TState>(module: ToolModule<TState>) {
      modules.set(module.toolId, module as ToolModule<unknown>);
      if (!states.has(module.toolId)) {
        states.set(module.toolId, module.getInitialState());
      }
    },
    getState<TState>(toolId: string): TState | null {
      return (states.get(toolId) as TState | undefined) ?? null;
    },
    setState<TState>(toolId: string, state: TState) {
      states.set(toolId, state);
    },
    applyEvent(event: AppEvent) {
      for (const [toolId, module] of modules.entries()) {
        if (!module.onEvent) continue;
        const current = states.get(toolId);
        const next = module.onEvent(current, event);
        states.set(toolId, next);
      }
    }
  };
}
