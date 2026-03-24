import type { PrimaryPanelRenderState } from "./types";

export function renderWorkspaceActions(): string {
  return "<span></span>";
}

export function renderWorkspaceBody(_: PrimaryPanelRenderState): string {
  return `
    <div class="primary-pane-body">
      <div class="sidebar-child-item">Files</div>
      <div class="sidebar-child-item">Search</div>
      <div class="sidebar-child-item">Tasks</div>
    </div>
  `;
}
