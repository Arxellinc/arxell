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
  executablePath: string | null;
  executablePathDraft: string;
  runtimeStatus: string | null;
  nodeAvailable: boolean | null;
  npmAvailable: boolean | null;
  bashPath: string | null;
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
    executablePath: null,
    executablePathDraft: "",
    runtimeStatus: null,
    nodeAvailable: null,
    npmAvailable: null,
    bashPath: null,
    error: null,
    busy: false,
    spawnModalOpen: false,
    spawnLabelDraft: "",
    spawnCwdDraft: "",
    spawnPromptDraft: "",
    nextAgentIndex: 1
  };
}
