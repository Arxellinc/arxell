// ── Animation params ──────────────────────────────────────────────────────────
// The live parameters that drive the procedural animation loop.
// Stored inside AnimationPreset and edited in the settings overlay.

export interface AnimationParams {
  performance: {
    /** Internal render scale multiplier. 1 = native, 0.5 = half resolution on each axis. */
    renderScale: 1 | 0.75 | 0.5;
  };
  restPose: {
    leftArmDown: number;
    leftArmForward: number;
    leftArmOutward: number;
    rightArmDown: number;
    rightArmForward: number;
    rightArmOutward: number;
  };
  idle:         { enabled: boolean; speed: number; intensity: number };
  breathing:    { enabled: boolean; rate: number; depth: number };
  headMovement: { enabled: boolean; range: number };
  lipSync:      {
    enabled: boolean;
    sensitivity: number;
    /** Scales the jaw open amount (0-1). Lower = subtler jaw movement. Default 0.5. */
    jawScale: number;
    /** Scales the phoneme viseme intensity (0-1). Lower = subtler mouth shapes. Default 0.5. */
    visemeScale: number;
    /** Maps Kokoro ARPAbet phoneme → model morph-target name. Empty string = no mapping. */
    visemeMappings: Record<string, string>;
    /** Per-phoneme intensity multiplier, 0-100. 100 = full mapped influence. */
    visemeLevels: Record<string, number>;
  };
  expression:   "neutral" | "happy" | "thinking" | "focused";
  handMovement: { enabled: boolean; intensity: number };
}

// ── Preset ────────────────────────────────────────────────────────────────────

export interface AnimationPreset {
  id:      string;
  name:    string;
  builtIn: boolean;   // built-ins cannot be deleted or renamed
  params:  AnimationParams;
}

// ── Wireframe-specific appearance ─────────────────────────────────────────────
// Settings that only apply to Wireframe render mode.

export interface WireframeSpecificAppearance {
  wireColor:     string;
  glowIntensity: number;
  glowRadius:    number;
  fillOpacity:   number;
  fillBrightness: number;  // -1 to 1: 0 = no change, negative = darker, positive = lighter
  fillColorIntensity: number;  // 0 to 1: 0 = background color, 1 = wire color
}

// ── Shared appearance (applies to both Normal and Wireframe) ──────────────────
// Each mode has its own independent copy of these settings.

export interface SharedAppearance {
  skinColor: string; // hex color tint for skin/body
  eyeColor: string;  // hex color for eyes
  mouthColor: string;  // hex color for mouth/tongue
  eyeBrightness: number;  // -1 to 1: brightness adjustment for eyes
  eyeColorIntensity: number;   // 0 to 1: 0 = eyeColor, 1 = wire color (wireframe only)
  teethColor: string; // hex color tint for teeth
  hairColor: string; // hex color tint for hair
  lipColor: string;  // hex color for lips
  lipBrightness: number;  // -1 to 1: brightness adjustment for lips
  lipColorIntensity: number;   // 0 to 1: 0 = lipColor, 1 = wire color (wireframe only)
}

// ── Full appearance for a single render mode ───────────────────────────────────

export interface ModeAppearance {
  // Wireframe-only settings (ignored in normal mode)
  wireColor:     string;
  glowIntensity: number;
  glowRadius:    number;
  fillOpacity:   number;
  fillBrightness: number;
  fillColorIntensity: number;
  // Shared settings (apply to both modes independently)
  skinColor: string;
  eyeColor: string;
  mouthColor: string;
  eyeBrightness: number;
  eyeColorIntensity: number;
  teethColor: string;
  hairColor: string;
  lipColor: string;
  lipBrightness: number;
  lipColorIntensity: number;
}

// ── Legacy type alias for backwards compatibility ──────────────────────────────
export type WireframeAppearance = ModeAppearance;

// ── Combined appearance for both render modes ──────────────────────────────────
export interface AppearanceSettings {
  normal: ModeAppearance;
  wireframe: ModeAppearance;
}

// ── Built-in presets ──────────────────────────────────────────────────────────

/**
 * Default Kokoro ARPAbet phoneme → 3ds-Max morph-target name mapping for
 * the primary Character.glb (Bip_sandy).  Keys are ARPAbet phonemes that
 * Kokoro emits; values are the morph-target names baked into the model.
 * Empty string means "no morph assigned for this phoneme".
 */
export const DEFAULT_VISEME_MAPPINGS: Record<string, string> = {
  // ── Vowels ───────────────────────────────────────────────────────────────
  AA: "PH_A",        // f a ther
  AE: "PH_A",        // c a t
  AH: "PH_A",        // b u t
  AO: "PH_O-U",     // b ough t
  AW: "PH_O-U",     // c ow
  AY: "PH_I-E",     // b ite
  EH: "PH_I-E",     // b e t
  ER: "PH_I-E",     // b ird
  EY: "PH_I-E",     // b ait
  IH: "PH_I-E",     // b it
  IY: "PH_I-E",     // b eet
  OW: "PH_O-U",     // b oat
  OY: "PH_O-U",     // b oy
  UH: "PH_O-U",     // b ook
  UW: "PH_O-U",     // b oot
  // ── Consonants ───────────────────────────────────────────────────────────
  B:  "PH_B-P",
  CH: "PH_CH-SH",
  D:  "PH_D-S",
  DH: "PH_D-S",
  F:  "PH_V-F",
  G:  "PH_D-S",
  HH: "",
  JH: "PH_CH-SH",
  K:  "PH_D-S",
  L:  "PH_D-S",
  M:  "PH_B-P",
  N:  "PH_D-S",
  NG: "PH_D-S",
  P:  "PH_B-P",
  R:  "PH_D-S",
  S:  "PH_D-S",
  SH: "PH_CH-SH",
  T:  "PH_D-S",
  TH: "PH_D-S",
  V:  "PH_V-F",
  W:  "PH_O-U",
  Y:  "PH_I-E",
  Z:  "PH_D-S",
  ZH: "PH_CH-SH",
  // ── Silence / closure ────────────────────────────────────────────────────
  SIL: "",
  SP:  "",
};

/** Default per-phoneme mapped intensity levels (0-100). */
export const DEFAULT_VISEME_LEVELS: Record<string, number> = Object.fromEntries(
  Object.keys(DEFAULT_VISEME_MAPPINGS).map((phoneme) => [phoneme, 100]),
) as Record<string, number>;

export const BUILT_IN_PRESETS: AnimationPreset[] = [
  {
    id: "builtin-default",
    name: "Default",
    builtIn: true,
    params: {
      performance: { renderScale: 1 },
      restPose: {
        leftArmDown: 0,
        leftArmForward: 0,
        leftArmOutward: 0,
        rightArmDown: 0,
        rightArmForward: 0,
        rightArmOutward: 0,
      },
      idle:         { enabled: true,  speed: 1.7, intensity: 0.6 },
      breathing:    { enabled: true,  rate: 14,   depth: 0.4 },
      headMovement: { enabled: true,  range: 0.3 },
      lipSync:      { enabled: true,  sensitivity: 0.4, jawScale: 0.35, visemeScale: 0.3, visemeMappings: { ...DEFAULT_VISEME_MAPPINGS }, visemeLevels: { ...DEFAULT_VISEME_LEVELS } },
      expression:   "neutral",
      handMovement: { enabled: false, intensity: 0.2 },
    },
  },
  {
    id: "builtin-natural",
    name: "Natural Standing (Legacy)",
    builtIn: true,
    params: {
      performance: { renderScale: 1 },
      restPose: {
        leftArmDown: 3,
        leftArmForward: 10,
        leftArmOutward: 38,
        rightArmDown: 2,
        rightArmForward: -3,
        rightArmOutward: 40,
      },
      idle:         { enabled: true,  speed: 0.8, intensity: 0.4 },
      breathing:    { enabled: true,  rate: 14,   depth: 0.5 },
      headMovement: { enabled: true,  range: 0.4 },
      lipSync:      { enabled: true,  sensitivity: 0.4, jawScale: 0.35, visemeScale: 0.3, visemeMappings: { ...DEFAULT_VISEME_MAPPINGS }, visemeLevels: { ...DEFAULT_VISEME_LEVELS } },
      expression:   "neutral",
      handMovement: { enabled: false, intensity: 0.3 },
    },
  },
  {
    id: "builtin-alert",
    name: "Alert",
    builtIn: true,
    params: {
      performance: { renderScale: 1 },
      restPose: {
        leftArmDown: 55,
        leftArmForward: 5,
        leftArmOutward: 3,
        rightArmDown: 55,
        rightArmForward: 5,
        rightArmOutward: 3,
      },
      idle:         { enabled: false, speed: 1.0, intensity: 0.2 },
      breathing:    { enabled: true,  rate: 16,   depth: 0.35 },
      headMovement: { enabled: true,  range: 0.25 },
      lipSync:      { enabled: true,  sensitivity: 0.4, jawScale: 0.35, visemeScale: 0.3, visemeMappings: { ...DEFAULT_VISEME_MAPPINGS }, visemeLevels: { ...DEFAULT_VISEME_LEVELS } },
      expression:   "focused",
      handMovement: { enabled: false, intensity: 0.2 },
    },
  },
  {
    id: "builtin-relaxed",
    name: "Relaxed",
    builtIn: true,
    params: {
      performance: { renderScale: 1 },
      restPose: {
        leftArmDown: 70,
        leftArmForward: 10,
        leftArmOutward: 8,
        rightArmDown: 70,
        rightArmForward: 10,
        rightArmOutward: 8,
      },
      idle:         { enabled: true,  speed: 0.6, intensity: 0.65 },
      breathing:    { enabled: true,  rate: 12,   depth: 0.65 },
      headMovement: { enabled: true,  range: 0.5 },
      lipSync:      { enabled: true,  sensitivity: 0.4, jawScale: 0.35, visemeScale: 0.3, visemeMappings: { ...DEFAULT_VISEME_MAPPINGS }, visemeLevels: { ...DEFAULT_VISEME_LEVELS } },
      expression:   "neutral",
      handMovement: { enabled: false, intensity: 0.3 },
    },
  },
];

// Default appearance for a single mode
const DEFAULT_MODE_APPEARANCE: ModeAppearance = {
  wireColor:     "#00ccff",
  glowIntensity: 0.9,
  glowRadius:    4,
  fillOpacity:   0.18,
  fillBrightness: 0,
  fillColorIntensity: 0,
  skinColor: "#16E9F5",
  eyeColor: "#1a88aa",
  mouthColor: "#0f4e64",
  eyeBrightness: 0,
  eyeColorIntensity: 0.3,
  teethColor: "#f8f3ec",
  hairColor: "#16E9F5",
  lipColor: "#cc6677",
  lipBrightness: 0,
  lipColorIntensity: 0.2,
};

// Default appearance settings for both modes
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  normal: {
    ...DEFAULT_MODE_APPEARANCE,
    // Normal mode specific defaults can override here
  },
  wireframe: {
    ...DEFAULT_MODE_APPEARANCE,
    // Wireframe mode specific defaults can override here
  },
};

// Legacy single-mode default for backwards compatibility
export const DEFAULT_APPEARANCE: WireframeAppearance = DEFAULT_MODE_APPEARANCE;

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}

export function computeGlowFilter(a: WireframeAppearance): string {
  // When glowIntensity is 0, glow should be nearly invisible
  // Scale from 0.05 (barely visible) to 0.8 (full glow)
  const inner = hexAlpha(a.wireColor, 0.05 + a.glowIntensity * 0.75);
  const outer = hexAlpha(a.wireColor, 0.02 + a.glowIntensity * 0.5);
  return [
    `drop-shadow(0 0 ${a.glowRadius}px ${inner})`,
    `drop-shadow(0 0 ${a.glowRadius * 3.5}px ${outer})`,
  ].join(" ");
}

export function paramsEqual(a: AnimationParams, b: AnimationParams): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Legacy shim ───────────────────────────────────────────────────────────────
// WireframeViewer.tsx still uses AvatarAnimSettings; kept until that file is
// deleted after AvatarRenderer replaces it.

export type AvatarAnimSettings = {
  appearance:   WireframeAppearance;
  restPose:     AnimationParams["restPose"];
  idle:         AnimationParams["idle"];
  breathing:    AnimationParams["breathing"];
  headMovement: AnimationParams["headMovement"];
  lipSync:      AnimationParams["lipSync"];
  expression:   AnimationParams["expression"];
  handMovement: AnimationParams["handMovement"];
};

export const DEFAULT_ANIM_SETTINGS: AvatarAnimSettings = {
  appearance:   DEFAULT_APPEARANCE,
  ...BUILT_IN_PRESETS[0].params,
};

// ── Rig Debug Types ─────────────────────────────────────────────────────────────

/**
 * Detailed information about a single bone in the skeleton.
 * Used for the rig debugging UI to inspect and manipulate bones.
 */
export interface BoneInfo {
  name: string;
  parent: string | null;
  children: string[];
  depth: number;
  initialRotation: { x: number; y: number; z: number };
  initialQuaternion: { x: number; y: number; z: number; w: number };
  worldPosition: { x: number; y: number; z: number };
  
  // Classification
  isTwistBone: boolean;
  twistAxis: 'x' | 'y' | 'z' | null;  // Primary twist axis if twist bone
  isCorrective: boolean;
  
  // Suggested limits (in radians) - derived from common rigging practices
  suggestedLimits: {
    x: { min: number; max: number };
    y: { min: number; max: number };
    z: { min: number; max: number };
  };
  
  // Category for UI grouping
  category: BoneCategory;
}

export type BoneCategory =
  | 'spine'
  | 'head'
  | 'face'
  | 'arm-left'
  | 'arm-right'
  | 'hand-left'
  | 'hand-right'
  | 'leg-left'
  | 'leg-right'
  | 'twist'
  | 'other';

/**
 * Full skeleton mapping with hierarchy and metadata.
 * Passed from AvatarRenderer to the debug UI.
 */
export interface SkeletonMapping {
  bones: Map<string, BoneInfo>;
  boneList: string[];  // Ordered list of bone names
  rootBones: string[];  // Bones with no parent
  
  // Twist bone chains (e.g., upper arm -> twist bones)
  twistChains: TwistChain[];
  
  // Statistics
  totalBones: number;
  twistBoneCount: number;
  correctiveBoneCount: number;
  
  // Morph targets
  morphTargets: MorphTargetInfo[];
  
  // Animation clips
  animations: AnimationInfo[];
}

export interface TwistChain {
  mainBone: string;       // The primary bone (e.g., upper arm)
  twistBones: string[];   // Twist bones that should follow (e.g., upper-upper-arm-twist)
  /** Axis to extract twist component around. Use 'all' to copy the full delta rotation. */
  axis: 'x' | 'y' | 'z' | 'all';
  distribution: number[]; // Weight for each twist bone (0-1, should sum to 1)
}

export interface MorphTargetInfo {
  name: string;
  meshName: string;
  index: number;
  category: MorphCategory;
}

export type MorphCategory =
  | 'viseme'
  | 'expression'
  | 'eye'
  | 'brow'
  | 'cheek'
  | 'jaw'
  | 'other';

export interface AnimationInfo {
  name: string;
  duration: number;
  trackCount: number;
  trackNames: string[];
}

/**
 * Runtime bone manipulation state.
 * Used to manually control bones from the debug UI.
 */
export interface BoneManipulation {
  boneName: string;
  rotationOffset: { x: number; y: number; z: number };  // Euler angles in radians
}

/**
 * Manual override for a twist chain.
 * Allows users to correct auto-detected twist chains or add new ones.
 */
export interface TwistChainOverride {
  mainBone: string;
  twistBones: string[];
  /** Axis to extract twist component around. Use 'all' to copy the full delta rotation. */
  axis: 'x' | 'y' | 'z' | 'all';
  distribution: number[];  // Manual weights for each twist bone (0-1, should sum to 1)
  enabled: boolean;  // Allow disabling a chain without deleting it
}

/**
 * Manual override for bone parent relationship.
 * Used to fix incorrect hierarchy detection.
 */
export interface BoneParentOverride {
  boneName: string;
  overrideParent: string | null;  // null means use original parent
}

/**
 * Complete hierarchy configuration for a model.
 * Stored per-model in localStorage and applied on load.
 */
export interface BoneHierarchyConfig {
  modelSrc: string;  // Model identifier (URL or filename)
  twistChainOverrides: TwistChainOverride[];
  parentOverrides: BoneParentOverride[];
  disabledTwistBones: string[];  // Twist bones to ignore completely
  customTwistBones: string[];  // Bones to treat as twist bones (even if not auto-detected)
  lastModified: number;  // Timestamp for cache invalidation
}

/**
 * Default empty hierarchy config.
 */
export const DEFAULT_HIERARCHY_CONFIG: BoneHierarchyConfig = {
  modelSrc: '',
  twistChainOverrides: [],
  parentOverrides: [],
  disabledTwistBones: [],
  customTwistBones: [],
  lastModified: 0,
};

/**
 * Hardcoded twist-chain configuration for the primary Character.glb model
 * (Bip_sandy skeleton).  These exact bone names were confirmed from the live
 * skeleton log.  Using explicit overrides bypasses the auto-detection entirely
 * and guarantees correct pairing every time.
 */
export const CHARACTER_GLB_HIERARCHY_CONFIG: Omit<BoneHierarchyConfig, 'modelSrc' | 'lastModified'> = {
  parentOverrides: [],
  disabledTwistBones: [],
  customTwistBones: [],
  twistChainOverrides: [
    // ── Upper arm twist bones ──────────────────────────────────────────────
    // axis:'all' copies the full delta rotation (swing + roll) so the twist
    // bones track the upper arm exactly rather than only the roll component.
    {
      mainBone: 'Bip_sandy_L_UpperArm',
      twistBones: ['Bip_sandy_LUpArmTwist', 'Bip_sandy_LUpArmTwist1'],
      axis: 'all',
      distribution: [1.0, 0],
      enabled: true,
    },
    {
      mainBone: 'Bip_sandy_R_UpperArm',
      twistBones: ['Bip_sandy_RUpArmTwist', 'Bip_sandy_RUpArmTwist1'],
      axis: 'all',
      distribution: [1.0, 0],
      enabled: true,
    },
    // ── Forearm twist bones ───────────────────────────────────────────────
    {
      mainBone: 'Bip_sandy_L_Forearm',
      twistBones: ['Bip_sandy_L_ForeTwist', 'Bip_sandy_L_ForeTwist1'],
      axis: 'y',
      distribution: [0.5, 0.5],
      enabled: true,
    },
    {
      mainBone: 'Bip_sandy_R_Forearm',
      twistBones: ['Bip_sandy_R_ForeTwist', 'Bip_sandy_R_ForeTwist1'],
      axis: 'y',
      distribution: [0.5, 0.5],
      enabled: true,
    },
    // ── Thigh twist bones ─────────────────────────────────────────────────
    {
      mainBone: 'Bip_sandy_L_Thigh',
      twistBones: ['Bip_sandy_LThighTwist', 'Bip_sandy_LThighTwist1'],
      axis: 'y',
      distribution: [0.5, 0.5],
      enabled: true,
    },
    {
      mainBone: 'Bip_sandy_R_Thigh',
      twistBones: ['Bip_sandy_RThighTwist', 'Bip_sandy_RThighTwist1'],
      axis: 'y',
      distribution: [0.5, 0.5],
      enabled: true,
    },
  ],
};

/**
 * Props for the RigDebugPanel component.
 */
export interface RigDebugPanelProps {
  skeletonMapping: SkeletonMapping | null;
  boneManipulations: Record<string, { x: number; y: number; z: number }>;
  onBoneManipulation: (boneName: string, axis: 'x' | 'y' | 'z', value: number) => void;
  onResetBone: (boneName: string) => void;
  onResetAllBones: () => void;
  onExportMapping: () => void;
  // Hierarchy config
  hierarchyConfig?: BoneHierarchyConfig;
  onHierarchyConfigChange?: (config: BoneHierarchyConfig) => void;
}
