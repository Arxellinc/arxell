import { useState, useEffect, useCallback, useMemo } from "react";
import { settingsGet, settingsSet } from "../lib/tauri";
import {
  AnimationPreset,
  AnimationParams,
  WireframeAppearance,
  ModeAppearance,
  AppearanceSettings,
  BUILT_IN_PRESETS,
  DEFAULT_APPEARANCE,
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_VISEME_MAPPINGS,
  DEFAULT_VISEME_LEVELS,
  paramsEqual,
} from "../components/Workspace/panels/avatarTypes";

/** Ensure older saved presets that pre-date visemeMappings still work. */
function migratePresetParams(params: AnimationParams): AnimationParams {
  const rawPerformance = (params as any).performance ?? {};
  const renderScaleRaw = rawPerformance.renderScale;
  const nextPerformance = {
    renderScale: renderScaleRaw === 0.75 || renderScaleRaw === 0.5 ? renderScaleRaw : 1,
  };
  const nextLipSync = { ...params.lipSync };
  if (!nextLipSync.visemeMappings) {
    nextLipSync.visemeMappings = { ...DEFAULT_VISEME_MAPPINGS };
  }
  if (!nextLipSync.visemeLevels) {
    nextLipSync.visemeLevels = { ...DEFAULT_VISEME_LEVELS };
  } else {
    nextLipSync.visemeLevels = {
      ...DEFAULT_VISEME_LEVELS,
      ...nextLipSync.visemeLevels,
    };
  }
  return { ...params, performance: nextPerformance, lipSync: nextLipSync };
}

/** Migrate legacy single appearance to new per-mode settings */
function migrateAppearanceSettings(saved: unknown): AppearanceSettings {
  const defaults = DEFAULT_APPEARANCE_SETTINGS;
  const LEGACY_SKIN_DEFAULT = "#8cb4cc";
  const LEGACY_HAIR_DEFAULT = "#3a2a22";
  const NEW_DEFAULT_COLOR = "#16E9F5";
  const normalizeLegacyDefaults = (mode: ModeAppearance): ModeAppearance => {
    const normalized = { ...mode };
    // Upgrade old shipped defaults; preserve user-custom colors.
    if ((normalized.skinColor ?? "").toLowerCase() === LEGACY_SKIN_DEFAULT) {
      normalized.skinColor = NEW_DEFAULT_COLOR;
    }
    if ((normalized.hairColor ?? "").toLowerCase() === LEGACY_HAIR_DEFAULT) {
      normalized.hairColor = NEW_DEFAULT_COLOR;
    }
    return normalized;
  };
  if (!saved || typeof saved !== "object") {
    return defaults;
  }
  const parsed = saved as Record<string, unknown>;
  // Check if it's the new format (has 'normal' and 'wireframe' keys)
  if ("normal" in parsed && "wireframe" in parsed) {
    return {
      normal: normalizeLegacyDefaults({ ...defaults.normal, ...(parsed.normal as Partial<ModeAppearance>) }),
      wireframe: normalizeLegacyDefaults({ ...defaults.wireframe, ...(parsed.wireframe as Partial<ModeAppearance>) }),
    };
  }
  // Legacy format - migrate to both modes
  const legacyAppearance = normalizeLegacyDefaults({ ...DEFAULT_APPEARANCE, ...parsed } as ModeAppearance);
  return {
    normal: { ...legacyAppearance },
    wireframe: { ...legacyAppearance },
  };
}

const STORAGE_KEYS = {
  presets: "avatar_presets",
  activePresetId: "avatar_active_preset_id",
  appearance: "avatar_appearance",
  renderMode: "avatar_render_mode",
};

function generateId(): string {
  return crypto.randomUUID();
}

export type RenderMode = "normal" | "wireframe";

export function useAvatarPresets() {
  const [presets, setPresets] = useState<AnimationPreset[]>(BUILT_IN_PRESETS);
  // Default to "Natural Standing (Legacy)" preset (index 1)
  const [activePresetId, setActivePresetId] = useState<string>(BUILT_IN_PRESETS[1].id);
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings>(DEFAULT_APPEARANCE_SETTINGS);
  const [renderMode, setRenderMode] = useState<RenderMode>("wireframe");
  const [isLoading, setIsLoading] = useState(true);

  // Get the appearance for the current render mode
  const appearance = useMemo<WireframeAppearance>(() => {
    return appearanceSettings[renderMode];
  }, [appearanceSettings, renderMode]);

  // Load presets from DB on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [savedPresetsJson, savedActiveId, savedAppearanceJson, savedRenderMode] = await Promise.all([
          settingsGet(STORAGE_KEYS.presets),
          settingsGet(STORAGE_KEYS.activePresetId),
          settingsGet(STORAGE_KEYS.appearance),
          settingsGet(STORAGE_KEYS.renderMode),
        ]);

        if (!mounted) return;

        // Parse saved user presets
        let userPresets: AnimationPreset[] = [];
        if (savedPresetsJson) {
          try {
            userPresets = JSON.parse(savedPresetsJson);
            if (!Array.isArray(userPresets)) userPresets = [];
          } catch {
            console.warn("[useAvatarPresets] Failed to parse saved presets");
            userPresets = [];
          }
        }

        // Merge: built-ins always present, user presets added
        // User presets can override built-in params by matching id
        const merged = [...BUILT_IN_PRESETS];
        for (const up of userPresets) {
          const existingIdx = merged.findIndex((p) => p.id === up.id);
          if (existingIdx >= 0) {
            // Override built-in params (but keep builtIn: true)
            merged[existingIdx] = { ...up, builtIn: true, params: migratePresetParams(up.params) };
          } else {
            merged.push({ ...up, params: migratePresetParams(up.params) });
          }
        }
        setPresets(merged);

        // Restore active preset ID if valid
        if (savedActiveId && merged.some((p) => p.id === savedActiveId)) {
          setActivePresetId(savedActiveId);
        }

        // Restore appearance (with migration support)
        if (savedAppearanceJson) {
          try {
            const parsed = JSON.parse(savedAppearanceJson);
            setAppearanceSettings(migrateAppearanceSettings(parsed));
          } catch {
            console.warn("[useAvatarPresets] Failed to parse saved appearance");
          }
        }

        // Restore render mode (migrate legacy "hybrid" to "wireframe")
        if (savedRenderMode) {
          const mapped = savedRenderMode === "hybrid" ? "wireframe" : savedRenderMode;
          if (["normal", "wireframe"].includes(mapped)) {
            setRenderMode(mapped as RenderMode);
          }
        }
      } catch (err) {
        console.error("[useAvatarPresets] Load error:", err);
      } finally {
        setIsLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Persist user presets (non-built-in only) whenever they change
  const persistPresets = useCallback(async (newPresets: AnimationPreset[]) => {
    const userPresets = newPresets.filter((p) => !p.builtIn);
    try {
      await settingsSet(STORAGE_KEYS.presets, JSON.stringify(userPresets));
    } catch (err) {
      console.error("[useAvatarPresets] Persist error:", err);
    }
  }, []);

  // Change active preset
  const setActivePreset = useCallback(async (id: string) => {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setActivePresetId(id);
    try {
      await settingsSet(STORAGE_KEYS.activePresetId, id);
    } catch (err) {
      console.error("[useAvatarPresets] Save active ID error:", err);
    }
  }, [presets]);

  // Get the currently active preset
  const activePreset = presets.find((p) => p.id === activePresetId) ?? presets[0];

  // Save (update) the current preset's params
  const savePreset = useCallback(async (id: string, params: AnimationParams, newName?: string) => {
    setPresets((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx < 0) return prev;
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        params,
        name: newName ?? updated[idx].name,
      };
      persistPresets(updated);
      return updated;
    });
  }, [persistPresets]);

  // Save as new preset (creates a user preset)
  const saveAsPreset = useCallback(async ( name: string, params: AnimationParams): Promise<string> => {
    const id = generateId();
    const newPreset: AnimationPreset = {
      id,
      name,
      builtIn: false,
      params,
    };
    setPresets((prev) => {
      const updated = [...prev, newPreset];
      persistPresets(updated);
      return updated;
    });
    await setActivePreset(id);
    return id;
  }, [persistPresets, setActivePreset]);

  // Delete a user preset (built-ins cannot be deleted)
  const deletePreset = useCallback(async (id: string): Promise<boolean> => {
    const preset = presets.find((p) => p.id === id);
    if (!preset || preset.builtIn) return false;

    setPresets((prev) => {
      const updated = prev.filter((p) => p.id !== id);
      persistPresets(updated);
      return updated;
    });

    // If deleted preset was active, switch to default
    if (activePresetId === id) {
      await setActivePreset(BUILT_IN_PRESETS[0].id);
    }
    return true;
  }, [presets, activePresetId, persistPresets, setActivePreset]);

  // Rename a user preset (built-ins cannot be renamed)
  const renamePreset = useCallback(async (id: string, newName: string): Promise<boolean> => {
    const preset = presets.find((p) => p.id === id);
    if (!preset || preset.builtIn) return false;

    setPresets((prev) => {
      const updated = prev.map((p) =>
        p.id === id ? { ...p, name: newName } : p
      );
      persistPresets(updated);
      return updated;
    });
    return true;
  }, [presets, persistPresets]);

  // Check if current params differ from saved preset
  const hasUnsavedChanges = useCallback((params: AnimationParams): boolean => {
    return !paramsEqual(activePreset.params, params);
  }, [activePreset]);

  // Update appearance for the current render mode and persist
  const updateAppearance = useCallback(async (newAppearance: WireframeAppearance) => {
    const newSettings: AppearanceSettings = {
      ...appearanceSettings,
      [renderMode]: newAppearance,
    };
    setAppearanceSettings(newSettings);
    try {
      await settingsSet(STORAGE_KEYS.appearance, JSON.stringify(newSettings));
    } catch (err) {
      console.error("[useAvatarPresets] Save appearance error:", err);
    }
  }, [appearanceSettings, renderMode]);

  // Update render mode and persist
  const updateRenderMode = useCallback(async (mode: RenderMode) => {
    setRenderMode(mode);
    try {
      await settingsSet(STORAGE_KEYS.renderMode, mode);
    } catch (err) {
      console.error("[useAvatarPresets] Save render mode error:", err);
    }
  }, []);

  return {
    presets,
    activePreset,
    activePresetId,
    setActivePreset,
    savePreset,
    saveAsPreset,
    deletePreset,
    renamePreset,
    hasUnsavedChanges,
    isLoading,
    // Appearance
    appearance,
    updateAppearance,
    // Render mode
    renderMode,
    updateRenderMode,
  };
}
