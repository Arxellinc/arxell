/**
 * AvatarRenderer — unified Three.js renderer for all avatar view modes.
 *
 * Render modes (controlled by `renderMode` prop, switched live via ref):
 *   "normal"    — original GLB PBR materials + 3-point lighting rig
 *   "wireframe" — MeshBasicMaterial wireframe + CSS glow filter
 *   "hybrid"    — wireframe body + solid fill on face-region meshes
 *
 * Animation runs identically in all three modes; the loop doesn't know or
 * care which material set is active.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useVoiceStore } from "../../../store/voiceStore";
import type {
  AnimationParams,
  WireframeAppearance,
  SkeletonMapping,
  BoneInfo,
  BoneCategory,
  TwistChain,
  MorphTargetInfo,
  MorphCategory,
  AnimationInfo,
  BoneHierarchyConfig,
} from "./avatarTypes";
import { computeGlowFilter, DEFAULT_HIERARCHY_CONFIG } from "./avatarTypes";

// Helper to get CSS variable color as THREE.Color
function getCSSColor(varName: string, fallback: string): THREE.Color {
  if (typeof document === "undefined") return new THREE.Color(fallback);
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return new THREE.Color(value || fallback);
}

// Helper to get fill color - uses custom color if provided, otherwise falls back to app background
function getFillColor(customColor: string): THREE.Color {
  if (customColor && customColor.trim()) {
    return new THREE.Color(customColor);
  }
  return getCSSColor("--color-bg-dark", "#0a0a0a");
}

export type RenderMode = "normal" | "wireframe" | "hybrid";
export interface NormalRenderOptions {
  skin: boolean;
  eyes: boolean;
  teeth: boolean;
  hair: boolean;
  hideHair: boolean;
}

interface Props {
  src:          string;
  renderMode:   RenderMode;
  params:       AnimationParams;
  appearance:   WireframeAppearance;
  cameraOrbit:  string;
  cameraTarget: string;
  debugMorphs?: Record<string, number>;
  jawTest?:     number;
  boneManipulations?: Record<string, { x: number; y: number; z: number }>;
  showSkeletonHelper?: boolean;
  activeAnimationClip?: string | null;
  isAnimationPlaying?:  boolean;
  animationTime?:       number;
  hierarchyConfig?: BoneHierarchyConfig;
  meshProbeNonce?: number;
  normalRenderOptions?: NormalRenderOptions;
  onLoad?:      () => void;
  onError?:     () => void;
  onMorphNames?: (names: string[]) => void;
  onBoneMapping?: (mapping: BoneMapping) => void;
  onSkeletonMapping?: (mapping: SkeletonMapping) => void;
  onAnimationTimeChange?: (time: number, duration: number) => void;
  disableProcedural?: boolean;
  showStats?: boolean;
  /** Internal render scale multiplier. */
  renderScale?: 1 | 0.75 | 0.5;
  /** True when mounted in presentation/fullscreen layout. */
  presentationMode?: boolean;
}

const setSizeStats = {
  normal: 0,
  fullscreen: 0,
  lastLogAt: 0,
  lastLoggedNormal: 0,
  lastLoggedFullscreen: 0,
};

function trackSetSize(isFullscreen: boolean): void {
  if (isFullscreen) setSizeStats.fullscreen += 1;
  else setSizeStats.normal += 1;
  const now = performance.now();
  if (setSizeStats.lastLogAt === 0) {
    setSizeStats.lastLogAt = now;
    return;
  }
  const elapsedSec = (now - setSizeStats.lastLogAt) / 1000;
  if (elapsedSec < 3) return;
  const dNormal = setSizeStats.normal - setSizeStats.lastLoggedNormal;
  const dFullscreen = setSizeStats.fullscreen - setSizeStats.lastLoggedFullscreen;
  console.info(
    `[AvatarRenderer] setSize rate/sec normal=${(dNormal / elapsedSec).toFixed(2)} fullscreen=${(dFullscreen / elapsedSec).toFixed(2)} totals n=${setSizeStats.normal} f=${setSizeStats.fullscreen}`
  );
  setSizeStats.lastLogAt = now;
  setSizeStats.lastLoggedNormal = setSizeStats.normal;
  setSizeStats.lastLoggedFullscreen = setSizeStats.fullscreen;
}

// Bone mapping info passed to debug UI
export interface BoneMapping {
  hips: string | null;
  spine: string | null;
  chest: string | null;
  neck: string | null;
  head: string | null;
  jaw: string | null;
  leftUpperArm: string | null;
  rightUpperArm: string | null;
  leftForearm: string | null;
  rightForearm: string | null;
  leftHand: string | null;
  rightHand: string | null;
  allBones: string[];
  animationClipCount: number;
  animationClipNames: string[];
}

// ── Expression morph weights ──────────────────────────────────────────────────

const EXPRESSION_MORPHS: Record<string, Record<string, number>> = {
  neutral: {},
  happy: {
    mouthSmile: 0.8, mouthSmile_L: 0.8, mouthSmile_R: 0.8,
    cheekSquint_L: 0.35, cheekSquint_R: 0.35,
    eyeSquint_L: 0.25, eyeSquint_R: 0.25,
    browOuterUp_L: 0.15, browOuterUp_R: 0.15,
  },
  thinking: {
    browInnerUp: 0.5, browOuterUp_L: 0.2,
    eyeLookUpLeft: 0.3, eyeLookUpRight: 0.3,
    mouthPucker: 0.25, mouthLeft: 0.1,
  },
  focused: {
    browDown_L: 0.4, browDown_R: 0.4,
    browInnerUp: 0.25,
    eyeSquint_L: 0.2, eyeSquint_R: 0.2,
    mouthStretch_L: 0.1, mouthStretch_R: 0.1,
  },
};

const LIP_MORPHS = [
  // Standard ARKit / common names
  "jawOpen", "jaw_open", "Jaw_Open", "mouthOpen", "viseme_aa", "A",
  // 3ds Max / Character Creator morphs
  "PH_JAW_Fwd", "PH_A", "PH_O-U", "PH_B-P", "PH_D-S", "PH_V-F", "PH_I-E", "PH_CH-SH",
  "EM_Mouth_open", "EM_scream", "EM_Mouth_kiss", "EM_Mouth_Blow",
];

const JAW_FORWARD_MORPHS = ["PH_JAW_Fwd", "ph_jaw_fwd", "jawForward"];
const JAW_OPEN_COMPANIONS = ["EM_Mouth_open", "mouthOpen", "jawOpen", "jaw_open", "Jaw_Open"];
const PRIMARY_JAW_OPEN_MORPHS = ["EM_Mouth_open", "mouthOpen", "jawOpen", "jaw_open", "Jaw_Open"];
const GARMENT_DEFAULT_MORPHS: Record<string, number> = {
  Bra: 1,
  Pantys: 1,
};

type JawDriverConfig = {
  testWeight: number;
  speechWeightWithMorph: number;
  speechWeightNoMorph: number;
  morphWeight: number;
  meshRotWithMorph: number;
  meshRotNoMorph: number;
  testRotBoost: number;
  meshBackTiltFactor: number;
  dropFromTest: number;
  dropFromMorph: number;
  backFromDrop: number;
  boneRotFromTest: number;
  boneRotFromSpeech: number;
};

type JawDriverInput = {
  jawTest: number;
  jawAmp: number;
  morphOpen: number;
  hasJawOpenMorph: boolean;
};

type JawDriverState = {
  assist: number;
  meshRot: number;
  meshDrop: number;
  meshBack: number;
  boneRot: number;
};

const DEFAULT_JAW_DRIVER_CONFIG: JawDriverConfig = {
  testWeight: 1.15,
  speechWeightWithMorph: 0.35,
  speechWeightNoMorph: 0.8,
  morphWeight: 1.2,
  meshRotWithMorph: 0.2,
  meshRotNoMorph: 0.24,
  testRotBoost: 0.16,
  meshBackTiltFactor: 0.04,
  dropFromTest: 0.9,
  dropFromMorph: 0.18,
  backFromDrop: 0.06,
  boneRotFromTest: 0.44,
  boneRotFromSpeech: 0.22,
};

const CHARACTER_JAW_DRIVER_CONFIG: JawDriverConfig = {
  ...DEFAULT_JAW_DRIVER_CONFIG,
  // Character.glb needs stronger test response to visibly separate lower teeth.
  dropFromTest: 0.95,
  testRotBoost: 0.18,
  morphWeight: 1.35,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function maxMouthOpenFromMorphs(
  currentMorphs: Record<string, number>,
  debugMorphs?: Record<string, number>,
): number {
  const dbg = debugMorphs ?? {};
  return Math.max(
    currentMorphs["EM_Mouth_open"] ?? 0,
    currentMorphs["mouthOpen"] ?? 0,
    currentMorphs["jawOpen"] ?? 0,
    currentMorphs["jaw_open"] ?? 0,
    currentMorphs["Jaw_Open"] ?? 0,
    dbg["EM_Mouth_open"] ?? 0,
    dbg["mouthOpen"] ?? 0,
    dbg["jawOpen"] ?? 0,
    dbg["jaw_open"] ?? 0,
    dbg["Jaw_Open"] ?? 0,
  );
}

function computeJawDriverState(input: JawDriverInput, config: JawDriverConfig): JawDriverState {
  const jawTest = clamp01(input.jawTest);
  const jawAmp = clamp01(input.jawAmp);
  const morphOpen = clamp01(input.morphOpen);
  const speechWeight = input.hasJawOpenMorph ? config.speechWeightWithMorph : config.speechWeightNoMorph;
  const assist = Math.max(
    jawTest * config.testWeight,
    jawAmp * speechWeight,
    morphOpen * config.morphWeight,
  );
  const meshRotBase = input.hasJawOpenMorph ? config.meshRotWithMorph : config.meshRotNoMorph;
  const meshRot = assist * meshRotBase + jawTest * config.testRotBoost;
  const meshDrop = Math.max(jawTest * config.dropFromTest, morphOpen * config.dropFromMorph);
  const meshBack = meshDrop * config.backFromDrop;
  const boneRot = input.hasJawOpenMorph
    ? 0
    : Math.max(jawTest * config.boneRotFromTest, jawAmp * config.boneRotFromSpeech);
  return { assist, meshRot, meshDrop, meshBack, boneRot };
}

// Blink morph target names (common ARKit/blendshape names)
const BLINK_MORPHS = [
  // Standard names
  "eyeBlink_L", "eyeBlink_R", "blink_L", "blink_R",
  "eyeblinkleft", "eyeblinkright", "blinkleft", "blinkright",
  "eyesblinkleft", "eyesblinkright", "blink", "eyeblink",
  // 3ds Max / Character Creator morphs
  "EYE_close_R", "EYE_close_L", "EM_Eyes_shut",
];

// Eye movement morph targets
const EYE_LOOK_MORPHS = {
  left: ["eyeLookLeft_L", "eyeLookLeft_R", "eyelookleft", "eyeslookleft", "EYE_L_Lt"],
  right: ["eyeLookRight_L", "eyeLookRight_R", "eyelookright", "eyeslookright", "EYE_R_Rt"],
  up: ["eyeLookUp_L", "eyeLookUp_R", "eyelookup", "eyeslookup", "EYE_L_Up", "EYE_R_Up"],
  down: ["eyeLookDown_L", "eyeLookDown_R", "eyelookdown", "eyeslookdown", "EYE_L_Dw", "EYE_R_Dw"],
};

function visemeShapeStrength(phoneme: string | null | undefined): number {
  if (!phoneme || phoneme === "SIL" || phoneme === "SP") return 0;
  const ph = phoneme.toUpperCase();
  if (["AA", "AE", "AH", "AO", "AW"].includes(ph)) return 1.0;   // open vowels
  if (["OW", "OY", "UH", "UW", "W"].includes(ph)) return 0.95;   // rounded/back
  if (["AY", "EH", "ER", "EY", "IH", "IY", "Y"].includes(ph)) return 0.88; // front vowels
  if (["B", "P", "M"].includes(ph)) return 0.68;                 // lip closure
  if (["F", "V"].includes(ph)) return 0.76;                      // labiodental
  if (["CH", "JH", "SH", "ZH"].includes(ph)) return 0.74;        // postalveolar
  if (["S", "Z", "TH", "DH", "T", "D", "N", "L", "R"].includes(ph)) return 0.60;
  if (["K", "G", "NG", "HH"].includes(ph)) return 0.56;
  return 0.62;
}

type PhonemeFamily =
  | "silence"
  | "open-vowel"
  | "front-vowel"
  | "rounded-vowel"
  | "bilabial"
  | "labiodental"
  | "dental-alveolar"
  | "postalveolar"
  | "velar-glottal"
  | "other";

function phonemeFamily(phoneme: string | null | undefined): PhonemeFamily {
  if (!phoneme) return "silence";
  const ph = phoneme.toUpperCase();
  if (ph === "SIL" || ph === "SP") return "silence";
  if (["AA", "AE", "AH", "AO", "AW"].includes(ph)) return "open-vowel";
  if (["AY", "EH", "ER", "EY", "IH", "IY", "Y"].includes(ph)) return "front-vowel";
  if (["OW", "OY", "UH", "UW", "W"].includes(ph)) return "rounded-vowel";
  if (["B", "P", "M"].includes(ph)) return "bilabial";
  if (["F", "V"].includes(ph)) return "labiodental";
  if (["S", "Z", "TH", "DH", "T", "D", "N", "L", "R"].includes(ph)) return "dental-alveolar";
  if (["CH", "JH", "SH", "ZH"].includes(ph)) return "postalveolar";
  if (["K", "G", "NG", "HH"].includes(ph)) return "velar-glottal";
  return "other";
}

function visemeDynamicsForFamily(fam: PhonemeFamily): { attack: number; release: number; gain: number } {
  switch (fam) {
    case "bilabial":
      return { attack: 0.8, release: 0.44, gain: 1.08 };
    case "labiodental":
      return { attack: 0.72, release: 0.38, gain: 0.96 };
    case "dental-alveolar":
      return { attack: 0.68, release: 0.36, gain: 0.9 };
    case "postalveolar":
      return { attack: 0.74, release: 0.38, gain: 0.98 };
    case "open-vowel":
      return { attack: 0.62, release: 0.3, gain: 1.03 };
    case "rounded-vowel":
      return { attack: 0.6, release: 0.3, gain: 1.0 };
    case "front-vowel":
      return { attack: 0.58, release: 0.28, gain: 0.95 };
    case "velar-glottal":
      return { attack: 0.6, release: 0.32, gain: 0.84 };
    case "silence":
      return { attack: 0.4, release: 0.3, gain: 0.0 };
    default:
      return { attack: 0.62, release: 0.32, gain: 0.9 };
  }
}

// ── Filtered Skeleton Helper ─────────────────────────────────────────────────────
/**
 * Creates a skeleton helper that filters out auxiliary bones from3ds Max exports.
 * This prevents visual clutter from helper bones, nub bones, and twist bones
 * that create confusing connections in the skeleton view.
 *
 * Features:
 * - Filters out helper/nub/twist/corrective bones
 * - Connects bones through filtered ancestors to maintain visual hierarchy
 * - Displays bone names as labels at each bone position
 */
class FilteredSkeletonHelper extends THREE.Group {
  private bones: THREE.Bone[] = [];
  private boneSet: Set<THREE.Bone> = new Set();
  private lineSegments: THREE.LineSegments;
  private labelSprites: THREE.Sprite[] = [];
  private boneToFilteredAncestor: Map<THREE.Bone, THREE.Bone | null> = new Map();
  
  constructor(object: THREE.Object3D, options: {
    excludeHelpers?: boolean;
    excludeNubs?: boolean;
    excludeTwist?: boolean;
    excludeCorrective?: boolean;
    showLabels?: boolean;
  } = {}, debugInfo?: { included: string[]; excluded: string[] }) {
    super();
    
    const {
      excludeHelpers = true,
      excludeNubs = true,
      excludeTwist = false,
      excludeCorrective = true,
      showLabels = true,
    } = options;
    
    // Collect bones to include
    const bonesToInclude: THREE.Bone[] = [];
    
    object.traverse((node) => {
      if (node instanceof THREE.Bone) {
        const name = node.name.toLowerCase();
        
        // Skip helper bones (3ds Max helpers, point helpers, IK targets, etc.)
        if (excludeHelpers && (
          name.includes("helper") ||
          name.includes("point") ||
          name.includes("dummy") ||
          name.includes("effector") ||
          name.includes("locator") ||
          name.includes("null") ||
          name.includes("ik") ||
          name.includes("target") ||
          name.includes("pivot") ||
          name.includes("aux") ||
          name.includes("auxiliary") ||
          // 3ds Max specific: bones that start with "Bone" followed by numbers (auto-generated)
          /^bone\d+$/.test(name) ||
          // Common3ds Max helper patterns
          name.startsWith("helper") ||
          name.startsWith("point") ||
          name.startsWith("dummy")
        )) {
          if (debugInfo) debugInfo.excluded.push(node.name);
          return;
        }
        
        // Skip nub bones (end effectors with no children or only nub children)
        // BUT keep finger tip bones - they're important for hand visualization
        const isFingerTip = /finger.*tip|thumb.*tip|index.*tip|middle.*tip|ring.*tip|pinky.*tip|little.*tip/.test(name);
        if (excludeNubs && !isFingerTip && (
          name.includes("nub") ||
          name.endsWith("nub") ||
          name.endsWith("_end") ||
          name.endsWith("_nub") ||
          // Don't exclude "end" by itself as it might be part of "forearm" etc.
          // But do exclude common end-effector patterns
          name.endsWith("end") ||
          name.endsWith("effector")
        )) {
          if (debugInfo) debugInfo.excluded.push(node.name);
          return;
        }
        
        // Skip twist bones (optional)
        if (excludeTwist && (
          name.includes("twist") ||
          /upper.*arm.*twist|lower.*arm.*twist|upper.*leg.*twist|lower.*leg.*twist/.test(name)
        )) {
          if (debugInfo) debugInfo.excluded.push(node.name);
          return;
        }
        
        // Skip corrective bones
        if (excludeCorrective && (
          name.includes("corrective") ||
          name.includes("correct") ||
          name.includes("fix")
        )) {
          if (debugInfo) debugInfo.excluded.push(node.name);
          return;
        }
        
        this.boneSet.add(node);
        bonesToInclude.push(node);
        if (debugInfo) debugInfo.included.push(node.name);
      }
    });
    
    this.bones = bonesToInclude;
    
    // Build map of each bone to its nearest included ancestor
    for (const bone of this.bones) {
      this.boneToFilteredAncestor.set(bone, this.findNearestIncludedAncestor(bone));
    }
    
    // Create geometry for bone connections
    const geometry = new THREE.BufferGeometry();
    const maxVertices = bonesToInclude.length * 6; // Each bone can have up to 2 lines (to parent and from parent)
    const positions = new Float32Array(maxVertices * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.8,
    });
    
    // Add vertex colors
    const colors = new Float32Array(maxVertices * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    this.lineSegments = new THREE.LineSegments(geometry, material);
    this.add(this.lineSegments);
    
    // Create bone labels
    if (showLabels) {
      this.createLabels();
    }
    
    // Set initial positions
    this.update();
  }
  
  /**
   * Find the nearest ancestor that is included in our filtered set.
   * This allows us to draw connections through excluded intermediate bones.
   */
  private findNearestIncludedAncestor(bone: THREE.Bone): THREE.Bone | null {
    let current: THREE.Object3D | null = bone.parent;
    while (current) {
      if (current instanceof THREE.Bone && this.boneSet.has(current)) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }
  
  /**
   * Create text sprites for bone labels.
   */
  private createLabels(): void {
    for (const bone of this.bones) {
      const sprite = this.createBoneLabel(bone.name);
      this.labelSprites.push(sprite);
      this.add(sprite);
    }
  }
  
  /**
   * Create a single bone label sprite.
   */
  private createBoneLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      return new THREE.Sprite(new THREE.SpriteMaterial());
    }
    
    // Measure text to size canvas appropriately - no truncation
    context.font = '9px monospace';
    const textWidth = context.measureText(text).width;
    const padding = 6;
    canvas.width = Math.ceil(textWidth + padding * 2);
    canvas.height = 14;
    
    // Clear canvas
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw subtle text background for better readability
    context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    const radius = 3;
    context.beginPath();
    context.moveTo(radius, 0);
    context.lineTo(canvas.width - radius, 0);
    context.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
    context.lineTo(canvas.width, canvas.height - radius);
    context.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height);
    context.lineTo(radius, canvas.height);
    context.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius);
    context.lineTo(0, radius);
    context.quadraticCurveTo(0, 0, radius, 0);
    context.closePath();
    context.fill();
    
    // Draw text - smaller font, full text
    context.font = '9px monospace';
    context.fillStyle = 'rgba(180, 230, 255, 0.95)';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    
    // Create texture
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    
    // Create sprite material
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    
    const sprite = new THREE.Sprite(material);
    // Scale based on canvas size - smaller labels for less visual clutter
    const baseHeight = 0.008;  // Even smaller base height
    const aspectRatio = canvas.width / canvas.height;
    sprite.scale.set(baseHeight * aspectRatio, baseHeight, 1);
    sprite.userData.boneName = text;
    
    return sprite;
  }
  
  /**
   * Get a color for a bone based on its category.
   */
  private getBoneColor(bone: THREE.Bone): { r: number; g: number; b: number } {
    const name = bone.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    
    // Spine/pelvis - green
    if (name.includes('hip') || name.includes('pelvis') || name.includes('spine') || name.includes('chest')) {
      return { r: 0.2, g: 0.8, b: 0.2 };
    }
    // Head/neck - purple
    if (name.includes('head') || name.includes('neck') || name.includes('jaw')) {
      return { r: 0.7, g: 0.3, b: 0.9 };
    }
    
    // Improved hand bone detection for coloring
    const isLeftSide = name.includes('left') || name.includes('_l') || name.endsWith('l');
    const isRightSide = name.includes('right') || name.includes('_r') || name.endsWith('r');
    const isHandBone = name.includes('hand') || name.includes('finger') || name.includes('thumb') ||
                       name.includes('palm') || name.includes('wrist') ||
                       /index|middle|ring|pinky|little/.test(name);
    const isArmBone = name.includes('arm') || name.includes('shoulder') || name.includes('forearm');
    
    // Left arm/hand - blue
    if (isLeftSide && (isArmBone || isHandBone)) {
      return { r: 0.3, g: 0.5, b: 1.0 };
    }
    // Right arm/hand - cyan
    if (isRightSide && (isArmBone || isHandBone)) {
      return { r: 0.0, g: 0.8, b: 1.0 };
    }
    // Left leg - yellow
    if (isLeftSide &&
        (name.includes('leg') || name.includes('thigh') || name.includes('knee') || name.includes('calf') || name.includes('foot') || name.includes('toe'))) {
      return { r: 1.0, g: 0.8, b: 0.0 };
    }
    // Right leg - orange
    if (isRightSide &&
        (name.includes('leg') || name.includes('thigh') || name.includes('knee') || name.includes('calf') || name.includes('foot') || name.includes('toe'))) {
      return { r: 1.0, g: 0.5, b: 0.0 };
    }
    // Twist bones - red
    if (name.includes('twist')) {
      return { r: 1.0, g: 0.2, b: 0.2 };
    }
    // Default - white
    return { r: 0.8, g: 0.8, b: 0.8 };
  }
  
  update(): void {
    const positions = this.lineSegments.geometry.attributes.position.array as Float32Array;
    const colors = this.lineSegments.geometry.attributes.color.array as Float32Array;
    
    let vertexIndex = 0;
    
    for (const bone of this.bones) {
      // Find the nearest included ancestor (connects through filtered bones)
      const nearestAncestor = this.boneToFilteredAncestor.get(bone);
      
      if (nearestAncestor) {
        const parentPos = new THREE.Vector3();
        const childPos = new THREE.Vector3();
        
        nearestAncestor.getWorldPosition(parentPos);
        bone.getWorldPosition(childPos);
        
        // Start point (parent)
        positions[vertexIndex * 3] = parentPos.x;
        positions[vertexIndex * 3 + 1] = parentPos.y;
        positions[vertexIndex * 3 + 2] = parentPos.z;
        
        // Color for start (parent bone color)
        const parentColor = this.getBoneColor(nearestAncestor);
        colors[vertexIndex * 3] = parentColor.r * 0.6;
        colors[vertexIndex * 3 + 1] = parentColor.g * 0.6;
        colors[vertexIndex * 3 + 2] = parentColor.b * 0.6;
        vertexIndex++;
        
        // End point (child)
        positions[vertexIndex * 3] = childPos.x;
        positions[vertexIndex * 3 + 1] = childPos.y;
        positions[vertexIndex * 3 + 2] = childPos.z;
        
        // Color for end (child bone color)
        const childColor = this.getBoneColor(bone);
        colors[vertexIndex * 3] = childColor.r;
        colors[vertexIndex * 3 + 1] = childColor.g;
        colors[vertexIndex * 3 + 2] = childColor.b;
        vertexIndex++;
      }
    }
    
    // Clear remaining vertices
    for (let i = vertexIndex * 3; i < positions.length; i++) {
      positions[i] = 0;
      colors[i] = 0;
    }
    
    this.lineSegments.geometry.attributes.position.needsUpdate = true;
    this.lineSegments.geometry.attributes.color.needsUpdate = true;
    this.lineSegments.geometry.setDrawRange(0, vertexIndex);
    
    // Update label positions - place directly on bone
    for (let i = 0; i < this.bones.length && i < this.labelSprites.length; i++) {
      const bone = this.bones[i];
      const sprite = this.labelSprites[i];
      const pos = new THREE.Vector3();
      bone.getWorldPosition(pos);
      sprite.position.copy(pos);
      // No offset - label sits directly on the bone
    }
  }
  
  /**
   * Toggle label visibility.
   */
  setLabelsVisible(visible: boolean): void {
    for (const sprite of this.labelSprites) {
      sprite.visible = visible;
    }
  }
  
  /**
   * Get list of included bone names.
   */
  getBoneNames(): string[] {
    return this.bones.map(b => b.name);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseOrbit(orbit: string) {
  const p   = orbit.trim().split(/\s+/);
  const deg = (s: string) => parseFloat(s) * (Math.PI / 180);
  return {
    theta:     deg(p[0] ?? "0deg"),
    phi:       deg(p[1] ?? "78deg"),
    radiusPct: parseFloat(p[2] ?? "48%") / 100,
  };
}

function parseTarget(t: string) {
  const p = t.trim().split(/\s+/).map(parseFloat);
  return new THREE.Vector3(p[0] ?? 0, p[1] ?? 1.25, p[2] ?? 0);
}

function orbitToPosition(tgt: THREE.Vector3, radius: number, theta: number, phi: number) {
  return new THREE.Vector3(
    tgt.x + radius * Math.sin(phi) * Math.sin(theta),
    tgt.y + radius * Math.cos(phi),
    tgt.z + radius * Math.sin(phi) * Math.cos(theta),
  );
}

/** Case-insensitive substring bone search — strips non-alphanumeric chars. */
function findBone(root: THREE.Object3D, ...names: string[]): THREE.Bone | undefined {
  const lower = names.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ""));
  let found: THREE.Bone | undefined;
  root.traverse((node) => {
    if (found || !(node instanceof THREE.Bone)) return;
    const key = node.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (lower.some((n) => key.includes(n))) found = node;
  });
  return found;
}

function findJawBone(root: THREE.Object3D): THREE.Bone | undefined {
  const candidates: THREE.Bone[] = [];
  root.traverse((node) => {
    if (!(node instanceof THREE.Bone)) return;
    const key = node.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!key.includes("jaw") && !key.includes("chin") && !key.includes("mandible")) return;
    // Exclude facial control/manipulator bones that do not deform skinned geometry.
    if (key.includes("slider") || key.includes("manip") || key.includes("ctrl") || key.includes("helper")) return;
    candidates.push(node);
  });
  if (candidates.length > 0) return candidates[0];
  return findBone(root, "jaw", "chin", "mandible");
}

const FACE_KEYWORDS = [
  "head", "face", "eye", "eyebrow", "eyelash", "eyelid",
  "teeth", "tooth", "tongue", "mouth", "lip", "nose",
  "ear", "skull", "jaw", "cheek", "brow", "iris", "pupil",
];

const EYE_KEYWORDS = [
  "eye", "iris", "pupil", "eyeball", "sclera",
];

const LIP_KEYWORDS = [
  "lip", "lips", "mouth", "tongue", "jaw",
];

type SkinCategory = "body" | "eye" | "mouth" | "jaw" | "teeth" | "tongue" | "hair" | "dress";

const TONGUE_KEYWORDS = ["tongue"];
const HAIR_KEYWORDS = ["hair", "brow", "eyebrow", "lash", "eyelash", "beard", "mustache", "moustache"];
const DRESS_KEYWORDS = ["dress", "gown", "skirt", "fabric", "cloth", "outfit"];
const MOUTH_KEYWORDS = ["mouth", "lip", "jaw", "teeth", "tooth", "gums"];
const JAW_KEYWORDS = ["jaw"];
const TEETH_KEYWORDS = ["teeth", "tooth", "incisor", "molar", "canine"];

function classifySkinCategory(name: string): SkinCategory {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (TONGUE_KEYWORDS.some((k) => key.includes(k))) return "tongue";
  if (HAIR_KEYWORDS.some((k) => key.includes(k))) return "hair";
  if (DRESS_KEYWORDS.some((k) => key.includes(k))) return "dress";
  if (EYE_KEYWORDS.some((k) => key.includes(k))) return "eye";
  if (TEETH_KEYWORDS.some((k) => key.includes(k))) return "teeth";
  if (JAW_KEYWORDS.some((k) => key.includes(k))) return "jaw";
  if (MOUTH_KEYWORDS.some((k) => key.includes(k))) return "mouth";
  return "body";
}

function isFaceMeshByName(name: string): boolean {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return FACE_KEYWORDS.some((k) => key.includes(k));
}

function isEyeMeshByName(name: string): boolean {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return EYE_KEYWORDS.some((k) => key.includes(k));
}

function isLipMeshByName(name: string): boolean {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return LIP_KEYWORDS.some((k) => key.includes(k));
}

// ── Bone Classification Helpers ────────────────────────────────────────────────

/**
 * Classify a bone into a category based on its name.
 */
function classifyBone(name: string): BoneCategory {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  
  // Check for twist bones first (highest priority)
  if (key.includes("twist") || key.includes("twistcorrective") ||
      /upper.*arm.*twist|lower.*arm.*twist|upper.*leg.*twist|lower.*leg.*twist/.test(key)) {
    return "twist";
  }
  
  // Check for corrective bones
  if (key.includes("corrective") || key.includes("correct") || key.includes("fix")) {
    return "other"; // Will be marked as corrective separately
  }
  
  // Spine chain
  if (key.includes("hip") || key.includes("pelvis") || key.includes("root")) return "spine";
  if (key.includes("spine") || key.includes("torso")) return "spine";
  if (key.includes("chest") || key.includes("breast")) return "spine";
  
  // Head/face
  if (key.includes("head") || key.includes("skull")) return "head";
  if (key.includes("neck")) return "head";
  if (key.includes("jaw") || key.includes("chin")) return "face";
  if (key.includes("eye") || key.includes("brow") || key.includes("lid") || key.includes("lash")) return "face";
  if (key.includes("mouth") || key.includes("lip") || key.includes("tongue") || key.includes("teeth")) return "face";
  if (key.includes("cheek") || key.includes("nose") || key.includes("ear")) return "face";
  
  // Left arm
  if ((key.includes("left") || key.includes("_l") || key.endsWith("l")) &&
      (key.includes("shoulder") || key.includes("clavicle") || key.includes("arm") ||
       key.includes("forearm") || key.includes("elbow"))) {
    return "arm-left";
  }
  
  // Right arm
  if ((key.includes("right") || key.includes("_r") || key.endsWith("r")) &&
      (key.includes("shoulder") || key.includes("clavicle") || key.includes("arm") ||
       key.includes("forearm") || key.includes("elbow"))) {
    return "arm-right";
  }
  
  // Left hand - improved detection for various finger naming conventions
  // Matches: hand_l, finger_l, thumb_l, index_l, middle_l, ring_l, pinky_l, etc.
  // Also matches numbered joints: index1_l, middle2_l, etc.
  const isLeftHand = key.includes("left") || key.includes("_l") || key.endsWith("l");
  const isHandBone = key.includes("hand") || key.includes("finger") || key.includes("thumb") ||
                     key.includes("palm") || key.includes("wrist") ||
                     /index|middle|ring|pinky|little/.test(key) ||
                     /finger\d|finger\d|thumb\d/.test(key);
  if (isLeftHand && isHandBone) {
    return "hand-left";
  }
  
  // Right hand - improved detection
  const isRightHand = key.includes("right") || key.includes("_r") || key.endsWith("r");
  if (isRightHand && isHandBone) {
    return "hand-right";
  }
  
  // Left leg
  if ((key.includes("left") || key.includes("_l") || key.endsWith("l")) &&
      (key.includes("leg") || key.includes("thigh") || key.includes("knee") ||
       key.includes("calf") || key.includes("shin") || key.includes("foot") || key.includes("toe"))) {
    return "leg-left";
  }
  
  // Right leg
  if ((key.includes("right") || key.includes("_r") || key.endsWith("r")) &&
      (key.includes("leg") || key.includes("thigh") || key.includes("knee") ||
       key.includes("calf") || key.includes("shin") || key.includes("foot") || key.includes("toe"))) {
    return "leg-right";
  }
  
  return "other";
}

/**
 * Check if a bone name indicates a twist bone.
 */
function isTwistBone(name: string): boolean {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return key.includes("twist") ||
         /upper.*arm.*twist|lower.*arm.*twist|upper.*leg.*twist|lower.*leg.*twist/.test(key);
}

/**
 * Check if a bone name indicates a corrective bone.
 */
function isCorrectiveBone(name: string): boolean {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return key.includes("corrective") || key.includes("correct") || key.includes("fix");
}

/**
 * Determine the primary twist axis for a twist bone based on naming patterns.
 */
function getTwistAxis(name: string): 'x' | 'y' | 'z' | null {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  
  // Arm twist bones typically twist around Y (longitudinal)
  if (key.includes("arm") && key.includes("twist")) return 'y';
  if (key.includes("forearm") && key.includes("twist")) return 'y';
  
  // Leg twist bones typically twist around Y
  if (key.includes("leg") && key.includes("twist")) return 'y';
  if (key.includes("thigh") && key.includes("twist")) return 'y';
  if (key.includes("calf") && key.includes("twist")) return 'y';
  
  // Default to Y for unknown twist bones
  if (key.includes("twist")) return 'y';
  
  return null;
}

/**
 * Get suggested rotation limits for a bone based on its category.
 * Returns limits in radians.
 */
function getSuggestedLimits(category: BoneCategory): {
  x: { min: number; max: number };
  y: { min: number; max: number };
  z: { min: number; max: number };
} {
  const PI = Math.PI;
  
  switch (category) {
    case 'spine':
      return {
        x: { min: -PI / 6, max: PI / 6 },
        y: { min: -PI / 4, max: PI / 4 },
        z: { min: -PI / 8, max: PI / 8 },
      };
    case 'head':
      return {
        x: { min: -PI / 3, max: PI / 3 },
        y: { min: -PI / 2, max: PI / 2 },
        z: { min: -PI / 6, max: PI / 6 },
      };
    case 'face':
      return {
        x: { min: -PI / 12, max: PI / 12 },
        y: { min: -PI / 12, max: PI / 12 },
        z: { min: -PI / 12, max: PI / 12 },
      };
    case 'arm-left':
    case 'arm-right':
      return {
        x: { min: -PI, max: PI },
        y: { min: -PI, max: PI },
        z: { min: -PI / 2, max: PI / 2 },
      };
    case 'hand-left':
    case 'hand-right':
      return {
        x: { min: -PI / 2, max: PI / 2 },
        y: { min: -PI / 2, max: PI / 2 },
        z: { min: -PI / 2, max: PI / 2 },
      };
    case 'leg-left':
    case 'leg-right':
      return {
        x: { min: -PI / 2, max: PI / 2 },
        y: { min: -PI / 4, max: PI / 4 },
        z: { min: -PI / 6, max: PI / 6 },
      };
    case 'twist':
      // Twist bones should have very limited direct manipulation
      return {
        x: { min: -PI / 12, max: PI / 12 },
        y: { min: -PI / 6, max: PI / 6 },
        z: { min: -PI / 12, max: PI / 12 },
      };
    default:
      return {
        x: { min: -PI, max: PI },
        y: { min: -PI, max: PI },
        z: { min: -PI, max: PI },
      };
  }
}

/**
 * Classify a morph target into a category.
 */
function classifyMorph(name: string): MorphCategory {
  // Use original name for prefix matching (preserves underscore structure like PH_A).
  const orig = name.toLowerCase();
  // Stripped key (no non-alphanumeric) for suffix/word matching.
  const key  = orig.replace(/[^a-z0-9]/g, "");

  // 3ds Max PH_ prefix morphs — these are ALL mouth/viseme shapes.
  // Match before stripping so "ph_a", "ph_o-u", "ph_b-p", "ph_jaw_fwd", etc. are caught.
  if (/^ph_/.test(orig)) {
    // Jaw-forward is a jaw morph, not a phoneme viseme.
    if (/jaw/.test(orig)) return "jaw";
    return "viseme";
  }

  // 3ds Max EM_ emotion morphs — map to expression.
  if (/^em_/.test(orig)) return "expression";

  // 3ds Max EYE_ morphs — map to eye.
  if (/^eye_/.test(orig)) return "eye";

  // Viseme/mouth shapes (stripped key is safe for these patterns).
  if (/viseme|jawopen|mouthopen|moutha|moutho|mouthu/.test(key)) return "viseme";

  // Expressions
  if (/smile|frown|angry|sad|happy|surprise|fear|disgust|expression/.test(key)) return "expression";

  // Eye-related
  if (/eye|blink|wink|squint|look|gaze|pupil|iris/.test(key)) return "eye";

  // Eyebrow-related
  if (/brow|eyebrow/.test(key)) return "brow";

  // Cheek-related
  if (/cheek|blush/.test(key)) return "cheek";

  // Jaw-related
  if (/jaw|chin/.test(key)) return "jaw";

  return "other";
}

/**
 * Get the side suffix for a bone name (e.g., "_l", "_r", "left", "right").
 * Returns empty string if no side suffix is found.
 */
function getBoneSide(name: string): string {
  const key = name.toLowerCase();
  if (key.endsWith('_l') || key.endsWith('l') && /forearm|arm|hand|leg|foot/.test(key.slice(0, -1))) return '_l';
  if (key.endsWith('_r') || key.endsWith('r') && /forearm|arm|hand|leg|foot/.test(key.slice(0, -1))) return '_r';
  if (key.includes('left')) return 'left';
  if (key.includes('right')) return 'right';
  return '';
}

/**
 * Check if two bones are on the same side of the body.
 */
function sameSide(bone1: string, bone2: string): boolean {
  const key1 = bone1.toLowerCase();
  const key2 = bone2.toLowerCase();

  // Use stricter side detection using explicit word or separator-bounded suffix
  // to avoid false-positives on bones whose names happen to end in 'l'/'r'
  // (e.g. "forearm", "calf", "uparmtwist" are not side-specific).
  const hasExplicitSide = (k: string) =>
    k.includes('left') || k.includes('right') ||
    /_l(\b|$)/.test(k) || /\.l(\b|$)/.test(k) || / l(\b|$)/.test(k) ||
    /_r(\b|$)/.test(k) || /\.r(\b|$)/.test(k) || / r(\b|$)/.test(k);

  const isLeft = (k: string) =>
    k.includes('left') ||
    /_l(\b|$)/.test(k) || /\.l(\b|$)/.test(k) || / l(\b|$)/.test(k);

  const isRight = (k: string) =>
    k.includes('right') ||
    /_r(\b|$)/.test(k) || /\.r(\b|$)/.test(k) || / r(\b|$)/.test(k);

  // If neither bone has an explicit side indicator, treat them as compatible
  if (!hasExplicitSide(key1) && !hasExplicitSide(key2)) return true;
  // If only one bone has a side indicator, still allow the match —
  // some rigs name twist bones without repeating the side suffix
  // (e.g. main bone "UpperArm_L", twist bone "UpArmTwist" with no suffix).
  if (!hasExplicitSide(key1) || !hasExplicitSide(key2)) return true;
  // Both have explicit sides — they must match
  if (isLeft(key1) && isLeft(key2)) return true;
  if (isRight(key1) && isRight(key2)) return true;
  return false;
}

/**
 * Extract the base name of a bone without side suffixes or numbers.
 * E.g., "leftforearm" -> "forearm", "foretwist1_l" -> "foretwist"
 */
function getBaseBoneName(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Remove side indicators
  let base = key.replace(/left|right|_l|_r/g, "");
  // Remove trailing numbers
  base = base.replace(/\d+$/, "");
  return base;
}

/**
 * Detect twist bone chains from a skeleton.
 * A twist chain is a main bone (e.g., upper arm) followed by twist bones
 * that should follow its rotation with distributed weights.
 *
 * If hierarchyConfig provides twistChainOverrides, those are used instead of auto-detection.
 */
function detectTwistChains(
  bones: Map<string, BoneInfo>,
  hierarchyConfig?: BoneHierarchyConfig
): TwistChain[] {
  // If we have manual twist chain overrides, use those
  if (hierarchyConfig?.twistChainOverrides && hierarchyConfig.twistChainOverrides.length > 0) {
    return hierarchyConfig.twistChainOverrides
      .filter(chain => chain.enabled)
      .map(chain => ({
        mainBone: chain.mainBone,
        twistBones: [...chain.twistBones],
        axis: chain.axis,
        distribution: chain.distribution.length > 0
          ? [...chain.distribution]
          : chain.twistBones.map(() => 1 / chain.twistBones.length),
      }));
  }
  
  // Otherwise, auto-detect twist chains
  const chains: TwistChain[] = [];

  const allBoneNames = [...bones.keys()];
  const allBoneNamesClean = allBoneNames.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, ""));

  // Collect all twist bones up front
  const allTwistBones: string[] = [];
  for (const [name] of bones) {
    if (isTwistBone(name)) {
      allTwistBones.push(name);
    }
  }

  // Define main bone patterns and their associated twist bone prefixes.
  // Keys are checked via .includes() against the cleaned bone name, so "uparm"
  // matches both "UpperArm_L" (cleaned: "upperarml") and "UpArm_L" (cleaned: "uparml").
  const mainBonePatterns: Map<string, string[]> = new Map([
    // Upper arm — also handles short names like "UpArm_L"
    ["uparm",   ["uparmtwist", "upperarmtwist", "upperarmetwist", "armtwist"]],
    // Forearm
    ["forearm", ["foretwist", "forearmtwist", "lowarmtwist", "lowerarmtwist"]],
    // Thigh / upper leg
    ["thigh",   ["thightwist", "uplegtwist", "upperlegtwist"]],
    // Calf / lower leg
    ["calf",    ["calftwist", "lowlegtwist", "lowerlegtwist", "legtwist"]],
  ]);

  // For each main bone pattern, find matching main bones and their twist bones
  for (const [mainPattern, twistPrefixes] of mainBonePatterns) {
    // Find all main bones matching this pattern
    for (const [mainBoneName, mainBoneInfo] of bones) {
      const mainKey = mainBoneName.toLowerCase().replace(/[^a-z0-9]/g, "");

      // Skip if this is a twist bone
      if (mainKey.includes("twist")) continue;

      // Check if this bone matches the main pattern
      if (!mainKey.includes(mainPattern)) continue;

      // Find twist bones that should follow this main bone
      const twistBones: string[] = [];
      
      for (const twistBoneName of allTwistBones) {
        const twistKey = twistBoneName.toLowerCase().replace(/[^a-z0-9]/g, "");
        
        // Must be on the same side of the body
        if (!sameSide(mainBoneName, twistBoneName)) continue;
        
        // Check if twist bone matches any of the expected prefixes for this main bone
        const matchesPrefix = twistPrefixes.some(prefix => {
          const prefixClean = prefix.toLowerCase().replace(/[^a-z0-9]/g, "");
          return twistKey.includes(prefixClean) || twistKey.startsWith(prefixClean.slice(0, 4));
        });
        
        if (matchesPrefix) {
          twistBones.push(twistBoneName);
          continue;
        }
        
        // Also check if twist bone is a direct child of the main bone
        if (mainBoneInfo.children.includes(twistBoneName)) {
          twistBones.push(twistBoneName);
          continue;
        }
        
        // Check if twist bone is a descendant (child of child, etc.)
        const isDescendant = (parentName: string, targetName: string, depth: number = 0): boolean => {
          if (depth > 3) return false; // Limit recursion depth
          const parent = bones.get(parentName);
          if (!parent) return false;
          for (const child of parent.children) {
            if (child === targetName) return true;
            if (isDescendant(child, targetName, depth + 1)) return true;
          }
          return false;
        };
        
        if (isDescendant(mainBoneName, twistBoneName)) {
          twistBones.push(twistBoneName);
        }
      }
      
      if (twistBones.length > 0) {
        // Remove duplicates and sort
        const uniqueTwistBones = [...new Set(twistBones)].sort();
        
        // Calculate distribution weights (equal distribution for now)
        const distribution = uniqueTwistBones.map(() => 1 / uniqueTwistBones.length);
        
        chains.push({
          mainBone: mainBoneName,
          twistBones: uniqueTwistBones,
          axis: getTwistAxis(mainBoneName) || 'y',
          distribution,
        });
      }
    }
  }
  
  return chains;
}

/**
 * Build a comprehensive SkeletonMapping from a loaded GLTF scene.
 * Optionally applies parent overrides from hierarchy config.
 */
function buildSkeletonMapping(
  scene: THREE.Object3D,
  animations: THREE.AnimationClip[],
  hierarchyConfig?: BoneHierarchyConfig
): SkeletonMapping {
  const bones = new Map<string, BoneInfo>();
  const boneList: string[] = [];
  const rootBones: string[] = [];
  
  // Build a map of parent overrides for quick lookup
  const parentOverrideMap = new Map<string, string | null>();
  if (hierarchyConfig?.parentOverrides) {
    for (const override of hierarchyConfig.parentOverrides) {
      parentOverrideMap.set(override.boneName, override.overrideParent);
    }
  }
  
  // First pass: collect all bones with their basic info
  scene.traverse((node) => {
    if (node instanceof THREE.Bone) {
      const category = classifyBone(node.name);
      const isTwist = isTwistBone(node.name);
      const isCorrective = isCorrectiveBone(node.name);
      
      const worldPos = new THREE.Vector3();
      node.getWorldPosition(worldPos);
      
      // Apply parent override if configured
      let effectiveParent = node.parent instanceof THREE.Bone ? node.parent.name : null;
      if (parentOverrideMap.has(node.name)) {
        effectiveParent = parentOverrideMap.get(node.name) ?? null;
      }
      
      const boneInfo: BoneInfo = {
        name: node.name,
        parent: effectiveParent,
        children: [], // Will be filled in second pass
        depth: 0, // Will be calculated in second pass
        initialRotation: {
          x: node.rotation.x,
          y: node.rotation.y,
          z: node.rotation.z,
        },
        initialQuaternion: {
          x: node.quaternion.x,
          y: node.quaternion.y,
          z: node.quaternion.z,
          w: node.quaternion.w,
        },
        worldPosition: {
          x: worldPos.x,
          y: worldPos.y,
          z: worldPos.z,
        },
        isTwistBone: isTwist,
        twistAxis: isTwist ? getTwistAxis(node.name) : null,
        isCorrective,
        suggestedLimits: getSuggestedLimits(category),
        category,
      };
      
      bones.set(node.name, boneInfo);
      boneList.push(node.name);
      
      // A bone is a root if its effective parent is null
      if (!effectiveParent) {
        rootBones.push(node.name);
      }
    }
  });
  
  // Second pass: fill in children based on effective parents
  const calculateDepth = (boneName: string, depth: number): void => {
    const bone = bones.get(boneName);
    if (!bone) return;
    
    bone.depth = depth;
    
    // Find children - bones that have this bone as their effective parent
    bones.forEach((childBone) => {
      if (childBone.parent === boneName) {
        bone.children.push(childBone.name);
        calculateDepth(childBone.name, depth + 1);
      }
    });
  };
  
  rootBones.forEach((rootName) => calculateDepth(rootName, 0));
  
  // Detect twist chains (optionally with overrides)
  const twistChains = detectTwistChains(bones, hierarchyConfig);
  
  // Count twist and corrective bones
  let twistBoneCount = 0;
  let correctiveBoneCount = 0;
  bones.forEach((bone) => {
    if (bone.isTwistBone) twistBoneCount++;
    if (bone.isCorrective) correctiveBoneCount++;
  });
  
  // Collect morph targets
  const morphTargets: MorphTargetInfo[] = [];
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh && node.morphTargetDictionary) {
      const meshName = node.name;
      for (const [morphName, index] of Object.entries(node.morphTargetDictionary)) {
        morphTargets.push({
          name: morphName,
          meshName,
          index: index as number,
          category: classifyMorph(morphName),
        });
      }
    }
  });
  
  // Collect animation info
  const animationInfos: AnimationInfo[] = animations.map((clip) => ({
    name: clip.name || "unnamed",
    duration: clip.duration,
    trackCount: clip.tracks.length,
    trackNames: clip.tracks.map((t) => t.name),
  }));
  
  return {
    bones,
    boneList,
    rootBones,
    twistChains,
    totalBones: boneList.length,
    twistBoneCount,
    correctiveBoneCount,
    morphTargets,
    animations: animationInfos,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AvatarRenderer({
  src, renderMode, params, appearance,
  cameraOrbit, cameraTarget,
  debugMorphs, jawTest, boneManipulations,
  showSkeletonHelper, activeAnimationClip, isAnimationPlaying, animationTime,
  hierarchyConfig,
  meshProbeNonce = 0,
  normalRenderOptions = { skin: true, eyes: true, teeth: true, hair: true, hideHair: false },
  onLoad, onError, onMorphNames, onBoneMapping, onSkeletonMapping, onAnimationTimeChange,
  disableProcedural,
  showStats = true,
  renderScale = 1,
  presentationMode = false,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const commitCountRef = useRef(0);
  useEffect(() => {
    commitCountRef.current += 1;
  });

  // All live-updating props go through refs so the Three.js loop never needs
  // to restart when a prop changes — only `src` triggers a full remount.
  const renderModeRef  = useRef(renderMode);
  const paramsRef      = useRef(params);
  const appearanceRef  = useRef(appearance);
  const orbitRef       = useRef(cameraOrbit);
  const targetRef      = useRef(cameraTarget);
  const debugMorphsRef = useRef(debugMorphs);
  const jawTestRef     = useRef(jawTest);
  const boneManipulationsRef = useRef(boneManipulations);
  const showSkeletonHelperRef    = useRef(showSkeletonHelper ?? false);
  const activeAnimationClipRef   = useRef(activeAnimationClip ?? null);
  const isAnimationPlayingRef    = useRef(isAnimationPlaying ?? false);
  const animationTimeRef         = useRef(animationTime ?? 0);
  const onAnimationTimeChangeRef = useRef(onAnimationTimeChange);
  const disableProceduralRef     = useRef(disableProcedural ?? false);
  const showStatsRef             = useRef(showStats);
  const hierarchyConfigRef       = useRef(hierarchyConfig ?? DEFAULT_HIERARCHY_CONFIG);
  const meshProbeNonceRef        = useRef(meshProbeNonce);
  const normalRenderOptionsRef   = useRef(normalRenderOptions);
  const renderScaleRef           = useRef(renderScale);
  renderModeRef.current  = renderMode;
  paramsRef.current      = params;
  appearanceRef.current  = appearance;
  orbitRef.current       = cameraOrbit;
  targetRef.current      = cameraTarget;
  debugMorphsRef.current = debugMorphs;
  jawTestRef.current     = jawTest;
  boneManipulationsRef.current       = boneManipulations;
  showSkeletonHelperRef.current      = showSkeletonHelper ?? false;
  activeAnimationClipRef.current     = activeAnimationClip ?? null;
  isAnimationPlayingRef.current      = isAnimationPlaying ?? false;
  animationTimeRef.current           = animationTime ?? 0;
  onAnimationTimeChangeRef.current   = onAnimationTimeChange;
  disableProceduralRef.current       = disableProcedural ?? false;
  showStatsRef.current               = showStats;
  hierarchyConfigRef.current         = hierarchyConfig ?? DEFAULT_HIERARCHY_CONFIG;
  meshProbeNonceRef.current          = meshProbeNonce;
  normalRenderOptionsRef.current     = normalRenderOptions;
  renderScaleRef.current             = renderScale;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let cancelled  = false;
    let animId     = 0;
    let waitFrame  = 0;
    let cleanupFn: (() => void) | null = null;

    // Defer until the container has non-zero paint dimensions.
    const startSetup = () => {
      if (cancelled) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) {
        waitFrame = requestAnimationFrame(startSetup);
        return;
      }
      setup(w, h);
    };

    const setup = (initW: number, initH: number) => {
      // ── Renderer ───────────────────────────────────────────────────────────
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch (err) {
        console.error("[AvatarRenderer] WebGLRenderer init failed:", err);
        onError?.();
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * renderScaleRef.current);
      renderer.setClearColor(0x000000, 0);
      renderer.setSize(initW, initH);
      trackSetSize(presentationMode || !!document.fullscreenElement);
      // Enable physically correct lighting for normal mode PBR materials.
      renderer.toneMapping        = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.outputColorSpace   = THREE.SRGBColorSpace;
      mount.appendChild(renderer.domElement);

      // ── Scene ──────────────────────────────────────────────────────────────
      const scene  = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, initW / initH, 0.01, 100);

      // ── Lighting rig (3-point) — neutral for PBR, ignored by BasicMaterial ─
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
      const keyLight     = new THREE.DirectionalLight(0xfff4e0, 1.2);
      keyLight.position.set(2, 5, 3);
      const fillLight    = new THREE.DirectionalLight(0xe0f0ff, 0.4);
      fillLight.position.set(-2, 3, -1);
      const rimLight     = new THREE.DirectionalLight(0xffffff, 0.25);
      rimLight.position.set(0, 2, -4);
      scene.add(ambientLight, keyLight, fillLight, rimLight);

      // ── Wireframe / hybrid materials ───────────────────────────────────────
      const wireMat  = new THREE.MeshBasicMaterial({ color: 0x00ccff, wireframe: true });
      const wireEyeMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, side: THREE.FrontSide });
      const wireLipMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, side: THREE.FrontSide });
      const wireMouthMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, side: THREE.FrontSide });
      // Fill material uses the app's background color so the mesh beneath wireframe appears opaque
      const bgColor  = getCSSColor("--color-bg-dark", "#0a0a0a");
      const fillMat  = new THREE.MeshBasicMaterial({
        color: bgColor, transparent: true, opacity: 0.18, side: THREE.FrontSide,
      });
      // Normal-mode fallback material — consistent light steel-blue PBR finish used
      // in place of the GLB's own materials which are often near-black Blender defaults.
      const normalMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x8cb4cc),
        roughness: 0.55,
        metalness: 0.08,
      });
      const flatSkinMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color("#16E9F5"),
        roughness: 0.75,
        metalness: 0.02,
      });
      const flatEyeMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x1a88aa),
        roughness: 0.2,
        metalness: 0.0,
      });
      const flatMouthMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color("#0f4e64"),
        roughness: 0.45,
        metalness: 0.0,
      });
      const flatTeethMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xf8f3ec),
        roughness: 0.2,
        metalness: 0.0,
      });
      const flatHairMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color("#16E9F5"),
        roughness: 0.7,
        metalness: 0.0,
      });
      // Normal mode should use textures/materials bundled inside normal.glb.
      // External /avatar/skins/* overrides are disabled.
      const shouldLoadSkinAssets = false;
      const meshProbeMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x00ff66),
        side: THREE.DoubleSide,
      });
      const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      const textureLoader = new THREE.TextureLoader();
      const loadedSkinTextures = new Map<string, THREE.Texture>();
      const loadSkinTexture = (url: string, colorTexture = false): THREE.Texture => {
        const texture = textureLoader.load(url);
        texture.flipY = false; // GLTF UV convention
        texture.anisotropy = maxAnisotropy;
        texture.colorSpace = colorTexture ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
        loadedSkinTextures.set(url, texture);
        return texture;
      };
      const createProceduralHairTexture = (size = 1024): THREE.CanvasTexture => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          const fallback = document.createElement("canvas");
          fallback.width = 2;
          fallback.height = 2;
          const fctx = fallback.getContext("2d");
          if (fctx) {
            fctx.fillStyle = "#8a6a53";
            fctx.fillRect(0, 0, 2, 2);
          }
          const tex = new THREE.CanvasTexture(fallback);
          tex.flipY = false;
          tex.anisotropy = maxAnisotropy;
          tex.colorSpace = THREE.SRGBColorSpace;
          return tex;
        }

        let seed = 0x9e3779b9;
        const rand = () => {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return seed / 4294967296;
        };

        // Base hair tone with soft root-to-tip gradient.
        const baseGrad = ctx.createLinearGradient(0, 0, 0, size);
        baseGrad.addColorStop(0, "#2a1f18");
        baseGrad.addColorStop(0.45, "#3a2b21");
        baseGrad.addColorStop(1, "#4d3a2e");
        ctx.fillStyle = baseGrad;
        ctx.fillRect(0, 0, size, size);

        // Long strand strokes.
        const strandCount = Math.floor(size * 4.5);
        for (let i = 0; i < strandCount; i++) {
          const x = rand() * size;
          const y0 = rand() * size * 0.2;
          const len = size * (0.55 + rand() * 0.45);
          const w = 0.5 + rand() * 1.8;
          const alpha = 0.03 + rand() * 0.12;
          const light = 62 + Math.floor(rand() * 56);
          ctx.strokeStyle = `rgba(${light}, ${Math.max(36, light - 10)}, ${Math.max(24, light - 22)}, ${alpha.toFixed(3)})`;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(x, y0);
          ctx.bezierCurveTo(
            x + (rand() - 0.5) * size * 0.03,
            y0 + len * 0.35,
            x + (rand() - 0.5) * size * 0.05,
            y0 + len * 0.7,
            x + (rand() - 0.5) * size * 0.02,
            Math.min(size, y0 + len),
          );
          ctx.stroke();
        }

        // Fine grain to break up smooth gradients.
        const img = ctx.getImageData(0, 0, size, size);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const n = Math.floor((rand() - 0.5) * 20);
          d[i] = Math.max(0, Math.min(255, d[i] + n));
          d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
          d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
        }
        ctx.putImageData(img, 0, 0);

        const tex = new THREE.CanvasTexture(canvas);
        tex.flipY = false;
        tex.anisotropy = maxAnisotropy;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        return tex;
      };
      const createProceduralRedCottonTexture = (size = 1024): { color: THREE.CanvasTexture; roughness: THREE.CanvasTexture } => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const roughCanvas = document.createElement("canvas");
        roughCanvas.width = size;
        roughCanvas.height = size;
        const rctx = roughCanvas.getContext("2d");
        if (!ctx || !rctx) {
          const fallback = document.createElement("canvas");
          fallback.width = 2;
          fallback.height = 2;
          const fctx = fallback.getContext("2d");
          if (fctx) {
            fctx.fillStyle = "#8c1f2a";
            fctx.fillRect(0, 0, 2, 2);
          }
          const ctex = new THREE.CanvasTexture(fallback);
          ctex.flipY = false;
          ctex.anisotropy = maxAnisotropy;
          ctex.colorSpace = THREE.SRGBColorSpace;
          const rtex = new THREE.CanvasTexture(fallback);
          rtex.flipY = false;
          rtex.anisotropy = maxAnisotropy;
          rtex.colorSpace = THREE.LinearSRGBColorSpace;
          return { color: ctex, roughness: rtex };
        }

        let seed = 0x85ebca6b;
        const rand = () => {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return seed / 4294967296;
        };

        // Deep red base with slight vertical weave falloff.
        const base = ctx.createLinearGradient(0, 0, 0, size);
        base.addColorStop(0, "#7f1322");
        base.addColorStop(0.5, "#a01c2e");
        base.addColorStop(1, "#7a1220");
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, size, size);

        // Subtle crosshatch weave.
        ctx.globalAlpha = 0.12;
        ctx.strokeStyle = "#d35a68";
        ctx.lineWidth = 1;
        const step = Math.max(4, Math.floor(size / 170));
        for (let x = 0; x < size; x += step) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, size);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.1;
        for (let y = 0; y < size; y += step) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(size, y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // Fiber flecks and knots.
        const img = ctx.getImageData(0, 0, size, size);
        const d = img.data;
        const rough = rctx.createImageData(size, size);
        const rd = rough.data;
        for (let i = 0; i < d.length; i += 4) {
          const n = Math.floor((rand() - 0.5) * 26);
          d[i] = Math.max(0, Math.min(255, d[i] + n));
          d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
          d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));

          // Cotton is matte but not flat: roughness centered high with grain.
          const rv = Math.max(150, Math.min(245, 205 + Math.floor((rand() - 0.5) * 55)));
          rd[i] = rv;
          rd[i + 1] = rv;
          rd[i + 2] = rv;
          rd[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        rctx.putImageData(rough, 0, 0);

        const colorTex = new THREE.CanvasTexture(canvas);
        colorTex.flipY = false;
        colorTex.anisotropy = maxAnisotropy;
        colorTex.colorSpace = THREE.SRGBColorSpace;
        colorTex.needsUpdate = true;

        const roughTex = new THREE.CanvasTexture(roughCanvas);
        roughTex.flipY = false;
        roughTex.anisotropy = maxAnisotropy;
        roughTex.colorSpace = THREE.LinearSRGBColorSpace;
        roughTex.needsUpdate = true;

        return { color: colorTex, roughness: roughTex };
      };
      const createProceduralScalpCapTexture = (size = 512): { color: THREE.CanvasTexture; roughness: THREE.CanvasTexture } => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const roughCanvas = document.createElement("canvas");
        roughCanvas.width = size;
        roughCanvas.height = size;
        const rctx = roughCanvas.getContext("2d");
        if (!ctx || !rctx) {
          const fallback = document.createElement("canvas");
          fallback.width = 2;
          fallback.height = 2;
          const fctx = fallback.getContext("2d");
          if (fctx) {
            fctx.fillStyle = "#2d2a30";
            fctx.fillRect(0, 0, 2, 2);
          }
          const ctex = new THREE.CanvasTexture(fallback);
          ctex.flipY = false;
          ctex.anisotropy = maxAnisotropy;
          ctex.colorSpace = THREE.SRGBColorSpace;
          const rtex = new THREE.CanvasTexture(fallback);
          rtex.flipY = false;
          rtex.anisotropy = maxAnisotropy;
          rtex.colorSpace = THREE.LinearSRGBColorSpace;
          return { color: ctex, roughness: rtex };
        }

        // Dark base for perforation holes.
        const grad = ctx.createLinearGradient(0, 0, 0, size);
        grad.addColorStop(0, "#15171b");
        grad.addColorStop(1, "#0c0d10");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);

        // Start roughness as matte/dark hole background.
        rctx.fillStyle = "rgb(235,235,235)";
        rctx.fillRect(0, 0, size, size);

        // Hexagonal wire lattice.
        const side = Math.max(8, Math.round(size / 48));
        const hexW = Math.sqrt(3) * side;
        const rowH = 1.5 * side;
        const wire = Math.max(1.5, side * 0.22);
        const xStart = -hexW;
        const yStart = -side;
        const xEnd = size + hexW;
        const yEnd = size + side;

        const drawHex = (cx: number, cy: number) => {
          const pts = [
            [cx + 0, cy - side],
            [cx + hexW / 2, cy - side / 2],
            [cx + hexW / 2, cy + side / 2],
            [cx + 0, cy + side],
            [cx - hexW / 2, cy + side / 2],
            [cx - hexW / 2, cy - side / 2],
          ] as const;
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.closePath();
          ctx.stroke();

          rctx.beginPath();
          rctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) rctx.lineTo(pts[i][0], pts[i][1]);
          rctx.closePath();
          rctx.stroke();
        };

        // Metallic gradient along wire direction.
        const wireGrad = ctx.createLinearGradient(0, 0, size, size);
        wireGrad.addColorStop(0, "#8f98a4");
        wireGrad.addColorStop(0.5, "#bcc4ce");
        wireGrad.addColorStop(1, "#6e7681");
        ctx.strokeStyle = wireGrad;
        ctx.lineWidth = wire;
        ctx.globalAlpha = 0.95;
        ctx.shadowColor = "rgba(205,215,230,0.25)";
        ctx.shadowBlur = wire * 0.9;

        // Low roughness on wire metal; holes stay rough.
        rctx.strokeStyle = "rgb(42,42,42)";
        rctx.lineWidth = wire;

        let row = 0;
        for (let y = yStart; y <= yEnd; y += rowH) {
          const offsetX = row % 2 === 0 ? 0 : hexW / 2;
          for (let x = xStart + offsetX; x <= xEnd; x += hexW) {
            drawHex(x, y);
          }
          row++;
        }

        // Fine specular scuff noise for realism.
        const img = ctx.getImageData(0, 0, size, size);
        const d = img.data;
        const rough = rctx.getImageData(0, 0, size, size);
        const rd = rough.data;
        let seed = 0x68bc21eb;
        const rand = () => {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return seed / 4294967296;
        };
        for (let i = 0; i < d.length; i += 4) {
          const n = Math.floor((rand() - 0.5) * 10);
          d[i] = Math.max(0, Math.min(255, d[i] + n));
          d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
          d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
          // Slight roughness jitter while preserving metal wire contrast.
          const rn = Math.floor((rand() - 0.5) * 12);
          rd[i] = Math.max(0, Math.min(255, rd[i] + rn));
          rd[i + 1] = rd[i];
          rd[i + 2] = rd[i];
          rd[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        rctx.putImageData(rough, 0, 0);

        const colorTex = new THREE.CanvasTexture(canvas);
        colorTex.flipY = false;
        colorTex.anisotropy = maxAnisotropy;
        colorTex.colorSpace = THREE.SRGBColorSpace;
        colorTex.needsUpdate = true;

        const roughTex = new THREE.CanvasTexture(roughCanvas);
        roughTex.flipY = false;
        roughTex.anisotropy = maxAnisotropy;
        roughTex.colorSpace = THREE.LinearSRGBColorSpace;
        roughTex.needsUpdate = true;

        return { color: colorTex, roughness: roughTex };
      };
      const overrideTextures = renderModeRef.current === "normal"
        ? (() => {
            const dress = createProceduralRedCottonTexture(1024);
            const scalpCap = createProceduralScalpCapTexture(512);
            loadedSkinTextures.set("__procedural_dress_color__", dress.color);
            loadedSkinTextures.set("__procedural_dress_roughness__", dress.roughness);
            loadedSkinTextures.set("__procedural_scalpcap_color__", scalpCap.color);
            loadedSkinTextures.set("__procedural_scalpcap_roughness__", scalpCap.roughness);
            return {
              dressColor: dress.color,
              dressRoughness: dress.roughness,
              scalpCapColor: scalpCap.color,
              scalpCapRoughness: scalpCap.roughness,
            } as const;
          })()
        : null;
      const isScalpCapMesh = (meshKey: string): boolean =>
        meshKey.includes("scalpcap") || meshKey.includes("scalp_cap") || meshKey.includes("scalp");
      const isScalpCapMaterial = (materialNameKey: string): boolean =>
        materialNameKey.includes("scalpcap") ||
        materialNameKey.includes("scalp_cap") ||
        materialNameKey.includes("scalp");
      const skinTextures = shouldLoadSkinAssets
        ? (() => {
            const proceduralHairColor = createProceduralHairTexture(1024);
            const proceduralDress = createProceduralRedCottonTexture(1024);
            loadedSkinTextures.set("__procedural_hair_color__", proceduralHairColor);
            loadedSkinTextures.set("__procedural_dress_color__", proceduralDress.color);
            loadedSkinTextures.set("__procedural_dress_roughness__", proceduralDress.roughness);
            return {
              bodyColor: loadSkinTexture("/avatar/skins/body_overall.jpg", true),
              bodyNormal: loadSkinTexture("/avatar/skins/body_normal.jpg"),
              bodyRoughness: loadSkinTexture("/avatar/skins/body_medium.jpg"),
              bodySpecular: loadSkinTexture("/avatar/skins/body_spec.jpg"),
              bodyDisplace: loadSkinTexture("/avatar/skins/body_displace.jpg"),
              bodySubdermal: loadSkinTexture("/avatar/skins/body_subdermal.jpg", true),
              eyeColor: loadSkinTexture("/avatar/skins/eye_dfs.jpg", true),
              eyeCorneaDisplace: loadSkinTexture("/avatar/skins/eye_corneaDisplace.jpg"),
              mouthColor: loadSkinTexture("/avatar/skins/jaw_overall.jpg", true),
              jawNormal: loadSkinTexture("/avatar/skins/jaw_nrm.jpg"),
              jawOpacity: loadSkinTexture("/avatar/skins/jaw_opc.jpg"),
              jawSubsurface: loadSkinTexture("/avatar/skins/jaw_sss.jpg", true),
              tongueColor: loadSkinTexture("/avatar/skins/tongue_dfs.jpg", true),
              hairColor: proceduralHairColor,
              hairMask: loadSkinTexture("/avatar/skins/Hair_Mask_2.jpg"),
              dressColor: proceduralDress.color,
              dressRoughness: proceduralDress.roughness,
            } as const;
          })()
        : null;
      const normalModeMaterialsFull = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      const normalModeMaterialsNoTeeth = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      const normalModeMaterialsTeethOnly = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      const normalModeMaterialsNone = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

      type MaterialColorRole = "skin" | "eyes" | "teeth" | "hair";
      const setMaterialRole = (mat: THREE.Material, role: MaterialColorRole): THREE.Material => {
        mat.userData = { ...(mat.userData ?? {}), avatarColorRole: role };
        return mat;
      };

      const buildSkinnedNormalMaterial = (
        source: THREE.Material | THREE.Material[],
        category: SkinCategory,
        meshContextKey: string,
        options: { includeJawTissue: boolean; includeTeeth: boolean },
      ): THREE.Material | THREE.Material[] => {
        const buildTeethMaterial = () =>
          setMaterialRole(new THREE.MeshStandardMaterial({
            color: 0xf8f3ec,
            roughness: 0.2,
            metalness: 0.0,
            emissive: new THREE.Color(0x120f0b),
            emissiveIntensity: 0.08,
            vertexColors: false,
          }), "teeth");

        const buildOne = (material: THREE.Material, slotIndex = 0, slotCount = 1): THREE.Material => {
          const cloned = material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial
            ? material.clone()
            : normalMat.clone();
          const materialName = (material.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          if (!skinTextures) {
            // Targeted overrides retained for normal.glb: dress and ScalpCap.
            if (overrideTextures) {
              if (category === "dress") {
                setMaterialRole(cloned, "skin");
                cloned.color.set(0xffffff);
                cloned.map = overrideTextures.dressColor;
                cloned.normalMap = null;
                cloned.roughnessMap = overrideTextures.dressRoughness;
                cloned.metalnessMap = null;
                cloned.bumpMap = null;
                cloned.alphaMap = null;
                cloned.emissiveMap = null;
                cloned.roughness = 0.88;
                cloned.metalness = 0.01;
                cloned.needsUpdate = true;
                return cloned;
              }
              if (isScalpCapMesh(meshContextKey) || isScalpCapMaterial(materialName)) {
                setMaterialRole(cloned, "hair");
                cloned.color.set(0xffffff);
                cloned.map = overrideTextures.scalpCapColor;
                cloned.normalMap = null;
                cloned.roughnessMap = overrideTextures.scalpCapRoughness;
                cloned.metalnessMap = null;
                cloned.bumpMap = null;
                cloned.alphaMap = null;
                cloned.emissiveMap = null;
                cloned.roughness = 0.28;
                cloned.metalness = 0.86;
                cloned.needsUpdate = true;
                return cloned;
              }
            }
            const fallbackRole: MaterialColorRole =
              category === "eye" ? "eyes"
                : category === "teeth" ? "teeth"
                  : category === "hair" ? "hair"
                    : "skin";
            setMaterialRole(cloned, fallbackRole);
            // Keep whatever maps/material params came from the GLB.
            // Force neutral albedo multiplier to avoid black baseColorFactor.
            if ("color" in cloned && cloned.color instanceof THREE.Color) {
              cloned.color.set(0xffffff);
            }
            cloned.needsUpdate = true;
            return cloned;
          }
          // Many exported GLB materials have black baseColorFactor (0,0,0),
          // which would multiply any texture to black. Force neutral white.
          cloned.color.set(0xffffff);
          const materialNameRaw = (material.name || "").toLowerCase();
          const isJawMesh = meshContextKey.includes("jawbtm") || meshContextKey.includes("jawtop");
          const teethSlotInJaw =
            category === "jaw" &&
            (slotCount > 1 && slotIndex > 0 || /teeth|tooth|material #67|material #63/.test(materialNameRaw));
          switch (category) {
            case "eye":
              setMaterialRole(cloned, "eyes");
              cloned.map = skinTextures.eyeColor;
              cloned.normalMap = null;
              cloned.metalnessMap = null;
              cloned.roughnessMap = null;
              cloned.bumpMap = skinTextures.eyeCorneaDisplace;
              cloned.bumpScale = 0.02;
              cloned.roughness = 0.14;
              cloned.metalness = 0.0;
              break;
            case "jaw":
              // Correct jaw mapping: slot 0 = jaw tissue, slot 1 = teeth.
              if (isJawMesh && teethSlotInJaw) {
                if (options.includeTeeth) return buildTeethMaterial();
                if (!options.includeJawTissue) return setMaterialRole(normalMat.clone(), "teeth");
              }
              setMaterialRole(cloned, "skin");
              if (!options.includeJawTissue) return setMaterialRole(normalMat.clone(), "skin");
              cloned.map = skinTextures.mouthColor;
              cloned.normalMap = skinTextures.jawNormal;
              cloned.roughnessMap = skinTextures.jawOpacity;
              cloned.metalnessMap = null;
              cloned.emissiveMap = skinTextures.jawSubsurface;
              cloned.emissive.set(0x5a1f16);
              cloned.emissiveIntensity = 0.04;
              cloned.roughness = 0.3;
              cloned.metalness = 0.0;
              break;
            case "teeth":
              if (!options.includeTeeth) return setMaterialRole(normalMat.clone(), "teeth");
              return buildTeethMaterial();
            case "tongue":
              setMaterialRole(cloned, "skin");
              if (!options.includeJawTissue) return setMaterialRole(normalMat.clone(), "skin");
              cloned.map = skinTextures.tongueColor;
              cloned.normalMap = null;
              cloned.metalnessMap = null;
              cloned.roughnessMap = null;
              cloned.roughness = 0.72;
              cloned.metalness = 0.0;
              break;
            case "mouth":
              setMaterialRole(cloned, "skin");
              if (!options.includeJawTissue) return setMaterialRole(normalMat.clone(), "skin");
              cloned.map = skinTextures.mouthColor;
              cloned.normalMap = skinTextures.jawNormal;
              cloned.metalnessMap = null;
              cloned.roughnessMap = null;
              cloned.roughness = 0.42;
              cloned.metalness = 0.0;
              break;
            case "hair":
              setMaterialRole(cloned, "hair");
              if (!options.includeJawTissue) return setMaterialRole(normalMat.clone(), "hair");
              cloned.map = skinTextures.hairColor;
              cloned.alphaMap = skinTextures.hairMask;
              cloned.transparent = true;
              cloned.alphaTest = 0.35;
              cloned.roughness = 0.6;
              cloned.metalness = 0.0;
              break;
            case "dress":
              setMaterialRole(cloned, "skin");
              if (!options.includeJawTissue) return setMaterialRole(normalMat.clone(), "skin");
              cloned.map = skinTextures.dressColor;
              cloned.normalMap = null;
              cloned.metalnessMap = null;
              cloned.roughnessMap = skinTextures.dressRoughness;
              cloned.displacementMap = null;
              cloned.emissiveMap = null;
              cloned.roughness = 0.88;
              cloned.metalness = 0.01;
              break;
            case "body":
            default:
              setMaterialRole(cloned, "skin");
              if (!options.includeJawTissue) return setMaterialRole(normalMat.clone(), "skin");
              cloned.map = skinTextures.bodyColor;
              cloned.normalMap = skinTextures.bodyNormal;
              cloned.roughnessMap = skinTextures.bodyRoughness;
              cloned.metalnessMap = skinTextures.bodySpecular;
              cloned.displacementMap = skinTextures.bodyDisplace;
              cloned.displacementScale = 0.0025;
              cloned.emissiveMap = skinTextures.bodySubdermal;
              cloned.emissive.set(0x30100a);
              cloned.emissiveIntensity = 0.03;
              cloned.roughness = 0.82;
              cloned.metalness = 0.03;
              break;
          }
          cloned.needsUpdate = true;
          return cloned;
        };

        if (Array.isArray(source)) return source.map((mat, i) => buildOne(mat, i, source.length));
        return buildOne(source);
      };

      // ── Runtime state ──────────────────────────────────────────────────────
      let mixer: THREE.AnimationMixer | null = null;
      let currentMixerAction: THREE.AnimationAction | null = null;
      let mixerCurrentClip: string | null = null;
      const clock = new THREE.Clock();
      let currentVisemeKey: string | null = null;
      let previousVisemeKey: string | null = null;
      let visemeLastChangeAt = 0;

      // ── Rig introspection caches (populated on load) ───────────────────────
      // Keyed bone lookup so debug manipulation never traverses the scene graph
      // per-frame (O(1) instead of O(n) per manipulated bone).
      const boneCache = new Map<string, THREE.Bone>();
      let modelScene: THREE.Object3D | null = null;
      let clips: THREE.AnimationClip[] = [];
      let skeletonHelper: FilteredSkeletonHelper | null = null;
      // Twist chains detected at load time — used for automatic twist distribution.
      let twistChains: TwistChain[] = [];

      // Bone references.
      let bHips:      THREE.Bone | undefined;
      let bSpine:     THREE.Bone | undefined;
      let bChest:     THREE.Bone | undefined;
      let bNeck:      THREE.Bone | undefined;
      let bHead:      THREE.Bone | undefined;
      let bJaw:       THREE.Bone | undefined;  // For jaw test control
      let bLUpperArm: THREE.Bone | undefined;
      let bRUpperArm: THREE.Bone | undefined;
      let bLForearm:  THREE.Bone | undefined;
      let bRForearm:  THREE.Bone | undefined;
      let bLHand:     THREE.Bone | undefined;
      let bRHand:     THREE.Bone | undefined;

      // Bind-pose quaternions (reset target when no mixer is present).
      const initQuats = new Map<THREE.Bone, THREE.Quaternion>();
      // Fallback for rigs without a functional jaw bone: directly transform jaw meshes.
      const initJawMeshQuats = new Map<THREE.Object3D, THREE.Quaternion>();
      const initJawMeshPositions = new Map<THREE.Object3D, THREE.Vector3>();
      let jawBottomMesh: THREE.Object3D | undefined;
      let jawTopMesh: THREE.Object3D | undefined;
      let jawMissingWarned = false;

      // Mesh classification for material switching.
      interface MeshEntry {
        mesh: THREE.Mesh;
        isFace: boolean;
        isEye: boolean;
        isLip: boolean;
        skinCategory: SkinCategory;
      }
      const allMeshes:  MeshEntry[] = [];
      const meshProbeCandidates: THREE.Mesh[] = [];
      let meshProbeStartTime = -1;
      let meshProbeLastIndex = -1;
      let meshProbeSeenNonce = meshProbeNonceRef.current;
      let fpsFrameCount = 0;
      let fpsSampleStart = performance.now();
      let frameMsAccum = 0;
      let resizeCount = 1; // initial setSize above
      // Original PBR materials for normal mode (kept for potential future use).
      const origMats = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      // Static fill-volume clones (shown only in wireframe/hybrid).
      const fillMeshes: THREE.Mesh[] = [];
      // Source mesh → fill clone map so applyMorph() can sync morph influences on both.
      const fillMeshMap = new Map<THREE.Mesh, THREE.SkinnedMesh>();

      // Morph targets.
      interface MorphEntry { mesh: THREE.Mesh; dict: Record<string, number> }
      const morphMeshes: MorphEntry[] = [];
      type MorphBinding = { influences: number[]; index: number };
      const morphBindings = new Map<string, MorphBinding[]>();
      const currentMorphs: Record<string, number> = {};
      let allMorphNames: string[] = [];
      let phMorphNames: string[] = [];
      let cachedMappingsRef: Record<string, string> | null = null;
      let mappedMorphNamesCache: string[] = [];
      // Reused coarticulation blend buffers (avoid per-frame Map/Set churn).
      const blendWeights: Record<string, number> = {};
      let blendWeightKeys: string[] = [];
      const jawDriverConfig = src.toLowerCase().includes("character.glb")
        ? CHARACTER_JAW_DRIVER_CONFIG
        : DEFAULT_JAW_DRIVER_CONFIG;
      // Idle facial micro-expression pulse state.
      let idleSmileCurrent = 0;
      let idleSmirkRCurrent = 0;
      let idleSmirkLCurrent = 0;
      let idleSmileTarget = 0;
      let idleSmirkRTarget = 0;
      let idleSmirkLTarget = 0;
      let idleFacePulseEndAt = 0;
      let nextIdleFacePulseAt = 2 + Math.random() * 3.5;

      let cachedMaxDim = 2;
      let lastPixelRatio = -1;

      // Reusable temp objects (avoid per-frame GC pressure).
      const tmpEuler    = new THREE.Euler();
      const tmpQuat     = new THREE.Quaternion();
      const tmpTwistQ   = new THREE.Quaternion();  // for twist distribution
      const identityQ   = new THREE.Quaternion();  // stays at (0,0,0,1)
      const tmpBox      = new THREE.Box3();
      const tmpSize     = new THREE.Vector3();
      const tmpVec      = new THREE.Vector3();
      const tmpColor    = new THREE.Color();

      // ── Bone offset helper ─────────────────────────────────────────────────
      // Pure additive multiply — the per-frame pre-reset block (in animate())
      // ensures all animated bones are at bind pose before any offsets apply.
      function offsetBone(bone: THREE.Bone | undefined, ex: number, ey: number, ez: number) {
        if (!bone) return;
        tmpEuler.set(ex, ey, ez, "XYZ");
        tmpQuat.setFromEuler(tmpEuler);
        bone.quaternion.multiply(tmpQuat);
      }

      function offsetObject(object: THREE.Object3D | undefined, ex: number, ey: number, ez: number) {
        if (!object) return;
        tmpEuler.set(ex, ey, ez, "XYZ");
        tmpQuat.setFromEuler(tmpEuler);
        object.quaternion.multiply(tmpQuat);
      }

      // ── Morph helper ───────────────────────────────────────────────────────
      function rebuildMorphBindings() {
        morphBindings.clear();
        const appendBinding = (name: string, influences: number[] | undefined, index: number | undefined) => {
          if (!influences || index === undefined) return;
          const entries = morphBindings.get(name);
          const binding = { influences, index };
          if (entries) entries.push(binding);
          else morphBindings.set(name, [binding]);
        };

        for (const { mesh, dict } of morphMeshes) {
          for (const [morphName, idx] of Object.entries(dict)) {
            appendBinding(morphName, mesh.morphTargetInfluences ?? undefined, idx);
            const fill = fillMeshMap.get(mesh);
            appendBinding(morphName, fill?.morphTargetInfluences ?? undefined, idx);
          }
        }
      }

      function applyMorph(name: string, value: number) {
        const applyMorphDirect = (morphName: string, morphValue: number) => {
          const bindings = morphBindings.get(morphName);
          if (!bindings) return;
          for (const { influences, index } of bindings) {
            influences[index] = morphValue;
          }
        };

        applyMorphDirect(name, value);

        // Rig compatibility: on this Character rig PH_JAW_Fwd does not visually "open"
        // the jaw by itself. Couple it with mouth-open style morphs so jaw-open controls
        // (manual and runtime) behave as expected.
        const normalized = name.toLowerCase();
        if (JAW_FORWARD_MORPHS.some((n) => n.toLowerCase() === normalized)) {
          const companionValue = Math.min(1, value * 0.9);
          for (const companion of JAW_OPEN_COMPANIONS) {
            if (!(companion in currentMorphs)) continue;
            currentMorphs[companion] = Math.max(currentMorphs[companion] ?? 0, companionValue);
            applyMorphDirect(companion, currentMorphs[companion]);
          }
        }
      }

      // ── GLB Load ───────────────────────────────────────────────────────────
      new GLTFLoader().load(
        src,
        (gltf) => {
          if (cancelled) return;

          gltf.scene.traverse((node) => {
            if (node instanceof THREE.Bone) {
              initQuats.set(node, node.quaternion.clone());
              boneCache.set(node.name, node);   // O(1) lookup during animation loop
            }
            if (node instanceof THREE.Mesh) {
              let lineage: THREE.Object3D | null = node;
              const lineageNames: string[] = [];
              while (lineage) {
                if (lineage.name) lineageNames.push(lineage.name);
                lineage = lineage.parent;
              }
              const meshContextName = lineageNames.join(" ");
              const meshContextKey = meshContextName.toLowerCase().replace(/[^a-z0-9]/g, "");
              if (
                !jawBottomMesh &&
                (
                  meshContextKey.includes("jawbtm") ||
                  meshContextKey.includes("jawbottom") ||
                  meshContextKey.includes("lowerjaw") ||
                  meshContextKey.includes("jawlower")
                )
              ) {
                jawBottomMesh = node;
                // Ensure node transforms are applied even if GLTF node loaded with a fixed matrix.
                jawBottomMesh.matrixAutoUpdate = true;
                initJawMeshQuats.set(node, node.quaternion.clone());
                initJawMeshPositions.set(node, node.position.clone());
                console.log("[AvatarRenderer] Jaw bottom mesh fallback:", node.name);
              }
              if (
                !jawTopMesh &&
                (
                  meshContextKey.includes("jawtop") ||
                  meshContextKey.includes("jawupper") ||
                  meshContextKey.includes("upperjaw")
                )
              ) {
                jawTopMesh = node;
                jawTopMesh.matrixAutoUpdate = true;
                initJawMeshQuats.set(node, node.quaternion.clone());
                initJawMeshPositions.set(node, node.position.clone());
                console.log("[AvatarRenderer] Jaw top mesh fallback:", node.name);
              }
              // Collect morph targets.
              if (node.morphTargetDictionary && node.morphTargetInfluences) {
                const morphNames = Object.keys(node.morphTargetDictionary);
                console.log(`[AvatarRenderer] Mesh "${node.name}" has ${morphNames.length} morph targets:`, morphNames.join(", "));
                morphMeshes.push({ mesh: node, dict: node.morphTargetDictionary });
                // Start from a true neutral face regardless of baked/default export weights.
                for (const k of morphNames) {
                  currentMorphs[k] = 0;
                  const idx = node.morphTargetDictionary[k];
                  if (idx !== undefined) node.morphTargetInfluences[idx] = 0;
                }
              }
              // Store original PBR material.
              origMats.set(node, node.material);
              // Keyword-based classification (refined by proximity below).
              const isEye = isEyeMeshByName(meshContextName);
              const isLip = isLipMeshByName(meshContextName);
              const isFace = isFaceMeshByName(meshContextName) || isEye || isLip;
              const skinCategory = classifySkinCategory(meshContextName);
              allMeshes.push({ mesh: node, isFace, isEye, isLip, skinCategory });
              if (
                meshContextKey.includes("jaw") ||
                meshContextKey.includes("tooth") ||
                meshContextKey.includes("teeth") ||
                meshContextKey.includes("mouth") ||
                meshContextKey.includes("tongue") ||
                meshContextKey.includes("bodyrig")
              ) {
                meshProbeCandidates.push(node);
              }
              normalModeMaterialsFull.set(node, buildSkinnedNormalMaterial(
                node.material,
                skinCategory,
                meshContextKey,
                { includeJawTissue: true, includeTeeth: true },
              ));
              normalModeMaterialsNoTeeth.set(node, buildSkinnedNormalMaterial(
                node.material,
                skinCategory,
                meshContextKey,
                { includeJawTissue: true, includeTeeth: false },
              ));
              normalModeMaterialsTeethOnly.set(node, buildSkinnedNormalMaterial(
                node.material,
                skinCategory,
                meshContextKey,
                { includeJawTissue: false, includeTeeth: true },
              ));
              normalModeMaterialsNone.set(node, buildSkinnedNormalMaterial(
                node.material,
                skinCategory,
                meshContextKey,
                { includeJawTissue: false, includeTeeth: false },
              ));
              // Fill-volume clone for wireframe depth cue.
              // Performance note: cloning all skinned meshes doubles skinning work and is
              // expensive on dense rigs. Keep skinned fill only for core opaque surfaces
              // (body/dress), while static meshes can still use fill normally.
              if (!isFace) {
                const shouldCreateSkinnedFill =
                  node instanceof THREE.SkinnedMesh &&
                  (skinCategory === "body" || skinCategory === "dress");
                if (shouldCreateSkinnedFill) {
                  const fill = new THREE.SkinnedMesh(node.geometry.clone(), fillMat.clone());
                  fill.bindMode = node.bindMode;
                  fill.bindMatrix.copy(node.bindMatrix);
                  fill.bindMatrixInverse.copy(node.bindMatrixInverse);
                  fill.skeleton = node.skeleton;
                  fill.frustumCulled = false;
                  fill.userData = { ...(fill.userData ?? {}), skinCategory };
                  node.parent?.add(fill);
                  fillMeshes.push(fill);
                  fillMeshMap.set(node, fill);  // register for morph-influence sync
                } else if (!(node instanceof THREE.SkinnedMesh)) {
                  const fill = node.clone() as THREE.Mesh;
                  fill.material = fillMat.clone();
                  fill.userData = { ...(fill.userData ?? {}), skinCategory };
                  fillMeshes.push(fill);
                  node.parent?.add(fill);
                }
              }
            }
          });

          // Cache morph names.
          rebuildMorphBindings();
          const nameSet = new Set<string>();
          for (const { dict } of morphMeshes) Object.keys(dict).forEach((k) => nameSet.add(k));
          allMorphNames = [...nameSet];
          phMorphNames = allMorphNames.filter((n) => n.startsWith("PH_"));
          // Default garments on for this model.
          for (const [morphName, defaultValue] of Object.entries(GARMENT_DEFAULT_MORPHS)) {
            if (morphName in currentMorphs) {
              currentMorphs[morphName] = defaultValue;
              applyMorph(morphName, defaultValue);
            }
          }
          if (allMorphNames.length > 0) {
            console.log("[AvatarRenderer] Available morph targets:", allMorphNames.join(", "));
            onMorphNames?.(allMorphNames);
          }
          
          // ── Comprehensive Model Inspection ───────────────────────────────────
          console.groupCollapsed(`[AvatarRenderer] Model Inspection: ${src}`);
          
          // Bones with hierarchy
          const bones: string[] = [];
          const boneHierarchy: string[] = [];
          gltf.scene.traverse((node) => {
            if (node instanceof THREE.Bone) {
              bones.push(node.name);
              // Show hierarchy with indentation based on depth
              let depth = 0;
              let parent = node.parent;
              while (parent) { depth++; parent = parent.parent; }
              const indent = "  ".repeat(depth);
              const rot = node.rotation;
              boneHierarchy.push(`${indent}${node.name} [rot: ${rot.x.toFixed(2)}, ${rot.y.toFixed(2)}, ${rot.z.toFixed(2)}]`);
            }
          });
          console.log(`🦴 Bones (${bones.length}):`, bones);
          console.groupCollapsed("🦴 Bone Hierarchy (with initial rotations):");
          boneHierarchy.forEach(line => console.log(line));
          console.groupEnd();
          
          // Meshes with details
          console.groupCollapsed(`📦 Meshes (${allMeshes.length})`);
          for (const { mesh, isFace, isEye, isLip } of allMeshes) {
            const morphCount = mesh.morphTargetDictionary ? Object.keys(mesh.morphTargetDictionary).length : 0;
            console.log(`  "${mesh.name}": face=${isFace}, eye=${isEye}, lip=${isLip}, morphs=${morphCount}`);
          }
          console.groupEnd();
          
          // Morph targets grouped by mesh
          if (morphMeshes.length > 0) {
            console.groupCollapsed(`🎭 Morph Targets (${allMorphNames.length} unique)`);
            for (const { mesh, dict } of morphMeshes) {
              const names = Object.keys(dict);
              if (names.length > 0) {
                console.log(`  "${mesh.name}":`, names);
              }
            }
            console.groupEnd();
          } else {
            console.log("🎭 Morph Targets: None");
          }
          
          // Animations
          console.log(`🎬 Animation Clips (${gltf.animations.length}):`, gltf.animations.map(a => a.name || "unnamed"));
          
          // Check for common lip sync morphs
          const lipSyncMorphs = ["jawOpen", "jaw_open", "Jaw_Open", "mouthOpen", "viseme_aa", "A", "mouthFunnel", "mouthPucker"];
          const foundLipSync = lipSyncMorphs.filter(name => allMorphNames.some(n => n.toLowerCase() === name.toLowerCase()));
          const missingLipSync = lipSyncMorphs.filter(name => !allMorphNames.some(n => n.toLowerCase() === name.toLowerCase()));
          console.log("👄 Lip Sync Morphs - Found:", foundLipSync.length > 0 ? foundLipSync : "NONE ⚠️");
          console.log("👄 Lip Sync Morphs - Missing:", missingLipSync);
          
          // Check for blink morphs
          const blinkMorphs = ["eyeBlink_L", "eyeBlink_R", "blink_L", "blink_R", "eyeblinkleft", "eyeblinkright"];
          const foundBlink = blinkMorphs.filter(name => allMorphNames.some(n => n.toLowerCase() === name.toLowerCase()));
          console.log("👁️ Blink Morphs - Found:", foundBlink.length > 0 ? foundBlink : "NONE ⚠️");
          
          console.groupEnd();

          // Find key bones (fuzzy, rig-agnostic).
          // Helper to log which bone was matched
          const logBoneMatch = (name: string, bone: THREE.Bone | undefined, keywords: string[]) => {
            if (bone) {
              console.log(`🦴 ${name}: "${bone.name}" (matched: [${keywords.join(", ")}])`);
            } else {
              console.warn(`🦴 ${name}: NOT FOUND (tried: [${keywords.join(", ")}])`);
            }
          };
          
          bHips      = findBone(gltf.scene, "hips", "pelvis", "root");
          logBoneMatch("Hips", bHips, ["hips", "pelvis", "root"]);
          bSpine     = findBone(gltf.scene, "spine", "spine1", "spine01");
          logBoneMatch("Spine", bSpine, ["spine", "spine1", "spine01"]);
          bChest     = findBone(gltf.scene, "chest", "spine2", "spine02", "upperchest");
          logBoneMatch("Chest", bChest, ["chest", "spine2", "spine02", "upperchest"]);
          bNeck      = findBone(gltf.scene, "neck");
          logBoneMatch("Neck", bNeck, ["neck"]);
          bHead      = findBone(gltf.scene, "head");
          logBoneMatch("Head", bHead, ["head"]);
          bJaw       = findJawBone(gltf.scene);
          logBoneMatch("Jaw", bJaw, ["jaw", "chin", "mandible"]);
          
          bLUpperArm = findBone(gltf.scene, "leftupperarm", "leftarm", "lupperarm", "upperarml", "arml", "shoulderl");
          logBoneMatch("LUpperArm", bLUpperArm, ["leftupperarm", "leftarm", "lupperarm", "upperarml", "arml", "shoulderl"]);
          bRUpperArm = findBone(gltf.scene, "rightupperarm", "rightarm", "rupperarm", "upperarmr", "armr", "shoulderr");
          logBoneMatch("RUpperArm", bRUpperArm, ["rightupperarm", "rightarm", "rupperarm", "upperarmr", "armr", "shoulderr"]);
          bLForearm  = findBone(gltf.scene, "leftforearm", "leftlowerarm", "lforearm", "forearm_l");
          logBoneMatch("LForearm", bLForearm, ["leftforearm", "leftlowerarm", "lforearm", "forearm_l"]);
          bRForearm  = findBone(gltf.scene, "rightforearm", "rightlowerarm", "rforearm", "forearm_r");
          logBoneMatch("RForearm", bRForearm, ["rightforearm", "rightlowerarm", "rforearm", "forearm_r"]);
          bLHand     = findBone(gltf.scene, "lefthand", "lhand", "hand_l");
          logBoneMatch("LHand", bLHand, ["lefthand", "lhand", "hand_l"]);
          bRHand     = findBone(gltf.scene, "righthand", "rhand", "hand_r");
          logBoneMatch("RHand", bRHand, ["righthand", "rhand", "hand_r"]);

          // Prefer exact jaw object nodes when present.
          const findObjectByNames = (names: string[]): THREE.Object3D | null => {
            const lowered = new Set(names.map((n) => n.toLowerCase()));
            let hit: THREE.Object3D | null = null;
            gltf.scene.traverse((obj) => {
              if (hit) return;
              if (lowered.has(obj.name.toLowerCase())) hit = obj;
            });
            return hit;
          };
          const jawBottomByName = findObjectByNames(["Jaw_btm", "Lower_Jaw", "lower_jaw", "jaw_bottom"]);
          if (jawBottomByName) {
            jawBottomMesh = jawBottomByName;
            jawBottomMesh.matrixAutoUpdate = true;
            initJawMeshQuats.set(jawBottomMesh, jawBottomMesh.quaternion.clone());
            initJawMeshPositions.set(jawBottomMesh, jawBottomMesh.position.clone());
            console.log("[AvatarRenderer] Using jaw object by name:", jawBottomByName.name);
          }
          const jawTopByName = findObjectByNames(["Jaw_top", "Upper_Jaw", "upper_jaw", "jaw_top"]);
          if (jawTopByName) {
            jawTopMesh = jawTopByName;
            jawTopMesh.matrixAutoUpdate = true;
            initJawMeshQuats.set(jawTopMesh, jawTopMesh.quaternion.clone());
            initJawMeshPositions.set(jawTopMesh, jawTopMesh.position.clone());
            console.log("[AvatarRenderer] Using jaw object by name:", jawTopByName.name);
          }

          // Report bone mapping to debug UI
          onBoneMapping?.({
            hips: bHips?.name ?? null,
            spine: bSpine?.name ?? null,
            chest: bChest?.name ?? null,
            neck: bNeck?.name ?? null,
            head: bHead?.name ?? null,
            jaw: bJaw?.name ?? null,
            leftUpperArm: bLUpperArm?.name ?? null,
            rightUpperArm: bRUpperArm?.name ?? null,
            leftForearm: bLForearm?.name ?? null,
            rightForearm: bRForearm?.name ?? null,
            leftHand: bLHand?.name ?? null,
            rightHand: bRHand?.name ?? null,
            allBones: bones,
            animationClipCount: gltf.animations.length,
            animationClipNames: gltf.animations.map(a => a.name || "unnamed"),
          });

          // Build and report comprehensive skeleton mapping for rig debug UI
          const skeletonMapping = buildSkeletonMapping(gltf.scene, gltf.animations, hierarchyConfigRef.current);
          twistChains = skeletonMapping.twistChains;
          console.log("[AvatarRenderer] Skeleton mapping built:", {
            totalBones: skeletonMapping.totalBones,
            twistBones: skeletonMapping.twistBoneCount,
            twistChains: twistChains.length,
            morphTargets: skeletonMapping.morphTargets.length,
          });
          console.log(`[AvatarRenderer] boneCache: ${boneCache.size} bones`, [...boneCache.keys()]);
          if (twistChains.length > 0) {
            console.log("[AvatarRenderer] Twist chains detected:", twistChains.map(c => `${c.mainBone} → [${c.twistBones.join(", ")}] (axis=${c.axis})`));
          } else {
            console.warn("[AvatarRenderer] No twist chains detected — twist bone distribution disabled. Check bone names contain 'twist'.");
          }
          onSkeletonMapping?.(skeletonMapping);

          scene.add(gltf.scene);
          gltf.scene.updateMatrixWorld(true);

          // Store model references for animation clip management
          modelScene = gltf.scene;
          clips = gltf.animations;

          // Skeleton helper — shows bone lines overlaid on the model.
          // Hidden by default; toggled via showSkeletonHelper prop.
          // Uses FilteredSkeletonHelper to exclude auxiliary bones from3ds Max exports
          // (helper bones, nub bones, etc.) that create confusing visual connections.
          const filteredBones: { included: string[]; excluded: string[] } = { included: [], excluded: [] };
          skeletonHelper = new FilteredSkeletonHelper(gltf.scene, {
            excludeHelpers: true,
            excludeNubs: true,
            excludeTwist: false,  // Show twist bones as they're part of the armature
            excludeCorrective: true,
          }, filteredBones);
          console.log(`[AvatarRenderer] FilteredSkeletonHelper: ${filteredBones.included.length} bones included, ${filteredBones.excluded.length} excluded`);
          if (filteredBones.excluded.length > 0) {
            console.log("[AvatarRenderer] Excluded bones:", filteredBones.excluded);
          }
          skeletonHelper.visible = showSkeletonHelperRef.current;
          scene.add(skeletonHelper);

          // Bounding box for camera radius.
          tmpBox.setFromObject(gltf.scene);
          tmpBox.getSize(tmpSize);
          cachedMaxDim = Math.max(tmpSize.x, tmpSize.y, tmpSize.z, 0.5);

          // ── Head-proximity face re-classification ──────────────────────────
          // Catches unified body meshes whose name gives no face hint.
          if (bHead) {
            const headPos = new THREE.Vector3();
            bHead.getWorldPosition(headPos);
            let faceRadius = cachedMaxDim * 0.15;
            if (bNeck) {
              bNeck.getWorldPosition(tmpVec);
              faceRadius = headPos.distanceTo(tmpVec) * 1.8;
            }
            const mBox    = new THREE.Box3();
            const mCenter = new THREE.Vector3();
            for (const entry of allMeshes) {
              if (entry.isFace) continue;
              mBox.setFromObject(entry.mesh);
              mBox.getCenter(mCenter);
              if (mCenter.distanceTo(headPos) < faceRadius) entry.isFace = true;
            }
          }

          // Note: Baked animation clips are NOT auto-played since we use procedural animation.
          // The animation clip (e.g., "Take001") in the model is typically a T-pose or test animation
          // that would conflict with our idle/breathing/head movement animations.
          // Keeping mixer null - animations disabled.
          console.log(`[AvatarRenderer] Model has ${gltf.animations.length} animation clips (not auto-playing, using procedural animation)`);

          // Invalidate cached render state after model load so newly-added meshes
          // always receive the correct mode materials (e.g. wireframe vs normal).
          lastAppliedMode = null;
          lastAppliedAppearanceKey = "";
          lastAppliedRenderOptionsKey = "";
          lastAppliedProbeMesh = null;
          lastAppliedMeshCount = -1;

          onLoad?.();
        },
        undefined,
        () => { if (!cancelled) onError?.(); },
      );

      // ── Resize observer ────────────────────────────────────────────────────
      const ro = new ResizeObserver(() => {
        const w = mount.clientWidth;
        const h = mount.clientHeight;
        if (w > 0 && h > 0) {
          renderer.setSize(w, h);
          resizeCount += 1;
          trackSetSize(presentationMode || !!document.fullscreenElement);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        }
      });
      ro.observe(mount);

      let lastAppliedMode: RenderMode | null = null;
      let lastAppliedAppearanceKey = "";
      let lastAppliedRenderOptionsKey = "";
      let lastAppliedProbeMesh: THREE.Mesh | null = null;
      let lastAppliedMeshCount = -1;

      const buildAppearanceKey = (app: WireframeAppearance): string =>
        [
          app.wireColor,
          app.fillOpacity,
          app.fillBrightness,
          app.fillColorIntensity,
          app.eyeColor,
          app.eyeBrightness,
          app.eyeColorIntensity,
          app.mouthColor,
          app.skinColor,
          app.teethColor,
          app.hairColor,
          app.lipColor,
          app.lipBrightness,
          app.lipColorIntensity,
        ].join("|");

      const buildRenderOptionsKey = (opts: NormalRenderOptions): string =>
        `${Number(opts.skin)}|${Number(opts.eyes)}|${Number(opts.teeth)}|${Number(opts.hair)}|${Number(opts.hideHair)}`;

      const applyRenderState = (
        mode: RenderMode,
        app: WireframeAppearance,
        renderOptions: NormalRenderOptions,
        probeMesh: THREE.Mesh | null,
      ) => {
        const isWire = mode !== "normal";

        wireMat.color.set(app.wireColor);
        fillMat.opacity = app.fillOpacity;

        const bgColor = getCSSColor("--color-bg-dark", "#0a0a0a");
        const wireColorAsThree = new THREE.Color(app.wireColor);
        const adjustedColor = new THREE.Color().copy(bgColor);
        const brightness = app.fillBrightness;
        const colorIntensity = app.fillColorIntensity;

        if (brightness > 0) {
          adjustedColor.lerpColors(bgColor, new THREE.Color(1, 1, 1), brightness);
        } else if (brightness < 0) {
          adjustedColor.lerpColors(bgColor, new THREE.Color(0, 0, 0), -brightness);
        }
        if (colorIntensity > 0) {
          adjustedColor.lerpColors(adjustedColor, wireColorAsThree, colorIntensity);
        }
        fillMat.color.copy(adjustedColor);

        const eyeBaseColor = new THREE.Color(app.eyeColor);
        const eyeColor = new THREE.Color().copy(eyeBaseColor);
        if (app.eyeBrightness > 0) {
          eyeColor.lerpColors(eyeBaseColor, new THREE.Color(1, 1, 1), app.eyeBrightness);
        } else if (app.eyeBrightness < 0) {
          eyeColor.lerpColors(eyeBaseColor, new THREE.Color(0, 0, 0), -app.eyeBrightness);
        }
        if (app.eyeColorIntensity > 0) {
          eyeColor.lerpColors(eyeColor, wireColorAsThree, app.eyeColorIntensity);
        }

        const normalEyeColor = new THREE.Color().copy(eyeColor);
        const normalMouthColor = new THREE.Color(app.mouthColor || "#0f4e64");
        const normalSkinColor = new THREE.Color(app.skinColor);
        const normalTeethColor = new THREE.Color(app.teethColor);
        const normalHairColor = new THREE.Color(app.hairColor);

        const lipBaseColor = new THREE.Color(app.lipColor);
        const lipColor = new THREE.Color().copy(lipBaseColor);
        if (app.lipBrightness > 0) {
          lipColor.lerpColors(lipBaseColor, new THREE.Color(1, 1, 1), app.lipBrightness);
        } else if (app.lipBrightness < 0) {
          lipColor.lerpColors(lipBaseColor, new THREE.Color(0, 0, 0), -app.lipBrightness);
        }
        if (app.lipColorIntensity > 0) {
          lipColor.lerpColors(lipColor, wireColorAsThree, app.lipColorIntensity);
        }

        wireEyeMat.color.copy(eyeColor);
        wireLipMat.color.copy(lipColor);
        wireMouthMat.color.copy(normalMouthColor);

        const tintNormalMaterial = (material: THREE.Material | THREE.Material[]) => {
          const tintOne = (m: THREE.Material) => {
            if (!("color" in m) || !(m.color instanceof THREE.Color)) return;
            const role = m.userData?.avatarColorRole as "skin" | "eyes" | "teeth" | "hair" | undefined;
            const meshEnabled = role
              ? ({
                  skin: renderOptions.skin,
                  eyes: renderOptions.eyes,
                  teeth: renderOptions.teeth,
                  hair: renderOptions.hair,
                } as const)[role]
              : true;
            switch (role) {
              case "eyes":
                m.color.copy(meshEnabled ? new THREE.Color(0xffffff) : normalEyeColor);
                break;
              case "teeth":
                m.color.copy(meshEnabled ? new THREE.Color(0xffffff) : normalTeethColor);
                break;
              case "hair":
                m.color.copy(meshEnabled ? new THREE.Color(0xffffff) : normalHairColor);
                break;
              case "skin":
                m.color.copy(meshEnabled ? new THREE.Color(0xffffff) : normalSkinColor);
                break;
              default:
                break;
            }
          };
          if (Array.isArray(material)) material.forEach(tintOne);
          else tintOne(material);
        };

        const hideHair = renderOptions.hideHair;
        const hideWireEyes = isWire && !renderOptions.eyes;
        const hideWireTeeth = isWire && !renderOptions.teeth;
        const hideWireHair = isWire && (!renderOptions.hair || hideHair);
        flatSkinMat.color.copy(normalSkinColor);
        flatEyeMat.color.copy(normalEyeColor);
        flatMouthMat.color.copy(normalMouthColor);
        flatTeethMat.color.copy(normalTeethColor);
        flatHairMat.color.copy(normalHairColor);

        for (const { mesh, isEye, isLip, skinCategory } of allMeshes) {
          mesh.visible = true;
          if ((hideHair && skinCategory === "hair") || (hideWireHair && skinCategory === "hair")) {
            mesh.visible = false;
            continue;
          }
          if (hideWireEyes && (isEye || skinCategory === "eye")) {
            mesh.visible = false;
            continue;
          }
          if (hideWireTeeth && skinCategory === "teeth") {
            mesh.visible = false;
            continue;
          }
          if (!isWire) {
            if (probeMesh === mesh) {
              mesh.material = meshProbeMat;
              continue;
            }

            if (skinCategory === "jaw") {
              let selected: THREE.Material | THREE.Material[] = normalMat;
              if (renderOptions.skin && renderOptions.teeth) {
                selected = normalModeMaterialsFull.get(mesh) ?? normalMat;
              } else if (renderOptions.skin && !renderOptions.teeth) {
                selected = normalModeMaterialsNoTeeth.get(mesh) ?? normalMat;
              } else if (!renderOptions.skin && renderOptions.teeth) {
                selected = normalModeMaterialsTeethOnly.get(mesh) ?? normalMat;
              } else if (!renderOptions.skin && !renderOptions.teeth) {
                selected = normalModeMaterialsNone.get(mesh) ?? normalMat;
              }
              mesh.material = selected;
              tintNormalMaterial(mesh.material);
              continue;
            }

            if (skinCategory === "mouth" || skinCategory === "tongue") {
              mesh.material = renderOptions.skin
                ? (normalModeMaterialsFull.get(mesh) ?? normalMat)
                : flatMouthMat;
              tintNormalMaterial(mesh.material);
              continue;
            }

            if (isEye || skinCategory === "eye") {
              mesh.material = renderOptions.eyes
                ? (normalModeMaterialsFull.get(mesh) ?? normalMat)
                : flatEyeMat;
              tintNormalMaterial(mesh.material);
              continue;
            }

            if (skinCategory === "teeth") {
              mesh.material = renderOptions.teeth
                ? (normalModeMaterialsFull.get(mesh) ?? normalMat)
                : flatTeethMat;
              tintNormalMaterial(mesh.material);
              continue;
            }

            if (skinCategory === "hair") {
              mesh.material = renderOptions.hair
                ? (normalModeMaterialsFull.get(mesh) ?? normalMat)
                : flatHairMat;
              tintNormalMaterial(mesh.material);
              continue;
            }

            mesh.material = renderOptions.skin
              ? (normalModeMaterialsFull.get(mesh) ?? normalMat)
              : flatSkinMat;
            tintNormalMaterial(mesh.material);
          } else {
            if (isEye) {
              mesh.material = wireEyeMat;
            } else if (skinCategory === "mouth" || skinCategory === "tongue" || skinCategory === "jaw") {
              mesh.material = wireMouthMat;
            } else if (isLip) {
              mesh.material = wireLipMat;
            } else {
              mesh.material = wireMat;
            }
          }
        }

        for (const fill of fillMeshes) {
          const fillCategory = fill.userData?.skinCategory as SkinCategory | undefined;
          fill.visible =
            isWire &&
            !(hideHair && fillCategory === "hair") &&
            !(hideWireHair && fillCategory === "hair") &&
            !(hideWireEyes && fillCategory === "eye") &&
            !(hideWireTeeth && fillCategory === "teeth");
          if (isWire && fill.material instanceof THREE.MeshBasicMaterial) {
            fill.material.opacity = app.fillOpacity;
            fill.material.color.copy(adjustedColor);
          }
        }
      };

      // ── Render loop ────────────────────────────────────────────────────────
      const animate = () => {
        animId = requestAnimationFrame(animate);
        fpsFrameCount += 1;
        const now = performance.now();
        const elapsedMs = now - fpsSampleStart;
        if (elapsedMs >= 500) {
          const fps = (fpsFrameCount * 1000) / elapsedMs;
          const avgFrameMs = fpsFrameCount > 0 ? frameMsAccum / fpsFrameCount : 0;
          if (hudRef.current && showStatsRef.current) {
            hudRef.current.textContent = `FPS ${fps.toFixed(0)} | ${avgFrameMs.toFixed(1)}ms | rsz ${resizeCount} | cmt ${commitCountRef.current}`;
          }
          fpsFrameCount = 0;
          frameMsAccum = 0;
          fpsSampleStart = now;
        }
        const delta = clock.getDelta();
        frameMsAccum += delta * 1000;
        const t     = clock.getElapsedTime();

        mixer?.update(delta);

        const mode    = renderModeRef.current;
        const p       = paramsRef.current;
        const app     = appearanceRef.current;
        const voiceState = useVoiceStore.getState();
        const speaking = voiceState.isSpeaking || voiceState.pipelineState === "agent_speaking";
        // Prefer TTS audio amplitude (properly synced to playback) over mic amplitude.
        const ttsAmp   = voiceState.ttsAmplitude ?? 0;
        const amp      = (ttsAmp > 0.005) ? ttsAmp : voiceState.amplitude;
        const activeViseme = voiceState.activeViseme ?? null;
        const isWire   = mode !== "normal";
        const basePixelRatio = isWire ? 1 : Math.min(window.devicePixelRatio, 1.5);
        const desiredPixelRatio = basePixelRatio * renderScaleRef.current;
        if (Math.abs(desiredPixelRatio - lastPixelRatio) > 1e-3) {
          lastPixelRatio = desiredPixelRatio;
          renderer.setPixelRatio(desiredPixelRatio);
          renderer.setSize(mount.clientWidth, mount.clientHeight, false);
          resizeCount += 1;
          trackSetSize(presentationMode || !!document.fullscreenElement);
        }
        if (meshProbeNonceRef.current !== meshProbeSeenNonce) {
          meshProbeSeenNonce = meshProbeNonceRef.current;
          meshProbeStartTime = t;
          meshProbeLastIndex = -1;
          console.log("[AvatarRenderer] Mesh probe started. Candidates:", meshProbeCandidates.map((m) => m.name));
        }

        let probeMesh: THREE.Mesh | null = null;
        if (meshProbeStartTime >= 0 && meshProbeCandidates.length > 0) {
          const probeElapsed = t - meshProbeStartTime;
          const probeWindowSeconds = meshProbeCandidates.length * 0.8;
          if (probeElapsed <= probeWindowSeconds) {
            const probeIndex = Math.min(meshProbeCandidates.length - 1, Math.floor(probeElapsed / 0.8));
            probeMesh = meshProbeCandidates[probeIndex] ?? null;
            if (probeIndex !== meshProbeLastIndex && probeMesh) {
              meshProbeLastIndex = probeIndex;
              console.log(`[AvatarRenderer] Probe ${probeIndex + 1}/${meshProbeCandidates.length}: ${probeMesh.name}`);
            }
          } else {
            meshProbeStartTime = -1;
            meshProbeLastIndex = -1;
            console.log("[AvatarRenderer] Mesh probe finished.");
          }
        }

        const renderOptions = normalRenderOptionsRef.current;
        const appearanceKey = buildAppearanceKey(app);
        const renderOptionsKey = buildRenderOptionsKey(renderOptions);
        const renderStateDirty =
          mode !== lastAppliedMode ||
          appearanceKey !== lastAppliedAppearanceKey ||
          renderOptionsKey !== lastAppliedRenderOptionsKey ||
          probeMesh !== lastAppliedProbeMesh ||
          allMeshes.length !== lastAppliedMeshCount;
        if (renderStateDirty) {
          applyRenderState(mode, app, renderOptions, probeMesh);
          lastAppliedMode = mode;
          lastAppliedAppearanceKey = appearanceKey;
          lastAppliedRenderOptionsKey = renderOptionsKey;
          lastAppliedProbeMesh = probeMesh;
          lastAppliedMeshCount = allMeshes.length;
        }

        // ── Per-frame bone reset ─────────────────────────────────────────────
        // Reset every bone that will be touched this frame back to bind pose
        // ONCE — before any offsets are applied. This lets rest pose, procedural
        // animation, and debug manipulation all compose additively without
        // fighting each other. (Replaces the per-call reset inside offsetBone.)
        if (!mixer) {
          const proceduralBones: (THREE.Bone | undefined)[] = [
            bHips, bSpine, bChest, bNeck, bHead, bJaw,
            bLUpperArm, bRUpperArm, bLForearm, bRForearm, bLHand, bRHand,
          ];
          for (const bone of proceduralBones) {
            if (bone) {
              const init = initQuats.get(bone);
              if (init) bone.quaternion.copy(init);
            }
          }
          for (const jawMesh of [jawBottomMesh, jawTopMesh]) {
            if (!jawMesh) continue;
            const jawInit = initJawMeshQuats.get(jawMesh);
            if (jawInit) jawMesh.quaternion.copy(jawInit);
            const jawPos = initJawMeshPositions.get(jawMesh);
            if (jawPos) jawMesh.position.copy(jawPos);
          }
          // Also reset any debug-manipulated bone not already in the above list
          const manips = boneManipulationsRef.current ?? {};
          for (const boneName of Object.keys(manips)) {
            const boneObj = boneCache.get(boneName);
            if (boneObj && !proceduralBones.includes(boneObj)) {
              const init = initQuats.get(boneObj);
              if (init) boneObj.quaternion.copy(init);
            }
          }
        }

        // ── Arm rest pose ────────────────────────────────────────────────────
        // Bones already at bind pose from reset block above; just multiply.
        if (!mixer) {
          const leftDownRad     = p.restPose.leftArmDown     * (Math.PI / 180);
          const leftForwardRad  = p.restPose.leftArmForward  * (Math.PI / 180);
          const leftOutwardRad  = p.restPose.leftArmOutward  * (Math.PI / 180);
          const rightDownRad    = p.restPose.rightArmDown    * (Math.PI / 180);
          const rightForwardRad = p.restPose.rightArmForward * (Math.PI / 180);
          const rightOutwardRad = p.restPose.rightArmOutward * (Math.PI / 180);

          if (bLUpperArm) {
            // Left arm: X positive swings forward, Y positive swings outward, Z negative for down
            tmpEuler.set(leftForwardRad, leftOutwardRad, -leftDownRad, "XYZ");
            tmpQuat.setFromEuler(tmpEuler);
            bLUpperArm.quaternion.multiply(tmpQuat);
          }
          if (bRUpperArm) {
            // Right arm: X positive swings forward, Y negative swings outward, Z positive for down
            tmpEuler.set(rightForwardRad, -rightOutwardRad, rightDownRad, "XYZ");
            tmpQuat.setFromEuler(tmpEuler);
            bRUpperArm.quaternion.multiply(tmpQuat);
          }
        }

        // ── Debug bone manipulations ───────────────────────────────────────────
        // Additive offsets on top of rest pose + procedural animation.
        // Uses boneCache for O(1) lookup instead of O(n) scene.traverse per bone.
        if (!mixer) {
          const manips = boneManipulationsRef.current ?? {};
          for (const [boneName, rotation] of Object.entries(manips)) {
            if (rotation.x === 0 && rotation.y === 0 && rotation.z === 0) continue;
            const boneObj = boneCache.get(boneName);
            if (!boneObj) continue;
            tmpEuler.set(rotation.x, rotation.y, rotation.z, "XYZ");
            tmpQuat.setFromEuler(tmpEuler);
            boneObj.quaternion.multiply(tmpQuat);
          }
        }

        // ── Distributed twist ─────────────────────────────────────────────────
        // After main bones are posed (rest pose + debug manipulation), distribute
        // the twist component across each chain's twist bones. This prevents the
        // "crushed" appearance when a well-rigged model has multi-segment twist
        // chains (e.g., upper-upper-arm-twist, lower-upper-arm-twist).
        //
        // CRITICAL: we decompose the DELTA rotation (current − bind pose), NOT
        // the absolute quaternion. Using the absolute quaternion would distribute
        // the T-pose arm orientation to twist bones every frame, causing
        // stretching/warping even at rest.
        //
        // Algorithm:
        //   delta = bindPose⁻¹ × currentQ     (rotation added since bind pose)
        //   project delta.xyz onto twist axis A → twistQ = normalize(A*proj, delta.w)
        //   each twist bone = bindPose * slerp(identity, twistQ, weight[i])
        // Prefer override chains from current config (live via ref); fall back to auto-detected.
        // This lets hierarchyConfig changes take effect without reloading the model.
        const _overrides = hierarchyConfigRef.current?.twistChainOverrides;
        const activeChains: TwistChain[] = (_overrides && _overrides.length > 0)
          ? _overrides.filter(c => c.enabled).map(c => ({
              mainBone: c.mainBone,
              twistBones: [...c.twistBones],
              axis: c.axis,
              distribution: c.distribution.length > 0
                ? [...c.distribution]
                : c.twistBones.map(() => 1 / c.twistBones.length),
            }))
          : twistChains;
        if (!mixer && activeChains.length > 0) {
          const manips = boneManipulationsRef.current ?? {};
          for (const chain of activeChains) {
            const mainBoneObj = boneCache.get(chain.mainBone);
            if (!mainBoneObj) continue;
            const mainInitQ = initQuats.get(mainBoneObj);
            if (!mainInitQ) continue;

            // delta = initQ.conjugate() * currentQ  (conjugate = inverse for unit quats)
            tmpTwistQ.copy(mainInitQ).conjugate().multiply(mainBoneObj.quaternion);

            // Extract twist component of delta around the longitudinal axis.
            // When axis is 'all', copy the full delta rotation without projection
            // (used for bones like UpperArm that must track swing + roll).
            const ax = chain.axis;
            if (ax !== 'all') {
              const axX = ax === 'x' ? 1 : 0;
              const axY = ax === 'y' ? 1 : 0;
              const axZ = ax === 'z' ? 1 : 0;
              const proj = tmpTwistQ.x * axX + tmpTwistQ.y * axY + tmpTwistQ.z * axZ;
              const deltaW = tmpTwistQ.w; // save before overwrite
              tmpTwistQ.set(axX * proj, axY * proj, axZ * proj, deltaW);
              if (tmpTwistQ.lengthSq() < 1e-10) continue; // no twist delta → skip
              tmpTwistQ.normalize();
            }
            // For 'all': tmpTwistQ already holds the full delta — use it as-is
            if (tmpTwistQ.lengthSq() < 1e-10) continue;

            for (let i = 0; i < chain.twistBones.length; i++) {
              const twistBoneName = chain.twistBones[i];
              // If user is directly manipulating this twist bone, leave it alone
              if (manips[twistBoneName] &&
                  (Math.abs(manips[twistBoneName].x) > 0.001 ||
                   Math.abs(manips[twistBoneName].y) > 0.001 ||
                   Math.abs(manips[twistBoneName].z) > 0.001)) continue;

              const twistBoneObj = boneCache.get(twistBoneName);
              if (!twistBoneObj) continue;

              const weight = chain.distribution[i] ?? (1 / chain.twistBones.length);

              // Reset to bind pose, then apply weighted delta twist
              const initTwist = initQuats.get(twistBoneObj);
              if (initTwist) twistBoneObj.quaternion.copy(initTwist);

              if (weight > 0.001) {
                tmpQuat.slerpQuaternions(identityQ, tmpTwistQ, weight);
                twistBoneObj.quaternion.multiply(tmpQuat);
              }
            }
          }
        }

        // ── Skeleton helper visibility and update ─────────────────────────────────────────
        if (skeletonHelper) {
          skeletonHelper.visible = showSkeletonHelperRef.current;
          // Update bone positions each frame for our filtered skeleton helper
          if (skeletonHelper instanceof FilteredSkeletonHelper && skeletonHelper.visible) {
            skeletonHelper.update();
          }
        }

        // ── Animation clip playback ────────────────────────────────────────────
        // When activeAnimationClip is set, drive bones via the mixer instead of
        // procedural animation. When cleared, restore bind pose.
        {
          const targetClip = activeAnimationClipRef.current ?? null;
          if (targetClip !== mixerCurrentClip) {
            // Clip changed — reset mixer state
            if (mixer) { mixer.stopAllAction(); mixer = null; }
            currentMixerAction = null;
            mixerCurrentClip = targetClip;

            if (targetClip && modelScene && clips.length > 0) {
              const clip = THREE.AnimationClip.findByName(clips, targetClip);
              if (clip) {
                mixer = new THREE.AnimationMixer(modelScene);
                currentMixerAction = mixer.clipAction(clip);
                currentMixerAction.setLoop(THREE.LoopOnce, 1);
                currentMixerAction.clampWhenFinished = true;
                currentMixerAction.play();
                if (!isAnimationPlayingRef.current) {
                  currentMixerAction.paused = true;
                  currentMixerAction.time = 0;
                  mixer.update(0);
                }
              }
            } else if (!targetClip) {
              // Animation deactivated — restore bind pose for all bones
              initQuats.forEach((q, b) => b.quaternion.copy(q));
            }
          }

          // Play/pause/scrub
          if (mixer && currentMixerAction) {
            const wantPlaying = isAnimationPlayingRef.current;
            if (wantPlaying) {
              currentMixerAction.paused = false;
              mixer.update(delta);
              // Emit current time to parent (for scrubber)
              onAnimationTimeChangeRef.current?.(
                currentMixerAction.time,
                currentMixerAction.getClip().duration,
              );
            } else {
              // Scrubbing — seek to the requested time without advancing
              currentMixerAction.paused = true;
              const desired = animationTimeRef.current;
              if (Math.abs(currentMixerAction.time - desired) > 0.001) {
                currentMixerAction.time = Math.max(
                  0,
                  Math.min(desired, currentMixerAction.getClip().duration),
                );
                mixer.update(0);
              }
            }
          }
        }

        // ── Breathing ────────────────────────────────────────────────────────
        if (p.breathing.enabled && !disableProceduralRef.current) {
          const rate  = (p.breathing.rate / 60) * 2 * Math.PI * p.idle.speed;
          const depth = p.breathing.depth * 0.018;
          const phase = Math.sin(t * rate);
          offsetBone(bSpine, phase * depth,       0, 0);
          offsetBone(bChest, phase * depth * 0.6, 0, 0);
        }

        // ── Idle sway ─────────────────────────────────────────────────────────
        if (p.idle.enabled && !disableProceduralRef.current) {
          const sp   = p.idle.speed;
          const int_ = p.idle.intensity;
          const sway = Math.sin(t * 0.38 * sp) * int_;
          const bob  = Math.sin(t * 0.55 * sp) * int_;
          offsetBone(bHips, bob * 0.005, sway * 0.008, sway * 0.012);
        }

        // ── Natural arm movement during idle ───────────────────────────────────
        // Multi-layered arm motion for natural standing pose:
        // 1. Gentle weight-shift swing (like shifting weight between feet)
        // 2. Subtle pendulum motion from breathing
        // 3. Micro-adjustments (fidgets, posture corrections)
        if (p.idle.enabled && !disableProceduralRef.current && !mixer) {
          const sp = p.idle.speed;
          const int_ = p.idle.intensity;
          
          // Weight-shift swing - arms swing opposite to body sway
          // When body sways right, left arm swings out slightly and vice versa
          const weightShift = Math.sin(t * 0.38 * sp) * int_;
          // Breathing-induced arm motion (shoulders rise/fall with breath)
          const breathPhase = Math.sin(t * (p.breathing.rate / 60) * 2 * Math.PI * sp);
          // Slow posture adjustments - occasional subtle repositioning
          const postureAdjust = Math.sin(t * 0.12 * sp) * int_;
          // Micro-tremor for natural muscle tension look
          const microTremor = Math.sin(t * 3.7 * sp) * 0.02 * int_;
          
          // Left arm motion (applied to upper arm)
          // Swing: outward on weight shift, subtle forward on breath
          const lArmSwing = weightShift * 0.03; // outward swing
          const lArmBreath = breathPhase * 0.015 * p.breathing.depth; // rise with breath
          const lArmPosture = postureAdjust * 0.02; // slow repositioning
          // Combined rotation: pitch (forward/back), yaw (outward/in), roll
          offsetBone(bLUpperArm,
            lArmBreath + microTremor,           // X: subtle forward on inhale + tremor
            lArmSwing + lArmPosture * 0.5,      // Y: outward swing + posture
            lArmSwing * 0.3 + microTremor * 0.5 // Z: slight roll
          );
          
          // Right arm motion (mirrored but slightly different phase for asymmetry)
          const rArmSwing = -weightShift * 0.03; // opposite swing
          const rArmBreath = breathPhase * 0.012 * p.breathing.depth; // slightly less than left
          const rArmPosture = Math.sin(t * 0.11 * sp) * int_ * 0.018; // different frequency
          const rMicroTremor = Math.sin(t * 4.1 * sp) * 0.018 * int_; // different tremor freq
          
          offsetBone(bRUpperArm,
            rArmBreath + rMicroTremor,
            rArmSwing + rArmPosture * 0.5,
            rArmSwing * 0.3 + rMicroTremor * 0.5
          );
          
          // Forearm follows upper arm with slight delay (pendulum effect)
          const lForearmSwing = Math.sin(t * 0.35 * sp) * int_ * 0.025;
          const rForearmSwing = Math.sin(t * 0.35 * sp + 0.3) * int_ * 0.022;
          offsetBone(bLForearm, lForearmSwing + microTremor * 0.5, lArmSwing * 0.3, 0);
          offsetBone(bRForearm, rForearmSwing + rMicroTremor * 0.5, rArmSwing * 0.3, 0);
          
          // Hands get subtle rotation from the arm motion chain
          const lHandRotate = Math.sin(t * 0.28 * sp) * int_ * 0.03;
          const rHandRotate = Math.sin(t * 0.28 * sp + 0.5) * int_ * 0.028;
          offsetBone(bLHand, lHandRotate, lForearmSwing * 0.2, lHandRotate * 0.5);
          offsetBone(bRHand, rHandRotate, rForearmSwing * 0.2, rHandRotate * 0.5);
        }

        // ── Head micro-movement ───────────────────────────────────────────────
        if (p.headMovement.enabled && !disableProceduralRef.current) {
          const r     = p.headMovement.range;
          // Multi-frequency head movement for more natural motion (increased amplitude)
          const yaw   = Math.sin(t * 0.22) * r * 0.12 + Math.sin(t * 0.37) * r * 0.05;
          const pitch = Math.sin(t * 0.17) * r * 0.08 + Math.sin(t * 0.29) * r * 0.04;
          const roll  = Math.sin(t * 0.31) * r * 0.04 + Math.sin(t * 0.43) * r * 0.02;
          // Occasional head tilts
          const tilt  = Math.sin(t * 0.08) * r * 0.06;
          offsetBone(bNeck, pitch * 0.4, yaw * 0.4, (roll + tilt) * 0.3);
          offsetBone(bHead, pitch * 0.6, yaw * 0.6, (roll + tilt) * 0.2);
        }

        // ── Jaw test control (for viseme development) ──────────────────────────────
        const jawTestValue = jawTestRef.current ?? 0;
        const hasJawOpenMorph = PRIMARY_JAW_OPEN_MORPHS.some((m) => m in currentMorphs);
        const speakingActive = speaking || amp > 0.01;
        const lipSyncEnabled = p.lipSync.enabled;
        const sens = p.lipSync.sensitivity;
        const jawScale = (p.lipSync as any).jawScale ?? 0.35;
        const visemeScale = (p.lipSync as any).visemeScale ?? 0.3;
        const jawAmp = lipSyncEnabled && speakingActive ? Math.min(1, amp * sens * jawScale * 2.2) : 0;

        // ── Eye blinking ──────────────────────────────────────────────────────
        if (morphMeshes.length > 0 && !isWire) {
          // Natural blink cycle: ~6-7 seconds between blinks (~8-9 blinks/min), blink lasts ~0.15s
          const blinkCycle = t % 7.0;
          const blinkPhase = blinkCycle > 6.85 ? Math.sin((blinkCycle - 6.85) / 0.15 * Math.PI) : 0;
          // Occasional double blink (roughly once every 15 seconds)
          const doubleBlinkCycle = t % 15.0;
          const doubleBlinkPhase = (doubleBlinkCycle > 14.7 && doubleBlinkCycle < 15.0)
            ? Math.sin((doubleBlinkCycle - 14.7) / 0.3 * Math.PI * 2) * 0.5 : 0;
          const blinkAmount = Math.max(0, Math.min(1, blinkPhase + doubleBlinkPhase));
          
          for (const name of BLINK_MORPHS) {
            if (name in currentMorphs) {
              currentMorphs[name] = THREE.MathUtils.lerp(currentMorphs[name] ?? 0, blinkAmount, 0.4);
              applyMorph(name, currentMorphs[name]);
            }
          }
        }

        // ── Subtle eye movement (saccades) ─────────────────────────────────────
        if (morphMeshes.length > 0 && p.headMovement.enabled && !isWire) {
          // Eyes occasionally look around subtly
          const eyeH = Math.sin(t * 0.13) * 0.15 + Math.sin(t * 0.07) * 0.1;
          const eyeV = Math.sin(t * 0.19) * 0.08;
          
          // Apply horizontal eye movement
          if (eyeH > 0) {
            for (const name of EYE_LOOK_MORPHS.right) {
              if (name in currentMorphs) {
                currentMorphs[name] = THREE.MathUtils.lerp(currentMorphs[name] ?? 0, eyeH, 0.1);
                applyMorph(name, currentMorphs[name]);
              }
            }
          } else {
            for (const name of EYE_LOOK_MORPHS.left) {
              if (name in currentMorphs) {
                currentMorphs[name] = THREE.MathUtils.lerp(currentMorphs[name] ?? 0, -eyeH, 0.1);
                applyMorph(name, currentMorphs[name]);
              }
            }
          }
          
          // Apply vertical eye movement
          if (eyeV > 0) {
            for (const name of EYE_LOOK_MORPHS.up) {
              if (name in currentMorphs) {
                currentMorphs[name] = THREE.MathUtils.lerp(currentMorphs[name] ?? 0, eyeV, 0.1);
                applyMorph(name, currentMorphs[name]);
              }
            }
          } else {
            for (const name of EYE_LOOK_MORPHS.down) {
              if (name in currentMorphs) {
                currentMorphs[name] = THREE.MathUtils.lerp(currentMorphs[name] ?? 0, -eyeV, 0.1);
                applyMorph(name, currentMorphs[name]);
              }
            }
          }
        }

        // ── Hand / forearm ────────────────────────────────────────────────────
        if (p.handMovement.enabled && !disableProceduralRef.current) {
          const hi = p.handMovement.intensity;
          const lp = Math.sin(t * 0.41) * hi;
          const rp = Math.sin(t * 0.41 + Math.PI) * hi;
          offsetBone(bLForearm, lp * 0.04, 0, lp * 0.02);
          offsetBone(bRForearm, rp * 0.04, 0, rp * 0.02);
          offsetBone(bLHand,    lp * 0.06, lp * 0.04, 0);
          offsetBone(bRHand,    rp * 0.06, rp * 0.04, 0);
        }

        // ── Lip sync via morph targets ────────────────────────────────────────
        if (lipSyncEnabled) {

          // ── Layer 1: Generic jaw / lip-open morphs follow amplitude ──────
          // These drive the overall "how open is the mouth" without any shape
          // commitment, giving natural jaw movement even during silence/pauses.
          // PH_* morphs are excluded here — they're handled in Layer 2.
          for (const name of LIP_MORPHS) {
            if (!(name in currentMorphs)) continue;
            if (name.startsWith("PH_")) continue; // handled by phoneme layer
            const isPrimaryOpen = PRIMARY_JAW_OPEN_MORPHS.some(
              (m) => m.toLowerCase() === name.toLowerCase(),
            );
            const openFloor = 0;
            const targetOpen = isPrimaryOpen
              ? Math.max(openFloor, jawAmp * 0.98)
              : jawAmp * 0.58;
            currentMorphs[name] = THREE.MathUtils.lerp(
              currentMorphs[name], targetOpen, isPrimaryOpen ? 0.5 : 0.42,
            );
            applyMorph(name, currentMorphs[name]);
          }

          // ── Layer 2: Phoneme-specific PH_* morphs from viseme scheduler ──
          // Coarticulated blend:
          // - primary active phoneme morph
          // - brief carryover from previous phoneme
          // - family companion shapes (rounding/closure/etc.)
          const viseme     = activeViseme;
          const mappings   = p.lipSync.visemeMappings;
          const levels     = (p.lipSync as any).visemeLevels as Record<string, number> | undefined;
          const isSilence  = !viseme || viseme === "SIL" || viseme === "SP";
          const shapeStrength = visemeShapeStrength(viseme);
          const activeFamily = phonemeFamily(viseme);
          const dyn = visemeDynamicsForFamily(activeFamily);
          const hasMorph = (name: string) => name in currentMorphs;

          const normalizedViseme = viseme ? viseme.toUpperCase() : null;
          if (normalizedViseme !== currentVisemeKey) {
            previousVisemeKey = currentVisemeKey;
            currentVisemeKey = normalizedViseme;
            visemeLastChangeAt = t;
          }
          const sinceChange = Math.max(0, t - visemeLastChangeAt);
          const prevCarry = Math.exp(-sinceChange / 0.11) * 0.38;

          // Rebuild mapping cache only when mapping object identity changes.
          if (mappings !== cachedMappingsRef) {
            cachedMappingsRef = mappings;
            const uniq = new Set<string>();
            for (const m of Object.values(mappings)) if (m) uniq.add(m);
            for (const m of phMorphNames) uniq.add(m);
            mappedMorphNamesCache = [...uniq];
          }

          // Clear and reuse blend buffers.
          for (const key of blendWeightKeys) delete blendWeights[key];
          blendWeightKeys = [];
          const addWeight = (morphName: string | null | undefined, weight: number) => {
            if (!morphName || weight <= 0) return;
            if (!hasMorph(morphName)) return;
            if (blendWeights[morphName] === undefined) {
              blendWeights[morphName] = weight;
              blendWeightKeys.push(morphName);
            } else {
              blendWeights[morphName] += weight;
            }
          };
          const phonemeLevel = (phoneme: string | null | undefined): number => {
            if (!phoneme) return 1;
            const raw = levels?.[phoneme];
            if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
            return Math.max(0, Math.min(100, raw)) / 100;
          };
          if (!isSilence && viseme) {
            addWeight(mappings[viseme], phonemeLevel(viseme));
          }
          if (!isSilence && previousVisemeKey && previousVisemeKey !== normalizedViseme) {
            addWeight(mappings[previousVisemeKey], prevCarry * phonemeLevel(previousVisemeKey));
          }
          // Family companions for more human articulation variety.
          switch (activeFamily) {
            case "rounded-vowel":
              addWeight("PH_O-U", 0.52);
              addWeight("PH_JAW_Fwd", 0.2);
              break;
            case "front-vowel":
              addWeight("PH_I-E", 0.5);
              break;
            case "open-vowel":
              addWeight("PH_A", 0.6);
              break;
            case "bilabial":
              addWeight("PH_B-P", 0.95);
              break;
            case "labiodental":
              addWeight("PH_V-F", 0.86);
              break;
            case "dental-alveolar":
              addWeight("PH_D-S", 0.74);
              break;
            case "postalveolar":
              addWeight("PH_CH-SH", 0.84);
              break;
            default:
              break;
          }
          // Normalize to keep blend bounded.
          let sum = 0;
          for (const k of blendWeightKeys) sum += blendWeights[k];
          if (sum > 1.15) {
            const scale = 1.15 / sum;
            for (const k of blendWeightKeys) blendWeights[k] *= scale;
          }

          for (const morphName of mappedMorphNamesCache) {
            if (!(morphName in currentMorphs)) continue;
            const blendWeight = blendWeights[morphName] ?? 0;
            const base = 0.13 + visemeScale * 0.22;
            const dynamic = jawAmp * (0.52 + visemeScale * 0.95);
            let target = (blendWeight > 0 && speakingActive)
              ? Math.min(1, blendWeight * (base + dynamic) * shapeStrength * dyn.gain)
              : 0;
            // Strong short closure for bilabials.
            if (activeFamily === "bilabial" && morphName === "PH_B-P" && speakingActive) {
              target = Math.max(target, 0.78 + jawAmp * 0.12);
            }
            // Faster attack (snappy viseme change), slower release (smooth decay)
            const rate = target > (currentMorphs[morphName] ?? 0) ? dyn.attack : dyn.release;
            currentMorphs[morphName] = THREE.MathUtils.lerp(
              currentMorphs[morphName] ?? 0, target, rate,
            );
            applyMorph(morphName, currentMorphs[morphName]);
          }
        }

        // ── Manual jaw-open morph test (post-lipsync, so it always wins) ───
        // PH_JAW_Fwd on this rig is mostly forward thrust, not true open.
        // This test slider drives explicit mouth-open morphs for reliable tuning.
        const jawOpenTest = jawTestRef.current ?? 0;
        if (morphMeshes.length > 0) {
          for (const morphName of JAW_OPEN_COMPANIONS) {
            if (!(morphName in currentMorphs)) continue;
            const rate = jawOpenTest > (currentMorphs[morphName] ?? 0) ? 0.5 : 0.35;
            currentMorphs[morphName] = THREE.MathUtils.lerp(
              currentMorphs[morphName] ?? 0, jawOpenTest * 0.95, rate,
            );
            applyMorph(morphName, currentMorphs[morphName]);
          }
        }

        // ── Lower-jaw mesh assist (single-pass, controlled hinge-like motion) ───
        const morphOpen = maxMouthOpenFromMorphs(currentMorphs, debugMorphsRef.current);
        const jawState = computeJawDriverState({
          jawTest: jawTestValue,
          jawAmp,
          morphOpen,
          hasJawOpenMorph,
        }, jawDriverConfig);

        if (bJaw && jawState.boneRot > 0.001) {
          offsetBone(bJaw, jawState.boneRot, 0, 0);
        }

        if (jawBottomMesh && jawState.assist > 0.001) {
          const jawPos = initJawMeshPositions.get(jawBottomMesh);
          offsetObject(jawBottomMesh, jawState.meshRot, 0, -jawState.meshRot * jawDriverConfig.meshBackTiltFactor);
          if (jawPos) {
            jawBottomMesh.position.set(
              jawPos.x,
              jawPos.y - jawState.meshDrop,
              jawPos.z - jawState.meshBack,
            );
          }
        } else if (jawTestValue > 0.001 && !jawMissingWarned) {
          jawMissingWarned = true;
          console.warn("[AvatarRenderer] Jaw Open Test active but Jaw_btm object is missing.");
        }

        // ── Expression morphs ─────────────────────────────────────────────────
        if (morphMeshes.length > 0 && !isWire) {
          const targets = EXPRESSION_MORPHS[p.expression] ?? {};
          const dbgActive = debugMorphsRef.current ?? {};
          // Collect all morphs managed by blink/eye/lip/debug systems so the
          // expression lerp doesn't fight manual test sliders or lip-sync.
          const managedMorphs = new Set([
            ...LIP_MORPHS,
            // All PH_* morphs referenced in the current viseme mappings must be
            // excluded from the expression system so they don't get overridden.
            ...Object.values(p.lipSync.visemeMappings).filter(Boolean),
            ...BLINK_MORPHS,
            ...EYE_LOOK_MORPHS.left,
            ...EYE_LOOK_MORPHS.right,
            ...EYE_LOOK_MORPHS.up,
            ...EYE_LOOK_MORPHS.down,
            // Keep clothing defaults stable.
            ...Object.keys(GARMENT_DEFAULT_MORPHS),
            // Any morph currently being driven by the debug/face-test system.
            ...Object.keys(dbgActive).filter((k) => (dbgActive[k] ?? 0) > 0),
          ]);
          for (const name of allMorphNames) {
            if (managedMorphs.has(name)) continue;
            const target = targets[name] ?? 0;
            currentMorphs[name] = THREE.MathUtils.lerp(currentMorphs[name] ?? 0, target, 0.05);
            applyMorph(name, currentMorphs[name]);
          }
        }

        // ── Idle facial twitches (random smile + asymmetric smirk pulses) ─────
        if (morphMeshes.length > 0 && !isWire) {
          const proceduralFaceEnabled = p.idle.enabled && !disableProceduralRef.current;
          if (!proceduralFaceEnabled) {
            idleSmileTarget = 0;
            idleSmirkRTarget = 0;
            idleSmirkLTarget = 0;
          } else {
            if (t >= nextIdleFacePulseAt) {
              const pulseDuration = 0.8 + Math.random() * 1.4;
              idleFacePulseEndAt = t + pulseDuration;
              // Smile up to 40%
              idleSmileTarget = Math.random() * 0.4;
              // Smirk (R/L) up to 20%, usually asymmetric.
              const side = Math.random();
              if (side < 0.34) {
                idleSmirkRTarget = Math.random() * 0.2;
                idleSmirkLTarget = Math.random() * 0.08;
              } else if (side < 0.68) {
                idleSmirkLTarget = Math.random() * 0.2;
                idleSmirkRTarget = Math.random() * 0.08;
              } else {
                idleSmirkRTarget = Math.random() * 0.16;
                idleSmirkLTarget = Math.random() * 0.16;
              }
              nextIdleFacePulseAt = idleFacePulseEndAt + 2.5 + Math.random() * 6.5;
            } else if (t > idleFacePulseEndAt) {
              idleSmileTarget = 0;
              idleSmirkRTarget = 0;
              idleSmirkLTarget = 0;
            }
          }

          // Respect manual debug sliders if they are actively driving these morphs.
          const dbg = debugMorphsRef.current ?? {};
          const debugSmile = Math.abs(dbg["EM_Mouth_smile"] ?? 0) > 0.0001;
          const debugSmirkR = Math.abs(dbg["EM_Mouth_R_Up"] ?? 0) > 0.0001;
          const debugSmirkL = Math.abs(dbg["EM_Mouth_L_Up"] ?? 0) > 0.0001;

          idleSmileCurrent = THREE.MathUtils.lerp(idleSmileCurrent, idleSmileTarget, idleSmileTarget > idleSmileCurrent ? 0.06 : 0.035);
          idleSmirkRCurrent = THREE.MathUtils.lerp(idleSmirkRCurrent, idleSmirkRTarget, idleSmirkRTarget > idleSmirkRCurrent ? 0.08 : 0.04);
          idleSmirkLCurrent = THREE.MathUtils.lerp(idleSmirkLCurrent, idleSmirkLTarget, idleSmirkLTarget > idleSmirkLCurrent ? 0.08 : 0.04);

          if (!debugSmile && "EM_Mouth_smile" in currentMorphs) {
            currentMorphs["EM_Mouth_smile"] = Math.max(currentMorphs["EM_Mouth_smile"] ?? 0, idleSmileCurrent);
            applyMorph("EM_Mouth_smile", currentMorphs["EM_Mouth_smile"]);
          }
          if (!debugSmirkR && "EM_Mouth_R_Up" in currentMorphs) {
            currentMorphs["EM_Mouth_R_Up"] = Math.max(currentMorphs["EM_Mouth_R_Up"] ?? 0, idleSmirkRCurrent);
            applyMorph("EM_Mouth_R_Up", currentMorphs["EM_Mouth_R_Up"]);
          }
          if (!debugSmirkL && "EM_Mouth_L_Up" in currentMorphs) {
            currentMorphs["EM_Mouth_L_Up"] = Math.max(currentMorphs["EM_Mouth_L_Up"] ?? 0, idleSmirkLCurrent);
            applyMorph("EM_Mouth_L_Up", currentMorphs["EM_Mouth_L_Up"]);
          }
        }

        // ── Garment defaults (Bra / Pantys at 100%) ───────────────────────────
        if (morphMeshes.length > 0) {
          for (const [morphName, defaultValue] of Object.entries(GARMENT_DEFAULT_MORPHS)) {
            if (!(morphName in currentMorphs)) continue;
            currentMorphs[morphName] = THREE.MathUtils.lerp(currentMorphs[morphName] ?? 0, defaultValue, 0.2);
            applyMorph(morphName, currentMorphs[morphName]);
          }
        }

        // ── Debug morph targets (manual testing / face-tab sliders) ────────────
        // Apply after all procedural systems so these always win.
        // Also write back into currentMorphs so procedural lerps resume from the
        // correct value rather than fighting back from 0 next frame.
        const dbg = debugMorphsRef.current;
        if (dbg && morphMeshes.length > 0) {
          for (const [name, value] of Object.entries(dbg)) {
            if (value === undefined) continue;
            if (Math.abs(value) < 0.0001) continue;
            if (name in GARMENT_DEFAULT_MORPHS) continue;
            // Apply regardless of whether name is already in currentMorphs —
            // the model might have morphs detected after initial load.
            currentMorphs[name] = value;
            applyMorph(name, value);
          }
        }

        // ── Camera ────────────────────────────────────────────────────────────
        const { theta, phi, radiusPct } = parseOrbit(orbitRef.current);
        const tgt    = parseTarget(targetRef.current);
        const radius = radiusPct * cachedMaxDim * 3.5;
        camera.position.copy(orbitToPosition(tgt, radius, theta, phi));
        camera.lookAt(tgt);

        renderer.render(scene, camera);
      };
      animate();

      cleanupFn = () => {
        ro.disconnect();
        mixer?.stopAllAction();
        if (skeletonHelper) {
          skeletonHelper.parent?.remove(skeletonHelper);
          skeletonHelper = null;
        }
        renderer.dispose();
        wireMat.dispose();
        wireEyeMat.dispose();
        wireLipMat.dispose();
        wireMouthMat.dispose();
        fillMat.dispose();
        normalMat.dispose();
        flatSkinMat.dispose();
        flatEyeMat.dispose();
        flatMouthMat.dispose();
        flatTeethMat.dispose();
        flatHairMat.dispose();
        meshProbeMat.dispose();
        const disposables = new Set<THREE.Material>();
        const collectMaterials = (mat: THREE.Material | THREE.Material[] | null | undefined) => {
          if (!mat) return;
          if (Array.isArray(mat)) {
            mat.forEach((m) => {
              if (m && typeof (m as THREE.Material).dispose === "function") disposables.add(m as THREE.Material);
            });
          } else {
            if (typeof (mat as THREE.Material).dispose === "function") disposables.add(mat as THREE.Material);
          }
        };
        normalModeMaterialsFull.forEach(collectMaterials);
        normalModeMaterialsNoTeeth.forEach(collectMaterials);
        normalModeMaterialsTeethOnly.forEach(collectMaterials);
        normalModeMaterialsNone.forEach(collectMaterials);
        disposables.forEach((m) => m.dispose());
        loadedSkinTextures.forEach((t) => t.dispose());
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      };
    }; // end setup()

    startSetup();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animId);
      cancelAnimationFrame(waitFrame);
      cleanupFn?.();
    };
  }, [src]); // re-mount only on model change; all other values flow via refs

  const mode = renderMode; // captured for style calculation (sync with ref)
  return (
    <div className="relative w-full h-full">
      <div
        ref={mountRef}
        style={{
          width: "100%",
          height: "100%",
          filter: mode !== "normal" ? computeGlowFilter(appearance) : "none",
        }}
      />
      <div
        ref={hudRef}
        className={`pointer-events-none absolute left-2 top-2 z-[60] rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-mono text-white/90 shadow-[0_0_4px_rgba(0,0,0,0.6)] select-none ${showStats ? "" : "hidden"}`}
      >
        FPS --
      </div>
    </div>
  );
}

export default AvatarRenderer;
