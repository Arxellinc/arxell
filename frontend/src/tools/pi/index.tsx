import { iconHtml } from "../../icons";
import { PI_DATA_ATTR, PI_UI_ID } from "../ui/constants";
import { renderToolToolbar } from "../ui/toolbar";
import type { PiAgent, PiToolState } from "./state";
import { getInstallCommand } from "./actions";
import "./styles.css";

export function renderPiToolActions(state: PiToolState): string {
  const toolbar = renderToolToolbar({
    tabsMode: "dynamic",
    tabs: [
      ...state.agents.map((agent) => ({
        id: agent.id,
        label: agent.label,
        active: agent.id === state.activeAgentId,
        closable: true,
        buttonAttrs: {
          [PI_DATA_ATTR.agentId]: agent.id
        },
        closeAttrs: {
          [PI_DATA_ATTR.closeAgentId]: agent.id
        }
      })),
      {
        id: "pi-new-agent",
        label: "+New",
        active: false,
        closable: false,
        buttonAttrs: {
          [PI_DATA_ATTR.action]: "new-agent"
        }
      }
    ],
    actions: []
  });

  return toolbar;
}

export function renderPiToolBody(state: PiToolState): string {
  if (state.busy && !state.agents.length) {
    return `<div class="pi-workspace">
      <div class="pi-placeholder">Starting Pi...</div>
    </div>`;
  }

  if (!state.agents.length) {
    return `<div class="pi-workspace is-empty">
      <div class="pi-placeholder">
        <span>${state.error ? escapeHtml(state.error) : "Launch a Pi coding-agent session."}</span>
        <button type="button" class="tool-action-btn" ${PI_DATA_ATTR.action}="new-agent">Launch Pi</button>
      </div>
    </div>`;
  }

  const activeAgent = state.agents.find((a) => a.id === state.activeAgentId);
  if (!activeAgent) {
    return `<div class="pi-workspace">
      <div class="pi-placeholder">No agent selected</div>
    </div>`;
  }

  return `<div class="pi-workspace">
    ${renderBreadcrumb(activeAgent)}
    <div class="pi-host" id="${PI_UI_ID.terminalHost}"></div>
  </div>`;
}

function renderBreadcrumb(agent: PiAgent): string {
  const segments = buildBreadcrumbSegments(agent.cwd);
  const segmentsHtml = segments
    .map(
      (seg, i) =>
        `<span class="pi-breadcrumb-segment">${escapeHtml(seg)}</span>` +
        (i < segments.length - 1 ? `<span class="pi-breadcrumb-sep">›</span>` : "")
    )
    .join("");

  return `<div class="pi-breadcrumb">${iconHtml("folder-open", { size: 16, tone: "dark" })} ${segmentsHtml}</div>`;
}

function buildBreadcrumbSegments(cwd: string): string[] {
  const normalized = cwd.replace(/\\/g, "/");
  const home = normalized.replace(/^\/home\/[^/]+/, "~");
  const parts = home.split("/").filter(Boolean);
  if (parts.length === 0) return ["/"];
  return parts;
}

export function renderPiInstallModal(state: PiToolState): string {
  if (!state.installModalOpen) return "";

  const cmd = getInstallCommand();

  return `<div class="modal-backdrop-fixed" id="${PI_UI_ID.installModalOverlay}">
    <div class="modal-box-fixed">
      <div class="modal-title">${iconHtml("bot-message-square", { size: 16, tone: "dark" })} Pi CLI Required</div>
      <p>Install the Pi coding harness with npm, then recheck availability.</p>
      <div class="pi-install-cmd">${escapeHtml(cmd)}</div>
      ${state.error ? `<p class="pi-error">${escapeHtml(state.error)}</p>` : ""}
      <div class="modal-actions">
        <button type="button" class="modal-btn" ${PI_DATA_ATTR.action}="dismiss-install">Cancel</button>
        <button type="button" class="modal-btn" ${PI_DATA_ATTR.action}="recheck-install" ${state.installChecking ? "disabled" : ""}>
          ${state.installChecking ? "Checking..." : "I've Installed It"}
        </button>
        <button type="button" class="modal-btn" ${PI_DATA_ATTR.action}="install-now" ${state.installChecking ? "disabled" : ""}>
          Install Now
        </button>
      </div>
    </div>
  </div>`;
}

export function renderPiSpawnModal(state: PiToolState): string {
  if (!state.spawnModalOpen) return "";

  return `<div class="modal-backdrop-fixed">
    <div class="modal-box-fixed">
      <div class="modal-title">${iconHtml("bot-message-square", { size: 16, tone: "dark" })} New Pi Session</div>
      <label class="field" for="${PI_UI_ID.spawnLabelInput}">Label
        <input class="field-input-soft" type="text" id="${PI_UI_ID.spawnLabelInput}" value="${escapeHtml(state.spawnLabelDraft)}" ${PI_DATA_ATTR.action}="spawn-label" />
      </label>
      <label class="field" for="${PI_UI_ID.spawnCwdInput}">Working Directory
        <input class="field-input-soft" type="text" id="${PI_UI_ID.spawnCwdInput}" value="${escapeHtml(state.spawnCwdDraft)}" placeholder="Selected project root" ${PI_DATA_ATTR.action}="spawn-cwd" />
      </label>
      <label class="field" for="${PI_UI_ID.spawnPromptInput}">Initial Prompt (optional)
        <textarea class="field-textarea-soft" id="${PI_UI_ID.spawnPromptInput}" placeholder="Describe what this agent should do..." ${PI_DATA_ATTR.action}="spawn-prompt">${escapeHtml(state.spawnPromptDraft)}</textarea>
      </label>
      <div class="modal-actions">
        <button type="button" class="modal-btn" ${PI_DATA_ATTR.action}="cancel-spawn">Cancel</button>
        <button type="button" class="modal-btn" ${PI_DATA_ATTR.action}="confirm-spawn">Spawn Session</button>
      </div>
    </div>
  </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
