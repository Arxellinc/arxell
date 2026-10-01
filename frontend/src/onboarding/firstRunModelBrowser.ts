import { invoke, isTauri } from "@tauri-apps/api/core";

export const FIRST_RUN_MODEL_CATALOG_URL = "https://huggingface.co/models?pipeline_tag=text-generation&sort=likes";

interface ModelCatalogBrowser {
  desktop: boolean;
  invoke: (command: string, args: { url: string }) => Promise<unknown>;
  openWeb: (url: string, target: string, features: string) => unknown;
}

export async function openFirstRunModelCatalog(browser: ModelCatalogBrowser = {
  desktop: isTauri(),
  invoke,
  openWeb: (url, target, features) => window.open(url, target, features)
}): Promise<void> {
  if (browser.desktop) {
    // The native capability permits only this catalog, not arbitrary URLs/files.
    // Never fall back to a WebView popup if native opening fails.
    await browser.invoke("plugin:opener|open_url", { url: FIRST_RUN_MODEL_CATALOG_URL });
  } else {
    browser.openWeb(FIRST_RUN_MODEL_CATALOG_URL, "_blank", "noopener,noreferrer");
  }
}
