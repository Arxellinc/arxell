export interface OpenCodeAgent {
  id: string;
  label: string;
  sessionId: string;
  status: "starting" | "running" | "idle" | "done" | "error";
  cwd: string;
  startedAtMs: number;
}

export interface OpenCodeToolState {
  agents: OpenCodeAgent[];
  activeAgentId: string | null;
  installModalOpen: boolean;
  installChecking: boolean;
  installed: boolean | null;
  busy: boolean;
  spawnModalOpen: boolean;
  spawnLabelDraft: string;
  spawnCwdDraft: string;
  spawnPromptDraft: string;
  nextAgentIndex: number;
}

export function getInitialOpenCodeState(): OpenCodeToolState {
  return {
    agents: [],
    activeAgentId: null,
    installModalOpen: false,
    installChecking: false,
    installed: null,
    busy: false,
    spawnModalOpen: false,
    spawnLabelDraft: "",
    spawnCwdDraft: "",
    spawnPromptDraft: "",
    nextAgentIndex: 1
  };
}
