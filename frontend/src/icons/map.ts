import type { IconName } from "./index";

export const APP_ICON = {
  brand: "bot",
  sidebar: {
    toggle: "layout-panel-left",
    chat: "message-square",
    history: "history",
    workspace: "folder",
    tts: "volume-2",
    stt: "mic",
    llamaCpp: "cpu",
    modelManager: "package-search",
    terminal: "square-terminal",
    settings: "settings"
  },
  pane: {
    chat: "messages-square",
    workspace: "columns-2"
  },
  bottom: {
    history: "history",
    terminal: "square-terminal",
    tools: "wrench"
  },
  action: {
    chatNew: "list",
    chatSend: "play",
    workspaceActions: "sliders-horizontal",
    toolsPanel: "wrench",
    displayModeDark: "moon",
    displayModeLight: "sun"
  }
} as const satisfies {
  brand: IconName;
  sidebar: {
    toggle: IconName;
    chat: IconName;
    history: IconName;
    workspace: IconName;
    tts: IconName;
    stt: IconName;
    llamaCpp: IconName;
    modelManager: IconName;
    terminal: IconName;
    settings: IconName;
  };
  pane: {
    chat: IconName;
    workspace: IconName;
  };
  bottom: {
    history: IconName;
    terminal: IconName;
    tools: IconName;
  };
  action: {
    chatNew: IconName;
    chatSend: IconName;
    workspaceActions: IconName;
    toolsPanel: IconName;
    displayModeDark: IconName;
    displayModeLight: IconName;
  };
};
