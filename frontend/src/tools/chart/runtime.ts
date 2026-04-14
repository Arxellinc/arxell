let mermaidInitPromise: Promise<typeof import("mermaid")> | null = null;
let renderCounter = 0;

async function getMermaid() {
  if (!mermaidInitPromise) {
    mermaidInitPromise = import("mermaid").then((module) => {
      const mermaid = module.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        theme: "default"
      });
      return module;
    });
  }
  return mermaidInitPromise;
}

export async function renderMermaidInto(
  host: HTMLElement,
  source: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const code = source.trim();
  if (!code) {
    host.innerHTML = '<div class="tool-placeholder-message">Enter Mermaid code, then click Render.</div>';
    return { ok: true };
  }
  try {
    const module = await getMermaid();
    const mermaid = module.default;
    const id = `chart-render-${Date.now()}-${renderCounter++}`;
    const rendered = await mermaid.render(id, code);
    host.innerHTML = rendered.svg;
    return { ok: true };
  } catch (error) {
    const message = String(error);
    host.innerHTML = "";
    return { ok: false, error: message };
  }
}
