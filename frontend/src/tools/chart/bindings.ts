import type { ChartRuntimeSlice } from "./state";

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
  }
}

export async function handleChartClick(
  target: HTMLElement,
  slice: ChartRuntimeSlice
): Promise<boolean> {
  const actionTarget = target.closest<HTMLElement>("[data-chart-action]");
  const action = actionTarget?.getAttribute("data-chart-action");
  if (!action) return false;

  if (action === "render") {
    slice.chartRenderSource = slice.chartSource;
    slice.chartError = null;
    return true;
  }
  if (action === "copy") {
    await copyText(slice.chartSource);
    return true;
  }
  if (action === "clear") {
    slice.chartSource = DEFAULT_CHART_SOURCE;
    slice.chartRenderSource = DEFAULT_CHART_SOURCE;
    slice.chartError = null;
    return true;
  }
  return false;
}

export function handleChartInput(target: HTMLElement, slice: ChartRuntimeSlice): { handled: boolean; rerender: boolean } {
  const field = target.getAttribute("data-chart-field");
  if (field !== "source") return { handled: false, rerender: false };
  if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) {
    return { handled: false, rerender: false };
  }
  slice.chartSource = target.value;
  slice.chartRenderSource = target.value;
  return { handled: true, rerender: false };
}

export const DEFAULT_CHART_SOURCE = `flowchart TD
  A[Start] --> B{Need Chart?}
  B -->|Yes| C[Render Mermaid]
  B -->|No| D[Continue]
  C --> E[Done]
  D --> E`;
