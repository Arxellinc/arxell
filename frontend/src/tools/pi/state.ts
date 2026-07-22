export interface PiAgent {
  id: string;
  label: string;
  sessionId: string;
  status: "starting" | "running" | "idle" | "done" | "error";
  cwd: string;
  startedAtMs: number;
}

export interface PiToolState {
  agents: PiAgent[];
  activeAgentId: string | null;
  installModalOpen: boolean;
  installChecking: boolean;
  installed: boolean | null;
  version: string | null;
  error: string | null;
  busy: boolean;
  spawnModalOpen: boolean;
  spawnLabelDraft: string;
  spawnCwdDraft: string;
  spawnPromptDraft: string;
  nextAgentIndex: number;
}

export function getInitialPiState(): PiToolState {
  return {
    agents: [],
    activeAgentId: null,
    installModalOpen: false,
    installChecking: false,
    installed: null,
    version: null,
    error: null,
    busy: false,
    spawnModalOpen: false,
    spawnLabelDraft: "",
    spawnCwdDraft: "",
    spawnPromptDraft: "",
    nextAgentIndex: 1
  };
}
