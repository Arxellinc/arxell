// Advanced debug UI components for AvatarPanel

import type { BoneMapping } from "./AvatarRenderer";

// ── Bone Status Indicator ────────────────────────────────────────────────────────

export function BoneStatus({ label, bone }: { label: string; bone: string | null }) {
  return (
    <div className="flex items-center justify-between py-0.5 px-1 rounded bg-bg-norm">
      <span className="text-[8px] text-text-dark">{label}</span>
      {bone ? (
        <span className="text-[7px] text-green-400 font-mono truncate max-w-[60%]" title={bone}>
          {bone}
        </span>
      ) : (
        <span className="text-[7px] text-red-400">✗</span>
      )}
    </div>
  );
}

// ── Morph Category ────────────────────────────────────────────────────────────────

export function MorphCategory({
  title,
  morphs,
  debugMorphs,
  onChange,
  filter,
}: {
  title: string;
  morphs: string[];
  debugMorphs: Record<string, number>;
  onChange: (name: string, value: number) => void;
  filter: string;
}) {
  const filtered = morphs.filter((n) => n.toLowerCase().includes(filter.toLowerCase()));
  if (filtered.length === 0) return null;

  return (
    <div className="mb-2">
      <div className="text-[8px] text-text-med uppercase tracking-wide mb-1">{title} ({filtered.length})</div>
      <div className="space-y-0.5 max-h-32 overflow-y-auto">
        {filtered.sort().map((name) => (
          <div key={name} className="flex items-center gap-1">
            <span className="text-[7px] text-text-dark font-mono truncate flex-1" title={name}>
              {name}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={debugMorphs[name] ?? 0}
              onChange={(e) => onChange(name, parseFloat(e.target.value))}
              className="w-16 h-1 accent-accent-primary cursor-pointer"
            />
            <span className="text-[7px] text-text-dark w-6 text-right">
              {(debugMorphs[name] ?? 0).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Quick Morph Test Button ────────────────────────────────────────────────────────

export function QuickMorphTest({
  label,
  morphs,
  debugMorphs,
  onChange,
}: {
  label: string;
  morphs: string[];
  debugMorphs: Record<string, number>;
  onChange: (name: string, value: number) => void;
}) {
  if (morphs.length === 0) return null;

  const isActive = morphs.some((n) => (debugMorphs[n] ?? 0) > 0.5);

  const toggle = () => {
    const newValue = isActive ? 0 : 1;
    morphs.forEach((n) => onChange(n, newValue));
  };

  return (
    <button
      onClick={toggle}
      className={`w-full py-1 px-2 rounded text-[9px] border transition-colors text-left ${
        isActive
          ? "bg-accent-primary/20 border-accent-primary text-accent-primary"
          : "border-line-med text-text-dark hover:text-text-med hover:border-line-light"
      }`}
    >
      <span className="font-medium">{label}</span>
      <span className="text-[7px] ml-1 text-text-dark">({morphs.length} morphs)</span>
    </button>
  );
}

// ── Bone Mapping Summary ────────────────────────────────────────────────────────────────

export function BoneMappingSummary({ mapping }: { mapping: BoneMapping }) {
  const requiredBones = [
    { key: "head" as const, label: "Head" },
    { key: "neck" as const, label: "Neck" },
    { key: "hips" as const, label: "Hips" },
    { key: "spine" as const, label: "Spine" },
    { key: "chest" as const, label: "Chest" },
    { key: "leftUpperArm" as const, label: "L Arm" },
    { key: "rightUpperArm" as const, label: "R Arm" },
  ];

  const optionalBones = [
    { key: "jaw" as const, label: "Jaw" },
    { key: "leftForearm" as const, label: "L Forearm" },
    { key: "rightForearm" as const, label: "R Forearm" },
    { key: "leftHand" as const, label: "L Hand" },
    { key: "rightHand" as const, label: "R Hand" },
  ];

  return (
    <div className="space-y-2">
      <div>
        <div className="text-[8px] text-text-med uppercase tracking-wide mb-1">Required Bones</div>
        <div className="grid grid-cols-2 gap-1">
          {requiredBones.map(({ key, label }) => (
            <BoneStatus key={key} label={label} bone={mapping[key]} />
          ))}
        </div>
      </div>
      
      <div>
        <div className="text-[8px] text-text-med uppercase tracking-wide mb-1">Optional Bones</div>
        <div className="grid grid-cols-2 gap-1">
          {optionalBones.map(({ key, label }) => (
            <BoneStatus key={key} label={label} bone={mapping[key]} />
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-line-med">
        <div className="text-[8px] text-text-dark">
          <span className="text-text-med">Total bones:</span> {mapping.allBones.length}
        </div>
        <div className="text-[8px] text-text-dark">
          <span className="text-text-med">Animations:</span> {mapping.animationClipCount}
          {mapping.animationClipNames.length > 0 && (
            <span className="ml-1">({mapping.animationClipNames.join(", ")})</span>
          )}
        </div>
      </div>
    </div>
  );
}
