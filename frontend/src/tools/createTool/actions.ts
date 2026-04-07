import type { ChatIpcClient } from "../../ipcClient";
import { getAllToolManifests } from "../registry";
import prdConnectionsPromptTemplate from "./prompts/prd-connections.md?raw";
import prdDependenciesPromptTemplate from "./prompts/prd-dependencies.md?raw";
import prdExpectedBehaviorPromptTemplate from "./prompts/prd-expected-behavior.md?raw";
import prdInputsPromptTemplate from "./prompts/prd-inputs.md?raw";
import prdOutputsPromptTemplate from "./prompts/prd-outputs.md?raw";
import prdProcessPromptTemplate from "./prompts/prd-process.md?raw";
import prdUiPromptTemplate from "./prompts/prd-ui.md?raw";
import type {
  CreateToolPrdSection,
  CreateToolStage,
  CreateToolUiPreset,
  CreateToolRuntimeSlice,
  CreateToolSpec
} from "./state";

interface CreateToolDeps {
  client: ChatIpcClient | null;
  nextCorrelationId: () => string;
  refreshTools: () => Promise<void>;
  onUpdate?: () => void;
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
    | "selectedModelId"
    | "toolName"
    | "description"
    | "iconKey"
    | "customIconFromAll"
    | "prdUiPreset"
    | "prdUiNotes"
    | "prdInputs"
    | "prdProcess"
    | "prdConnections"
    | "prdDependencies"
    | "prdExpectedBehavior"
    | "prdOutputs"
    | "prdMarkdownDoc"
    | "devPlan"
    | "iconBrowserQuery"
    | "fixNotes",
  value: string
): void {
  if (field === "selectedModelId") {
    slice.createToolSelectedModelId = value.trim();
    return;
  }
  if (field === "prdUiPreset") {
    slice.createToolPrdUiPreset = normalizeUiPreset(value);
    return;
  }
  if (field === "toolName") {
    slice.createToolSpec.toolName = value;
    slice.createToolSpec.toolId = sanitizeToolId(value);
    return;
  }
  if (field === "description" || field === "iconKey" || field === "customIconFromAll") {
    slice.createToolSpec[field] = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  if (field === "prdUiNotes") {
    slice.createToolPrdUiNotes = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  if (field === "prdInputs") {
    slice.createToolPrdInputs = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  if (field === "prdProcess") {
    slice.createToolPrdProcess = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  if (field === "prdConnections") {
    slice.createToolPrdConnections = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  if (field === "prdDependencies") {
    slice.createToolPrdDependencies = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  if (field === "prdExpectedBehavior") {
    slice.createToolPrdExpectedBehavior = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  if (field === "prdOutputs") {
    slice.createToolPrdOutputs = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  if (field === "prdMarkdownDoc") {
    applyPrdMarkdownDocument(slice, value);
    return;
  }
  if (field === "devPlan") {
    slice.createToolDevPlan = value;
    return;
  }
  if (field === "iconBrowserQuery") {
    slice.createToolIconBrowserQuery = value;
    return;
  }
  if (field === "fixNotes") {
    slice.createToolFixNotes = value;
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
  slice.createToolUiPreviewHtml = renderUiPreviewHtml(spec);
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
    if (slice.createToolStage === "build") {
      slice.createToolStage = "fix";
    }
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

export function setCreateToolStage(slice: CreateToolRuntimeSlice, stage: CreateToolStage): void {
  slice.createToolStage = stage;
  applyCreateToolStageUiState(slice);
}

export function advanceCreateToolStage(slice: CreateToolRuntimeSlice): void {
  const order: CreateToolStage[] = ["meta", "prd", "build", "fix"];
  const idx = order.indexOf(slice.createToolStage);
  if (idx < 0 || idx >= order.length - 1) return;
  slice.createToolStage = order[idx + 1] || "fix";
  applyCreateToolStageUiState(slice);
}

export function retreatCreateToolStage(slice: CreateToolRuntimeSlice): void {
  const order: CreateToolStage[] = ["meta", "prd", "build", "fix"];
  const idx = order.indexOf(slice.createToolStage);
  if (idx <= 0) return;
  slice.createToolStage = order[idx - 1] || "meta";
  applyCreateToolStageUiState(slice);
}

export function autoFillCreateToolPrdFromMeta(slice: CreateToolRuntimeSlice): void {
  const spec = normalizedSpec(slice.createToolSpec);
  slice.createToolSpec = spec;
  const title = spec.toolName || "Custom Tool";
  const description = spec.description || "No description provided.";
  const layout = humanizeUiPreset(slice.createToolPrdUiPreset);
  const modifiers = slice.createToolLayoutModifiers.length
    ? slice.createToolLayoutModifiers.join(", ")
    : "none";
  const model = slice.createToolSelectedModelId || "primary-agent";

  slice.createToolPrdUiNotes = slice.createToolPrdUiNotes.trim()
    ? slice.createToolPrdUiNotes
    : `Layout preset: ${layout}. Layout add-ons: ${modifiers}. Keep visual behavior consistent with workspace themes.`;
  slice.createToolPrdInputs = slice.createToolPrdInputs.trim()
    ? slice.createToolPrdInputs
    : `- Tool Name: ${title}\n- Tool ID: ${spec.toolId}\n- Description: ${description}\n- Generation Model: ${model}`;
  slice.createToolPrdProcess = slice.createToolPrdProcess.trim()
    ? slice.createToolPrdProcess
    : `1. Initialize tool shell.\n2. Render primary UI surface.\n3. Wire user actions and runtime handlers.\n4. Validate state transitions and error paths.`;
  slice.createToolPrdConnections = slice.createToolPrdConnections.trim()
    ? slice.createToolPrdConnections
    : `- Workspace host view builder\n- Workspace dispatch bindings\n- Files/Flow tools when needed`;
  slice.createToolPrdDependencies = slice.createToolPrdDependencies.trim()
    ? slice.createToolPrdDependencies
    : `- Tool registry manifest\n- createTool scaffold templates\n- icon map when custom icon is selected`;
  slice.createToolPrdExpectedBehavior = slice.createToolPrdExpectedBehavior.trim()
    ? slice.createToolPrdExpectedBehavior
    : `The tool should load instantly, preserve user edits, and provide clear feedback for long-running actions.`;
  slice.createToolPrdOutputs = slice.createToolPrdOutputs.trim()
    ? slice.createToolPrdOutputs
    : `- Scaffolded files under frontend/src/tools/${spec.toolId}\n- Host wiring patches\n- Optional icon asset copy`;
  slice.createToolStatusMessage = "PRD sections auto-filled from Meta.";
  syncPrdPreviewDocumentFromSections(slice);
}

export async function generateCreateToolPrdFromModel(
  slice: CreateToolRuntimeSlice,
  deps: CreateToolDeps
): Promise<void> {
  autoFillCreateToolPrdFromMeta(slice);
  if (!deps.client) return;

  const spec = normalizedSpec(slice.createToolSpec);
  slice.createToolSpec = spec;
  slice.createToolBusy = true;
  try {
    const correlationId = deps.nextCorrelationId();
    const response = await deps.client.createToolGenerateText({
      correlationId,
      modelId: slice.createToolSelectedModelId || "primary-agent",
      maxTokens: 1400,
      prompt: buildPrdPrompt(slice, spec)
    });
    applyPrdResponse(slice, response.text);
    slice.createToolStatusMessage = `PRD generated with ${response.resolvedModel}.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    slice.createToolStatusMessage = `PRD generation failed. Using local draft. (${message})`;
  } finally {
    slice.createToolBusy = false;
  }
  syncPrdPreviewDocumentFromSections(slice);
}

export async function generateCreateToolPrdSectionFromModel(
  slice: CreateToolRuntimeSlice,
  deps: CreateToolDeps,
  section: CreateToolPrdSection
): Promise<void> {
  const spec = normalizedSpec(slice.createToolSpec);
  slice.createToolSpec = spec;
  slice.createToolPrdGeneratingSection = section;
  try {
    if (!deps.client) {
      await streamPrdSectionValue(
        slice,
        section,
        fallbackPrdSectionText(slice, spec, section),
        deps.onUpdate
      );
      slice.createToolStatusMessage = `${sectionLabel(section)} section drafted from Meta.`;
      return;
    }
    const correlationId = deps.nextCorrelationId();
    const response = await deps.client.createToolGenerateText({
      correlationId,
      modelId: slice.createToolSelectedModelId || "primary-agent",
      maxTokens: 520,
      prompt: buildPrdSectionPrompt(slice, spec, section)
    });
    const refined = normalizePrdSectionResponse(response.text, section);
    await streamPrdSectionValue(
      slice,
      section,
      refined || fallbackPrdSectionText(slice, spec, section),
      deps.onUpdate
    );
    slice.createToolStatusMessage = `${sectionLabel(section)} section generated with ${response.resolvedModel}.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await streamPrdSectionValue(
      slice,
      section,
      fallbackPrdSectionText(slice, spec, section),
      deps.onUpdate
    );
    slice.createToolStatusMessage = `${sectionLabel(section)} section fallback applied. (${message})`;
  } finally {
    slice.createToolPrdGeneratingSection = null;
    deps.onUpdate?.();
  }
}

export async function runCreateToolPrdReview(
  slice: CreateToolRuntimeSlice,
  deps: CreateToolDeps
): Promise<void> {
  const spec = normalizedSpec(slice.createToolSpec);
  slice.createToolSpec = spec;
  slice.createToolPrdReviewBusy = true;
  try {
    const findings = buildDeterministicPrdReviewFindings(slice, spec);
    slice.createToolPrdReviewFindings = findings;
    slice.createToolStatusMessage = findings.length
      ? `PRD review found ${findings.length} item(s).`
      : "PRD review passed with no gaps.";
    syncPrdReviewDocument(slice, spec);
    deps.onUpdate?.();
  } finally {
    slice.createToolPrdReviewBusy = false;
    deps.onUpdate?.();
  }
}

export async function generateCreateToolDevPlanFromModel(
  slice: CreateToolRuntimeSlice,
  deps: CreateToolDeps
): Promise<void> {
  if (slice.createToolDevPlan.trim()) {
    return;
  }
  if (!deps.client) {
    slice.createToolDevPlan = fallbackDevPlan(slice);
    return;
  }

  const spec = normalizedSpec(slice.createToolSpec);
  slice.createToolSpec = spec;
  slice.createToolBusy = true;
  try {
    const correlationId = deps.nextCorrelationId();
    const response = await deps.client.createToolGenerateText({
      correlationId,
      modelId: slice.createToolSelectedModelId || "primary-agent",
      maxTokens: 1200,
      prompt: buildDevPlanPrompt(slice, spec)
    });
    slice.createToolDevPlan = response.text.trim() || fallbackDevPlan(slice);
    slice.createToolStatusMessage = `Development plan prepared by ${response.resolvedModel}.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    slice.createToolDevPlan = fallbackDevPlan(slice);
    slice.createToolStatusMessage = `Development plan fallback applied. (${message})`;
  } finally {
    slice.createToolBusy = false;
  }
}

export function setCreateToolBuildViewMode(
  slice: CreateToolRuntimeSlice,
  mode: "code" | "preview"
): void {
  slice.createToolBuildViewMode = mode;
}

export function toggleCreateToolLayoutModifier(
  slice: CreateToolRuntimeSlice,
  modifier: CreateToolRuntimeSlice["createToolLayoutModifiers"][number]
): void {
  if (slice.createToolLayoutModifiers.includes(modifier)) {
    slice.createToolLayoutModifiers = slice.createToolLayoutModifiers.filter((item) => item !== modifier);
    return;
  }
  slice.createToolLayoutModifiers = [...slice.createToolLayoutModifiers, modifier];
}

export async function browseCreateToolIcons(
  slice: CreateToolRuntimeSlice,
  deps: CreateToolDeps
): Promise<void> {
  if (!deps.client) {
    slice.createToolStatusMessage = "IPC client unavailable.";
    return;
  }

  slice.createToolBusy = true;
  try {
    const root = await resolveWorkspaceRoot(slice, deps);
    const iconsDir = `${root}/frontend/src/icons-all`;
    const listCorrelationId = deps.nextCorrelationId();
    const listResponse = await deps.client.toolInvoke({
      correlationId: listCorrelationId,
      toolId: "files",
      action: "list-directory",
      mode: "sandbox",
      payload: { correlationId: listCorrelationId, path: iconsDir }
    });
    if (!listResponse.ok) {
      throw new Error(listResponse.error || "Failed to list icons-all directory.");
    }

    const data = listResponse.data as { entries?: Array<{ name?: string; isDir?: boolean }> };
    const files = (data.entries || [])
      .filter((entry) => !entry.isDir)
      .map((entry) => (entry.name || "").trim())
      .filter((name) => name.toLowerCase().endsWith(".svg"))
      .sort((a, b) => a.localeCompare(b));

    const icons: Array<{ name: string; svg: string }> = [];
    for (const fileName of files) {
      const path = `${iconsDir}/${fileName}`;
      const svg = await readFile(deps.client, deps.nextCorrelationId, path);
      icons.push({ name: fileName, svg });
    }

    slice.createToolIconLibrary = icons;
    slice.createToolIconBrowserOpen = true;
    slice.createToolIconBrowserQuery = "";
    slice.createToolIconBrowserAppliedQuery = "";
    slice.createToolStatusMessage = `Loaded ${icons.length} icons from icons-all.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    slice.createToolStatusMessage = `Icon browser failed: ${message}`;
  } finally {
    slice.createToolBusy = false;
  }
}

export function selectCreateToolIcon(slice: CreateToolRuntimeSlice, fileName: string): void {
  const trimmed = fileName.trim();
  if (!trimmed) return;
  slice.createToolSpec.customIconFromAll = trimmed;
  const inferred = trimmed.replace(/\.svg$/i, "").trim();
  if (inferred) {
    slice.createToolSpec.iconKey = inferred;
  }
  slice.createToolStatusMessage = `Selected icon ${trimmed}.`;
}

export function closeCreateToolIconBrowser(slice: CreateToolRuntimeSlice): void {
  slice.createToolIconBrowserOpen = false;
  slice.createToolIconBrowserQuery = "";
  slice.createToolIconBrowserAppliedQuery = "";
}

export function applyCreateToolIconSearch(slice: CreateToolRuntimeSlice): void {
  slice.createToolIconBrowserAppliedQuery = slice.createToolIconBrowserQuery.trim();
}

function normalizeUiPreset(value: string): CreateToolUiPreset {
  if (
    value === "left-sidebar" ||
    value === "right-sidebar" ||
    value === "both-sidebars" ||
    value === "no-sidebar"
  ) {
    return value;
  }
  if (value === "toolbar-only") {
    return "no-sidebar";
  }
  return "left-sidebar";
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
    category: "workspace",
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
  return {
    "manifest.json": renderPluginManifest(spec),
    "permissions.json": renderPluginPermissions(spec),
    "dist/index.html": renderPluginIndexHtml(spec),
    "dist/main.js": renderPluginMainJs(spec),
    "README.md": renderPluginReadme(spec),
    "META.md": "",
    "PRD.md": "",
    "DEVELOPMENT_PLAN.md": ""
  };
}

function renderPluginManifest(spec: CreateToolSpec): string {
  return `${JSON.stringify(
    {
      id: spec.toolId,
      name: spec.toolName || spec.toolId,
      version: "1.0.0",
      entry: "dist/index.html",
      category: spec.category
    },
    null,
    2
  )}\n`;
}

function renderPluginPermissions(spec: CreateToolSpec): string {
  const capabilities: string[] = ["files.read"];
  if (spec.guardrails.allowIpc) {
    capabilities.push("tasks.read");
  }
  return `${JSON.stringify({ capabilities }, null, 2)}\n`;
}

function renderPluginIndexHtml(spec: CreateToolSpec): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(spec.toolName || spec.toolId)}</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background: #0f141b; color: #d8e0ea; }
      .wrap { padding: 12px; display: grid; gap: 10px; }
      .card { border: 1px solid #263241; border-radius: 8px; padding: 10px; background: #121922; }
      .title { margin: 0; font-size: 15px; }
      .desc { margin: 4px 0 0; color: #95a4b6; }
      .row { display: flex; gap: 8px; align-items: center; }
      button { height: 28px; border-radius: 6px; border: 1px solid #314156; background: #1a2430; color: #d8e0ea; cursor: pointer; padding: 0 10px; }
      button:hover { background: #223041; }
      pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: #b9c7d8; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1 class="title">${escapeHtml(spec.toolName || spec.toolId)}</h1>
        <p class="desc">${escapeHtml(spec.description || "Custom workspace tool")}</p>
      </div>
      <div class="card">
        <div class="row">
          <button id="readRootBtn" type="button">Read Workspace Root</button>
          <span id="status">Idle</span>
        </div>
      </div>
      <div class="card"><pre id="output">No output yet.</pre></div>
    </div>
    <script src="./main.js"></script>
  </body>
</html>
`;
}

function renderPluginMainJs(spec: CreateToolSpec): string {
  const safeTitle = JSON.stringify(spec.toolName || spec.toolId);
  return `(() => {
  const status = document.getElementById("status");
  const output = document.getElementById("output");
  const readRootBtn = document.getElementById("readRootBtn");
  let pending = new Map();
  let initialized = false;

  function setStatus(text) {
    if (status) status.textContent = text;
  }
  function setOutput(text) {
    if (output) output.textContent = text;
  }

  function post(message) {
    window.parent.postMessage(message, "*");
  }

  function invoke(capability, payload) {
    return new Promise((resolve, reject) => {
      const requestId = "req-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
      pending.set(requestId, { resolve, reject });
      post({ type: "capability.invoke", requestId, capability, payload });
      setTimeout(() => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        reject(new Error("Capability request timed out"));
      }, 15000);
    });
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "customTool.init" || data.type === "plugin.init") {
      if (!initialized) {
        initialized = true;
        setStatus("Ready");
      }
      return;
    }
    if (data.type !== "capability.result") return;
    const row = pending.get(data.requestId);
    if (!row) return;
    pending.delete(data.requestId);
    if (data.ok) {
      row.resolve(data.data || {});
    } else {
      row.reject(new Error(data.error || "Capability failed"));
    }
  });

  if (readRootBtn) {
    readRootBtn.addEventListener("click", async () => {
      try {
        setStatus("Loading...");
        const result = await invoke("files.read", { action: "list-directory" });
        setOutput(JSON.stringify(result, null, 2));
        setStatus("Ready");
      } catch (error) {
        setStatus("Error");
        setOutput(String(error));
      }
    });
  }

  post({ type: "customTool.ready", title: ${safeTitle} });
})();\n`;
}

function renderPluginReadme(spec: CreateToolSpec): string {
  return `# ${spec.toolName || spec.toolId}

Generated by Create Tool as an isolated plugin under \`plugins/${spec.toolId}\`.

## Guardrails
- allowLocalStorage: ${String(spec.guardrails.allowLocalStorage)}
- allowIpc: ${String(spec.guardrails.allowIpc)}
- allowExternalNetwork: ${String(spec.guardrails.allowExternalNetwork)}
- readOnlyMode: ${String(spec.guardrails.readOnlyMode)}

## Runtime Model
- Loaded in iframe via workspace plugin host
- Communicates with host using \`postMessage\` capability bridge
`;
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
  dataAction: string
): string {
  const title = escapeHtml(spec.toolName || pascal);
  const description = escapeHtml(spec.description || "Custom tool scaffold");
  const hint = "Custom tool scaffold generated by Create Tool.";
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

function renderMetaMarkdown(spec: CreateToolSpec, slice: CreateToolRuntimeSlice): string {
  return `# Meta

## Tool
- Name: ${spec.toolName || "Untitled Tool"}
- ID: ${spec.toolId || "untitled-tool"}
- Description: ${spec.description || "No description provided."}
- Icon Key: ${spec.iconKey}
- Custom Icon: ${spec.customIconFromAll || "(none)"}
- Model: ${slice.createToolSelectedModelId || "primary-agent"}
- UI Preset: ${humanizeUiPreset(slice.createToolPrdUiPreset)}
- Other UI Features: ${slice.createToolLayoutModifiers.length ? slice.createToolLayoutModifiers.join(", ") : "none"}

## Guardrails
- allowLocalStorage: ${String(spec.guardrails.allowLocalStorage)}
- allowIpc: ${String(spec.guardrails.allowIpc)}
- allowExternalNetwork: ${String(spec.guardrails.allowExternalNetwork)}
- readOnlyMode: ${String(spec.guardrails.readOnlyMode)}
`;
}

function renderPrdMarkdown(spec: CreateToolSpec, slice: CreateToolRuntimeSlice): string {
  return `# Product Requirements Definition

Tool: ${spec.toolName || "Untitled Tool"} (${spec.toolId || "untitled-tool"})

## UI
${slice.createToolPrdUiNotes.trim() || "(empty)"}

## Inputs
${slice.createToolPrdInputs.trim() || "(empty)"}

## Process
${slice.createToolPrdProcess.trim() || "(empty)"}

## Connections
${slice.createToolPrdConnections.trim() || "(empty)"}

## Dependencies
${slice.createToolPrdDependencies.trim() || "(empty)"}

## Expected Behavior
${slice.createToolPrdExpectedBehavior.trim() || "(empty)"}

## Outputs
${slice.createToolPrdOutputs.trim() || "(empty)"}
`;
}

function renderDevelopmentPlanMarkdown(spec: CreateToolSpec, slice: CreateToolRuntimeSlice): string {
  return `# Development Plan

Tool: ${spec.toolName || "Untitled Tool"} (${spec.toolId || "untitled-tool"})

${slice.createToolDevPlan.trim() || "No development plan was captured yet."}
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
  files["META.md"] = renderMetaMarkdown(spec, slice);
  files["PRD.md"] = renderPrdMarkdown(spec, slice);
  files["DEVELOPMENT_PLAN.md"] = renderDevelopmentPlanMarkdown(spec, slice);
  files["REVIEW.md"] = renderPrdReviewMarkdown(slice.createToolPrdReviewFindings, spec);
  const createdFiles: string[] = [];
  const patchedFiles: string[] = [];
  const warnings = [...slice.createToolValidationWarnings];
  const errors: string[] = [];

  const toolDir = `${root}/plugins/${spec.toolId}`;
  if (await pathExists(deps.client, deps.nextCorrelationId, toolDir)) {
    throw new Error(`Tool directory already exists at plugins/${spec.toolId}. Choose a different Tool Name/ID.`);
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = `${toolDir}/${relativePath}`;
    await writeFile(deps.client, deps.nextCorrelationId, absolute, content);
    createdFiles.push(absolute);
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

async function pathExists(
  client: ChatIpcClient,
  nextCorrelationId: () => string,
  path: string
): Promise<boolean> {
  try {
    const correlationId = nextCorrelationId();
    const response = await client.toolInvoke({
      correlationId,
      toolId: "files",
      action: "list-directory",
      mode: "sandbox",
      payload: { correlationId, path }
    });
    return response.ok;
  } catch {
    return false;
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

function humanizeUiPreset(value: CreateToolUiPreset): string {
  if (value === "left-sidebar") return "Left Sidebar";
  if (value === "right-sidebar") return "Right Sidebar";
  if (value === "both-sidebars") return "Both Sidebars";
  return "No Sidebar";
}

function buildPrdPrompt(slice: CreateToolRuntimeSlice, spec: CreateToolSpec): string {
  return [
    "You are generating a Product Requirements Definition for an internal workspace tool.",
    "Return plain text with these exact section headers:",
    "[UI]",
    "[INPUTS]",
    "[PROCESS]",
    "[CONNECTIONS]",
    "[DEPENDENCIES]",
    "[EXPECTED_BEHAVIOR]",
    "[OUTPUTS]",
    "",
    `Tool Name: ${spec.toolName || "Untitled Tool"}`,
    `Tool ID: ${spec.toolId || "untitled-tool"}`,
    `Description: ${spec.description || "No description provided."}`,
    `UI Preset: ${humanizeUiPreset(slice.createToolPrdUiPreset)}`,
    `Other UI Features: ${slice.createToolLayoutModifiers.length ? slice.createToolLayoutModifiers.join(", ") : "none"}`,
    `Icon: ${spec.iconKey}`,
    "",
    "Existing draft content to refine:",
    `[UI]\n${slice.createToolPrdUiNotes || "(empty)"}`,
    `[INPUTS]\n${slice.createToolPrdInputs || "(empty)"}`,
    `[PROCESS]\n${slice.createToolPrdProcess || "(empty)"}`,
    `[CONNECTIONS]\n${slice.createToolPrdConnections || "(empty)"}`,
    `[DEPENDENCIES]\n${slice.createToolPrdDependencies || "(empty)"}`,
    `[EXPECTED_BEHAVIOR]\n${slice.createToolPrdExpectedBehavior || "(empty)"}`,
    `[OUTPUTS]\n${slice.createToolPrdOutputs || "(empty)"}`
  ].join("\n");
}

function buildDevPlanPrompt(slice: CreateToolRuntimeSlice, spec: CreateToolSpec): string {
  return [
    "Create a detailed implementation plan before coding for this workspace tool.",
    "Return concise markdown with sections: Goal, Workstreams, Sequence, Risks, Validation Checklist.",
    "Keep it action-oriented and specific to this app's architecture.",
    "",
    `Tool Name: ${spec.toolName || "Untitled Tool"}`,
    `Tool ID: ${spec.toolId || "untitled-tool"}`,
    `Description: ${spec.description || "No description provided."}`,
    "",
    "PRD context:",
    `UI: ${slice.createToolPrdUiNotes || "(empty)"}`,
    `Inputs: ${slice.createToolPrdInputs || "(empty)"}`,
    `Process: ${slice.createToolPrdProcess || "(empty)"}`,
    `Connections: ${slice.createToolPrdConnections || "(empty)"}`,
    `Dependencies: ${slice.createToolPrdDependencies || "(empty)"}`,
    `Expected Behavior: ${slice.createToolPrdExpectedBehavior || "(empty)"}`,
    `Outputs: ${slice.createToolPrdOutputs || "(empty)"}`
  ].join("\n");
}

function buildPrdSectionPrompt(
  slice: CreateToolRuntimeSlice,
  spec: CreateToolSpec,
  section: CreateToolPrdSection
): string {
  const current = getPrdSectionValue(slice, section).trim() || "(empty)";
  const template = sectionPromptTemplate(section);
  return interpolatePromptTemplate(template, {
    TOOL_NAME: spec.toolName || "Untitled Tool",
    TOOL_ID: spec.toolId || "untitled-tool",
    DESCRIPTION: spec.description || "No description provided.",
    UI_PRESET: humanizeUiPreset(slice.createToolPrdUiPreset),
    OTHER_UI_FEATURES: slice.createToolLayoutModifiers.length
      ? slice.createToolLayoutModifiers.join(", ")
      : "none",
    ICON: spec.iconKey || "wrench",
    CURRENT_DRAFT: current
  });
}

function applyPrdResponse(slice: CreateToolRuntimeSlice, text: string): void {
  const raw = text.trim();
  if (!raw) return;
  const sections = parseTaggedSections(raw);
  slice.createToolPrdUiNotes = sections.UI || slice.createToolPrdUiNotes;
  slice.createToolPrdInputs = sections.INPUTS || slice.createToolPrdInputs;
  slice.createToolPrdProcess = sections.PROCESS || slice.createToolPrdProcess;
  slice.createToolPrdConnections = sections.CONNECTIONS || slice.createToolPrdConnections;
  slice.createToolPrdDependencies = sections.DEPENDENCIES || slice.createToolPrdDependencies;
  slice.createToolPrdExpectedBehavior =
    sections.EXPECTED_BEHAVIOR || slice.createToolPrdExpectedBehavior;
  slice.createToolPrdOutputs = sections.OUTPUTS || slice.createToolPrdOutputs;
  syncPrdPreviewDocumentFromSections(slice);
}

function parseTaggedSections(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /^\[([A-Z_]+)\]\s*$/gm;
  const matches: Array<{ key: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null = regex.exec(text);
  while (match) {
    const key = match[1] || "";
    if (key) {
      matches.push({ key, start: match.index, end: regex.lastIndex });
    }
    match = regex.exec(text);
  }
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    if (!current) continue;
    const body = text.slice(current.end, next?.start ?? text.length).trim();
    result[current.key] = body;
  }
  return result;
}

function sectionLabel(section: CreateToolPrdSection): string {
  if (section === "UI") return "UI";
  if (section === "INPUTS") return "Inputs";
  if (section === "PROCESS") return "Process";
  if (section === "CONNECTIONS") return "Connections";
  if (section === "DEPENDENCIES") return "Dependencies";
  if (section === "EXPECTED_BEHAVIOR") return "Expected Behavior";
  return "Outputs";
}

function sectionPromptTemplate(section: CreateToolPrdSection): string {
  if (section === "UI") return prdUiPromptTemplate;
  if (section === "INPUTS") return prdInputsPromptTemplate;
  if (section === "PROCESS") return prdProcessPromptTemplate;
  if (section === "CONNECTIONS") return prdConnectionsPromptTemplate;
  if (section === "DEPENDENCIES") return prdDependenciesPromptTemplate;
  if (section === "EXPECTED_BEHAVIOR") return prdExpectedBehaviorPromptTemplate;
  return prdOutputsPromptTemplate;
}

function interpolatePromptTemplate(template: string, values: Record<string, string>): string {
  let next = template;
  for (const [key, value] of Object.entries(values)) {
    next = next.replaceAll(`{{${key}}}`, value);
  }
  return next;
}

function getPrdSectionValue(slice: CreateToolRuntimeSlice, section: CreateToolPrdSection): string {
  if (section === "UI") return slice.createToolPrdUiNotes;
  if (section === "INPUTS") return slice.createToolPrdInputs;
  if (section === "PROCESS") return slice.createToolPrdProcess;
  if (section === "CONNECTIONS") return slice.createToolPrdConnections;
  if (section === "DEPENDENCIES") return slice.createToolPrdDependencies;
  if (section === "EXPECTED_BEHAVIOR") return slice.createToolPrdExpectedBehavior;
  return slice.createToolPrdOutputs;
}

function setPrdSectionValue(
  slice: CreateToolRuntimeSlice,
  section: CreateToolPrdSection,
  value: string
): void {
  if (section === "UI") {
    slice.createToolPrdUiNotes = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  if (section === "INPUTS") {
    slice.createToolPrdInputs = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  if (section === "PROCESS") {
    slice.createToolPrdProcess = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  if (section === "CONNECTIONS") {
    slice.createToolPrdConnections = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  if (section === "DEPENDENCIES") {
    slice.createToolPrdDependencies = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  if (section === "EXPECTED_BEHAVIOR") {
    slice.createToolPrdExpectedBehavior = value;
    syncPrdPreviewDocumentFromSections(slice);
    return;
  }
  slice.createToolPrdOutputs = value;
  syncPrdPreviewDocumentFromSections(slice);
}

async function streamPrdSectionValue(
  slice: CreateToolRuntimeSlice,
  section: CreateToolPrdSection,
  value: string,
  onUpdate?: () => void
): Promise<void> {
  const finalText = value.trim();
  if (!finalText) {
    setPrdSectionValue(slice, section, "");
    onUpdate?.();
    return;
  }
  const chunks = chunkForStreaming(finalText, 22);
  let acc = "";
  for (const chunk of chunks) {
    acc += chunk;
    setPrdSectionValue(slice, section, acc);
    onUpdate?.();
    await sleepMs(14);
  }
}

function chunkForStreaming(text: string, chunkSize: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    out.push(text.slice(i, i + chunkSize));
  }
  return out;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function applyPrdMarkdownDocument(slice: CreateToolRuntimeSlice, markdown: string): void {
  const nextMarkdown = markdown;
  slice.createToolPreviewFiles = {
    ...slice.createToolPreviewFiles,
    "PRD.md": nextMarkdown
  };
  slice.createToolSelectedPreviewPath = "PRD.md";
  const sections = parsePrdMarkdownSections(nextMarkdown);
  if (typeof sections.UI === "string") slice.createToolPrdUiNotes = sections.UI;
  if (typeof sections.INPUTS === "string") slice.createToolPrdInputs = sections.INPUTS;
  if (typeof sections.PROCESS === "string") slice.createToolPrdProcess = sections.PROCESS;
  if (typeof sections.CONNECTIONS === "string") slice.createToolPrdConnections = sections.CONNECTIONS;
  if (typeof sections.DEPENDENCIES === "string") slice.createToolPrdDependencies = sections.DEPENDENCIES;
  if (typeof sections.EXPECTED_BEHAVIOR === "string") {
    slice.createToolPrdExpectedBehavior = sections.EXPECTED_BEHAVIOR;
  }
  if (typeof sections.OUTPUTS === "string") slice.createToolPrdOutputs = sections.OUTPUTS;
}

function parsePrdMarkdownSections(markdown: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /^##\s+([^\n]+)\s*$/gm;
  const matches: Array<{ key: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null = regex.exec(markdown);
  while (match) {
    const raw = (match[1] || "").trim().toLowerCase();
    const key = toPrdMarkdownKey(raw);
    if (key) {
      matches.push({ key, start: match.index, end: regex.lastIndex });
    }
    match = regex.exec(markdown);
  }
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    if (!current) continue;
    result[current.key] = markdown.slice(current.end, next?.start ?? markdown.length).trim();
  }
  return result;
}

function toPrdMarkdownKey(raw: string): string | null {
  if (raw === "ui") return "UI";
  if (raw === "inputs") return "INPUTS";
  if (raw === "process") return "PROCESS";
  if (raw === "connections") return "CONNECTIONS";
  if (raw === "dependencies") return "DEPENDENCIES";
  if (raw === "expected behavior") return "EXPECTED_BEHAVIOR";
  if (raw === "outputs") return "OUTPUTS";
  return null;
}

function syncPrdPreviewDocumentFromSections(slice: CreateToolRuntimeSlice): void {
  const spec = normalizedSpec(slice.createToolSpec);
  slice.createToolSpec = spec;
  const doc = renderPrdMarkdown(spec, slice);
  slice.createToolPreviewFiles = {
    ...slice.createToolPreviewFiles,
    "PRD.md": doc
  };
  if (!slice.createToolPreviewOrder.includes("PRD.md")) {
    slice.createToolPreviewOrder = ["PRD.md", ...slice.createToolPreviewOrder];
  }
}

function normalizePrdSectionResponse(text: string, section: CreateToolPrdSection): string {
  const raw = text.trim();
  if (!raw) return "";
  const tagged = parseTaggedSections(raw);
  const taggedValue = tagged[section];
  if (typeof taggedValue === "string" && taggedValue.trim()) {
    return taggedValue.trim();
  }
  return raw
    .replace(/^```[\w-]*\s*/g, "")
    .replace(/\s*```$/g, "")
    .trim();
}

function fallbackPrdSectionText(
  slice: CreateToolRuntimeSlice,
  spec: CreateToolSpec,
  section: CreateToolPrdSection
): string {
  const title = spec.toolName || "Custom Tool";
  const description = spec.description || "No description provided.";
  const model = slice.createToolSelectedModelId || "primary-agent";
  if (section === "UI") {
    return `Use ${humanizeUiPreset(slice.createToolPrdUiPreset)} with workspace-consistent styling. Include toolbar actions and clear states for empty/loading/error.`;
  }
  if (section === "INPUTS") {
    return `- Tool Name: ${title}\n- Tool ID: ${spec.toolId}\n- Description: ${description}\n- Model: ${model}`;
  }
  if (section === "PROCESS") {
    return `1. Collect user input.\n2. Validate required fields.\n3. Execute tool logic.\n4. Render result and status feedback.`;
  }
  if (section === "CONNECTIONS") {
    return `- Workspace host view builder\n- Workspace dispatch bindings\n- Related workspace tools as needed`;
  }
  if (section === "DEPENDENCIES") {
    return `- Tool registry manifest\n- Create Tool scaffold templates\n- Icons map/assets when icon is selected`;
  }
  if (section === "EXPECTED_BEHAVIOR") {
    return `The tool should be responsive, preserve user draft state, and provide explicit error handling and recovery actions.`;
  }
  return `- Generated tool files under frontend/src/tools/${spec.toolId}\n- Host wiring updates\n- Ready-for-fix iteration context in chat`;
}

function buildDeterministicPrdReviewFindings(
  slice: CreateToolRuntimeSlice,
  spec: CreateToolSpec
): CreateToolRuntimeSlice["createToolPrdReviewFindings"] {
  const findings: CreateToolRuntimeSlice["createToolPrdReviewFindings"] = [];
  const toolContext = [
    spec.toolName,
    spec.description,
    slice.createToolPrdUiNotes,
    slice.createToolPrdInputs,
    slice.createToolPrdProcess,
    slice.createToolPrdConnections,
    slice.createToolPrdDependencies,
    slice.createToolPrdExpectedBehavior,
    slice.createToolPrdOutputs
  ]
    .join("\n")
    .toLowerCase();

  const hasAny = (patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(toolContext));
  const pushFinding = (
    severity: "critical" | "high" | "medium",
    section: "INPUTS" | "PROCESS" | "CONNECTIONS" | "DEPENDENCIES" | "EXPECTED_BEHAVIOR" | "OUTPUTS",
    title: string,
    detail: string,
    suggestion: string
  ): void => {
    findings.push({ severity, section, title, detail, suggestion });
  };

  if (!slice.createToolPrdInputs.trim()) {
    pushFinding(
      "critical",
      "INPUTS",
      "Inputs section is empty",
      "No concrete user/system inputs are specified.",
      "List all required and optional inputs, formats, validation rules, and defaults."
    );
  }
  if (!slice.createToolPrdProcess.trim()) {
    pushFinding(
      "critical",
      "PROCESS",
      "Process section is empty",
      "Execution flow is not defined.",
      "Define step-by-step flow including validation, failure paths, and success completion criteria."
    );
  }
  if (!slice.createToolPrdConnections.trim()) {
    pushFinding(
      "high",
      "CONNECTIONS",
      "Connections are under-defined",
      "Integrations with internal/external services are missing.",
      "Specify each service connection, payload exchanged, and error-handling behavior."
    );
  }

  const looksLikeEmailClient = hasAny([/\bemail\b/, /\binbox\b/, /\bmail\b/, /\bsmtp\b/, /\bimap\b/]);
  if (looksLikeEmailClient) {
    if (!hasAny([/\bsmtp\b/, /outgoing server/, /send server/])) {
      pushFinding(
        "critical",
        "INPUTS",
        "Missing SMTP configuration inputs",
        "Email client functionality requires SMTP details for sending mail.",
        "Add SMTP host, port, username, password/app password, TLS/SSL, and auth method to Inputs."
      );
    }
    if (!hasAny([/\bimap\b/, /\bpop3\b/, /incoming server/, /receive server/])) {
      pushFinding(
        "critical",
        "INPUTS",
        "Missing incoming mail configuration inputs",
        "Receiving/syncing mail requires IMAP (or POP3) account settings.",
        "Add IMAP host, port, credentials, TLS/SSL, and sync behavior (folder refresh cadence) to Inputs."
      );
    }
    if (!hasAny([/sync/, /fetch/, /refresh inbox/, /receive/])) {
      pushFinding(
        "high",
        "PROCESS",
        "Inbox synchronization flow is missing",
        "The PRD does not clearly define receive/sync behavior.",
        "Add a process for account connect, initial fetch, incremental sync, and retry on failures."
      );
    }
    if (!hasAny([/auth/, /credential/, /token/, /oauth/, /password/])) {
      pushFinding(
        "high",
        "DEPENDENCIES",
        "Authentication requirements are missing",
        "Email clients require explicit authentication handling and storage rules.",
        "Define auth method support, secure credential storage, token refresh handling, and revocation behavior."
      );
    }
  }

  return findings;
}

function syncPrdReviewDocument(slice: CreateToolRuntimeSlice, spec: CreateToolSpec): void {
  const report = renderPrdReviewMarkdown(slice.createToolPrdReviewFindings, spec);
  slice.createToolPreviewFiles = {
    ...slice.createToolPreviewFiles,
    "REVIEW.md": report
  };
  if (!slice.createToolPreviewOrder.includes("REVIEW.md")) {
    slice.createToolPreviewOrder = [...slice.createToolPreviewOrder, "REVIEW.md"];
  }
}

function renderPrdReviewMarkdown(
  findings: CreateToolRuntimeSlice["createToolPrdReviewFindings"],
  spec: CreateToolSpec
): string {
  const header = `# PRD Review\n\nTool: ${spec.toolName || "Untitled Tool"} (${spec.toolId || "untitled-tool"})\n`;
  if (!findings.length) {
    return `${header}\nStatus: PASS\n\nNo missing core requirements detected by deterministic review.\n`;
  }
  const body = findings
    .map((item, idx) => {
      return [
        `## Finding ${idx + 1} (${item.severity.toUpperCase()})`,
        `Section: ${item.section}`,
        `Title: ${item.title}`,
        ``,
        item.detail,
        ``,
        `Suggested update:`,
        item.suggestion
      ].join("\n");
    })
    .join("\n\n");
  return `${header}\nStatus: NEEDS WORK\n\n${body}\n`;
}

function fallbackDevPlan(slice: CreateToolRuntimeSlice): string {
  const toolName = slice.createToolSpec.toolName.trim() || "Custom Tool";
  return [
    `Goal`,
    `Implement ${toolName} with stable workspace integration.`,
    ``,
    `Workstreams`,
    `1. Finalize PRD sections and resolve open assumptions.`,
    `2. Generate scaffold files and patch host wiring.`,
    `3. Validate guardrails, actions, and UI rendering behavior.`,
    `4. Run build checks and perform fix pass in chat.`,
    ``,
    `Sequence`,
    `- Prepare preview and validation`,
    `- Build files`,
    `- Verify behavior and iterate`,
    ``,
    `Risks`,
    `- ID/name drift causing broken imports`,
    `- Incomplete dependency wiring in host runtime`,
    ``,
    `Validation Checklist`,
    `- Tool appears in workspace registry`,
    `- Toolbar actions execute`,
    `- Files compile and lint/build cleanly`
  ].join("\n");
}

function applyCreateToolStageUiState(slice: CreateToolRuntimeSlice): void {
  if (slice.createToolStage !== "meta" && slice.createToolIconBrowserOpen) {
    slice.createToolIconBrowserOpen = false;
    slice.createToolIconBrowserQuery = "";
    slice.createToolIconBrowserAppliedQuery = "";
  }
  if (slice.createToolStage !== "prd") {
    slice.createToolPrdGeneratingAll = false;
    slice.createToolPrdGeneratingSection = null;
  }
  if (slice.createToolStage === "prd") {
    syncPrdPreviewDocumentFromSections(slice);
    slice.createToolSelectedPreviewPath = "PRD.md";
  }
}

function renderUiPreviewHtml(spec: CreateToolSpec): string {
  const name = escapeHtml(spec.toolName || "Untitled Tool");
  return `<div style="padding:12px;font:13px/1.45 ui-sans-serif,system-ui,sans-serif;color:#253142;">
    <div style="font-weight:600;margin-bottom:6px;">${name} Preview</div>
    <div style="opacity:.8;">UI preview placeholder generated during Step 3.</div>
  </div>`;
}
