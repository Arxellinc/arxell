import type { AppEvent } from "../../contracts";

export interface ToolHostContext {
  nextCorrelationId: () => string;
}

export interface ToolRenderContext {
  active: boolean;
}

export interface ToolInputContext {
  host: ToolHostContext;
}

export interface ToolActionContext {
  host: ToolHostContext;
}

export interface ToolModule<TState = unknown> {
  toolId: string;
  getInitialState: () => TState;
  renderBody: (state: TState, ctx: ToolRenderContext) => string;
  renderActions: (state: TState, ctx: ToolRenderContext) => string;
  onEvent?: (state: TState, event: AppEvent) => TState;
  onInput?: (state: TState, event: Event, ctx: ToolInputContext) => TState;
  onAction?: (
    state: TState,
    action: string,
    target: HTMLElement,
    ctx: ToolActionContext
  ) => Promise<TState | void>;
}
