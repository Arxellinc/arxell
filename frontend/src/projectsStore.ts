const PROJECTS_STORAGE_KEY = "arxell.projects.v1";
const CHAT_PROJECT_MAP_KEY = "arxell.chat-project-map.v1";
const ID_ALPHANUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export interface ProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectsRuntimeSlice {
  projectsById: Record<string, ProjectRecord>;
  projectsSelectedId: string | null;
  projectsNameDraft: string;
  projectsModalOpen: boolean;
}

interface PersistedProjectsPayload {
  projectsById: Record<string, ProjectRecord>;
}

function isValidProjectId(value: string): boolean {
  return /^p[A-Za-z0-9]{6}$/.test(value);
}

function generateProjectId(used: Set<string>): string {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    let suffix = "";
    for (let i = 0; i < 6; i += 1) {
      suffix += ID_ALPHANUM[Math.floor(Math.random() * ID_ALPHANUM.length)] ?? "A";
    }
    const next = `p${suffix}`;
    if (!used.has(next)) return next;
  }
  return `p${Date.now().toString(36).slice(-6).padEnd(6, "0").slice(0, 6)}`;
}

export function loadPersistedProjectsById(): Record<string, ProjectRecord> {
  try {
    const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedProjectsPayload>;
    if (!parsed || typeof parsed !== "object" || !parsed.projectsById) return {};
    const result: Record<string, ProjectRecord> = {};
    const usedIds = new Set<string>();
    for (const [rawId, row] of Object.entries(parsed.projectsById)) {
      if (!row || typeof row !== "object") continue;
      if (typeof row.name !== "string" || !row.name.trim()) continue;
      const now = Date.now();
      const id = isValidProjectId(rawId) ? rawId : generateProjectId(usedIds);
      usedIds.add(id);
      result[id] = {
        id,
        name: row.name,
        rootPath: typeof row.rootPath === "string" ? row.rootPath : "",
        createdAt: Number.isFinite(row.createdAt) ? row.createdAt : now,
        updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt : now
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function persistProjectsById(slice: Pick<ProjectsRuntimeSlice, "projectsById">): void {
  try {
    const payload: PersistedProjectsPayload = { projectsById: slice.projectsById };
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

export function createProject(slice: ProjectsRuntimeSlice, rootPath: string): string {
  const now = Date.now();
  const id = generateProjectId(new Set(Object.keys(slice.projectsById)));
  const name = slice.projectsNameDraft.trim() || `Project ${Object.keys(slice.projectsById).length + 1}`;
  slice.projectsById[id] = {
    id,
    name,
    rootPath,
    createdAt: now,
    updatedAt: now
  };
  slice.projectsSelectedId = id;
  slice.projectsNameDraft = "";
  slice.projectsModalOpen = false;
  persistProjectsById(slice);
  return id;
}

export function deleteProject(slice: ProjectsRuntimeSlice): void {
  const id = slice.projectsSelectedId;
  if (!id) return;
  delete slice.projectsById[id];
  slice.projectsSelectedId = null;
  persistProjectsById(slice);
}

export function updateProjectField(
  slice: ProjectsRuntimeSlice,
  field: "name" | "rootPath",
  value: string
): void {
  const id = slice.projectsSelectedId;
  if (!id) return;
  const project = slice.projectsById[id];
  if (!project) return;
  project[field] = value;
  project.updatedAt = Date.now();
  persistProjectsById(slice);
}

export function getProjectById(slice: ProjectsRuntimeSlice, id: string): ProjectRecord | null {
  return slice.projectsById[id] ?? null;
}

export function getAllProjects(slice: ProjectsRuntimeSlice): ProjectRecord[] {
  return Object.values(slice.projectsById).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadChatProjectMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(CHAT_PROJECT_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const result: Record<string, string> = {};
    for (const [convId, projId] of Object.entries(parsed)) {
      if (typeof convId === "string" && typeof projId === "string") {
        result[convId] = projId;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function persistChatProjectMap(map: Record<string, string>): void {
  try {
    window.localStorage.setItem(CHAT_PROJECT_MAP_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

export function setChatProjectId(map: Record<string, string>, conversationId: string, projectId: string): void {
  if (projectId) {
    map[conversationId] = projectId;
  } else {
    delete map[conversationId];
  }
  persistChatProjectMap(map);
}

export function getChatProjectId(map: Record<string, string>, conversationId: string): string {
  return map[conversationId] || "";
}
