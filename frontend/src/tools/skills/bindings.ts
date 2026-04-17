import { SKILLS_DATA_ATTR } from "./constants";
import type { SkillsToolViewState, SkillInfo } from "./state";
import { SKILLS_SIDEBAR_MIN_WIDTH, SKILLS_SIDEBAR_MAX_WIDTH } from "./state";
import { handleToolSidebarResize } from "../ui/sidebarResize";
import { renderHighlightedHtml } from "../files/highlight";
import type { SkillsActionsDeps } from "./actions";
import { saveSkillContent, createNewSkill, deleteSkillFile } from "./actions";

export type SkillsDeps = SkillsActionsDeps;

export async function handleSkillsClick(
  target: HTMLElement,
  slice: SkillsToolViewState,
  _deps?: SkillsDeps
): Promise<boolean> {
  const action = target.getAttribute(SKILLS_DATA_ATTR.action) || target.getAttribute("data-tool-action");

  if (action === "select-skill") {
    const skillId = target.getAttribute(SKILLS_DATA_ATTR.skillId);
    if (!skillId) return true;
    slice.selectedSkillId = skillId;
    if (!slice.contentById[skillId] && slice.settings.autoLoad) {
      const skill = slice.skills.find((s) => s.id === skillId);
      if (skill) {
        slice.contentById[skillId] = skill.content;
        slice.savedContentById[skillId] = skill.content;
      }
    }
    return true;
  }

  if (action === "toggle-sidebar-collapse") {
    slice.sidebarCollapsed = !slice.sidebarCollapsed;
    return true;
  }

if (action === "new-skill") {
    slice.newSkillModalOpen = true;
    slice.newSkillName = "";
    slice.newSkillDescription = "";
    return true;
  }

  if (action === "confirm-new-skill") {
    if (!_deps) return true;
    const name = slice.newSkillName.trim();
    const description = slice.newSkillDescription.trim();
    if (!name) {
      window.alert("Please enter a skill name");
      return true;
    }
    if (slice.skills.some((s) => s.name === name)) {
      window.alert("A skill with this name already exists");
      return true;
    }
    await createNewSkill(slice, _deps, name, description);
    slice.newSkillModalOpen = false;
    slice.newSkillName = "";
    slice.newSkillDescription = "";
    return true;
  }

  if (action === "open-settings") {
    slice.settingsOpen = true;
    return true;
  }

  if (action === "close-settings" || action === "settings-backdrop") {
    slice.settingsOpen = false;
    return true;
  }

  if (action === "toggle-auto-load") {
    slice.settings.autoLoad = !slice.settings.autoLoad;
    return true;
  }

  if (action === "toggle-show-descriptions") {
    slice.settings.showDescriptions = !slice.settings.showDescriptions;
    return true;
  }

  if (action === "change-permission-default") {
    const select = target as HTMLSelectElement;
    slice.settings.permissionDefault = select.value as "allow" | "deny" | "ask";
    return true;
  }

  if (action === "save-skill") {
    const skillId = target.getAttribute(SKILLS_DATA_ATTR.skillId);
    if (!skillId || !_deps) return true;
    const skill = slice.skills.find((s) => s.id === skillId);
    if (!skill) return true;
    const content = slice.contentById[skillId] ?? skill.content;
    await saveSkillContent(slice, _deps, skill, content);
    slice.dirtyById[skillId] = false;
    slice.savedContentById[skillId] = content;
    return true;
  }

  if (action === "delete-skill") {
    const skillId = target.getAttribute(SKILLS_DATA_ATTR.skillId);
    if (!skillId) return true;
    slice.confirmDeleteId = skillId;
    return true;
  }

  if (action === "cancel-delete" || action === "delete-backdrop") {
    slice.confirmDeleteId = null;
    return true;
  }

  if (action === "confirm-delete") {
    const skillId = target.getAttribute(SKILLS_DATA_ATTR.skillId);
    if (!skillId || !_deps) return true;
    await deleteSkillFile(slice, _deps, skillId);
    if (slice.selectedSkillId === skillId) {
      slice.selectedSkillId = null;
    }
    delete slice.contentById[skillId];
    delete slice.dirtyById[skillId];
    delete slice.savedContentById[skillId];
    slice.confirmDeleteId = null;
    return true;
  }

  if (action === "cancel-new-skill" || action === "new-skill-backdrop") {
    slice.newSkillModalOpen = false;
    slice.newSkillName = "";
    slice.newSkillDescription = "";
    return true;
  }

  if (action === "new-skill-name") {
    const input = target as HTMLInputElement;
    slice.newSkillName = input.value;
    return true;
  }

  if (action === "new-skill-description") {
    const input = target as HTMLInputElement;
    slice.newSkillDescription = input.value;
    return true;
  }

  if (action === "confirm-new-skill") {
    if (!_deps) return true;
    const name = slice.newSkillName.trim();
    const description = slice.newSkillDescription.trim();
    if (!name) {
      window.alert("Skill name is required");
      return true;
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
      window.alert("Skill name must be lowercase alphanumeric with hyphens only");
      return true;
    }
    if (slice.skills.some((s) => s.name === name)) {
      window.alert("A skill with this name already exists");
      return true;
    }
    await createNewSkill(slice, _deps, name, description);
    slice.newSkillModalOpen = false;
    slice.newSkillName = "";
    slice.newSkillDescription = "";
    return true;
  }

  return false;
}

export async function handleSkillsKeyDown(
  event: KeyboardEvent,
  slice: SkillsToolViewState,
  deps: SkillsDeps
): Promise<boolean> {
  const target = event.target as HTMLElement | null;
  const withinSkillsTool = Boolean(target?.closest(".skills-tool"));
  if (!withinSkillsTool) return false;

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    const skillId = slice.selectedSkillId;
    if (!skillId) return true;
    const skill = slice.skills.find((s) => s.id === skillId);
    if (!skill) return true;
    const content = slice.contentById[skillId] ?? skill.content;
    await saveSkillContent(slice, deps, skill, content);
    slice.dirtyById[skillId] = false;
    slice.savedContentById[skillId] = content;
    return true;
  }

  if (event.key === "Escape") {
    if (slice.newSkillModalOpen) {
      slice.newSkillModalOpen = false;
      return true;
    }
    if (slice.settingsOpen) {
      slice.settingsOpen = false;
      return true;
    }
    if (slice.confirmDeleteId) {
      slice.confirmDeleteId = null;
      return true;
    }
  }

  return false;
}

export function handleSkillsPointerDown(
  event: MouseEvent,
  target: HTMLElement,
  slice: SkillsToolViewState
): boolean {
  return handleToolSidebarResize({
    event,
    target,
    rootSelector: ".tool-with-sidebar",
    panelSelector: ".tool-with-sidebar-panel",
    collapsed: slice.sidebarCollapsed ?? false,
    minWidth: SKILLS_SIDEBAR_MIN_WIDTH,
    maxWidth: SKILLS_SIDEBAR_MAX_WIDTH,
    widthCssVar: "--tool-sidebar-width",
    onWidthChange: (width) => { slice.sidebarWidth = width; },
    onResizeStart: () => {},
    onResizeEnd: () => {}
  });
}

export function handleSkillsInput(
  target: HTMLElement,
  slice: SkillsToolViewState
): { handled: boolean; rerender: boolean } {
  const editorInput = target.closest<HTMLTextAreaElement>(
    `[${SKILLS_DATA_ATTR.action}="editor-input"][${SKILLS_DATA_ATTR.skillId}]`
  );
  if (editorInput) {
    const skillId = editorInput.getAttribute(SKILLS_DATA_ATTR.skillId);
    if (!skillId) return { handled: true, rerender: false };
    const content = editorInput.value;
    slice.contentById[skillId] = content;
    const saved = slice.savedContentById[skillId] ?? slice.skills.find((s) => s.id === skillId)?.content ?? "";
    slice.dirtyById[skillId] = saved !== content;
    refreshEditorDecorations(editorInput, content);
    return { handled: true, rerender: false };
  }

  const nameInput = target.closest<HTMLInputElement>(
    `[${SKILLS_DATA_ATTR.action}="new-skill-name"]`
  );
  if (nameInput) {
    slice.newSkillName = nameInput.value;
    return { handled: true, rerender: false };
  }

  const descInput = target.closest<HTMLInputElement>(
    `[${SKILLS_DATA_ATTR.action}="new-skill-description"]`
  );
  if (descInput) {
    slice.newSkillDescription = descInput.value;
    return { handled: true, rerender: false };
  }

  return { handled: false, rerender: false };
}

function refreshEditorDecorations(textarea: HTMLTextAreaElement, content: string): void {
  const panel = textarea.closest<HTMLElement>(".skills-tool-editor-panel");
  if (!panel) return;
  const lineNumbers = panel.querySelector<HTMLElement>(".skills-tool-editor-lines");
  const highlight = panel.querySelector<HTMLElement>(".skills-tool-editor-highlight");
  const lineCount = Math.max(1, content.split("\n").length);

  if (lineNumbers) {
    lineNumbers.textContent = createLineNumbers(lineCount);
  }
  if (highlight) {
    highlight.innerHTML = renderHighlightedHtml(content, "skill.md");
  }

  textarea.style.height = "0px";
  const measuredHeight = textarea.scrollHeight;
  const fallback = lineCount * 20 + 20;
  const height = Math.max(220, measuredHeight || fallback);
  textarea.style.height = `${height}px`;
  textarea.closest<HTMLElement>(".skills-tool-editor-code-wrap")?.style.setProperty(
    "--skills-editor-height",
    `${height}px`
  );
}

function createLineNumbers(lineCount: number): string {
  let value = "";
  for (let i = 1; i <= lineCount; i += 1) {
    value += `${i}${i === lineCount ? "" : "\n"}`;
  }
  return value;
}