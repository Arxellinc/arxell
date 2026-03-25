import type { PrimaryPanelRenderState } from "./types";
import { escapeHtml } from "./utils";

function permissionLabel(permission: PrimaryPanelRenderState["devices"]["microphonePermission"]): string {
  if (permission === "enabled") return "Enabled";
  if (permission === "no_device") return "Error: No Device";
  return "Not Enabled";
}

function renderPermissionButton(
  id: string,
  permission: PrimaryPanelRenderState["devices"]["microphonePermission"],
  label: string
): string {
  if (permission === "enabled") {
    return `<button type="button" class="tool-action-btn permission-enable-btn is-enabled" id="${id}" disabled>✓ Enabled</button>`;
  }
  if (permission === "no_device") {
    return `<button type="button" class="tool-action-btn permission-enable-btn" id="${id}" disabled>No Device</button>`;
  }
  return `<button type="button" class="tool-action-btn permission-enable-btn is-warning" id="${id}">${label}</button>`;
}

export function renderDevicesActions(): string {
  return `
    <button type="button" class="topbar-icon-btn" id="devicesRefreshBtn" data-title="Refresh Devices" title="Refresh Devices" aria-label="Refresh devices">↻</button>
  `;
}

export function renderDevicesBody(state: PrimaryPanelRenderState): string {
  const devices = state.devices;
  return `
    <div class="primary-pane-body">
      <h3>Permissions</h2>
      <div class="config-table permission-table">
        <div class="config-row">
          <span class="config-key">Microphone Permissions</span>
          <span class="config-value">${escapeHtml(permissionLabel(devices.microphonePermission))}</span>
          <span class="config-meta">${renderPermissionButton("devicesRequestMicBtn", devices.microphonePermission, "Enable")}</span>
        </div>
      </div>

      <div class="config-table permission-table">
        <div class="config-row">
          <span class="config-key">Speaker Permissions</span>
          <span class="config-value">${escapeHtml(permissionLabel(devices.speakerPermission))}</span>
          <span class="config-meta">${renderPermissionButton("devicesRequestSpeakerBtn", devices.speakerPermission, "Enable")}</span>
        </div>
      </div>

      <div class="devices-spacer-row">
        <p></p>       
      </div>

      <h3>Devices</h3>
      <div class="config-table">
        <div class="config-row">
          <span class="config-key">Audio Input Device</span>
          <span class="config-value">${escapeHtml(devices.defaultAudioInput)}</span>
          <span class="config-meta">${devices.audioInputCount} detected</span>
        </div>
        <div class="config-row">
          <span class="config-key">Audio Output Device</span>
          <span class="config-value">${escapeHtml(devices.defaultAudioOutput)}</span>
          <span class="config-meta">${devices.audioOutputCount} detected</span>
        </div>
        <div class="config-row">
          <span class="config-key">Webcam</span>
          <span class="config-value">${devices.webcamCount > 0 ? "Detected" : "Not detected"}</span>
          <span class="config-meta">${devices.webcamCount} video input(s)</span>
        </div>
        <div class="config-row">
          <span class="config-key">Keyboard</span>
          <span class="config-value">${devices.keyboardDetected ? "Detected" : "Not detected"}</span>
          <span class="config-meta">System-level</span>
        </div>
        <div class="config-row">
          <span class="config-key">Mouse / Pointer</span>
          <span class="config-value">${devices.mouseDetected ? "Detected" : "Not detected"}</span>
          <span class="config-meta">${escapeHtml(devices.lastUpdatedLabel)}</span>
        </div>
      </div>
    </div>
  `;
}
