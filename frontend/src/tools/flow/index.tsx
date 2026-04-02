import type { AppEvent, FlowMode, FlowRunRecord, FlowRerunValidationResult } from "../../contracts";
import { escapeHtml } from "../../panels/utils";
import { FLOW_DATA_ATTR, FLOW_UI_ID } from "../ui/constants";
import { renderToolToolbar } from "../ui/toolbar";
import "./styles.css";

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
}

function isRunningStatus(status: FlowRunRecord["status"]): boolean {
  return status === "queued" || status === "running";
}

export function renderFlowToolActions(view: FlowToolViewState): string {
  const activeRun = view.runs.find((run) => run.runId === view.activeRunId) ?? null;
  const running = activeRun ? isRunningStatus(activeRun.status) : false;
  return renderToolToolbar({
    tabsMode: "static",
    tabs: view.runs.slice(0, 6).map((run) => ({
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
        id: "flow-refresh",
        title: "Refresh runs",
        icon: "history",
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "refresh-runs"
        }
      },
      {
        id: "flow-start",
        title: "Start flow run",
        icon: "play",
        disabled: running,
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "start-run"
        }
      },
      {
        id: "flow-stop",
        title: "Stop active run",
        icon: "square-terminal",
        disabled: !running,
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "stop-run"
        }
      },
      {
        id: "flow-resume",
        title: "Resume from active run",
        icon: "play",
        disabled: !activeRun || running,
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "resume-run"
        }
      },
      {
        id: "flow-retry",
        title: "Retry active run",
        icon: "play",
        disabled: !activeRun || running,
        buttonAttrs: {
          [FLOW_DATA_ATTR.action]: "retry-run"
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

export function renderFlowToolBody(view: FlowToolViewState): string {
  const activeRun = view.runs.find((run) => run.runId === view.activeRunId) ?? null;
  const iterationCards = activeRun?.iterations.length
    ? activeRun.iterations
        .map((iteration) => {
          const steps = [...iteration.steps].sort((a, b) => {
            const aTs = a.startedAtMs ?? 0;
            const bTs = b.startedAtMs ?? 0;
            return aTs - bTs;
          });
          const chips = steps.length
            ? steps
                .map((step) => {
                  const stateClass = step.state;
                  const detail = step.error || step.result || "";
                  const duration =
                    typeof step.startedAtMs === "number" && typeof step.completedAtMs === "number"
                      ? `${Math.max(0, step.completedAtMs - step.startedAtMs)} ms`
                      : "";
                  return `<div class="flow-step-chip state-${escapeHtml(stateClass)}" title="${escapeHtml(
                    detail
                  )}">
                    <span class="flow-step-name">${escapeHtml(step.step)}</span>
                    <span class="flow-step-state">${escapeHtml(stateClass)}</span>
                    <span class="flow-step-duration">${escapeHtml(duration)}</span>
                    ${
                      detail
                        ? `<div class="flow-step-detail">${escapeHtml(detail)}</div>`
                        : ""
                    }
                  </div>`;
                })
                .join("")
            : '<div class="flow-empty flow-empty-inline">No executed steps yet.</div>';

          return `<article class="flow-iteration-card status-${escapeHtml(iteration.status)}">
            <header class="flow-iteration-header">
              <div class="flow-iteration-title">Iteration ${iteration.index}</div>
              <div class="flow-iteration-status">${escapeHtml(iteration.status)}</div>
            </header>
            <div class="flow-iteration-meta">Task: ${escapeHtml(iteration.taskId || "(none)")}</div>
            <div class="flow-step-grid">${chips}</div>
          </article>`;
        })
        .join("")
    : '<div class="flow-empty">No iteration data yet.</div>';

  const eventRows = view.filteredEvents
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

  const running = activeRun ? isRunningStatus(activeRun.status) : false;

  return `<div class="flow-tool primary-pane-body">
    <section class="flow-controls">
      <div class="flow-controls-grid">
        <label class="flow-control">
          <span>Mode</span>
          <select id="${FLOW_UI_ID.modeSelect}">
            <option value="plan" ${view.mode === "plan" ? "selected" : ""}>plan</option>
            <option value="build" ${view.mode === "build" ? "selected" : ""}>build</option>
          </select>
        </label>
        <label class="flow-control">
          <span>Max Iterations</span>
          <input id="${FLOW_UI_ID.maxIterationsInput}" type="number" min="1" max="200" value="${
            view.maxIterations
          }" />
        </label>
        <label class="flow-control flow-toggle">
          <input id="${FLOW_UI_ID.dryRunToggle}" type="checkbox" ${view.dryRun ? "checked" : ""} />
          <span>Dry Run</span>
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
        <button ${FLOW_DATA_ATTR.action}="rerun-validation" ${
    activeRun ? "" : "disabled"
  }>Rerun Validation</button>
      </div>
      ${view.message ? `<div class="flow-message">${escapeHtml(view.message)}</div>` : ""}
    </section>

    <section class="flow-main-grid">
      <div class="flow-main-column">
        <header class="flow-section-header">
          <h3>Execution Graph</h3>
          <div class="flow-run-summary">${escapeHtml(
            activeRun
              ? `${activeRun.runId} · ${activeRun.mode} · ${activeRun.status}${running ? " (active)" : ""}`
              : "No run selected"
          )}</div>
        </header>
        <div class="flow-iteration-list">${iterationCards}</div>
      </div>
      <div class="flow-main-column">
        <header class="flow-section-header"><h3>Validation</h3></header>
        ${renderValidationRows(view.validationResults)}
      </div>
      <div class="flow-main-column flow-events-column">
        <header class="flow-section-header">
          <h3>Event Inspector</h3>
          <input id="${FLOW_UI_ID.eventFilterInput}" type="text" value="${escapeHtml(
            view.eventFilter
          )}" placeholder="Filter by action/run/correlation" />
        </header>
        <div class="flow-event-list">${eventRows || '<div class="flow-empty">No events match filter.</div>'}</div>
      </div>
    </section>
  </div>`;
}
