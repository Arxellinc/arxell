import type { TerminalManager } from "../tools/terminal/index";
import type { TerminalShellProfile } from "../tools/terminal/types";

export function shellProfileToCommand(profile: TerminalShellProfile): string | undefined {
  if (profile === "bash") return "bash";
  if (profile === "zsh") return "zsh";
  if (profile === "powershell") return "powershell.exe";
  return undefined;
}

export async function createTerminalSessionForProfile(
  terminalManager: TerminalManager,
  profile: TerminalShellProfile
): Promise<string> {
  const shell = shellProfileToCommand(profile);
  const session = await terminalManager.createSession(shell ? { shell } : undefined);
  return session.sessionId;
}

export async function closeTerminalSessionAndPickNext(
  terminalManager: TerminalManager,
  sessionId: string
): Promise<string | null> {
  await terminalManager.closeSession(sessionId);
  return terminalManager.listSessions()[0]?.sessionId ?? null;
}

export async function ensureTerminalSessionForProfile(
  terminalManager: TerminalManager,
  activeSessionId: string | null,
  profile: TerminalShellProfile
): Promise<string | null> {
  if (activeSessionId) return activeSessionId;
  const first = terminalManager.listSessions().at(0);
  if (first) return first.sessionId;
  return createTerminalSessionForProfile(terminalManager, profile);
}
