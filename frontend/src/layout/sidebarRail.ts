import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";
import type { SidebarTab } from "../panels/types";

export function renderSidebarRail(tab: SidebarTab, llamaRuntimeOnline: boolean): string {
  return `
    <aside class="left-sidebar" id="leftSidebar">
      <nav class="sidebar-nav" aria-label="Primary">
        <button type="button" class="sidebar-icon-btn ${tab === "chat" ? "is-active" : ""}" data-sidebar-tab="chat" data-title="Chat" aria-label="Chat">
          ${iconHtml(APP_ICON.sidebar.chat, { size: 24, tone: "dark", label: "Chat" })}
        </button>
        <button type="button" class="sidebar-icon-btn ${tab === "history" ? "is-active" : ""}" data-sidebar-tab="history" data-title="History" aria-label="History">
          ${iconHtml(APP_ICON.sidebar.history, { size: 24, tone: "dark", label: "History" })}
        </button>
        <button type="button" class="sidebar-icon-btn ${tab === "workspace" ? "is-active" : ""}" data-sidebar-tab="workspace" data-title="Workspace" aria-label="Workspace">
          ${iconHtml(APP_ICON.sidebar.workspace, { size: 24, tone: "dark", label: "Workspace" })}
        </button>
        <button type="button" class="sidebar-icon-btn ${tab === "devices" ? "is-active" : ""}" data-sidebar-tab="devices" data-title="Devices" aria-label="Devices">
          ${iconHtml(APP_ICON.sidebar.devices, { size: 24, tone: "dark", label: "Devices" })}
        </button>
        <button type="button" class="sidebar-icon-btn ${tab === "tts" ? "is-active" : ""}" data-sidebar-tab="tts" data-title="TTS" aria-label="TTS">
          ${iconHtml(APP_ICON.sidebar.tts, { size: 24, tone: "dark", label: "TTS" })}
        </button>
        <button type="button" class="sidebar-icon-btn ${tab === "stt" ? "is-active" : ""}" data-sidebar-tab="stt" data-title="STT" aria-label="STT">
          ${iconHtml(APP_ICON.sidebar.stt, { size: 24, tone: "dark", label: "STT" })}
        </button>
        <button type="button" class="sidebar-icon-btn ${tab === "llama_cpp" ? "is-active" : ""}" data-sidebar-tab="llama_cpp" data-title="llama.cpp" aria-label="llama.cpp">
          ${iconHtml(APP_ICON.sidebar.llamaCpp, { size: 24, tone: "dark", label: "llama.cpp" })}
          ${llamaRuntimeOnline ? '<span class="sidebar-status-dot" aria-hidden="true"></span>' : ""}
        </button>
        <button type="button" class="sidebar-icon-btn ${tab === "model_manager" ? "is-active" : ""}" data-sidebar-tab="model_manager" data-title="Model Manager" aria-label="Model Manager">
          ${iconHtml(APP_ICON.sidebar.modelManager, { size: 24, tone: "dark", label: "Model Manager" })}
        </button>
      </nav>
      <div class="sidebar-bottom">
        <button type="button" class="sidebar-icon-btn" data-title="Settings" aria-label="Settings">
          ${iconHtml(APP_ICON.sidebar.settings, { size: 24, tone: "dark", label: "Settings" })}
        </button>
      </div>
    </aside>
  `;
}
