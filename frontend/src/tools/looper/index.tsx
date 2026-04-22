import { iconHtml } from "../../icons";
import { LOOPER_DATA_ATTR, LOOPER_UI_ID } from "../ui/constants";
import { renderToolToolbar } from "../ui/toolbar";
import type {
  LooperLoopRun,
  LooperPhase,
  LooperPhaseState,
  LooperSubStep,
  LooperToolState
} from "./state";
import {
  getLooperTargetDirectory,
  LOOPER_PHASES,
  LOOPER_PHASE_LABELS,
  LOOPER_PHASE_ICONS,
  LOOPER_PROJECT_TYPE_OPTIONS
} from "./state";
import type { IconName } from "../../icons";
import "./styles.css";

const LOOPER_ALL_PHASES_KEY = "__all";

export function renderLooperToolActions(state: LooperToolState): string {
  const activeLoop = state.loops.find((l) => l.id === state.activeLoopId);
  const isRunning = activeLoop?.status === "running";
  const isPaused = activeLoop?.status === "paused";

  const toolbar = renderToolToolbar({
    tabsMode: "dynamic",
    tabs: [
      ...state.loops.map((loop) => ({
        id: loop.id,
        label: `Loop ${loop.iteration}`,
        active: loop.id === state.activeLoopId,
        closable: loop.status !== "running",
        buttonAttrs: {
          [LOOPER_DATA_ATTR.loopId]: loop.id
        },
        closeAttrs: {
          [LOOPER_DATA_ATTR.closeLoopId]: loop.id
        }
      })),
      {
        id: "looper-new",
        label: "+New",
        active: false,
        closable: false,
        buttonAttrs: {
          [LOOPER_DATA_ATTR.action]: "new-loop"
        }
      }
    ],
    actions: [
      ...(activeLoop && activeLoop.status === "idle"
        ? [
            {
              id: "start",
              title: "Start loop",
              icon: "play" as const,
              buttonAttrs: { [LOOPER_DATA_ATTR.action]: "start-loop" }
            }
          ]
        : []),
      ...(isRunning
        ? [
            {
              id: "pause",
              title: "Pause loop",
              icon: "octagon-pause" as const,
              buttonAttrs: { [LOOPER_DATA_ATTR.action]: "pause-loop" }
            },
            {
              id: "stop",
              title: "Stop loop",
              icon: "square" as const,
              buttonAttrs: { [LOOPER_DATA_ATTR.action]: "stop-loop" }
            }
          ]
        : []),
      ...(isPaused
        ? [
            {
              id: "resume",
              title: "Resume loop",
              icon: "play" as const,
              buttonAttrs: { [LOOPER_DATA_ATTR.action]: "resume-loop" }
            },
            {
              id: "stop-paused",
              title: "Stop loop",
              icon: "square" as const,
              buttonAttrs: { [LOOPER_DATA_ATTR.action]: "stop-loop" }
            }
          ]
        : []),
      {
        id: "config",
        title: "Configure",
        icon: "settings" as const,
        buttonAttrs: { [LOOPER_DATA_ATTR.action]: "open-config" }
      }
    ]
  });

  return toolbar;
}

export function renderLooperToolBody(state: LooperToolState): string {
  if (!state.loops.length) {
    const targetDirectory = getLooperTargetDirectory(state);
    return `<div class="looper-workspace">
      <div class="looper-placeholder">
        ${iconHtml("refresh-cw", { size: 24, tone: "dark" })}
        <h2>Ralph Looper</h2>
        <p>Multi-agent orchestration with Planner, Executor, Validator, and Critic</p>
        <div class="looper-splash-form">
          <label class="looper-splash-field">
            <span>App/Project/Tool Name:</span>
            <input type="text" id="${LOOPER_UI_ID.splashProjectName}" value="${esc(state.projectNameDraft)}" ${LOOPER_DATA_ATTR.action}="splash-project-name" placeholder="my-project" />
            <span class="looper-splash-path-preview">${esc(targetDirectory || "Target directory will appear here.")}</span>
          </label>
          <label class="looper-splash-field">
            <span>Project Type</span>
            <select id="${LOOPER_UI_ID.splashProjectType}" ${LOOPER_DATA_ATTR.action}="splash-project-type">
              ${LOOPER_PROJECT_TYPE_OPTIONS.map((opt) => `<option value="${opt}" ${state.projectTypeDraft === opt ? "selected" : ""}>${opt}</option>`).join("")}
            </select>
          </label>
          ${state.projectTypeDraft === "app-tool"
            ? `<label class="looper-splash-field">
            <span>Tool Icon (from <a href="https://lucide.dev/icons/" target="_blank" rel="noopener noreferrer" class="tts-trusted-link">Lucide</a>)</span>
            <input type="text" id="${LOOPER_UI_ID.splashProjectIcon}" value="${esc(state.projectIconDraft)}" ${LOOPER_DATA_ATTR.action}="splash-project-icon" placeholder="wrench" />
          </label>`
            : ""}
          <label class="looper-splash-field">
            <span>Project Description:</span>
            <textarea id="${LOOPER_UI_ID.splashProjectDescription}" rows="6" ${LOOPER_DATA_ATTR.action}="splash-project-description" placeholder="Describe the goals, constraints, workflows, and implementation details.">${esc(state.projectDescriptionDraft)}</textarea>
          </label>
          <label class="looper-splash-field">
            <span>Model (From Available Models list):</span>
            <select ${LOOPER_DATA_ATTR.action}="set-phase-model" ${LOOPER_DATA_ATTR.phase}="${LOOPER_ALL_PHASES_KEY}">
              ${renderPhaseModelOptions(state.availableModels, getAllPhaseModelSelection(state.phaseModels))}
            </select>
          </label>
          <details class="looper-splash-advanced">
            <summary>Advanced</summary>
            <div class="looper-splash-advanced-grid">
              <label class="looper-splash-field">
                <span>Project Directory</span>
                <input type="text" value="${esc(state.configCwdDraft)}" ${LOOPER_DATA_ATTR.action}="config-cwd" placeholder="Documents/Arxell/Projects/my-project/looper" />
              </label>
              <label class="looper-splash-field">
                <span>Max Iterations</span>
                <input type="number" value="${state.configMaxIterationsDraft}" min="1" max="100" ${LOOPER_DATA_ATTR.action}="config-max-iterations" />
              </label>
              <label class="looper-splash-field">
                <span>Task File</span>
                <input type="text" value="${esc(state.configTaskPathDraft)}" ${LOOPER_DATA_ATTR.action}="config-task-path" placeholder="task.md" />
              </label>
              <label class="looper-splash-field">
                <span>Specs Glob</span>
                <input type="text" value="${esc(state.configSpecsGlobDraft)}" ${LOOPER_DATA_ATTR.action}="config-specs-glob" placeholder="specs/*.md" />
              </label>
            </div>
            <div class="looper-splash-model-grid">
              ${LOOPER_PHASES.map((phase) => {
                const selected = state.phaseModels[phase] || "auto";
                return `<label class="looper-splash-field">
                  <span>${LOOPER_PHASE_LABELS[phase]}</span>
                  <select ${LOOPER_DATA_ATTR.action}="set-phase-model" ${LOOPER_DATA_ATTR.phase}="${phase}">
                    ${renderPhaseModelOptions(state.availableModels, selected)}
                  </select>
                </label>`;
              }).join("")}
            </div>
          </details>
        </div>
        <button type="button" class="looper-placeholder-btn" ${LOOPER_DATA_ATTR.action}="new-loop">
          ${iconHtml("plus", { size: 16, tone: "dark" })} New Loop
        </button>
      </div>
    </div>
    ${renderConfigModal(state)}
    ${renderInstallModal(state)}`;
  }

  const loop = state.loops.find((l) => l.id === state.activeLoopId);
  if (!loop) {
    return `<div class="looper-workspace">
      <div class="looper-placeholder">No loop selected</div>
    </div>`;
  }

  return `<div class="looper-workspace" ${LOOPER_DATA_ATTR.activeLoop}="${esc(loop.id)}">
    ${renderTimeline(loop)}
    ${renderTerminalGrid(loop, state)}
  </div>
    ${renderConfigModal(state)}
    ${renderInstallModal(state)}`;
}

function renderTimeline(loop: LooperLoopRun): string {
  const phasesHtml = LOOPER_PHASES.map((phase) => {
    const ps = loop.phases[phase];
    const isActive = loop.activePhase === phase;
    const isComplete = ps.status === "complete";
    const isError = ps.status === "error";
    const cls = [
      "looper-timeline-phase",
      isActive ? "is-active" : "",
      isComplete ? "is-complete" : "",
      isError ? "is-error" : ""
    ]
      .filter(Boolean)
      .join(" ");

    return `<div class="${cls}" ${LOOPER_DATA_ATTR.phase}="${phase}">
      <div class="looper-timeline-phase-header">
        ${iconHtml(LOOPER_PHASE_ICONS[phase] as IconName, { size: 16, tone: isActive ? "dark" : "light" })}
        <span class="looper-timeline-phase-label">${LOOPER_PHASE_LABELS[phase]}</span>
        ${renderPhaseStatusBadge(ps)}
      </div>
      <div class="looper-timeline-substeps">
        ${ps.substeps.map((ss) => renderSubstepPill(ss, isActive)).join("")}
      </div>
    </div>`;
  }).join("");

  return `<div class="looper-timeline">${phasesHtml}</div>`;
}

function renderPhaseStatusBadge(ps: LooperPhaseState): string {
  if (ps.status === "running") return `<span class="looper-badge is-running">●</span>`;
  if (ps.status === "complete") return `<span class="looper-badge is-complete">✓</span>`;
  if (ps.status === "error") return `<span class="looper-badge is-error">✗</span>`;
  if (ps.status === "blocked") return `<span class="looper-badge is-blocked">⏸</span>`;
  return `<span class="looper-badge is-idle">○</span>`;
}

function renderSubstepPill(ss: LooperSubStep, parentActive: boolean): string {
  const cls = [
    "looper-substep-pill",
    ss.status === "running" ? "is-running" : "",
    ss.status === "complete" ? "is-complete" : "",
    ss.status === "error" ? "is-error" : "",
    ss.status === "skipped" ? "is-skipped" : "",
    !parentActive && ss.status === "pending" ? "is-dim" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return `<span class="${cls}">${esc(ss.label)}</span>`;
}

function renderTerminalGrid(loop: LooperLoopRun, state: LooperToolState): string {
  const activePhase = loop.activePhase ?? "planner";

  const terminalsHtml = LOOPER_PHASES.map((phase) => {
    const ps = loop.phases[phase];
    const isActive = phase === activePhase;
    const cls = [
      "looper-terminal-panel",
      isActive ? "is-active" : "is-inactive"
    ].join(" ");

    const hostId = `${LOOPER_UI_ID.terminalHostPrefix}${loop.id}-${phase}`;

    return `<div class="${cls}" data-looper-phase-terminal="${phase}" data-looper-session-id="${ps.sessionId ?? ""}">
      <div class="looper-terminal-panel-header">
        <span class="looper-terminal-panel-title">
          ${iconHtml(LOOPER_PHASE_ICONS[phase] as IconName, { size: 16 })}
          ${LOOPER_PHASE_LABELS[phase]}
        </span>
        <button type="button" class="looper-terminal-panel-expand" ${LOOPER_DATA_ATTR.action}="toggle-prompt" ${LOOPER_DATA_ATTR.phase}="${phase}" title="Edit prompt">
          ${iconHtml("edit", { size: 16, tone: "dark" })}
        </button>
      </div>
      <div class="looper-terminal-host" id="${hostId}"></div>
      ${ps.promptEditing ? renderPromptEditor(loop.id, phase, ps) : ""}
    </div>`;
  }).join("");

  return `<div class="looper-terminal-grid">${terminalsHtml}</div>`;
}

function renderPromptEditor(loopId: string, phase: LooperPhase, ps: LooperPhaseState): string {
  return `<div class="looper-prompt-editor">
    <div class="looper-prompt-editor-header">
      <span>${LOOPER_PHASE_LABELS[phase]} prompt</span>
      <button type="button" class="looper-prompt-editor-close" ${LOOPER_DATA_ATTR.action}="toggle-prompt" ${LOOPER_DATA_ATTR.phase}="${phase}" title="Close">✕</button>
    </div>
    <textarea ${LOOPER_DATA_ATTR.phase}="${phase}" class="looper-prompt-textarea">${esc(ps.promptDraft)}</textarea>
  </div>`;
}

function renderConfigModal(state: LooperToolState): string {
  if (!state.configOpen) return "";

  return `<div class="looper-modal-overlay">
    <div class="looper-modal">
      <h2>${iconHtml("settings", { size: 16, tone: "dark" })} Loop Configuration</h2>
      <div class="looper-field">
        <label for="${LOOPER_UI_ID.configCwd}">Project Directory</label>
        <input type="text" id="${LOOPER_UI_ID.configCwd}" value="${esc(state.configCwdDraft)}" ${LOOPER_DATA_ATTR.action}="config-cwd" />
      </div>
      <div class="looper-field">
        <label for="${LOOPER_UI_ID.configTaskPath}">Task File</label>
        <input type="text" id="${LOOPER_UI_ID.configTaskPath}" value="${esc(state.configTaskPathDraft)}" ${LOOPER_DATA_ATTR.action}="config-task-path" />
      </div>
      <div class="looper-field">
        <label for="${LOOPER_UI_ID.configSpecsGlob}">Specs Glob</label>
        <input type="text" id="${LOOPER_UI_ID.configSpecsGlob}" value="${esc(state.configSpecsGlobDraft)}" ${LOOPER_DATA_ATTR.action}="config-specs-glob" />
      </div>
      <div class="looper-field">
        <label for="${LOOPER_UI_ID.configMaxIter}">Max Iterations</label>
        <input type="number" id="${LOOPER_UI_ID.configMaxIter}" value="${state.configMaxIterationsDraft}" min="1" max="100" ${LOOPER_DATA_ATTR.action}="config-max-iterations" />
      </div>
      <div class="looper-modal-actions">
        <button type="button" ${LOOPER_DATA_ATTR.action}="close-config">Cancel</button>
        <button type="button" class="is-primary" ${LOOPER_DATA_ATTR.action}="apply-config">Apply</button>
      </div>
    </div>
  </div>`;
}

function renderInstallModal(state: LooperToolState): string {
  if (!state.installModalOpen) return "";

  return `<div class="looper-modal-overlay" id="${LOOPER_UI_ID.installModalOverlay}">
    <div class="looper-modal">
      <h2>${iconHtml("refresh-cw", { size: 16, tone: "dark" })} OpenCode CLI Required</h2>
      <p>Looper needs the OpenCode CLI installed. Run in the Terminal tab:</p>
      <div class="looper-install-cmd">curl -fsSL https://opencode.ai/install | bash</div>
      <p>After installation, click <strong>I've Installed It</strong>.</p>
      <div class="looper-modal-actions">
        <button type="button" ${LOOPER_DATA_ATTR.action}="dismiss-install">Cancel</button>
        <button type="button" class="is-primary" ${LOOPER_DATA_ATTR.action}="recheck-install" ${state.installChecking ? "disabled" : ""}>
          ${state.installChecking ? "Checking..." : "I've Installed It"}
        </button>
      </div>
    </div>
  </div>`;
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getAllPhaseModelSelection(phaseModels: Record<string, string>): string {
  const values = LOOPER_PHASES.map((phase) => phaseModels[phase] || "auto");
  const first = values[0] || "auto";
  return values.every((value) => value === first) ? first : "auto";
}

function renderPhaseModelOptions(
  models: Array<{ id: string; label: string }>,
  selected: string
): string {
  return `<option value="auto" ${selected === "auto" ? "selected" : ""}>auto</option>${models
    .map(
      (model) =>
        `<option value="${esc(model.id)}" ${selected === model.id ? "selected" : ""}>${esc(model.label)}</option>`
    )
    .join("")}`;
}
