import { APP_ICON } from "../icons/map";
import { bindChatPanel, renderChatActions, renderChatBody } from "./chatPanel";
import { renderDevicesActions, renderDevicesBody } from "./devicesPanel";
import { bindHistoryPanel, renderHistoryActions, renderHistoryBody } from "./historyPanel";
import { bindLlamaCppPanel, renderLlamaCppActions, renderLlamaCppBody } from "./llamaCppPanel";
import {
  bindModelManagerPanel,
  renderModelManagerActions,
  renderModelManagerBody
} from "./modelManagerPanel";
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
      renderActions: () => renderChatActions(state)
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

  if (tab === "devices") {
    return {
      title: "Devices",
      icon: APP_ICON.sidebar.devices,
      renderBody: () => renderDevicesBody(state),
      renderActions: renderDevicesActions
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
      renderBody: () => renderSttBody(state),
      renderActions: renderSttActions
    };
  }

  if (tab === "llama_cpp") {
    return {
      title: "llama.cpp",
      icon: APP_ICON.sidebar.llamaCpp,
      renderBody: () => renderLlamaCppBody(state),
      renderActions: renderLlamaCppActions
    };
  }

  if (tab === "model_manager") {
    return {
      title: "Model Manager",
      icon: APP_ICON.sidebar.modelManager,
      renderBody: () => renderModelManagerBody(state),
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
  state: PrimaryPanelRenderState,
  bindings: PrimaryPanelBindings
): void {
  if (tab === "chat") {
    bindChatPanel(
      bindings.onSendMessage,
      bindings.onUpdateChatDraft,
      bindings.onStopCurrentResponse,
      bindings.onToggleStt,
      state.chatStreaming
    );
    const newBtn = document.querySelector<HTMLButtonElement>("#chatNewBtn");
    if (newBtn) {
      newBtn.onclick = async () => {
        await bindings.onCreateConversation();
      };
    }
    const clearBtn = document.querySelector<HTMLButtonElement>("#chatClearBtn");
    if (clearBtn) {
      clearBtn.onclick = async () => {
        await bindings.onClearChat();
      };
    }
    const thinkingToggleBtn = document.querySelector<HTMLButtonElement>("#chatThinkingToggleBtn");
    if (thinkingToggleBtn) {
      thinkingToggleBtn.onclick = async () => {
        await bindings.onToggleChatThinking();
      };
    }
    const chatSttBtn = document.querySelector<HTMLButtonElement>("#chatSttBtn");
    if (chatSttBtn) {
      chatSttBtn.onclick = async () => {
        await bindings.onToggleStt();
      };
    }
    const chatTtsBtn = document.querySelector<HTMLButtonElement>("#chatTtsBtn");
    if (chatTtsBtn) {
      chatTtsBtn.onclick = async () => {
        // TTS not yet implemented - show a toast or alert
        console.log("TTS not yet implemented");
      };
    }
    return;
  }

  if (tab === "history") {
    bindHistoryPanel(
      bindings.onCreateConversation,
      bindings.onSelectConversation,
      bindings.onExportConversation,
      bindings.onDeleteConversation
    );
    return;
  }

  if (tab === "devices") {
    const refreshBtn = document.querySelector<HTMLButtonElement>("#devicesRefreshBtn");
    if (refreshBtn) {
      refreshBtn.onclick = async () => {
        await bindings.onDevicesRefresh();
      };
    }
    const requestMicBtn = document.querySelector<HTMLButtonElement>("#devicesRequestMicBtn");
    if (requestMicBtn) {
      requestMicBtn.onclick = async () => {
        await bindings.onRequestMicrophoneAccess();
      };
    }
    const requestSpeakerBtn = document.querySelector<HTMLButtonElement>("#devicesRequestSpeakerBtn");
    if (requestSpeakerBtn) {
      requestSpeakerBtn.onclick = async () => {
        await bindings.onRequestSpeakerAccess();
      };
    }
    return;
  }

  if (tab === "llama_cpp") {
    bindLlamaCppPanel(bindings);
    return;
  }

  if (tab === "model_manager") {
    bindModelManagerPanel(bindings);
  }

  if (tab === "stt") {
    const toggleBtn = document.querySelector<HTMLButtonElement>("#sttToggleBtn");
    if (toggleBtn) {
      toggleBtn.onclick = async () => {
        await bindings.onToggleStt();
      };
    }
    const requestMicBtn = document.querySelector<HTMLButtonElement>("#sttRequestMicBtn");
    if (requestMicBtn) {
      requestMicBtn.onclick = async () => {
        await bindings.onRequestMicrophoneAccess();
        await bindings.onDevicesRefresh();
        const renderAndBind = (window as any).__renderAndBind;
        if (renderAndBind) {
          renderAndBind();
        }
      };
    }

    const vadInputs: Array<{ id: string; key: Parameters<PrimaryPanelBindings["onUpdateSttVadSetting"]>[0] }> = [
      { id: "sttVadBaseThresholdInput", key: "vadBaseThreshold" },
      { id: "sttVadStartFramesInput", key: "vadStartFrames" },
      { id: "sttVadEndFramesInput", key: "vadEndFrames" },
      { id: "sttVadDynamicMultiplierInput", key: "vadDynamicMultiplier" },
      { id: "sttVadNoiseAdaptationAlphaInput", key: "vadNoiseAdaptationAlpha" },
      { id: "sttVadPreSpeechMsInput", key: "vadPreSpeechMs" },
      { id: "sttVadMinUtteranceMsInput", key: "vadMinUtteranceMs" },
      { id: "sttVadMaxUtteranceSInput", key: "vadMaxUtteranceS" },
      { id: "sttVadForceFlushSInput", key: "vadForceFlushS" }
    ];

    for (const input of vadInputs) {
      const el = document.querySelector<HTMLInputElement>("#" + input.id);
      if (!el) continue;
      el.onchange = async () => {
        const parsed = Number.parseFloat(el.value);
        if (!Number.isFinite(parsed)) return;
        await bindings.onUpdateSttVadSetting(input.key, parsed);
      };
    }
  }
}
