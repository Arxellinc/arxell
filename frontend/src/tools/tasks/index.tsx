/**
 * Tasks Tool
 *
 * Task planning and status tracking
 */
import { renderToolToolbar } from "../ui/toolbar";

export function renderTasksToolActions(): string {
  return renderToolToolbar({
    tabsMode: "none",
    tabs: [],
    actions: []
  });
}

export function renderTasksToolBody(): string {
  return `<div class="tool-placeholder-container">
    <h2>Tasks</h2>
    <p>Task planning and status tracking</p>
    <div class="tool-placeholder-message">This tool is not yet implemented.</div>
  </div>`;
}

export function TasksTool() {
  return (
    <div className="tool-placeholder">
      <h2>Tasks</h2>
      <p>Task planning and status tracking</p>
      <div className="tool-placeholder-message">This tool is not yet implemented.</div>
    </div>
  );
}
