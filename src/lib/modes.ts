// ── Autonomy Mode Definitions ─────────────────────────────────────────────────
// The selected autonomy mode controls:
// 1) policy text injected into system context
// 2) whether parsed tool calls are auto-executed

export type ModeId = "chat" | "voice" | "tools" | "full";

export const MODE_IDS: ModeId[] = ["voice", "chat", "tools", "full"];

export type ToolPolicyKey =
  | "write_to_file"
  | "read_file"
  | "browser_search"
  | "browser_fetch"
  | "browser_navigate"
  | "browser_screenshot"
  | "create_task"
  | "update_task"
  | "coder_run"
  | "set_user_name";

export interface ToolRules {
  write_to_file: boolean;
  read_file: boolean;
  browser_search: boolean;
  browser_fetch: boolean;
  browser_navigate: boolean;
  browser_screenshot: boolean;
  create_task: boolean;
  update_task: boolean;
  coder_run: boolean;
  set_user_name: boolean;
}

export interface ModeConstraints {
  maxRisk: 0 | 1 | 2 | 3;
  maxActionsPerTurn: number;
}

export type AutonomyProfileLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface AutonomyPresetFlags {
  allowTaskDraftOnly: boolean;
  allowTaskAutoQueue: boolean;
  allowSubtaskUnderEpicOnly: boolean;
  proactiveWhitelist: string[];
  allowExplorationMode: boolean;
  requireCheckpointEveryNActions: number | null;
  requireRollbackPlanForRiskGte2: boolean;
  twoManRuleDestructive: boolean;
}

export interface AutonomyPreset {
  level: AutonomyProfileLevel;
  label: string;
  summary: string;
  rail: ModeId;
  railRules: ToolRules;
  railConstraints: ModeConstraints;
  flags: AutonomyPresetFlags;
}

export interface AutonomyMode {
  id: ModeId;
  label: string;
  description: string;
  accent: string;
  defaultPolicy: string;
}

export const MODE_POLICY_SETTING_KEYS: Record<ModeId, string> = {
  chat: "autonomy_policy_chat",
  voice: "autonomy_policy_voice",
  tools: "autonomy_policy_tools",
  full: "autonomy_policy_full",
};

export const LEGACY_MODE_ID = "semi";
export const LEGACY_MODE_POLICY_TOOLS_KEY = "autonomy_policy_semi";

export const MODE_TOOL_RULES_SETTING_KEY = "autonomy_tool_rules";
export const MODE_CONSTRAINTS_SETTING_KEY = "autonomy_constraints";
export const MODE_SELECTION_SETTING_KEY = "autonomy_mode";
export const MODE_PROFILE_SETTING_KEY = "autonomy_profile_level";

export const MODES: AutonomyMode[] = [
  {
    id: "voice",
    label: "Voice",
    description: "Ultra-lean context for low-latency voice responses",
    accent: "text-cyan-300",
    defaultPolicy: `You are Arxell in Voice autonomy mode.

Policy:
- Prioritize low-latency, concise spoken responses.
- Keep answers short by default (1-2 sentences) unless the user asks for depth.
- Avoid heavy tool execution and long contextual summaries in this mode.
- You may use lightweight web tools (browser_search, browser_fetch, and browser_navigate) for short fact lookups when needed.
- If a request requires blocked actions in this mode, ask: "Should I switch to +Tools mode now so I can do that?"
- Ask one short clarifying question when needed instead of providing long assumptions.`,
  },
  {
    id: "chat",
    label: "Chat",
    description: "No autonomous tool execution",
    accent: "text-white/70",
    defaultPolicy: `You are Arxell in Chat autonomy mode.

Policy:
- browser_search and browser_fetch are available and should be used immediately when the user asks to search or look up anything online. Do not ask for permission — just call the tool.
- All other execution tools (read_file, write_to_file, coder_run, create_task, update_task) are blocked in this mode.
- If the user asks to create a task, write a file, run code, or perform another blocked action, ask: "Should I switch to +Tools mode now so I can do that?"
- If the user confirms, switch using set_mode and continue.
- Keep responses concise, clear, and verification-oriented.`,
  },
  {
    id: "tools",
    label: "+Tools",
    description: "Read/research + task tools can run automatically",
    accent: "text-amber-300",
    defaultPolicy: `You are Arxell in +Tools autonomy mode.

Policy:
- You may autonomously use read-only tools (read_file, browser_search, browser_fetch, browser_navigate, browser_screenshot).
- You may autonomously use task tools (create_task, update_task) for active implementation work.
- You may use coder_run to delegate implementation work to the Pi coding agent.
- If write_to_file is required, inform the user that Full-Auto mode is required and ask them to switch using the mode selector in the chat toolbar.
- Prefer safe, incremental progress and surface assumptions explicitly.
- Do NOT create tasks for simple questions — answer directly. Tasks are only for tracking active multi-step implementation work.`,
  },
  {
    id: "full",
    label: "Full-Auto",
    description: "Autonomous multi-step execution",
    accent: "text-emerald-300",
    defaultPolicy: `You are Arxell in Full-Auto autonomy mode.

Policy:
- Execute tasks end-to-end using available tools when safe.
- Keep changes incremental, verify outcomes, and self-correct on failures.
- Briefly report major actions and outcomes.
- Never bypass explicit safety guardrails.
- Do NOT create tasks for simple questions — answer directly. Tasks are only for tracking active multi-step implementation work.`,
  },
];

export const DEFAULT_MODE = MODES.find((m) => m.id === "chat") ?? MODES[0];

export const DEFAULT_TOOL_RULES: Record<ModeId, ToolRules> = {
  chat: {
    write_to_file: false,
    read_file: false,
    browser_search: true,  // Read-only web lookup allowed in all modes
    browser_fetch: true,   // Read-only web fetch allowed in all modes
    browser_navigate: false,
    browser_screenshot: false,
    create_task: false,
    update_task: false,
    coder_run: false,
    set_user_name: true, // Always allowed - personalization
  },
  voice: {
    write_to_file: false,
    read_file: false,
    browser_search: true,
    browser_fetch: true,
    browser_navigate: true,
    browser_screenshot: false,
    create_task: false,
    update_task: false,
    coder_run: false,
    set_user_name: true,
  },
  tools: {
    write_to_file: false,
    read_file: true,
    browser_search: true,
    browser_fetch: true,
    browser_navigate: true,
    browser_screenshot: true,
    create_task: true,
    update_task: true,
    coder_run: true,
    set_user_name: true,
  },
  full: {
    write_to_file: true,
    read_file: true,
    browser_search: true,
    browser_fetch: true,
    browser_navigate: true,
    browser_screenshot: true,
    create_task: true,
    update_task: true,
    coder_run: true,
    set_user_name: true,
  },
};

export const DEFAULT_MODE_CONSTRAINTS: Record<ModeId, ModeConstraints> = {
  chat: {
    maxRisk: 0,
    maxActionsPerTurn: 3, // Allow browser_search + browser_fetch + one follow-up
  },
  voice: {
    maxRisk: 0,
    maxActionsPerTurn: 2,
  },
  tools: {
    maxRisk: 1,
    maxActionsPerTurn: 4,
  },
  full: {
    maxRisk: 3,
    maxActionsPerTurn: 12,
  },
};

export const TOOL_POLICY_LABELS: Record<ToolPolicyKey, string> = {
  write_to_file: "write_to_file",
  read_file: "read_file",
  browser_search: "browser_search",
  browser_fetch: "browser_fetch",
  browser_navigate: "browser_navigate",
  browser_screenshot: "browser_screenshot",
  create_task: "create_task",
  update_task: "update_task",
  coder_run: "coder_run",
  set_user_name: "set_user_name",
};

const BASE_FLAGS: AutonomyPresetFlags = {
  allowTaskDraftOnly: false,
  allowTaskAutoQueue: false,
  allowSubtaskUnderEpicOnly: false,
  proactiveWhitelist: [],
  allowExplorationMode: false,
  requireCheckpointEveryNActions: null,
  requireRollbackPlanForRiskGte2: false,
  twoManRuleDestructive: false,
};

export const AUTONOMY_PRESETS: AutonomyPreset[] = [
  {
    level: 0,
    label: "Read-only assistant",
    summary: "No tool execution, no tasks, no loops.",
    rail: "chat",
    railRules: { write_to_file: false, read_file: false, browser_search: false, browser_fetch: false, browser_navigate: false, browser_screenshot: false, create_task: false, update_task: false, coder_run: false, set_user_name: true },
    railConstraints: { maxRisk: 0, maxActionsPerTurn: 0 },
    flags: { ...BASE_FLAGS },
  },
  {
    level: 1,
    label: "Tool-assisted chat",
    summary: "Read-only lookup and inspection.",
    rail: "chat",
    railRules: { write_to_file: false, read_file: true, browser_search: true, browser_fetch: true, browser_navigate: true, browser_screenshot: true, create_task: false, update_task: false, coder_run: false, set_user_name: true },
    railConstraints: { maxRisk: 0, maxActionsPerTurn: 2 },
    flags: { ...BASE_FLAGS },
  },
  {
    level: 2,
    label: "Drafting",
    summary: "Can draft tasks/edits but never applies changes.",
    rail: "chat",
    railRules: { write_to_file: false, read_file: true, browser_search: true, browser_fetch: true, browser_navigate: true, browser_screenshot: true, create_task: true, update_task: false, coder_run: false, set_user_name: true },
    railConstraints: { maxRisk: 1, maxActionsPerTurn: 3 },
    flags: { ...BASE_FLAGS, allowTaskDraftOnly: true },
  },
  {
    level: 3,
    label: "Safe executor",
    summary: "Low-risk execution and short bounded sessions.",
    rail: "tools",
    railRules: { write_to_file: false, read_file: true, browser_search: true, browser_fetch: true, browser_navigate: true, browser_screenshot: true, create_task: true, update_task: true, coder_run: true, set_user_name: true },
    railConstraints: { maxRisk: 1, maxActionsPerTurn: 8 },
    flags: { ...BASE_FLAGS },
  },
  {
    level: 4,
    label: "Builder",
    summary: "Applies local changes with verification.",
    rail: "tools",
    railRules: { write_to_file: true, read_file: true, browser_search: true, browser_fetch: true, browser_navigate: true, browser_screenshot: true, create_task: true, update_task: true, coder_run: true, set_user_name: true },
    railConstraints: { maxRisk: 2, maxActionsPerTurn: 16 },
    flags: { ...BASE_FLAGS, requireRollbackPlanForRiskGte2: true },
  },
  {
    level: 5,
    label: "Project driver",
    summary: "Runs multiple tasks sequentially; can queue work.",
    rail: "tools",
    railRules: { write_to_file: true, read_file: true, browser_search: true, browser_fetch: true, browser_navigate: true, browser_screenshot: true, create_task: true, update_task: true, coder_run: true, set_user_name: true },
    railConstraints: { maxRisk: 2, maxActionsPerTurn: 24 },
    flags: { ...BASE_FLAGS, allowTaskAutoQueue: true, requireRollbackPlanForRiskGte2: true },
  },
  {
    level: 6,
    label: "Autonomous in-plan",
    summary: "Executes existing graph and dependency order.",
    rail: "full",
    railRules: { write_to_file: true, read_file: true, browser_search: true, browser_fetch: true, browser_navigate: true, browser_screenshot: true, create_task: true, update_task: true, coder_run: true, set_user_name: true },
    railConstraints: { maxRisk: 2, maxActionsPerTurn: 32 },
    flags: { ...BASE_FLAGS, allowTaskAutoQueue: true, allowSubtaskUnderEpicOnly: true, requireRollbackPlanForRiskGte2: true },
  },
  {
    level: 7,
    label: "Autonomous + maintenance",
    summary: "Adds prudent maintenance tasks from a whitelist.",
    rail: "full",
    railRules: { write_to_file: true, read_file: true, browser_search: true, browser_fetch: true, browser_navigate: true, browser_screenshot: true, create_task: true, update_task: true, coder_run: true, set_user_name: true },
    railConstraints: { maxRisk: 2, maxActionsPerTurn: 40 },
    flags: {
      ...BASE_FLAGS,
      allowTaskAutoQueue: true,
      proactiveWhitelist: ["tests", "docs", "refactor", "cleanup"],
      requireRollbackPlanForRiskGte2: true,
      requireCheckpointEveryNActions: 10,
    },
  },
  {
    level: 8,
    label: "Autonomous + exploration",
    summary: "Can run bounded exploration and compare approaches.",
    rail: "full",
    railRules: { write_to_file: true, read_file: true, browser_search: true, browser_fetch: true, browser_navigate: true, browser_screenshot: true, create_task: true, update_task: true, coder_run: true, set_user_name: true },
    railConstraints: { maxRisk: 3, maxActionsPerTurn: 50 },
    flags: {
      ...BASE_FLAGS,
      allowTaskAutoQueue: true,
      allowExplorationMode: true,
      proactiveWhitelist: ["tests", "docs", "refactor", "cleanup"],
      requireRollbackPlanForRiskGte2: true,
      requireCheckpointEveryNActions: 8,
    },
  },
  {
    level: 9,
    label: "High-trust operator",
    summary: "Medium-risk operation autonomy, irreversible actions still gated.",
    rail: "full",
    railRules: { write_to_file: true, read_file: true, browser_search: true, browser_fetch: true, browser_navigate: true, browser_screenshot: true, create_task: true, update_task: true, coder_run: true, set_user_name: true },
    railConstraints: { maxRisk: 3, maxActionsPerTurn: 75 },
    flags: {
      ...BASE_FLAGS,
      allowTaskAutoQueue: true,
      allowExplorationMode: true,
      proactiveWhitelist: ["tests", "docs", "refactor", "cleanup"],
      requireCheckpointEveryNActions: 12,
    },
  },
  {
    level: 10,
    label: "Delegated authority",
    summary: "High-impact scope with explicit protective rails and two-man rule.",
    rail: "full",
    railRules: { write_to_file: true, read_file: true, browser_search: true, browser_fetch: true, browser_navigate: true, browser_screenshot: true, create_task: true, update_task: true, coder_run: true, set_user_name: true },
    railConstraints: { maxRisk: 3, maxActionsPerTurn: 100 },
    flags: {
      ...BASE_FLAGS,
      allowTaskAutoQueue: true,
      allowExplorationMode: true,
      proactiveWhitelist: ["tests", "docs", "refactor", "cleanup"],
      requireCheckpointEveryNActions: 15,
      twoManRuleDestructive: true,
    },
  },
];

export function getAutonomyPreset(level: AutonomyProfileLevel): AutonomyPreset {
  return AUTONOMY_PRESETS.find((p) => p.level === level) ?? AUTONOMY_PRESETS[4];
}

export function presetPolicyState(level: AutonomyProfileLevel): {
  mode: ModeId;
  rules: Record<ModeId, ToolRules>;
  constraints: Record<ModeId, ModeConstraints>;
  flags: AutonomyPresetFlags;
} {
  const preset = getAutonomyPreset(level);
  const rules: Record<ModeId, ToolRules> = {
    chat: { ...DEFAULT_TOOL_RULES.chat },
    voice: { ...DEFAULT_TOOL_RULES.voice },
    tools: { ...DEFAULT_TOOL_RULES.tools },
    full: { ...DEFAULT_TOOL_RULES.full },
  };
  const constraints: Record<ModeId, ModeConstraints> = {
    chat: { ...DEFAULT_MODE_CONSTRAINTS.chat },
    voice: { ...DEFAULT_MODE_CONSTRAINTS.voice },
    tools: { ...DEFAULT_MODE_CONSTRAINTS.tools },
    full: { ...DEFAULT_MODE_CONSTRAINTS.full },
  };

  rules[preset.rail] = { ...preset.railRules };
  constraints[preset.rail] = { ...preset.railConstraints };

  return {
    mode: preset.rail,
    rules,
    constraints,
    flags: { ...preset.flags },
  };
}

export function getModeById(id: ModeId): AutonomyMode {
  return MODES.find((m) => m.id === id) ?? DEFAULT_MODE;
}
