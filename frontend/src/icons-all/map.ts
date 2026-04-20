import type { IconName } from "./index";

export const APP_ICON = {
  brand: "bot",
  sidebar: {
    toggle: "layout-panel-left",
    chat: "message-square",
    history: "history",
    workspace: "folder",
    devices: "monitor",
    tts: "volume-2",
    stt: "mic",
    vad: "mic",
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
    chatNew: "plus",
    chatClear: "trash-2",
    chatThinking: "brain",
    chatSend: "play",
    workspaceActions: "sliders-horizontal",
    toolsPanel: "wrench",
    displayModeDark: "moon",
    displayModeLight: "sun",
    layoutOrientation: "proportions"
  }
} as const satisfies {
  brand: IconName;
  sidebar: {
    toggle: IconName;
    chat: IconName;
    history: IconName;
    workspace: IconName;
    devices: IconName;
    tts: IconName;
    stt: IconName;
    vad: IconName;
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
    chatClear: IconName;
    chatThinking: IconName;
    chatSend: IconName;
    workspaceActions: IconName;
    toolsPanel: IconName;
    displayModeDark: IconName;
    displayModeLight: IconName;
    layoutOrientation: IconName;
  };
};
