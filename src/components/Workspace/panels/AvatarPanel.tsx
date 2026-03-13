import { Settings, SquareUser, X, ZoomIn, ZoomOut, Save, Trash2, Edit3, Plus, ChevronUp, ChevronDown, RefreshCw, Play, Square, Maximize2, Minimize2 } from "lucide-react";
import { Suspense, lazy, useEffect, useState, useCallback, useMemo } from "react";
import {
  AnimationParams,
  AnimationPreset,
  WireframeAppearance,
  SkeletonMapping,
  MorphTargetInfo,
  MorphCategory,
  BoneHierarchyConfig,
  BUILT_IN_PRESETS,
  DEFAULT_VISEME_MAPPINGS,
  computeGlowFilter,
  DEFAULT_HIERARCHY_CONFIG,
  DEFAULT_VISEME_LEVELS,
} from "./avatarTypes";
import { PanelWrapper } from "./shared";
import { useAvatarPresets, RenderMode } from "../../../hooks/useAvatarPresets";
import { RigDebugPanel } from "./RigDebugPanel";
import { useUiModeStore } from "../../../store/uiModeStore";

// Lazy-loaded so Three.js is NOT bundled into the initial chunk.
const AvatarRenderer = lazy(() => import("./AvatarRenderer"));

// ── Constants ─────────────────────────────────────────────────────────────────

function glbLabel(path: string): string {
  const stem = path.split("/").pop()!.replace(/\.glb$/i, "");
  return stem
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Cache-bust GLB URLs on every dev-server start so Vite/webview don't serve stale files
const _glbCacheBust = Date.now();
const MODE_MODEL_FILENAME: Record<RenderMode, string> = {
  wireframe: "wireframe.glb",
  normal: "normal.glb",
};
const MODE_MODEL_SRC: Record<RenderMode, string> = {
  wireframe: `/avatar/wireframe.glb?v=${_glbCacheBust}`,
  normal: `/avatar/normal.glb?v=${_glbCacheBust}`,
};

const ZOOM_ORBITS = [
  "0deg 78deg 100%",
  "0deg 78deg 48%",
  "0deg 78deg 28%",
  "0deg 78deg 12%",
  "0deg 78deg 5%",
];
const ZOOM_FALLBACK_TARGETS = [
  "0m 0.9m 0m",
  "0m 1.25m 0m",
  "0m 1.45m 0m",
  "0m 1.5m 0m",
  "0m 1.55m 0m",
];

const EXPRESSIONS = ["neutral", "happy", "thinking", "focused"] as const;

// ── Settings overlay sub-components ──────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-[9px] font-bold tracking-widest uppercase text-text-dark mt-3 mb-1.5 first:mt-1">
      {children}
    </div>
  );
}

function Row({ label, right, children }: { label: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-text-med">{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function Checkbox({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded-sm border border-line-med bg-bg-norm accent-accent-primary cursor-pointer"
      />
      {label && <span className="text-[9px] text-text-med">{label}</span>}
    </label>
  );
}

function Slider({
  value, min, max, step, onChange, decimals, inputWidthClassName,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  decimals?: number;
  inputWidthClassName?: string;
}) {
  const inferredDecimals = useMemo(() => {
    if (typeof decimals === "number") return decimals;
    const parts = String(step).split(".");
    return parts[1]?.length ?? 0;
  }, [decimals, step]);

  const clampedValue = Math.min(max, Math.max(min, value));
  const pct = (clampedValue - min) / (max - min);

  const handleTextChange = (raw: string) => {
    const n = parseFloat(raw);
    if (Number.isNaN(n)) return;
    onChange(Math.min(max, Math.max(min, n)));
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={clampedValue.toFixed(inferredDecimals)}
        min={min}
        max={max}
        step={step}
        onChange={(e) => handleTextChange(e.target.value)}
        className={`${inputWidthClassName ?? "w-[52px]"} flex-shrink-0 bg-line-light border border-line-med rounded px-1.5 py-0.5 text-[9px] text-text-med font-mono outline-none focus:border-accent-primary/50 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      <div className="flex-1 relative py-1">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={clampedValue}
          onChange={(e) => onChange(Number(e.target.value))}
          className="vad-slider"
          style={
            {
              "--pct": pct.toFixed(4),
              "--rec-lo": pct.toFixed(4),
              "--rec-hi": pct.toFixed(4),
            } as React.CSSProperties
          }
        />
      </div>
    </div>
  );
}

type SettingsTab = "animation" | "appearance" | "face" | "debug";
type NormalRenderOptions = {
  skin: boolean;
  eyes: boolean;
  teeth: boolean;
  hair: boolean;
  hideHair: boolean;
};

// ── Kokoro ARPAbet phoneme groups for the mapping UI ─────────────────────────
const PHONEME_GROUPS: { label: string; phonemes: string[] }[] = [
  { label: "Open Vowels",   phonemes: ["AA","AE","AH","AO","AW","AY"] },
  { label: "Close Vowels",  phonemes: ["EH","ER","EY","IH","IY","OW","OY","UH","UW"] },
  { label: "Bilabial",      phonemes: ["B","M","P"] },
  { label: "Labiodental",   phonemes: ["F","V"] },
  { label: "Dental/Alveolar", phonemes: ["D","DH","L","N","NG","R","S","T","TH","Z"] },
  { label: "Palatal/Velar", phonemes: ["CH","G","JH","K","SH","Y","ZH"] },
  { label: "Glottal/Other", phonemes: ["HH","W"] },
  { label: "Silence",       phonemes: ["SIL","SP"] },
];

const MORPH_CATEGORY_LABELS: Record<MorphCategory, string> = {
  viseme:     "Visemes",
  expression: "Expressions",
  jaw:        "Jaw",
  eye:        "Eyes",
  brow:       "Brows",
  cheek:      "Cheeks",
  other:      "Other",
};

const MORPH_CATEGORY_ORDER: MorphCategory[] = ["viseme","jaw","expression","brow","cheek","eye","other"];

function isAnonymousMorphName(name: string): boolean {
  return /^\d+$/.test(name.trim());
}

import type { BoneMapping } from "./AvatarRenderer";
import { useVoiceStore } from "../../../store/voiceStore";

function AvatarSettingsOverlay({
  params,
  onParamsChange,
  appearance,
  onAppearanceChange,
  renderMode,
  onRenderMode,
  debugMorphs,
  onDebugMorphChange,
  jawTest,
  onJawTestChange,
  boneMapping,
  skeletonMapping,
  boneManipulations,
  onBoneManipulation,
  onResetBone,
  onResetAllBones,
  showSkeletonHelper,
  onShowSkeletonHelperChange,
  disableProcedural,
  onDisableProceduralChange,
  showStats,
  onShowStatsChange,
  activeAnimationClip,
  isAnimationPlaying,
  animationTime,
  animationDuration,
  onPlayClip,
  onPauseClip,
  onStopClip,
  onScrubClip,
  hierarchyConfig,
  onHierarchyConfigChange,
  normalRenderOptions,
  onNormalRenderOptionsChange,
  onRunMeshProbe,
  onClose,
}: {
  params: AnimationParams;
  onParamsChange: (p: AnimationParams) => void;
  appearance: WireframeAppearance;
  onAppearanceChange: (a: WireframeAppearance) => void;
  renderMode: RenderMode;
  onRenderMode: (m: RenderMode) => void;
  debugMorphs: Record<string, number>;
  onDebugMorphChange: (name: string, value: number) => void;
  jawTest: number;
  onJawTestChange: (value: number) => void;
  boneMapping: BoneMapping | null;
  skeletonMapping: SkeletonMapping | null;
  boneManipulations: Record<string, { x: number; y: number; z: number }>;
  onBoneManipulation: (boneName: string, axis: 'x' | 'y' | 'z', value: number) => void;
  onResetBone: (boneName: string) => void;
  onResetAllBones: () => void;
  showSkeletonHelper: boolean;
  onShowSkeletonHelperChange: (v: boolean) => void;
  disableProcedural: boolean;
  onDisableProceduralChange: (v: boolean) => void;
  showStats: boolean;
  onShowStatsChange: (v: boolean) => void;
  activeAnimationClip: string | null;
  isAnimationPlaying: boolean;
  animationTime: number;
  animationDuration: number;
  onPlayClip: (clip: string) => void;
  onPauseClip: () => void;
  onStopClip: () => void;
  onScrubClip: (t: number) => void;
  hierarchyConfig: BoneHierarchyConfig;
  onHierarchyConfigChange: (config: BoneHierarchyConfig) => void;
  normalRenderOptions: NormalRenderOptions;
  onNormalRenderOptionsChange: (options: NormalRenderOptions) => void;
  onRunMeshProbe: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("animation");

  // Phoneme lead lives in voiceStore (used by the TTS scheduler in voice.ts)
  const phonemeLead = useVoiceStore((s) => s.phonemeLead);
  const setPhonemeLead = useVoiceStore((s) => s.setPhonemeLead);

  // Helpers to patch nested setting keys
  const setParam = <K extends keyof AnimationParams>(
    key: K,
    patch: Partial<AnimationParams[K]>,
  ) => onParamsChange({ ...params, [key]: { ...(params[key] as object), ...patch } });
  const performance = params.performance ?? { renderScale: 1 as const };

  // ── Morph test state for the face tab ──────────────────────────────────────
  const [faceTestMorphs, setFaceTestMorphs] = useState<Record<string, number>>({});
  const [faceMappingPhoneme, setFaceMappingPhoneme] = useState<string | null>(null);
  const [testSequenceRunning, setTestSequenceRunning] = useState(false);

  // Compute categorised morph lists from skeletonMapping
  const morphsByCategory = useMemo((): Record<MorphCategory, MorphTargetInfo[]> => {
    const result = {} as Record<MorphCategory, MorphTargetInfo[]>;
    for (const cat of MORPH_CATEGORY_ORDER) result[cat] = [];
    if (!skeletonMapping) return result;
    // Deduplicate by name (same morph can live on multiple meshes)
    const seen = new Set<string>();
    for (const mt of skeletonMapping.morphTargets) {
      if (seen.has(mt.name)) continue;
      seen.add(mt.name);
      result[mt.category].push(mt);
    }
    return result;
  }, [skeletonMapping]);

  // Morph test: fire value to debugMorphs + local state
  const handleFaceMorphTest = (name: string, value: number) => {
    setFaceTestMorphs((prev) => ({ ...prev, [name]: value }));
    onDebugMorphChange(name, value);
  };

  // Reset all face test morphs
  const resetFaceTestMorphs = () => {
    Object.keys(faceTestMorphs).forEach((n) => onDebugMorphChange(n, 0));
    setFaceTestMorphs({});
  };

  // Quick-test all visemes in sequence
  const runVisemeSequence = async () => {
    if (testSequenceRunning) return;
    setTestSequenceRunning(true);
    resetFaceTestMorphs();
    const visemes = morphsByCategory.viseme;
    for (const mt of visemes) {
      onDebugMorphChange(mt.name, 1);
      setFaceTestMorphs({ [mt.name]: 1 });
      await new Promise((r) => setTimeout(r, 350));
      onDebugMorphChange(mt.name, 0);
      setFaceTestMorphs({});
      await new Promise((r) => setTimeout(r, 80));
    }
    setTestSequenceRunning(false);
  };

  // Update a single phoneme→morph mapping
  const setVisemeMapping = (phoneme: string, morphName: string) => {
    setParam("lipSync", {
      visemeMappings: { ...params.lipSync.visemeMappings, [phoneme]: morphName },
    });
  };
  const setVisemeLevel = (phoneme: string, level: number) => {
    setParam("lipSync", {
      visemeLevels: { ...(params.lipSync.visemeLevels ?? {}), [phoneme]: level },
    });
  };

  // All unique morph names for the mapping dropdowns
  const allMorphNames = useMemo(() => {
    if (!skeletonMapping) return [];
    const seen = new Set<string>();
    return skeletonMapping.morphTargets
      .map((m) => m.name)
      .filter((n) => { if (seen.has(n)) return false; seen.add(n); return true; })
      .sort();
  }, [skeletonMapping]);

  const wideTab = tab === "debug" || tab === "face";

  return (
    <div className={`absolute inset-y-0 right-0 ${tab === "debug" ? "w-[540px]" : tab === "face" ? "w-80" : "w-64"} bg-bg-dark/96 border-l border-line-med z-20 flex flex-col backdrop-blur-sm transition-[width] duration-150`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-med flex-shrink-0">
        <span className="text-[11px] font-semibold text-text-norm">Avatar Settings</span>
        <button onClick={onClose} className="text-text-dark hover:text-text-norm">
          <X size={12} />
        </button>
      </div>

      {/* View mode toggle */}
      <div className="px-3 py-1.5 border-b border-line-med flex-shrink-0">
        <div className="flex gap-1">
          <button
            onClick={() => onRenderMode("wireframe")}
            className={`flex-1 py-1 rounded text-[9px] border transition-colors ${
              renderMode === "wireframe"
                ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                : "border-line-med text-text-dark hover:text-text-med hover:border-line-light"
            }`}
          >
            Wireframe
          </button>
          <button
            onClick={() => onRenderMode("normal")}
            className={`flex-1 py-1 rounded text-[9px] border transition-colors ${
              renderMode === "normal"
                ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                : "border-line-med text-text-dark hover:text-text-med hover:border-line-light"
            }`}
          >
            Normal
          </button>
        </div>
        <p className="mt-1 text-[8px] text-text-dark leading-tight">*Rendering may be slow on some systems.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line-med flex-shrink-0">
        {(["animation", "appearance", "face", "debug"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-[10px] capitalize transition-colors relative ${
              tab === t
                ? "text-accent-primary"
                : "text-text-dark hover:text-text-med"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab body — debug tab uses full-height layout, others scroll */}
      <div className={`flex-1 min-h-0 ${wideTab ? "overflow-hidden flex flex-col" : "overflow-y-auto px-3 py-1"}`}>

        {/* ── Animation tab ──────────────────────────────────────────────────── */}
        {tab === "animation" && (
          <>
            <SectionLabel>Performance</SectionLabel>
            <Row label="Render scale">
              <select
                value={String(performance.renderScale)}
                onChange={(e) =>
                  setParam("performance", { renderScale: Number(e.target.value) as 1 | 0.75 | 0.5 })
                }
                className="w-full rounded px-1.5 py-1 text-[10px] bg-line-med border border-line-dark text-text-med hover:text-text-norm focus:outline-none cursor-pointer"
              >
                <option value="1" className="bg-bg-norm">100% (Native)</option>
                <option value="0.75" className="bg-bg-norm">75%</option>
                <option value="0.5" className="bg-bg-norm">50% (Half)</option>
              </select>
            </Row>

            {/* ── Idle Standing ──────────────────────────────────────────────── */}
            <SectionLabel>Idle Standing</SectionLabel>
            <Row
              label="Enabled"
              right={<Checkbox value={params.idle.enabled} onChange={(v: boolean) => setParam("idle", { enabled: v })} />}
            />
            <Row label="Speed">
              <Slider value={params.idle.speed} min={0.2} max={2.5} step={0.1}
                onChange={(v) => setParam("idle", { speed: v })} />
            </Row>
            <Row label="Intensity">
              <Slider value={params.idle.intensity} min={0} max={1} step={0.05}
                onChange={(v) => setParam("idle", { intensity: v })} />
            </Row>

            {/* ── Breathing ──────────────────────────────────────────────────── */}
            <SectionLabel>Breathing</SectionLabel>
            <Row
              label="Enabled"
              right={<Checkbox value={params.breathing.enabled} onChange={(v: boolean) => setParam("breathing", { enabled: v })} />}
            />
            <Row label="Rate">
              <Slider value={params.breathing.rate} min={8} max={24} step={1}
                onChange={(v) => setParam("breathing", { rate: v })} />
            </Row>
            <Row label="Depth">
              <Slider value={params.breathing.depth} min={0} max={1} step={0.05}
                onChange={(v) => setParam("breathing", { depth: v })} />
            </Row>

            {/* ── Head Movement ──────────────────────────────────────────────── */}
            <SectionLabel>Head Movement</SectionLabel>
            <Row
              label="Enabled"
              right={<Checkbox value={params.headMovement.enabled} onChange={(v: boolean) => setParam("headMovement", { enabled: v })} />}
            />
            <Row label="Range">
              <Slider value={params.headMovement.range} min={0} max={1} step={0.05}
                onChange={(v) => setParam("headMovement", { range: v })} />
            </Row>

            {/* ── Lip Sync ───────────────────────────────────────────────────── */}
            <SectionLabel>Lip Sync</SectionLabel>
            <Row
              label="Enabled"
              right={<Checkbox value={params.lipSync.enabled} onChange={(v: boolean) => setParam("lipSync", { enabled: v })} />}
            />
            <Row label="Jaw sensitivity">
              <Slider value={params.lipSync.sensitivity} min={0} max={0.5} step={0.01}
                onChange={(v) => setParam("lipSync", { sensitivity: v })} />
            </Row>
            <Row label="Jaw scale">
              <Slider value={(params.lipSync as any).jawScale ?? 0.35} min={0} max={0.5} step={0.01}
                onChange={(v) => setParam("lipSync", { jawScale: v })} />
            </Row>
            <Row label="Viseme intensity">
              <Slider value={(params.lipSync as any).visemeScale ?? 0.3} min={0} max={0.5} step={0.01}
                onChange={(v) => setParam("lipSync", { visemeScale: v })} />
            </Row>
            <Row label="Phoneme lead (ms)">
              <Slider value={phonemeLead} min={0} max={150} step={5}
                onChange={(v) => setPhonemeLead(v)} />
            </Row>

            <SectionLabel>Phoneme Mapping (Kokoro ARPAbet → Model)</SectionLabel>
            <p className="text-[9px] text-text-dark leading-relaxed mb-2">
              Set morph target and strength per ARPAbet phoneme. Level is 0-100%.
            </p>
            <div className="flex gap-1 mb-2">
              <button
                onClick={() =>
                  setParam("lipSync", {
                    visemeMappings: { ...DEFAULT_VISEME_MAPPINGS },
                    visemeLevels: { ...DEFAULT_VISEME_LEVELS },
                  })
                }
                className="flex-1 py-0.5 rounded text-[9px] border border-line-med text-text-dark hover:text-text-med hover:border-line-light"
                title="Restore default phoneme mappings and levels"
              >
                Reset Mapping + Levels
              </button>
            </div>
            {PHONEME_GROUPS.map((group) => (
              <div key={`anim-${group.label}`} className="mb-2.5">
                <div className="text-[8px] font-bold text-text-dark uppercase tracking-widest mb-1">
                  {group.label}
                </div>
                {group.phonemes.map((ph) => {
                  const mapped = params.lipSync.visemeMappings[ph] ?? "";
                  const level = Math.max(
                    0,
                    Math.min(100, Math.round(params.lipSync.visemeLevels?.[ph] ?? 100)),
                  );
                  return (
                    <div key={`anim-${ph}`} className="mb-1.5 rounded border border-line-med/60 p-1.5">
                      <div className="flex items-center gap-1 mb-1">
                        <button
                          className={`w-8 flex-shrink-0 py-0.5 rounded text-[8px] font-mono border transition-colors ${
                            faceMappingPhoneme === ph
                              ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                              : "border-line-dark text-text-dark hover:border-line-med hover:text-text-med"
                          }`}
                          onClick={() => {
                            if (mapped) {
                              handleFaceMorphTest(mapped, 1);
                              setTimeout(() => handleFaceMorphTest(mapped, 0), 400);
                            }
                            setFaceMappingPhoneme(faceMappingPhoneme === ph ? null : ph);
                          }}
                          title={`${ph}${mapped ? ` -> ${mapped}` : " (unmapped)"}`}
                        >
                          {ph}
                        </button>
                        <select
                          value={mapped}
                          onChange={(e) => setVisemeMapping(ph, e.target.value)}
                          className="flex-1 rounded px-1 py-0.5 text-[9px] bg-line-med border border-line-dark text-text-med hover:text-text-norm focus:outline-none cursor-pointer truncate"
                        >
                          <option value="" className="bg-bg-norm">(none)</option>
                          {allMorphNames.map((n) => (
                            <option key={`anim-${ph}-${n}`} value={n} className="bg-bg-norm">{n}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-9 text-[8px] text-text-dark font-mono">{level}%</span>
                        <div className="flex-1">
                          <Slider
                            value={level}
                            min={0}
                            max={100}
                            step={1}
                            onChange={(v) => setVisemeLevel(ph, Math.round(v))}
                            inputWidthClassName="w-[46px]"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* ── Expression ─────────────────────────────────────────────────── */}
            <SectionLabel>Expression</SectionLabel>
            <div className="grid grid-cols-2 gap-1 mb-2">
              {EXPRESSIONS.map((expr) => (
                <button
                  key={expr}
                  onClick={() => onParamsChange({ ...params, expression: expr })}
                  className={`px-1.5 py-0.5 rounded text-[9px] capitalize border transition-colors ${
                    params.expression === expr
                      ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                      : "border-line-med text-text-dark hover:text-text-med hover:border-line-light"
                  }`}
                >
                  {expr}
                </button>
              ))}
            </div>

            {/* ── Hand Gestures ──────────────────────────────────────────────── */}
            <SectionLabel>Hand Gestures</SectionLabel>
            <Row
              label="Enabled"
              right={<Checkbox value={params.handMovement.enabled} onChange={(v: boolean) => setParam("handMovement", { enabled: v })} />}
            />
            <Row label="Intensity">
              <Slider value={params.handMovement.intensity} min={0} max={1} step={0.05}
                onChange={(v) => setParam("handMovement", { intensity: v })} />
            </Row>

            <div className="h-3" /> {/* bottom padding */}
          </>
        )}

        {/* ── Appearance tab ─────────────────────────────────────────────────── */}
        {tab === "appearance" && (
          <div>
            {renderMode === "normal" && (
              <div className="space-y-1.5 mb-3">
                <Row
                  label="Render Skin Mesh"
                  right={
                    <Checkbox
                      value={normalRenderOptions.skin}
                      onChange={(v) => onNormalRenderOptionsChange({ ...normalRenderOptions, skin: v })}
                    />
                  }
                />
                <Row
                  label="Render Eyes Mesh"
                  right={
                    <Checkbox
                      value={normalRenderOptions.eyes}
                      onChange={(v) => onNormalRenderOptionsChange({ ...normalRenderOptions, eyes: v })}
                    />
                  }
                />
                <Row
                  label="Render Teeth Mesh"
                  right={
                    <Checkbox
                      value={normalRenderOptions.teeth}
                      onChange={(v) => onNormalRenderOptionsChange({ ...normalRenderOptions, teeth: v })}
                    />
                  }
                />
                <Row
                  label="Render Hair Mesh"
                  right={
                    <Checkbox
                      value={normalRenderOptions.hair}
                      onChange={(v) => onNormalRenderOptionsChange({ ...normalRenderOptions, hair: v })}
                    />
                  }
                />
              </div>
            )}

            {/* ── Wireframe-only settings ─────────────────────────────────────────── */}
            {renderMode === "wireframe" && (
              <>
                <SectionLabel>Wireframe Style</SectionLabel>
                <Row label="Wire colour">
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="w-4 h-4 rounded-sm border border-line-med flex-shrink-0" style={{ background: appearance.wireColor }} />
                    <input type="color" value={appearance.wireColor}
                      onChange={(e) => onAppearanceChange({ ...appearance, wireColor: e.target.value })}
                      className="w-6 h-5 cursor-pointer rounded border-0 bg-transparent p-0" title="Pick wire colour" />
                    <span className="text-[9px] text-text-dark font-mono tracking-wide">{appearance.wireColor.toUpperCase()}</span>
                  </div>
                </Row>
                <div className="w-full h-1.5 rounded-full mb-2" style={{ background: appearance.wireColor, filter: computeGlowFilter(appearance) }} />
                <Row label="Glow intensity">
                  <Slider value={appearance.glowIntensity} min={0} max={1} step={0.05} onChange={(v) => onAppearanceChange({ ...appearance, glowIntensity: v })} />
                </Row>
                <Row label="Glow radius">
                  <Slider value={appearance.glowRadius} min={1} max={20} step={1} onChange={(v) => onAppearanceChange({ ...appearance, glowRadius: v })} />
                </Row>
                <Row label="Fill opacity">
                  <Slider value={appearance.fillOpacity} min={0} max={1} step={0.02} onChange={(v) => onAppearanceChange({ ...appearance, fillOpacity: v })} />
                </Row>
                <Row label="Fill brightness">
                  <Slider value={appearance.fillBrightness} min={-1} max={1} step={0.01} onChange={(v) => onAppearanceChange({ ...appearance, fillBrightness: v })} />
                </Row>
                <Row label="Fill color mix">
                  <Slider value={appearance.fillColorIntensity} min={0} max={1} step={0.01} onChange={(v) => onAppearanceChange({ ...appearance, fillColorIntensity: v })} />
                </Row>

                <SectionLabel>Wireframe Mesh Visibility</SectionLabel>
                <Row
                  label="Show Eyes Mesh"
                  right={
                    <Checkbox
                      value={normalRenderOptions.eyes}
                      onChange={(v) => onNormalRenderOptionsChange({ ...normalRenderOptions, eyes: v })}
                    />
                  }
                />
                <Row
                  label="Show Teeth Mesh"
                  right={
                    <Checkbox
                      value={normalRenderOptions.teeth}
                      onChange={(v) => onNormalRenderOptionsChange({ ...normalRenderOptions, teeth: v })}
                    />
                  }
                />
                <Row
                  label="Show Hair Mesh"
                  right={
                    <Checkbox
                      value={normalRenderOptions.hair}
                      onChange={(v) => onNormalRenderOptionsChange({ ...normalRenderOptions, hair: v })}
                    />
                  }
                />
              </>
            )}

            <SectionLabel>Base Colors</SectionLabel>
            <Row label="Base Skin Color">
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-4 h-4 rounded-sm border border-line-med flex-shrink-0" style={{ background: appearance.skinColor }} />
                <input type="color" value={appearance.skinColor}
                  onChange={(e) => onAppearanceChange({ ...appearance, skinColor: e.target.value })}
                  className="w-6 h-5 cursor-pointer rounded border-0 bg-transparent p-0" title="Pick skin colour" />
                <span className="text-[9px] text-text-dark font-mono tracking-wide">{appearance.skinColor.toUpperCase()}</span>
              </div>
            </Row>
            <Row label="Base Eyes Color">
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-4 h-4 rounded-sm border border-line-med flex-shrink-0" style={{ background: appearance.eyeColor }} />
                <input type="color" value={appearance.eyeColor}
                  onChange={(e) => onAppearanceChange({ ...appearance, eyeColor: e.target.value })}
                  className="w-6 h-5 cursor-pointer rounded border-0 bg-transparent p-0" title="Pick eyes colour" />
                <span className="text-[9px] text-text-dark font-mono tracking-wide">{appearance.eyeColor.toUpperCase()}</span>
              </div>
            </Row>
            <Row label="Base Mouth/Tongue Color">
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-4 h-4 rounded-sm border border-line-med flex-shrink-0" style={{ background: appearance.mouthColor }} />
                <input type="color" value={appearance.mouthColor}
                  onChange={(e) => onAppearanceChange({ ...appearance, mouthColor: e.target.value })}
                  className="w-6 h-5 cursor-pointer rounded border-0 bg-transparent p-0" title="Pick mouth/tongue colour" />
                <span className="text-[9px] text-text-dark font-mono tracking-wide">{appearance.mouthColor.toUpperCase()}</span>
              </div>
            </Row>
            <Row label="Base Teeth Color">
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-4 h-4 rounded-sm border border-line-med flex-shrink-0" style={{ background: appearance.teethColor }} />
                <input type="color" value={appearance.teethColor}
                  onChange={(e) => onAppearanceChange({ ...appearance, teethColor: e.target.value })}
                  className="w-6 h-5 cursor-pointer rounded border-0 bg-transparent p-0" title="Pick teeth colour" />
                <span className="text-[9px] text-text-dark font-mono tracking-wide">{appearance.teethColor.toUpperCase()}</span>
              </div>
            </Row>
                <Row label="Base Hair Color">
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="w-4 h-4 rounded-sm border border-line-med flex-shrink-0" style={{ background: appearance.hairColor }} />
                <input type="color" value={appearance.hairColor}
                  onChange={(e) => onAppearanceChange({ ...appearance, hairColor: e.target.value })}
                  className="w-6 h-5 cursor-pointer rounded border-0 bg-transparent p-0" title="Pick hair colour" />
                    <span className="text-[9px] text-text-dark font-mono tracking-wide">{appearance.hairColor.toUpperCase()}</span>
                  </div>
                </Row>
                <Row
                  label="Hide Hair"
                  right={
                    <Checkbox
                      value={normalRenderOptions.hideHair}
                      onChange={(v) => onNormalRenderOptionsChange({ ...normalRenderOptions, hideHair: v })}
                    />
                  }
                />
            <div className="h-3" />
          </div>
        )}

        {/* ── Face & Mouth tab ───────────────────────────────────────────────── */}
        {tab === "face" && (
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-1">

            {/* ── Status bar ──────────────────────────────────────────────── */}
            <div className="flex items-center justify-between py-1.5 border-b border-line-med mb-1">
              <span className="text-[9px] text-text-dark uppercase tracking-widest font-bold">
                {skeletonMapping
                  ? (skeletonMapping.morphTargets.length > 0
                      ? `${new Set(skeletonMapping.morphTargets.map((m) => m.name)).size} morphs detected`
                      : "No morphs detected")
                  : "Model not loaded"}
              </span>
              <button
                onClick={resetFaceTestMorphs}
                title="Reset all test values"
                className="text-[9px] text-text-dark hover:text-text-med flex items-center gap-0.5"
              >
                <RefreshCw size={9} /> Reset
              </button>
            </div>

            {/* ── Morph Test Sliders (by category) ─────────────────────── */}
            {MORPH_CATEGORY_ORDER.map((cat) => {
              const morphs = morphsByCategory[cat].filter((mt) => !isAnonymousMorphName(mt.name));
              if (!morphs || morphs.length === 0) return null;
              return (
                <div key={cat}>
                  <SectionLabel>{MORPH_CATEGORY_LABELS[cat]}</SectionLabel>
                  {morphs.map((mt) => {
                    const val = faceTestMorphs[mt.name] ?? 0;
                    return (
                      <div key={mt.name} className="mb-1.5">
                        <div className="flex items-center justify-between mb-0.5">
                          <span
                            className="text-[9px] text-text-med font-mono truncate max-w-[150px]"
                            title={mt.name}
                          >
                            {mt.name}
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="text-[8px] text-text-dark w-6 text-right">
                              {Math.round(val * 100)}%
                            </span>
                            {val > 0 && (
                              <button
                                onClick={() => handleFaceMorphTest(mt.name, 0)}
                                className="text-[8px] text-text-dark hover:text-text-med"
                                title="Reset"
                              >
                                <X size={8} />
                              </button>
                            )}
                          </div>
                        </div>
                        <Slider
                          value={val}
                          min={0}
                          max={1}
                          step={0.01}
                          onChange={(v) => handleFaceMorphTest(mt.name, v)}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {!skeletonMapping && (
              <p className="text-[9px] text-text-dark mt-2 leading-relaxed">
                Load a model to see its morph targets here.
              </p>
            )}

            {skeletonMapping && skeletonMapping.morphTargets.length === 0 && (
              <div className="mt-2 p-2 rounded border border-amber-500/30 bg-amber-500/5">
                <p className="text-[9px] text-amber-400 font-semibold mb-1">No morph targets found in GLB</p>
                <p className="text-[9px] text-text-dark leading-relaxed mb-1">
                  Shape keys were not exported. In Blender: <span className="text-text-med">File → Export → glTF 2.0</span>
                </p>
                <p className="text-[9px] text-text-dark font-semibold mt-1 mb-0.5">Under <span className="text-text-med font-mono">Mesh</span>:</p>
                <ul className="list-disc list-inside space-y-0.5 mb-1">
                  <li className="text-[9px] text-text-dark">Enable <span className="text-text-med font-mono">Shape Keys</span></li>
                </ul>
                <p className="text-[9px] text-text-dark font-semibold mt-1 mb-0.5">Under <span className="text-text-med font-mono">Shape Keys</span>:</p>
                <ul className="list-disc list-inside space-y-0.5 mb-1">
                  <li className="text-[9px] text-text-dark"><span className="text-text-med font-mono">Shape Key Normals</span> — enable (required for correct shading)</li>
                  <li className="text-[9px] text-text-dark"><span className="text-text-med font-mono">Shape Key Tangents</span> — enable if model uses normal maps</li>
                  <li className="text-[9px] text-text-dark"><span className="text-text-med font-mono">Shape Key Animations</span> — enable only if you have shape key animation tracks</li>
                  <li className="text-[9px] text-text-dark"><span className="text-text-med font-mono">Reset Shape Keys Between Actions</span> — leave off for lip sync use</li>
                  <li className="text-[9px] text-text-dark"><span className="text-text-med font-mono">Sampling Rate</span> — 30 fps is fine for animations</li>
                </ul>
                <p className="text-[9px] text-amber-400/80 mt-1">Re-export and replace <span className="font-mono">Character.glb</span>, then reload.</p>
              </div>
            )}

            {skeletonMapping && skeletonMapping.morphTargets.length > 0 &&
             new Set(skeletonMapping.morphTargets.map((m) => m.name)).size < 5 && (
              <div className="mt-2 p-2 rounded border border-amber-500/30 bg-amber-500/5">
                <p className="text-[9px] text-amber-400 font-semibold mb-1">
                  Only {new Set(skeletonMapping.morphTargets.map((m) => m.name)).size} morph(s) found
                </p>
                <p className="text-[9px] text-text-dark leading-relaxed mb-1">
                  If your model has more shape keys in Blender, check the GLB export settings:
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li className="text-[9px] text-text-dark">Under <span className="text-text-med font-mono">Mesh</span> → <span className="text-text-med font-mono">Shape Keys</span> must be enabled</li>
                  <li className="text-[9px] text-text-dark">Under <span className="text-text-med font-mono">Shape Keys</span> → enable <span className="text-text-med font-mono">Shape Key Normals</span> and <span className="text-text-med font-mono">Shape Key Tangents</span></li>
                  <li className="text-[9px] text-text-dark">Ensure all meshes with shape keys are selected before export</li>
                </ul>
              </div>
            )}

            {/* ── Quick Test Buttons ────────────────────────────────────── */}
            <SectionLabel>Quick Test</SectionLabel>
            <div className="flex gap-1 mb-2 flex-wrap">
              <button
                onClick={runVisemeSequence}
                disabled={testSequenceRunning || morphsByCategory.viseme.length === 0}
                className={`flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] border transition-colors ${
                  testSequenceRunning
                    ? "border-accent-primary text-accent-primary animate-pulse"
                    : "border-line-med text-text-dark hover:text-text-med hover:border-line-light"
                } disabled:opacity-40`}
                title="Cycle through all visemes"
              >
                <Play size={9} />
                Cycle Visemes
              </button>
              <button
                onClick={resetFaceTestMorphs}
                disabled={Object.keys(faceTestMorphs).length === 0}
                className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[9px] border border-line-med text-text-dark hover:text-text-med disabled:opacity-40"
              >
                <Square size={9} />
                Clear All
              </button>
            </div>

            {/* ── Jaw Open Test ─────────────────────────────────────────── */}
            <SectionLabel>Jaw Open Test</SectionLabel>
            <Row label="Open">
              <Slider value={jawTest} min={0} max={1} step={0.01} onChange={onJawTestChange} />
            </Row>
            <div className="mb-3">
              <button
                onClick={onRunMeshProbe}
                className="w-full py-1 rounded text-[9px] border border-line-med text-text-dark hover:text-text-med hover:border-line-light"
                title="Cycles highlight across candidate mouth/jaw meshes to identify the active teeth mesh"
              >
                Probe Teeth Meshes
              </button>
            </div>

            {/* ── Lip Sync Config ───────────────────────────────────────── */}
            <SectionLabel>Lip Sync</SectionLabel>
            <Row
              label="Enabled"
              right={<Checkbox value={params.lipSync.enabled} onChange={(v: boolean) => setParam("lipSync", { enabled: v })} />}
            />
            <Row label="Jaw sensitivity">
              <Slider value={params.lipSync.sensitivity} min={0} max={0.5} step={0.01}
                onChange={(v) => setParam("lipSync", { sensitivity: v })} />
            </Row>
            <Row label="Jaw scale">
              <Slider value={(params.lipSync as any).jawScale ?? 0.35} min={0} max={0.5} step={0.01}
                onChange={(v) => setParam("lipSync", { jawScale: v })} />
            </Row>
            <Row label="Viseme intensity">
              <Slider value={(params.lipSync as any).visemeScale ?? 0.3} min={0} max={0.5} step={0.01}
                onChange={(v) => setParam("lipSync", { visemeScale: v })} />
            </Row>
            <Row label="Phoneme lead (ms)">
              <Slider value={phonemeLead} min={0} max={150} step={5}
                onChange={(v) => setPhonemeLead(v)} />
            </Row>

            {/* ── Phoneme → Morph Mapping ───────────────────────────────── */}
            <SectionLabel>Phoneme Mapping (Kokoro ARPAbet → Model)</SectionLabel>
            <p className="text-[9px] text-text-dark leading-relaxed mb-2">
              Map each ARPAbet phoneme to a morph target in your model. Click a phoneme chip to preview its mapped morph.
            </p>
            <div className="flex gap-1 mb-2">
              <button
                onClick={() =>
                  setParam("lipSync", {
                    visemeMappings: { ...DEFAULT_VISEME_MAPPINGS },
                    visemeLevels: { ...DEFAULT_VISEME_LEVELS },
                  })
                }
                className="flex-1 py-0.5 rounded text-[9px] border border-line-med text-text-dark hover:text-text-med hover:border-line-light"
                title="Restore default mappings"
              >
                Reset to Defaults
              </button>
            </div>

            {PHONEME_GROUPS.map((group) => (
              <div key={group.label} className="mb-3">
                <div className="text-[8px] font-bold text-text-dark uppercase tracking-widest mb-1">
                  {group.label}
                </div>
                {group.phonemes.map((ph) => {
                  const mapped = params.lipSync.visemeMappings[ph] ?? "";
                  const isTesting = !!(mapped && (faceTestMorphs[mapped] ?? 0) > 0);
                  return (
                    <div key={ph} className="flex items-center gap-1 mb-1">
                      {/* Phoneme chip — click to preview */}
                      <button
                        className={`w-8 flex-shrink-0 py-0.5 rounded text-[8px] font-mono border transition-colors ${
                          faceMappingPhoneme === ph
                            ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
                            : "border-line-dark text-text-dark hover:border-line-med hover:text-text-med"
                        }`}
                        onClick={() => {
                          if (mapped) {
                            handleFaceMorphTest(mapped, 1);
                            setTimeout(() => handleFaceMorphTest(mapped, 0), 400);
                          }
                          setFaceMappingPhoneme(faceMappingPhoneme === ph ? null : ph);
                        }}
                        title={`${ph}${mapped ? ` → ${mapped}` : " (unmapped)"}`}
                      >
                        {ph}
                      </button>
                      {/* Morph target select */}
                      <select
                        value={mapped}
                        onChange={(e) => setVisemeMapping(ph, e.target.value)}
                        className={`flex-1 rounded px-1 py-0.5 text-[9px] bg-line-med border text-text-med hover:text-text-norm focus:outline-none cursor-pointer truncate ${
                          isTesting ? "border-accent-primary" : "border-line-dark"
                        }`}
                      >
                        <option value="" className="bg-bg-norm">(none)</option>
                        {allMorphNames.map((n) => (
                          <option key={n} value={n} className="bg-bg-norm">{n}</option>
                        ))}
                      </select>
                      <div className="w-[80px] flex-shrink-0">
                        <Slider
                          value={Math.max(0, Math.min(100, Math.round(params.lipSync.visemeLevels?.[ph] ?? 100)))}
                          min={0}
                          max={100}
                          step={1}
                          onChange={(v) => setVisemeLevel(ph, Math.round(v))}
                          inputWidthClassName="w-[40px]"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            <div className="h-3" />
          </div>
        )}

        {/* ── Debug tab — full-height rig inspector ──────────────────────────── */}
        {tab === "debug" && (
          <>
            {/* Visual helpers bar */}
            <div className="flex items-center gap-3 px-3 py-1.5 border-b border-line-med flex-shrink-0 flex-wrap">
              <span className="text-[9px] text-text-dark uppercase tracking-widest font-bold">Helpers</span>
              <div className="flex items-center gap-1.5">
                <Checkbox value={showSkeletonHelper} onChange={onShowSkeletonHelperChange} label="Skeleton" />
              </div>
              <div className="flex items-center gap-1.5">
                <Checkbox value={disableProcedural} onChange={onDisableProceduralChange} label="Freeze Anim" />
              </div>
              <div className="flex items-center gap-1.5">
                <Checkbox value={showStats} onChange={onShowStatsChange} label="Show Stats" />
              </div>
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-[9px] text-text-dark">Jaw</span>
                <div className="w-40">
                  <Slider
                    value={jawTest}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={onJawTestChange}
                    inputWidthClassName="w-[46px]"
                  />
                </div>
              </div>
            </div>

            {/* Full-height rig debug panel */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <RigDebugPanel
                skeletonMapping={skeletonMapping}
                boneManipulations={boneManipulations}
                onBoneManipulation={onBoneManipulation}
                onResetBone={onResetBone}
                onResetAllBones={onResetAllBones}
                morphValues={debugMorphs}
                onMorphChange={onDebugMorphChange}
                onResetAllMorphs={() => Object.keys(debugMorphs).forEach((n) => onDebugMorphChange(n, 0))}
                activeAnimationClip={activeAnimationClip}
                isAnimationPlaying={isAnimationPlaying}
                animationTime={animationTime}
                animationDuration={animationDuration}
                onPlayClip={onPlayClip}
                onPauseClip={onPauseClip}
                onStopClip={onStopClip}
                onScrubClip={onScrubClip}
                hierarchyConfig={hierarchyConfig}
                onHierarchyConfigChange={onHierarchyConfigChange}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface AvatarPanelProps {
  presentationMode?: boolean;
}

export function AvatarPanel({ presentationMode = false }: AvatarPanelProps) {
  const mode = useUiModeStore((s) => s.mode);
  const toggleAvatarPresentation = useUiModeStore((s) => s.toggleAvatarPresentation);
  const {
    activePreset,
    isLoading,
    appearance,
    updateAppearance,
    renderMode,
    updateRenderMode,
  } = useAvatarPresets();

  const [zoomIdx, setZoomIdx] = useState(3);
  const [cameraOffset, setCameraOffset] = useState(0); // Camera Y offset in meters
 const [modelError, setModelError] = useState(false);
  const [debugMorphs, setDebugMorphs] = useState<Record<string, number>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [jawTest, setJawTest] = useState(0);
  const [meshProbeNonce, setMeshProbeNonce] = useState(0);
  const [normalRenderOptions, setNormalRenderOptions] = useState<NormalRenderOptions>({
    skin: true,
    eyes: true,
    teeth: true,
    hair: true,
    hideHair: false,
  });
  const [boneMapping, setBoneMapping] = useState<BoneMapping | null>(null);
  const [skeletonMapping, setSkeletonMapping] = useState<SkeletonMapping | null>(null);
  const [boneManipulations, setBoneManipulations] = useState<Record<string, { x: number; y: number; z: number }>>({});
  const [showSkeletonHelper, setShowSkeletonHelper] = useState(false);
  const [disableProcedural, setDisableProcedural] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [activeAnimationClip, setActiveAnimationClip] = useState<string | null>(null);
  const [isAnimationPlaying, setIsAnimationPlaying] = useState(false);
  const [animationTime, setAnimationTime] = useState(0);
  const [animationDuration, setAnimationDuration] = useState(0);
  const activeModelSrc = MODE_MODEL_SRC[renderMode];
  const activeModelFilename = MODE_MODEL_FILENAME[renderMode];

  // Hierarchy config state - persisted per-model in localStorage
  const [hierarchyConfig, setHierarchyConfig] = useState<BoneHierarchyConfig>(() => {
    // Load from localStorage on initial render
    try {
      const stored = localStorage.getItem(`avatar-hierarchy-${activeModelSrc}`);
      if (stored) {
        const parsed = JSON.parse(stored) as BoneHierarchyConfig;
        if (parsed.modelSrc === activeModelSrc) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn("[AvatarPanel] Failed to load hierarchy config:", e);
    }
    return { ...DEFAULT_HIERARCHY_CONFIG, modelSrc: activeModelSrc, lastModified: Date.now() };
  });

  // Persist hierarchy config to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(`avatar-hierarchy-${activeModelSrc}`, JSON.stringify(hierarchyConfig));
    } catch (e) {
      console.warn("[AvatarPanel] Failed to save hierarchy config:", e);
    }
  }, [hierarchyConfig, activeModelSrc]);

  // Load hierarchy config when model changes
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`avatar-hierarchy-${activeModelSrc}`);
      if (stored) {
        const parsed = JSON.parse(stored) as BoneHierarchyConfig;
        if (parsed.modelSrc === activeModelSrc) {
          setHierarchyConfig(parsed);
          return;
        }
      }
    } catch (e) {
      console.warn("[AvatarPanel] Failed to load hierarchy config for new model:", e);
    }
    setHierarchyConfig({ ...DEFAULT_HIERARCHY_CONFIG, modelSrc: activeModelSrc, lastModified: Date.now() });
  }, [activeModelSrc]);

  // Handler for hierarchy config changes
  const handleHierarchyConfigChange = useCallback((config: BoneHierarchyConfig) => {
    setHierarchyConfig(config);
  }, []);

  // Local params state - initialized from active preset, edited in UI
  const [params, setParams] = useState<AnimationParams>(activePreset.params);

  // When active preset changes from outside, update local params
  useEffect(() => {
    setParams(activePreset.params);
  }, [activePreset]);

  const modelLabel = glbLabel(activeModelFilename);
  const isPresentationActive = mode === "avatar_presentation";
  const panelPerformance = params.performance ?? { renderScale: 1 as const };

  const handleDebugMorphChange = (name: string, value: number) => {
    setDebugMorphs((prev) => {
      const next = { ...prev };
      if (Math.abs(value) < 0.0001) {
        delete next[name];
      } else {
        next[name] = value;
      }
      return next;
    });
  };

  // Bone manipulation handlers for rig debug
  const handleBoneManipulation = (boneName: string, axis: 'x' | 'y' | 'z', value: number) => {
    setBoneManipulations((prev) => ({
      ...prev,
      [boneName]: {
        ...(prev[boneName] ?? { x: 0, y: 0, z: 0 }),
        [axis]: value,
      },
    }));
  };

  const handleResetBone = (boneName: string) => {
    setBoneManipulations((prev) => {
      const next = { ...prev };
      delete next[boneName];
      return next;
    });
  };

  const handleResetAllBones = () => {
    setBoneManipulations({});
  };

  // Animation clip playback handlers
  const handlePlayClip = (clip: string) => {
    setActiveAnimationClip(clip);
    setIsAnimationPlaying(true);
    setAnimationTime(0);
  };
  const handlePauseClip = () => setIsAnimationPlaying(false);
  const handleStopClip = () => {
    setActiveAnimationClip(null);
    setIsAnimationPlaying(false);
    setAnimationTime(0);
    setAnimationDuration(0);
  };
  const handleScrubClip = (t: number) => {
    setIsAnimationPlaying(false);
    setAnimationTime(t);
  };
  const handleAnimationTimeChange = (time: number, duration: number) => {
    setAnimationTime(time);
    setAnimationDuration(duration);
  };

  const viewport = (
    <div className={presentationMode ? "h-full w-full relative min-h-0 overflow-hidden bg-black" : "flex-1 relative min-h-0 overflow-hidden"}>
        {/* ── 3D viewer (unified for all modes) ───────────────────────────────── */}
        {!isLoading && !modelError ? (
          <Suspense
            fallback={
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <SquareUser size={42} className="text-accent-primary/60 mb-2" />
                <div className="text-sm text-text-med">Loading...</div>
              </div>
            }
          >
            <AvatarRenderer
              src={activeModelSrc}
              renderMode={renderMode}
              params={params}
              appearance={appearance}
              renderScale={panelPerformance.renderScale}
              presentationMode={presentationMode}
              cameraOrbit={ZOOM_ORBITS[zoomIdx]}
              cameraTarget={`${ZOOM_FALLBACK_TARGETS[zoomIdx].split(' ')[0]}m ${(parseFloat(ZOOM_FALLBACK_TARGETS[zoomIdx].split(' ')[1]) + cameraOffset)}m ${ZOOM_FALLBACK_TARGETS[zoomIdx].split(' ')[2]}m`}
              debugMorphs={debugMorphs}
              jawTest={jawTest}
              meshProbeNonce={meshProbeNonce}
              normalRenderOptions={normalRenderOptions}
              boneManipulations={boneManipulations}
              showSkeletonHelper={showSkeletonHelper}
              disableProcedural={disableProcedural}
              showStats={showStats}
              activeAnimationClip={activeAnimationClip}
              isAnimationPlaying={isAnimationPlaying}
              animationTime={animationTime}
              hierarchyConfig={hierarchyConfig}
              onLoad={() => setModelError(false)}
              onError={() => setModelError(true)}
              onBoneMapping={setBoneMapping}
              onSkeletonMapping={setSkeletonMapping}
              onAnimationTimeChange={handleAnimationTimeChange}
            />
          </Suspense>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <SquareUser size={42} className="text-accent-primary/60 mb-2" />
            <div className="text-sm text-text-med">
              {modelError ? `Failed to load ${modelLabel}` : "Loading..."}
            </div>
          </div>
        )}

        {/* ── Zoom and camera controls ──────────────────────────────────────────────── */}
        <div className="absolute top-2 right-2 flex flex-col gap-1 z-10">
          <button
            onClick={toggleAvatarPresentation}
            className="p-1 text-white/90 hover:text-white disabled:opacity-30"
            title={isPresentationActive ? "Exit full screen" : "Full screen"}
          >
            {isPresentationActive ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            onClick={() => setZoomIdx((i) => Math.min(ZOOM_ORBITS.length - 1, i + 1))}
            disabled={zoomIdx === ZOOM_ORBITS.length - 1}
            className="p-1 text-white/90 hover:text-white disabled:opacity-30"
            title="Zoom in"
          >
            <ZoomIn size={13} />
          </button>
          <button
            onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
            disabled={zoomIdx === 0}
            className="p-1 text-white/90 hover:text-white disabled:opacity-30"
            title="Zoom out"
          >
            <ZoomOut size={13} />
          </button>
          {/* Camera up/down controls */}
          <div className="flex flex-col gap-1 mt-1 pt-1 border-t border-line-med/50">
            <button
              onClick={() => setCameraOffset((o) => Math.min(2, o + 0.15))}
              disabled={cameraOffset >= 2}
              className="p-1 text-white/90 hover:text-white disabled:opacity-30"
              title="Move view up"
            >
              <ChevronUp size={13} />
            </button>
            <button
              onClick={() => setCameraOffset((o) => Math.max(-0.5, o - 0.15))}
              disabled={cameraOffset <= -0.5}
              className="p-1 text-white/90 hover:text-white disabled:opacity-30"
              title="Move view down"            >
              <ChevronDown size={13} />
            </button>
          </div>
        </div>

        {/* ── Settings overlay ───────────────────────────────────────────── */}
        {showSettings && (
          <AvatarSettingsOverlay
            params={params}
            onParamsChange={setParams}
            appearance={appearance}
            onAppearanceChange={updateAppearance}
            renderMode={renderMode}
            onRenderMode={updateRenderMode}
            debugMorphs={debugMorphs}
            onDebugMorphChange={handleDebugMorphChange}
            jawTest={jawTest}
            onJawTestChange={setJawTest}
            boneMapping={boneMapping}
            skeletonMapping={skeletonMapping}
            boneManipulations={boneManipulations}
            onBoneManipulation={handleBoneManipulation}
            onResetBone={handleResetBone}
            onResetAllBones={handleResetAllBones}
            showSkeletonHelper={showSkeletonHelper}
            onShowSkeletonHelperChange={setShowSkeletonHelper}
            disableProcedural={disableProcedural}
            onDisableProceduralChange={setDisableProcedural}
            showStats={showStats}
            onShowStatsChange={setShowStats}
            activeAnimationClip={activeAnimationClip}
            isAnimationPlaying={isAnimationPlaying}
            animationTime={animationTime}
            animationDuration={animationDuration}
            onPlayClip={handlePlayClip}
            onPauseClip={handlePauseClip}
            onStopClip={handleStopClip}
            onScrubClip={handleScrubClip}
            hierarchyConfig={hierarchyConfig}
            onHierarchyConfigChange={handleHierarchyConfigChange}
            normalRenderOptions={normalRenderOptions}
            onNormalRenderOptionsChange={setNormalRenderOptions}
            onRunMeshProbe={() => setMeshProbeNonce((n) => n + 1)}
            onClose={() => setShowSettings(false)}
          />
        )}
      </div>
  );

  if (presentationMode) {
    return viewport;
  }

  return (
    <PanelWrapper
      fill
      title="Avatar"
      icon={<SquareUser size={15} className="text-accent-primary" />}
      actions={
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-dark font-mono">
            {activeModelFilename}
          </span>
          <button
            onClick={() => setShowSettings((v) => !v)}
            title="Avatar settings"
            className={`p-0.5 rounded transition-colors ${
              showSettings ? "text-accent-primary" : "text-text-dark hover:text-text-med"
            }`}
          >
            <Settings size={13} />
          </button>
        </div>
      }
    >
      {viewport}
    </PanelWrapper>
  );
}
