import { iconHtml } from "../../icons";
import { OPENCODE_DATA_ATTR, OPENCODE_UI_ID } from "../ui/constants";
import { renderToolToolbar } from "../ui/toolbar";
import type { OpenCodeAgent, OpenCodeToolState } from "./state";
import { getInstallCommand } from "./actions";
import "./styles.css";

export function renderOpenCodeToolActions(state: OpenCodeToolState): string {
  if (!state.agents.length) return "";

  const toolbar = renderToolToolbar({
    tabsMode: "dynamic",
    tabs: [
      ...state.agents.map((agent) => ({
        id: agent.id,
        label: agent.label,
        active: agent.id === state.activeAgentId,
        closable: true,
        buttonAttrs: {
          [OPENCODE_DATA_ATTR.agentId]: agent.id
        },
        closeAttrs: {
          [OPENCODE_DATA_ATTR.closeAgentId]: agent.id
        }
      })),
      {
        id: "opencode-new-agent",
        label: "+New",
        active: false,
        closable: false,
        buttonAttrs: {
          [OPENCODE_DATA_ATTR.action]: "new-agent"
        }
      }
    ],
    actions: []
  });

  return toolbar;
}

export function renderOpenCodeToolBody(state: OpenCodeToolState): string {
  if (state.busy && !state.agents.length) {
    return `<div class="opencode-workspace">
      <div class="opencode-placeholder">Starting OpenCode...</div>
    </div>`;
  }

  if (!state.agents.length) {
    return `<div class="opencode-workspace">
      <div class="opencode-placeholder">Click to launch OpenCode</div>
    </div>`;
  }

  const activeAgent = state.agents.find((a) => a.id === state.activeAgentId);
  if (!activeAgent) {
    return `<div class="opencode-workspace">
      <div class="opencode-placeholder">No agent selected</div>
    </div>`;
  }

  return `<div class="opencode-workspace">
    ${renderBreadcrumb(activeAgent)}
    <div class="opencode-host" id="${OPENCODE_UI_ID.terminalHost}"></div>
  </div>`;
}

function renderBreadcrumb(agent: OpenCodeAgent): string {
  const segments = buildBreadcrumbSegments(agent.cwd);
  const segmentsHtml = segments
    .map(
      (seg, i) =>
        `<span class="opencode-breadcrumb-segment">${escapeHtml(seg)}</span>` +
        (i < segments.length - 1 ? `<span class="opencode-breadcrumb-sep">›</span>` : "")
    )
    .join("");

  return `<div class="opencode-breadcrumb">${iconHtml("folder-open", { size: 16, tone: "dark" })} ${segmentsHtml}</div>`;
}

function buildBreadcrumbSegments(cwd: string): string[] {
  const normalized = cwd.replace(/\\/g, "/");
  const home = normalized.replace(/^\/home\/[^/]+/, "~");
  const parts = home.split("/").filter(Boolean);
  if (parts.length === 0) return ["/"];
  return parts;
}

export function renderOpenCodeInstallModal(state: OpenCodeToolState): string {
  if (!state.installModalOpen) return "";

  const cmd = getInstallCommand();

  return `<div class="opencode-modal-overlay" id="${OPENCODE_UI_ID.installModalOverlay}">
    <div class="opencode-modal">
      <h2>${iconHtml("bot-message-square", { size: 16, tone: "dark" })} OpenCode CLI Required</h2>
      <p>OpenCode needs the CLI tool installed on your system. Run this command in the <strong>Terminal</strong> tab to install:</p>
      <div class="opencode-install-cmd">${escapeHtml(cmd)}</div>
      <p>After installation completes, click <strong>I've Installed It</strong> below.</p>
      <div class="opencode-modal-actions">
        <button type="button" ${OPENCODE_DATA_ATTR.action}="dismiss-install">Cancel</button>
        <button type="button" class="is-primary" ${OPENCODE_DATA_ATTR.action}="recheck-install" ${state.installChecking ? "disabled" : ""}>
          ${state.installChecking ? "Checking..." : "I've Installed It"}
        </button>
      </div>
    </div>
  </div>`;
}

export function renderOpenCodeSpawnModal(state: OpenCodeToolState): string {
  if (!state.spawnModalOpen) return "";

  return `<div class="opencode-modal-overlay">
    <div class="opencode-modal">
      <h2>${iconHtml("bot-message-square", { size: 16, tone: "dark" })} New Agent</h2>
      <div class="opencode-field">
        <label for="${OPENCODE_UI_ID.spawnLabelInput}">Label</label>
        <input type="text" id="${OPENCODE_UI_ID.spawnLabelInput}" value="${escapeHtml(state.spawnLabelDraft)}" ${OPENCODE_DATA_ATTR.action}="spawn-label" />
      </div>
      <div class="opencode-field">
        <label for="${OPENCODE_UI_ID.spawnCwdInput}">Working Directory</label>
        <input type="text" id="${OPENCODE_UI_ID.spawnCwdInput}" value="${escapeHtml(state.spawnCwdDraft)}" placeholder="Project root (default)" ${OPENCODE_DATA_ATTR.action}="spawn-cwd" />
      </div>
      <div class="opencode-field">
        <label for="${OPENCODE_UI_ID.spawnPromptInput}">Initial Prompt (optional)</label>
        <textarea id="${OPENCODE_UI_ID.spawnPromptInput}" placeholder="Describe what this agent should do..." ${OPENCODE_DATA_ATTR.action}="spawn-prompt">${escapeHtml(state.spawnPromptDraft)}</textarea>
      </div>
      <div class="opencode-modal-actions">
        <button type="button" ${OPENCODE_DATA_ATTR.action}="cancel-spawn">Cancel</button>
        <button type="button" class="is-primary" ${OPENCODE_DATA_ATTR.action}="confirm-spawn">
          Spawn Agent
        </button>
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
