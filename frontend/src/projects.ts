import type { ChatIpcClient } from "./ipcClient";

const ACTIVE_PROJECT_STORAGE_KEY = "arxell.active-project.v1";

export interface UserProjectInfo {
  projectName: string;
  projectSlug: string;
  rootPath: string;
  tasksPath: string;
  sheetsPath: string;
  looperPath: string;
  filesPath: string;
}

export function getActiveProjectName(): string | null {
  try {
    const value = window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function setActiveProjectName(projectName: string): void {
  try {
    const trimmed = projectName.trim();
    if (!trimmed) {
      window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, trimmed);
  } catch {
    // ignore storage errors
  }
}

export async function getUserProjectRoots(
  client: ChatIpcClient,
  correlationId: string
): Promise<{ contentRoot: string; projectsRoot: string; toolsRoot: string }> {
  return client.getUserProjectsRoots({ correlationId });
}

export async function ensureUserProject(
  client: ChatIpcClient,
  correlationId: string,
  projectName: string
): Promise<UserProjectInfo> {
  const project = await client.ensureUserProject({ correlationId, projectName });
  setActiveProjectName(project.projectName);
  return project;
}
