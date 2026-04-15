import type { AppEvent, FlowMode, FlowRunRecord, FlowRerunValidationResult } from "../../contracts";
import { escapeHtml } from "../../panels/utils";
import { FLOW_DATA_ATTR, FLOW_UI_ID } from "../ui/constants";
import type { FlowPhaseTranscriptEntry } from "./state";
import { renderToolToolbar } from "../ui/toolbar";
import "./styles.css";

const FLOW_PROJECT_TYPE_OPTIONS = [
  "app-tool",
  "standalone-app",
  "api-backend-service",
  "cli-tool",
  "library-sdk",
  "browser-extension",
  "data-pipeline-etl",
  "ai-agent-assistant",
  "other"
];

const FLOW_PHASE_MODEL_KEYS = ["select_task", "investigate", "update_plan", "implement", "validate"];
const FLOW_ALL_PHASES_KEY = "__all";

export interface FlowTerminalSessionView {
  sessionId: string;
  title: string;
  status: "running" | "exited";
}

export interface FlowToolViewState {
  runs: FlowRunRecord[];
  activeRunId: string | null;
  mode: FlowMode;
  maxIterations: number;
  dryRun: boolean;
  autoPush: boolean;
  promptPlanPath: string;
  promptBuildPath: string;
  planPath: string;
  specsGlob: string;
  implementCommand: string;
  backpressureCommands: string;
  eventFilter: string;
  filteredEvents: AppEvent[];
  busy: boolean;
  message: string | null;
  validationResults: FlowRerunValidationResult[];
  advancedOpen: boolean;
  bottomPanel: "terminal" | "validate" | "events";
  workspaceSplit: number;
  activeTerminalPhase: string;
  terminalPhases: string[];
  phaseSessionByName: Record<string, string>;
  terminalSessions: FlowTerminalSessionView[];
  autoFocusPhaseTerminal: boolean;
  activePhaseTranscript: FlowPhaseTranscriptEntry[];
  projectSetupOpen: boolean;
  projectNameDraft: string;
  projectTypeDraft: string;
  projectIconDraft: string;
  projectDescriptionDraft: string;
  phaseModels: Record<string, string>;
  availableModels: Array<{ id: string; label: string }>;
  paused: boolean;
  useAgent: boolean;
  modelUnavailableOpen: boolean;
  modelUnavailablePhase: string;
  modelUnavailableModel: string;
  modelUnavailableFallbackModel: string;
  modelUnavailableReason: string;
  modelUnavailableAttempt: number;
  modelUnavailableMaxAttempts: number;
  modelUnavailableStatus: string;
  embeddedFilesHtml: string;
}

function isRunningStatus(status: FlowRunRecord["status"]): boolean {
  return status === "queued" || status === "running";
}

export function renderFlowToolActions(view: FlowToolViewState): string {
  const activeRun = view.runs.find((run) => run.runId === view.activeRunId) ?? null;
  const running = activeRun ? isRunningStatus(activeRun.status) : false;
  return renderToolToolbar({
    tabsMode: "static",
    tabs: view.runs.slice(0, 8).map((run) => ({
      id: run.runId,
      label: `${run.mode}:${run.runId.slice(-4)}`,
      active: run.runId === view.activeRunId,
      closable: false,
      buttonAttrs: {
        [FLOW_DATA_ATTR.action]: "select-run",
        [FLOW_DATA_ATTR.runId]: run.runId
      }
    })),
    actions: [
      {
        id: "flow-mode-plan",
        title: "Set mode: plan",
        label: "Plan",
        active: view.mode === "plan",
        className: "is-text is-compact",
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "set-mode-plan"
        }
      },
      {
        id: "flow-mode-build",
        title: "Set mode: build",
        label: "Build",
        active: view.mode === "build",
        className: "is-text is-compact",
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "set-mode-build"
        }
      },
      {
        id: "flow-dry-run",
        title: "Toggle dry run",
        label: "Dry",
        active: view.dryRun,
        className: "is-text is-compact",
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "toggle-dry-run"
        }
      },
      {
        id: "flow-use-agent",
        title: "Toggle agent-driven implementation",
        label: "Agent",
        active: view.useAgent,
        className: "is-text is-compact",
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "toggle-use-agent"
        }
      },
      {
        id: "flow-start",
        title: "Start run",
        icon: "play",
        className: "flow-toolbar-icon-sm",
        disabled: running,
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "start-run"
        }
      },
      {
        id: "flow-stop",
        title: "Cancel run",
        icon: "square-terminal",
        className: "flow-toolbar-icon-sm",
        disabled: !running,
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "stop-run"
        }
      },
      {
        id: "flow-pause",
        title: view.paused ? "Resume run" : "Pause run",
        label: view.paused ? "Resume" : "Pause",
        className: "is-text is-compact",
        disabled: !running,
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "toggle-paused-run"
        }
      },
      {
        id: "flow-nudge",
        title: "Redirect/Nudge active run",
        label: "Nudge",
        className: "is-text is-compact",
        disabled: !running,
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "nudge-run"
        }
      },
      {
        id: "flow-retry",
        title: "Retry run",
        icon: "history",
        className: "flow-toolbar-icon-sm",
        disabled: !activeRun || running,
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "retry-run"
        }
      },
      {
        id: "flow-resume",
        title: "Resume run",
        icon: "play",
        className: "flow-toolbar-icon-sm",
        disabled: !activeRun || running,
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "resume-run"
        }
      },
      {
        id: "flow-advanced-toggle",
        title: view.advancedOpen ? "Hide advanced options" : "Show advanced options",
        label: view.advancedOpen ? "Advanced -" : "Advanced +",
        active: view.advancedOpen,
        className: "is-text is-compact",
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "toggle-advanced"
        }
      },
      {
        id: "flow-refresh",
        title: "Refresh runs",
        icon: "history",
        className: "flow-toolbar-icon-sm",
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "refresh-runs"
        }
      },
      {
        id: "flow-follow-phase",
        title: view.autoFocusPhaseTerminal
          ? "Auto-follow active step is enabled"
          : "Auto-follow active step is disabled",
        label: "Follow",
        active: view.autoFocusPhaseTerminal,
        className: "is-text is-compact",
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "toggle-phase-follow"
        }
      }
    ]
  });
}

function renderValidationRows(results: FlowRerunValidationResult[]): string {
  if (!results.length) {
    return '<div class="flow-empty flow-empty-inline">No validation output yet.</div>';
  }
  return `<table class="flow-validation-table"><thead><tr><th>Command</th><th>Status</th><th>Exit</th><th>Duration</th><th>Output</th></tr></thead><tbody>${results
    .map((result) => {
      const output = [result.stdout, result.stderr].filter(Boolean).join(" | ");
      return `<tr class="${result.ok ? "ok" : "fail"}"><td><code>${escapeHtml(
        result.command
      )}</code></td><td>${result.ok ? "ok" : "fail"}</td><td>${result.exitCode}</td><td>${escapeHtml(
        `${Math.max(0, result.durationMs)} ms`
      )}</td><td>${escapeHtml(output || "-")}</td></tr>`;
    })
    .join("")}</tbody></table>`;
}

function renderEventRows(events: AppEvent[]): string {
  return events
    .slice(-120)
    .reverse()
    .map((event, idx) => {
      const payloadText =
        typeof event.payload === "object" ? JSON.stringify(event.payload, null, 2) : String(event.payload);
      const eventIndex = idx;
      return `<div class="flow-event-row severity-${escapeHtml(event.severity)}">
        <span class="flow-event-time">${escapeHtml(new Date(event.timestampMs).toLocaleTimeString())}</span>
        <span class="flow-event-action">${escapeHtml(event.action)}</span>
        <span class="flow-event-stage">${escapeHtml(event.stage)}</span>
        <span class="flow-event-corr">${escapeHtml(event.correlationId)}</span>
        <button class="flow-event-copy" ${FLOW_DATA_ATTR.action}="copy-event" data-flow-event-index="${eventIndex}">copy</button>
        <details class="flow-event-details"><summary>payload</summary><pre>${escapeHtml(payloadText)}</pre></details>
      </div>`;
    })
    .join("");
}

export function renderFlowToolBody(view: FlowToolViewState): string {
  const activeRun = view.runs.find((run) => run.runId === view.activeRunId) ?? null;
  const split = Math.max(28, Math.min(78, view.workspaceSplit));
  const activePhase = view.activeTerminalPhase;
  const bottomPanelTabs: Array<{ id: "terminal" | "validate" | "events"; label: string }> = [
    { id: "terminal", label: "Terminal" },
    { id: "validate", label: "Validate" },
    { id: "events", label: "Events" }
  ];

  const terminalPhaseTabs = view.terminalPhases
    .map((phase) => {
      const selected = phase === activePhase;
      const hasSession = Boolean(view.phaseSessionByName[phase]);
      const phaseState =
        activeRun?.iterations
          .at(-1)
          ?.steps.find((step) => step.step === phase)?.state ?? "pending";
      return `<button class="flow-phase-tab state-${escapeHtml(phaseState)} ${selected ? "is-active" : ""}" ${FLOW_DATA_ATTR.action}="select-terminal-phase" ${FLOW_DATA_ATTR.phase}="${escapeHtml(
        phase
      )}"><span>${escapeHtml(phase)}</span><span class="flow-phase-state">${escapeHtml(
        phaseState
      )}</span>${hasSession ? "" : '<span class="flow-phase-missing">*</span>'}</button>`;
    })
    .join("");

  const bottomBody =
    view.bottomPanel === "terminal"
      ? `<div class="flow-terminal-panel">
          <div class="flow-terminal-header">
            <div class="flow-phase-tabs">${terminalPhaseTabs}</div>
          </div>
          <div class="flow-phase-terminal-host terminal-host" id="flowPhaseTerminalHost"></div>
          <div class="flow-transcript-strip">
            ${
              view.activePhaseTranscript.length
                ? view.activePhaseTranscript
                    .slice(-8)
                    .map(
                      (entry) =>
                        `<div class="flow-transcript-row kind-${escapeHtml(entry.kind)}"><span class="ts">${escapeHtml(
                          new Date(entry.timestampMs).toLocaleTimeString()
                        )}</span><span class="msg">${escapeHtml(entry.message)}</span></div>`
                    )
                    .join("")
                : '<div class="flow-empty flow-empty-inline">No transcript yet for this phase.</div>'
            }
          </div>
        </div>`
      : view.bottomPanel === "validate"
        ? `<div class="flow-bottom-scroll">
            ${renderValidationRows(view.validationResults)}
          </div>`
        : `<div class="flow-bottom-scroll">
            <header class="flow-section-header flow-events-header">
              <h3>Event Inspector</h3>
              <input id="${FLOW_UI_ID.eventFilterInput}" type="text" value="${escapeHtml(
            view.eventFilter
          )}" placeholder="Filter by action/run/correlation" />
            </header>
            <div class="flow-event-list">${renderEventRows(view.filteredEvents) || '<div class="flow-empty">No events match filter.</div>'}</div>
          </div>`;

  return `<div class="flow-tool primary-pane-body">
    ${
      view.advancedOpen
        ? `<section class="flow-controls">
      <div class="flow-controls-grid">
        <label class="flow-control">
          <span>Max Iterations</span>
          <input id="${FLOW_UI_ID.maxIterationsInput}" type="number" min="1" max="200" value="${view.maxIterations}" />
        </label>
        <label class="flow-control flow-toggle">
          <input id="${FLOW_UI_ID.autoPushToggle}" type="checkbox" ${view.autoPush ? "checked" : ""} />
          <span>Auto Push</span>
        </label>
      </div>
      <div class="flow-controls-grid flow-controls-grid-paths">
        <label class="flow-control"><span>Plan Prompt</span><input id="${FLOW_UI_ID.promptPlanPath}" type="text" value="${escapeHtml(
            view.promptPlanPath
          )}" /></label>
        <label class="flow-control"><span>Build Prompt</span><input id="${FLOW_UI_ID.promptBuildPath}" type="text" value="${escapeHtml(
            view.promptBuildPath
          )}" /></label>
        <label class="flow-control"><span>Plan Path</span><input id="${FLOW_UI_ID.planPath}" type="text" value="${escapeHtml(
            view.planPath
          )}" /></label>
        <label class="flow-control"><span>Specs Glob</span><input id="${FLOW_UI_ID.specsGlob}" type="text" value="${escapeHtml(
            view.specsGlob
          )}" /></label>
      </div>
      <label class="flow-control flow-control-full">
        <span>Implement Command</span>
        <input id="${FLOW_UI_ID.implementCommand}" type="text" value="${escapeHtml(
            view.implementCommand
          )}" placeholder="example: npm run build" />
      </label>
      <label class="flow-control flow-control-full">
        <span>Backpressure Commands (one per line)</span>
        <textarea id="${FLOW_UI_ID.backpressureCommands}" rows="4">${escapeHtml(
            view.backpressureCommands
          )}</textarea>
      </label>
      <div class="flow-inline-actions">
        <button ${FLOW_DATA_ATTR.action}="rerun-validation" ${activeRun ? "" : "disabled"}>Rerun Validation</button>
      </div>
      ${view.message ? `<div class="flow-message">${escapeHtml(view.message)}</div>` : ""}
    </section>`
        : ""
    }

    <section class="flow-workspace" style="--flow-top-split:${split}%;">
      <div class="flow-files-pane">${view.embeddedFilesHtml}</div>
      <div class="flow-splitter" title="Drag to resize panels"></div>
      <div class="flow-bottom-pane">
        <div class="flow-bottom-tabs">
          ${bottomPanelTabs
            .map(
              (tab) =>
                `<button class="flow-bottom-tab ${tab.id === view.bottomPanel ? "is-active" : ""}" ${FLOW_DATA_ATTR.action}="select-bottom-panel" ${FLOW_DATA_ATTR.panel}="${tab.id}">${tab.label}</button>`
            )
            .join("")}
        </div>
        <div class="flow-bottom-body">${bottomBody}</div>
      </div>
    </section>
    ${
      view.projectSetupOpen
        ? `<div class="flow-project-modal-backdrop">
      <section class="flow-project-modal" role="dialog" aria-modal="true" aria-label="Create Project">
        <h3>Create Project</h3>
        <p>Set up a new project scaffold for Flow.</p>
        <label class="flow-control">
          <span>Project Name</span>
          <input id="${FLOW_UI_ID.projectNameInput}" type="text" value="${escapeHtml(
            view.projectNameDraft
          )}" placeholder="Example: customer-portal" />
        </label>
        <label class="flow-control">
          <span>Project Type</span>
          <select id="${FLOW_UI_ID.projectTypeSelect}">
            ${FLOW_PROJECT_TYPE_OPTIONS
              .map(
                (option) =>
                  `<option value="${option}" ${view.projectTypeDraft === option ? "selected" : ""}>${option}</option>`
              )
              .join("")}
          </select>
        </label>
        ${
          view.projectTypeDraft === "app-tool"
            ? `<label class="flow-control">
          <span>Tool Icon (from <a href="https://lucide.dev/icons/" target="_blank" rel="noopener noreferrer" class="tts-trusted-link">https://lucide.dev/icons/</a>)</span>
          <input id="${FLOW_UI_ID.projectIconInput}" type="text" value="${escapeHtml(
                view.projectIconDraft
              )}" placeholder="Example: wrench" />
        </label>`
            : ""
        }
        <label class="flow-control">
          <span>Project Description (optional)</span>
          <textarea id="${FLOW_UI_ID.projectDescriptionInput}" class="flow-project-description-input" rows="8" placeholder="Describe the goals, constraints, workflows, users, integrations, and any implementation details you already know.">${escapeHtml(
            view.projectDescriptionDraft
          )}</textarea>
        </label>
        <div class="flow-project-modal-actions">
          <button type="button" ${FLOW_DATA_ATTR.action}="create-project-setup">Create Project</button>
          <button type="button" ${FLOW_DATA_ATTR.action}="skip-project-setup">Skip for now</button>
        </div>
        ${view.message ? `<div class="flow-message">${escapeHtml(view.message)}</div>` : ""}
        <details class="flow-project-modal-advanced">
          <summary>Advanced: Phase Models</summary>
          <div class="flow-project-model-grid">
            <label class="flow-control flow-control-full">
              <span>Apply to all</span>
              <select ${FLOW_DATA_ATTR.action}="set-phase-model" ${FLOW_DATA_ATTR.phase}="${FLOW_ALL_PHASES_KEY}">
                ${renderPhaseModelOptions(view.availableModels, getAllPhaseModelSelection(view.phaseModels))}
              </select>
            </label>
            ${FLOW_PHASE_MODEL_KEYS
              .map((phase) => {
                const selected = view.phaseModels[phase] || "auto";
                return `<label class="flow-control">
                <span>${phase}</span>
                <select ${FLOW_DATA_ATTR.action}="set-phase-model" ${FLOW_DATA_ATTR.phase}="${phase}">
                  ${renderPhaseModelOptions(view.availableModels, selected)}
                </select>
              </label>`;
              })
              .join("")}
          </div>
        </details>
      </section>
    </div>`
        : ""
    }
    ${
      view.modelUnavailableOpen
        ? `<div class="flow-project-modal-backdrop">
      <section class="flow-project-modal flow-model-recovery-modal" role="dialog" aria-modal="true" aria-label="Model unavailable">
        <h3>Model Unavailable</h3>
        <p>Phase <code>${escapeHtml(view.modelUnavailablePhase || "unknown")}</code> cannot reach <code>${escapeHtml(
            view.modelUnavailableModel || "current"
          )}</code>.</p>
        <p>${escapeHtml(view.modelUnavailableReason || "Connection issue.")}</p>
        <p>Attempt ${Math.max(0, view.modelUnavailableAttempt)} of ${Math.max(
            0,
            view.modelUnavailableMaxAttempts
          )}. Status: <strong>${escapeHtml(view.modelUnavailableStatus || "retrying")}</strong></p>
        ${
          view.modelUnavailableFallbackModel
            ? `<p>Fallback candidate: <code>${escapeHtml(view.modelUnavailableFallbackModel)}</code></p>`
            : ""
        }
        <div class="flow-project-modal-actions">
          <button ${FLOW_DATA_ATTR.action}="pause-for-model-recovery" ${view.paused ? "disabled" : ""}>Pause Run</button>
          <button ${FLOW_DATA_ATTR.action}="dismiss-model-recovery-modal">Hide</button>
        </div>
      </section>
    </div>`
        : ""
    }
  </div>`;
}

function getAllPhaseModelSelection(phaseModels: Record<string, string>): string {
  const values = FLOW_PHASE_MODEL_KEYS.map((phase) => phaseModels[phase] || "auto");
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
        `<option value="${escapeHtml(model.id)}" ${selected === model.id ? "selected" : ""}>${escapeHtml(
          model.label
        )}</option>`
    )
    .join("")}`;
}
