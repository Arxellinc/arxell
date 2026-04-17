import { APP_ICON } from "../icons/map";
import { bindApisPanel, renderApisActions, renderApisBody } from "./apisPanel";
import { bindChatPanel, renderChatActions, renderChatBody } from "./chatPanel";
import { renderDevicesActions, renderDevicesBody } from "./devicesPanel";
import { bindHistoryPanel, renderHistoryActions, renderHistoryBody } from "./historyPanel";
import { bindLlamaCppPanel, renderLlamaCppActions, renderLlamaCppBody } from "./llamaCppPanel";
import {
  bindModelManagerPanel,
  renderModelManagerActions,
  renderModelManagerBody
} from "./modelManagerPanel";
import { renderSttActions, renderSttBody, renderVadActions, renderVadBody } from "./sttPanel";
import { renderSettingsActions, renderSettingsBody } from "./settingsPanel";
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

  if (tab === "apis") {
    return {
      title: "APIs",
      icon: APP_ICON.sidebar.apis,
      renderBody: () => renderApisBody(state),
      renderActions: renderApisActions
    };
  }

  if (tab === "tts") {
    return {
      title: "TTS",
      icon: APP_ICON.sidebar.tts,
      renderBody: () => renderTtsBody(state),
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

  if (tab === "vad") {
    return {
      title: "VAD",
      icon: APP_ICON.sidebar.vad,
      renderBody: () => renderVadBody(state),
      renderActions: renderVadActions
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
      renderActions: () => renderModelManagerActions(state)
    };
  }

  if (tab === "settings") {
    return {
      title: "Settings",
      icon: APP_ICON.sidebar.settings,
      renderBody: () => renderSettingsBody(state),
      renderActions: renderSettingsActions
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
      bindings.onSetChatAttachment,
      bindings.onClearChatAttachment,
      bindings.onStopCurrentResponse,
      bindings.onToggleStt,
      state.chatStreaming || state.chatTtsPlaying,
      state.chatAttachedFileName
        ? {
            name: state.chatAttachedFileName,
            content: state.chatAttachedFileContent ?? ""
          }
        : null,
      state.chatActiveModelLabel,
      state.chatActiveModelCapabilities
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
    const chatSpeechBtn = document.querySelector<HTMLButtonElement>("#chatSpeechBtn");
    if (chatSpeechBtn) {
      chatSpeechBtn.onclick = async () => {
        await bindings.onToggleVoiceMode();
      };
    }
    const chatSpeakBtn = document.querySelector<HTMLButtonElement>("#chatSpeakBtn");
    if (chatSpeakBtn) {
      chatSpeakBtn.onclick = async () => {
        await bindings.onSpeakLatestAssistantTts();
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

  if (tab === "apis") {
    bindApisPanel(bindings);
    return;
  }

  if (tab === "tts") {
    const startBtn = document.querySelector<HTMLButtonElement>("#ttsStartBtn");
    if (startBtn) {
      startBtn.onclick = async () => {
        await bindings.onTtsStart();
      };
    }
    const downloadBtn = document.querySelector<HTMLButtonElement>("#ttsDownloadModelBtn");
    if (downloadBtn) {
      downloadBtn.onclick = async () => {
        await bindings.onTtsDownloadModel();
      };
    }
    // Bind Kokoro bundle download buttons (rendered dynamically when Kokoro is selected and model not ready)
    const kokoroBundleBtns = document.querySelectorAll<HTMLButtonElement>(".kokoro-bundle-btn");
    kokoroBundleBtns.forEach((btn) => {
      btn.onclick = async () => {
        const url = btn.dataset.url;
        if (url) {
          await bindings.onTtsDownloadModelWithUrl(url);
        }
      };
    });
    const refreshBtn = document.querySelector<HTMLButtonElement>("#ttsRefreshBtn");
    if (refreshBtn) {
      refreshBtn.onclick = async () => {
        await bindings.onTtsRefresh();
      };
    }
    const voiceSelect = document.querySelector<HTMLSelectElement>("#ttsVoiceSelect");
    if (voiceSelect) {
      voiceSelect.onchange = async () => {
        await bindings.onTtsSetVoice(voiceSelect.value);
      };
    }
    const engineSelect = document.querySelector<HTMLSelectElement>("#ttsEngineSelect");
    if (engineSelect) {
      engineSelect.onchange = async () => {
        const engine = engineSelect.value;
        if (engine !== "kokoro" && engine !== "piper" && engine !== "matcha" && engine !== "kitten" && engine !== "pocket") {
          return;
        }
        await bindings.onTtsSetEngine(engine);
      };
    }
    const bundleSelect = document.querySelector<HTMLSelectElement>("#ttsBundleSelect");
    if (bundleSelect) {
      bundleSelect.onchange = async () => {
        const modelPath = bundleSelect.value.trim();
        if (!modelPath) return;
        await bindings.onTtsSetModelBundle(modelPath);
      };
    }
    const speedInput = document.querySelector<HTMLInputElement>("#ttsSpeedInput");
    if (speedInput) {
      speedInput.onchange = async () => {
        const value = Number.parseFloat(speedInput.value);
        if (!Number.isFinite(value)) return;
        await bindings.onTtsSetSpeed(value);
      };
    }
    const testText = document.querySelector<HTMLTextAreaElement>("#ttsTestTextInput");
    if (testText) {
      testText.onchange = async () => {
        await bindings.onTtsSetTestText(testText.value);
      };
    }
    const browseModelBtn = document.querySelector<HTMLButtonElement>("#ttsModelBrowseBtn");
    if (browseModelBtn) {
      browseModelBtn.onclick = async () => {
        await bindings.onTtsBrowseModelPath();
      };
    }
    const browseSecondaryBtn = document.querySelector<HTMLButtonElement>("#ttsSecondaryBrowseBtn");
    if (browseSecondaryBtn) {
      browseSecondaryBtn.onclick = async () => {
        await bindings.onTtsBrowseSecondaryPath();
      };
    }
    const speakBtn = document.querySelector<HTMLButtonElement>("#ttsSpeakBtn");
    if (speakBtn) {
      speakBtn.onclick = async () => {
        await bindings.onTtsSpeakTest();
      };
    }
    const stopBtn = document.querySelector<HTMLButtonElement>("#ttsStopBtn");
    if (stopBtn) {
      stopBtn.onclick = async () => {
        await bindings.onTtsStop();
      };
    }
    const selfTestBtn = document.querySelector<HTMLButtonElement>("#ttsSelfTestBtn");
    if (selfTestBtn) {
      selfTestBtn.onclick = async () => {
        await bindings.onTtsSelfTest();
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

  if (tab === "stt" || tab === "vad") {
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
    const backendSelect = document.querySelector<HTMLSelectElement>("#sttBackendSelect");
    if (backendSelect) {
      backendSelect.onchange = async () => {
        const next = backendSelect.value;
        if (next !== "whisper_cpp" && next !== "sherpa_onnx") return;
        await bindings.onSetSttBackend(next);
      };
    }
    const modelSelect = document.querySelector<HTMLSelectElement>("#sttModelSelect");
    if (modelSelect) {
      modelSelect.onchange = async () => {
        const next = modelSelect.value;
        await bindings.onSetSttModel(next);
      };
    }
    const languageSelect = document.querySelector<HTMLSelectElement>("#sttLanguageSelect");
    if (languageSelect) {
      languageSelect.onchange = async () => {
        const next = languageSelect.value;
        await bindings.onSetSttLanguage(next);
      };
    }
    const threadsSelect = document.querySelector<HTMLSelectElement>("#sttThreadsSelect");
    if (threadsSelect) {
      threadsSelect.onchange = async () => {
        const next = Number.parseInt(threadsSelect.value, 10);
        if (!Number.isFinite(next) || next < 1) return;
        await bindings.onSetSttThreads(next);
      };
    }
    const advancedToggleBtn = document.querySelector<HTMLButtonElement>("#sttAdvancedToggleBtn");
    if (advancedToggleBtn) {
      advancedToggleBtn.onclick = async () => {
        await bindings.onToggleSttAdvancedSettings();
      };
    }
    const modelDownloadButtons = document.querySelectorAll<HTMLButtonElement>("[data-stt-model-download]");
    for (const button of modelDownloadButtons) {
      button.onclick = async () => {
        const fileName = button.getAttribute("data-stt-model-download");
        if (!fileName) return;
        await bindings.onDownloadSttModel(fileName);
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

    const vadMethodSelect = document.querySelector<HTMLSelectElement>("#vadMethodSelect");
    if (vadMethodSelect) {
      vadMethodSelect.onchange = async () => {
        await bindings.onSetVadMethod(vadMethodSelect.value);
      };
    }
    const vadExperimentalToggle = document.querySelector<HTMLInputElement>("#vadExperimentalToggle");
    if (vadExperimentalToggle) {
      vadExperimentalToggle.onchange = async () => {
        await bindings.onSetVadIncludeExperimental(vadExperimentalToggle.checked);
      };
    }
    const methodConfigInputs = document.querySelectorAll<HTMLInputElement>("[data-vad-config-key]");
    for (const el of methodConfigInputs) {
      el.onchange = async () => {
        const key = el.getAttribute("data-vad-config-key");
        if (!key) return;
        const parsed = Number.parseFloat(el.value);
        if (!Number.isFinite(parsed)) return;
        await bindings.onUpdateVadMethodConfig(key, parsed);
      };
    }
  }

  if (tab === "settings") {
    const themeButtons = document.querySelectorAll<HTMLButtonElement>("[data-settings-theme]");
    for (const button of themeButtons) {
      button.onclick = async () => {
        const mode = button.getAttribute("data-settings-theme");
        if (mode !== "dark" && mode !== "light" && mode !== "system" && mode !== "terminal") return;
        await bindings.onSetDisplayModePreference(mode);
      };
    }
    const chatRouteSelect = document.querySelector<HTMLSelectElement>("#settingsChatRouteSelect");
    if (chatRouteSelect) {
      chatRouteSelect.onchange = async () => {
        const mode = chatRouteSelect.value;
        if (mode !== "auto" && mode !== "agent" && mode !== "legacy") return;
        await bindings.onSetChatRoutePreference(mode);
      };
    }
    const appResourcesCpuToggle = document.querySelector<HTMLInputElement>("#settingsShowAppResourcesCpuToggle");
    if (appResourcesCpuToggle) {
      appResourcesCpuToggle.onchange = async () => {
        await bindings.onSetShowAppResourceCpu(appResourcesCpuToggle.checked);
      };
    }
    const appResourcesMemoryToggle = document.querySelector<HTMLInputElement>("#settingsShowAppResourcesMemoryToggle");
    if (appResourcesMemoryToggle) {
      appResourcesMemoryToggle.onchange = async () => {
        await bindings.onSetShowAppResourceMemory(appResourcesMemoryToggle.checked);
      };
    }
    const appResourcesNetworkToggle = document.querySelector<HTMLInputElement>("#settingsShowAppResourcesNetworkToggle");
    if (appResourcesNetworkToggle) {
      appResourcesNetworkToggle.onchange = async () => {
        await bindings.onSetShowAppResourceNetwork(appResourcesNetworkToggle.checked);
      };
    }
    const showBottomEngineToggle = document.querySelector<HTMLInputElement>("#settingsShowBottomEngineToggle");
    if (showBottomEngineToggle) {
      showBottomEngineToggle.onchange = async () => {
        await bindings.onSetShowBottomEngine(showBottomEngineToggle.checked);
      };
    }
    const showBottomModelToggle = document.querySelector<HTMLInputElement>("#settingsShowBottomModelToggle");
    if (showBottomModelToggle) {
      showBottomModelToggle.onchange = async () => {
        await bindings.onSetShowBottomModel(showBottomModelToggle.checked);
      };
    }
    const showBottomContextToggle = document.querySelector<HTMLInputElement>("#settingsShowBottomContextToggle");
    if (showBottomContextToggle) {
      showBottomContextToggle.onchange = async () => {
        await bindings.onSetShowBottomContext(showBottomContextToggle.checked);
      };
    }
    const showBottomSpeedToggle = document.querySelector<HTMLInputElement>("#settingsShowBottomSpeedToggle");
    if (showBottomSpeedToggle) {
      showBottomSpeedToggle.onchange = async () => {
        await bindings.onSetShowBottomSpeed(showBottomSpeedToggle.checked);
      };
    }
    const showBottomTtsLatencyToggle = document.querySelector<HTMLInputElement>("#settingsShowBottomTtsLatencyToggle");
    if (showBottomTtsLatencyToggle) {
      showBottomTtsLatencyToggle.onchange = async () => {
        await bindings.onSetShowBottomTtsLatency(showBottomTtsLatencyToggle.checked);
      };
    }
    return;
  }
}
