import { create } from "zustand";
import type { A2AWorkflowDefinition } from "../lib/tauri";

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

interface A2AWorkflowState {
  currentWorkflowId: string | null;
  definition: A2AWorkflowDefinition | null;
  selectedNodeIds: string[];
  viewport: CanvasViewport;
  dirty: boolean;
  setCurrentWorkflow: (workflowId: string | null, definition: A2AWorkflowDefinition | null) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setViewport: (next: CanvasViewport) => void;
  patchDefinition: (updater: (current: A2AWorkflowDefinition) => A2AWorkflowDefinition) => void;
  setDirty: (dirty: boolean) => void;
}

export const useA2AWorkflowStore = create<A2AWorkflowState>((set) => ({
  currentWorkflowId: null,
  definition: null,
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  dirty: false,
  setCurrentWorkflow: (workflowId, definition) =>
    set({
      currentWorkflowId: workflowId,
      definition,
      dirty: false,
      selectedNodeIds: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }),
  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),
  setViewport: (next) => set({ viewport: next }),
  patchDefinition: (updater) =>
    set((state) => {
      if (!state.definition) return state;
      return { definition: updater(state.definition), dirty: true };
    }),
  setDirty: (dirty) => set({ dirty }),
}));
