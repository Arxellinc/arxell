import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useChatStore } from "../store/chatStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useVoiceStore } from "../store/voiceStore";
import { useServeStore } from "../store/serveStore";
import {
  browserFetch,
  browserSearch,
  chatGetMessages,
  chatStream,
  conversationCreate,
  conversationList,
  conversationListAll,
  memoryDelete,
  memoryList,
  memoryUpsert,
  modelListAll,
  projectCreate,
  projectList,
  settingsGet,
  settingsGetAll,
  settingsSet,
  skillsDir,
  skillsResolve,
  voiceStart,
  type MemoryEntry,
  type ModelConfig,
} from "../lib/tauri";
import { useWebPanelStore, type WebContextPayload } from "../store/webPanelStore";
import { createStreamingSpeechSession, speakText } from "../lib/voice";
import { getLanguageFromPath } from "../lib/utils";
import {
  DEFAULT_MODE_CONSTRAINTS,
  DEFAULT_TOOL_RULES,
  LEGACY_MODE_ID,
  LEGACY_MODE_POLICY_TOOLS_KEY,
  MODE_IDS,
  MODE_CONSTRAINTS_SETTING_KEY,
  MODE_POLICY_SETTING_KEYS,
  MODE_SELECTION_SETTING_KEY,
  MODE_TOOL_RULES_SETTING_KEY,
  getModeById,
  type ModeConstraints,
  type ModeId,
  type ToolRules,
} from "../lib/modes";
import { CODER_TOOL_DOCS } from "../lib/coderDocs";
import { useTaskStore } from "../store/taskStore";
import { useNotesStore } from "../store/notesStore";
import { useMcpStore } from "../store/mcpStore";
import { useToolPanelStore } from "../store/toolPanelStore";
import { useToolCatalogStore } from "../store/toolCatalogStore";
import type { ChunkEvent } from "../types";
import type { Project, Conversation } from "../types";
import type { ToolMode } from "../core/tooling/types";
import {
  projectCardList,
  projectProcessCreate,
  projectProcessRetry,
  projectProcessSetStatus,
  codeReadFile,
  codeWriteFile,
  coderPiPrompt,
  coderPiVersion,
  terminalResolvePath,
} from "../core/tooling/client";
import { tryDispatchCoderRunViaTerminal } from "../tools/coder/coderRunAdapter";
import { SAFE_SETTINGS, isSafeSettingKey, pickSafeSettings, sanitizeSafeSettingValue, type SafeSettingKey } from "../lib/safeSettings";
import {
  buildAgentMemoryPayload,
  buildMcpContextPayload,
  buildNotesContextPayload,
  buildTaskContextPayload,
  renderAgentMemoryMarkdown,
} from "../lib/contextPayloads";

let coderPrewarmStarted = false;
const MAX_TOOL_FOLLOW_UP_ROUNDS = 3;

// Pending screenshot from browser_screenshot tool — consumed by the next chatStream follow-up
let pendingScreenshotB64: string | null = null;

function normalizePiModel(modelRaw: string): string {
  const model = modelRaw.trim();
  if (!model) return "";
  const lowered = model.toLowerCase();
  if (
    lowered === "default" ||
    lowered === "auto" ||
    lowered === "openai/default" ||
    lowered === "openai/auto"
  ) {
    return "";
  }
  return model;
}

function extractNameFromText(text: string): string | null {
  const patterns = [
    /\bmy name is\s+([A-Za-z][A-Za-z'-]{1,30})\b/i,
    /\bcall me\s+([A-Za-z][A-Za-z'-]{1,30})\b/i,
    /\bi am\s+([A-Za-z][A-Za-z'-]{1,30})\b/i,
    /\bi'm\s+([A-Za-z][A-Za-z'-]{1,30})\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const candidate = match?.[1]?.trim();
    if (candidate) return candidate;
  }
  return null;
}

function extractAge(text: string): string | null {
  const match = /\b(?:i am|i'm)\s+(\d{1,3})\s*(?:years old|yrs old|yo)?\b/i.exec(text);
  if (!match) return null;
  const age = Number(match[1]);
  if (!Number.isFinite(age) || age < 1 || age > 120) return null;
  return String(age);
}

function extractField(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = match?.[1]?.trim();
    if (value) return value.replace(/[.!,;:\s]+$/g, "");
  }
  return null;
}

const PREFERENCES_SKILL_FILE = "preferences.md";
const SAVED_PREFERENCES_HEADER = "## Saved User Preferences";

function defaultPreferencesSkillMarkdown(): string {
  return `# Preferences

Use this skill to define communication and behavior preferences for the primary agent.

## Communication
- Keep responses concise unless asked for more detail.
- Prefer plain paragraphs over bullets unless bullets are explicitly requested.
- Avoid code snippets unless the user asks for code.

## Task Suggestions
- In chat mode, do not suggest tasks unless the user explicitly asks about tasks or requests task creation.
`;
}

function extractPreferenceLines(text: string): string[] {
  const lines: string[] = [];

  if (
    /when in chat mode/i.test(text) &&
    /(don't|do not|should not|stop|avoid|never)/i.test(text) &&
    (/(suggest|create).*(task)/i.test(text) || /task.*(suggest|create)/i.test(text))
  ) {
    lines.push("In chat mode, do not suggest tasks unless the user explicitly asks about or requests tasks.");
  }

  if (
    /(don't|do not|stop|avoid|never)/i.test(text) &&
    /(say|mention|repeat)/i.test(text) &&
    /(my name|your name|name is)/i.test(text)
  ) {
    lines.push("Do not repeatedly mention the user's name unless contextually necessary.");
  }

  if (/(don't|do not|no|avoid|never)/i.test(text) && /(bullet|bullets|bullet points)/i.test(text)) {
    lines.push("Do not use bullet points unless the user explicitly asks for them.");
  }

  if (
    /(don't|do not|no|avoid|never)/i.test(text) &&
    /(code snippet|code snippets|code block|code blocks)/i.test(text)
  ) {
    lines.push("Do not include code snippets unless the user explicitly asks for code.");
  }

  return Array.from(new Set(lines));
}

async function syncPreferencesSkillFile(preferenceLines: string[]): Promise<void> {
  if (preferenceLines.length === 0) return;
  const dir = await skillsDir();
  const path = `${dir}/${PREFERENCES_SKILL_FILE}`;
  let content = "";
  try {
    content = await codeReadFile(path, dir, "sandbox");
  } catch {
    content = defaultPreferencesSkillMarkdown();
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const hasHeader = normalized.includes(SAVED_PREFERENCES_HEADER);
  if (!hasHeader) {
    const block = `${SAVED_PREFERENCES_HEADER}\n${preferenceLines.map((line) => `- ${line}`).join("\n")}\n`;
    const nextContent = `${normalized.trimEnd()}\n\n${block}`;
    await codeWriteFile(path, nextContent, dir, "sandbox");
    return;
  }

  const existingSet = new Set<string>();
  const lineRegex = /^\s*-\s+(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(normalized)) !== null) {
    existingSet.add(match[1].trim());
  }

  const missing = preferenceLines.filter((line) => !existingSet.has(line));
  if (missing.length === 0) return;

  const appendBlock = `${missing.map((line) => `- ${line}`).join("\n")}\n`;
  const nextContent = `${normalized.trimEnd()}\n${appendBlock}`;
  await codeWriteFile(path, nextContent, dir, "sandbox");
}

async function captureUserMemoryFromMessage(content: string): Promise<void> {
  const text = content.trim();
  if (!text) return;

  const userMemory = await memoryList("user").catch((): MemoryEntry[] => []);
  const memoryMap = new Map(userMemory.map((entry) => [entry.key, entry.value]));
  const existingName = (memoryMap.get("name") ?? "").trim();

  const detectedName = extractNameFromText(text);
  if (detectedName && !existingName) {
    await memoryUpsert("user", "name", detectedName);
  }

  const detectedAge = extractAge(text);
  if (detectedAge) {
    await memoryUpsert("user", "age", detectedAge);
  }

  const detectedOccupation = extractField(text, [
    /\b(?:i work as|i am a|i'm a|my occupation is|my job is)\s+([A-Za-z][A-Za-z\s/-]{1,60})\b/i,
  ]);
  if (detectedOccupation) {
    await memoryUpsert("user", "occupation", detectedOccupation);
  }

  const detectedGender = extractField(text, [
    /\b(?:i am|i'm)\s+(male|female|man|woman|non-binary|nonbinary|trans|transgender)\b/i,
    /\bmy gender is\s+([A-Za-z-]{2,30})\b/i,
  ]);
  if (detectedGender) {
    await memoryUpsert("user", "gender", detectedGender);
  }

  const detectedRelationship = extractField(text, [
    /\b(?:i am|i'm)\s+(single|married|divorced|widowed|engaged)\b/i,
    /\bi am in a\s+(relationship)\b/i,
  ]);
  if (detectedRelationship) {
    await memoryUpsert("user", "relationship_status", detectedRelationship);
  }

  const detectedFamily = extractField(text, [
    /\bi have\s+([^.!\n]{3,120}\b(?:kids|children|family|wife|husband|partner|son|daughter)[^.!\n]*)/i,
    /\bmy family\s+([^.!\n]{3,120})/i,
  ]);
  if (detectedFamily) {
    await memoryUpsert("user", "family", detectedFamily);
  }

  const preferenceLines = extractPreferenceLines(text);
  if (preferenceLines.length > 0) {
    const current = (memoryMap.get("assistant_preferences") ?? "").trim();
    const existing = current
      .split("\n")
      .map((line) => line.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);
    const merged = Array.from(new Set([...existing, ...preferenceLines]));
    const next = merged.map((line) => `- ${line}`).join("\n");
    await memoryUpsert("user", "assistant_preferences", next);
    await syncPreferencesSkillFile(preferenceLines);
  }

  const refreshed = await memoryList("user").catch((): MemoryEntry[] => []);
  const facts = new Map(refreshed.map((entry) => [entry.key, entry.value.trim()]));
  const hasProfileSignal =
    !!detectedAge ||
    !!detectedOccupation ||
    !!detectedGender ||
    !!detectedRelationship ||
    !!detectedFamily;
  if (hasProfileSignal) {
    const parts: string[] = [];
    const name = facts.get("name");
    if (name) parts.push(`${name} is the primary user.`);
    const age = facts.get("age");
    if (age) parts.push(`Age: ${age}.`);
    const occupation = facts.get("occupation");
    if (occupation) parts.push(`Occupation: ${occupation}.`);
    const gender = facts.get("gender");
    if (gender) parts.push(`Gender: ${gender}.`);
    const family = facts.get("family");
    if (family) parts.push(`Family: ${family}.`);
    const relationship = facts.get("relationship_status");
    if (relationship) parts.push(`Relationship status: ${relationship}.`);
    const summary = parts.join(" ");
    if (summary) {
      await memoryUpsert("user", "profile_summary", summary);
    }
  }
}

function applySafeSettingToVoiceCache(key: SafeSettingKey, value: string): void {
  const update: {
    bargeInEnabled?: boolean;
    prefillEnabled?: boolean;
    stableTailWords?: number;
    prefillMinWords?: number;
    prefillDivergenceThreshold?: number;
  } = {};

  if (key === "barge_in_enabled") update.bargeInEnabled = value === "true";
  if (key === "prefill_enabled") update.prefillEnabled = value === "true";
  if (key === "stable_tail_words") update.stableTailWords = Number(value);
  if (key === "prefill_min_words") update.prefillMinWords = Number(value);
  if (key === "prefill_divergence_threshold") update.prefillDivergenceThreshold = Number(value);

  if (Object.keys(update).length > 0) {
    useVoiceStore.getState().setPrefillConfig(update);
  }
}

// ─── Tool system prompt ───────────────────────────────────────────────────────

const TOOL_PROMPT_TEMPLATE = `## Workspace Tools

You have access to tools for creating and reading files in the project workspace. For implementation/debug/refactor/build/test requests, delegate to the Pi coding agent first using <coder_run>. Never just paste code into chat.

### write_to_file
Creates or overwrites a file. Use this for ALL code and document output.

<write_to_file>
<path>relative/path/to/filename.ext</path>
<content>
complete file content here
</content>
</write_to_file>

### read_file
Reads an existing file's contents so you can understand or modify it.

<read_file>
<path>relative/path/to/filename.ext</path>
</read_file>

### create_task
Create a new project task (manual or self-assigned).

<create_task>
<title>task title</title>
<project_id>project-id (optional; defaults to current project or General)</project_id>
<project_name>project display name</project_name>
<priority>0-100 optional, default 50</priority>
<description>
standardized markdown task description
</description>
</create_task>

### update_task
Update an existing task status and/or description.

<update_task>
<id>task-id</id>
<status>pending|running|completed|failed</status>
<description>optional updated description</description>
</update_task>

### memory_set
Persist information across sessions. Use for user facts, project context, file summaries, and conversation summaries.

<memory_set>
<namespace>user</namespace>
<key>name</key>
<value>Alice</value>
</memory_set>

Namespaces:
- user — primary user facts (name, location, timezone, preferences). Loaded every session.
- episodic — conversation summaries. Use ISO date as key (e.g. 2026-03-06). Last 5 shown per session.
- project_PXXXXX — project-specific info (stack, decisions, file index). Loaded when that project is active.

### memory_delete
Remove a stale or incorrect memory entry.

<memory_delete>
<namespace>user</namespace>
<key>key_to_remove</key>
</memory_delete>

### create_note
Save a note to the Notes panel. Use this to record information, reminders, or anything the user asks to note down.

<create_note>
<title>note title</title>
<content>
note content here (markdown supported)
</content>
<tags>comma,separated,tags (optional)</tags>
</create_note>

### update_note
Update an existing note by ID (use the ID from Notes Context).

<update_note>
<id>note-id-here</id>
<title>updated title (optional)</title>
<content>
updated content (optional)
</content>
</update_note>

### browser_navigate
Navigate the workspace browser panel to a URL. The agent can then use browser_screenshot to see the result.

<browser_navigate>
<url>https://html.duckduckgo.com/html/?q=your+search+query</url>
</browser_navigate>

### browser_search
Run a web search via the Web tool's search backend and return ranked results.
When the user asks to search/research, call "browser_search" first, then call "browser_fetch" on the most relevant result links to extract details before answering.

<browser_search>
<query>latest rust reqwest docs</query>
<num>10</num>
</browser_search>

### browser_screenshot
Capture a screenshot of the current workspace view (including the browser panel if open) and attach it to your next response so the model can see the result.

<browser_screenshot />

### settings_get
Read safe runtime settings from the Settings tool.

<settings_get>
<key>optional_setting_key</key>
</settings_get>

If key is omitted, returns the full safe settings subset.

### settings_set
Update one safe runtime setting.

<settings_set>
<key>setting_key</key>
<value>new_value</value>
</settings_set>

Use only safe keys shown in the Settings panel.

### set_mode
Switch autonomy mode.

<set_mode>
<mode>chat|voice|tools|full</mode>
</set_mode>

### coder_run
Run a Pi coding prompt using the Pi tool.

<coder_run>
<prompt>implement feature/fix task here</prompt>
<cwd>optional working directory</cwd>
<timeout_ms>optional timeout in milliseconds</timeout_ms>
<model>optional model id</model>
</coder_run>

{WORKSPACE_LINE}
Rules:
- For coding tasks, use <coder_run> first by default.
- If the user explicitly asks to have the coding agent do the work, your first action must be <coder_run> (do not answer with a manual plan first).
- After coder_run, use read/write tools to inspect or apply concrete file changes as needed.
- Always use write_to_file when creating code or documents
- Write complete, working content — no truncation, no placeholders like "// rest of code here"
- Use meaningful filenames with correct extensions (.ts, .py, .md, .json, etc.)
- After writing a file, briefly describe what was created
- Use MCP Context to choose the right MCP server/tool when external capabilities are needed

### Task Tool Usage
**IMPORTANT: Do NOT create tasks for simple questions or conversations.**
- Tasks are ONLY for tracking multi-step implementation work that you are actively performing.
- If the user asks a question, answer it directly — do NOT create a task.
- If you need to delegate complex work to a specialized subagent, use the appropriate tool (e.g., <coder_run> for code).
- Only use <create_task> when you are beginning a substantial multi-step implementation that requires tracking progress across multiple turns.
- In Chat mode, do not suggest creating tasks unless the user explicitly asks about tasks or requests task creation.

### Memory Usage
- When the user shares personal information (name, location, timezone, preferences), immediately call memory_set with namespace "user".
- When processing a significant file (CSV schema, PDF key points, large document), write a brief summary to memory_set with namespace "project_PXXXXX".
- At natural conversation boundaries (topic change, task complete, goodbye), log a one-sentence summary using memory_set with namespace "episodic" and today's ISO date as key.
- Use memory_delete to correct or remove outdated entries.
- When the user gives stable assistant-behavior preferences, store a concise version under \`user/assistant_preferences\`.

### First-Time User Onboarding (Required)
- If user memory does not contain \`name\`, ask for the user's name first.
- As soon as the user provides their name, immediately:
  1. call memory_set for \`user/name\`
  2. confirm you will save them as the primary user
  3. ask them to share a little about themselves
- After the user shares background details, immediately store a concise summary in memory using:
  - \`user/profile_summary\` (2-5 sentence summary)
  - plus key fact keys when provided: \`user/age\`, \`user/occupation\`, \`user/gender\`, \`user/family\`, \`user/relationship_status\`
- Only store facts the user actually stated. Do not invent or infer missing personal attributes.

### Autonomy Mode Awareness
**memory_set, memory_delete, create_note, update_note, settings_get, settings_set, and set_mode always execute in any mode.**
**create_task and update_task** are only for active implementation work, not for questions or planning.

For all other tools, your current autonomy mode determines what executes. If a tool you want to use is blocked:
- In **Chat** mode: read_file, browser_search, browser_fetch, write_to_file, and coder_run do NOT execute. Ask: "Should I switch to +Tools mode now so I can do that?"
- In **+Tools** mode: read_file, browser_search, browser_fetch, browser_navigate, browser_screenshot, create_task, update_task, and coder_run execute automatically. write_to_file is blocked. Tell the user: "This action requires Full-Auto mode. Please switch using the mode selector in the chat toolbar."
- In **Full-Auto** mode: all tools execute automatically.
Never silently pretend to perform an action — if a tool is blocked, always say so and direct the user to enable the appropriate mode.`;

const BASE_AVAILABLE_TOOL_TAGS: string[] = [
  "write_to_file",
  "read_file",
  "browser_search",
  "browser_fetch",
  "browser_navigate",
  "browser_screenshot",
  "settings_get",
  "settings_set",
  "set_mode",
  "create_task",
  "update_task",
  "create_note",
  "update_note",
  "project_second_opinion",
  "project_process_create",
  "project_process_set_status",
  "project_process_retry",
];

function isCoderRunEnabledByCatalog(): boolean {
  const enabled = useToolCatalogStore.getState().enabledToolIds;
  return enabled.includes("codex") || enabled.includes("pi");
}

function getAdvertisedToolTags(): string[] {
  const tags = [...BASE_AVAILABLE_TOOL_TAGS];
  if (isCoderRunEnabledByCatalog()) {
    tags.push("coder_run");
  }
  return tags;
}

function toolAvailabilitySuffix(): string {
  if (isCoderRunEnabledByCatalog()) return "";
  return `\n\n### Tool Availability Override
- coder_run is currently unavailable because no coding-agent runtime is enabled.
- Install/enable a coding pack in Settings > Tool Packs, then enable the Coder panel in Tools.`;
}

function mergeToolRules(raw: unknown): Record<ModeId, ToolRules> {
  const fallback: Record<ModeId, ToolRules> = {
    chat: { ...DEFAULT_TOOL_RULES.chat },
    voice: { ...DEFAULT_TOOL_RULES.voice },
    tools: { ...DEFAULT_TOOL_RULES.tools },
    full: { ...DEFAULT_TOOL_RULES.full },
  };

  if (!raw || typeof raw !== "object") return fallback;

  for (const mode of MODE_IDS) {
    const v =
      (raw as Record<string, unknown>)[mode] ??
      (mode === "tools" ? (raw as Record<string, unknown>)[LEGACY_MODE_ID] : undefined);
    if (!v || typeof v !== "object") continue;
    for (const key of Object.keys(DEFAULT_TOOL_RULES[mode]) as (keyof ToolRules)[]) {
      const next = (v as Record<string, unknown>)[key];
      if (typeof next === "boolean") {
        fallback[mode][key] = next;
      }
    }
  }

  return fallback;
}

async function resolveModePolicy(modeId: ModeId): Promise<string> {
  const mode = getModeById(modeId);
  const key = MODE_POLICY_SETTING_KEYS[mode.id];
  let custom = (await settingsGet(key))?.trim();
  if (!custom && mode.id === "tools") {
    custom = (await settingsGet(LEGACY_MODE_POLICY_TOOLS_KEY))?.trim();
  }
  return custom || mode.defaultPolicy;
}

async function resolveToolRules(modeId: ModeId): Promise<ToolRules> {
  const raw = await settingsGet(MODE_TOOL_RULES_SETTING_KEY);
  if (!raw?.trim()) return DEFAULT_TOOL_RULES[modeId];
  try {
    return mergeToolRules(JSON.parse(raw))[modeId];
  } catch {
    return DEFAULT_TOOL_RULES[modeId];
  }
}

function mergeModeConstraints(raw: unknown): Record<ModeId, ModeConstraints> {
  const fallback: Record<ModeId, ModeConstraints> = {
    chat: { ...DEFAULT_MODE_CONSTRAINTS.chat },
    voice: { ...DEFAULT_MODE_CONSTRAINTS.voice },
    tools: { ...DEFAULT_MODE_CONSTRAINTS.tools },
    full: { ...DEFAULT_MODE_CONSTRAINTS.full },
  };

  if (!raw || typeof raw !== "object") return fallback;

  for (const mode of MODE_IDS) {
    const v =
      (raw as Record<string, unknown>)[mode] ??
      (mode === "tools" ? (raw as Record<string, unknown>)[LEGACY_MODE_ID] : undefined);
    if (!v || typeof v !== "object") continue;

    const maxActionsPerTurn = (v as Record<string, unknown>).maxActionsPerTurn;
    if (typeof maxActionsPerTurn === "number" && Number.isFinite(maxActionsPerTurn)) {
      fallback[mode].maxActionsPerTurn = Math.max(0, Math.floor(maxActionsPerTurn));
    }
  }

  return fallback;
}

async function resolveModeConstraints(modeId: ModeId): Promise<ModeConstraints> {
  const raw = await settingsGet(MODE_CONSTRAINTS_SETTING_KEY);
  if (!raw?.trim()) return DEFAULT_MODE_CONSTRAINTS[modeId];
  try {
    return mergeModeConstraints(JSON.parse(raw))[modeId];
  } catch {
    return DEFAULT_MODE_CONSTRAINTS[modeId];
  }
}

// ─── Context cache ────────────────────────────────────────────────────────────
// Avoids rebuilding the (large) system prompt on every message.
// Cache is invalidated when workspace, mode, skills, task count, note count,
// or MCP server count change. TTL is a safety net for date/time drift.

interface _ContextCache { key: string; result: string; ts: number }
let _contextCache: _ContextCache | null = null;
const CONTEXT_CACHE_TTL_MS = 20_000; // 20 s

// Template cache — context templates are stored on disk and rarely change during
// a session. Caching them for 60 s eliminates 8 IPC file-reads that were
// previously firing on every single message (even on a main-cache hit).
interface _TemplateCache { result: ContextTemplates; ts: number }
let _templateCache: _TemplateCache | null = null;
const TEMPLATE_CACHE_TTL_MS = 60_000; // 60 s

type ContextTemplateKey = "runtime" | "tasks" | "notes" | "mcp" | "web" | "delegation" | "chat_mode" | "voice_mode";
type ContextTemplates = Record<ContextTemplateKey, string>;

const CONTEXT_TEMPLATES_SUBDIR = "context/templates";
const CONTEXT_TEMPLATE_FILES: Record<ContextTemplateKey, string> = {
  runtime: "runtime.md",
  tasks: "tasks.md",
  notes: "notes.md",
  mcp: "mcp.md",
  web: "web.md",
  delegation: "delegation.md",
  chat_mode: "chat-mode.md",
  voice_mode: "voice-mode.md",
};

const DEFAULT_CONTEXT_TEMPLATES: ContextTemplates = {
  runtime: `## Runtime Context
Date: {{date}}
Time: {{time}}
Model: {{model_name}}
Context Length: {{context_length}}
CPU: {{cpu}}
Memory: {{memory}}
GPU: {{gpu}}`,
  tasks: `## Task Context
Total Tasks: {{total_tasks}}
Pending Tasks: {{pending_tasks}}
Tasks JSON:
{{tasks_json}}`,
  notes: `## Notes Context
Total Notes: {{total_notes}}
Notes (id, title, tags, updated_at):
{{notes_json}}`,
  mcp: `## MCP Context
Total MCP Servers: {{total_mcp_servers}}
Enabled MCP Servers: {{enabled_mcp_servers}}
MCP Servers JSON:
{{mcp_servers_json}}`,
  web: `## Web Context
Current Web Context Type: {{web_context_kind}}
Current Web Route: {{web_context_route}}
Last Updated: {{web_context_updated_at}}
Web Context JSON:
{{web_context_json}}`,
  delegation: `## Agent Delegation Context
Project tool is available to the primary agent.
When the user explicitly asks for a second opinion or specialist review, delegate through the Project tool and summarize the result.
Enabled child agents: {{enabled_child_agents}}
Agent cards:
{{enabled_agent_cards_list}}
Available child-agent model ids: {{available_child_models}}`,
  chat_mode: `## Chat Mode Context
Mode: {{mode_label}}
Workspace: {{workspace_path}}
Task Summary: total {{total_tasks}}, pending {{pending_tasks}}
Notes Summary: total {{total_notes}}
MCP Summary: total {{total_mcp_servers}}, enabled {{enabled_mcp_servers}}
Delegation: {{chat_delegation_summary}}

## Chat-Mode Tools
Current mode is Chat. Web search/fetch are available; file, code, and task execution are blocked.

Allowed tools in Chat mode:
- browser_search  ← USE IMMEDIATELY when the user asks to search or look up anything online
- browser_fetch   ← USE IMMEDIATELY to fetch a URL when asked
- memory_set
- memory_delete
- create_note
- update_note
- settings_get
- settings_set
- set_mode

Blocked in Chat mode:
- read_file
- browser_navigate
- browser_screenshot
- write_to_file
- coder_run
- create_task
- update_task

IMPORTANT: When the user asks to search for something, call browser_search immediately. Do NOT ask for permission or suggest switching modes first.
If a blocked action is requested, explicitly instruct the user to switch to +Tools or Full-Auto mode from the chat toolbar.`,
  voice_mode: `## Voice Mode Context
Mode: {{mode_label}}
Workspace: {{workspace_path}}
Model: {{model_name}}
Context Length: {{context_length}}
User Profile: {{voice_user_profile_summary}}

## Voice Behavior
- Keep responses short and spoken-friendly by default (1-2 sentences).
- Give the direct answer first.
- Avoid long lists, JSON dumps, and operational status unless explicitly requested.
- For quick factual lookups, you may use browser_search, browser_fetch, and browser_navigate.
- If the user asks for coding/files write actions, browser_screenshot, or coder execution, instruct them to switch to +Tools or Full-Auto mode in the chat toolbar.

## Voice-Mode Tools
Allowed:
- memory_set
- memory_delete
- create_note
- update_note
- settings_get
- settings_set
- set_mode
- browser_search
- browser_fetch
- browser_navigate
- create_task
- update_task

Blocked:
- read_file
- browser_screenshot
- write_to_file
- coder_run`,
};

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function renderContextTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

function buildCompactWebContextPayload(payload: WebContextPayload | null): Record<string, unknown> {
  if (!payload) return {};
  if (payload.kind === "search") {
    return {
      kind: payload.kind,
      route: payload.route,
      query: payload.query ?? "",
      mode: payload.mode ?? "search",
      updated_at: payload.updated_at,
      results: (payload.results ?? []).slice(0, 5).map((result) => ({
        title: result.title,
        link: result.link,
        snippet: result.snippet.slice(0, 280),
      })),
    };
  }
  return {
    kind: payload.kind,
    route: payload.route,
    url: payload.url ?? "",
    updated_at: payload.updated_at,
    markdown_excerpt: (payload.markdown ?? "").slice(0, 1200),
    markdown_chars: (payload.markdown ?? "").length,
  };
}

async function loadContextTemplates(): Promise<ContextTemplates> {
  const now = Date.now();
  if (_templateCache && now - _templateCache.ts < TEMPLATE_CACHE_TTL_MS) {
    return _templateCache.result;
  }
  try {
    const dir = await skillsDir();
    const root = dir;
    const templateRoot = `${dir}/${CONTEXT_TEMPLATES_SUBDIR}`;
    const keys = Object.keys(CONTEXT_TEMPLATE_FILES) as ContextTemplateKey[];
    const entries = await Promise.all(
      keys.map(async (key): Promise<[ContextTemplateKey, string]> => {
        const path = `${templateRoot}/${CONTEXT_TEMPLATE_FILES[key]}`;
        try {
          const existing = await codeReadFile(path, root, "sandbox");
          return [key, existing];
        } catch {
          const fallback = DEFAULT_CONTEXT_TEMPLATES[key];
          try {
            await codeWriteFile(path, fallback, root, "sandbox");
          } catch {
            // ignore write failures and return in-memory default
          }
          return [key, fallback];
        }
      })
    );
    const result = Object.fromEntries(entries) as ContextTemplates;
    _templateCache = { result, ts: now };
    return result;
  } catch {
    return { ...DEFAULT_CONTEXT_TEMPLATES };
  }
}

async function buildExtraContext(
  workspacePath: string,
  skillContent: string | null,
  modeId: ModeId,
  projectId: string | null = null,
): Promise<string> {
  const taskState  = useTaskStore.getState();
  const notesState = useNotesStore.getState();
  const mcpState   = useMcpStore.getState();
  const webState = useWebPanelStore.getState();
  const templates = await loadContextTemplates();
  const templateSignature = hashString(
    `${templates.runtime}\n---\n${templates.tasks}\n---\n${templates.notes}\n---\n${templates.mcp}\n---\n${templates.web}\n---\n${templates.delegation}\n---\n${templates.chat_mode}\n---\n${templates.voice_mode}`
  );

  const cacheKey = [
    workspacePath,
    modeId,
    String(skillContent?.length ?? 0),
    String(taskState.tasks.length),
    String(notesState.notes.length),
    String(mcpState.servers.length),
    webState.contextPayload?.updated_at ?? "",
    projectId ?? "",
    templateSignature,
  ].join("|");

  const cacheNow = Date.now();
  if (_contextCache && _contextCache.key === cacheKey && cacheNow - _contextCache.ts < CONTEXT_CACHE_TTL_MS) {
    return _contextCache.result;
  }

  const workspaceLine = workspacePath
    ? `Workspace directory: ${workspacePath}\nAll paths are relative to this directory.`
    : `Note: No project workspace configured. Use absolute paths or assign this conversation to a project.`;

  const toolPrompt =
    TOOL_PROMPT_TEMPLATE.replace("{WORKSPACE_LINE}", workspaceLine) + toolAvailabilitySuffix();

  const mode = getModeById(modeId);
  const [modePolicy, toolRules, constraints] = await Promise.all([
    resolveModePolicy(mode.id),
    resolveToolRules(mode.id),
    resolveModeConstraints(mode.id),
  ]);
  const serve = useServeStore.getState();
  const now = new Date();
  const modelName = serve.modelInfo?.name ?? "No model loaded";
  const modelCtx = serve.modelInfo?.contextLength
    ? serve.modelInfo.contextLength.toLocaleString()
    : "Unknown";
  const cpu = serve.systemResources?.cpu
    ? `${serve.systemResources.cpu.name} (${serve.systemResources.cpu.physicalCores}C/${serve.systemResources.cpu.logicalCores}T)`
    : "Unknown";
  const memory = serve.systemResources?.memory
    ? `${serve.systemResources.memory.availableMb.toLocaleString()}MB free / ${serve.systemResources.memory.totalMb.toLocaleString()}MB total`
    : "Unknown";
  const gpu = serve.systemResources?.gpus?.[0]
    ? `${serve.systemResources.gpus[0].name} (${serve.systemResources.gpus[0].gpuType})`
    : "None";

  // ── Agent memory (user profile + episodic + project) ────────────────────
  const [userMemory, episodicMemory, projectMemory, agentCards, allModelConfigs] = await Promise.all([
    memoryList("user").catch((): MemoryEntry[] => []),
    memoryList("episodic").catch((): MemoryEntry[] => []),
    projectId
      ? memoryList(`project_${projectId}`).catch((): MemoryEntry[] => [])
      : Promise.resolve([] as MemoryEntry[]),
    projectCardList("sandbox").catch(() => []),
    modelListAll().catch((): ModelConfig[] => []),
  ]);

  const memoryPayload = buildAgentMemoryPayload({
    userMemory,
    episodicMemory,
    projectMemory,
  });
  const memoryContext = renderAgentMemoryMarkdown(memoryPayload);

  const taskPayload = buildTaskContextPayload(taskState.tasks);
  const mcpPayload = buildMcpContextPayload(mcpState.servers);
  const notesPayload = buildNotesContextPayload(notesState.notes);
  const webPayload = webState.contextPayload;
  const compactWebPayload = buildCompactWebContextPayload(webPayload);
  const enabledAgentCards = agentCards.filter((card) => card.enabled);
  const agentModels = Array.from(
    new Set(
      enabledAgentCards.flatMap((card) => {
        const preferred = (card.preferred_model_id || "").trim();
        let fallbacks: string[] = [];
        try {
          const parsed = JSON.parse(card.fallback_model_ids_json || "[]");
          if (Array.isArray(parsed)) {
            fallbacks = parsed
              .map((v) => String(v || "").trim())
              .filter(Boolean);
          }
        } catch {
          // ignore malformed fallback list
        }
        return [preferred, ...fallbacks].filter(Boolean);
      })
    )
  );
  const enabledAgentCardsList = enabledAgentCards.length > 0
    ? enabledAgentCards.slice(0, 8).map((card) => `- ${card.name} (${card.role})`).join("\n")
    : "- (none enabled)";
  const availableChildModels = agentModels.length > 0 ? agentModels.join(", ") : "(none configured)";
  const templateVars: Record<string, string> = {
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString(),
    model_name: modelName,
    context_length: modelCtx,
    cpu,
    memory,
    gpu,
    workspace_path: workspacePath || "(none)",
    mode_id: mode.id,
    mode_label: mode.label,
    mode_description: mode.description,
    total_tasks: String(taskPayload.total_tasks),
    pending_tasks: String(taskPayload.pending_tasks),
    tasks_json: JSON.stringify(taskPayload.tasks, null, 2),
    total_notes: String(notesPayload.total_notes),
    notes_json: JSON.stringify(notesPayload.notes, null, 2),
    total_mcp_servers: String(mcpPayload.total_servers),
    enabled_mcp_servers: String(mcpPayload.enabled_servers),
    mcp_servers_json: JSON.stringify(mcpPayload.servers, null, 2),
    web_context_kind: webPayload?.kind ?? "(none)",
    web_context_route: webPayload?.route ?? "(none)",
    web_context_updated_at: webPayload?.updated_at ?? "(none)",
    web_context_json: JSON.stringify(compactWebPayload, null, 2),
    enabled_child_agents: String(enabledAgentCards.length),
    enabled_agent_cards_list: enabledAgentCardsList,
    available_child_models: availableChildModels,
    chat_delegation_summary: "Delegate to child agents only when explicitly requested by the user.",
    voice_user_profile_summary:
      userMemory
        .filter((m) => m.key === "name" || m.key === "profile_summary" || m.key === "location" || m.key === "timezone")
        .map((m) => `${m.key}: ${m.value}`)
        .join(" | ") || "(none)",
  };
  const runtimeContext = renderContextTemplate(templates.runtime, templateVars).trim();
  const taskContext = renderContextTemplate(templates.tasks, templateVars).trim();
  const notesContext = renderContextTemplate(templates.notes, templateVars).trim();
  const mcpContext = renderContextTemplate(templates.mcp, templateVars).trim();
  const webContext = renderContextTemplate(templates.web, templateVars).trim();
  const delegationContext = renderContextTemplate(templates.delegation, templateVars).trim();
  const chatModeContext = renderContextTemplate(templates.chat_mode, templateVars).trim();
  const voiceModeContext = renderContextTemplate(templates.voice_mode, templateVars).trim();

  // ── Available API models for delegation ─────────────────────────────────
  // Non-primary models the user has configured — shown to agent so it can
  // suggest delegation when a request clearly warrants a more capable model.
  const delegateModels = allModelConfigs.filter((m) => !m.is_primary);
  const delegateModelLines = delegateModels.map(
    (m) => `- **${m.name}** | model_id: \`${m.model_id}\` | endpoint: ${m.base_url}`
  );
  const delegateModelContext =
    delegateModels.length > 0
      ? [
          "## Available API Models (for delegation)",
          "These models are configured and available for delegation when a query would benefit from a more capable or specialized model.",
          "",
          ...delegateModelLines,
          "",
          "### delegate_to_model",
          "Use this tool SPARINGLY — only when the request is genuinely complex or requires capabilities beyond your own (e.g. extended reasoning, very recent knowledge, specialized expertise). Do NOT use for everyday questions or tasks you can handle directly.",
          "",
          "```xml",
          "<delegate_to_model>",
          "  <name>Model Name</name>",
          "  <model_id>model-id-here</model_id>",
          "  <base_url>https://api.example.com/v1</base_url>",
          "  <prompt>Complete, self-contained question for the model (no prior context assumed)</prompt>",
          "</delegate_to_model>",
          "```",
          "",
          "Do NOT include the API key — it is looked up automatically.",
          "Always phrase <prompt> as a standalone question the target model can answer without our conversation history.",
        ].join("\n")
      : null;

  const alwaysAllowedTools = [
    "memory_set",
    "memory_delete",
    "create_note",
    "update_note",
    "settings_get",
    "settings_set",
    "set_mode",
  ];
  const modeExecutionSummary =
    mode.id === "chat"
      ? "chat mode: browser_search and browser_fetch are ALLOWED and should be called immediately for web lookups. Blocked: read_file, browser_navigate, browser_screenshot, write_to_file, coder_run, create_task, update_task."
      : mode.id === "voice"
      ? "voice mode: low-latency mode; execution allowed for browser_search, browser_fetch, and browser_navigate; blocked for read_file, write_to_file, browser_screenshot, coder_run."
      : mode.id === "tools"
      ? "+tools mode: execution allowed for read_file, browser_search, browser_fetch, browser_navigate, browser_screenshot, create_task, update_task, coder_run; blocked for write_to_file."
      : "full-auto mode: execution allowed for all tools.";
  const isChatMode = mode.id === "chat";
  const isVoiceMode = mode.id === "voice";
  const voiceToolPrompt = `## Voice Tool Calls (Minimal)
Use XML tool calls instead of plain text when tool execution is needed.

### browser_search
<browser_search>
<query>search query</query>
<num>5</num>
</browser_search>

### browser_fetch
<browser_fetch>
<url>https://example.com</url>
<mode>markdown</mode>
</browser_fetch>

### set_mode
<set_mode>
<mode>tools</mode>
</set_mode>

### create_task
<create_task>
<title>Short task title</title>
<description>Detailed task description</description>
</create_task>

### update_task
<update_task>
<id>task-id</id>
<status>pending|running|completed|failed</status>
<description>Optional updated description</description>
</update_task>`;
  const autonomyModeSnapshot = [
    "## Current Autonomy Mode (Authoritative)",
    `mode_id: ${mode.id}`,
    `mode_label: ${mode.label}`,
    `mode_description: ${mode.description}`,
    `always_allowed_tools: ${alwaysAllowedTools.join(", ")}`,
    `mode_execution_summary: ${modeExecutionSummary}`,
    "Use this block as the single source of truth for current autonomy behavior.",
  ].join("\n");
  const responseStyleGuardrails = [
    "## Response Style Guardrails",
    "For straightforward questions (for example: current time/date, basic facts, short clarifications), answer directly and briefly in 1 sentence when possible.",
    "Do not append unrelated operational commentary (voice state, TTS/STT state, tool availability, runtime/model details, or context payload summaries) unless the user explicitly asks for that status.",
    "If the user asks only for a value (like time/date), return the value first with no extra narration.",
  ].join("\n");
  const modeSwitchContract = [
    "## Mode Switch Contract",
    "You are always in one of: chat, voice, tools, full. Stay mode-aware on every turn.",
    "If the user asks you to switch modes, use the set_mode tool call instead of describing it.",
    "If an action is blocked in chat/voice, ask: \"Should I switch to +Tools mode now so I can do that?\"",
    "When the user confirms, call <set_mode><mode>tools</mode></set_mode> and proceed.",
  ].join("\n");

  // Build the context with memory first (lean, always relevant), then mode, then tools
  const parts: string[] = [];
  parts.push(autonomyModeSnapshot);
  parts.push(responseStyleGuardrails);
  parts.push(modeSwitchContract);
  if (isVoiceMode) {
    if (templateVars.voice_user_profile_summary && templateVars.voice_user_profile_summary !== "(none)") {
      parts.push(`## Agent Memory\n${templateVars.voice_user_profile_summary}`);
    }
  } else if (memoryContext) {
    parts.push(memoryContext);
  }
  parts.push(`## Autonomy Mode\nMode: ${mode.label}\nDescription: ${mode.description}`);
  if (!isVoiceMode) {
    parts.push(
      `## Autonomy Policy\n${modePolicy}`,
      `## Autonomy Limits
maxActionsPerTurn: ${modeId === "full" ? "unlimited" : constraints.maxActionsPerTurn}
toolRules: ${JSON.stringify(toolRules)}`,
    );
  }
  parts.push(`---\n${runtimeContext}`);
  parts.push(`---\n${webContext}`);
  if (isChatMode) {
    parts.push(`---\n${chatModeContext}`);
  } else if (isVoiceMode) {
    parts.push(`---\n${voiceModeContext}`);
    parts.push(`---\n${voiceToolPrompt}`);
  } else {
    parts.push(
      `---\n${taskContext}`,
      `---\n${notesContext}`,
      `---\n${mcpContext}`,
      `---\n${delegationContext}`,
    );
  }

  // Add available models for delegation (if any are configured)
  if (delegateModelContext) {
    parts.push(`---\n${delegateModelContext}`);
  }

  // Add skill content if present (skills extend/augment the mode prompt)
  if (skillContent?.trim()) {
    parts.push(`---\n## Active Skills\n\n${skillContent.trim()}`);
  }

  // Add tool prompt (Chat mode tool rules are already included via chat-mode template)
  if (!isChatMode && !isVoiceMode) {
    parts.push(`---\n${toolPrompt}`);
    parts.push(`---\n${CODER_TOOL_DOCS}`);
  }

  const result = parts.join("\n\n");
  _contextCache = { key: cacheKey, result, ts: cacheNow };
  return result;
}

export async function buildContextSnapshotForUi(params: {
  workspacePath: string;
  skillContent: string | null;
  modeId: ModeId;
  projectId?: string | null;
}): Promise<string> {
  const { workspacePath, skillContent, modeId, projectId = null } = params;
  // Invalidate caches so the snapshot reflects latest templates and context
  _contextCache = null;
  _templateCache = null;
  return buildExtraContext(workspacePath, skillContent, modeId, projectId);
}

async function resolveSkillContext(
  conversationId: string | null,
  workspacePath: string,
  modeId: ModeId
): Promise<string | null> {
  if (!conversationId) return null;
  try {
    const resolved = await skillsResolve({
      conversationId,
      workspacePath,
      modeId,
    });
    useChatStore.getState().setActiveSkillIds(resolved.enabled_ids);
    return resolved.context_markdown?.trim() ? resolved.context_markdown : null;
  } catch (error) {
    console.error("Failed to resolve active skill context:", error);
    return null;
  }
}

// ─── Tool call types ──────────────────────────────────────────────────────────

interface WriteToolCall {
  type: "write_to_file";
  path: string;
  content: string;
}

interface ReadToolCall {
  type: "read_file";
  path: string;
}

interface BrowserFetchToolCall {
  type: "browser_fetch";
  url: string;
  mode: string;
}

interface BrowserSearchToolCall {
  type: "browser_search";
  query: string;
  num?: number;
}

interface CreateTaskToolCall {
  type: "create_task";
  title: string;
  project_id: string;
  project_name: string;
  priority?: number;
  description: string;
}

interface UpdateTaskToolCall {
  type: "update_task";
  id: string;
  status?: "pending" | "running" | "completed" | "failed";
  description?: string;
}

interface CoderRunToolCall {
  type: "coder_run";
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
  model?: string;
}

interface BrowserNavigateToolCall {
  type: "browser_navigate";
  url: string;
}

interface BrowserScreenshotToolCall {
  type: "browser_screenshot";
}

interface CreateNoteToolCall {
  type: "create_note";
  title: string;
  content: string;
  tags?: string;
}

interface UpdateNoteToolCall {
  type: "update_note";
  id: string;
  title?: string;
  content?: string;
}

interface SetUserNameToolCall {
  type: "set_user_name";
  name: string;
}

interface MemorySetToolCall {
  type: "memory_set";
  namespace: string;
  key: string;
  value: string;
}

interface MemoryDeleteToolCall {
  type: "memory_delete";
  namespace: string;
  key: string;
}

interface SettingsGetToolCall {
  type: "settings_get";
  key?: string;
}

interface SettingsSetToolCall {
  type: "settings_set";
  key: string;
  value: string;
}

interface SetModeToolCall {
  type: "set_mode";
  mode: ModeId;
}

interface ProjectSecondOpinionToolCall {
  type: "project_second_opinion";
  question: string;
}

interface ProjectProcessCreateToolCall {
  type: "project_process_create";
  title: string;
  initiator?: string;
  actor?: string;
}

interface ProjectProcessSetStatusToolCall {
  type: "project_process_set_status";
  process_id: string;
  status: "queued" | "running" | "blocked" | "failed" | "succeeded" | "canceled";
  reason?: string;
  actor?: string;
}

interface ProjectProcessRetryToolCall {
  type: "project_process_retry";
  process_id: string;
  actor?: string;
}

interface DelegateToModelToolCall {
  type: "delegate_to_model";
  name: string;
  modelId: string;
  baseUrl: string;
  prompt: string;
}

type ToolCall =
  | WriteToolCall
  | ReadToolCall
  | BrowserFetchToolCall
  | BrowserSearchToolCall
  | BrowserNavigateToolCall
  | BrowserScreenshotToolCall
  | CreateTaskToolCall
  | UpdateTaskToolCall
  | CoderRunToolCall
  | CreateNoteToolCall
  | UpdateNoteToolCall
  | SetUserNameToolCall
  | MemorySetToolCall
  | MemoryDeleteToolCall
  | SettingsGetToolCall
  | SettingsSetToolCall
  | SetModeToolCall
  | ProjectSecondOpinionToolCall
  | ProjectProcessCreateToolCall
  | ProjectProcessSetStatusToolCall
  | ProjectProcessRetryToolCall
  | DelegateToModelToolCall;

function truncateForActivity(value: string, max = 80): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

function summarizeToolCall(call: ToolCall): string {
  switch (call.type) {
    case "write_to_file":
      return call.path || "(path)";
    case "read_file":
      return call.path || "(path)";
    case "browser_search":
      return truncateForActivity(call.query || "(query)");
    case "browser_fetch":
    case "browser_navigate":
      return truncateForActivity(call.url || "(url)");
    case "browser_screenshot":
      return "Capture workspace screenshot";
    case "create_task":
      return truncateForActivity(call.title || "Create task");
    case "update_task":
      return truncateForActivity(call.id || "Update task");
    case "coder_run":
      return truncateForActivity(call.prompt || "Run coder task");
    case "create_note":
      return truncateForActivity(call.title || "Create note");
    case "update_note":
      return truncateForActivity(call.id || "Update note");
    case "memory_set":
      return `${call.namespace}/${call.key}`;
    case "memory_delete":
      return `${call.namespace}/${call.key}`;
    case "settings_get":
      return call.key ? `get ${call.key}` : "list safe settings";
    case "settings_set":
      return call.key ? `set ${call.key}` : "set setting";
    case "set_mode":
      return `switch to ${call.mode}`;
    case "project_second_opinion":
      return truncateForActivity(call.question || "Second opinion");
    case "project_process_create":
      return truncateForActivity(call.title || "Create process");
    case "project_process_set_status":
      return `${call.process_id} -> ${call.status}`;
    case "project_process_retry":
      return call.process_id || "Retry process";
    case "delegate_to_model":
      return `${call.name} (${call.modelId})`;
    default:
      return call.type;
  }
}

interface ReadResult {
  path: string;
  content: string;
  error?: string;
}

interface ExtractedCodeBlock {
  lang: string;
  code: string;
}

function extractCodeBlocksFromText(text: string): ExtractedCodeBlock[] {
  const blocks: ExtractedCodeBlock[] = [];
  const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const lang = (match[1] || "").trim().toLowerCase();
    const code = (match[2] || "").trim();
    if (code) {
      blocks.push({ lang, code });
    }
  }
  return blocks;
}

function inferLangFromSnippet(snippet: string): string {
  const sample = snippet.trim().slice(0, 2000).toLowerCase();
  if (!sample) return "";
  if (sample.includes("<!doctype html") || /<html[\s>]/.test(sample)) return "html";
  if (/^\s*[{[][\s\S]*[}\]]\s*$/.test(sample)) return "json";
  if (/(^|\n)\s*import\s.+\sfrom\s.+;?/.test(sample) || /(^|\n)\s*export\s/.test(sample)) return "typescript";
  if (/(^|\n)\s*def\s+\w+\(/.test(sample)) return "python";
  if (/(^|\n)\s*fn\s+\w+\(/.test(sample) || /(^|\n)\s*use\s+\w+::/.test(sample)) return "rust";
  return "";
}

function extensionForLang(langRaw: string): string {
  const lang = langRaw.trim().toLowerCase();
  if (lang === "html" || lang === "htm") return "html";
  if (lang === "css") return "css";
  if (lang === "javascript" || lang === "js") return "js";
  if (lang === "typescript" || lang === "ts") return "ts";
  if (lang === "tsx") return "tsx";
  if (lang === "jsx") return "jsx";
  if (lang === "json") return "json";
  if (lang === "markdown" || lang === "md") return "md";
  if (lang === "python" || lang === "py") return "py";
  if (lang === "rust" || lang === "rs") return "rs";
  if (lang === "bash" || lang === "sh" || lang === "shell") return "sh";
  if (lang === "yaml" || lang === "yml") return "yml";
  return "txt";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isCodingAgentDelegationRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /\b(coding agent|coder agent|pi agent|use pi|use the pi|delegate to (the )?(coder|coding) agent)\b/i.test(normalized) ||
    /\bhave (the )?(coding|coder) agent\b/i.test(normalized) ||
    /\bask (the )?(coding|coder) agent\b/i.test(normalized)
  );
}

// ─── Parse tool calls from AI response ───────────────────────────────────────

function parseToolCalls(response: string): ToolCall[] {
  const calls: ToolCall[] = [];

  const writeRegex = /<write_to_file>\s*<path>([\s\S]*?)<\/path>\s*<content>([\s\S]*?)<\/content>\s*<\/write_to_file>/g;
  let m: RegExpExecArray | null;
  while ((m = writeRegex.exec(response)) !== null) {
    calls.push({
      type: "write_to_file",
      path: m[1].trim(),
      content: m[2].replace(/^\n/, "").replace(/\n$/, ""),
    });
  }

  const readRegex = /<read_file>\s*<path>([\s\S]*?)<\/path>\s*<\/read_file>/g;
  while ((m = readRegex.exec(response)) !== null) {
    calls.push({ type: "read_file", path: m[1].trim() });
  }

  const browserRegex =
    /<browser_fetch>\s*<url>([\s\S]*?)<\/url>\s*(?:<mode>([\s\S]*?)<\/mode>\s*)?<\/browser_fetch>/g;
  while ((m = browserRegex.exec(response)) !== null) {
    calls.push({
      type: "browser_fetch",
      url: m[1].trim(),
      mode: m[2]?.trim() ?? "markdown",
    });
  }

  const browserSearchRegex =
    /<browser_search>\s*<query>([\s\S]*?)<\/query>\s*(?:<num>([\s\S]*?)<\/num>\s*)?<\/browser_search>/g;
  while ((m = browserSearchRegex.exec(response)) !== null) {
    const parsedNum = Number(m[2]?.trim());
    calls.push({
      type: "browser_search",
      query: m[1].trim(),
      num: Number.isFinite(parsedNum) ? Math.max(1, Math.min(20, parsedNum)) : undefined,
    });
  }

  const browserNavRegex = /<browser_navigate>\s*<url>([\s\S]*?)<\/url>\s*<\/browser_navigate>/g;
  while ((m = browserNavRegex.exec(response)) !== null) {
    calls.push({ type: "browser_navigate", url: m[1].trim() });
  }

  if (/<browser_screenshot\s*\/?>/i.test(response)) {
    calls.push({ type: "browser_screenshot" });
  }

  const createTaskRegex =
    /<create_task>\s*<title>([\s\S]*?)<\/title>\s*(?:<project_id>([\s\S]*?)<\/project_id>\s*)?(?:<project_name>([\s\S]*?)<\/project_name>\s*)?(?:<priority>([\s\S]*?)<\/priority>\s*)?<description>([\s\S]*?)<\/description>\s*<\/create_task>/g;
  while ((m = createTaskRegex.exec(response)) !== null) {
    const parsedPriority = Number(m[4]?.trim());
    calls.push({
      type: "create_task",
      title: m[1].trim(),
      project_id: m[2]?.trim() || "",
      project_name: m[3]?.trim() || "",
      priority: Number.isFinite(parsedPriority) ? Math.max(0, Math.min(100, parsedPriority)) : undefined,
      description: m[5].replace(/^\n/, "").replace(/\n$/, ""),
    });
  }

  const updateTaskRegex =
    /<update_task>\s*<id>([\s\S]*?)<\/id>\s*(?:<status>([\s\S]*?)<\/status>\s*)?(?:<description>([\s\S]*?)<\/description>\s*)?<\/update_task>/g;
  while ((m = updateTaskRegex.exec(response)) !== null) {
    const rawStatus = m[2]?.trim();
    const normalizedStatus =
      rawStatus === "pending" || rawStatus === "running" || rawStatus === "completed" || rawStatus === "failed"
        ? rawStatus
        : undefined;
    calls.push({
      type: "update_task",
      id: m[1].trim(),
      status: normalizedStatus,
      description: m[3]?.replace(/^\n/, "").replace(/\n$/, ""),
    });
  }

  const coderRunRegex =
    /<coder_run>\s*<prompt>([\s\S]*?)<\/prompt>\s*(?:<cwd>([\s\S]*?)<\/cwd>\s*)?(?:<timeout_ms>([\s\S]*?)<\/timeout_ms>\s*)?(?:<model>([\s\S]*?)<\/model>\s*)?<\/coder_run>/g;
  while ((m = coderRunRegex.exec(response)) !== null) {
    const parsedTimeout = Number(m[3]?.trim());
    calls.push({
      type: "coder_run",
      prompt: m[1].replace(/^\n/, "").replace(/\n$/, ""),
      cwd: m[2]?.trim() || undefined,
      timeoutMs: Number.isFinite(parsedTimeout) ? parsedTimeout : undefined,
      model: m[4]?.trim() || undefined,
    });
  }

  const createNoteRegex =
    /<create_note>\s*<title>([\s\S]*?)<\/title>\s*<content>([\s\S]*?)<\/content>\s*(?:<tags>([\s\S]*?)<\/tags>\s*)?<\/create_note>/g;
  while ((m = createNoteRegex.exec(response)) !== null) {
    calls.push({
      type: "create_note",
      title: m[1].trim(),
      content: m[2].replace(/^\n/, "").replace(/\n$/, ""),
      tags: m[3]?.trim() || undefined,
    });
  }

  const updateNoteRegex =
    /<update_note>\s*<id>([\s\S]*?)<\/id>\s*(?:<title>([\s\S]*?)<\/title>\s*)?(?:<content>([\s\S]*?)<\/content>\s*)?<\/update_note>/g;
  while ((m = updateNoteRegex.exec(response)) !== null) {
    calls.push({
      type: "update_note",
      id: m[1].trim(),
      title: m[2]?.trim() || undefined,
      content: m[3]?.replace(/^\n/, "").replace(/\n$/, "") || undefined,
    });
  }

  const memorySetRegex =
    /<memory_set>\s*<namespace>([\s\S]*?)<\/namespace>\s*<key>([\s\S]*?)<\/key>\s*<value>([\s\S]*?)<\/value>\s*<\/memory_set>/g;
  while ((m = memorySetRegex.exec(response)) !== null) {
    calls.push({
      type: "memory_set",
      namespace: m[1].trim(),
      key: m[2].trim(),
      value: m[3].trim(),
    });
  }

  const memoryDeleteRegex =
    /<memory_delete>\s*<namespace>([\s\S]*?)<\/namespace>\s*<key>([\s\S]*?)<\/key>\s*<\/memory_delete>/g;
  while ((m = memoryDeleteRegex.exec(response)) !== null) {
    calls.push({
      type: "memory_delete",
      namespace: m[1].trim(),
      key: m[2].trim(),
    });
  }

  const settingsGetRegex = /<settings_get>\s*(?:<key>([\s\S]*?)<\/key>\s*)?<\/settings_get>/g;
  while ((m = settingsGetRegex.exec(response)) !== null) {
    const key = m[1]?.trim();
    calls.push({
      type: "settings_get",
      key: key || undefined,
    });
  }
  if (/<settings_get\s*\/>/i.test(response)) {
    calls.push({ type: "settings_get" });
  }

  const settingsSetRegex =
    /<settings_set>\s*<key>([\s\S]*?)<\/key>\s*<value>([\s\S]*?)<\/value>\s*<\/settings_set>/g;
  while ((m = settingsSetRegex.exec(response)) !== null) {
    calls.push({
      type: "settings_set",
      key: m[1].trim(),
      value: m[2].trim(),
    });
  }

  const setModeRegex = /<set_mode>\s*<mode>([\s\S]*?)<\/mode>\s*<\/set_mode>/g;
  while ((m = setModeRegex.exec(response)) !== null) {
    const raw = m[1].trim().toLowerCase();
    const mode = (raw === LEGACY_MODE_ID ? "tools" : raw) as ModeId;
    if (mode === "chat" || mode === "voice" || mode === "tools" || mode === "full") {
      calls.push({ type: "set_mode", mode });
    }
  }

  const agentsSecondOpinionRegex =
    /<project_second_opinion>\s*<question>([\s\S]*?)<\/question>\s*<\/project_second_opinion>/g;
  while ((m = agentsSecondOpinionRegex.exec(response)) !== null) {
    calls.push({
      type: "project_second_opinion",
      question: m[1].replace(/^\n/, "").replace(/\n$/, ""),
    });
  }

  const projectProcessCreateRegex =
    /<project_process_create>\s*<title>([\s\S]*?)<\/title>\s*(?:<initiator>([\s\S]*?)<\/initiator>\s*)?(?:<actor>([\s\S]*?)<\/actor>\s*)?<\/project_process_create>/g;
  while ((m = projectProcessCreateRegex.exec(response)) !== null) {
    calls.push({
      type: "project_process_create",
      title: m[1].trim(),
      initiator: m[2]?.trim() || undefined,
      actor: m[3]?.trim() || undefined,
    });
  }

  const projectProcessSetStatusRegex =
    /<project_process_set_status>\s*<process_id>([\s\S]*?)<\/process_id>\s*<status>([\s\S]*?)<\/status>\s*(?:<reason>([\s\S]*?)<\/reason>\s*)?(?:<actor>([\s\S]*?)<\/actor>\s*)?<\/project_process_set_status>/g;
  while ((m = projectProcessSetStatusRegex.exec(response)) !== null) {
    const rawStatus = m[2].trim().toLowerCase();
    const normalizedStatus =
      rawStatus === "queued" ||
      rawStatus === "running" ||
      rawStatus === "blocked" ||
      rawStatus === "failed" ||
      rawStatus === "succeeded" ||
      rawStatus === "canceled"
        ? rawStatus
        : "running";
    calls.push({
      type: "project_process_set_status",
      process_id: m[1].trim(),
      status: normalizedStatus,
      reason: m[3]?.trim() || undefined,
      actor: m[4]?.trim() || undefined,
    });
  }

  const projectProcessRetryRegex =
    /<project_process_retry>\s*<process_id>([\s\S]*?)<\/process_id>\s*(?:<actor>([\s\S]*?)<\/actor>\s*)?<\/project_process_retry>/g;
  while ((m = projectProcessRetryRegex.exec(response)) !== null) {
    calls.push({
      type: "project_process_retry",
      process_id: m[1].trim(),
      actor: m[2]?.trim() || undefined,
    });
  }

  const delegateToModelRegex =
    /<delegate_to_model>\s*<name>([\s\S]*?)<\/name>\s*<model_id>([\s\S]*?)<\/model_id>\s*<base_url>([\s\S]*?)<\/base_url>\s*<prompt>([\s\S]*?)<\/prompt>\s*<\/delegate_to_model>/g;
  while ((m = delegateToModelRegex.exec(response)) !== null) {
    calls.push({
      type: "delegate_to_model",
      name: m[1].trim(),
      modelId: m[2].trim(),
      baseUrl: m[3].trim(),
      prompt: m[4].replace(/^\n/, "").replace(/\n$/, ""),
    });
  }

  return calls;
}

// ─── Unknown tool detection ───────────────────────────────────────────────────

const KNOWN_TOOL_TAGS = new Set([
  "write_to_file", "read_file", "browser_search", "browser_fetch", "browser_navigate",
  "browser_screenshot", "create_task", "update_task", "coder_run",
  "create_note", "update_note", "set_user_name",
  "memory_set", "memory_delete",
  "settings_get", "settings_set", "set_mode",
  "project_second_opinion", "project_process_create", "project_process_set_status", "project_process_retry",
  "delegate_to_model",
  // Common sub-tags used inside tool calls (snake_case sub-tags to exclude)
  "project_id", "project_name", "timeout_ms", "process_id", "model_id", "base_url", "num",
]);

function detectUnknownToolTags(response: string): string[] {
  // Strip fenced code blocks and inline code to avoid false positives
  const stripped = response.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "");
  // Match opening tags whose names contain underscores — a strong signal of a tool call attempt
  // (standard HTML/XML tags don't use snake_case)
  const tagRegex = /<([a-z][a-z0-9]*_[a-z0-9_]+)\s*[/>]/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(stripped)) !== null) {
    const tag = m[1];
    if (!KNOWN_TOOL_TAGS.has(tag)) {
      found.add(tag);
    }
  }
  return Array.from(found);
}

// ─── Execute tool calls ───────────────────────────────────────────────────────

async function executeToolCalls(
  response: string,
  workspacePath: string,
  onProgress?: (line: string) => void,
  sourceMessageId?: string
): Promise<ReadResult[]> {
  const modeId = useChatStore.getState().activeMode;
  const toolRules = await resolveToolRules(modeId);
  const constraints = await resolveModeConstraints(modeId);
  const calls = parseToolCalls(response);
  const unknownTags = detectUnknownToolTags(response);
  if (calls.length === 0 && unknownTags.length === 0) return [];

  const { openTab } = useWorkspaceStore.getState();
  const { activatePanelFromAgent } = useToolPanelStore.getState();
  const taskStore = useTaskStore.getState();
  const readResults: ReadResult[] = [];
  const safeSettingKeys = SAFE_SETTINGS.map((item) => item.key).join(", ");
  const enabledToolIds = useToolCatalogStore.getState().enabledToolIds;
  const enabledToolSet = new Set(enabledToolIds);
  const isCatalogEnabledForCall = (call: ToolCall): boolean => {
    switch (call.type) {
      case "write_to_file":
      case "read_file":
        return enabledToolSet.has("files");
      case "browser_fetch":
      case "browser_search":
      case "browser_navigate":
      case "browser_screenshot":
        return enabledToolSet.has("web");
      case "create_task":
      case "update_task":
        return enabledToolSet.has("tasks");
      case "create_note":
      case "update_note":
        return enabledToolSet.has("notes");
      case "coder_run":
        return enabledToolSet.has("codex") || enabledToolSet.has("pi");
      case "project_second_opinion":
      case "project_process_create":
      case "project_process_set_status":
      case "project_process_retry":
        return enabledToolSet.has("project");
      default:
        return true;
    }
  };

  const gatewayMode = "sandbox";
  const rootGuard = workspacePath || null;
  const toolActivityStore = useChatStore.getState();
  const startToolActivity = (call: ToolCall): string | null => {
    if (!sourceMessageId) return null;
    const id = crypto.randomUUID();
    toolActivityStore.addToolActivity(sourceMessageId, {
      id,
      tool: call.type,
      summary: summarizeToolCall(call),
      status: "running",
    });
    return id;
  };
  const finishToolActivity = (
    activityId: string | null,
    status: "done" | "error",
    details?: string
  ) => {
    if (!sourceMessageId || !activityId) return;
    toolActivityStore.updateToolActivity(sourceMessageId, activityId, {
      status,
      details: details ? truncateForActivity(details, 180) : undefined,
    });
  };

  let executedCount = 0;
  for (const call of calls) {
    const activityId = startToolActivity(call);
    if (!isCatalogEnabledForCall(call)) {
      const toolName = call.type === "coder_run" ? "Coder" : call.type;
      const error = `Tool '${toolName}' is disabled in the current tool catalog. Enable it from the Tools panel before retrying.`;
      readResults.push({
        path: `disabled://${call.type}`,
        content: "",
        error,
      });
      finishToolActivity(activityId, "error", error);
      continue;
    }

    // Task and notes operations bypass mode policy — they are always allowed
    // regardless of autonomy level so the agent can track work and save notes in any mode.
    const isTaskOp = call.type === "create_task" || call.type === "update_task"
      || call.type === "create_note" || call.type === "update_note"
      || call.type === "set_user_name"
      || call.type === "memory_set" || call.type === "memory_delete"
      || call.type === "settings_get" || call.type === "settings_set" || call.type === "set_mode"
      || call.type === "project_second_opinion" || call.type === "project_process_create"
      || call.type === "project_process_set_status" || call.type === "project_process_retry"
      || call.type === "delegate_to_model";

    if (!isTaskOp) {
      const actionBudgetEnabled = modeId !== "full";
      if (actionBudgetEnabled && constraints.maxActionsPerTurn >= 0 && executedCount >= constraints.maxActionsPerTurn) {
        readResults.push({
          path: `policy://${call.type}`,
          content: "",
          error: `Blocked by autonomy policy in '${modeId}' mode: action budget exceeded (${constraints.maxActionsPerTurn} per turn).`,
        });
        finishToolActivity(
          activityId,
          "error",
          `Blocked: action budget exceeded (${constraints.maxActionsPerTurn} per turn).`
        );
        continue;
      }

      if (!toolRules[call.type]) {
        const guidance =
          modeId === "chat"
            ? "Should I switch to +Tools mode now so I can do that?"
            : modeId === "voice"
            ? "Should I switch to +Tools mode now so I can do that?"
            : modeId === "tools" && call.type === "write_to_file"
            ? "This action requires Full-Auto mode. Please switch using the mode selector in the chat toolbar."
            : modeId === "tools" && call.type === "coder_run"
            ? "coder_run is disabled by current +Tools policy settings. Enable coder_run in Autonomy Policies or switch to Full-Auto mode."
            : "";
        readResults.push({
          path: `policy://${call.type}`,
          content: "",
          error: `Blocked by autonomy policy in '${modeId}' mode: ${call.type} is disabled.${guidance ? ` ${guidance}` : ""}`,
        });
        finishToolActivity(
          activityId,
          "error",
          `Blocked by autonomy policy in '${modeId}' mode.`
        );
        continue;
      }

    }

    executedCount += 1;
    if (call.type === "write_to_file") {
      activatePanelFromAgent("files");
      if (!workspacePath) {
        readResults.push({
          path: call.path,
          content: "",
          error: "write_to_file requires an active project workspace.",
        });
        finishToolActivity(activityId, "error", "No active project workspace.");
        continue;
      }
      const fullPath =
        !call.path.startsWith("/")
          ? `${workspacePath}/${call.path}`
          : call.path;
      try {
        await codeWriteFile(fullPath, call.content, rootGuard, gatewayMode);
        const name = call.path.split("/").pop() ?? call.path;
        const language = getLanguageFromPath(fullPath);
        openTab({ path: fullPath, name, content: call.content, language, modified: false });
      } catch (e) {
        console.error(`Tool write_to_file failed for ${fullPath}:`, e);
        finishToolActivity(activityId, "error", String(e));
        continue;
      }
      finishToolActivity(activityId, "done", `Wrote ${call.path}`);
    } else if (call.type === "read_file") {
      activatePanelFromAgent("files");
      if (!workspacePath) {
        readResults.push({
          path: call.path,
          content: "",
          error: "read_file requires an active project workspace.",
        });
        finishToolActivity(activityId, "error", "No active project workspace.");
        continue;
      }
      const fullPath =
        !call.path.startsWith("/")
          ? `${workspacePath}/${call.path}`
          : call.path;
      try {
        const content = await codeReadFile(fullPath, rootGuard, gatewayMode);
        readResults.push({ path: call.path, content });
      } catch (e) {
        readResults.push({ path: call.path, content: "", error: String(e) });
        finishToolActivity(activityId, "error", String(e));
        continue;
      }
      finishToolActivity(activityId, "done", `Read ${call.path}`);
    } else if (call.type === "browser_search") {
      activatePanelFromAgent("web");
      const query = call.query.trim();
      if (!query) {
        readResults.push({ path: "browser_search://", content: "", error: "browser_search requires a query." });
        finishToolActivity(activityId, "error", "Missing search query.");
        continue;
      }
      useWebPanelStore.getState().setNavigateUrl(`arx://search?q=${encodeURIComponent(query)}`);
      try {
        const result = await browserSearch(query, "search", call.num ?? 10, 1);
        const lines: string[] = [];
        lines.push(`Search query: ${result.query}`);
        for (const [index, row] of result.organic.entries()) {
          const item = row as Record<string, unknown>;
          const title = typeof item.title === "string" ? item.title : "(untitled)";
          const link = typeof item.link === "string" ? item.link : "";
          const snippet = typeof item.snippet === "string" ? item.snippet : "";
          lines.push(`${index + 1}. ${title}`);
          if (link) lines.push(`   ${link}`);
          if (snippet) lines.push(`   ${snippet}`);
        }
        readResults.push({ path: `browser_search://${query}`, content: lines.join("\n") });
      } catch (e) {
        readResults.push({ path: `browser_search://${query}`, content: "", error: String(e) });
        finishToolActivity(activityId, "error", String(e));
        continue;
      }
      finishToolActivity(activityId, "done", "Search completed");
    } else if (call.type === "browser_fetch") {
      activatePanelFromAgent("web");
      // Also navigate the iframe so the user can see what the agent is fetching
      const fetchUrl = call.url.startsWith("http://") || call.url.startsWith("https://")
        ? call.url
        : "https://" + call.url;
      useWebPanelStore.getState().setNavigateUrl(fetchUrl);
      try {
        const content = await browserFetch(call.url, call.mode);
        readResults.push({ path: call.url, content });
      } catch (e) {
        readResults.push({ path: call.url, content: "", error: String(e) });
        finishToolActivity(activityId, "error", String(e));
        continue;
      }
      finishToolActivity(activityId, "done", "Fetched page content");
    } else if (call.type === "browser_navigate") {
      activatePanelFromAgent("web");
      const finalUrl = call.url.startsWith("http://") || call.url.startsWith("https://")
        ? call.url
        : "https://" + call.url;
      useWebPanelStore.getState().setNavigateUrl(finalUrl);
      // Also fetch the page content so the AI can read the results (not just navigate blindly)
      await new Promise((r) => setTimeout(r, 500));
      try {
        const pageContent = await browserFetch(finalUrl, "markdown");
        readResults.push({
          path: `browser_navigate://${finalUrl}`,
          content: `Navigated browser to: ${finalUrl}\n\n${pageContent}`,
        });
      } catch {
        readResults.push({
          path: `browser_navigate://${finalUrl}`,
          content: `Navigated browser to: ${finalUrl}\nUse browser_screenshot to see the current page.`,
        });
      }
      finishToolActivity(activityId, "done", "Navigation completed");
    } else if (call.type === "browser_screenshot") {
      try {
        const html2canvas = (await import("html2canvas")).default;
        // Target the workspace panel; fall back to the full body
        const target = document.getElementById("arx-workspace-panel") ?? document.body;
        const canvas = await html2canvas(target, {
          useCORS: false,
          allowTaint: true,
          logging: false,
          scale: 1,
          // Iframes with cross-origin content will appear blank — expected behaviour
          ignoreElements: (el) => el.tagName === "IFRAME",
        });
        pendingScreenshotB64 = canvas.toDataURL("image/png").split(",")[1];
        readResults.push({
          path: "screenshot://workspace",
          content: "Workspace screenshot captured. The image is attached to this message.",
        });
      } catch (e) {
        readResults.push({ path: "screenshot://workspace", content: "", error: String(e) });
        finishToolActivity(activityId, "error", String(e));
        continue;
      }
      finishToolActivity(activityId, "done", "Screenshot captured");
    } else if (call.type === "create_task") {
      activatePanelFromAgent("tasks");
      if (!call.title.trim()) continue;
      const storeState = useChatStore.getState();
      const requestedProjectId = call.project_id?.trim() || "";
      const requestedProjectName = call.project_name?.trim().toLowerCase() || "";
      let resolvedProject =
        (requestedProjectId
          ? storeState.projects.find((p) => p.id === requestedProjectId)
          : undefined) ??
        (requestedProjectName
          ? storeState.projects.find((p) => p.name.trim().toLowerCase() === requestedProjectName)
          : undefined);
      if (!resolvedProject) {
        const fallbackProjectId = await ensureDefaultProjectId();
        const refreshedState = useChatStore.getState();
        resolvedProject = refreshedState.projects.find((p) => p.id === fallbackProjectId);
      }
      const resolvedProjectId = resolvedProject?.id ?? null;
      const resolvedProjectName = resolvedProject?.name ?? "General";
      taskStore.addTask({
        title: call.title.trim(),
        description:
          call.description.trim() ||
          `## Background\n- Created by agent.\n\n## Objective\n- ${call.title.trim()}\n\n## Inputs\n- TBD\n\n## Skills\n- TBD\n\n## Expected Outputs\n- TBD\n`,
        status: "pending",
        priority: call.priority ?? 50,
        latitude: "med",
        project_id: resolvedProjectId,
        project_name: resolvedProjectName,
        dependencies: [],
        due_at: null,
        estimated_effort_hours: null,
        created_by: "agent",
        acceptance_criteria: [],
        constraints: [],
        attempt_count: 0,
        last_error: null,
        next_review_at: null,
      });
      finishToolActivity(activityId, "done", "Task created");
    } else if (call.type === "update_task") {
      activatePanelFromAgent("tasks");
      if (!call.id.trim()) continue;
      const patch: { status?: "pending" | "running" | "completed" | "failed"; description?: string } = {};
      if (call.status) patch.status = call.status;
      if (call.description !== undefined) patch.description = call.description;
      if (call.status === "completed") {
        const existingTask = useTaskStore.getState().tasks.find((task) => task.id === call.id);
        const baseDescription = (patch.description ?? existingTask?.description ?? "").trim();
        const completionMarker = "Completion confirmed by agent";
        if (baseDescription && !baseDescription.includes(completionMarker)) {
          patch.description = `${baseDescription}\n\n## Completion Confirmation\n- ${completionMarker} on ${new Date().toLocaleString()}.`;
        }
      }
      if (Object.keys(patch).length > 0) {
        taskStore.updateTask(call.id, patch);
      }
      finishToolActivity(activityId, "done", "Task updated");
    } else if (call.type === "coder_run") {
      const startedAt = Date.now();
      let progressTimer: ReturnType<typeof setInterval> | null = null;
      try {
        let lastProgressMs = 0;
        const emitProgress = (line: string) => {
          if (!onProgress) return;
          const now = Date.now();
          if (now - lastProgressMs < 800 && !line.includes("completed") && !line.includes("failed")) return;
          lastProgressMs = now;
          onProgress(line);
        };
        const hasWorkspace = workspacePath.trim().length > 0;
        const executable = (await settingsGet("coder_pi_executable"))?.trim() || "";
        const configuredModel = normalizePiModel((await settingsGet("coder_model"))?.trim() || "");
        const globalModel = normalizePiModel((await settingsGet("model"))?.trim() || "");
        const configuredMode = (await settingsGet("coder_mode"))?.trim();
        const pathGuardEnabled = ((await settingsGet("coder_path_guard_enabled")) ?? "false") === "true";
        const configuredOrDefaultMode =
          configuredMode === "shell" || configuredMode === "root" || configuredMode === "sandbox"
            ? configuredMode
            : "shell";
        // Sandbox mode requires a root guard; when no active workspace is attached to chat,
        // safely downgrade to shell mode instead of hard-failing the tool call.
        const coderMode = !hasWorkspace && configuredOrDefaultMode === "sandbox"
          ? "shell"
          : configuredOrDefaultMode;
        const effectiveRootGuard = hasWorkspace
          ? (coderMode === "sandbox" ? rootGuard : (pathGuardEnabled ? rootGuard : null))
          : null;
        const cwdWarnings: string[] = [];
        const fallbackCwd = hasWorkspace ? workspacePath : ".";
        let effectiveCwd = (call.cwd ?? fallbackCwd).trim() || fallbackCwd;
        try {
          effectiveCwd = await terminalResolvePath(
            effectiveCwd,
            fallbackCwd,
            effectiveRootGuard,
            coderMode
          );
        } catch (cwdErr) {
          const fallbackResolved = await terminalResolvePath(
            fallbackCwd,
            fallbackCwd,
            effectiveRootGuard,
            coderMode
          );
          cwdWarnings.push(
            `warning: requested cwd '${effectiveCwd}' is invalid (${String(cwdErr)}); using '${fallbackResolved}'.`
          );
          effectiveCwd = fallbackResolved;
        }
        const resolvedModel = normalizePiModel(call.model || configuredModel || globalModel || "");
        emitProgress(
          `\n[coder] starting${resolvedModel ? ` (model=${resolvedModel})` : ""}${effectiveCwd ? ` cwd=${effectiveCwd}` : ""}...\n`
        );
        const liveDispatch = await tryDispatchCoderRunViaTerminal({
          prompt: call.prompt,
          onProgress: emitProgress,
          ensureVisible: () => activatePanelFromAgent("codex"),
        });
        if (liveDispatch.dispatched) {
          emitProgress(
            `[coder] prompt dispatched to coder terminal in ${Math.max(0, Math.floor((Date.now() - startedAt) / 1000))}s\n`
          );
          // Live dispatch remains in coder terminal; do not produce synthetic coder:// output.
          finishToolActivity(activityId, "done", "Delegated to coder terminal");
          continue;
        }
        if (liveDispatch.reason !== "coder-disabled") {
          emitProgress(
            `[coder] live coder dispatch unavailable (${liveDispatch.reason}); using background fallback.\n`
          );
        }

        emitProgress("[coder] using background coder execution.\n");
        progressTimer = setInterval(() => {
          const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
          emitProgress(`[coder] running... ${elapsedSec}s elapsed\n`);
        }, 10000);
        const result = await coderPiPrompt(
          call.prompt,
          effectiveCwd,
          effectiveRootGuard,
          call.timeoutMs,
          executable || undefined,
          resolvedModel || undefined,
          coderMode,
          coderMode === "root"
        );
        if (progressTimer) clearInterval(progressTimer);
        emitProgress(
          `[coder] completed in ${Math.max(0, Math.floor((Date.now() - startedAt) / 1000))}s (exit=${result.exitCode})\n`
        );
        if (result.stderr && result.stderr.trim()) {
          const stderrLines = result.stderr
            .split("\n")
            .map((line) => line.trimEnd())
            .filter((line) => line.trim().length > 0);
          const tailCount = 18;
          const tail = stderrLines.slice(-tailCount);
          if (tail.length > 0) {
            emitProgress(
              `\n[coder] stderr tail (${tail.length}${stderrLines.length > tail.length ? `/${stderrLines.length}` : ""} lines):\n${tail.join("\n")}\n`
            );
          }
        }
        const savedPaths: string[] = [];
        const saveErrors: string[] = [];
        if (hasWorkspace && result.exitCode === 0) {
          const blocks = extractCodeBlocksFromText(result.stdout || "");
          const inferredRawHtml =
            blocks.length === 0 &&
            /<!doctype html|<html[\s>]/i.test(result.stdout || "")
              ? [{ lang: "html", code: (result.stdout || "").trim() }]
              : [];
          const allBlocks = [...blocks, ...inferredRawHtml].slice(0, 3);

          for (let i = 0; i < allBlocks.length; i += 1) {
            const block = allBlocks[i];
            const detectedLang = block.lang || inferLangFromSnippet(block.code) || "txt";
            const ext = extensionForLang(detectedLang);
            const filename =
              ext === "html"
                ? (i === 0 ? "landing-page.html" : `landing-page-${i + 1}.html`)
                : `coder-output-${Date.now()}-${i + 1}.${ext}`;
            const fullPath = `${workspacePath}/coder-output/${filename}`;
            try {
              await codeWriteFile(fullPath, block.code, rootGuard, gatewayMode);
              const language = getLanguageFromPath(fullPath);
              openTab({
                path: fullPath,
                name: filename,
                content: block.code,
                language,
                modified: false,
              });
              savedPaths.push(fullPath);
            } catch (saveErr) {
              saveErrors.push(`failed to save ${fullPath}: ${String(saveErr)}`);
            }
          }
        }
        const header = [
          ...cwdWarnings,
          ...(!hasWorkspace
          ? [
              "warning: no active project workspace; running coder in shell mode with cwd='.'.",
              "tip: assign this chat to a project to enable sandbox root guard.",
              "",
            ]
          : []),
          ...(savedPaths.length > 0
            ? [
                "saved_files:",
                ...savedPaths.map((path) => `- ${path}`),
                "",
              ]
            : []),
          ...(saveErrors.length > 0
            ? [
                "save_warnings:",
                ...saveErrors.map((line) => `- ${line}`),
                "",
              ]
            : []),
        ];
        const content = [
          ...header,
          `exit_code: ${result.exitCode}`,
          `duration_ms: ${result.durationMs}`,
          "",
          "stdout:",
          result.stdout || "(empty)",
          "",
          "stderr:",
          result.stderr || "(empty)",
        ].join("\n");
        readResults.push({ path: "coder://pi", content });
        finishToolActivity(activityId, "done", `Completed (exit ${result.exitCode})`);
      } catch (e) {
        if (progressTimer) clearInterval(progressTimer);
        onProgress?.(`[coder] failed: ${String(e)}\n`);
        readResults.push({ path: "coder://pi", content: "", error: String(e) });
        finishToolActivity(activityId, "error", String(e));
      }
    } else if (call.type === "create_note") {
      activatePanelFromAgent("notes");
      const notesStore = useNotesStore.getState();
      const tags = call.tags
        ? call.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];
      const note = notesStore.addNote({
        title: call.title || "New Note",
        content: call.content,
        tags,
      });
      readResults.push({
        path: `notes://${note.id}`,
        content: `Note created successfully.\nid: ${note.id}\ntitle: ${note.title}`,
      });
      finishToolActivity(activityId, "done", "Note created");
    } else if (call.type === "update_note") {
      activatePanelFromAgent("notes");
      const notesStore = useNotesStore.getState();
      const existing = notesStore.notes.find((n) => n.id === call.id);
      if (!existing) {
        readResults.push({
          path: `notes://${call.id}`,
          content: "",
          error: `Note with id "${call.id}" not found. Check Notes Context for valid note IDs.`,
        });
        finishToolActivity(activityId, "error", `Note ${call.id} not found.`);
      } else {
        const patch: { title?: string; content?: string } = {};
        if (call.title !== undefined) patch.title = call.title;
        if (call.content !== undefined) patch.content = call.content;
        if (Object.keys(patch).length > 0) {
          notesStore.updateNote(call.id, patch);
        }
        readResults.push({
          path: `notes://${call.id}`,
          content: `Note updated successfully.\nid: ${call.id}`,
        });
        finishToolActivity(activityId, "done", "Note updated");
      }
    } else if (call.type === "set_user_name") {
      // Legacy: redirect to memory system so old model behavior still works
      const trimmedName = call.name?.trim();
      if (trimmedName) {
        await memoryUpsert("user", "name", trimmedName);
        _contextCache = null;
        readResults.push({
          path: "memory://user/name",
          content: `Name remembered: "${trimmedName}".`,
        });
        finishToolActivity(activityId, "done", "User name stored");
      } else {
        finishToolActivity(activityId, "error", "Missing name value.");
      }
    } else if (call.type === "memory_set") {
      const { namespace, key, value } = call;
      if (namespace && key && value) {
        await memoryUpsert(namespace, key, value);
        _contextCache = null;
        readResults.push({
          path: `memory://${namespace}/${key}`,
          content: `Memory stored: ${namespace}/${key}`,
        });
        finishToolActivity(activityId, "done", `Stored ${namespace}/${key}`);
      } else {
        finishToolActivity(activityId, "error", "Missing namespace/key/value.");
      }
    } else if (call.type === "memory_delete") {
      const { namespace, key } = call;
      if (namespace && key) {
        await memoryDelete(namespace, key);
        _contextCache = null;
        readResults.push({
          path: `memory://${namespace}/${key}`,
          content: `Memory removed: ${namespace}/${key}`,
        });
        finishToolActivity(activityId, "done", `Removed ${namespace}/${key}`);
      } else {
        finishToolActivity(activityId, "error", "Missing namespace/key.");
      }
    } else if (call.type === "settings_get") {
      activatePanelFromAgent("settings");
      const key = call.key?.trim();
      if (key) {
        if (!isSafeSettingKey(key)) {
          readResults.push({
            path: `settings://${key}`,
            content: "",
            error: `Blocked: "${key}" is not in the safe settings allowlist. Allowed keys: ${safeSettingKeys}.`,
          });
          finishToolActivity(activityId, "error", `Blocked key: ${key}`);
          continue;
        }
        const value = await settingsGet(key);
        readResults.push({
          path: `settings://${key}`,
          content: `${key}=${value ?? "null"}`,
        });
        finishToolActivity(activityId, "done", `Read ${key}`);
      } else {
        const all = await settingsGetAll();
        const safe = pickSafeSettings(all);
        readResults.push({
          path: "settings://safe",
          content: JSON.stringify(safe, null, 2),
        });
        finishToolActivity(activityId, "done", "Listed safe settings");
      }
    } else if (call.type === "settings_set") {
      activatePanelFromAgent("settings");
      const key = call.key?.trim();
      if (!key || !isSafeSettingKey(key)) {
        readResults.push({
          path: `settings://${key || "unknown"}`,
          content: "",
          error: `Blocked: "${key || "(missing key)"}" is not in the safe settings allowlist. Allowed keys: ${safeSettingKeys}.`,
        });
        finishToolActivity(activityId, "error", `Blocked key: ${key || "(missing key)"}`);
        continue;
      }
      const normalized = sanitizeSafeSettingValue(key, call.value ?? "");
      if (!normalized.ok) {
        readResults.push({
          path: `settings://${key}`,
          content: "",
          error: normalized.error,
        });
        finishToolActivity(activityId, "error", normalized.error);
        continue;
      }
      await settingsSet(key, normalized.value);
      applySafeSettingToVoiceCache(key, normalized.value);
      readResults.push({
        path: `settings://${key}`,
        content: `Updated ${key}=${normalized.value}`,
      });
      finishToolActivity(activityId, "done", `Updated ${key}`);
    } else if (call.type === "set_mode") {
      const mode = call.mode;
      useChatStore.getState().setActiveMode(mode);
      await settingsSet(MODE_SELECTION_SETTING_KEY, mode);
      readResults.push({
        path: "mode://autonomy",
        content: `Autonomy mode switched to: ${mode}`,
      });
      finishToolActivity(activityId, "done", `Switched to ${mode}`);
    } else if (call.type === "project_second_opinion") {
      activatePanelFromAgent("project");
      const question = call.question.trim();
      if (!question) {
        readResults.push({
          path: "project://second_opinion",
          content: "",
          error: "project_second_opinion requires a non-empty <question>.",
        });
        finishToolActivity(activityId, "error", "Missing question.");
        continue;
      }
      const cards = await projectCardList(gatewayMode).catch(() => []);
      const title = `Second opinion: ${question.slice(0, 160)}`;
      const processId = await projectProcessCreate(title, "primary-agent", "primary-agent", gatewayMode);
      const enabledCards = cards.filter((card) => card.enabled);
      const cardPreview = enabledCards.slice(0, 5).map((card) => card.name).join(", ") || "(none)";
      readResults.push({
        path: `project://process/${processId}`,
        content: [
          `Second-opinion process created.`,
          `process_id: ${processId}`,
          `title: ${title}`,
          `enabled_agent_cards: ${enabledCards.length}`,
          `sample_cards: ${cardPreview}`,
        ].join("\n"),
      });
      finishToolActivity(activityId, "done", "Second opinion process created");
    } else if (call.type === "project_process_create") {
      activatePanelFromAgent("project");
      const title = call.title.trim();
      if (!title) continue;
      const processId = await projectProcessCreate(
        title,
        call.initiator?.trim() || "primary-agent",
        call.actor?.trim() || "primary-agent",
        gatewayMode
      );
      readResults.push({
        path: `project://process/${processId}`,
        content: `Process created.\nprocess_id: ${processId}\ntitle: ${title}`,
      });
      finishToolActivity(activityId, "done", "Project process created");
    } else if (call.type === "project_process_set_status") {
      activatePanelFromAgent("project");
      const processId = call.process_id.trim();
      if (!processId) continue;
      await projectProcessSetStatus(
        processId,
        call.status,
        call.reason?.trim() || undefined,
        call.actor?.trim() || "primary-agent",
        gatewayMode
      );
      readResults.push({
        path: `project://process/${processId}`,
        content: `Process status updated.\nprocess_id: ${processId}\nstatus: ${call.status}`,
      });
      finishToolActivity(activityId, "done", `Set status ${call.status}`);
    } else if (call.type === "project_process_retry") {
      activatePanelFromAgent("project");
      const processId = call.process_id.trim();
      if (!processId) continue;
      await projectProcessRetry(processId, call.actor?.trim() || "primary-agent", gatewayMode);
      readResults.push({
        path: `project://process/${processId}`,
        content: `Process retried.\nprocess_id: ${processId}`,
      });
      finishToolActivity(activityId, "done", "Process retry requested");
    } else if (call.type === "delegate_to_model") {
      const { name, modelId, baseUrl, prompt } = call;
      if (!name || !modelId || !baseUrl || !prompt) continue;
      // Use the streaming message ID passed in — more reliable than messages.at(-1)
      // which can be stale if multiple messages arrive quickly.
      const msgId = sourceMessageId ?? (() => {
        const msgs = useChatStore.getState().messages;
        return msgs[msgs.length - 1]?.id ?? crypto.randomUUID();
      })();
      useChatStore.getState().addDelegation({
        messageId: msgId,
        modelName: name,
        modelId,
        baseUrl,
        apiKey: "", // DelegationCard looks up the key from modelListAll
        prompt,
        status: "pending",
        response: "",
      });
      finishToolActivity(activityId, "done", `Delegated to ${name}`);
      // Do NOT push to readResults — that would trigger a follow-up stream
      // which causes the agent to ask "Would you like to proceed?" in text,
      // creating a loop. The DelegationCard auto-fires and streams inline.
    }
  }

  // Report any unrecognized tool tags so the AI can inform the user
  const advertisedTools = getAdvertisedToolTags().join(", ");
  for (const tag of unknownTags) {
    console.warn(`[tool] Unrecognized tool tag: <${tag}>`);
    readResults.push({
      path: `tool://${tag}`,
      content: "",
      error: `Unrecognized tool "<${tag}>": this is not a supported tool. Available tools: ${advertisedTools}. Check the tool documentation above and use a supported tag.`,
    });
  }

  return readResults;
}

function formatReadResults(results: ReadResult[]): string {
  const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``;
  const hasFence = (text: string) => /```/.test(text);
  const extLanguage = (path: string): string => {
    const clean = path.split("?")[0].toLowerCase();
    if (clean.endsWith(".html") || clean.endsWith(".htm")) return "html";
    if (clean.endsWith(".css")) return "css";
    if (clean.endsWith(".js") || clean.endsWith(".mjs") || clean.endsWith(".cjs")) return "javascript";
    if (clean.endsWith(".ts") || clean.endsWith(".tsx")) return "typescript";
    if (clean.endsWith(".jsx")) return "jsx";
    if (clean.endsWith(".json")) return "json";
    if (clean.endsWith(".md")) return "markdown";
    if (clean.endsWith(".py")) return "python";
    if (clean.endsWith(".rs")) return "rust";
    if (clean.endsWith(".sh") || clean.endsWith(".bash")) return "bash";
    if (clean.endsWith(".yml") || clean.endsWith(".yaml")) return "yaml";
    return "";
  };
  const detectLanguageFromContent = (content: string): string => {
    const sample = content.trim().slice(0, 2000).toLowerCase();
    if (!sample) return "";
    if (sample.includes("<!doctype html") || /<html[\s>]/.test(sample)) return "html";
    if (/^\s*[{[][\s\S]*[}\]]\s*$/.test(sample)) return "json";
    if (/(^|\n)\s*import\s.+\sfrom\s.+;?/.test(sample) || /(^|\n)\s*export\s/.test(sample)) return "typescript";
    if (/(^|\n)\s*def\s+\w+\(/.test(sample)) return "python";
    if (/(^|\n)\s*fn\s+\w+\(/.test(sample) || /(^|\n)\s*use\s+\w+::/.test(sample)) return "rust";
    return "";
  };
  const looksLikeCode = (content: string): boolean => {
    const sample = content.trim().slice(0, 3000);
    if (!sample) return false;
    return (
      /<!DOCTYPE html|<html[\s>]|<\/[a-z]+>/i.test(sample) ||
      /(^|\n)\s*(function|class|const|let|var|import|export)\s+/m.test(sample) ||
      /(^|\n)\s*(def|class)\s+\w+/m.test(sample) ||
      /(^|\n)\s*(fn|struct|impl)\s+\w+/m.test(sample) ||
      /[{};]{3,}/.test(sample)
    );
  };
  const maybeFence = (path: string, content: string): string => {
    if (!content.trim() || hasFence(content) || !looksLikeCode(content)) return content;
    const lang = extLanguage(path) || detectLanguageFromContent(content) || "text";
    return fence(lang, content.trimEnd());
  };
  const formatCoderPiContent = (content: string): string => {
    if (!content.includes("\nstdout:\n") || hasFence(content)) return content;
    const stdoutMarker = "\nstdout:\n";
    const stderrMarker = "\n\nstderr:\n";
    const stdoutStart = content.indexOf(stdoutMarker);
    const stderrStart = content.indexOf(stderrMarker);
    if (stdoutStart < 0 || stderrStart < 0 || stderrStart <= stdoutStart) return content;

    const prefix = content.slice(0, stdoutStart + stdoutMarker.length);
    const stdout = content.slice(stdoutStart + stdoutMarker.length, stderrStart);
    const suffix = content.slice(stderrStart);
    const lang = detectLanguageFromContent(stdout) || "text";
    const nextStdout = stdout.trim() && stdout.trim() !== "(empty)"
      ? fence(lang, stdout.trimEnd())
      : stdout;
    return `${prefix}${nextStdout}${suffix}`;
  };

  const parts = results.map((r) => {
    if (r.error) {
      return `<file_contents path="${r.path}">\nError: ${r.error}\n</file_contents>`;
    }
    const content = r.path === "coder://pi"
      ? formatCoderPiContent(r.content)
      : maybeFence(r.path, r.content);
    return `<file_contents path="${r.path}">\n${content}\n</file_contents>`;
  });
  return `Tool results:\n\n${parts.join("\n\n")}`;
}

function resolveWorkspacePathForConversation(
  projects: Project[],
  conversations: Conversation[],
  activeConversationId: string | null,
  activeProjectId: string | null
): string {
  const conversation = activeConversationId
    ? conversations.find((c) => c.id === activeConversationId)
    : null;
  const conversationProjectId = conversation?.project_id ?? null;
  const resolvedProjectId = conversationProjectId ?? activeProjectId;
  const resolvedProject = resolvedProjectId
    ? projects.find((p) => p.id === resolvedProjectId)
    : null;
  return resolvedProject?.workspace_path?.trim() ?? "";
}

export async function ensureDefaultProjectId(): Promise<string> {
  const state = useChatStore.getState();
  let projects = state.projects;

  if (projects.length === 0) {
    projects = await projectList();
  }

  if (projects.length === 0) {
    const general = await projectCreate("General", "");
    projects = [general];
  }

  if (projects !== state.projects) {
    useChatStore.setState({ projects });
  }

  const activeProjectId = useChatStore.getState().activeProjectId;
  const activeProjectValid = !!activeProjectId && projects.some((p) => p.id === activeProjectId);
  if (activeProjectValid && activeProjectId) return activeProjectId;

  const fallback =
    projects.find((p) => p.name.trim().toLowerCase() === "general") ?? projects[0];
  if (!fallback) {
    throw new Error("Failed to resolve default project.");
  }

  // Set active project without resetting conversation/message state.
  useChatStore.setState({ activeProjectId: fallback.id });
  void prewarmCoderRuntime(fallback.workspace_path ?? "");
  return fallback.id;
}

function prewarmCoderRuntime(workspacePathRaw: string) {
  if (coderPrewarmStarted) return;
  coderPrewarmStarted = true;

  const workspacePath = workspacePathRaw.trim();
  const mode: ToolMode = workspacePath ? "sandbox" : "shell";
  const cwd = workspacePath || ".";
  const rootGuard = workspacePath || null;

  void coderPiVersion(cwd, rootGuard, 15000, undefined, mode, false).catch((e) => {
    console.debug("coder prewarm skipped:", e);
  });
}

async function resolveWorkspacePathForConversationLive(
  activeConversationId: string | null,
  activeProjectId: string | null
): Promise<string> {
  const state = useChatStore.getState();
  const localPath = resolveWorkspacePathForConversation(
    state.projects,
    state.conversations,
    activeConversationId,
    activeProjectId
  );
  if (localPath) return localPath;

  const [projects, conversations] = await Promise.all([projectList(), conversationListAll()]);
  const fetchedPath = resolveWorkspacePathForConversation(
    projects,
    conversations,
    activeConversationId,
    activeProjectId
  );
  return fetchedPath;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useChatInit() {
  const { setProjects, setConversations, activeProjectId, setActiveProject, setActiveMode } = useChatStore();

  useEffect(() => {
    const ensureProjectContext = async () => {
      try {
        let projects = await projectList();
        if (projects.length === 0) {
          const general = await projectCreate("General", "");
          projects = [general];
        }

        setProjects(projects);

        const store = useChatStore.getState();
        const currentActive = store.activeProjectId;
        const hasCurrent = currentActive && projects.some((p) => p.id === currentActive);

        if (!hasCurrent) {
          const fallback =
            projects.find((p) => p.name.trim().toLowerCase() === "general") ?? projects[0];
          setActiveProject(fallback?.id ?? null);
          if (fallback) {
            prewarmCoderRuntime(fallback.workspace_path ?? "");
          }
        } else {
          const active = projects.find((p) => p.id === currentActive);
          prewarmCoderRuntime(active?.workspace_path ?? "");
        }
      } catch (e) {
        console.error(e);
      }
    };

    ensureProjectContext();
  }, []);

  useEffect(() => {
    if (!activeProjectId) return;
    conversationList(activeProjectId)
      .then(setConversations)
      .catch(console.error);
  }, [activeProjectId]);

  // Load prefill/barge-in settings into voiceStore so hooks can read them without async calls
  useEffect(() => {
    settingsGetAll().then((all) => {
      const rawModeSetting = all["autonomy_mode"]?.trim() || "";
      const modeSetting = (rawModeSetting === LEGACY_MODE_ID ? "tools" : rawModeSetting) as ModeId;
      if (modeSetting === "chat" || modeSetting === "voice" || modeSetting === "tools" || modeSetting === "full") {
        setActiveMode(modeSetting);
      }
      const rawRules = all[MODE_TOOL_RULES_SETTING_KEY]?.trim() || "";
      if (rawRules) {
        try {
          const parsed = JSON.parse(rawRules) as Record<string, unknown>;
          const tools = ((parsed.tools ?? parsed[LEGACY_MODE_ID]) ?? {}) as Record<string, unknown>;
          if (tools.coder_run === false) {
            const next = {
              ...parsed,
              tools: {
                ...tools,
                coder_run: true,
              },
            };
            delete (next as Record<string, unknown>)[LEGACY_MODE_ID];
            void settingsSet(MODE_TOOL_RULES_SETTING_KEY, JSON.stringify(next));
          }
        } catch {
          // ignore malformed autonomy rules
        }
      }
      useVoiceStore.getState().setPrefillConfig({
        prefillEnabled:             (all["prefill_enabled"]  ?? "true") === "true",
        bargeInEnabled:             (all["barge_in_enabled"] ?? "true") === "true",
        stableTailWords:            parseFloat(all["stable_tail_words"]            ?? "6"),
        prefillMinWords:            parseFloat(all["prefill_min_words"]            ?? "3"),
        prefillDivergenceThreshold: parseFloat(all["prefill_divergence_threshold"] ?? "0.8"),
      });
    }).catch(console.error);
  }, [setActiveMode]);
}

export function useChatStream() {
  const {
    activeConversationId,
    addMessage,
    addConversation,
    setActiveConversation,
    setConversations,
    startStreaming,
    appendChunk,
    finishStreaming,
    startMessagePerf,
    noteFirstToken,
    completeMessagePerf,
  } = useChatStore();

  // Track bounded tool follow-up loops (search -> fetch -> answer, etc.).
  const toolFollowUpDepth = useRef(0);
  const sendInFlight = useRef(false);
  const streamingAccRef = useRef("");
  const streamingPanelRef = useRef<string | null>(null);
  const streamingSpeech = useRef<ReturnType<typeof createStreamingSpeechSession> | null>(null);
  const streamingSpeechStart = useRef<Promise<void> | null>(null);
  const suppressVoiceToolPayloadSpeechRef = useRef(false);
  const pendingChunkId = useRef<string | null>(null);
  const pendingChunkText = useRef("");
  const pendingChunkFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceMode = useVoiceStore((s) => s.voiceMode);

  const estimateTokenCount = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return Math.max(1, Math.round(trimmed.length / 4));
  };

  const flushPendingChunks = (flushAll: boolean) => {
    const id = pendingChunkId.current;
    if (!id || !pendingChunkText.current) return;

    if (flushAll) {
      appendChunk(id, pendingChunkText.current);
      pendingChunkText.current = "";
      return;
    }

    // Keep visual updates smooth by limiting per-frame text growth.
    const maxCharsPerFlush = 120;
    const next = pendingChunkText.current.slice(0, maxCharsPerFlush);
    pendingChunkText.current = pendingChunkText.current.slice(maxCharsPerFlush);
    appendChunk(id, next);
  };

  const clearPendingChunkTimer = () => {
    if (pendingChunkFlushTimer.current !== null) {
      clearTimeout(pendingChunkFlushTimer.current);
      pendingChunkFlushTimer.current = null;
    }
  };

  const schedulePendingChunkFlush = () => {
    if (pendingChunkFlushTimer.current !== null) return;
    pendingChunkFlushTimer.current = setTimeout(() => {
      pendingChunkFlushTimer.current = null;
      flushPendingChunks(false);
      if (pendingChunkText.current) {
        schedulePendingChunkFlush();
      }
    }, 16);
  };

  useEffect(() => {
    // Track if the startup grace period has elapsed
    // During this time, we suppress error logging to avoid noise while the model loads
    const startupTime = Date.now();
    const errorGracePeriodMs = 8000; // 8 seconds grace period for model to load
    const isWithinGracePeriod = () => Date.now() - startupTime < errorGracePeriodMs;

    const unlisten = listen<ChunkEvent>("chat:chunk", async (event) => {
      const { id, delta, done } = event.payload;
      const activeStream = useChatStore.getState().streamingMessage;
      if (!activeStream || activeStream.id !== id) {
        return;
      }

      if (done) {
        completeMessagePerf(id, {
          completedAt: Date.now(),
          estimatedTokens: estimateTokenCount(activeStream.content),
        });

        if (pendingChunkId.current === id && pendingChunkText.current) {
          clearPendingChunkTimer();
          flushPendingChunks(true);
          pendingChunkId.current = null;
        }

        const activeSpeech = streamingSpeech.current;
        streamingSpeech.current = null;
        streamingSpeechStart.current = null;

        // Capture full content before clearing streaming state
        const streamSnapshot = useChatStore.getState().streamingMessage;
        const responseContent = streamSnapshot?.content ?? "";
        const streamConversationId = streamSnapshot?.conversation_id ?? null;
        finishStreaming();

        // Clear streaming tool preview state
        useTaskStore.getState().setStreamingTask(null);
        streamingAccRef.current = "";
        streamingPanelRef.current = null;

        // Refresh context token count for local model
        if (useServeStore.getState().isLoaded) {
          const convId = streamConversationId ?? useChatStore.getState().activeConversationId;
          const convMsgs = useChatStore.getState().messages
            .filter((m) => m.conversation_id === convId)
            .map((m) => ({ role: m.role as "system" | "user" | "assistant", content: m.content }));
          if (responseContent) {
            convMsgs.push({ role: "assistant", content: responseContent });
          }
          void useServeStore.getState().refreshTokenCount(convMsgs);
        }

        const state = useChatStore.getState();
        const workspacePath = await resolveWorkspacePathForConversationLive(
          streamConversationId ?? state.activeConversationId,
          state.activeProjectId
        );
        const convIdForTools = streamConversationId ?? state.activeConversationId;
        let toolResponseContent = responseContent;
        const convMessages = state.messages.filter(
          (m) => m.conversation_id === (streamConversationId ?? state.activeConversationId)
        );
        const lastUserMessage = [...convMessages].reverse().find((m) => m.role === "user");
        const userRequestedCodingAgent = isCodingAgentDelegationRequest(lastUserMessage?.content ?? "");
        const parsedToolCalls = parseToolCalls(responseContent);
        if (userRequestedCodingAgent && parsedToolCalls.length === 0) {
          const activeMode = state.activeMode;
          const modeRules = await resolveToolRules(activeMode);
          if (modeRules.coder_run) {
            const syntheticPrompt = (lastUserMessage?.content || "").trim() || "Please complete the requested coding task.";
            toolResponseContent = `${responseContent}\n\n<coder_run>\n<prompt>${escapeXml(syntheticPrompt)}</prompt>\n</coder_run>`;
          }
        }
        const hasCreateTask = /<create_task>/i.test(toolResponseContent);
        const hasUpdateTask = /<update_task>/i.test(toolResponseContent);

        const taskCountBefore = useTaskStore.getState().tasks.length;
        const readResults = await executeToolCalls(
          toolResponseContent,
          workspacePath,
          undefined,
          streamSnapshot?.id
        );
        const taskCountAfter = useTaskStore.getState().tasks.length;
        const createdTaskCount = Math.max(0, taskCountAfter - taskCountBefore);
        const hasTaskToolCall = hasCreateTask || hasUpdateTask;
        if (useVoiceStore.getState().voiceMode && hasTaskToolCall && convIdForTools) {
          activeSpeech?.stop();
          const vs = useVoiceStore.getState();
          if (vs.pipelineState !== "user_speaking" && vs.pipelineState !== "interrupted") {
            const postConfirm =
              createdTaskCount > 1
                ? `${createdTaskCount} tasks have been created.`
                : hasCreateTask
                ? "The task has been created."
                : "The task has been updated.";
            vs.setIsSpeaking(true);
            vs.setPipelineState("agent_speaking");
            await speakText(postConfirm).catch(console.error);
            vs.setIsSpeaking(false);
            useVoiceStore.getState().setStopCurrentAudio(null);
            useChatStore.getState().addMessage({
              id: crypto.randomUUID(),
              conversation_id: convIdForTools,
              role: "assistant",
              content: postConfirm,
              created_at: Date.now(),
            });
          }
        }

        // If read_file was used and we're not already in a follow-up, send
        // the file contents back to the AI so it can act on them.
        if (readResults.length > 0 && toolFollowUpDepth.current < MAX_TOOL_FOLLOW_UP_ROUNDS) {
          activeSpeech?.stop();
          const vs = useVoiceStore.getState();
          if (vs.isSpeaking) {
            vs.setIsSpeaking(false);
            vs.setPipelineState("processing");
          }
          useVoiceStore.getState().setStopCurrentAudio(null);

          toolFollowUpDepth.current += 1;
          const convId = useChatStore.getState().activeConversationId;
          if (convId) {
            const modeId = useChatStore.getState().activeMode;
            const thinkingEnabled =
              modeId === "voice" ? false : useChatStore.getState().thinkingEnabled;
            const skillContent = await resolveSkillContext(convId, workspacePath, modeId);
            const extraContext = await buildExtraContext(workspacePath, skillContent, modeId, state.activeProjectId);
            const followUpContent = formatReadResults(readResults);
            const assistantId = crypto.randomUUID();
            // Consume pending screenshot (if any) for this follow-up
            const screenshotB64 = pendingScreenshotB64 ?? undefined;
            pendingScreenshotB64 = null;
            useChatStore.getState().startStreaming(assistantId, convId);
            try {
              await chatStream(convId, followUpContent, extraContext, thinkingEnabled, assistantId, screenshotB64, modeId);
            } catch (e) {
              console.error("Tool follow-up failed:", e);
              toolFollowUpDepth.current = 0;
              useChatStore.getState().finishStreaming();
            }
          }
        } else {
          if (readResults.length > 0 && toolFollowUpDepth.current >= MAX_TOOL_FOLLOW_UP_ROUNDS) {
            console.warn(`[tool] Follow-up limit reached (${MAX_TOOL_FOLLOW_UP_ROUNDS}); stopping tool chain.`);
          }
          toolFollowUpDepth.current = 0;

          // Voice mode: speak the response then restart listening
          const vs = useVoiceStore.getState();
          if (vs.voiceMode) {
            // If the user barged in during this turn, suppress any remaining
            // speech from this (now stale) response.
            const interrupted =
              vs.pipelineState === "interrupted" || vs.pipelineState === "user_speaking";
            if (interrupted) {
              activeSpeech?.stop();
              vs.setIsSpeaking(false);
              useVoiceStore.getState().setStopCurrentAudio(null);
              return;
            }

            if (hasTaskToolCall) {
              activeSpeech?.stop();
            } else if (activeSpeech) {
              await activeSpeech.finalize().catch(console.error);
            } else if (responseContent.trim()) {
              vs.setIsSpeaking(true);
              vs.setPipelineState("agent_speaking");
              await speakText(responseContent).catch(console.error);
            }
            vs.setIsSpeaking(false);
            useVoiceStore.getState().setStopCurrentAudio(null);

            // Only restart listening if we weren't interrupted by barge-in
            const afterState = useVoiceStore.getState().pipelineState;
            if (afterState !== "user_speaking" && afterState !== "interrupted") {
              useVoiceStore.getState().setPipelineState("idle");
            }

            if (useVoiceStore.getState().voiceMode) {
              if (vs.useBrowserSR) {
                const restart = (useVoiceStore as unknown as { _restartBrowserSR?: () => void })._restartBrowserSR;
                setTimeout(() => restart?.(), 120);
              } else {
                // Rust STT path: restart capture so the next turn can be heard.
                // voice_active is already false by now (finalize() ran before transcript arrived).
                voiceStart().catch(console.error);
              }
            }
          } else {
            activeSpeech?.stop();
          }
        }
      } else {
        if (delta.trim().length > 0) {
          noteFirstToken(id, Date.now());
        }
        if (pendingChunkId.current && pendingChunkId.current !== id) {
          clearPendingChunkTimer();
          pendingChunkText.current = "";
          streamingAccRef.current = "";
          streamingPanelRef.current = null;
          suppressVoiceToolPayloadSpeechRef.current = false;
        }
        pendingChunkId.current = id;
        pendingChunkText.current += delta;
        schedulePendingChunkFlush();

        // Accumulate full text for tool detection
        streamingAccRef.current += delta;
        const streamAcc = streamingAccRef.current;

        // Open the relevant tool panel as soon as the model starts writing a tool call
        if (!streamingPanelRef.current) {
          if (/<create_task>/i.test(streamAcc) || /<update_task>/i.test(streamAcc)) {
            streamingPanelRef.current = "tasks";
            useToolPanelStore.getState().activatePanelFromAgent("tasks");
          } else if (/<write_to_file>/i.test(streamAcc) || /<read_file>/i.test(streamAcc)) {
            streamingPanelRef.current = "files";
            useToolPanelStore.getState().activatePanelFromAgent("files");
          } else if (/<browser_search>/i.test(streamAcc) || /<browser_fetch>/i.test(streamAcc)) {
            streamingPanelRef.current = "web";
            useToolPanelStore.getState().activatePanelFromAgent("web");
          } else if (/<coder_run>/i.test(streamAcc)) {
            streamingPanelRef.current = "codex";
            useToolPanelStore.getState().activatePanelFromAgent("codex");
          } else if (/<settings_get>/i.test(streamAcc) || /<settings_set>/i.test(streamAcc)) {
            streamingPanelRef.current = "settings";
            useToolPanelStore.getState().activatePanelFromAgent("settings");
          } else if (/<create_note>/i.test(streamAcc) || /<update_note>/i.test(streamAcc)) {
            streamingPanelRef.current = "notes";
            useToolPanelStore.getState().activatePanelFromAgent("notes");
          }
        }

        const openToolTag = /<([a-z][a-z0-9]*_[a-z0-9_]*)/i.exec(streamAcc);
        if (openToolTag && KNOWN_TOOL_TAGS.has(openToolTag[1])) {
          suppressVoiceToolPayloadSpeechRef.current = true;
          streamingSpeech.current?.stop();
          streamingSpeech.current = null;
          streamingSpeechStart.current = null;
        }

        // Stream create_task content live into the tasks panel preview
        if (/<create_task>/i.test(streamAcc)) {
          const titleMatch = /<title>([\s\S]*?)(?:<\/title>|$)/i.exec(streamAcc);
          const descMatch = /<description>([\s\S]*?)(?:<\/description>|$)/i.exec(streamAcc);
          useTaskStore.getState().setStreamingTask({
            title: titleMatch?.[1]?.trim() ?? "",
            description: descMatch?.[1]?.trim() ?? "",
          });
          suppressVoiceToolPayloadSpeechRef.current = true;
          streamingSpeech.current?.stop();
          streamingSpeech.current = null;
          streamingSpeechStart.current = null;
        }

        const vs = useVoiceStore.getState();
        if (!vs.voiceMode) {
          streamingSpeech.current?.stop();
          streamingSpeech.current = null;
          streamingSpeechStart.current = null;
          return;
        }

        if (vs.voiceMode && delta.trim()) {
          if (suppressVoiceToolPayloadSpeechRef.current) {
            return;
          }
          if (!streamingSpeech.current) {
            if (!streamingSpeechStart.current) {
              streamingSpeechStart.current = (async () => {
                vs.setIsSpeaking(true);
                vs.setPipelineState("agent_speaking");
                streamingSpeech.current = createStreamingSpeechSession();
              })().finally(() => {
                streamingSpeechStart.current = null;
              });
            }

            await streamingSpeechStart.current;
          }

          streamingSpeech.current?.pushDelta(delta);
        }
      }
    });
    const unlistenError = listen<{ message: string }>("chat:error", (event) => {
      const errText = (event.payload?.message || "Unknown chat error").trim();

      // Always clean up streaming state so the UI isn't stuck
      clearPendingChunkTimer();
      pendingChunkId.current = null;
      pendingChunkText.current = "";
      streamingAccRef.current = "";
      streamingPanelRef.current = null;
      useTaskStore.getState().setStreamingTask(null);
      streamingSpeech.current?.stop();
      streamingSpeech.current = null;
      streamingSpeechStart.current = null;

      const state = useChatStore.getState();
      const activeStream = state.streamingMessage;
      state.finishStreaming();
      toolFollowUpDepth.current = 0;

      const vs = useVoiceStore.getState();
      vs.setStopCurrentAudio(null);
      vs.setIsSpeaking(false);
      if (vs.pipelineState !== "user_speaking") {
        vs.setPipelineState("idle");
      }

      // Suppress error display during startup grace period (model may still be loading)
      if (isWithinGracePeriod()) {
        console.warn("Chat stream error suppressed (startup grace period):", errText);
        return;
      }

      const convId = activeStream?.conversation_id ?? state.activeConversationId;
      if (convId) {
        state.addMessage({
          id: crypto.randomUUID(),
          conversation_id: convId,
          role: "assistant",
          content: `Error: ${errText}`,
          created_at: Date.now(),
        });
      }
      console.error("Chat stream error:", errText);
    });

    return () => {
      clearPendingChunkTimer();
      pendingChunkId.current = null;
      pendingChunkText.current = "";
      streamingAccRef.current = "";
      streamingPanelRef.current = null;
      useTaskStore.getState().setStreamingTask(null);
      streamingSpeech.current?.stop();
      streamingSpeech.current = null;
      streamingSpeechStart.current = null;
      unlisten.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, []);

  // If voice mode is toggled off mid-response, stop any active speech session immediately.
  useEffect(() => {
    if (!voiceMode) {
      streamingSpeech.current?.stop();
      streamingSpeech.current = null;
      streamingSpeechStart.current = null;
      const vs = useVoiceStore.getState();
      vs.setStopCurrentAudio(null);
      vs.setIsSpeaking(false);
      if (vs.pipelineState === "agent_speaking") {
        vs.setPipelineState("idle");
      }
    }
  }, [voiceMode]);

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;
    if (sendInFlight.current) return;
    if (useChatStore.getState().isStreaming) return;

    sendInFlight.current = true;
    try {
      toolFollowUpDepth.current = 0;
      // Defensive stop: when a new user turn is dispatched (including barge-in),
      // force-stop any residual speech session/audio from the prior turn.
      clearPendingChunkTimer();
      pendingChunkId.current = null;
      pendingChunkText.current = "";
      suppressVoiceToolPayloadSpeechRef.current = false;
      streamingSpeech.current?.stop();
      streamingSpeech.current = null;
      streamingSpeechStart.current = null;
      const vs = useVoiceStore.getState();
      vs.stopCurrentAudio?.();
      vs.setStopCurrentAudio(null);
      vs.setIsSpeaking(false);
      useVoiceStore.getState().setPipelineState("processing");

      // Read latest state (avoids stale closure for values that change after mount)
      const state = useChatStore.getState();
      const workspacePath = await resolveWorkspacePathForConversationLive(
        state.activeConversationId,
        state.activeProjectId
      );
      const modeId = state.activeMode;
      const thinkingEnabled = modeId === "voice" ? false : state.thinkingEnabled;
      // Run memory capture in the background — it only persists user facts and
      // does not affect the current response. Awaiting it added 2–4 IPC calls
      // to the critical path before every stream request.
      void captureUserMemoryFromMessage(content);

      let convId = activeConversationId;

      // Auto-create a conversation if none is active yet
      if (!convId) {
        const projectId = await ensureDefaultProjectId();
        const newConv = await conversationCreate(projectId, "New Chat");
        addConversation(newConv);
        setActiveConversation(newConv.id);
        convId = newConv.id;
        const allConvs = await conversationListAll();
        setConversations(allConvs);
      }

      const skillContent = await resolveSkillContext(convId, workspacePath, modeId);
      const extraContext = await buildExtraContext(workspacePath, skillContent, modeId, state.activeProjectId);
      const assistantId = crypto.randomUUID();
      startMessagePerf(assistantId, Date.now());
      startStreaming(assistantId, convId);
      const userMsg = await chatStream(convId, content, extraContext, thinkingEnabled, assistantId, undefined, modeId);
      addMessage(userMsg);
    } catch (e) {
      console.error("Failed to send message:", e);
      finishStreaming();
    } finally {
      sendInFlight.current = false;
    }
  };

  return { sendMessage };
}

export function useLoadMessages() {
  const { activeConversationId, setMessages } = useChatStore();

  useEffect(() => {
    if (!activeConversationId) return;
    chatGetMessages(activeConversationId)
      .then(setMessages)
      .catch(console.error);
  }, [activeConversationId]);
}
