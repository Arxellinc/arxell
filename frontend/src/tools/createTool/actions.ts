import type { ChatIpcClient } from "../../ipcClient";
import { getAllToolManifests } from "../registry";
import type {
  CreateToolRuntimeSlice,
  CreateToolSpec,
  CreateToolTemplateId
} from "./state";

interface CreateToolDeps {
  client: ChatIpcClient | null;
  nextCorrelationId: () => string;
  refreshTools: () => Promise<void>;
}

interface CreateToolWriteResult {
  createdFiles: string[];
  patchedFiles: string[];
  warnings: string[];
  errors: string[];
  toolId: string;
}

const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;
const RESERVED_TOOL_IDS = new Set([
  "events",
  "terminal",
  "manager",
  "web",
  "webSearch",
  "files",
  "flow",
  "tasks",
  "memory",
  "skills",
  "createTool"
]);

export function updateCreateToolField(
  slice: CreateToolRuntimeSlice,
  field:
    | "toolName"
    | "toolId"
    | "description"
    | "category"
    | "templateId"
    | "iconKey"
    | "customIconFromAll",
  value: string
): void {
  if (field === "toolId") {
    slice.createToolSpec.toolId = sanitizeToolId(value);
    return;
  }
  if (field === "templateId") {
    slice.createToolSpec.templateId = normalizeTemplateId(value);
    return;
  }
  if (field === "category") {
    slice.createToolSpec.category = normalizeCategory(value);
    return;
  }
  if (field === "toolName" || field === "description" || field === "iconKey" || field === "customIconFromAll") {
    slice.createToolSpec[field] = value;
  }
}

export function updateCreateToolGuardrail(
  slice: CreateToolRuntimeSlice,
  field: keyof CreateToolSpec["guardrails"],
  enabled: boolean
): void {
  slice.createToolSpec.guardrails[field] = enabled;
}

export function selectCreateToolPreviewPath(slice: CreateToolRuntimeSlice, path: string): void {
  if (!slice.createToolPreviewFiles[path]) return;
  slice.createToolSelectedPreviewPath = path;
}

export function generateCreateToolPreview(slice: CreateToolRuntimeSlice): void {
  const spec = normalizedSpec(slice.createToolSpec);
  slice.createToolSpec = spec;
  const files = buildToolFileMap(spec);
  const ordered = Object.keys(files).sort((a, b) => a.localeCompare(b));
  slice.createToolPreviewFiles = files;
  slice.createToolPreviewOrder = ordered;
  slice.createToolSelectedPreviewPath = ordered[0] ?? "";
  const validation = validateCreateToolSpec(spec);
  slice.createToolValidationErrors = validation.errors;
  slice.createToolValidationWarnings = validation.warnings;
  slice.createToolStatusMessage = validation.errors.length
    ? "Preview generated with validation errors."
    : "Preview generated.";
}

export function validateCreateToolPreview(slice: CreateToolRuntimeSlice): void {
  const spec = normalizedSpec(slice.createToolSpec);
  slice.createToolSpec = spec;
  const validation = validateCreateToolSpec(spec);
  slice.createToolValidationErrors = validation.errors;
  slice.createToolValidationWarnings = validation.warnings;
  slice.createToolStatusMessage = validation.errors.length
    ? "Validation failed."
    : "Validation passed.";
}

export async function createToolScaffold(
  slice: CreateToolRuntimeSlice,
  deps: CreateToolDeps
): Promise<void> {
  if (!deps.client) {
    slice.createToolStatusMessage = "IPC client unavailable.";
    return;
  }
  const spec = normalizedSpec(slice.createToolSpec);
  slice.createToolSpec = spec;
  const validation = validateCreateToolSpec(spec);
  slice.createToolValidationErrors = validation.errors;
  slice.createToolValidationWarnings = validation.warnings;
  if (validation.errors.length) {
    slice.createToolStatusMessage = "Fix validation errors before creating.";
    return;
  }

  slice.createToolBusy = true;
  try {
    const root = await resolveWorkspaceRoot(slice, deps);
    const result = await writeScaffoldFiles(slice, deps, root, spec);
    await deps.refreshTools();
    slice.createToolStatusMessage = `Created tool ${result.toolId}.`;
    slice.createToolLastResultJson = JSON.stringify(result, null, 2);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    slice.createToolStatusMessage = `Create failed: ${message}`;
  } finally {
    slice.createToolBusy = false;
  }
}

export async function registerCreateToolInWorkspace(
  slice: CreateToolRuntimeSlice,
  deps: CreateToolDeps
): Promise<void> {
  slice.createToolBusy = true;
  try {
    await deps.refreshTools();
    slice.createToolStatusMessage = `Workspace tools refreshed for ${slice.createToolSpec.toolId}.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    slice.createToolStatusMessage = `Refresh failed: ${message}`;
  } finally {
    slice.createToolBusy = false;
  }
}

function normalizeTemplateId(value: string): CreateToolTemplateId {
  if (
    value === "basic-view" ||
    value === "list-detail" ||
    value === "form-tool" ||
    value === "event-viewer" ||
    value === "agent-utility"
  ) {
    return value;
  }
  return "basic-view";
}

function normalizeCategory(value: string): CreateToolSpec["category"] {
  if (
    value === "workspace" ||
    value === "agent" ||
    value === "models" ||
    value === "data" ||
    value === "media" ||
    value === "ops"
  ) {
    return value;
  }
  return "workspace";
}

function sanitizeToolId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 40);
}

function normalizedSpec(spec: CreateToolSpec): CreateToolSpec {
  return {
    ...spec,
    toolName: spec.toolName.trim(),
    toolId: sanitizeToolId(spec.toolId),
    description: spec.description.trim(),
    category: normalizeCategory(spec.category),
    templateId: normalizeTemplateId(spec.templateId),
    iconKey: spec.iconKey.trim() || "wrench",
    customIconFromAll: spec.customIconFromAll.trim()
  };
}

function validateCreateToolSpec(spec: CreateToolSpec): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!spec.toolName) errors.push("Tool Name is required.");
  if (!spec.toolId) {
    errors.push("Tool ID is required.");
  } else {
    if (!TOOL_ID_PATTERN.test(spec.toolId)) errors.push("Tool ID must match [a-z][a-z0-9-]{1,40}.");
    if (RESERVED_TOOL_IDS.has(spec.toolId)) errors.push(`Tool ID '${spec.toolId}' is reserved.`);
    if (getAllToolManifests().some((manifest) => manifest.id === spec.toolId)) {
      errors.push(`Tool ID '${spec.toolId}' already exists.`);
    }
  }

  if (!spec.description) warnings.push("Description is empty.");
  if (spec.guardrails.allowExternalNetwork) {
    warnings.push("External network is enabled. Keep actions explicit and reviewed.");
  }

  return { errors, warnings };
}

function buildToolFileMap(spec: CreateToolSpec): Record<string, string> {
  const pascal = toPascal(spec.toolId);
  const dataAction = `data-${spec.toolId}-action`;
  const templateHint = templateHintText(spec.templateId);

  return {
    "manifest.ts": renderGeneratedManifest(spec, pascal),
    "state.ts": renderGeneratedState(pascal),
    "actions.ts": renderGeneratedActions(pascal),
    "bindings.ts": renderGeneratedBindings(spec.toolId, pascal, dataAction),
    "index.tsx": renderGeneratedIndex(spec, pascal, dataAction, templateHint),
    "styles.css": renderGeneratedStyles(spec.toolId),
    "README.md": renderGeneratedReadme(spec, pascal)
  };
}

function renderGeneratedManifest(spec: CreateToolSpec, pascal: string): string {
  return `import type { ToolManifest } from "../types";

export const ${spec.toolId}Manifest: ToolManifest = {
  id: "${spec.toolId}",
  version: "1.0.0",
  title: "${escapeTemplate(spec.toolName || pascal)}",
  description: "${escapeTemplate(spec.description || "Custom tool generated by Create Tool")}",
  category: "${spec.category}",
  core: false,
  defaultEnabled: true,
  source: "builtin",
  icon: "${escapeTemplate(spec.iconKey || "wrench")}"
};
`;
}

function renderGeneratedState(pascal: string): string {
  return `export interface ${pascal}RuntimeState {
  note: string;
}

export function create${pascal}InitialState(): ${pascal}RuntimeState {
  return { note: "" };
}
`;
}

function renderGeneratedActions(pascal: string): string {
  return `import type { ${pascal}RuntimeState } from "./state";

export function set${pascal}Note(state: ${pascal}RuntimeState, note: string): void {
  state.note = note;
}
`;
}

function renderGeneratedBindings(toolId: string, pascal: string, dataAction: string): string {
  return `const DATA_ACTION = "${dataAction}";

export async function handle${pascal}Click(target: HTMLElement, _state: Record<string, unknown>, deps: any): Promise<boolean> {
  const actionTarget = target.closest<HTMLElement>(\`[\${DATA_ACTION}]\`);
  const action = actionTarget?.getAttribute(DATA_ACTION);
  if (!action) return false;

  if (action === "open-web" && deps?.web?.createAndActivateWebTab) {
    deps.web.createAndActivateWebTab();
    return true;
  }
  if (action === "refresh-flow" && deps?.flow?.refreshRuns) {
    await deps.flow.refreshRuns();
    return true;
  }
  if (action === "open-files-root" && deps?.files?.listFilesDirectory) {
    await deps.files.listFilesDirectory();
    return true;
  }
  if (action === "noop") {
    const status = actionTarget.closest(".${toolId}-tool")?.querySelector(".${toolId}-status");
    if (status) status.textContent = "Ran at " + new Date().toLocaleTimeString();
    return true;
  }
  return false;
}

export function handle${pascal}Input(_target: HTMLElement, _state: Record<string, unknown>): boolean {
  return false;
}

export function handle${pascal}Change(_target: HTMLElement, _state: Record<string, unknown>): boolean {
  return false;
}
`;
}

function renderGeneratedIndex(
  spec: CreateToolSpec,
  pascal: string,
  dataAction: string,
  templateHint: string
): string {
  const title = escapeHtml(spec.toolName || pascal);
  const description = escapeHtml(spec.description || "Custom tool scaffold");
  const hint = escapeHtml(templateHint);
  return `import { renderToolToolbar } from "../ui/toolbar";
import "./styles.css";

const DATA_ACTION = "${dataAction}";

export function render${pascal}ToolActions(): string {
  return renderToolToolbar({
    tabsMode: "none",
    tabs: [],
    actions: [
      { id: "${spec.toolId}-open-web", title: "Open WebSearch", icon: "globe", buttonAttrs: { [DATA_ACTION]: "open-web" } },
      { id: "${spec.toolId}-refresh-flow", title: "Refresh Flow", icon: "history", buttonAttrs: { [DATA_ACTION]: "refresh-flow" } },
      { id: "${spec.toolId}-open-files", title: "Open Files Root", icon: "files", buttonAttrs: { [DATA_ACTION]: "open-files-root" } }
    ]
  });
}

export function render${pascal}ToolBody(): string {
  return "<section class=\\"${spec.toolId}-tool\\">"
    + "<header class=\\"${spec.toolId}-header\\">"
    + "<h2>${title}</h2>"
    + "<p>${description}</p>"
    + "</header>"
    + "<div class=\\"${spec.toolId}-card\\">"
    + "<p>${hint}</p>"
    + "<button type=\\"button\\" class=\\"${spec.toolId}-run\\" " + DATA_ACTION + "=\\"noop\\">Run Local Action</button>"
    + "<div class=\\"${spec.toolId}-status\\">Idle</div>"
    + "</div>"
    + "<div class=\\"${spec.toolId}-examples\\">"
    + "<h3>Integration Notes</h3>"
    + "<ul>"
    + "<li>Open WebSearch via toolbar action <code>open-web</code>.</li>"
    + "<li>Refresh Flow via toolbar action <code>refresh-flow</code>.</li>"
    + "<li>Open Files root via toolbar action <code>open-files-root</code>.</li>"
    + "</ul>"
    + "</div>"
    + "</section>";
}
`;
}

function renderGeneratedStyles(toolId: string): string {
  return `.${toolId}-tool {
  min-height: 0;
  height: 100%;
  padding: 0.75rem;
  display: grid;
  gap: 0.75rem;
  overflow: auto;
}

.${toolId}-header h2 {
  margin: 0;
  font-size: 1rem;
}

.${toolId}-header p {
  margin: 0.2rem 0 0;
  color: var(--muted);
  font-size: var(--text-sm);
}

.${toolId}-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-strong);
  padding: 0.65rem;
  display: grid;
  gap: 0.5rem;
}

.${toolId}-run {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface-soft);
  color: var(--ink);
  height: 28px;
  padding: 0 0.65rem;
  cursor: pointer;
  justify-self: start;
}

.${toolId}-run:hover {
  background: var(--surface-hover);
}

.${toolId}-status {
  color: var(--muted);
  font-size: var(--text-xs);
}

.${toolId}-examples h3 {
  margin: 0 0 0.25rem;
  font-size: var(--text-sm);
}

.${toolId}-examples ul {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--muted);
  font-size: var(--text-sm);
}
`;
}

function renderGeneratedReadme(spec: CreateToolSpec, pascal: string): string {
  return `# ${spec.toolName || pascal}

Generated by the Create Tool workspace tool.

## Guardrails
- allowLocalStorage: ${String(spec.guardrails.allowLocalStorage)}
- allowIpc: ${String(spec.guardrails.allowIpc)}
- allowExternalNetwork: ${String(spec.guardrails.allowExternalNetwork)}
- readOnlyMode: ${String(spec.guardrails.readOnlyMode)}
`;
}

async function writeScaffoldFiles(
  slice: CreateToolRuntimeSlice,
  deps: CreateToolDeps,
  root: string,
  spec: CreateToolSpec
): Promise<CreateToolWriteResult> {
  if (!deps.client) throw new Error("IPC client unavailable.");

  const files = buildToolFileMap(spec);
  const createdFiles: string[] = [];
  const patchedFiles: string[] = [];
  const warnings = [...slice.createToolValidationWarnings];
  const errors: string[] = [];

  const toolDir = `${root}/frontend/src/tools/${spec.toolId}`;
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = `${toolDir}/${relativePath}`;
    await writeFile(deps.client, deps.nextCorrelationId, absolute, content);
    createdFiles.push(absolute);
  }

  const viewBuilderPath = `${root}/frontend/src/tools/host/viewBuilder.ts`;
  const dispatchPath = `${root}/frontend/src/tools/host/workspaceDispatch.ts`;

  const viewBuilderSource = await readFile(deps.client, deps.nextCorrelationId, viewBuilderPath);
  const nextViewBuilder = patchViewBuilder(viewBuilderSource, spec.toolId);
  if (nextViewBuilder !== viewBuilderSource) {
    await writeFile(deps.client, deps.nextCorrelationId, viewBuilderPath, nextViewBuilder);
    patchedFiles.push(viewBuilderPath);
  }

  const dispatchSource = await readFile(deps.client, deps.nextCorrelationId, dispatchPath);
  const nextDispatch = patchWorkspaceDispatch(dispatchSource, spec.toolId);
  if (nextDispatch !== dispatchSource) {
    await writeFile(deps.client, deps.nextCorrelationId, dispatchPath, nextDispatch);
    patchedFiles.push(dispatchPath);
  }

  if (spec.customIconFromAll) {
    const iconResult = await copyCustomIcon(spec, root, deps);
    if (iconResult.warning) warnings.push(iconResult.warning);
    if (iconResult.error) errors.push(iconResult.error);
    if (iconResult.patchedIconIndex) {
      patchedFiles.push(`${root}/frontend/src/icons/index.ts`);
      if (iconResult.iconTargetPath) createdFiles.push(iconResult.iconTargetPath);
    }
  }

  return { createdFiles, patchedFiles, warnings, errors, toolId: spec.toolId };
}

async function copyCustomIcon(
  spec: CreateToolSpec,
  root: string,
  deps: CreateToolDeps
): Promise<{ warning?: string; error?: string; patchedIconIndex: boolean; iconTargetPath: string }> {
  if (!deps.client) {
    return {
      error: "Cannot copy icon without IPC client.",
      patchedIconIndex: false,
      iconTargetPath: ""
    };
  }

  const sourceName = spec.customIconFromAll.replace(/\\/g, "/").split("/").at(-1)?.trim();
  if (!sourceName || !sourceName.endsWith(".svg")) {
    return {
      warning: "Custom icon skipped: use an SVG filename from icons-all.",
      patchedIconIndex: false,
      iconTargetPath: ""
    };
  }

  const sourcePath = `${root}/frontend/src/icons-all/${sourceName}`;
  const iconRead = await tryReadFile(deps.client, deps.nextCorrelationId, sourcePath);
  if (!iconRead.ok) {
    return {
      error: `Custom icon not found: ${sourceName}`,
      patchedIconIndex: false,
      iconTargetPath: ""
    };
  }

  const iconTargetPath = `${root}/frontend/src/icons/${sourceName}`;
  await writeFile(deps.client, deps.nextCorrelationId, iconTargetPath, iconRead.content);

  const iconIndexPath = `${root}/frontend/src/icons/index.ts`;
  const iconIndexSource = await readFile(deps.client, deps.nextCorrelationId, iconIndexPath);
  const nextIconIndex = patchIconsIndex(iconIndexSource, spec.iconKey, sourceName);
  const patchedIconIndex = nextIconIndex !== iconIndexSource;
  if (patchedIconIndex) {
    await writeFile(deps.client, deps.nextCorrelationId, iconIndexPath, nextIconIndex);
  }

  return { patchedIconIndex, iconTargetPath };
}

function patchIconsIndex(source: string, iconKey: string, sourceFile: string): string {
  const varName = toCamel(sourceFile.replace(/\.svg$/i, ""));
  const importLine = `import ${varName} from "./${sourceFile}?raw";`;
  const mapLine = `  "${iconKey}": ${varName},`;

  let next = source;
  if (!next.includes(importLine)) {
    next = next.replace("const ICON_SVGS = {", `${importLine}\n\nconst ICON_SVGS = {`);
  }
  if (!next.includes(mapLine)) {
    next = next.replace("} as const;", `${mapLine}\n} as const;`);
  }
  return next;
}

function patchViewBuilder(source: string, toolId: string): string {
  const pascal = toPascal(toolId);
  const importMarker = `create-tool:auto-import:${toolId}`;
  const viewMarker = `create-tool:auto-view:${toolId}`;
  const importLine = `import { render${pascal}ToolActions, render${pascal}ToolBody } from "../${toolId}"; // ${importMarker}`;

  let next = source;
  if (!next.includes(importMarker)) {
    const anchor = 'import { renderWebToolActions, renderWebToolBody } from "../webSearch";';
    if (next.includes(anchor)) {
      next = next.replace(anchor, `${anchor}\n${importLine}`);
    }
  }

  if (!next.includes(viewMarker)) {
    const block = `    // ${viewMarker}\n    ${toolId}: {\n      actionsHtml: render${pascal}ToolActions(),\n      bodyHtml: render${pascal}ToolBody()\n    },\n`;
    next = next.replace("    memory: {", `${block}    memory: {`);
  }

  return next;
}

function patchWorkspaceDispatch(source: string, toolId: string): string {
  const pascal = toPascal(toolId);
  const importMarker = `create-tool:auto-import:${toolId}`;
  const selectorMarker = `create-tool:auto-selector:${toolId}`;
  const clickMarker = `create-tool:auto-click:${toolId}`;
  const changeMarker = `create-tool:auto-change:${toolId}`;
  const inputMarker = `create-tool:auto-input:${toolId}`;

  let next = source;

  if (!next.includes(importMarker)) {
    const importBlock = `import { handle${pascal}Change, handle${pascal}Click, handle${pascal}Input } from "../${toolId}/bindings"; // ${importMarker}`;
    const anchor = 'import { handleTasksChange, handleTasksClick, handleTasksInput } from "../tasks/bindings";';
    next = next.replace(anchor, `${anchor}\n${importBlock}`);
  }

  if (!next.includes(selectorMarker)) {
    const insert = `  "[data-${toolId}-action]", // ${selectorMarker}\n  "[data-${toolId}-field]",`;
    next = next.replace('  `[${FLOW_DATA_ATTR.action}]`,', `  \`[\${FLOW_DATA_ATTR.action}]\`,\n${insert}`);
  }

  if (!next.includes(clickMarker)) {
    const block = `  if (await handle${pascal}Click(target, state as any, deps as any)) { // ${clickMarker}\n    return true;\n  }\n`;
    const anchor = "  if (await handleTasksClick(target, state as any)) {\n    return true;\n  }\n";
    next = next.replace(anchor, `${anchor}${block}`);
  }

  if (!next.includes(changeMarker)) {
    const oldLine = "  const tasksHandled = handleTasksChange(target, state as any);";
    const newLine = `${oldLine}\n  const ${toolId}Handled = handle${pascal}Change(target, state as any); // ${changeMarker}`;
    next = next.replace(oldLine, newLine);
    next = next.replace(
      "  return webHandled || flowHandled || tasksHandled;",
      `  return webHandled || flowHandled || tasksHandled || ${toolId}Handled;`
    );
  }

  if (!next.includes(inputMarker)) {
    const oldLine = "  const tasksHandled = handleTasksInput(target, state as any);";
    const newLine = `${oldLine}\n  const ${toolId}Handled = handle${pascal}Input(target, state as any); // ${inputMarker}`;
    next = next.replace(oldLine, newLine);
    next = next.replace(
      "    handled: filesResult.handled || tasksHandled || webHandled || flowResult.handled,",
      `    handled: filesResult.handled || tasksHandled || ${toolId}Handled || webHandled || flowResult.handled,`
    );
  }

  return next;
}

async function resolveWorkspaceRoot(slice: CreateToolRuntimeSlice, deps: CreateToolDeps): Promise<string> {
  if (!deps.client) throw new Error("IPC client unavailable");
  if (slice.createToolWorkspaceRoot.trim()) return slice.createToolWorkspaceRoot.trim();

  const correlationId = deps.nextCorrelationId();
  const response = await deps.client.toolInvoke({
    correlationId,
    toolId: "files",
    action: "list-directory",
    mode: "sandbox",
    payload: { correlationId }
  });
  if (!response.ok) throw new Error(response.error || "Unable to resolve workspace root.");
  const data = response.data as { rootPath?: string };
  const rootPath = data.rootPath?.trim();
  if (!rootPath) throw new Error("Files tool did not return rootPath.");

  slice.createToolWorkspaceRoot = rootPath;
  return rootPath;
}

async function readFile(client: ChatIpcClient, nextCorrelationId: () => string, path: string): Promise<string> {
  const correlationId = nextCorrelationId();
  const response = await client.toolInvoke({
    correlationId,
    toolId: "files",
    action: "read-file",
    mode: "sandbox",
    payload: { correlationId, path }
  });
  if (!response.ok) throw new Error(response.error || `Failed to read ${path}`);
  const data = response.data as { content?: string };
  return data.content ?? "";
}

async function tryReadFile(
  client: ChatIpcClient,
  nextCorrelationId: () => string,
  path: string
): Promise<{ ok: true; content: string } | { ok: false }> {
  try {
    const content = await readFile(client, nextCorrelationId, path);
    return { ok: true, content };
  } catch {
    return { ok: false };
  }
}

async function writeFile(
  client: ChatIpcClient,
  nextCorrelationId: () => string,
  path: string,
  content: string
): Promise<void> {
  const correlationId = nextCorrelationId();
  const response = await client.toolInvoke({
    correlationId,
    toolId: "files",
    action: "write-file",
    mode: "sandbox",
    payload: { correlationId, path, content }
  });
  if (!response.ok) throw new Error(response.error || `Failed to write ${path}`);
}

function toPascal(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function toCamel(value: string): string {
  const pascal = toPascal(value);
  return pascal ? `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}` : "customIcon";
}

function escapeTemplate(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function templateHintText(templateId: CreateToolTemplateId): string {
  if (templateId === "list-detail") return "List/detail template: add collection state and selected item behavior.";
  if (templateId === "form-tool") return "Form template: add validation and submit lifecycle.";
  if (templateId === "event-viewer") return "Event viewer template: consume and filter app:event payloads.";
  if (templateId === "agent-utility") return "Agent utility template: expose high-signal actions and summaries.";
  return "Basic template: minimal, composable workspace tool surface.";
}
