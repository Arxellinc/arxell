import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const host = process.env.TAURI_DEV_HOST;
const appVersion = (() => {
  try {
    const tauriConfigPath = resolve(process.cwd(), "src-tauri", "tauri.conf.json");
    const raw = readFileSync(tauriConfigPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version?.trim() || process.env.npm_package_version || "0.0.0";
  } catch {
    return process.env.npm_package_version ?? "0.0.0";
  }
})();

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/vendor/**", "**/node_modules/**"],
    },
  },
}));
