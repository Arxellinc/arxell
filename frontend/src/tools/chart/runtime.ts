let mermaidInitPromise: Promise<typeof import("mermaid")> | null = null;
let renderCounter = 0;
let currentTheme: string | null = null;

function mermaidThemeForApp(): string {
  const theme = document.documentElement.dataset.theme ?? "terminal";
  return theme === "light" ? "default" : "dark";
}

async function getMermaid() {
  const desiredTheme = mermaidThemeForApp() as "dark" | "default";
  if (mermaidInitPromise && currentTheme === desiredTheme) {
    return mermaidInitPromise;
  }
  currentTheme = desiredTheme;
  mermaidInitPromise = import("mermaid").then((module) => {
    const mermaid = module.default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: desiredTheme,
      themeVariables: desiredTheme === "dark" ? {
        darkMode: true,
        background: "#0d1115",
        primaryColor: "#1c4f6e",
        primaryTextColor: "#c7d2d3",
        primaryBorderColor: "#3a7ca5",
        lineColor: "#5a8a9a",
        secondaryColor: "#1a3a4a",
        tertiaryColor: "#142a35",
        nodeTextColor: "#c7d2d3",
        mainBkg: "#1c3040",
        nodeBorder: "#3a7ca5",
        clusterBkg: "#142a35",
        clusterBorder: "#3a6a7a",
        edgeLabelBackground: "#1c2427"
      } : {}
    });
    return module;
  });
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
