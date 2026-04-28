import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PHONEME_BLENDS, MORPH_BLEND_KEYS } from "./phonemeBlends";
import type { PhonemeEvent } from "./phonemeUtils";

interface MeshSettingInput {
  key: string;
  visible: boolean;
  color: string;
  opacity: number;
  textureUrl: string;
}

export interface AvatarStageConfig {
  assetKind: "image" | "glb";
  assetUrl: string;
  assetName: string;
  meshSettings: MeshSettingInput[];
  bgColor: string;
  bgOpacity: number;
  morphs: { name: string; value: number }[];
  armBones: { key: string; x: number; y: number; z: number }[];
}

interface Runtime {
  dispose: () => void;
  key: string;
}

const runtimes = new WeakMap<HTMLElement, Runtime>();
const mountedStages = new Set<HTMLElement>();

const LIP_MORPHS = [
  "jawOpen",
  "jaw_open",
  "Jaw_Open",
  "mouthOpen",
  "viseme_aa",
  "A",
  "PH_JAW_Fwd",
  "PH_A",
  "PH_O-U",
  "PH_B-P",
  "PH_D-S",
  "PH_V-F",
  "PH_I-E",
  "PH_CH-SH",
  "EM_Mouth_open",
];

const JAW_MORPHS = [
  "jawOpen", "jaw_open", "Jaw_Open", "mouthOpen",
];

const MESH_GROUP_PATTERNS: [string, string[]][] = [
  ["body", ["bodyclothdriver"]],
  ["eyebrows", ["eyebrow", "brow", "lash", "eyelash"]],
  ["hair", ["hair"]],
  ["eyes", ["eye", "iris", "pupil", "eyeball", "sclera"]],
  ["jaw", ["jaw"]],
  ["tongue", ["tongue"]],
];

let speechAmplitude = 0;
let speechActive = false;
let lipSyncStrength = 0.7;
let lipSyncJawBlend = 0.4;

let phonemeTimeline: PhonemeEvent[] | null = null;
let phonemeTimelineStartMs = 0;
let phonemeTimelineIndex = 0;

export function setAvatarSpeechState(input: { active: boolean; amplitude: number }): void {
  speechActive = input.active;
  speechAmplitude = Math.max(0, Math.min(1, input.amplitude));
}

export function setAvatarPhonemeTimeline(
  timeline: PhonemeEvent[] | null,
  startMs?: number,
): void {
  phonemeTimeline = timeline;
  phonemeTimelineStartMs = startMs ?? performance.now();
  phonemeTimelineIndex = 0;
}

export function setAvatarLipSyncSettings(input: {
  strength?: number;
  jawBlend?: number;
}): void {
  if (input.strength !== undefined) lipSyncStrength = input.strength;
  if (input.jawBlend !== undefined) lipSyncJawBlend = input.jawBlend;
}

function matchMeshGroup(nodeName: string): string {
  const key = nodeName.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [group, patterns] of MESH_GROUP_PATTERNS) {
    if (patterns.some((p) => key.includes(p))) return group;
  }
  return "body";
}

export function mountAvatarStages(root: ParentNode = document): void {
  const stages = Array.from(root.querySelectorAll<HTMLElement>("[data-avatar-stage]"));
  const live = new Set(stages);
  for (const stage of stages) {
    const config = readStageConfig(stage);
    if (!config) continue;
    const key = `${config.assetKind}:${config.assetUrl}:${JSON.stringify(config.meshSettings)}:${JSON.stringify(config.morphs)}:${JSON.stringify(config.armBones)}`;
    const existing = runtimes.get(stage);
    if (existing?.key === key) continue;
    existing?.dispose();
    stage.innerHTML = "";
    runtimes.set(stage, {
      key,
      dispose: config.assetKind === "image" ? mountImage(stage, config) : mountGlb(stage, config)
    });
    mountedStages.add(stage);
  }
  Array.from(mountedStages).forEach((stage) => {
    if (live.has(stage)) return;
    runtimes.get(stage)?.dispose();
    runtimes.delete(stage);
    mountedStages.delete(stage);
  });
}

export function disposeAvatarStages(): void {
  Array.from(mountedStages).forEach((stage) => {
    runtimes.get(stage)?.dispose();
    runtimes.delete(stage);
    mountedStages.delete(stage);
  });
}

function readStageConfig(stage: HTMLElement): AvatarStageConfig | null {
  const assetKind = stage.dataset.avatarAssetKind === "image" ? "image" : "glb";
  const assetUrl = stage.dataset.avatarAssetUrl?.trim() || "";
  if (!assetUrl) return null;
  let meshSettings: MeshSettingInput[] = [];
  try {
    const raw = stage.dataset.avatarMeshSettings?.trim();
    if (raw) meshSettings = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  let morphs: { name: string; value: number }[] = [];
  let armBones: { key: string; x: number; y: number; z: number }[] = [];
  try {
    const rawMorphs = stage.dataset.avatarMorphs?.trim();
    if (rawMorphs) morphs = JSON.parse(rawMorphs);
  } catch { /* ignore */ }
  try {
    const rawBones = stage.dataset.avatarArmBones?.trim();
    if (rawBones) armBones = JSON.parse(rawBones);
  } catch { /* ignore */ }
  return {
    assetKind,
    assetUrl,
    assetName: stage.dataset.avatarAssetName?.trim() || (assetKind === "image" ? "Avatar image" : "Avatar model"),
    meshSettings,
    bgColor: stage.dataset.avatarBgColor?.trim() || "#000000",
    bgOpacity: parseFloat(stage.dataset.avatarBgOpacity ?? "50") / 100,
    morphs,
    armBones
  };
}

function mountImage(stage: HTMLElement, config: AvatarStageConfig): () => void {
  const img = document.createElement("img");
  img.className = "avatar-preview-image";
  img.alt = config.assetName;
  img.src = config.assetUrl;
  stage.appendChild(img);
  return () => {
    img.remove();
  };
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function applyFallbackJaw(
  jaw: number,
  morphMeshes: Array<{ mesh: THREE.Mesh; dict: Record<string, number>; values: Record<string, number> }>,
): void {
  for (const entry of morphMeshes) {
    for (const name of LIP_MORPHS) {
      const idx = entry.dict[name];
      if (idx === undefined || !entry.mesh.morphTargetInfluences) continue;
      const current = entry.values[name] ?? 0;
      const next = THREE.MathUtils.lerp(current, jaw, 0.35);
      entry.values[name] = next;
      entry.mesh.morphTargetInfluences[idx] = next;
    }
  }
}

function mountGlb(stage: HTMLElement, config: AvatarStageConfig): () => void {
  let disposed = false;
  let frame = 0;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new THREE.Color(config.bgColor), config.bgOpacity);
  stage.appendChild(renderer.domElement);

  const settingsMap = new Map<string, MeshSettingInput>();
  for (const ms of config.meshSettings) settingsMap.set(ms.key, ms);
  const wireSetting = settingsMap.get("wireframe");
  const showWire = wireSetting?.visible ?? true;
  const wireColor = wireSetting?.color ?? "#00ccff";
  const wireOpacity = wireSetting?.opacity ?? 1;

  const wireMat = showWire
    ? new THREE.MeshBasicMaterial({
        color: wireColor,
        wireframe: true,
        transparent: wireOpacity < 1,
        opacity: wireOpacity,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      })
    : null;

  const createdMaterials: THREE.MeshBasicMaterial[] = [];
  const createdTextures: THREE.Texture[] = [];

  function makeFillMat(setting: MeshSettingInput): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({
      color: setting.color,
      transparent: setting.opacity < 1,
      opacity: setting.opacity,
      side: THREE.DoubleSide
    });
    createdMaterials.push(mat);
    if (setting.textureUrl) {
      new THREE.TextureLoader().load(setting.textureUrl, (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        mat.map = tex;
        mat.needsUpdate = true;
        createdTextures.push(tex);
      });
    }
    return mat;
  }

  const clock = new THREE.Clock();
  const loader = new GLTFLoader();
  const morphMeshes: Array<{ mesh: THREE.Mesh; dict: Record<string, number>; values: Record<string, number> }> = [];
  const bones = {
    hips: undefined as THREE.Bone | undefined,
    spine: undefined as THREE.Bone | undefined,
    chest: undefined as THREE.Bone | undefined,
    neck: undefined as THREE.Bone | undefined,
    head: undefined as THREE.Bone | undefined,
    lClavicle: undefined as THREE.Bone | undefined,
    rClavicle: undefined as THREE.Bone | undefined,
    lUpperArm: undefined as THREE.Bone | undefined,
    rUpperArm: undefined as THREE.Bone | undefined,
    lForearm: undefined as THREE.Bone | undefined,
    rForearm: undefined as THREE.Bone | undefined,
    lHand: undefined as THREE.Bone | undefined,
    rHand: undefined as THREE.Bone | undefined
  };
  const initQuats = new Map<THREE.Bone, THREE.Quaternion>();
  const tmpEuler = new THREE.Euler();
  const tmpQuat = new THREE.Quaternion();
  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  let model: THREE.Object3D | null = null;
  let maxDim = 2;

  const resize = () => {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  resize();

  const groupMats = new Map<string, THREE.MeshBasicMaterial>();

  loader.load(
    config.assetUrl,
    (gltf) => {
      if (disposed) return;
      model = gltf.scene;
      model.traverse((node) => {
        if (node instanceof THREE.Bone) initQuats.set(node, node.quaternion.clone());
        if (!(node instanceof THREE.Mesh)) return;
        const group = matchMeshGroup(node.name);
        const setting = settingsMap.get(group);
        if (!setting || !setting.visible) {
          node.visible = false;
          return;
        }
        let mat = groupMats.get(group);
        if (!mat) {
          mat = makeFillMat(setting);
          groupMats.set(group, mat);
        }
        node.material = mat;
        node.renderOrder = 0;
        if (node.morphTargetDictionary && node.morphTargetInfluences) {
          morphMeshes.push({ mesh: node, dict: node.morphTargetDictionary, values: {} });
        }
        if (wireMat && group !== "eyes") {
          const wireClone = node.clone();
          wireClone.material = wireMat;
          wireClone.renderOrder = 1;
          node.parent?.add(wireClone);
          if (wireClone instanceof THREE.Mesh && wireClone.morphTargetDictionary && wireClone.morphTargetInfluences) {
            morphMeshes.push({ mesh: wireClone, dict: wireClone.morphTargetDictionary, values: {} });
          }
        }
      });
      bones.hips = findBone(model, "hips", "pelvis", "root");
      bones.spine = findBone(model, "spine", "spine1", "spine01");
      bones.chest = findBone(model, "chest", "spine2", "spine02", "upperchest");
      bones.neck = findBone(model, "neck");
      bones.head = findBone(model, "head");
      bones.lClavicle = findBone(model, "lclavicle", "claviclel");
      bones.rClavicle = findBone(model, "rclavicle", "clavicler");
      bones.lUpperArm = findBone(model, "lupperarm", "upperarml");
      bones.rUpperArm = findBone(model, "rupperarm", "upperarmr");
      bones.lForearm = findBone(model, "lforearm", "forearml");
      bones.rForearm = findBone(model, "rforearm", "forearmr");
      bones.lHand = findBone(model, "lhand", "handl");
      bones.rHand = findBone(model, "rhand", "handr");

      scene.add(model);
      tmpBox.setFromObject(model);
      tmpBox.getSize(tmpSize);
      maxDim = Math.max(tmpSize.x, tmpSize.y, tmpSize.z, 0.5);
    },
    undefined,
    () => {
      stage.dataset.avatarError = "true";
    }
  );

  const animate = () => {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    resetBones(initQuats);
    const breath = Math.sin(t * 1.45) * 0.006;
    offsetBone(bones.spine, breath, 0, 0, tmpEuler, tmpQuat);
    offsetBone(bones.chest, breath * 0.7, 0, 0, tmpEuler, tmpQuat);
    const yaw = Math.sin(t * 0.28) * 0.018;
    const pitch = Math.sin(t * 0.21) * 0.012;
    offsetBone(bones.neck, pitch * 0.4, yaw * 0.4, 0, tmpEuler, tmpQuat);
    offsetBone(bones.head, pitch * 0.6, yaw * 0.6, 0, tmpEuler, tmpQuat);

    for (const entry of morphMeshes) {
      if (!entry.mesh.morphTargetInfluences) continue;
      for (let i = 0; i < entry.mesh.morphTargetInfluences.length; i++) {
        entry.mesh.morphTargetInfluences[i] = 0;
      }
    }

    const jaw = speechActive ? Math.min(1, speechAmplitude * 3.2) : 0;

    const tl = phonemeTimeline;
    const hasTimeline = tl && tl.length > 0 && speechActive;

    if (hasTimeline) {
      const elapsed = performance.now() - phonemeTimelineStartMs;

      while (
        phonemeTimelineIndex < tl.length - 1 &&
        tl[phonemeTimelineIndex + 1]!.startMs <= elapsed
      ) {
        phonemeTimelineIndex++;
      }

      const current = tl[phonemeTimelineIndex] ?? tl[0];
      const next = phonemeTimelineIndex + 1 < tl.length
        ? tl[phonemeTimelineIndex + 1]
        : null;

      if (!current) { applyFallbackJaw(jaw, morphMeshes); }
      else {
      const currentPhoneme =
        elapsed >= current.startMs && elapsed < current.endMs
          ? current.phoneme
          : "SIL";
      const isSilence = currentPhoneme === "SIL" || currentPhoneme === "SP";

      let blendT = 0;
      const anticipationMs = 40;
      if (next && !isSilence) {
        const remaining = current.endMs - elapsed;
        if (remaining > 0 && remaining < anticipationMs) {
          blendT = smoothstep(1 - remaining / anticipationMs);
        }
      }

      const currentBlend = PHONEME_BLENDS[currentPhoneme] ?? {};
      const nextBlend = next ? (PHONEME_BLENDS[next.phoneme] ?? {}) : {};

      const effectiveAmp = Math.max(jaw * lipSyncJawBlend, isSilence ? 0 : jaw);

      for (const morphName of LIP_MORPHS) {
        const isPhonemeMorph = MORPH_BLEND_KEYS.includes(morphName as typeof MORPH_BLEND_KEYS[number]);

        if (isPhonemeMorph) {
          const w1 = currentBlend[morphName] ?? 0;
          const w2 = nextBlend[morphName] ?? 0;
          const weight = w1 + (w2 - w1) * blendT;

          for (const entry of morphMeshes) {
            const idx = entry.dict[morphName];
            if (idx === undefined || !entry.mesh.morphTargetInfluences) continue;
            const current = entry.values[morphName] ?? 0;

            if (weight <= 0 || isSilence) {
              const next2 = THREE.MathUtils.lerp(current, 0, 0.25);
              entry.values[morphName] = next2;
              entry.mesh.morphTargetInfluences[idx] = next2;
            } else {
              const target = Math.min(1, weight * effectiveAmp * lipSyncStrength * 1.2);
              const rate = target > current ? 0.45 : 0.25;
              const next2 = THREE.MathUtils.lerp(current, target, rate);
              entry.values[morphName] = next2;
              entry.mesh.morphTargetInfluences[idx] = next2;
            }
          }
        } else {
          for (const entry of morphMeshes) {
            const idx = entry.dict[morphName];
            if (idx === undefined || !entry.mesh.morphTargetInfluences) continue;
            const current = entry.values[morphName] ?? 0;
            const isPrimaryOpen = JAW_MORPHS.some((m) => m === morphName);
            const targetOpen = isPrimaryOpen ? jaw : jaw * 0.6;
            const next2 = THREE.MathUtils.lerp(
              current, targetOpen, speechActive ? 0.35 : 0.18,
            );
            entry.values[morphName] = next2;
            entry.mesh.morphTargetInfluences[idx] = next2;
          }
        }
      }
      }
    } else {
      for (const entry of morphMeshes) {
        for (const name of LIP_MORPHS) {
          const idx = entry.dict[name];
          if (idx === undefined || !entry.mesh.morphTargetInfluences) continue;
          const current = entry.values[name] ?? 0;
          const next = THREE.MathUtils.lerp(current, jaw, speechActive ? 0.35 : 0.18);
          entry.values[name] = next;
          entry.mesh.morphTargetInfluences[idx] = next;
        }
      }
    }

    for (const entry of morphMeshes) {
      if (!entry.mesh.morphTargetInfluences) continue;
      for (const ms of config.morphs) {
        const idx = entry.dict[ms.name];
        if (idx !== undefined && ms.value > 0) entry.mesh.morphTargetInfluences[idx] = ms.value;
      }
    }

    for (const bs of config.armBones) {
      const bone = (bones as Record<string, THREE.Bone | undefined>)[bs.key];
      if (!bone) continue;
      const deg = Math.PI / 180;
      tmpEuler.set(bs.x * deg, bs.y * deg, bs.z * deg, "XYZ");
      tmpQuat.setFromEuler(tmpEuler);
      bone.quaternion.multiply(tmpQuat);
    }

    const target = new THREE.Vector3(0, 1.5, 0);
    const radius = 0.12 * maxDim * 3.5;
    const phi = 78 * (Math.PI / 180);
    camera.position.set(0, target.y + radius * Math.cos(phi), target.z + radius * Math.sin(phi));
    camera.lookAt(target);
    renderer.render(scene, camera);
  };
  animate();

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    for (const t of createdTextures) t.dispose();
    for (const m of createdMaterials) m.dispose();
    if (wireMat) wireMat.dispose();
    renderer.dispose();
    stage.innerHTML = "";
  };
}

function findBone(root: THREE.Object3D, ...names: string[]): THREE.Bone | undefined {
  const lower = names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ""));
  let found: THREE.Bone | undefined;
  root.traverse((node) => {
    if (found || !(node instanceof THREE.Bone)) return;
    const key = node.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (lower.some((name) => key.includes(name))) found = node;
  });
  return found;
}

function resetBones(initQuats: Map<THREE.Bone, THREE.Quaternion>): void {
  initQuats.forEach((quat, bone) => bone.quaternion.copy(quat));
}

function offsetBone(
  bone: THREE.Bone | undefined,
  x: number,
  y: number,
  z: number,
  euler: THREE.Euler,
  quat: THREE.Quaternion
): void {
  if (!bone) return;
  euler.set(x, y, z, "XYZ");
  quat.setFromEuler(euler);
  bone.quaternion.multiply(quat);
}
