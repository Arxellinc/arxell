/**
 * RigDebugPanel — Comprehensive bone/rig debugging UI for avatar models.
 * 
 * Features:
 * - Auto-detects all bones with full hierarchy
 * - Identifies twist bones and corrective bones
 * - Individual rotation controls (X, Y, Z) for each bone
 * - Range of motion limits display
 * - Twist chain visualization
 * - Export bone mapping as JSON
 */

import { useState, useMemo, useCallback } from "react";
import { ChevronRight, ChevronDown, RotateCcw, Download, AlertTriangle, Info, Play, Pause, Square, SkipBack, Plus, Trash2, Edit2, Check, X, Settings } from "lucide-react";
import type {
  SkeletonMapping,
  BoneInfo,
  BoneCategory,
  TwistChain,
  MorphTargetInfo,
  MorphCategory,
  AnimationInfo,
  BoneHierarchyConfig,
  TwistChainOverride,
} from "./avatarTypes";
import { DEFAULT_HIERARCHY_CONFIG } from "./avatarTypes";

// ── Helper Functions ───────────────────────────────────────────────────────────

function radToDeg(rad: number): number {
  return rad * (180 / Math.PI);
}

function degToRad(deg: number): number {
  return deg * (Math.PI / 180);
}

function formatRotation(rad: number): string {
  return `${radToDeg(rad).toFixed(1)}°`;
}

function getCategoryColor(category: BoneCategory): string {
  const colors: Record<BoneCategory, string> = {
    'spine': 'text-green-400',
    'head': 'text-purple-400',
    'face': 'text-pink-400',
    'arm-left': 'text-blue-400',
    'arm-right': 'text-cyan-400',
    'hand-left': 'text-blue-300',
    'hand-right': 'text-cyan-300',
    'leg-left': 'text-yellow-400',
    'leg-right': 'text-orange-400',
    'twist': 'text-red-400',
    'other': 'text-gray-400',
  };
  return colors[category] || colors.other;
}

function getMorphCategoryColor(category: MorphCategory): string {
  const colors: Record<MorphCategory, string> = {
    'viseme': 'text-pink-400',
    'expression': 'text-purple-400',
    'eye': 'text-blue-400',
    'brow': 'text-green-400',
    'cheek': 'text-yellow-400',
    'jaw': 'text-orange-400',
    'other': 'text-gray-400',
  };
  return colors[category] || colors.other;
}

// ── Bone Tree Node ─────────────────────────────────────────────────────────────

interface BoneTreeNodeProps {
  bone: BoneInfo;
  allBones: Map<string, BoneInfo>;
  manipulations: Record<string, { x: number; y: number; z: number }>;
  onManipulate: (boneName: string, axis: 'x' | 'y' | 'z', value: number) => void;
  onReset: (boneName: string) => void;
  expanded: Set<string>;
  onToggleExpand: (boneName: string) => void;
  selectedBone: string | null;
  onSelectBone: (boneName: string) => void;
}

function BoneTreeNode({
  bone,
  allBones,
  manipulations,
  onManipulate,
  onReset,
  expanded,
  onToggleExpand,
  selectedBone,
  onSelectBone,
}: BoneTreeNodeProps) {
  const hasChildren = bone.children.length > 0;
  const isExpanded = expanded.has(bone.name);
  const isSelected = selectedBone === bone.name;
  const manipulation = manipulations[bone.name];
  
  // Check if this bone has any non-zero manipulation
  const hasManipulation = manipulation && (
    Math.abs(manipulation.x) > 0.001 ||
    Math.abs(manipulation.y) > 0.001 ||
    Math.abs(manipulation.z) > 0.001
  );

  return (
    <div className="select-none">
      {/* Bone row */}
      <div
        className={`flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer transition-colors ${
          isSelected 
            ? 'bg-accent-primary/20' 
            : hasManipulation 
              ? 'bg-yellow-500/10' 
              : 'hover:bg-line-med/50'
        }`}
        onClick={() => onSelectBone(bone.name)}
      >
        {/* Expand/collapse toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(bone.name);
          }}
          className={`w-3 h-3 flex items-center justify-center ${hasChildren ? 'text-text-med' : 'text-transparent'}`}
        >
          {hasChildren && (isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />)}
        </button>
        
        {/* Bone name */}
        <span className={`text-[9px] font-mono truncate flex-1 ${getCategoryColor(bone.category)}`}>
          {bone.name}
        </span>
        
        {/* Twist bone indicator */}
        {bone.isTwistBone && (
          <span className="text-[7px] text-red-400 bg-red-400/20 px-1 rounded" title="Twist bone">
            TWIST
          </span>
        )}
        
        {/* Corrective bone indicator */}
        {bone.isCorrective && (
          <span className="text-[7px] text-yellow-400 bg-yellow-400/20 px-1 rounded" title="Corrective bone">
            CORR
          </span>
        )}
        
        {/* Manipulation indicator */}
        {hasManipulation && (
          <span className="text-[7px] text-yellow-300" title="Has manual manipulation">
            ●
          </span>
        )}
      </div>
      
      {/* Expanded children */}
      {isExpanded && hasChildren && (
        <div className="ml-3 border-l border-line-med/50">
          {bone.children.map((childName) => {
            const childBone = allBones.get(childName);
            if (!childBone) return null;
            return (
              <BoneTreeNode
                key={childName}
                bone={childBone}
                allBones={allBones}
                manipulations={manipulations}
                onManipulate={onManipulate}
                onReset={onReset}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
                selectedBone={selectedBone}
                onSelectBone={onSelectBone}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Bone Detail Panel ──────────────────────────────────────────────────────────

interface BoneDetailPanelProps {
  bone: BoneInfo;
  manipulation: { x: number; y: number; z: number } | undefined;
  onManipulate: (axis: 'x' | 'y' | 'z', value: number) => void;
  onReset: () => void;
}

function BoneDetailPanel({ bone, manipulation, onManipulate, onReset }: BoneDetailPanelProps) {
  const currentManip = manipulation ?? { x: 0, y: 0, z: 0 };
  
  return (
    <div className="p-2 bg-bg-norm rounded border border-line-med">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className={`text-[10px] font-mono ${getCategoryColor(bone.category)}`}>
            {bone.name}
          </div>
          <div className="text-[8px] text-text-dark">
            Category: {bone.category} | Parent: {bone.parent ?? '(root)'}
          </div>
        </div>
        <button
          onClick={onReset}
          className="p-1 rounded text-text-dark hover:text-text-med hover:bg-line-med"
          title="Reset to bind pose"
        >
          <RotateCcw size={12} />
        </button>
      </div>
      
      {/* Twist bone warning */}
      {bone.isTwistBone && (
        <div className="mb-2 p-1.5 bg-red-500/10 border border-red-500/30 rounded">
          <div className="flex items-center gap-1 text-[8px] text-red-400">
            <AlertTriangle size={10} />
            <span className="font-medium">Twist Bone Detected</span>
          </div>
          <div className="text-[7px] text-red-300 mt-0.5">
            This bone should follow the main bone, not be driven directly.
            {bone.twistAxis && ` Primary twist axis: ${bone.twistAxis.toUpperCase()}`}
          </div>
        </div>
      )}
      
      {/* Initial rotation */}
      <div className="mb-2">
        <div className="text-[8px] text-text-med mb-1">Initial Rotation (bind pose)</div>
        <div className="grid grid-cols-3 gap-1 text-[8px] font-mono">
          <div className="px-1 py-0.5 bg-line-dark rounded text-red-400">
            X: {formatRotation(bone.initialRotation.x)}
          </div>
          <div className="px-1 py-0.5 bg-line-dark rounded text-green-400">
            Y: {formatRotation(bone.initialRotation.y)}
          </div>
          <div className="px-1 py-0.5 bg-line-dark rounded text-blue-400">
            Z: {formatRotation(bone.initialRotation.z)}
          </div>
        </div>
      </div>
      
      {/* Rotation controls */}
      <div className="space-y-2">
        <div className="text-[8px] text-text-med">Rotation Offset (manipulation)</div>
        
        {/* X axis */}
        <div>
          <div className="flex items-center justify-between text-[8px] mb-0.5">
            <span className="text-red-400">X Rotation</span>
            <span className="font-mono text-text-dark">
              {formatRotation(currentManip.x)} 
              <span className="text-text-med ml-1">
                (limit: {formatRotation(bone.suggestedLimits.x.min)} to {formatRotation(bone.suggestedLimits.x.max)})
              </span>
            </span>
          </div>
          <input
            type="range"
            min={bone.suggestedLimits.x.min}
            max={bone.suggestedLimits.x.max}
            step={0.017} // ~1 degree
            value={currentManip.x}
            onChange={(e) => onManipulate('x', parseFloat(e.target.value))}
            className="w-full h-1 accent-red-400 cursor-pointer"
          />
        </div>
        
        {/* Y axis */}
        <div>
          <div className="flex items-center justify-between text-[8px] mb-0.5">
            <span className="text-green-400">Y Rotation</span>
            <span className="font-mono text-text-dark">
              {formatRotation(currentManip.y)}
              <span className="text-text-med ml-1">
                (limit: {formatRotation(bone.suggestedLimits.y.min)} to {formatRotation(bone.suggestedLimits.y.max)})
              </span>
            </span>
          </div>
          <input
            type="range"
            min={bone.suggestedLimits.y.min}
            max={bone.suggestedLimits.y.max}
            step={0.017}
            value={currentManip.y}
            onChange={(e) => onManipulate('y', parseFloat(e.target.value))}
            className="w-full h-1 accent-green-400 cursor-pointer"
          />
        </div>
        
        {/* Z axis */}
        <div>
          <div className="flex items-center justify-between text-[8px] mb-0.5">
            <span className="text-blue-400">Z Rotation</span>
            <span className="font-mono text-text-dark">
              {formatRotation(currentManip.z)}
              <span className="text-text-med ml-1">
                (limit: {formatRotation(bone.suggestedLimits.z.min)} to {formatRotation(bone.suggestedLimits.z.max)})
              </span>
            </span>
          </div>
          <input
            type="range"
            min={bone.suggestedLimits.z.min}
            max={bone.suggestedLimits.z.max}
            step={0.017}
            value={currentManip.z}
            onChange={(e) => onManipulate('z', parseFloat(e.target.value))}
            className="w-full h-1 accent-blue-400 cursor-pointer"
          />
        </div>
      </div>
      
      {/* World position */}
      <div className="mt-2 pt-2 border-t border-line-med">
        <div className="text-[8px] text-text-med mb-1">World Position</div>
        <div className="text-[8px] font-mono text-text-dark">
          ({bone.worldPosition.x.toFixed(3)}, {bone.worldPosition.y.toFixed(3)}, {bone.worldPosition.z.toFixed(3)})
        </div>
      </div>
    </div>
  );
}

// ── Twist Chain Panel ───────────────────────────────────────────────────────────

interface TwistChainPanelProps {
  chains: TwistChain[];
  onHighlightChain: (chain: TwistChain | null) => void;
}

function TwistChainPanel({ chains, onHighlightChain }: TwistChainPanelProps) {
  if (chains.length === 0) {
    return (
      <div className="text-[9px] text-text-dark italic p-2">
        No twist chains detected. This model may not have twist bones, or they may not be named conventionally.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {chains.map((chain, idx) => (
        <div
          key={idx}
          className="p-2 bg-bg-norm rounded border border-line-med cursor-pointer hover:border-accent-primary/50"
          onMouseEnter={() => onHighlightChain(chain)}
          onMouseLeave={() => onHighlightChain(null)}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-medium text-red-400">Twist Chain {idx + 1}</span>
            <span className="text-[8px] text-text-dark">Axis: {chain.axis.toUpperCase()}</span>
          </div>
          <div className="text-[8px] text-text-med mb-1">Main Bone:</div>
          <div className="text-[9px] font-mono text-accent-primary mb-1">{chain.mainBone}</div>
          <div className="text-[8px] text-text-med mb-1">Twist Bones ({chain.twistBones.length}):</div>
          <div className="space-y-0.5">
            {chain.twistBones.map((tb, i) => (
              <div key={tb} className="flex items-center justify-between text-[8px]">
                <span className="font-mono text-red-400">{tb}</span>
                <span className="text-text-dark">Weight: {(chain.distribution[i] * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Morph Target Panel ──────────────────────────────────────────────────────────

interface MorphTargetPanelProps {
  morphs: MorphTargetInfo[];
  morphValues: Record<string, number>;
  onMorphChange: (name: string, value: number) => void;
  onResetAll: () => void;
}

function MorphTargetPanel({ morphs, morphValues, onMorphChange, onResetAll }: MorphTargetPanelProps) {
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<MorphCategory | 'all'>('all');

  const filteredMorphs = useMemo(() => {
    return morphs.filter((m) => {
      const matchesSearch = m.name.toLowerCase().includes(filter.toLowerCase());
      const matchesCategory = categoryFilter === 'all' || m.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [morphs, filter, categoryFilter]);

  // Group by category
  const groupedMorphs = useMemo(() => {
    const groups: Record<MorphCategory, MorphTargetInfo[]> = {
      viseme: [], expression: [], eye: [], brow: [], cheek: [], jaw: [], other: [],
    };
    filteredMorphs.forEach((m) => groups[m.category].push(m));
    return groups;
  }, [filteredMorphs]);

  if (morphs.length === 0) {
    return (
      <div className="text-[9px] text-text-dark italic p-2">
        No morph targets found on this model.
      </div>
    );
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-1 mb-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter morphs..."
          className="flex-1 rounded px-1.5 py-0.5 text-[9px] bg-bg-norm border border-line-med text-text-norm focus:outline-none focus:border-accent-primary"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as MorphCategory | 'all')}
          className="rounded px-1.5 py-0.5 text-[9px] bg-bg-norm border border-line-med text-text-norm focus:outline-none"
        >
          <option value="all">All</option>
          <option value="viseme">Viseme</option>
          <option value="expression">Expression</option>
          <option value="eye">Eye</option>
          <option value="brow">Brow</option>
          <option value="jaw">Jaw</option>
        </select>
      </div>

      {/* Morph list */}
      <div className="max-h-64 overflow-y-auto space-y-1">
        {(Object.entries(groupedMorphs) as [MorphCategory, MorphTargetInfo[]][]).map(([category, morphs]) => {
          if (morphs.length === 0) return null;
          return (
            <div key={category}>
              <div className={`text-[8px] font-medium uppercase tracking-wide mb-1 ${getMorphCategoryColor(category)}`}>
                {category} ({morphs.length})
              </div>
              {morphs.map((m) => (
                <div key={`${m.meshName}-${m.name}`} className="mb-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] font-mono text-text-dark truncate flex-1" title={`${m.meshName}: ${m.name}`}>
                      {m.name}
                    </span>
                    <span className="text-[8px] text-text-dark w-8 text-right">
                      {((morphValues[m.name] ?? 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={morphValues[m.name] ?? 0}
                    onChange={(e) => onMorphChange(m.name, parseFloat(e.target.value))}
                    className="w-full h-1 accent-accent-primary cursor-pointer"
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Reset button */}
      <button
        onClick={onResetAll}
        className="mt-2 w-full py-1 rounded text-[9px] border border-line-med text-text-dark hover:text-text-med hover:bg-line-med"
      >
        Reset All Morphs
      </button>
    </div>
  );
}

// ── Animations Panel ───────────────────────────────────────────────────────────

interface AnimationsPanelProps {
  animations: AnimationInfo[];
  activeClip:   string | null;
  isPlaying:    boolean;
  currentTime:  number;
  duration:     number;
  onSelectClip: (name: string | null) => void;
  onPlay:   () => void;
  onPause:  () => void;
  onStop:   () => void;
  onScrub:  (time: number) => void;
}

function AnimationsPanel({
  animations, activeClip, isPlaying, currentTime, duration,
  onSelectClip, onPlay, onPause, onStop, onScrub,
}: AnimationsPanelProps) {
  function fmtTime(t: number) {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(2).padStart(5, "0");
    return `${m}:${s}`;
  }

  if (animations.length === 0) {
    return (
      <div className="text-[9px] text-text-dark italic p-4 text-center">
        No animation clips found in this model.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Clip list */}
      <div className="flex-1 overflow-y-auto">
        {animations.map((anim) => {
          const isActive = anim.name === activeClip;
          return (
            <div
              key={anim.name}
              onClick={() => onSelectClip(isActive ? null : anim.name)}
              className={`px-2 py-1.5 cursor-pointer border-b border-line-med/50 transition-colors ${
                isActive ? "bg-accent-primary/15" : "hover:bg-line-med/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[9px] font-mono truncate flex-1 ${isActive ? "text-accent-primary" : "text-text-norm"}`}>
                  {anim.name || "(unnamed)"}
                </span>
                <span className="text-[8px] text-text-dark ml-2 flex-shrink-0">
                  {fmtTime(anim.duration)}
                </span>
              </div>
              <div className="text-[7px] text-text-dark mt-0.5">
                {anim.trackCount} tracks
              </div>
              {/* Track names (collapsed - show top 3) */}
              {isActive && anim.trackNames.length > 0 && (
                <div className="mt-1 max-h-20 overflow-y-auto">
                  {anim.trackNames.slice(0, 20).map((t) => (
                    <div key={t} className="text-[7px] font-mono text-text-dark truncate">
                      {t}
                    </div>
                  ))}
                  {anim.trackNames.length > 20 && (
                    <div className="text-[7px] text-text-dark">
                      +{anim.trackNames.length - 20} more tracks…
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Playback controls — only shown when a clip is selected */}
      {activeClip && (
        <div className="border-t border-line-med p-2 flex-shrink-0 space-y-2">
          {/* Time scrubber */}
          <div>
            <div className="flex items-center justify-between text-[8px] text-text-dark mb-1">
              <span>{fmtTime(currentTime)}</span>
              <span className="text-text-med truncate mx-2 flex-1 text-center">{activeClip}</span>
              <span>{fmtTime(duration)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.001}
              value={currentTime}
              onChange={(e) => onScrub(parseFloat(e.target.value))}
              className="w-full h-1 accent-accent-primary cursor-pointer"
            />
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => onScrub(0)}
              className="p-1 rounded text-text-dark hover:text-text-med hover:bg-line-med"
              title="Rewind"
            >
              <SkipBack size={12} />
            </button>
            {isPlaying ? (
              <button
                onClick={onPause}
                className="p-1.5 rounded bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
                title="Pause"
              >
                <Pause size={14} />
              </button>
            ) : (
              <button
                onClick={onPlay}
                className="p-1.5 rounded bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
                title="Play"
              >
                <Play size={14} />
              </button>
            )}
            <button
              onClick={onStop}
              className="p-1 rounded text-text-dark hover:text-text-med hover:bg-line-med"
              title="Stop (deactivate clip)"
            >
              <Square size={12} />
            </button>
          </div>

          {/* Warning: procedural animation is disabled while a clip plays */}
          <div className="p-1.5 bg-yellow-500/10 border border-yellow-500/30 rounded text-[7px] text-yellow-400">
            Procedural animation paused while clip is active.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Hierarchy Editor Panel ───────────────────────────────────────────────────────

interface HierarchyEditorPanelProps {
  skeletonMapping: SkeletonMapping | null;
  hierarchyConfig: BoneHierarchyConfig;
  onConfigChange: (config: BoneHierarchyConfig) => void;
}

function HierarchyEditorPanel({ skeletonMapping, hierarchyConfig, onConfigChange }: HierarchyEditorPanelProps) {
  const [editingChain, setEditingChain] = useState<number | null>(null);
  const [newChainMainBone, setNewChainMainBone] = useState("");
  const [showNewChainForm, setShowNewChainForm] = useState(false);

  // Get all available bones for dropdowns
  const allBoneNames = useMemo(() => {
    if (!skeletonMapping) return [];
    return skeletonMapping.boneList;
  }, [skeletonMapping]);

  // Get twist bones that aren't already in a chain
  const availableTwistBones = useMemo(() => {
    if (!skeletonMapping) return [];
    const usedBones = new Set<string>();
    hierarchyConfig.twistChainOverrides.forEach(chain => {
      chain.twistBones.forEach(b => usedBones.add(b));
    });
    return skeletonMapping.boneList.filter(name =>
      !usedBones.has(name) &&
      (skeletonMapping.bones.get(name)?.isTwistBone || hierarchyConfig.customTwistBones.includes(name))
    );
  }, [skeletonMapping, hierarchyConfig]);

  // Update a twist chain
  const updateChain = (index: number, updates: Partial<TwistChainOverride>) => {
    const newOverrides = [...hierarchyConfig.twistChainOverrides];
    newOverrides[index] = { ...newOverrides[index], ...updates };
    onConfigChange({
      ...hierarchyConfig,
      twistChainOverrides: newOverrides,
      lastModified: Date.now(),
    });
  };

  // Add a new twist chain
  const addNewChain = () => {
    if (!newChainMainBone) return;
    const newChain: TwistChainOverride = {
      mainBone: newChainMainBone,
      twistBones: [],
      axis: 'y',
      distribution: [],
      enabled: true,
    };
    onConfigChange({
      ...hierarchyConfig,
      twistChainOverrides: [...hierarchyConfig.twistChainOverrides, newChain],
      lastModified: Date.now(),
    });
    setNewChainMainBone("");
    setShowNewChainForm(false);
  };

  // Remove a twist chain
  const removeChain = (index: number) => {
    const newOverrides = hierarchyConfig.twistChainOverrides.filter((_, i) => i !== index);
    onConfigChange({
      ...hierarchyConfig,
      twistChainOverrides: newOverrides,
      lastModified: Date.now(),
    });
  };

  // Add a twist bone to a chain
  const addTwistBoneToChain = (chainIndex: number, boneName: string) => {
    const chain = hierarchyConfig.twistChainOverrides[chainIndex];
    if (!chain || chain.twistBones.includes(boneName)) return;
    
    const newTwistBones = [...chain.twistBones, boneName];
    // Recalculate equal distribution
    const newDistribution = newTwistBones.map(() => 1 / newTwistBones.length);
    
    updateChain(chainIndex, { twistBones: newTwistBones, distribution: newDistribution });
  };

  // Remove a twist bone from a chain
  const removeTwistBoneFromChain = (chainIndex: number, boneIndex: number) => {
    const chain = hierarchyConfig.twistChainOverrides[chainIndex];
    if (!chain) return;
    
    const newTwistBones = chain.twistBones.filter((_, i) => i !== boneIndex);
    const newDistribution = newTwistBones.length > 0
      ? newTwistBones.map(() => 1 / newTwistBones.length)
      : [];
    
    updateChain(chainIndex, { twistBones: newTwistBones, distribution: newDistribution });
  };

  // Update distribution weight for a specific twist bone
  const updateWeight = (chainIndex: number, boneIndex: number, weight: number) => {
    const chain = hierarchyConfig.twistChainOverrides[chainIndex];
    if (!chain) return;
    
    const newDistribution = [...chain.distribution];
    newDistribution[boneIndex] = weight;
    // Normalize to sum to 1
    const sum = newDistribution.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (let i = 0; i < newDistribution.length; i++) {
        newDistribution[i] /= sum;
      }
    }
    
    updateChain(chainIndex, { distribution: newDistribution });
  };

  // Toggle a bone as custom twist bone
  const toggleCustomTwistBone = (boneName: string) => {
    const isCustom = hierarchyConfig.customTwistBones.includes(boneName);
    const newCustomBones = isCustom
      ? hierarchyConfig.customTwistBones.filter(b => b !== boneName)
      : [...hierarchyConfig.customTwistBones, boneName];
    
    onConfigChange({
      ...hierarchyConfig,
      customTwistBones: newCustomBones,
      lastModified: Date.now(),
    });
  };

  // Toggle a twist bone as disabled
  const toggleDisabledTwistBone = (boneName: string) => {
    const isDisabled = hierarchyConfig.disabledTwistBones.includes(boneName);
    const newDisabled = isDisabled
      ? hierarchyConfig.disabledTwistBones.filter(b => b !== boneName)
      : [...hierarchyConfig.disabledTwistBones, boneName];
    
    onConfigChange({
      ...hierarchyConfig,
      disabledTwistBones: newDisabled,
      lastModified: Date.now(),
    });
  };

  // Add a parent override
  const addParentOverride = (boneName: string, parentName: string | null) => {
    if (!boneName) return;
    // Check if already exists
    const existingIndex = hierarchyConfig.parentOverrides.findIndex(o => o.boneName === boneName);
    if (existingIndex >= 0) {
      // Update existing
      const newOverrides = [...hierarchyConfig.parentOverrides];
      newOverrides[existingIndex] = { ...newOverrides[existingIndex], overrideParent: parentName };
      onConfigChange({
        ...hierarchyConfig,
        parentOverrides: newOverrides,
        lastModified: Date.now(),
      });
    } else {
      // Add new
      onConfigChange({
        ...hierarchyConfig,
        parentOverrides: [...hierarchyConfig.parentOverrides, {
          boneName,
          overrideParent: parentName,
        }],
        lastModified: Date.now(),
      });
    }
  };

  // Update parent for existing override
  const updateParentForOverride = (boneName: string, newParent: string | null) => {
    const overrideIndex = hierarchyConfig.parentOverrides.findIndex(o => o.boneName === boneName);
    if (overrideIndex >= 0) {
      const newOverrides = [...hierarchyConfig.parentOverrides];
      newOverrides[overrideIndex] = { ...newOverrides[overrideIndex], overrideParent: newParent };
      onConfigChange({
        ...hierarchyConfig,
        parentOverrides: newOverrides,
        lastModified: Date.now(),
      });
    }
  };

  // Reset to auto-detected chains
  const resetToAutoDetected = () => {
    if (!skeletonMapping) return;
    const autoChains: TwistChainOverride[] = skeletonMapping.twistChains.map(chain => ({
      mainBone: chain.mainBone,
      twistBones: [...chain.twistBones],
      axis: chain.axis,
      distribution: [...chain.distribution],
      enabled: true,
    }));
    onConfigChange({
      ...hierarchyConfig,
      twistChainOverrides: autoChains,
      lastModified: Date.now(),
    });
  };

  if (!skeletonMapping) {
    return (
      <div className="p-4 text-center text-[10px] text-text-dark">
        <Info size={16} className="mx-auto mb-2 text-text-med" />
        No skeleton data available. Load a model to edit hierarchy.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-2 border-b border-line-med flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold text-text-norm">Twist Chain Configuration</span>
          <div className="flex gap-1">
            <button
              onClick={resetToAutoDetected}
              className="px-1.5 py-0.5 rounded text-[8px] border border-line-med text-text-dark hover:text-text-med hover:bg-line-med"
              title="Reset to auto-detected chains"
            >
              Reset
            </button>
            <button
              onClick={() => setShowNewChainForm(true)}
              className="px-1.5 py-0.5 rounded text-[8px] bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 flex items-center gap-0.5"
            >
              <Plus size={10} />
              Add Chain
            </button>
          </div>
        </div>
        <p className="text-[8px] text-text-dark">
          Configure which twist bones follow which main bones. This fixes wrist/forearm deformation issues.
        </p>
      </div>

      {/* New chain form */}
      {showNewChainForm && (
        <div className="p-2 border-b border-line-med bg-bg-norm flex-shrink-0">
          <div className="text-[9px] text-text-med mb-1">Select main bone for new chain:</div>
          <div className="flex gap-1">
            <select
              value={newChainMainBone}
              onChange={(e) => setNewChainMainBone(e.target.value)}
              className="flex-1 rounded px-1.5 py-0.5 text-[9px] bg-bg-dark border border-line-med text-text-norm"
            >
              <option value="">Select bone...</option>
              {allBoneNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <button
              onClick={addNewChain}
              disabled={!newChainMainBone}
              className="px-2 py-0.5 rounded text-[9px] bg-accent-primary text-white disabled:opacity-50"
            >
              Add
            </button>
            <button
              onClick={() => { setShowNewChainForm(false); setNewChainMainBone(""); }}
              className="px-2 py-0.5 rounded text-[9px] border border-line-med text-text-dark"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Chain list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {hierarchyConfig.twistChainOverrides.length === 0 && (
          <div className="text-[9px] text-text-dark italic text-center py-4">
            No twist chains configured. Click "Reset" to use auto-detected chains, or "Add Chain" to create manually.
          </div>
        )}

        {hierarchyConfig.twistChainOverrides.map((chain, chainIndex) => (
          <div key={chainIndex} className="p-2 bg-bg-norm rounded border border-line-med">
            {/* Chain header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingChain(editingChain === chainIndex ? null : chainIndex)}
                  className="p-0.5 rounded text-text-dark hover:text-text-med hover:bg-line-med"
                >
                  <Edit2 size={10} />
                </button>
                <span className="text-[9px] font-mono text-accent-primary">{chain.mainBone}</span>
                <span className="text-[8px] text-text-dark">→ {chain.twistBones.length} twist bones</span>
              </div>
              <div className="flex items-center gap-1">
                <Toggle value={chain.enabled} onChange={(v) => updateChain(chainIndex, { enabled: v })} />
                <button
                  onClick={() => removeChain(chainIndex)}
                  className="p-0.5 rounded text-red-400 hover:bg-red-400/20"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>

            {/* Axis selector */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[8px] text-text-dark">Twist Axis:</span>
              {(['x', 'y', 'z'] as const).map(axis => (
                <button
                  key={axis}
                  onClick={() => updateChain(chainIndex, { axis })}
                  className={`px-1.5 py-0.5 rounded text-[8px] uppercase ${
                    chain.axis === axis
                      ? 'bg-accent-primary text-white'
                      : 'bg-line-med text-text-dark hover:text-text-med'
                  }`}
                >
                  {axis}
                </button>
              ))}
            </div>

            {/* Twist bones list */}
            {chain.twistBones.length > 0 && (
              <div className="space-y-1">
                {chain.twistBones.map((boneName, boneIndex) => (
                  <div key={boneName} className="flex items-center gap-1 p-1 bg-bg-dark rounded">
                    <span className="text-[8px] font-mono text-red-400 flex-1 truncate">{boneName}</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.1}
                      value={chain.distribution[boneIndex]?.toFixed(2) ?? '0.00'}
                      onChange={(e) => updateWeight(chainIndex, boneIndex, parseFloat(e.target.value) || 0)}
                      className="w-12 px-1 py-0.5 rounded text-[8px] bg-bg-norm border border-line-med text-text-norm text-center"
                      title="Distribution weight"
                    />
                    <button
                      onClick={() => removeTwistBoneFromChain(chainIndex, boneIndex)}
                      className="p-0.5 rounded text-text-dark hover:text-red-400"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add twist bone (when editing) */}
            {editingChain === chainIndex && availableTwistBones.length > 0 && (
              <div className="mt-2 pt-2 border-t border-line-med">
                <div className="text-[8px] text-text-dark mb-1">Add twist bone:</div>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      addTwistBoneToChain(chainIndex, e.target.value);
                    }
                  }}
                  className="w-full rounded px-1.5 py-0.5 text-[8px] bg-bg-dark border border-line-med text-text-norm"
                >
                  <option value="">Select twist bone...</option>
                  {availableTwistBones.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Custom/Disabled twist bones section */}
      <div className="border-t border-line-med p-2 flex-shrink-0">
        <div className="text-[9px] font-medium text-text-med mb-1">Twist Bone Classification</div>
        <p className="text-[7px] text-text-dark mb-2">
          Mark bones as twist bones (if auto-detection missed them) or disable problematic twist bones.
        </p>
        
        {/* List all potential twist bones */}
        <div className="max-h-24 overflow-y-auto space-y-0.5">
          {skeletonMapping.boneList
            .filter(name => {
              const bone = skeletonMapping.bones.get(name);
              return bone && (bone.isTwistBone || hierarchyConfig.customTwistBones.includes(name));
            })
            .map(name => {
              const isDisabled = hierarchyConfig.disabledTwistBones.includes(name);
              const isCustom = hierarchyConfig.customTwistBones.includes(name);
              return (
                <div key={name} className="flex items-center gap-1 text-[8px]">
                  <span className={`font-mono truncate flex-1 ${isDisabled ? 'text-text-dark line-through' : 'text-red-400'}`}>
                    {name}
                    {isCustom && <span className="ml-1 text-yellow-400">(custom)</span>}
                  </span>
                  <button
                    onClick={() => toggleDisabledTwistBone(name)}
                    className={`px-1 py-0.5 rounded ${isDisabled ? 'bg-green-500/20 text-green-400' : 'bg-line-med text-text-dark'}`}
                  >
                    {isDisabled ? 'Enable' : 'Disable'}
                  </button>
                </div>
              );
            })}
        </div>
      </div>

      {/* Parent Override Section */}
      <div className="border-t border-line-med p-2 flex-shrink-0">
        <div className="text-[9px] font-medium text-text-med mb-1">Parent Overrides</div>
        <p className="text-[7px] text-text-dark mb-2">
          Fix incorrect bone hierarchy by overriding parent relationships. Useful for3ds Max exports with incorrect bone connections.
        </p>
        
        {/* Existing overrides */}
        {hierarchyConfig.parentOverrides.length > 0 && (
          <div className="max-h-24 overflow-y-auto space-y-0.5 mb-2">
            {hierarchyConfig.parentOverrides.map((override, idx) => (
              <div key={idx} className="flex items-center gap-1 text-[8px] p-1 bg-bg-dark rounded">
                <span className="font-mono text-blue-400 truncate flex-1">{override.boneName}</span>
                <span className="text-text-dark">→</span>
                <span className="font-mono text-green-400 truncate flex-1">{override.overrideParent ?? '(root)'}</span>
                <button
                  onClick={() => {
                    const newOverrides = hierarchyConfig.parentOverrides.filter((_, i) => i !== idx);
                    onConfigChange({
                      ...hierarchyConfig,
                      parentOverrides: newOverrides,
                      lastModified: Date.now(),
                    });
                  }}
                  className="p-0.5 rounded text-text-dark hover:text-red-400"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        
        {/* Add new override form */}
        <div className="flex gap-1">
          <select
            value=""
            onChange={(e) => {
              const boneName = e.target.value;
              if (!boneName) return;
              const bone = skeletonMapping?.bones.get(boneName);
              if (bone) {
                // Add with current parent as default
                const exists = hierarchyConfig.parentOverrides.some(o => o.boneName === boneName);
                if (!exists) {
                  onConfigChange({
                    ...hierarchyConfig,
                    parentOverrides: [...hierarchyConfig.parentOverrides, {
                      boneName,
                      overrideParent: bone.parent,
                    }],
                    lastModified: Date.now(),
                  });
                }
              }
            }}
            className="flex-1 rounded px-1.5 py-0.5 text-[8px] bg-bg-norm border border-line-med text-text-norm"
          >
            <option value="">Add bone to override...</option>
            {skeletonMapping.boneList
              .filter(name => !hierarchyConfig.parentOverrides.some(o => o.boneName === name))
              .map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
          </select>
        </div>
        
        {/* Edit selected override parent */}
        {hierarchyConfig.parentOverrides.length > 0 && (
          <div className="mt-2 pt-2 border-t border-line-med">
            <div className="text-[8px] text-text-dark mb-1">Change parent for selected override:</div>
            {hierarchyConfig.parentOverrides.map((override, idx) => (
              <div key={idx} className="flex items-center gap-1 mb-1">
                <span className="text-[7px] font-mono text-blue-400 truncate w-20">{override.boneName}</span>
                <select
                  value={override.overrideParent ?? ''}
                  onChange={(e) => {
                    const newParent = e.target.value || null;
                    const newOverrides = [...hierarchyConfig.parentOverrides];
                    newOverrides[idx] = { ...override, overrideParent: newParent };
                    onConfigChange({
                      ...hierarchyConfig,
                      parentOverrides: newOverrides,
                      lastModified: Date.now(),
                    });
                  }}
                  className="flex-1 rounded px-1 py-0.5 text-[7px] bg-bg-dark border border-line-med text-text-norm"
                >
                  <option value="">(root - no parent)</option>
                  {skeletonMapping.boneList
                    .filter(name => name !== override.boneName)
                    .map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Simple toggle component for hierarchy editor
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`relative w-6 h-3 rounded-full transition-colors flex-shrink-0 ${
        value ? "bg-accent-primary" : "bg-line-dark"
      }`}
    >
      <span
        className={`absolute top-0.5 w-2 h-2 rounded-full bg-white transition-transform ${
          value ? "translate-x-3" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

// ── Main RigDebugPanel ──────────────────────────────────────────────────────────

export interface RigDebugPanelProps {
  skeletonMapping: SkeletonMapping | null;
  boneManipulations: Record<string, { x: number; y: number; z: number }>;
  onBoneManipulation: (boneName: string, axis: 'x' | 'y' | 'z', value: number) => void;
  onResetBone: (boneName: string) => void;
  onResetAllBones: () => void;
  morphValues?: Record<string, number>;
  onMorphChange?: (name: string, value: number) => void;
  onResetAllMorphs?: () => void;
  onExportMapping?: () => void;
  // Animation clip playback
  activeAnimationClip?: string | null;
  isAnimationPlaying?:  boolean;
  animationTime?:       number;
  animationDuration?:   number;
  onPlayClip?:   (clipName: string) => void;
  onPauseClip?:  () => void;
  onStopClip?:   () => void;
  onScrubClip?:  (time: number) => void;
  // Hierarchy config
  hierarchyConfig?: BoneHierarchyConfig;
  onHierarchyConfigChange?: (config: BoneHierarchyConfig) => void;
}

type DebugTab = 'bones' | 'twist' | 'hierarchy' | 'morphs' | 'animations' | 'export';

export function RigDebugPanel({
  skeletonMapping,
  boneManipulations,
  onBoneManipulation,
  onResetBone,
  onResetAllBones,
  morphValues = {},
  onMorphChange,
  onResetAllMorphs,
  onExportMapping,
  activeAnimationClip = null,
  isAnimationPlaying = false,
  animationTime = 0,
  animationDuration = 0,
  onPlayClip,
  onPauseClip,
  onStopClip,
  onScrubClip,
  hierarchyConfig,
  onHierarchyConfigChange,
}: RigDebugPanelProps) {
  const [activeTab, setActiveTab] = useState<DebugTab>('bones');
  const [expandedBones, setExpandedBones] = useState<Set<string>>(new Set());
  const [selectedBone, setSelectedBone] = useState<string | null>(null);
  const [highlightedChain, setHighlightedChain] = useState<TwistChain | null>(null);
  const [boneFilter, setBoneFilter] = useState("");

  // Toggle bone expansion
  const toggleExpand = (boneName: string) => {
    setExpandedBones((prev) => {
      const next = new Set(prev);
      if (next.has(boneName)) {
        next.delete(boneName);
      } else {
        next.add(boneName);
      }
      return next;
    });
  };

  // Expand all bones
  const expandAll = () => {
    if (skeletonMapping) {
      setExpandedBones(new Set(skeletonMapping.boneList));
    }
  };

  // Collapse all bones
  const collapseAll = () => {
    setExpandedBones(new Set());
  };

  // Get selected bone info
  const selectedBoneInfo = useMemo(() => {
    if (!skeletonMapping || !selectedBone) return null;
    return skeletonMapping.bones.get(selectedBone) ?? null;
  }, [skeletonMapping, selectedBone]);

  // Filter bones by search
  const filteredRootBones = useMemo(() => {
    if (!skeletonMapping) return [];
    if (!boneFilter) return skeletonMapping.rootBones;
    
    // If filtering, find all matching bones and expand paths to them
    const matchingBones = skeletonMapping.boneList.filter((name) =>
      name.toLowerCase().includes(boneFilter.toLowerCase())
    );
    
    // Expand all ancestors of matching bones
    const toExpand = new Set<string>();
    matchingBones.forEach((boneName) => {
      let current = skeletonMapping.bones.get(boneName);
      while (current) {
        toExpand.add(current.name);
        current = current.parent ? skeletonMapping.bones.get(current.parent) : undefined;
      }
    });
    setExpandedBones(toExpand);
    
    return skeletonMapping.rootBones;
  }, [skeletonMapping, boneFilter]);

  // Export mapping as JSON
  const handleExport = () => {
    if (!skeletonMapping) return;
    
    const exportData = {
      totalBones: skeletonMapping.totalBones,
      twistBoneCount: skeletonMapping.twistBoneCount,
      correctiveBoneCount: skeletonMapping.correctiveBoneCount,
      bones: skeletonMapping.boneList.map((name) => {
        const bone = skeletonMapping.bones.get(name)!;
        return {
          name: bone.name,
          parent: bone.parent,
          children: bone.children,
          category: bone.category,
          isTwistBone: bone.isTwistBone,
          isCorrective: bone.isCorrective,
          initialRotation: {
            x: radToDeg(bone.initialRotation.x),
            y: radToDeg(bone.initialRotation.y),
            z: radToDeg(bone.initialRotation.z),
          },
          suggestedLimits: {
            x: { min: radToDeg(bone.suggestedLimits.x.min), max: radToDeg(bone.suggestedLimits.x.max) },
            y: { min: radToDeg(bone.suggestedLimits.y.min), max: radToDeg(bone.suggestedLimits.y.max) },
            z: { min: radToDeg(bone.suggestedLimits.z.min), max: radToDeg(bone.suggestedLimits.z.max) },
          },
        };
      }),
      twistChains: skeletonMapping.twistChains,
      morphTargets: skeletonMapping.morphTargets.map((m) => ({
        name: m.name,
        meshName: m.meshName,
        category: m.category,
      })),
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'skeleton-mapping.json';
    a.click();
    URL.revokeObjectURL(url);
    
    onExportMapping?.();
  };

  if (!skeletonMapping) {
    return (
      <div className="p-4 text-center text-[10px] text-text-dark">
        <Info size={16} className="mx-auto mb-2 text-text-med" />
        No skeleton data available. Load a model to inspect its rig.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-line-med flex-shrink-0 overflow-x-auto">
        {(['bones', 'twist', 'hierarchy', 'morphs', 'animations', 'export'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-shrink-0 px-2 py-1.5 text-[9px] capitalize transition-colors relative ${
              activeTab === tab
                ? 'text-accent-primary border-b-2 border-accent-primary'
                : 'text-text-dark hover:text-text-med'
            }`}
          >
            {tab === 'hierarchy' ? <Settings size={10} className="inline mr-0.5" /> : null}
            {tab}
            {tab === 'bones' && (
              <span className="ml-1 text-[8px]">({skeletonMapping.totalBones})</span>
            )}
            {tab === 'twist' && (
              <span className="ml-1 text-[8px]">({skeletonMapping.twistChains.length})</span>
            )}
            {tab === 'hierarchy' && hierarchyConfig && (
              <span className="ml-1 text-[8px]">({hierarchyConfig.twistChainOverrides.length})</span>
            )}
            {tab === 'morphs' && (
              <span className="ml-1 text-[8px]">({skeletonMapping.morphTargets.length})</span>
            )}
            {tab === 'animations' && (
              <span className="ml-1 text-[8px]">({skeletonMapping.animations.length})</span>
            )}
            {tab === 'animations' && activeAnimationClip && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-accent-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'bones' && (
          <div className="flex h-full">
            {/* Bone tree */}
            <div className="w-1/2 border-r border-line-med flex flex-col">
              {/* Search and controls */}
              <div className="p-1.5 border-b border-line-med flex gap-1">
                <input
                  type="text"
                  value={boneFilter}
                  onChange={(e) => setBoneFilter(e.target.value)}
                  placeholder="Search bones..."
                  className="flex-1 rounded px-1.5 py-0.5 text-[9px] bg-bg-norm border border-line-med text-text-norm focus:outline-none focus:border-accent-primary"
                />
                <button
                  onClick={expandAll}
                  className="px-1.5 py-0.5 rounded text-[8px] border border-line-med text-text-dark hover:text-text-med"
                  title="Expand all"
                >
                  +++
                </button>
                <button
                  onClick={collapseAll}
                  className="px-1.5 py-0.5 rounded text-[8px] border border-line-med text-text-dark hover:text-text-med"
                  title="Collapse all"
                >
                  ---
                </button>
              </div>
              
              {/* Tree */}
              <div className="flex-1 overflow-y-auto p-1">
                {filteredRootBones.map((rootName) => {
                  const rootBone = skeletonMapping.bones.get(rootName);
                  if (!rootBone) return null;
                  return (
                    <BoneTreeNode
                      key={rootName}
                      bone={rootBone}
                      allBones={skeletonMapping.bones}
                      manipulations={boneManipulations}
                      onManipulate={onBoneManipulation}
                      onReset={onResetBone}
                      expanded={expandedBones}
                      onToggleExpand={toggleExpand}
                      selectedBone={selectedBone}
                      onSelectBone={setSelectedBone}
                    />
                  );
                })}
              </div>
              
              {/* Footer with stats */}
              <div className="p-1.5 border-t border-line-med flex items-center justify-between text-[8px] text-text-dark">
                <span>Twist: {skeletonMapping.twistBoneCount}</span>
                <span>Corrective: {skeletonMapping.correctiveBoneCount}</span>
                <button
                  onClick={onResetAllBones}
                  className="px-1.5 py-0.5 rounded border border-line-med hover:bg-line-med"
                >
                  Reset All
                </button>
              </div>
            </div>
            
            {/* Bone detail */}
            <div className="w-1/2 overflow-y-auto p-2">
              {selectedBoneInfo && selectedBone ? (
                <BoneDetailPanel
                  bone={selectedBoneInfo}
                  manipulation={boneManipulations[selectedBone]}
                  onManipulate={(axis, value) => onBoneManipulation(selectedBone!, axis, value)}
                  onReset={() => onResetBone(selectedBone!)}
                />
              ) : (
                <div className="text-[9px] text-text-dark italic p-4 text-center">
                  Select a bone from the tree to view details and manipulate it.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'twist' && (
          <div className="p-2 overflow-y-auto h-full">
            <div className="mb-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded">
              <div className="flex items-center gap-1 text-[9px] text-yellow-400 font-medium">
                <AlertTriangle size={12} />
                About Twist Bones
              </div>
              <div className="text-[8px] text-yellow-300 mt-1">
                Twist bones (like upper-upper-arm-twist, lower-upper-arm-twist) should follow 
                the rotation of the main bone (upper-arm), not be driven directly. Direct manipulation 
                can cause the "crushed" appearance. The twist should be distributed across twist bones 
                based on their position along the limb.
              </div>
            </div>
            <TwistChainPanel
              chains={skeletonMapping.twistChains}
              onHighlightChain={setHighlightedChain}
            />
            {highlightedChain && (
              <div className="mt-2 p-2 bg-accent-primary/10 border border-accent-primary/30 rounded">
                <div className="text-[9px] text-accent-primary">
                  Highlighting: {highlightedChain.mainBone} → {highlightedChain.twistBones.join(', ')}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'hierarchy' && (
          <HierarchyEditorPanel
            skeletonMapping={skeletonMapping}
            hierarchyConfig={hierarchyConfig ?? DEFAULT_HIERARCHY_CONFIG}
            onConfigChange={onHierarchyConfigChange ?? (() => {})}
          />
        )}

        {activeTab === 'morphs' && (
          <div className="p-2 overflow-y-auto h-full">
            <MorphTargetPanel
              morphs={skeletonMapping.morphTargets}
              morphValues={morphValues}
              onMorphChange={onMorphChange ?? (() => {})}
              onResetAll={onResetAllMorphs ?? (() => {})}
            />
          </div>
        )}

        {activeTab === 'animations' && (
          <div className="flex flex-col h-full overflow-hidden">
            <AnimationsPanel
              animations={skeletonMapping.animations}
              activeClip={activeAnimationClip}
              isPlaying={isAnimationPlaying}
              currentTime={animationTime}
              duration={animationDuration}
              onSelectClip={(name) => {
                if (!name) { onStopClip?.(); }
                else { onPlayClip?.(name); }
              }}
              onPlay={() => activeAnimationClip && onPlayClip?.(activeAnimationClip)}
              onPause={() => onPauseClip?.()}
              onStop={() => onStopClip?.()}
              onScrub={(t) => onScrubClip?.(t)}
            />
          </div>
        )}

        {activeTab === 'export' && (
          <div className="p-2 overflow-y-auto h-full">
            <div className="text-[10px] text-text-med mb-2">
              Export the complete skeleton mapping as a JSON file. This includes:
            </div>
            <ul className="text-[9px] text-text-dark space-y-1 mb-3 list-disc list-inside">
              <li>All bone names with hierarchy (parent/children)</li>
              <li>Initial rotation values (bind pose)</li>
              <li>Detected twist bones and twist chains</li>
              <li>Suggested rotation limits for each axis</li>
              <li>Morph target names and categories</li>
            </ul>
            <div className="p-2 bg-bg-norm rounded border border-line-med mb-3">
              <div className="text-[9px] font-medium text-text-norm mb-1">Statistics</div>
              <div className="grid grid-cols-2 gap-1 text-[8px] text-text-dark">
                <span>Total Bones:</span><span className="text-text-norm">{skeletonMapping.totalBones}</span>
                <span>Twist Bones:</span><span className="text-red-400">{skeletonMapping.twistBoneCount}</span>
                <span>Corrective Bones:</span><span className="text-yellow-400">{skeletonMapping.correctiveBoneCount}</span>
                <span>Morph Targets:</span><span className="text-purple-400">{skeletonMapping.morphTargets.length}</span>
                <span>Twist Chains:</span><span className="text-orange-400">{skeletonMapping.twistChains.length}</span>
                <span>Animations:</span><span className="text-blue-400">{skeletonMapping.animations.length}</span>
              </div>
            </div>
            <button
              onClick={handleExport}
              className="w-full py-2 rounded text-[10px] bg-accent-primary text-white hover:bg-accent-primary/80 transition-colors flex items-center justify-center gap-1"
            >
              <Download size={12} />
              Export Skeleton Mapping
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default RigDebugPanel;
