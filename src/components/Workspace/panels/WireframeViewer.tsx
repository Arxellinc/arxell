import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AvatarAnimSettings, computeGlowFilter } from "./avatarTypes";

// Re-export so existing imports from this file still work.
export type { AvatarAnimSettings } from "./avatarTypes";
export { DEFAULT_ANIM_SETTINGS, computeGlowFilter } from "./avatarTypes";

interface Props {
  src: string;
  cameraOrbit: string;
  cameraTarget: string;
  settings: AvatarAnimSettings;
  fillFace: boolean;
  isSpeaking: boolean;
  amplitude: number;
  onLoad?: () => void;
  onError?: () => void;
}

// ── Expression morph weights ─────────────────────────────────────────────────

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

const LIP_MORPHS = ["jawOpen", "jaw_open", "Jaw_Open", "mouthOpen", "viseme_aa", "A"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseOrbit(orbit: string) {
  const p = orbit.trim().split(/\s+/);
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

function orbitToPosition(target: THREE.Vector3, radius: number, theta: number, phi: number) {
  return new THREE.Vector3(
    target.x + radius * Math.sin(phi) * Math.sin(theta),
    target.y + radius * Math.cos(phi),
    target.z + radius * Math.sin(phi) * Math.cos(theta),
  );
}

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

const FACE_KEYWORDS = [
  "head", "face", "eye", "eyebrow", "eyelash", "eyelid",
  "teeth", "tooth", "tongue", "mouth", "lip", "nose",
  "ear", "skull", "jaw", "cheek", "brow", "iris", "pupil",
];

function isFaceMesh(name: string): boolean {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return FACE_KEYWORDS.some((k) => key.includes(k));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WireframeViewer({
  src, cameraOrbit, cameraTarget, settings, fillFace, isSpeaking, amplitude, onLoad, onError,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  const orbitRef     = useRef(cameraOrbit);
  const targetRef    = useRef(cameraTarget);
  const settingsRef  = useRef(settings);
  const fillFaceRef  = useRef(fillFace);
  const speakingRef  = useRef(isSpeaking);
  const amplitudeRef = useRef(amplitude);
  orbitRef.current    = cameraOrbit;
  targetRef.current   = cameraTarget;
  settingsRef.current = settings;
  fillFaceRef.current = fillFace;
  speakingRef.current = isSpeaking;
  amplitudeRef.current = amplitude;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let cancelled = false;
    let animId    = 0;
    let waitFrame = 0;

    // Defer setup until the container has non-zero dimensions (layout painted).
    const startSetup = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if ((w === 0 || h === 0) && !cancelled) {
        waitFrame = requestAnimationFrame(startSetup);
        return;
      }
      if (cancelled) return;
      setup(w || 400, h || 600);
    };

    const setup = (initW: number, initH: number) => {
      // ── Renderer ─────────────────────────────────────────────────────────
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch (err) {
        console.error("[WireframeViewer] WebGLRenderer creation failed:", err);
        onError?.();
        return;
      }
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setClearColor(0x000000, 0);
      renderer.setSize(initW, initH);
      mount.appendChild(renderer.domElement);

      // ── Scene / Camera ────────────────────────────────────────────────────
      const scene  = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, initW / initH, 0.01, 100);

      // ── Materials ─────────────────────────────────────────────────────────
      const wireMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, wireframe: true });
      const fillMat = new THREE.MeshBasicMaterial({
        color: 0x001a33, transparent: true, opacity: 0.18, side: THREE.FrontSide,
      });
      const faceMat = new THREE.MeshBasicMaterial({
        color: 0x002233, side: THREE.FrontSide,
      });

      // ── Runtime state ─────────────────────────────────────────────────────
      let mixer: THREE.AnimationMixer | null = null;
      const clock = new THREE.Clock();

      let bHips:        THREE.Bone | undefined;
      let bSpine:       THREE.Bone | undefined;
      let bChest:       THREE.Bone | undefined;
      let bNeck:        THREE.Bone | undefined;
      let bHead:        THREE.Bone | undefined;
      let bLUpperArm:   THREE.Bone | undefined;
      let bRUpperArm:   THREE.Bone | undefined;
      let bLForearm:    THREE.Bone | undefined;
      let bRForearm:    THREE.Bone | undefined;
      let bLHand:       THREE.Bone | undefined;
      let bRHand:       THREE.Bone | undefined;

      const initQuats = new Map<THREE.Bone, THREE.Quaternion>();

      interface MeshEntry  { mesh: THREE.Mesh; isFace: boolean }
      const allMeshes: MeshEntry[] = [];

      interface MorphEntry { mesh: THREE.Mesh; dict: Record<string, number> }
      const morphMeshes: MorphEntry[] = [];
      const currentMorphs: Record<string, number> = {};
      let allMorphNames: string[] = [];

      let cachedMaxDim = 2;

      const tmpEuler = new THREE.Euler();
      const tmpQuat  = new THREE.Quaternion();
      const tmpBox   = new THREE.Box3();
      const tmpSize  = new THREE.Vector3();
      const tmpVec   = new THREE.Vector3();
      const tmpColor = new THREE.Color();

      // ── Bone offset helper ──────────────────────────────────────────────
      function offsetBone(bone: THREE.Bone | undefined, ex: number, ey: number, ez: number) {
        if (!bone) return;
        if (!mixer) {
          const init = initQuats.get(bone);
          if (init) bone.quaternion.copy(init);
        }
        tmpEuler.set(ex, ey, ez, "XYZ");
        tmpQuat.setFromEuler(tmpEuler);
        bone.quaternion.multiply(tmpQuat);
      }

      // ── Morph helper ────────────────────────────────────────────────────
      function applyMorph(name: string, value: number) {
        for (const { mesh, dict } of morphMeshes) {
          const idx = dict[name];
          if (idx !== undefined && mesh.morphTargetInfluences) {
            mesh.morphTargetInfluences[idx] = value;
          }
        }
      }

      // ── Load GLB ──────────────────────────────────────────────────────
      new GLTFLoader().load(
        src,
        (gltf) => {
          if (cancelled) return;

          const initFillFace = fillFaceRef.current;

          gltf.scene.traverse((node) => {
            if (node instanceof THREE.Bone) {
              initQuats.set(node, node.quaternion.clone());
            }
            if (node instanceof THREE.Mesh) {
              if (node.morphTargetDictionary && node.morphTargetInfluences) {
                morphMeshes.push({ mesh: node, dict: node.morphTargetDictionary });
                for (const k of Object.keys(node.morphTargetDictionary)) {
                  currentMorphs[k] = 0;
                }
              }
              const face = isFaceMesh(node.name);
              allMeshes.push({ mesh: node, isFace: face });
              node.material = face && initFillFace ? faceMat : wireMat;
              if (!face && !(node instanceof THREE.SkinnedMesh)) {
                const fill = node.clone();
                fill.material = fillMat.clone();
                node.parent?.add(fill);
              }
            }
          });

          const nameSet = new Set<string>();
          for (const { dict } of morphMeshes) Object.keys(dict).forEach((k) => nameSet.add(k));
          allMorphNames = [...nameSet];

          bHips      = findBone(gltf.scene, "hips", "pelvis", "root");
          bSpine     = findBone(gltf.scene, "spine", "spine1", "spine01");
          bChest     = findBone(gltf.scene, "chest", "spine2", "spine02", "upperchest");
          bNeck      = findBone(gltf.scene, "neck");
          bHead      = findBone(gltf.scene, "head");
          bLUpperArm = findBone(gltf.scene, "leftupperarm", "leftarm", "lupperarm", "upperarml", "arml", "shoulderl");
          bRUpperArm = findBone(gltf.scene, "rightupperarm", "rightarm", "rupperarm", "upperarmr", "armr", "shoulderr");
          bLForearm  = findBone(gltf.scene, "leftforearm", "leftlowerarm", "lforearm", "forearm_l");
          bRForearm  = findBone(gltf.scene, "rightforearm", "rightlowerarm", "rforearm", "forearm_r");
          bLHand     = findBone(gltf.scene, "lefthand", "lhand", "hand_l");
          bRHand     = findBone(gltf.scene, "righthand", "rhand", "hand_r");

          scene.add(gltf.scene);
          gltf.scene.updateMatrixWorld(true);

          tmpBox.setFromObject(gltf.scene);
          tmpBox.getSize(tmpSize);
          cachedMaxDim = Math.max(tmpSize.x, tmpSize.y, tmpSize.z, 0.5);

          // Head-bone proximity face detection.
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

          if (gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(gltf.scene);
            gltf.animations.forEach((clip) => mixer!.clipAction(clip).play());
          }

          onLoad?.();
        },
        undefined,
        () => { if (!cancelled) onError?.(); },
      );

      // ── Resize ──────────────────────────────────────────────────────────
      const ro = new ResizeObserver(() => {
        const rw = mount.clientWidth;
        const rh = mount.clientHeight;
        if (rw > 0 && rh > 0) {
          renderer.setSize(rw, rh);
          camera.aspect = rw / rh;
          camera.updateProjectionMatrix();
        }
      });
      ro.observe(mount);

      // ── Render loop ──────────────────────────────────────────────────────
      const animate = () => {
        animId = requestAnimationFrame(animate);
        const delta = clock.getDelta();
        const t     = clock.getElapsedTime();

        mixer?.update(delta);

        const s        = settingsRef.current;
        const speaking = speakingRef.current;
        const amp      = amplitudeRef.current;

        // Appearance (colour + fill opacity, updated live from settings).
        wireMat.color.set(s.appearance.wireColor);
        fillMat.opacity = s.appearance.fillOpacity;
        tmpColor.set(s.appearance.wireColor).multiplyScalar(0.22);
        faceMat.color.copy(tmpColor);
        for (const { mesh, isFace } of allMeshes) {
          if (isFace) mesh.material = fillFaceRef.current ? faceMat : wireMat;
        }

        // Arm rest pose.
        // Each arm has independent down/forward controls.
        if (!mixer) {
          const leftDownRad    = s.restPose.leftArmDown    * (Math.PI / 180);
          const leftForwardRad = s.restPose.leftArmForward * (Math.PI / 180);
          const rightDownRad    = s.restPose.rightArmDown    * (Math.PI / 180);
          const rightForwardRad = s.restPose.rightArmForward * (Math.PI / 180);

          if (bLUpperArm) {
            const init = initQuats.get(bLUpperArm);
            if (init) {
              bLUpperArm.quaternion.copy(init);
              // Left arm: Z is negative for down, X positive swings forward
              tmpEuler.set(leftForwardRad, 0, -leftDownRad, "XYZ");
              tmpQuat.setFromEuler(tmpEuler);
              bLUpperArm.quaternion.multiply(tmpQuat);
            }
          }
          if (bRUpperArm) {
            const init = initQuats.get(bRUpperArm);
            if (init) {
              bRUpperArm.quaternion.copy(init);
              // Right arm: Z is positive for down, X positive swings forward
              tmpEuler.set(rightForwardRad, 0, rightDownRad, "XYZ");
              tmpQuat.setFromEuler(tmpEuler);
              bRUpperArm.quaternion.multiply(tmpQuat);
            }
          }
        }

        // Breathing.
        if (s.breathing.enabled) {
          const rate  = (s.breathing.rate / 60) * 2 * Math.PI * s.idle.speed;
          const depth = s.breathing.depth * 0.018;
          const phase = Math.sin(t * rate);
          offsetBone(bSpine, phase * depth,        0, 0);
          offsetBone(bChest, phase * depth * 0.6,  0, 0);
        }

        // Idle sway.
        if (s.idle.enabled) {
          const sp  = s.idle.speed;
          const in_ = s.idle.intensity;
          const sway = Math.sin(t * 0.38 * sp) * in_;
          const bob  = Math.sin(t * 0.55 * sp) * in_;
          offsetBone(bHips, bob * 0.005, sway * 0.008, sway * 0.012);
        }

        // Head micro-movement.
        if (s.headMovement.enabled && !speaking) {
          const r     = s.headMovement.range;
          const yaw   = Math.sin(t * 0.22) * r * 0.06;
          const pitch = Math.sin(t * 0.17) * r * 0.03;
          const roll  = Math.sin(t * 0.31) * r * 0.02;
          offsetBone(bNeck, pitch * 0.4, yaw * 0.4, roll * 0.3);
          offsetBone(bHead, pitch * 0.6, yaw * 0.6, roll * 0.2);
        }

        // Hand / forearm micro-movements.
        if (s.handMovement.enabled) {
          const hi = s.handMovement.intensity;
          const lp = Math.sin(t * 0.41) * hi;
          const rp = Math.sin(t * 0.41 + Math.PI) * hi;
          offsetBone(bLForearm, lp * 0.04, 0, lp * 0.02);
          offsetBone(bRForearm, rp * 0.04, 0, rp * 0.02);
          offsetBone(bLHand,    lp * 0.06, lp * 0.04, 0);
          offsetBone(bRHand,    rp * 0.06, rp * 0.04, 0);
        }

        // Lip sync via morph targets.
        if (s.lipSync.enabled && morphMeshes.length > 0) {
          const targetJaw = speaking ? Math.min(1, amp * s.lipSync.sensitivity * 3.5) : 0;
          for (const name of LIP_MORPHS) {
            if (name in currentMorphs) {
              currentMorphs[name] = THREE.MathUtils.lerp(currentMorphs[name], targetJaw, 0.3);
              applyMorph(name, currentMorphs[name]);
            }
          }
        }

        // Expression morph targets.
        if (morphMeshes.length > 0) {
          const targets = EXPRESSION_MORPHS[s.expression] ?? {};
          for (const name of allMorphNames) {
            if (LIP_MORPHS.includes(name)) continue;
            const target = targets[name] ?? 0;
            currentMorphs[name] = THREE.MathUtils.lerp(currentMorphs[name] ?? 0, target, 0.05);
            applyMorph(name, currentMorphs[name]);
          }
        }

        // Camera.
        const { theta, phi, radiusPct } = parseOrbit(orbitRef.current);
        const tgt    = parseTarget(targetRef.current);
        const radius = radiusPct * cachedMaxDim * 3.5;
        camera.position.copy(orbitToPosition(tgt, radius, theta, phi));
        camera.lookAt(tgt);

        renderer.render(scene, camera);
      };
      animate();

      // Store cleanup in closure-accessible ref.
      cleanupRef = () => {
        ro.disconnect();
        mixer?.stopAllAction();
        renderer.dispose();
        wireMat.dispose();
        fillMat.dispose();
        faceMat.dispose();
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      };
    }; // end setup()

    let cleanupRef: (() => void) | null = null;
    startSetup();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animId);
      cancelAnimationFrame(waitFrame);
      cleanupRef?.();
    };
  }, [src]); // re-mount only when model source changes; all other values via refs

  return (
    <div
      ref={mountRef}
      style={{
        width: "100%",
        height: "100%",
        filter: computeGlowFilter(settings.appearance),
      }}
    />
  );
}

// Default export for React.lazy() — Three.js only loads when this module is
// actually imported (i.e. wireframe/hybrid mode is activated).
export default WireframeViewer;
