/**
 * Skills Tool
 *
 * Reusable skill packs and directives
 */
import { iconHtml } from "../../icons";
import { renderToolToolbar } from "../ui/toolbar";
import { SKILLS_DATA_ATTR } from "./constants";
import type { SkillsToolViewState } from "./state";

export function renderSkillsToolActions(): string {
  return renderToolToolbar({
    tabsMode: "none",
    tabs: [],
    actions: []
  });
}

export function renderSkillsToolBody(view: SkillsToolViewState): string {
  const { sidebarCollapsed, sidebarWidth, selectedSkillId } = view;
  const rootStyle = `--tool-sidebar-width: ${sidebarWidth}px;`;

  return `<div class="tool-with-sidebar ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}" style="${rootStyle}">
    <section class="tool-with-sidebar-panel">
      <div class="pane-title tool-sidebar-header">
        <span class="tool-sidebar-header-text">${sidebarCollapsed ? "" : "Skills"}</span>
        <button type="button" class="tool-sidebar-toggle" data-tool-action="toggle-sidebar-collapse" aria-label="${sidebarCollapsed ? "Expand skills sidebar" : "Collapse skills sidebar"}">${iconHtml("chevron-left", { size: 16, tone: "dark" })}</button>
      </div>
      <div class="tool-sidebar-content">
        <div class="skills-tool-list">
          ${view.skills.length === 0
            ? '<div class="skills-tool-empty">No skills yet</div>'
            : view.skills.map(skill => `
              <button type="button" class="skills-tool-item ${selectedSkillId === skill.id ? "is-selected" : ""}" ${SKILLS_DATA_ATTR.action}="select-skill" ${SKILLS_DATA_ATTR.skillId}="${skill.id}">
                <span class="skills-tool-item-name">
                  <span class="skill-icon">${iconHtml("file-badge", { size: 16, tone: "dark" })}</span>
                  ${skill.name}
                </span>
                ${view.settings.showDescriptions && skill.description ? `<span class="skills-tool-item-desc">${skill.description}</span>` : ""}
              </button>
            `).join("")
          }
        </div>
      </div>
    </section>
    <button type="button" class="tool-sidebar-resizer" aria-label="Resize skills sidebar" data-tool-action="resize-sidebar"></button>
    <section class="tool-with-sidebar-main">
      ${selectedSkillId
        ? `<div class="skills-tool-editor">
            <div class="skills-tool-editor-content">${view.contentById[selectedSkillId] || ""}</div>
          </div>`
        : `<div class="skills-tool-empty">Select a skill to edit</div>`
      }
    </section>
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
