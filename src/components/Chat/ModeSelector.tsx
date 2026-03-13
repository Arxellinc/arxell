import { useEffect, useMemo, useState } from "react";
import { MessageSquare, Mic, Rocket, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import {
  AUTONOMY_PRESETS,
  DEFAULT_MODE_CONSTRAINTS,
  DEFAULT_TOOL_RULES,
  LEGACY_MODE_ID,
  LEGACY_MODE_POLICY_TOOLS_KEY,
  MODE_IDS,
  MODE_CONSTRAINTS_SETTING_KEY,
  MODES,
  MODE_POLICY_SETTING_KEYS,
  MODE_PROFILE_SETTING_KEY,
  MODE_SELECTION_SETTING_KEY,
  MODE_TOOL_RULES_SETTING_KEY,
  TOOL_POLICY_LABELS,
  presetPolicyState,
  type AutonomyProfileLevel,
  type ModeConstraints,
  type ModeId,
  type ToolPolicyKey,
  type ToolRules,
} from "../../lib/modes";
import { settingsGet, settingsSet } from "../../lib/tauri";
import { useChatStore } from "../../store/chatStore";
import { cn } from "../../lib/utils";

const MODE_ICONS: Record<ModeId, React.ReactNode> = {
  chat: <MessageSquare size={12} />,
  voice: <Mic size={12} />,
  tools: <ShieldCheck size={12} />,
  full: <Rocket size={12} />,
};

function modeBadgeClass(id: ModeId) {
  return {
    chat: "text-text-norm bg-line-med",
    voice: "text-cyan-300 bg-cyan-500/15",
    tools: "text-accent-gold bg-accent-gold/15",
    full: "text-accent-green bg-accent-green/15",
  }[id];
}

function toolKeys(): ToolPolicyKey[] {
  return Object.keys(TOOL_POLICY_LABELS) as ToolPolicyKey[];
}

function cloneDefaultRules() {
  return {
    chat: { ...DEFAULT_TOOL_RULES.chat },
    voice: { ...DEFAULT_TOOL_RULES.voice },
    tools: { ...DEFAULT_TOOL_RULES.tools },
    full: { ...DEFAULT_TOOL_RULES.full },
  };
}

function cloneDefaultConstraints() {
  return {
    chat: { ...DEFAULT_MODE_CONSTRAINTS.chat },
    voice: { ...DEFAULT_MODE_CONSTRAINTS.voice },
    tools: { ...DEFAULT_MODE_CONSTRAINTS.tools },
    full: { ...DEFAULT_MODE_CONSTRAINTS.full },
  };
}

function mergeRules(raw: unknown): Record<ModeId, ToolRules> {
  const base = cloneDefaultRules();
  if (!raw || typeof raw !== "object") return base;
  for (const mode of MODE_IDS) {
    const entry =
      (raw as Record<string, unknown>)[mode] ??
      (mode === "tools" ? (raw as Record<string, unknown>)[LEGACY_MODE_ID] : undefined);
    if (!entry || typeof entry !== "object") continue;
    for (const key of toolKeys()) {
      const next = (entry as Record<string, unknown>)[key];
      if (typeof next === "boolean") {
        base[mode][key] = next;
      }
    }
  }
  return base;
}

function mergeConstraints(raw: unknown): Record<ModeId, ModeConstraints> {
  const base = cloneDefaultConstraints();
  if (!raw || typeof raw !== "object") return base;
  for (const mode of MODE_IDS) {
    const entry =
      (raw as Record<string, unknown>)[mode] ??
      (mode === "tools" ? (raw as Record<string, unknown>)[LEGACY_MODE_ID] : undefined);
    if (!entry || typeof entry !== "object") continue;
    const maxActionsPerTurn = (entry as Record<string, unknown>).maxActionsPerTurn;
    if (typeof maxActionsPerTurn === "number" && Number.isFinite(maxActionsPerTurn)) {
      base[mode].maxActionsPerTurn = Math.max(0, Math.floor(maxActionsPerTurn));
    }
  }
  return base;
}

function PolicyModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { activeMode, setActiveMode } = useChatStore();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileLevel, setProfileLevel] = useState<AutonomyProfileLevel>(4);
  const [policies, setPolicies] = useState<Record<ModeId, string>>({
    chat: MODES.find((m) => m.id === "chat")?.defaultPolicy ?? "",
    voice: MODES.find((m) => m.id === "voice")?.defaultPolicy ?? "",
    tools: MODES.find((m) => m.id === "tools")?.defaultPolicy ?? "",
    full: MODES.find((m) => m.id === "full")?.defaultPolicy ?? "",
  });
  const [rules, setRules] = useState<Record<ModeId, ToolRules>>(cloneDefaultRules());
  const [constraints, setConstraints] = useState<Record<ModeId, ModeConstraints>>(cloneDefaultConstraints());

  const isCustom = useMemo(() => {
    const preset = presetPolicyState(profileLevel);
    const sameRules = JSON.stringify(rules) === JSON.stringify(preset.rules);
    const sameConstraints = JSON.stringify(constraints) === JSON.stringify(preset.constraints);
    const sameMode = activeMode === preset.mode;
    return !(sameRules && sameConstraints && sameMode);
  }, [activeMode, constraints, profileLevel, rules]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      settingsGet(MODE_POLICY_SETTING_KEYS.chat),
      settingsGet(MODE_POLICY_SETTING_KEYS.voice),
      settingsGet(MODE_POLICY_SETTING_KEYS.tools),
      settingsGet(LEGACY_MODE_POLICY_TOOLS_KEY),
      settingsGet(MODE_POLICY_SETTING_KEYS.full),
      settingsGet(MODE_TOOL_RULES_SETTING_KEY),
      settingsGet(MODE_CONSTRAINTS_SETTING_KEY),
      settingsGet(MODE_PROFILE_SETTING_KEY),
    ])
      .then(([chat, voice, tools, legacyTools, full, rawRules, rawConstraints, rawProfile]) => {
        const parsedProfile = Number(rawProfile);
        if (
          parsedProfile === 0 || parsedProfile === 1 || parsedProfile === 2 || parsedProfile === 3 ||
          parsedProfile === 4 || parsedProfile === 5 || parsedProfile === 6 || parsedProfile === 7 ||
          parsedProfile === 8 || parsedProfile === 9 || parsedProfile === 10
        ) {
          setProfileLevel(parsedProfile);
        } else {
          setProfileLevel(4);
        }
        setPolicies({
          chat: chat?.trim() || (MODES.find((m) => m.id === "chat")?.defaultPolicy ?? ""),
          voice: voice?.trim() || (MODES.find((m) => m.id === "voice")?.defaultPolicy ?? ""),
          tools: tools?.trim() || legacyTools?.trim() || (MODES.find((m) => m.id === "tools")?.defaultPolicy ?? ""),
          full: full?.trim() || (MODES.find((m) => m.id === "full")?.defaultPolicy ?? ""),
        });
        if (rawRules?.trim()) {
          try {
            setRules(mergeRules(JSON.parse(rawRules)));
          } catch {
            setRules(cloneDefaultRules());
          }
        } else {
          setRules(cloneDefaultRules());
        }

        if (rawConstraints?.trim()) {
          try {
            setConstraints(mergeConstraints(JSON.parse(rawConstraints)));
          } catch {
            setConstraints(cloneDefaultConstraints());
          }
        } else {
          setConstraints(cloneDefaultConstraints());
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open]);

  const save = async () => {
    setSaving(true);
    try {
      await Promise.all([
        settingsSet(MODE_POLICY_SETTING_KEYS.chat, policies.chat),
        settingsSet(MODE_POLICY_SETTING_KEYS.voice, policies.voice),
        settingsSet(MODE_POLICY_SETTING_KEYS.tools, policies.tools),
        settingsSet(MODE_POLICY_SETTING_KEYS.full, policies.full),
        settingsSet(MODE_TOOL_RULES_SETTING_KEY, JSON.stringify(rules)),
        settingsSet(MODE_CONSTRAINTS_SETTING_KEY, JSON.stringify(constraints)),
        settingsSet(MODE_PROFILE_SETTING_KEY, String(profileLevel)),
      ]);
      onClose();
    } catch (e) {
      console.error("Failed to save autonomy policy:", e);
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    setPolicies({
      chat: MODES.find((m) => m.id === "chat")?.defaultPolicy ?? "",
      voice: MODES.find((m) => m.id === "voice")?.defaultPolicy ?? "",
      tools: MODES.find((m) => m.id === "tools")?.defaultPolicy ?? "",
      full: MODES.find((m) => m.id === "full")?.defaultPolicy ?? "",
    });
    const preset = presetPolicyState(4);
    setRules(preset.rules);
    setConstraints(preset.constraints);
    setActiveMode(preset.mode);
    setProfileLevel(4);
  };

  const applyPreset = async (nextLevel: AutonomyProfileLevel) => {
    const preset = presetPolicyState(nextLevel);
    setProfileLevel(nextLevel);
    setRules(preset.rules);
    setConstraints(preset.constraints);
    setActiveMode(preset.mode);
    try {
      await Promise.all([
        settingsSet(MODE_PROFILE_SETTING_KEY, String(nextLevel)),
        settingsSet(MODE_SELECTION_SETTING_KEY, preset.mode),
      ]);
    } catch (e) {
      console.error("Failed to persist autonomy preset:", e);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-5xl rounded-lg border border-line-dark bg-bg-light shadow-2xl">
        <div className="flex items-center justify-between border-b border-line-med px-4 py-3">
          <div>
            <div className="text-sm text-text-norm font-medium">Autonomy Policies</div>
            <div className="text-[11px] text-text-med">Editable by user. Read-only context for agent.</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-text-med hover:bg-line-med hover:text-text-norm">
            <X size={14} />
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="text-xs text-text-med">Loading policies...</div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                {MODE_IDS.map((mode) => (
                  <div key={mode} className="rounded border border-line-med bg-black/20 p-3">
                    <div className="mb-2 text-[11px] font-medium text-text-norm">{MODES.find((m) => m.id === mode)?.label}</div>
                    <textarea
                      value={policies[mode]}
                      onChange={(e) => setPolicies((prev) => ({ ...prev, [mode]: e.target.value }))}
                      rows={12}
                      className="w-full rounded border border-line-dark bg-transparent px-2 py-2 text-[11px] text-text-norm outline-none focus:border-accent-primary/50"
                    />
                  </div>
                ))}
              </div>

              <div className="rounded border border-line-med bg-black/20 p-3 space-y-3">
                <div className="text-[11px] font-medium text-text-norm">Policy Matrix</div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-line-med">
                        <th className="px-2 py-1.5 text-left text-text-med font-medium">Capability</th>
                        <th className="px-2 py-1.5 text-center text-text-med font-medium">Chat</th>
                        <th className="px-2 py-1.5 text-center text-text-med font-medium">Voice</th>
                        <th className="px-2 py-1.5 text-center text-text-med font-medium">+Tools</th>
                        <th className="px-2 py-1.5 text-center text-text-med font-medium">Full-Auto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* ── Tool permission rows ── */}
                      {toolKeys().map((key) => (
                        <tr key={key} className="border-b border-line-light">
                          <td className="px-2 py-1.5 text-text-med font-mono">{TOOL_POLICY_LABELS[key]}</td>
                          {MODE_IDS.map((mode) => (
                            <td key={mode} className="px-2 py-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={rules[mode][key]}
                                onChange={(e) =>
                                  setRules((prev) => ({
                                    ...prev,
                                    [mode]: {
                                      ...prev[mode],
                                      [key]: e.target.checked,
                                    },
                                  }))
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      ))}

                      {/* ── Constraint rows ── */}
                      <tr>
                        <td className="px-2 py-1.5 text-text-med">Max Actions / Turn</td>
                        {MODE_IDS.map((mode) => (
                          <td key={mode} className="px-2 py-1.5 text-center">
                            {mode === "full" ? (
                              <span className="inline-block rounded border border-line-dark px-2 py-0.5 text-[11px] text-text-med">
                                Unlimited
                              </span>
                            ) : (
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={constraints[mode].maxActionsPerTurn}
                                onChange={(e) => {
                                  const next = Number(e.target.value);
                                  if (!Number.isFinite(next)) return;
                                  setConstraints((prev) => ({
                                    ...prev,
                                    [mode]: {
                                      ...prev[mode],
                                      maxActionsPerTurn: Math.max(0, Math.min(100, Math.floor(next))),
                                    },
                                  }));
                                }}
                                className="w-16 rounded border border-line-dark bg-transparent px-1 py-0.5 text-[11px] text-text-norm"
                              />
                            )}
                          </td>
                        ))}
                      </tr>

                      {/* ── Preset section header ── */}
                      <tr className="border-t border-line-dark bg-line-light">
                        <td className="px-2 py-2 text-[10px] font-medium uppercase tracking-wide text-text-med">Presets</td>
                        <td colSpan={4} className="px-2 py-2 text-right">
                          <span className={cn(
                            "rounded px-2 py-0.5 text-[10px]",
                            isCustom ? "bg-accent-gold/20 text-accent-gold" : "bg-accent-green/20 text-accent-green"
                          )}>
                            {isCustom ? "Custom" : `Preset L${profileLevel}`}
                          </span>
                        </td>
                      </tr>

                      {/* ── Preset rows ── */}
                      {AUTONOMY_PRESETS.map((preset) => {
                        const isActive = !isCustom && profileLevel === preset.level;
                        return (
                          <tr
                            key={preset.level}
                            className={cn(
                              "border-b border-line-light cursor-pointer transition-colors",
                              isActive ? "bg-accent-primary/10" : "hover:bg-line-light"
                            )}
                            onClick={() => void applyPreset(preset.level)}
                          >
                            <td className="px-2 py-1.5">
                              <div className={cn("font-medium", isActive ? "text-accent-primary" : "text-text-med")}>
                                L{preset.level} — {preset.label}
                              </div>
                              <div className="text-[10px] text-text-dark mt-0.5">{preset.summary}</div>
                            </td>
                            {MODE_IDS.map((mode) => (
                              <td key={mode} className="px-2 py-1.5 text-center">
                                {preset.rail === mode && (
                                  <div className={cn(
                                    "inline-block w-2 h-2 rounded-full",
                                    isActive ? "bg-accent-primary" : "bg-line-dark"
                                  )} />
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="text-[10px] text-text-dark">
                  Click a preset row to apply it — all capability rows will update automatically.
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line-med px-4 py-3">
          <button
            onClick={resetDefaults}
            className="rounded px-2 py-1 text-[11px] text-text-med hover:bg-line-med hover:text-text-norm"
          >
            Reset Defaults
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded px-2 py-1 text-[11px] text-text-med hover:bg-line-med hover:text-text-norm"
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded bg-accent-primary px-3 py-1 text-[11px] text-text-norm hover:bg-accent-primary disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ModeSelector() {
  const { activeMode, setActiveMode } = useChatStore();
  const [policyOpen, setPolicyOpen] = useState(false);
  const current = useMemo(() => MODES.find((m) => m.id === activeMode) ?? MODES[0], [activeMode]);

  const setMode = async (modeId: ModeId) => {
    setActiveMode(modeId);
    try {
      await settingsSet(MODE_SELECTION_SETTING_KEY, modeId);
    } catch (e) {
      console.error("Failed to persist autonomy mode:", e);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          onClick={() => void setMode(mode.id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] transition-colors",
            activeMode === mode.id
              ? modeBadgeClass(mode.id)
              : "text-text-med hover:text-text-med hover:bg-line-light"
          )}
          title={mode.description}
        >
          {MODE_ICONS[mode.id]}
          <span>{mode.label}</span>
        </button>
      ))}
      <button
        onClick={() => setPolicyOpen(true)}
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-text-med hover:text-text-norm hover:bg-line-light"
        title={`Edit policy for ${current.label}`}
      >
        <SlidersHorizontal size={12} />
        Policy
      </button>

      <PolicyModal open={policyOpen} onClose={() => setPolicyOpen(false)} />
    </div>
  );
}
