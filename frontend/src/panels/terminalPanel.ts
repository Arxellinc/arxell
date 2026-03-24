import type { PrimaryPanelRenderState } from "./types";

export function renderTerminalActions(): string {
  return "<span></span>";
}

export function renderTerminalBody(_: PrimaryPanelRenderState): string {
  return `
    <div class="primary-pane-body">
      <div class="sidebar-child-item">Session</div>
      <div class="sidebar-child-item">Logs</div>
      <div class="sidebar-child-item">Commands</div>
    </div>
  `;
}
