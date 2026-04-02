/**
 * Memory Tool
 *
 * Persistent context and memory references
 */
import { renderToolToolbar } from "../ui/toolbar";

export function renderMemoryToolActions(): string {
  return renderToolToolbar({
    tabsMode: "none",
    tabs: [],
    actions: []
  });
}

export function renderMemoryToolBody(): string {
  return `<div class="tool-placeholder-container">
    <h2>Memory</h2>
    <p>Persistent context and memory references</p>
    <div class="tool-placeholder-message">This tool is not yet implemented.</div>
  </div>`;
}

export function MemoryTool() {
  return (
    <div className="tool-placeholder">
      <h2>Memory</h2>
      <p>Persistent context and memory references</p>
      <div className="tool-placeholder-message">This tool is not yet implemented.</div>
    </div>
  );
}
