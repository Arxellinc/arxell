/**
 * Skills Tool
 *
 * Reusable skill packs and directives
 */
import { renderToolToolbar } from "../ui/toolbar";

export function renderSkillsToolActions(): string {
  return renderToolToolbar({
    tabsMode: "none",
    tabs: [],
    actions: []
  });
}

export function renderSkillsToolBody(): string {
  return `<div class="tool-placeholder-container">
    <h2>Skills</h2>
    <p>Reusable skill packs and directives</p>
    <div class="tool-placeholder-message">This tool is not yet implemented.</div>
  </div>`;
}

export function SkillsTool() {
  return (
    <div className="tool-placeholder">
      <h2>Skills</h2>
      <p>Reusable skill packs and directives</p>
      <div className="tool-placeholder-message">This tool is not yet implemented.</div>
    </div>
  );
}
