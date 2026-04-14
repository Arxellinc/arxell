import { renderToolToolbar } from "../ui/toolbar";
import "./styles.css";

export interface ChartRenderSlice {
  source: string;
  renderSource: string;
  error: string | null;
}

export function renderChartToolActions(): string {
  return renderToolToolbar({
    tabsMode: "none",
    tabs: [],
    actions: [
      {
        id: "chart-render",
        title: "Render chart",
        icon: "play",
        label: "Render",
        className: "is-text is-compact",
        buttonAttrs: {
          "data-chart-action": "render"
        }
      },
      {
        id: "chart-copy",
        title: "Copy Mermaid code",
        icon: "copy",
        label: "Copy",
        className: "is-text is-compact",
        buttonAttrs: {
          "data-chart-action": "copy"
        }
      },
      {
        id: "chart-clear",
        title: "Clear chart",
        icon: "trash-2",
        label: "Clear",
        className: "is-text is-compact",
        buttonAttrs: {
          "data-chart-action": "clear"
        }
      }
    ]
  });
}

export function renderChartToolBody(slice: ChartRenderSlice): string {
  const error = slice.error?.trim() ?? "";
  return `<div class="chart-tool">
    <aside class="chart-editor-pane">
      <div class="chart-editor-header">Mermaid Code</div>
      <textarea
        id="chartCodeInput"
        class="chart-code-input"
        data-chart-field="source"
        spellcheck="false"
      >${escapeHtml(slice.source)}</textarea>
    </aside>
    <section class="chart-canvas-pane">
      <div class="chart-canvas-header">Rendered Chart</div>
      ${error ? `<div class="chart-error">${escapeHtml(error)}</div>` : ""}
      <div class="chart-canvas" id="chartCanvas" data-chart-render-source="${escapeHtml(slice.renderSource)}"></div>
    </section>
  </div>`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
