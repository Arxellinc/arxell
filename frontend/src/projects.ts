import type { ChatIpcClient } from "./ipcClient";

export interface UserProjectInfo {
  projectName: string;
  projectSlug: string;
  rootPath: string;
  tasksPath: string;
  sheetsPath: string;
  looperPath: string;
  filesPath: string;
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
  return client.ensureUserProject({ correlationId, projectName });
}
