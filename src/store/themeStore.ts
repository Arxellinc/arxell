import { create } from "zustand";
import { settingsGet, settingsSet } from "../lib/tauri";

export type Theme = "dark" | "light" | "tron";

const THEME_SETTING_KEY = "ui_theme";
const LEGACY_THEME_SETTING_KEY = "theme";

function normalizeTheme(saved: string | null): Theme {
  return saved === "light" || saved === "tron" ? saved : "dark";
}

function applyTheme(theme: Theme) {
  if (theme === "dark") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  loadTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: "dark",

  setTheme: (theme: Theme) => {
    set({ theme });
    applyTheme(theme);
    settingsSet(THEME_SETTING_KEY, theme).catch((e) => {
      console.error("Failed to save theme:", e);
    });
  },

  loadTheme: async () => {
    try {
      const saved = await settingsGet(THEME_SETTING_KEY);
      const legacy = saved ? null : await settingsGet(LEGACY_THEME_SETTING_KEY);
      const theme = normalizeTheme(saved ?? legacy);

      // Backfill legacy installs so all future reads use the canonical key.
      if (!saved && legacy) {
        void settingsSet(THEME_SETTING_KEY, theme).catch((e) => {
          console.error("Failed to migrate legacy theme setting:", e);
        });
      }

      set({ theme });
      applyTheme(theme);
    } catch (e) {
      console.error("Failed to load theme:", e);
    }
  },
}));
