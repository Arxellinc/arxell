export type LooperPhase = "planner" | "executor" | "validator" | "critic";

export interface LooperSubStep {
  id: string;
  label: string;
  status: "pending" | "running" | "complete" | "error" | "skipped";
}

export interface LooperPhaseState {
  phase: LooperPhase;
  status: "idle" | "running" | "complete" | "error" | "blocked";
  agentId: string | null;
  sessionId: string | null;
  substeps: LooperSubStep[];
  prompt: string;
  promptDraft: string;
  promptEditing: boolean;
}

export interface LooperLoopRun {
  id: string;
  iteration: number;
  status: "idle" | "running" | "paused" | "completed" | "failed" | "blocked";
  startedAtMs: number;
  completedAtMs: number | null;
  activePhase: LooperPhase | null;
  phases: Record<LooperPhase, LooperPhaseState>;
  reviewResult: "ship" | "revise" | null;
  reviewBeforeExecute: boolean;
  plannerPlan: string;
  projectId: string;
  pendingQuestions: Array<{
    id: string;
    title: string;
    prompt: string;
    options: Array<{ id: string; label: string; summary?: string }>;
  }>;
  reviewAnswers: Record<string, { selectedOptionId: string; freeformText: string }>;
  preview: {
    status: "idle" | "starting" | "running" | "failed" | "stopped";
    command: string | null;
    url: string | null;
    sessionId: string | null;
    lastError: string | null;
  };
  launchConfig?: {
    cwd: string;
    taskPath: string;
    specsGlob: string;
    maxIterations: number;
    phaseModels: Record<string, string>;
    projectName: string;
    projectType: string;
    projectIcon: string;
    projectDescription: string;
    reviewBeforeExecute?: boolean;
  };
}

export interface LooperToolState {
  loops: LooperLoopRun[];
  activeLoopId: string | null;
  busy: boolean;
  maxIterations: number;
  taskPath: string;
  specsGlob: string;
  cwd: string;
  planVisible: boolean;
  planContent: string;
  configOpen: boolean;
  configCwdDraft: string;
  configTaskPathDraft: string;
  configSpecsGlobDraft: string;
  configMaxIterationsDraft: number;
  nextLoopIndex: number;
  projectNameDraft: string;
  projectTypeDraft: string;
  projectIconDraft: string;
  projectDescriptionDraft: string;
  projectIdDraft: string;
  reviewBeforeExecuteDraft: boolean;
  phaseModels: Record<string, string>;
  availableModels: Array<{ id: string; label: string }>;
  installModalOpen: boolean;
  installChecking: boolean;
  installed: boolean | null;
  statusMessage: string | null;
  directoryPreviewRoots: { projectsRoot: string; toolsRoot: string } | null;
}

export const LOOPER_PHASES: LooperPhase[] = ["planner", "executor", "validator", "critic"];

export const LOOPER_PHASE_LABELS: Record<LooperPhase, string> = {
  planner: "Planner",
  executor: "Executor",
  validator: "Validator",
  critic: "Critic"
};

export const LOOPER_PHASE_ICONS: Record<LooperPhase, string> = {
  planner: "brain",
  executor: "play",
  validator: "square-check-big",
  critic: "message-square"
};

export const LOOPER_PROJECT_TYPE_OPTIONS = [
  "app-tool",
  "standalone-app",
  "api-backend-service",
  "cli-tool",
  "library-sdk",
  "browser-extension",
  "data-pipeline-etl",
  "ai-agent-assistant",
  "other"
];

export const DEFAULT_PLANNER_SUBSTEPS: LooperSubStep[] = [
  { id: "p-read-task", label: "Read task.md", status: "pending" },
  { id: "p-read-specs", label: "Read specs", status: "pending" },
  { id: "p-read-code", label: "Read codebase", status: "pending" },
  { id: "p-read-plan", label: "Read plan", status: "pending" },
  { id: "p-gap-analysis", label: "Gap analysis", status: "pending" },
  { id: "p-write-plan", label: "Write plan", status: "pending" }
];

export const DEFAULT_EXECUTOR_SUBSTEPS: LooperSubStep[] = [
  { id: "e-read-task", label: "Pick task", status: "pending" },
  { id: "e-inspect", label: "Inspect files", status: "pending" },
  { id: "e-implement", label: "Implement", status: "pending" },
  { id: "e-summary", label: "Write summary", status: "pending" }
];

export const DEFAULT_VALIDATOR_SUBSTEPS: LooperSubStep[] = [
  { id: "v-tests", label: "Run tests", status: "pending" },
  { id: "v-lint", label: "Run lint", status: "pending" },
  { id: "v-typecheck", label: "Run type-check", status: "pending" },
  { id: "v-acceptance", label: "Acceptance checks", status: "pending" }
];

export const DEFAULT_CRITIC_SUBSTEPS: LooperSubStep[] = [
  { id: "c-review", label: "Review code", status: "pending" },
  { id: "c-check-diffs", label: "Check diffs", status: "pending" },
  { id: "c-decide", label: "Ship or Revise", status: "pending" }
];

export const DEFAULT_SUBSTEPS: Record<LooperPhase, LooperSubStep[]> = {
  planner: DEFAULT_PLANNER_SUBSTEPS,
  executor: DEFAULT_EXECUTOR_SUBSTEPS,
  validator: DEFAULT_VALIDATOR_SUBSTEPS,
  critic: DEFAULT_CRITIC_SUBSTEPS
};

export const DEFAULT_PROMPTS: Record<LooperPhase, string> = {
  planner: `You are the Planner agent. Read task.md, specs/*.md, current codebase, and existing implementation_plan.md. Perform gap analysis and reprioritize the plan. Write the updated implementation_plan.md. Do NOT write production code.`,
  executor: `You are the Executor agent. Read the top unfinished task from implementation_plan.md. Inspect relevant files, implement the change, and write a work_summary.txt. Focus on a single task at a time.`,
  validator: `You are the Validator agent. Run all tests, lint, type-check, and any acceptance checks. Report results in validation_report.txt. Be thorough and objective.`,
  critic: `You are the Critic agent. Review the code changes, diffs, logs, and work_summary.txt. Decide if this is shippable. Write review_result.txt with SHIP or REVISE, and review_feedback.txt with targeted feedback.`
};

function createPhaseState(phase: LooperPhase, projectContext?: string): LooperPhaseState {
  const basePrompt = DEFAULT_PROMPTS[phase];
  const prompt = phase === "planner" && projectContext
    ? `${projectContext}\n\n${basePrompt}`
    : basePrompt;
  return {
    phase,
    status: "idle",
    agentId: null,
    sessionId: null,
    substeps: DEFAULT_SUBSTEPS[phase].map((s) => ({ ...s, status: "pending" as const })),
    prompt,
    promptDraft: prompt,
    promptEditing: false
  };
}

export interface LooperProjectSetup {
  projectName: string;
  projectType: string;
  projectIcon: string;
  projectDescription: string;
}

export function createLoopRun(index: number, cwd: string, setup?: LooperProjectSetup): LooperLoopRun {
  const projectContext = setup?.projectName
    ? [
        `Project: ${setup.projectName}`,
        `Type: ${setup.projectType}`,
        setup.projectType === "app-tool" ? `Icon: ${setup.projectIcon}` : null,
        setup.projectDescription ? `\n${setup.projectDescription}` : null
      ].filter(Boolean).join("\n")
    : undefined;

  return {
    id: `loop-${Date.now()}-${index}`,
    iteration: index,
    status: "idle",
    startedAtMs: Date.now(),
    completedAtMs: null,
    activePhase: null,
    phases: {
      planner: createPhaseState("planner", projectContext),
      executor: createPhaseState("executor"),
      validator: createPhaseState("validator"),
      critic: createPhaseState("critic")
    },
    reviewResult: null,
    reviewBeforeExecute: true,
    plannerPlan: "",
    projectId: "",
    pendingQuestions: [],
    reviewAnswers: {},
    preview: {
      status: "idle",
      command: null,
      url: null,
      sessionId: null,
      lastError: null
    }
  };
}

export function getInitialLooperState(): LooperToolState {
  return {
    loops: [],
    activeLoopId: null,
    busy: false,
    maxIterations: 10,
    taskPath: "task.md",
    specsGlob: "specs/*.md",
    cwd: "",
    planVisible: false,
    planContent: "",
    configOpen: false,
    configCwdDraft: "",
    configTaskPathDraft: "task.md",
    configSpecsGlobDraft: "specs/*.md",
    configMaxIterationsDraft: 10,
    nextLoopIndex: 1,
    projectNameDraft: "",
    projectTypeDraft: "app-tool",
    projectIconDraft: "refresh-cw",
    projectDescriptionDraft: "",
    projectIdDraft: "",
    reviewBeforeExecuteDraft: true,
    phaseModels: {},
    availableModels: [],
    installModalOpen: false,
    installChecking: false,
    installed: null,
    statusMessage: null,
    directoryPreviewRoots: getDefaultLooperDirectoryPreviewRoots()
  };
}

function getDefaultLooperDirectoryPreviewRoots(): { projectsRoot: string; toolsRoot: string } {
  const documentsRoot = inferDocumentsRoot();
  return {
    projectsRoot: joinPath(documentsRoot, "Arxell/Projects"),
    toolsRoot: inferToolsRoot()
  };
}

function inferDocumentsRoot(): string {
  const home = inferHomeDirectory();
  return joinPath(home || "~", "Documents");
}

function inferHomeDirectory(): string {
  const winHome = [
    readGlobalEnv("USERPROFILE"),
    joinPath(readGlobalEnv("HOMEDRIVE"), readGlobalEnv("HOMEPATH")),
    readGlobalEnv("HOME")
  ].find((value) => value && value.trim());
  if (winHome) return winHome;
  return readGlobalEnv("HOME") || "";
}

function readGlobalEnv(key: string): string {
  const value = (globalThis as { __ARXELL_ENV__?: Record<string, string> }).__ARXELL_ENV__?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function inferToolsRoot(): string {
  const pathName = typeof window !== "undefined" ? window.location.pathname : "";
  const normalized = pathName.replace(/\\/g, "/");
  const srcTauriIndex = normalized.lastIndexOf("/src-tauri/");
  if (srcTauriIndex >= 0) {
    return `${normalized.slice(0, srcTauriIndex)}/plugins`;
  }
  return "plugins";
}

export function sanitizeLooperToolId(value: string): string {
  let out = "";
  let lastDash = false;
  for (const raw of value.trim().toLowerCase()) {
    const next = /[a-z0-9]/.test(raw) ? raw : "-";
    if (next === "-") {
      if (lastDash) continue;
      lastDash = true;
    } else {
      lastDash = false;
    }
    out += next;
    if (out.length >= 40) break;
  }
  return out.replace(/^-+|-+$/g, "");
}

export function sanitizeLooperProjectDirName(value: string): string {
  let out = "";
  let lastSpace = false;
  for (const ch of value.trim()) {
    let next = ch;
    if (/[<>:"/\\|?*]/.test(ch)) next = "-";
    else if (/\s/.test(ch)) next = " ";
    if (next === " ") {
      if (!out || lastSpace) continue;
      lastSpace = true;
    } else {
      lastSpace = false;
    }
    out += next;
  }
  return out.replace(/^[ .]+|[ .]+$/g, "");
}

export function getLooperTargetDirectory(state: Pick<LooperToolState, "projectNameDraft" | "projectTypeDraft" | "directoryPreviewRoots">): string {
  const name = state.projectNameDraft.trim();
  const roots = state.directoryPreviewRoots;
  if (!roots) return "";
  if (state.projectTypeDraft === "app-tool") {
    const toolId = sanitizeLooperToolId(name) || "project";
    return joinPath(roots.toolsRoot, toolId);
  }
  const dirName = sanitizeLooperProjectDirName(name) || "Project";
  return joinPath(roots.projectsRoot, dirName);
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, "")}/${name.replace(/^[/\\]+/, "")}`;
}
