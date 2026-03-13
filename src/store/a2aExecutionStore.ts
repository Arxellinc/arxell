import { create } from "zustand";

export type A2ANodeStatus = "idle" | "running" | "succeeded" | "failed";

interface NodeRunSnapshot {
  status: A2ANodeStatus;
  input_json?: string;
  output_json?: string;
  error?: string;
}

interface A2AExecutionState {
  activeRunId: string | null;
  nodeSnapshots: Record<string, NodeRunSnapshot>;
  lastError: string | null;
  setActiveRun: (runId: string | null) => void;
  setNodeSnapshot: (nodeId: string, snapshot: NodeRunSnapshot) => void;
  resetSnapshots: () => void;
  setLastError: (error: string | null) => void;
}

export const useA2AExecutionStore = create<A2AExecutionState>((set) => ({
  activeRunId: null,
  nodeSnapshots: {},
  lastError: null,
  setActiveRun: (runId) => set({ activeRunId: runId }),
  setNodeSnapshot: (nodeId, snapshot) =>
    set((state) => ({ nodeSnapshots: { ...state.nodeSnapshots, [nodeId]: snapshot } })),
  resetSnapshots: () => set({ nodeSnapshots: {}, lastError: null }),
  setLastError: (error) => set({ lastError: error }),
}));
