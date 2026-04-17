import type { ChatIpcClient } from "../../ipcClient";
import type { SkillsToolViewState, SkillInfo } from "./state";
import { SKILLS_FOLDER, SKILL_ENTRY_FILE, extractFrontmatter } from "./state";

export interface SkillsActionsDeps {
  client: ChatIpcClient | null;
  nextCorrelationId: () => string;
  renderAndBind: () => void;
}

async function invokeFiles(
  client: ChatIpcClient,
  nextCorrelationId: () => string,
  action: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  const response = await client.toolInvoke({
    correlationId: nextCorrelationId(),
    toolId: "files",
    action,
    mode: "sandbox",
    payload: {
      correlationId: nextCorrelationId(),
      ...payload
    }
  });
  if (!response.ok) {
    throw new Error(response.error || `Files invoke failed: ${action}`);
  }
  return response.data;
}

interface ListDirectoryResponse {
  rootPath: string;
  listedPath: string;
  entries: Array<{ name: string; path: string; isDir: boolean; sizeBytes: number; modifiedMs: number | null }>;
}

interface ReadFileResponse {
  path: string;
  content: string;
  size: number;
}

let resolvedSkillsDir: string | null = null;

async function resolveSkillsDir(
  client: ChatIpcClient,
  nextCorrelationId: () => string
): Promise<string> {
  if (resolvedSkillsDir) return resolvedSkillsDir;
  const listResult = (await invokeFiles(client, nextCorrelationId, "list-directory", {
    path: SKILLS_FOLDER
  })) as unknown as ListDirectoryResponse;
  resolvedSkillsDir = listResult.listedPath;
  return resolvedSkillsDir;
}

export async function loadSkills(
  state: SkillsToolViewState,
  deps: SkillsActionsDeps
): Promise<void> {
  if (!deps.client) return;
  state.loading = true;
  state.error = null;
  deps.renderAndBind();

  try {
    const skillsDir = await resolveSkillsDir(deps.client, deps.nextCorrelationId);
    const listResult = (await invokeFiles(deps.client, deps.nextCorrelationId, "list-directory", {
      path: skillsDir
    })) as unknown as ListDirectoryResponse;

    const dirEntries = listResult.entries.filter((e) => e.isDir);

    const skills: SkillInfo[] = [];
    const contentById: Record<string, string> = {};

    for (const dirEntry of dirEntries) {
      const skillFilePath = `${dirEntry.path}/${SKILL_ENTRY_FILE}`;
      try {
        const readResult = (await invokeFiles(deps.client, deps.nextCorrelationId, "read-file", {
          path: skillFilePath
        })) as unknown as ReadFileResponse;

        const { name, description } = extractFrontmatter(readResult.content);
        const id = dirEntry.name;
        skills.push({
          id,
          name: name || id,
          description,
          content: readResult.content,
          filePath: skillFilePath
        });
        contentById[id] = readResult.content;
      } catch {
        const id = dirEntry.name;
        skills.push({
          id,
          name: id,
          description: "",
          content: "",
          filePath: skillFilePath
        });
      }
    }

    state.skills = skills;
    state.contentById = contentById;
    state.loading = false;
    deps.renderAndBind();
  } catch (err) {
    state.error = err instanceof Error ? err.message : "Failed to load skills";
    state.loading = false;
    deps.renderAndBind();
  }
}

export async function saveSkillContent(
  state: SkillsToolViewState,
  deps: SkillsActionsDeps,
  skill: SkillInfo,
  content: string
): Promise<void> {
  if (!deps.client) return;
  await invokeFiles(deps.client, deps.nextCorrelationId, "write-file", {
    path: skill.filePath,
    content
  });
  const idx = state.skills.findIndex((s) => s.id === skill.id);
  if (idx !== -1 && state.skills[idx]) {
    const { name, description } = extractFrontmatter(content);
    const existing = state.skills[idx]!;
    state.skills[idx] = {
      id: existing.id,
      name: name || skill.name,
      description: description ?? "",
      content,
      filePath: existing.filePath
    };
  }
}

export async function createNewSkill(
  state: SkillsToolViewState,
  deps: SkillsActionsDeps,
  name: string,
  description: string
): Promise<void> {
  if (!deps.client) return;
  const skillsDir = await resolveSkillsDir(deps.client, deps.nextCorrelationId);
  const skillDir = `${skillsDir}/${name}`;
  const skillFilePath = `${skillDir}/${SKILL_ENTRY_FILE}`;

  await invokeFiles(deps.client, deps.nextCorrelationId, "create-directory", {
    path: skillDir
  });

  const body = `## Instructions\n\nAdd your skill instructions here.\n`;
  const content = `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${description ? `**Use for:** ${description}\n\n` : ""}${body}`;

  await invokeFiles(deps.client, deps.nextCorrelationId, "write-file", {
    path: skillFilePath,
    content
  });

  const id = name;
  const skill: SkillInfo = { id, name, description, content, filePath: skillFilePath };
  state.skills.push(skill);
  state.contentById[id] = content;
  state.savedContentById[id] = content;
  state.dirtyById[id] = false;
  state.selectedSkillId = id;
}

export async function deleteSkillFile(
  state: SkillsToolViewState,
  deps: SkillsActionsDeps,
  skillId: string
): Promise<void> {
  if (!deps.client) return;
  const skill = state.skills.find((s) => s.id === skillId);
  if (!skill) return;

  const skillDir = skill.filePath.replace(`/${SKILL_ENTRY_FILE}`, "");
  await invokeFiles(deps.client, deps.nextCorrelationId, "delete-path", {
    path: skillDir,
    recursive: true
  });

  state.skills = state.skills.filter((s) => s.id !== skillId);
}

export async function ensureSkillsInit(
  state: SkillsToolViewState,
  deps: SkillsActionsDeps
): Promise<void> {
  if (state.skills.length > 0 || state.loading) return;
  await loadSkills(state, deps);
}

export function resetSkillsDirCache(): void {
  resolvedSkillsDir = null;
}
