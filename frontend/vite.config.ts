import { defineConfig } from "vite";
import packageJson from "./package.json";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version)
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/highlight.js")) return "vendor-highlight";
          if (id.includes("node_modules/xterm") || id.includes("node_modules/@xterm")) return "vendor-xterm";
          if (id.includes("node_modules/overlayscrollbars")) return "vendor-overlayscrollbars";
          if (id.includes("/src/panels/") && !id.endsWith("/src/panels/index.ts")) return "panels";
          return undefined;
        }
      }
    }
  }
});
