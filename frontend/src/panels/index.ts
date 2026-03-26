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
      renderBody: () => renderTtsBody(state),
      renderActions: () => renderTtsActions(state)
    };
  }

  if (tab === "stt") {
    return {
      title: "STT",
      icon: APP_ICON.sidebar.stt,
      renderBody: () => renderSttBody(state),
      renderActions: () => renderSttActions(state)
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
      bindings.onStopCurrentResponse,
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
    const voiceModeToggleBtn = document.querySelector<HTMLButtonElement>("#chatVoiceModeToggleBtn");
    if (voiceModeToggleBtn) {
      voiceModeToggleBtn.onclick = async () => {
        await bindings.onToggleVoiceMode();
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

  if (tab === "tts") {
    const toggleBtn = document.querySelector<HTMLButtonElement>("#ttsToggleBtn");
    if (toggleBtn) {
      toggleBtn.onclick = async () => {
        await bindings.onToggleTtsEnabled();
      };
    }
    const checkBtn = document.querySelector<HTMLButtonElement>("#ttsCheckBtn");
    if (checkBtn) {
      checkBtn.onclick = async () => {
        await bindings.onTtsCheckEngine();
      };
    }
    const testBtn = document.querySelector<HTMLButtonElement>("#ttsTestBtn");
    if (testBtn) {
      testBtn.onclick = async () => {
        await bindings.onTtsTestSpeak();
      };
    }
    const voiceSelect = document.querySelector<HTMLSelectElement>("#ttsVoiceSelect");
    if (voiceSelect) {
      voiceSelect.onchange = async () => {
        await bindings.onTtsSetVoice(voiceSelect.value);
      };
    }
    const languageSelect = document.querySelector<HTMLSelectElement>("#ttsLanguageSelect");
    if (languageSelect) {
      languageSelect.onchange = async () => {
        await bindings.onTtsSetLanguage(languageSelect.value);
      };
    }
    const chunkSizeInput = document.querySelector<HTMLInputElement>("#ttsChunkMaxCharsInput");
    const chunkPauseInput = document.querySelector<HTMLInputElement>("#ttsChunkPauseMsInput");
    const speedInput = document.querySelector<HTMLInputElement>("#ttsSpeedInput");
    const commitChunking = async () => {
      const maxChars = Number.parseInt(chunkSizeInput?.value ?? "", 10);
      const pauseMs = Number.parseInt(chunkPauseInput?.value ?? "", 10);
      await bindings.onTtsSetChunking({
        maxChars: Number.isFinite(maxChars) ? maxChars : 320,
        pauseMs: Number.isFinite(pauseMs) ? pauseMs : 90
      });
    };
    if (speedInput) {
      speedInput.onchange = async () => {
        const speed = Number.parseFloat(speedInput.value);
        await bindings.onTtsSetSpeed(Number.isFinite(speed) ? speed : 1.0);
      };
    }
    if (chunkSizeInput) {
      chunkSizeInput.onchange = commitChunking;
    }
    if (chunkPauseInput) {
      chunkPauseInput.onchange = commitChunking;
    }
    return;
  }

  if (tab === "stt") {
    const toggleBtn = document.querySelector<HTMLButtonElement>("#sttToggleBtn");
    if (toggleBtn) {
      toggleBtn.onclick = async () => {
        await bindings.onSttToggle();
      };
    }
    const refreshBtn = document.querySelector<HTMLButtonElement>("#sttRefreshBtn");
    if (refreshBtn) {
      refreshBtn.onclick = async () => {
        await bindings.onSttRefresh();
      };
    }
    const autoSubmitSelect = document.querySelector<HTMLSelectElement>("#sttAutoSubmitSelect");
    if (autoSubmitSelect) {
      autoSubmitSelect.onchange = async () => {
        await bindings.onSttSetAutoSubmit(autoSubmitSelect.value === "1");
      };
    }
    const vadThresholdInput = document.querySelector<HTMLInputElement>("#sttVadThresholdInput");
    const minSilenceInput = document.querySelector<HTMLInputElement>("#sttMinSilenceInput");
    const commitVad = async () => {
      const threshold = Number.parseFloat(vadThresholdInput?.value ?? "");
      const minSilenceMs = Number.parseInt(minSilenceInput?.value ?? "", 10);
      await bindings.onSttSetVad({
        threshold: Number.isFinite(threshold) ? threshold : 0.35,
        minSilenceMs: Number.isFinite(minSilenceMs) ? minSilenceMs : 900
      });
    };
    if (vadThresholdInput) {
      vadThresholdInput.onchange = commitVad;
    }
    if (minSilenceInput) {
      minSilenceInput.onchange = commitVad;
    }
    const modelSelect = document.querySelector<HTMLSelectElement>("#sttModelSelect");
    if (modelSelect) {
      modelSelect.onchange = async () => {
        await bindings.onSttSetModelPath(modelSelect.value);
      };
    }
    const applyModelBtn = document.querySelector<HTMLButtonElement>("#sttApplyModelBtn");
    if (applyModelBtn) {
      applyModelBtn.onclick = async () => {
        const selected = modelSelect?.value ?? "";
        await bindings.onSttSetModelPath(selected);
      };
    }
    const downloadModelBtn = document.querySelector<HTMLButtonElement>("#sttDownloadModelBtn");
    if (downloadModelBtn) {
      downloadModelBtn.onclick = async () => {
        const urlInput = document.querySelector<HTMLInputElement>("#sttModelUrlInput");
        const fileInput = document.querySelector<HTMLInputElement>("#sttModelFileNameInput");
        await bindings.onSttDownloadModel({
          url: urlInput?.value ?? "",
          fileName: fileInput?.value ?? undefined
        });
      };
    }
    const sttConsole = document.querySelector<HTMLElement>("#sttConsole");
    if (sttConsole) {
      sttConsole.scrollTop = sttConsole.scrollHeight;
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
}
