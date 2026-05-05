import type { PrimaryPanelRenderState } from "./types";

export function renderSettingsActions(): string {
  return "";
}

export function renderSettingsBody(state: PrimaryPanelRenderState): string {
  const preference = state.displayModePreference ?? state.displayMode;
  const chatRoute = state.chatRoutePreference ?? "auto";
  const showAppResourceCpu = state.showAppResourceCpu === true;
  const showAppResourceMemory = state.showAppResourceMemory === true;
  const showAppResourceNetwork = state.showAppResourceNetwork === true;
  const showBottomEngine = state.showBottomEngine === true;
  const showBottomModel = state.showBottomModel === true;
  const showBottomContext = state.showBottomContext === true;
  const showBottomSpeed = state.showBottomSpeed === true;
  const showBottomTtsLatency = state.showBottomTtsLatency === true;
  const enableNotificationChime = state.enableNotificationChime !== false;
  const enableChatQuestionChime = state.enableChatQuestionChime !== false;
  return `
    <div class="primary-pane-body">
      <h3>Appearance</h3>
      <div class="settings-theme-row">
        <div class="settings-theme-grid" role="group" aria-label="Theme">
          <button type="button" class="settings-theme-btn ${preference === "terminal" ? "is-active" : ""}" data-settings-theme="terminal" aria-label="Terminal theme">
            <span class="settings-theme-swatch">${renderThemePreview("terminal")}</span>
            <span>Terminal</span>
          </button>
          <button type="button" class="settings-theme-btn ${preference === "light" ? "is-active" : ""}" data-settings-theme="light" aria-label="Light theme">
            <span class="settings-theme-swatch">${renderThemePreview("light")}</span>
            <span>Light</span>
          </button>
          <button type="button" class="settings-theme-btn ${preference === "dark" ? "is-active" : ""}" data-settings-theme="dark" aria-label="Dark theme">
            <span class="settings-theme-swatch">${renderThemePreview("dark")}</span>
            <span>Dark</span>
          </button>
          <button type="button" class="settings-theme-btn ${preference === "system" ? "is-active" : ""}" data-settings-theme="system" aria-label="System theme">
            <span class="settings-theme-swatch">${renderThemePreview("system")}</span>
            <span>System</span>
          </button>
        </div>
      </div>
      <h3>Chat behavior</h3>
      <div class="settings-chat-row">
        <label class="settings-inline-label" for="settingsChatRouteSelect">Response route</label>
        <select id="settingsChatRouteSelect" class="settings-select" aria-label="Chat response route">
          <option value="auto" ${chatRoute === "auto" ? "selected" : ""}>Auto (recommended)</option>
          <option value="agent" ${chatRoute === "agent" ? "selected" : ""}>Agent only</option>
          <option value="legacy" ${chatRoute === "legacy" ? "selected" : ""}>Direct only</option>
        </select>
        <p class="settings-theme-note">
          Auto prefers the agent route and allows fallback to the direct route when needed.
        </p>
      </div>
      <h3>Status bar</h3>
      <div class="settings-chat-row">
        <label class="llama-checkbox-inline">
          <input id="settingsShowAppResourcesCpuToggle" type="checkbox" ${showAppResourceCpu ? "checked" : ""} />
          <span>Show CPU usage in bottom bar</span>
        </label>
      </div>
      <div class="settings-chat-row">
        <label class="llama-checkbox-inline">
          <input id="settingsShowAppResourcesMemoryToggle" type="checkbox" ${showAppResourceMemory ? "checked" : ""} />
          <span>Show memory usage in bottom bar</span>
        </label>
      </div>
      <div class="settings-chat-row">
        <label class="llama-checkbox-inline">
          <input id="settingsShowAppResourcesNetworkToggle" type="checkbox" ${showAppResourceNetwork ? "checked" : ""} />
          <span>Show network activity in bottom bar</span>
        </label>
      </div>
      <div class="settings-chat-row">
        <label class="llama-checkbox-inline">
          <input id="settingsShowBottomEngineToggle" type="checkbox" ${showBottomEngine ? "checked" : ""} />
          <span>Show engine in bottom bar</span>
        </label>
      </div>
      <div class="settings-chat-row">
        <label class="llama-checkbox-inline">
          <input id="settingsShowBottomModelToggle" type="checkbox" ${showBottomModel ? "checked" : ""} />
          <span>Show model in bottom bar</span>
        </label>
      </div>
      <div class="settings-chat-row">
        <label class="llama-checkbox-inline">
          <input id="settingsShowBottomContextToggle" type="checkbox" ${showBottomContext ? "checked" : ""} />
          <span>Show context in bottom bar</span>
        </label>
      </div>
      <div class="settings-chat-row">
        <label class="llama-checkbox-inline">
          <input id="settingsShowBottomSpeedToggle" type="checkbox" ${showBottomSpeed ? "checked" : ""} />
          <span>Show speed in bottom bar</span>
        </label>
      </div>
      <div class="settings-chat-row">
        <label class="llama-checkbox-inline">
          <input id="settingsShowBottomTtsLatencyToggle" type="checkbox" ${showBottomTtsLatency ? "checked" : ""} />
          <span>Show TTS latency in bottom bar</span>
        </label>
      </div>
      <h3>Sounds</h3>
      <div class="settings-chat-row">
        <label class="llama-checkbox-inline">
          <input id="settingsEnableNotificationChimeToggle" type="checkbox" ${enableNotificationChime ? "checked" : ""} />
          <span>Enable Notification chime</span>
        </label>
      </div>
      <div class="settings-chat-row">
        <label class="llama-checkbox-inline">
          <input id="settingsEnableChatQuestionChimeToggle" type="checkbox" ${enableChatQuestionChime ? "checked" : ""} />
          <span>Enable Chat Question Chime</span>
        </label>
      </div>
    </div>
  `;
}

function renderThemePreview(mode: "light" | "dark" | "system" | "terminal"): string {
  if (mode === "dark") {
    return `<svg viewBox="0 0 52 30" class="settings-theme-svg" aria-hidden="true">
      <rect x="0.5" y="0.5" width="51" height="29" rx="4" fill="#0c1118" stroke="#22303f" />
      <rect x="4" y="4" width="44" height="22" rx="2" fill="#0f1722" />
      <circle cx="8" cy="8" r="1.2" fill="#ff5f57" />
      <circle cx="12" cy="8" r="1.2" fill="#ffbd2e" />
      <circle cx="16" cy="8" r="1.2" fill="#28c840" />
      <rect x="8" y="13" width="14" height="2.2" rx="1.1" fill="#7ae582" />
      <rect x="8" y="17" width="24" height="2.2" rx="1.1" fill="#4e5968" />
    </svg>`;
  }
  if (mode === "light") {
    return `<svg viewBox="0 0 52 30" class="settings-theme-svg" aria-hidden="true">
      <rect x="0.5" y="0.5" width="51" height="29" rx="4" fill="#f5f7fb" stroke="#d7dce7" />
      <rect x="4" y="4" width="12" height="22" rx="2" fill="#e8edf7" />
      <rect x="19" y="6" width="29" height="3" rx="1.5" fill="#c2c9d7" />
      <rect x="19" y="12" width="23" height="3" rx="1.5" fill="#aab3c5" />
      <rect x="19" y="18" width="27" height="6" rx="2" fill="#dde4f3" />
    </svg>`;
  }
  if (mode === "terminal") {
    return `<svg viewBox="0 0 52 30" class="settings-theme-svg" aria-hidden="true">
      <rect x="0.5" y="0.5" width="51" height="29" rx="4" fill="#11161f" stroke="#2b3442" />
      <rect x="4" y="4" width="12" height="22" rx="2" fill="#1c2531" />
      <rect x="19" y="6" width="29" height="3" rx="1.5" fill="#4a5a73" />
      <rect x="19" y="12" width="23" height="3" rx="1.5" fill="#657891" />
      <rect x="19" y="18" width="27" height="6" rx="2" fill="#202a38" />
    </svg>`;
  }
  return `<svg viewBox="0 0 52 30" class="settings-theme-svg" aria-hidden="true">
    <rect x="0.5" y="0.5" width="51" height="29" rx="4" fill="#151b25" stroke="#303b4c" />
    <rect x="1" y="1" width="25" height="28" rx="4" fill="#f5f7fb" />
    <rect x="4" y="6" width="9" height="3" rx="1.5" fill="#c4ccdb" />
    <rect x="30" y="6" width="17" height="3" rx="1.5" fill="#5f728b" />
    <rect x="4" y="12" width="16" height="3" rx="1.5" fill="#a5b0c5" />
    <rect x="30" y="12" width="12" height="3" rx="1.5" fill="#7990ad" />
    <rect x="4" y="18" width="14" height="6" rx="2" fill="#dce3f2" />
    <rect x="30" y="18" width="16" height="6" rx="2" fill="#202a38" />
  </svg>`;
}
