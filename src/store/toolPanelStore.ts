import { create } from "zustand";
import { getAllToolManifests } from "../core/tooling/registry";
import type { ToolPanelId } from "../core/tooling/types";

export type { ToolPanelId } from "../core/tooling/types";

interface ToolPanelState {
  activePanel: ToolPanelId;
  consoleVisible: boolean;
  toolbarPosition: "left" | "top";
  agentActivationToken: number;
  agentActivationPanel: ToolPanelId | null;
  setPanel: (panel: ToolPanelId) => void;
  activatePanelFromAgent: (panel: ToolPanelId) => void;
  togglePanel: (panel: ToolPanelId) => void;
  toggleConsole: () => void;
  setConsoleVisible: (visible: boolean) => void;
  setToolbarPosition: (position: "left" | "top") => void;
  toggleToolbarPosition: () => void;
}

export const useToolPanelStore = create<ToolPanelState>((set, get) => ({
  activePanel: "avatar",
  consoleVisible: true,
  toolbarPosition: "left",
  agentActivationToken: 0,
  agentActivationPanel: null,

  setPanel: (panel) => set({ activePanel: panel }),
  activatePanelFromAgent: (panel) =>
    set((state) => ({
      activePanel: panel,
      agentActivationPanel: panel,
      agentActivationToken: state.agentActivationToken + 1,
    })),

  togglePanel: (panel) => {
    const current = get().activePanel;
    set({ activePanel: current === panel ? "none" : panel });
  },

  toggleConsole: () => set((state) => ({ consoleVisible: !state.consoleVisible })),

  setConsoleVisible: (visible) => set({ consoleVisible: visible }),
  setToolbarPosition: (position) => set({ toolbarPosition: position }),
  toggleToolbarPosition: () =>
    set((state) => ({ toolbarPosition: state.toolbarPosition === "left" ? "top" : "left" })),
}));

export interface ToolPanelConfig {
  id: ToolPanelId;
  icon: string;
  title: string;
  description: string;
  category: "main" | "bottom";
}

export const TOOL_PANELS: ToolPanelConfig[] = getAllToolManifests().map((tool) => ({
  id: tool.id,
  icon: tool.iconName,
  title: tool.title,
  description: tool.description,
  category: tool.category === "aux" ? "bottom" : "main",
}));

export function getToolPanelConfig(id: ToolPanelId): ToolPanelConfig | undefined {
  return TOOL_PANELS.find((p) => p.id === id);
}

export function generateAvailableToolsContent(): string {
  const mainPanels = TOOL_PANELS.filter((p) => p.category === "main");

  let content = `# Available Tools and Panels

You have access to various tools and panels in the application. These can be used to manage different aspects of the workspace and agent functionality.

## Tool Panels Available

`;

  for (const panel of mainPanels) {
    content += `### ${panel.title}\n${panel.description}\n\n`;
  }

  content += `### Console\nThe Console panel at the bottom is logs-only and shows system/frontend/backend events. It does not execute commands.\n\n`;
  content += `## Usage\nThese panels are available in the right sidebar of the application. The user can switch between them to access different functionality.\n`;

  return content;
}
