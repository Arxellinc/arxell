import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, RefreshCw, Zap, Brain, BrainCog, Pencil, Check, ChevronDown, ChevronUp } from "lucide-react";
import { settingsGet, skillsDir, skillsList } from "../../lib/tauri";
import type { SkillMeta } from "../../lib/tauri";
import { useChatStore } from "../../store/chatStore";
import { useVoiceStore } from "../../store/voiceStore";
import { generateAvailableToolsContent, useToolPanelStore } from "../../store/toolPanelStore";
import { cn, getLanguageFromPath } from "../../lib/utils";
import type { ServeState, SystemResources } from "../../types/model";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { codeDeletePath, codeReadFile, codeWriteFile } from "../../core/tooling/client";
import { buildContextSnapshotForUi } from "../../hooks/useChat";
import { getAllToolManifests } from "../../core/tooling/registry";
import { useToolCatalogStore } from "../../store/toolCatalogStore";
import type { ToolId } from "../../core/tooling/types";
import {
  DEFAULT_TOOL_RULES,
  LEGACY_MODE_ID,
  MODE_IDS,
  MODE_TOOL_RULES_SETTING_KEY,
  type ModeId,
  type ToolRules,
} from "../../lib/modes";

const PREFERENCES_SKILL_ID = "preferences";
const CONTEXT_SKILL_ID = "context";
const CONTEXT_SKILL_NAME = "context";
const DIRECTIVES_SKILL_ID = "directives";

function defaultDirectivesSkillContent(): string {
  return `# Directives

You are a helpful AI assistant with access to tools for reading and writing files in the user's workspace.

Be concise, accurate, and helpful.
When writing code or creating files, always use the write_to_file tool rather than pasting content into chat.
Write complete, working code without placeholders.
`;
}

function isContextSkill(skill: SkillMeta): boolean {
  return (
    skill.id.trim().toLowerCase() === CONTEXT_SKILL_ID ||
    skill.name.trim().toLowerCase() === CONTEXT_SKILL_NAME
  );
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
    const value =
      (raw as Record<string, unknown>)[mode] ??
      (mode === "tools" ? (raw as Record<string, unknown>)[LEGACY_MODE_ID] : undefined);
    if (!value || typeof value !== "object") continue;
    for (const key of Object.keys(DEFAULT_TOOL_RULES[mode]) as (keyof ToolRules)[]) {
      const next = (value as Record<string, unknown>)[key];
      if (typeof next === "boolean") {
        fallback[mode][key] = next;
      }
    }
  }

  return fallback;
}

function defaultPreferencesSkillContent(): string {
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

function defaultContextSkillContent(): string {
  return `# Context

This file is generated automatically and shows the effective context snapshot passed to the primary agent.

Use the Context refresh button or open this skill to regenerate it.
`;
}

/// Generate the "Available Skills" content that lists all skills for the agent
function generateAvailableSkillsContent(
  skills: SkillMeta[],
  includeTools: boolean = false,
  enabledToolIds: ToolId[] = []
): string {
  const alwaysActive = skills.filter(s => s.category === "always_active");
  const userSelectable = skills.filter(s => s.category === "user_selectable");
  
  let content = `You have access to skills that modify your behavior. These skills are like variables that can be activated to change how you respond.\n\n`;
  
  if (alwaysActive.length > 0) {
    content += `## Always Active Skills\nThese skills are always injected into your context:\n\n`;
    for (const skill of alwaysActive) {
      content += `- **${skill.name}**: ${skill.description}\n`;
    }
    content += `\n`;
  }
  
  if (userSelectable.length > 0) {
    content += `## User-Selectable Skills\nThese skills can be activated by the user to modify your behavior:\n\n`;
    for (const skill of userSelectable) {
      content += `- **${skill.name}**: ${skill.description}\n`;
    }
    content += `\n`;
  }
  
  // Include tool panels when 'tools' skill is active
  if (includeTools) {
    content += `---\n\n`;
    content += generateAvailableToolsContent(enabledToolIds);
  }
  
  return content;
}

async function generateRuntimeContextBlock(): Promise<string> {
  const [serveState, resources] = await Promise.all([
    invoke<ServeState>("cmd_get_serve_state"),
    invoke<SystemResources>("cmd_get_system_resources"),
  ]);

  const now = new Date();
  const modelName = serveState.modelInfo?.name ?? "No model loaded";
  const modelCtx = serveState.modelInfo?.contextLength
    ? serveState.modelInfo.contextLength.toLocaleString()
    : "Unknown";
  const cpu = `${resources.cpu.name} (${resources.cpu.physicalCores}C/${resources.cpu.logicalCores}T)`;
  const mem = `${resources.memory.availableMb.toLocaleString()}MB free / ${resources.memory.totalMb.toLocaleString()}MB total`;
  const gpu = resources.gpus[0]
    ? `${resources.gpus[0].name} (${resources.gpus[0].gpuType})`
    : "None";

  return [
    "## Runtime Context",
    `Date: ${now.toLocaleDateString()}`,
    `Time: ${now.toLocaleTimeString()}`,
    `Model: ${modelName}`,
    `Context Length: ${modelCtx}`,
    `CPU: ${cpu}`,
    `Memory: ${mem}`,
    `GPU: ${gpu}`,
  ].join("\n");
}

type SkillBarItem =
  | { key: string; kind: "always"; skill: SkillMeta }
  | { key: string; kind: "selectable"; skill: SkillMeta }
  | { key: string; kind: "tool"; toolId: ToolId; title: string; description: string }
  | { key: string; kind: "memory"; id: "memory-user" | "memory-episodic" | "memory-project"; title: string; description: string }
  | { key: string; kind: "runtime"; id: "runtime" | "autonomy" | "runtime-template" | "chat-mode-template" | "voice-mode-template"; title: string; description: string }
  | { key: string; kind: "thinking" }
  | { key: string; kind: "reasoning" };

export function SkillsBar() {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [skillsRoot, setSkillsRoot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const setSidebarPath = useWorkspaceStore((s) => s.setSidebarPath);
  const activatePanelFromAgent = useToolPanelStore((s) => s.activatePanelFromAgent);
  const enabledToolIds = useToolCatalogStore((s) => s.enabledToolIds);
  const {
    activeSkillIds,
    activeMode,
    toggleSkill,
    setSkillActive,
    setSkillContent,
    clearSkillContent,
    thinkingEnabled,
    toggleThinking,
    complexReasoningEnabled,
    toggleComplexReasoning,
  } = useChatStore();
  const voiceMode = useVoiceStore((s) => s.voiceMode);
  const loaded = useRef(false);
  const [openGroup, setOpenGroup] = useState<"skills" | "tools" | "memory" | "runtime" | null>(null);
  const [modeToolRules, setModeToolRules] = useState<ToolRules>(DEFAULT_TOOL_RULES.chat);
  const rootForPath = useCallback(
    (path: string): string | null => {
      if (skillsRoot) return skillsRoot;
      const normalized = path.replace(/\\/g, "/");
      const idx = normalized.lastIndexOf("/");
      if (idx <= 0) return null;
      return normalized.slice(0, idx);
    },
    [skillsRoot]
  );

  const openSkillFile = useCallback(async (path: string) => {
    try {
      const rootGuard = rootForPath(path);
      const mode = rootGuard ? "sandbox" : "shell";
      const content = await codeReadFile(path, rootGuard, mode);
      const name = path.split("/").pop() ?? path;
      const language = getLanguageFromPath(path);
      if (rootGuard) {
        setSidebarPath(rootGuard);
      }
      activatePanelFromAgent("files");
      openTab({ path, name, content, language, modified: false });
    } catch (e) {
      console.error(`Failed to open skill file at ${path}:`, e);
    }
  }, [activatePanelFromAgent, openTab, rootForPath, setSidebarPath]);

  useEffect(() => {
    let cancelled = false;
    const loadModeRules = async () => {
      try {
        const raw = await settingsGet(MODE_TOOL_RULES_SETTING_KEY);
        const nextRules = raw?.trim()
          ? mergeToolRules(JSON.parse(raw))[activeMode]
          : DEFAULT_TOOL_RULES[activeMode];
        if (!cancelled) setModeToolRules(nextRules);
      } catch {
        if (!cancelled) setModeToolRules(DEFAULT_TOOL_RULES[activeMode]);
      }
    };
    void loadModeRules();
    return () => {
      cancelled = true;
    };
  }, [activeMode]);

  const isToolAccessibleInMode = useCallback((toolId: ToolId): boolean => {
    if (toolId === "files") {
      return modeToolRules.read_file || modeToolRules.write_to_file;
    }
    if (toolId === "web") {
      return (
        modeToolRules.browser_fetch ||
        modeToolRules.browser_navigate ||
        modeToolRules.browser_screenshot
      );
    }
    if (toolId === "codex") return modeToolRules.coder_run;
    if (toolId === "tasks") return true;
    if (toolId === "notes") return true;
    if (toolId === "project") return true;
    if (toolId === "settings") return true;
    return false;
  }, [modeToolRules]);

  const refreshContextSkill = useCallback(async (
    allSkills: SkillMeta[],
    rootDir: string,
    contextSkillId: string,
    contextPath: string
  ) => {
    const path = contextPath;
    const chatState = useChatStore.getState();
    const activeIds = chatState.activeSkillIds.filter((id) => id !== contextSkillId);
    const activeSkillContent = activeIds
      .map((id) => chatState.skillContents[id])
      .filter(Boolean)
      .join("\n\n");
    const activeProject = chatState.projects.find((p) => p.id === chatState.activeProjectId) ?? null;
    const workspacePath = activeProject?.workspace_path ?? "";
    const contextBody = await buildContextSnapshotForUi({
      workspacePath,
      skillContent: activeSkillContent || null,
      modeId: chatState.activeMode,
      projectId: chatState.activeProjectId,
    });

    const activeSkillsMarkdown = allSkills
      .filter((skill) => activeIds.includes(skill.id))
      .map((skill) => `- ${skill.name} (\`${skill.id}\`)`)
      .join("\n");

    const content = [
      "# Context",
      "",
      "This file is generated automatically and mirrors the primary agent context snapshot.",
      "",
      "## Snapshot Metadata",
      `- Generated: ${new Date().toISOString()}`,
      `- Active mode: ${chatState.activeMode}`,
      `- Active project: ${chatState.activeProjectId ?? "(none)"}`,
      `- Workspace path: ${workspacePath || "(none)"}`,
      `- Active skill count (excluding context): ${activeIds.length}`,
      "",
      "## Active Skills Included",
      activeSkillsMarkdown || "- (none)",
      "",
      "## Effective Context",
      "```md",
      contextBody,
      "```",
      "",
    ].join("\n");

    await codeWriteFile(path, content, rootDir, "sandbox");
    setSkillContent(contextSkillId, content);
  }, [setSkillContent]);

  const openContextSnapshotFile = useCallback(async () => {
    try {
      const dir = skillsRoot ?? await skillsDir();
      setSkillsRoot(dir);

      let knownSkills = skills;
      if (knownSkills.length === 0) {
        knownSkills = await skillsList();
        setSkills(knownSkills);
      }

      const contextSkill = knownSkills.find((skill) => isContextSkill(skill));
      const contextPath = contextSkill?.path ?? `${dir}/${CONTEXT_SKILL_ID}.md`;
      const contextSkillId = contextSkill?.id ?? CONTEXT_SKILL_ID;

      await refreshContextSkill(knownSkills, dir, contextSkillId, contextPath);
      await openSkillFile(contextPath);
    } catch (e) {
      console.error("Failed to open context snapshot:", e);
    }
  }, [openSkillFile, refreshContextSkill, skills, skillsRoot]);

  const openContextTemplateFile = useCallback(async (fileName: string) => {
    try {
      const dir = skillsRoot ?? await skillsDir();
      setSkillsRoot(dir);
      const templateRoot = `${dir}/context/templates`;
      const path = `${templateRoot}/${fileName}`;
      try {
        await codeReadFile(path, dir, "sandbox");
      } catch {
        await codeWriteFile(path, `# ${fileName}\n\n`, dir, "sandbox");
      }
      await openSkillFile(path);
    } catch (e) {
      console.error("Failed to open context template file:", e);
    }
  }, [openSkillFile, skillsRoot]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dir = await skillsDir();
      setSkillsRoot(dir);
      const directivesPath = `${dir}/${DIRECTIVES_SKILL_ID}.md`;
      const legacySystemPromptPath = `${dir}/system-prompt.md`;
      const legacyTestWriterPath = `${dir}/test-writer.md`;
      try {
        await codeReadFile(directivesPath, dir, "sandbox");
      } catch {
        let seeded = false;
        try {
          const legacy = await codeReadFile(legacySystemPromptPath, dir, "sandbox");
          const migrated = legacy.trim().startsWith("#")
            ? legacy.replace(/^#\s+.*$/m, "# Directives")
            : `# Directives\n\n${legacy}`;
          await codeWriteFile(directivesPath, migrated, dir, "sandbox");
          seeded = true;
        } catch {
          // no-op; fallback to defaults below
        }
        if (!seeded) {
          await codeWriteFile(directivesPath, defaultDirectivesSkillContent(), dir, "sandbox");
        }
      }
      try {
        await codeDeletePath(legacySystemPromptPath, dir, "sandbox");
      } catch {
        // no-op: legacy file may not exist
      }
      try {
        await codeDeletePath(legacyTestWriterPath, dir, "sandbox");
      } catch {
        // no-op: legacy file may not exist
      }
      const list = await skillsList();
      const preferencesPath = `${dir}/${PREFERENCES_SKILL_ID}.md`;
      const existingContextSkill = list.find((skill) => isContextSkill(skill));
      const contextPath = existingContextSkill?.path ?? `${dir}/${CONTEXT_SKILL_ID}.md`;
      try {
        await codeReadFile(preferencesPath, dir, "sandbox");
      } catch {
        await codeWriteFile(preferencesPath, defaultPreferencesSkillContent(), dir, "sandbox");
      }
      if (!existingContextSkill) {
        try {
          await codeReadFile(contextPath, dir, "sandbox");
        } catch {
          await codeWriteFile(contextPath, defaultContextSkillContent(), dir, "sandbox");
        }
      }
      const hasPreferences = list.some((skill) => skill.id === PREFERENCES_SKILL_ID);
      const hasContext = list.some((skill) => isContextSkill(skill));
      const preferencesSkill: SkillMeta = {
        id: PREFERENCES_SKILL_ID,
        name: "Preferences",
        path: preferencesPath,
        description: "Primary-user communication and behavior preferences.",
        category: "user_selectable",
      };
      const contextSkill: SkillMeta = {
        id: CONTEXT_SKILL_ID,
        name: "Context",
        path: contextPath,
        description: "View the exact context snapshot passed to the primary agent.",
        category: "user_selectable",
      };
      const mergedSkills = [
        ...list,
        ...(hasPreferences ? [] : [preferencesSkill]),
        ...(hasContext ? [] : [contextSkill]),
      ];
      setSkills(mergedSkills);
      
      // Check if 'tools' skill is active to include tool information
      const toolsSkillActive = activeSkillIds.includes("tools");
      
      // Auto-activate always-active skills and load their content
      for (const skill of mergedSkills) {
        if (skill.category === "always_active") {
          // Add to active skills if not already there
          if (!activeSkillIds.includes(skill.id)) {
            setSkillActive(skill.id, true);
          }
          
          // For "available-skills", generate content dynamically
          // Include tools information when 'tools' skill is active
          if (skill.id === "available-skills") {
              const content = generateAvailableSkillsContent(
                mergedSkills,
                toolsSkillActive,
                enabledToolIds
              );
              setSkillContent(skill.id, content);
              try {
                await codeWriteFile(skill.path, content, dir, "sandbox");
              } catch (e) {
                console.error("Failed to persist available-skills content:", e);
              }
          } else if (skill.id === DIRECTIVES_SKILL_ID) {
            try {
              const base = await codeReadFile(skill.path, rootForPath(skill.path), "sandbox");
              const runtime = await generateRuntimeContextBlock();
              setSkillContent(skill.id, `${base.trim()}\n\n---\n${runtime}`);
            } catch (e) {
              console.error(`Failed to load directives skill ${skill.id}:`, e);
            }
          } else {
            // Load content from file for other always-active skills
            try {
              const content = await codeReadFile(skill.path, rootForPath(skill.path), "sandbox");
              setSkillContent(skill.id, content);
            } catch (e) {
              console.error(`Failed to load always-active skill ${skill.id}:`, e);
            }
          }
        }
      }

      // Preferences skill should be available and active by default.
      if (!activeSkillIds.includes(PREFERENCES_SKILL_ID)) {
        setSkillActive(PREFERENCES_SKILL_ID, true);
      }
      try {
        const preferencesContent = await codeReadFile(preferencesPath, dir, "sandbox");
        setSkillContent(PREFERENCES_SKILL_ID, preferencesContent);
      } catch (e) {
        console.error("Failed to load preferences skill content:", e);
      }
      try {
        await refreshContextSkill(
          mergedSkills,
          dir,
          (existingContextSkill?.id ?? CONTEXT_SKILL_ID),
          contextPath
        );
      } catch (e) {
        console.error("Failed to generate context skill content:", e);
      }
    } catch (e) {
      console.error("Failed to load skills:", e);
    } finally {
      setLoading(false);
    }
  }, [activeSkillIds, refreshContextSkill, rootForPath, setSkillActive, setSkillContent]);

  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      void load();
    }
  }, [load]);

  useEffect(() => {
    if (loading) return;
    const hasPreferences = skills.some((skill) => skill.id === PREFERENCES_SKILL_ID);
    const hasContext = skills.some((skill) => isContextSkill(skill));
    if (hasPreferences && hasContext) return;
    void load();
  }, [loading, skills, load]);

  // Voice mode ↔ voice skill sync
  useEffect(() => {
    const voiceSkill = skills.find((s) => s.id === "voice");
    if (!voiceSkill) return;

    const activate = async () => {
      if (voiceMode) {
        setSkillActive("voice", true);
        if (!useChatStore.getState().skillContents["voice"]) {
          try {
            const content = await codeReadFile(voiceSkill.path, rootForPath(voiceSkill.path), "sandbox");
            setSkillContent("voice", content);
          } catch (e) {
            console.error("Failed to load voice skill content:", e);
          }
        }
      } else {
        setSkillActive("voice", false);
        clearSkillContent("voice");
      }
    };

    void activate();
  }, [voiceMode, skills, rootForPath, setSkillActive, setSkillContent, clearSkillContent]);

  // When a user-selectable skill is toggled, load its content
  const handleSkillClick = async (skill: SkillMeta) => {
    if (isContextSkill(skill)) {
      try {
        const dir = skillsRoot ?? await skillsDir();
        setSkillsRoot(dir);
        await refreshContextSkill(skills, dir, skill.id, skill.path);
      } catch (e) {
        console.error("Failed to refresh context skill content:", e);
      }
      await openSkillFile(skill.path);
      return;
    }

    if (skill.category === "always_active") {
      // Always-active skills can't be toggled, but clicking opens them
      await openSkillFile(skill.path);
      return;
    }

    const isActive = activeSkillIds.includes(skill.id);
    
    if (isActive) {
      // Deactivate: remove from active list and clear content
      toggleSkill(skill.id);
      clearSkillContent(skill.id);
    } else {
      // Activate: add to active list and load content
      toggleSkill(skill.id);
      await openSkillFile(skill.path);
      try {
        const content = await codeReadFile(skill.path, rootForPath(skill.path), "sandbox");
        setSkillContent(skill.id, content);
      } catch (e) {
        console.error("Failed to load skill content:", e);
      }
    }
  };

  const handleSkillEditClick = async (event: React.MouseEvent, skill: SkillMeta) => {
    event.stopPropagation();
    event.preventDefault();
    await openSkillFile(skill.path);
  };

  const createSkill = async () => {
    try {
      const dir = skillsRoot ?? await skillsDir();
      setSkillsRoot(dir);
      const id = `skill-${Date.now()}`;
      const path = `${dir}/${id}.md`;
      await codeWriteFile(
        path,
        `# New Skill\n\nDescribe what this skill does and how the agent should behave.\n`,
        dir,
        "sandbox"
      );
      await load();
      await openSkillFile(path);
    } catch (e) {
      console.error("Failed to create skill:", e);
    }
  };

  // Separate always-active and user-selectable skills
  const alwaysActiveSkills = useMemo(
    () => skills.filter((s) => s.category === "always_active"),
    [skills]
  );
  const userSelectableSkills = useMemo(
    () => {
      const selectable = skills.filter((s) => s.category === "user_selectable");
      const prefIndex = selectable.findIndex((s) => s.id === PREFERENCES_SKILL_ID);
      if (prefIndex > 0) {
        const [pref] = selectable.splice(prefIndex, 1);
        selectable.unshift(pref);
      }
      return selectable;
    },
    [skills]
  );
  const toolContextItems = useMemo<SkillBarItem[]>(
    () =>
      getAllToolManifests()
        .filter((tool) => enabledToolIds.includes(tool.id))
        .map((tool) => ({
          key: `tool:${tool.id}`,
          kind: "tool" as const,
          toolId: tool.id,
          title: tool.title,
          description: tool.description,
        })),
    [enabledToolIds]
  );
  const memoryContextItems = useMemo<SkillBarItem[]>(
    () => [
      {
        key: "memory:user",
        kind: "memory" as const,
        id: "memory-user",
        title: "User Memory",
        description: "Persistent user profile facts.",
      },
      {
        key: "memory:episodic",
        kind: "memory" as const,
        id: "memory-episodic",
        title: "ST Memory",
        description: "Recent conversation summaries.",
      },
      {
        key: "memory:project",
        kind: "memory" as const,
        id: "memory-project",
        title: "Project Memory",
        description: "Project-scoped context memory.",
      },
    ],
    []
  );
  const runtimeContextItems = useMemo<SkillBarItem[]>(
    () => [
      {
        key: "runtime:autonomy",
        kind: "runtime" as const,
        id: "autonomy",
        title: "Autonomy",
        description: "Active mode policy and tool rules.",
      },
      {
        key: "runtime:runtime",
        kind: "runtime" as const,
        id: "runtime",
        title: "Runtime",
        description: "Model, compute, and environment snapshot.",
      },
      {
        key: "runtime:template-runtime",
        kind: "runtime" as const,
        id: "runtime-template",
        title: "Runtime.md",
        description: "Edit runtime context template.",
      },
      {
        key: "runtime:template-chat",
        kind: "runtime" as const,
        id: "chat-mode-template",
        title: "Chat-Mode.md",
        description: "Edit chat mode context template.",
      },
      {
        key: "runtime:template-voice",
        kind: "runtime" as const,
        id: "voice-mode-template",
        title: "Voice-Mode.md",
        description: "Edit voice mode context template.",
      },
    ],
    []
  );
  const skillsGroupItems = useMemo<SkillBarItem[]>(
    () => [
      ...alwaysActiveSkills.map((skill) => ({ key: `always:${skill.id}`, kind: "always" as const, skill })),
      ...userSelectableSkills.map((skill) => ({ key: `skill:${skill.id}`, kind: "selectable" as const, skill })),
    ],
    [alwaysActiveSkills, userSelectableSkills]
  );
  const openGroupItems = useMemo<SkillBarItem[]>(
    () =>
      openGroup === "skills"
        ? skillsGroupItems
        : openGroup === "tools"
        ? toolContextItems
        : openGroup === "memory"
        ? memoryContextItems
        : openGroup === "runtime"
        ? runtimeContextItems
        : [],
    [memoryContextItems, openGroup, runtimeContextItems, skillsGroupItems, toolContextItems]
  );
  const topLevelItems = useMemo(
    () => [
      { id: "skills" as const, label: "Skills", count: skillsGroupItems.length },
      { id: "tools" as const, label: "Tools", count: toolContextItems.length },
      { id: "memory" as const, label: "Memory", count: memoryContextItems.length },
      { id: "runtime" as const, label: "Runtime", count: runtimeContextItems.length },
    ],
    [memoryContextItems.length, runtimeContextItems.length, skillsGroupItems.length, toolContextItems.length]
  );
  const topLevelTagClass = (groupId: "skills" | "tools" | "memory" | "runtime", active: boolean) => {
    if (groupId === "tools") {
      return active
        ? "bg-cyan-500/15 border-cyan-400/70 text-text-med"
        : "bg-line-light border-cyan-500/45 text-text-med hover:bg-line-med hover:border-cyan-400/70";
    }
    if (groupId === "memory") {
      return active
        ? "bg-emerald-500/15 border-emerald-400/70 text-text-med"
        : "bg-line-light border-emerald-500/45 text-text-med hover:bg-line-med hover:border-emerald-400/70";
    }
    if (groupId === "runtime") {
      return active
        ? "bg-amber-500/15 border-amber-400/70 text-text-med"
        : "bg-line-light border-amber-500/45 text-text-med hover:bg-line-med hover:border-amber-400/70";
    }
    return active
      ? "bg-line-med border-line-dark text-text-med"
      : "bg-line-light border-line-med text-text-med hover:bg-line-med hover:border-line-dark";
  };

  const renderSkillPill = (item: SkillBarItem) => {
    if (item.kind === "always") {
      return (
        <div
          key={item.key}
          className={cn(
            "flex-shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-all whitespace-nowrap flex items-center gap-1.5",
            "bg-line-light border-line-med text-text-med hover:bg-line-med hover:border-line-dark"
          )}
        >
          <button
            onClick={() => {
              void handleSkillClick(item.skill).catch((e) => {
                console.error("Skill click failed:", e);
              });
            }}
            title={`${item.skill.name} — always active`}
            className="flex items-center gap-1.5"
          >
            <Check size={9} className="text-accent-green" />
            {item.skill.name}
          </button>
          <button
            onClick={(event) => {
              void handleSkillEditClick(event, item.skill);
            }}
            title={`Edit ${item.skill.name}`}
            className="inline-flex items-center justify-center rounded p-0.5 text-text-dark hover:text-text-med hover:bg-line-light"
          >
            <Pencil size={9} />
          </button>
        </div>
      );
    }

    if (item.kind === "selectable") {
      const isActive = activeSkillIds.includes(item.skill.id);
      return (
        <div
          key={item.key}
          className={cn(
            "flex-shrink-0 flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-all whitespace-nowrap",
            "bg-line-light border-line-med text-text-med hover:bg-line-med hover:text-text-med hover:border-line-dark"
          )}
        >
          <button
            onClick={() => {
              void handleSkillClick(item.skill).catch((e) => {
                console.error("Skill click failed:", e);
              });
            }}
            title={isActive ? `${item.skill.name} — active (click to deactivate)` : item.skill.description || item.skill.name}
            className="flex items-center gap-1.5"
          >
            {isActive ? (
              <Check size={9} className="text-accent-green" />
            ) : (
              <span className="inline-block w-[9px]" />
            )}
            {item.skill.name}
          </button>
          <button
            onClick={(event) => {
              void handleSkillEditClick(event, item.skill);
            }}
            title={`Edit ${item.skill.name}`}
            className="inline-flex items-center justify-center rounded p-0.5 text-text-dark hover:text-text-med hover:bg-line-light"
          >
            <Pencil size={9} />
          </button>
        </div>
      );
    }

    if (item.kind === "tool") {
      const isAccessible = isToolAccessibleInMode(item.toolId);
      return (
        <button
          key={item.key}
          onClick={() => activatePanelFromAgent(item.toolId)}
          title={`${item.title} — ${item.description}`}
          className={cn(
            "flex-shrink-0 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-all whitespace-nowrap",
            "bg-line-light border-cyan-500/45 text-text-med hover:bg-line-med hover:border-cyan-400/70",
            !isAccessible && "opacity-65"
          )}
        >
          {isAccessible ? (
            <Check size={9} className="text-accent-green" />
          ) : (
            <span className="inline-block w-[9px]" />
          )}
          <span>{item.title}</span>
        </button>
      );
    }

    if (item.kind === "memory") {
      return (
        <button
          key={item.key}
          onClick={async () => {
            try {
              const contextSkill = skills.find((s) => isContextSkill(s));
              if (!contextSkill) return;
              const dir = skillsRoot ?? await skillsDir();
              setSkillsRoot(dir);
              await refreshContextSkill(skills, dir, contextSkill.id, contextSkill.path);
              await openSkillFile(contextSkill.path);
            } catch (e) {
              console.error("Failed to open memory context:", e);
            }
          }}
          title={`${item.title} — ${item.description}`}
          className={cn(
            "flex-shrink-0 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-all whitespace-nowrap",
            "bg-line-light border-emerald-500/45 text-text-med hover:bg-line-med hover:border-emerald-400/70"
          )}
        >
          <Check size={9} className="text-accent-green" />
          <span>{item.title}</span>
        </button>
      );
    }

    if (item.kind === "runtime") {
      return (
        <button
          key={item.key}
          onClick={async () => {
            try {
              if (item.id === "runtime-template") {
                await openContextTemplateFile("runtime.md");
                return;
              }
              if (item.id === "chat-mode-template") {
                await openContextTemplateFile("chat-mode.md");
                return;
              }
              if (item.id === "voice-mode-template") {
                await openContextTemplateFile("voice-mode.md");
                return;
              }
              const contextSkill = skills.find((s) => isContextSkill(s));
              if (!contextSkill) return;
              const dir = skillsRoot ?? await skillsDir();
              setSkillsRoot(dir);
              await refreshContextSkill(skills, dir, contextSkill.id, contextSkill.path);
              await openSkillFile(contextSkill.path);
            } catch (e) {
              console.error("Failed to open runtime context:", e);
            }
          }}
          title={`${item.title} — ${item.description}`}
          className={cn(
            "flex-shrink-0 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-all whitespace-nowrap",
            "bg-line-light border-amber-500/45 text-text-med hover:bg-line-med hover:border-amber-400/70"
          )}
        >
          <Check size={9} className="text-accent-green" />
          <span>{item.title}</span>
        </button>
      );
    }

    if (item.kind === "thinking") {
      return (
        <button
          key={item.key}
          onClick={() => toggleThinking()}
          title={
            thinkingEnabled
              ? "Thinking — enabled (click to disable)"
              : "Thinking — enables extended reasoning for complex problems"
          }
          className={cn(
            "flex-shrink-0 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-all whitespace-nowrap",
            thinkingEnabled
              ? "bg-line-light border-purple-400/60 text-text-med"
              : "bg-line-light border-line-med text-text-med hover:bg-line-med hover:text-text-med hover:border-line-dark"
          )}
        >
          <Brain size={10} className={thinkingEnabled ? "text-purple-300" : ""} />
          Thinking
          {thinkingEnabled && <span className="opacity-60">•</span>}
        </button>
      );
    }

    return (
      <button
        key={item.key}
        onClick={() => toggleComplexReasoning()}
        title={
          complexReasoningEnabled
            ? "Complex Reasoning — active (click to deactivate)"
            : "Complex Reasoning — enables deep analysis for difficult problems"
        }
        className={cn(
          "flex-shrink-0 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-all whitespace-nowrap",
          complexReasoningEnabled
            ? "bg-line-light border-accent-gold/60 text-text-med"
            : "bg-line-light border-line-med text-text-med hover:bg-line-med hover:text-text-med hover:border-line-dark"
        )}
      >
        <BrainCog size={10} className={complexReasoningEnabled ? "text-accent-gold" : ""} />
        Reasoning
        {complexReasoningEnabled && <span className="opacity-60">•</span>}
      </button>
    );
  };

  return (
    <div className="context-bar px-3 py-1 bg-transparent flex-shrink-0 border-b border-line-light/60">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1.5 h-5 flex-shrink-0">
          <Zap size={11} className="text-accent-primary/60 flex-shrink-0" />
          <button
            type="button"
            onClick={() => {
              void openContextSnapshotFile();
            }}
            title="Open full context snapshot in Files"
            className="text-[11px] text-text-med hover:text-text-norm hover:underline underline-offset-2 flex-shrink-0 mr-0.5"
          >
            Context:
          </button>
        </div>

        <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto scrollbar-none">
          {topLevelItems.map((group) => {
            const active = openGroup === group.id;
            return (
              <button
                key={group.id}
                onClick={() => setOpenGroup((v) => (v === group.id ? null : group.id))}
                className={cn(
                  "flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                  topLevelTagClass(group.id, active)
                )}
                title={`${group.label} context`}
              >
                <span>{group.label}</span>
                <span className="text-[10px] text-text-dark">{group.count}</span>
                {active ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            );
          })}
          {renderSkillPill({ key: "thinking", kind: "thinking" })}
          {renderSkillPill({ key: "reasoning", kind: "reasoning" })}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 h-5">
          <button
            onClick={load}
            disabled={loading}
            title="Refresh context"
            className="p-1 rounded text-text-dark hover:text-text-med hover:bg-line-light transition-colors disabled:opacity-40"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={createSkill}
            title="New context skill"
            className="p-1 rounded text-text-dark hover:text-text-med hover:bg-line-light transition-colors"
          >
            <Plus size={11} />
          </button>
        </div>
      </div>

      {openGroup && (
        <div className="mt-2 p-2 rounded border border-line-light bg-bg-norm/80">
          <div className="flex flex-wrap items-center gap-1.5">
            {openGroupItems.length === 0 && !loading ? (
              <span className="text-[10px] text-text-dark italic">No items</span>
            ) : (
              openGroupItems.map((item) => renderSkillPill(item))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
