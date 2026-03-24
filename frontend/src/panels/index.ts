import { APP_ICON } from "../icons/map";
import { bindChatPanel, renderChatActions, renderChatBody } from "./chatPanel";
import { bindHistoryPanel, renderHistoryActions, renderHistoryBody } from "./historyPanel";
import { renderLlamaCppActions, renderLlamaCppBody } from "./llamaCppPanel";
import { renderModelManagerActions, renderModelManagerBody } from "./modelManagerPanel";
import { renderSttActions, renderSttBody } from "./sttPanel";
import type {
  PrimaryPanelBindings,
  PrimaryPanelDefinition,
  PrimaryPanelRenderState,
  SidebarTab
} from "./types";
import { renderTtsActions, renderTtsBody } from "./ttsPanel";
import { renderWorkspaceActions, renderWorkspaceBody } from "./workspacePanel";

export function getPanelDefinition(
  tab: SidebarTab,
  state: PrimaryPanelRenderState
): PrimaryPanelDefinition {
  if (tab === "chat") {
    return {
      title: "Chat",
      icon: APP_ICON.pane.chat,
      renderBody: () => renderChatBody(state),
      renderActions: renderChatActions
    };
  }

  if (tab === "history") {
    return {
      title: "History",
      icon: APP_ICON.sidebar.history,
      renderBody: () => renderHistoryBody(state),
      renderActions: renderHistoryActions
    };
  }

  if (tab === "workspace") {
    return {
      title: "Workspace",
      icon: APP_ICON.sidebar.workspace,
      renderBody: () => renderWorkspaceBody(state),
      renderActions: renderWorkspaceActions
    };
  }

  if (tab === "tts") {
    return {
      title: "TTS",
      icon: APP_ICON.sidebar.tts,
      renderBody: renderTtsBody,
      renderActions: renderTtsActions
    };
  }

  if (tab === "stt") {
    return {
      title: "STT",
      icon: APP_ICON.sidebar.stt,
      renderBody: renderSttBody,
      renderActions: renderSttActions
    };
  }

  if (tab === "llama_cpp") {
    return {
      title: "llama.cpp",
      icon: APP_ICON.sidebar.llamaCpp,
      renderBody: renderLlamaCppBody,
      renderActions: renderLlamaCppActions
    };
  }

  if (tab === "model_manager") {
    return {
      title: "Model Manager",
      icon: APP_ICON.sidebar.modelManager,
      renderBody: renderModelManagerBody,
      renderActions: renderModelManagerActions
    };
  }

  return {
    title: "Workspace",
    icon: APP_ICON.sidebar.workspace,
    renderBody: () => renderWorkspaceBody(state),
    renderActions: renderWorkspaceActions
  };
}

export function attachPrimaryPanelInteractions(
  tab: SidebarTab,
  bindings: PrimaryPanelBindings
): void {
  if (tab === "chat") {
    bindChatPanel(bindings.onSendMessage);
    return;
  }

  if (tab === "history") {
    bindHistoryPanel(bindings.onCreateConversation, bindings.onSelectConversation);
  }
}
