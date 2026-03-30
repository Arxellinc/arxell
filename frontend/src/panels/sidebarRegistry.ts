import type { IconName } from "../icons";
import { APP_ICON } from "../icons/map";
import type { SidebarTab } from "./types";

export interface SidebarPanelEntry {
  tab: SidebarTab;
  title: string;
  icon: IconName;
  statusSignal?: "stt" | "llama";
}

export const SIDEBAR_PRIMARY_PANELS: SidebarPanelEntry[] = [
  { tab: "chat", title: "Chat", icon: APP_ICON.sidebar.chat },
  { tab: "history", title: "History", icon: APP_ICON.sidebar.history },
  { tab: "workspace", title: "Workspace", icon: APP_ICON.sidebar.workspace },
  { tab: "devices", title: "Devices", icon: APP_ICON.sidebar.devices },
  { tab: "tts", title: "TTS", icon: APP_ICON.sidebar.tts },
  { tab: "stt", title: "STT", icon: APP_ICON.sidebar.stt, statusSignal: "stt" },
  { tab: "llama_cpp", title: "llama.cpp", icon: APP_ICON.sidebar.llamaCpp, statusSignal: "llama" },
  { tab: "model_manager", title: "Model Manager", icon: APP_ICON.sidebar.modelManager },
  { tab: "apis", title: "APIs", icon: APP_ICON.sidebar.apis }
];
