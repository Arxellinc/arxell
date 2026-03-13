import { Bot, CheckCircle2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { modelListAll, modelVerify, settingsGetAll, settingsSet } from "../../../lib/tauri";
import { cn } from "../../../lib/utils";
import { useChatStore } from "../../../store/chatStore";
import { useCoderSessionStore, type CoderEntryKind } from "../../../store/coderSessionStore";
import { useToolModeStore } from "../../../core/tooling/security/modeStore";
import type { ToolMode } from "../../../core/tooling/types";
import {
  coderPiDiagnostics,
  coderPiVersion,
  terminalSessionClose,
  terminalSessionRead,
  terminalSessionResize,
  terminalSessionStart,
  terminalSessionWrite,
} from "../../../core/tooling/client";
import { PanelWrapper } from "./shared";

const XTERM_THEME = {
  background: "#090909",
  foreground: "#d4d4d4",
  cursor: "#aeafad",
  cursorAccent: "#090909",
  selectionBackground: "rgba(255,255,255,0.18)",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function entryToTerminalChunk(kind: CoderEntryKind, text: string): string {
  if (kind === "stdout") return text;
  if (kind === "stderr") return `\r\n\x1b[31m${text}\x1b[0m\r\n`;
  if (kind === "warn") return `\r\n\x1b[33m${text}\x1b[0m\r\n`;
  if (kind === "meta") return `\r\n\x1b[90m${text}\x1b[0m\r\n`;
  return `${text}\r\n`;
}

function pickBestCodingModel(models: string[]): string {
  const rankedPatterns = [
    /codestral/i,
    /deepseek.*coder/i,
    /qwen.*coder/i,
    /glm.*coder/i,
    /starcoder/i,
    /codellama/i,
    /codegemma/i,
    /\bcoder\b/i,
  ];
  for (const pattern of rankedPatterns) {
    const match = models.find((model) => pattern.test(model));
    if (match) return match;
  }
  return models[0] ?? "";
}

function normalizePiModel(modelRaw: string): string {
  const model = modelRaw.trim();
  if (!model) return "";
  const lowered = model.toLowerCase();
  if (
    lowered === "default" ||
    lowered === "auto" ||
    lowered === "openai/default" ||
    lowered === "openai/auto"
  ) {
    return "";
  }
  return model;
}

function resolveCanonicalModelId(
  rawModel: string,
  configs: Awaited<ReturnType<typeof modelListAll>>
): string {
  const candidate = normalizePiModel(rawModel);
  if (!candidate) return "";
  const candidateLower = candidate.toLowerCase();

  const exact = configs.find(
    (m) =>
      m.model_id.trim().toLowerCase() === candidateLower ||
      m.name.trim().toLowerCase() === candidateLower
  );
  if (exact) return exact.model_id.trim();

  const compact = candidateLower.replace(/[^a-z0-9]/g, "");
  if (!compact) return candidate;
  const fuzzy = configs.find((m) => {
    const idKey = m.model_id.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const nameKey = m.name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    return idKey.includes(compact) || nameKey.includes(compact);
  });
  return fuzzy ? fuzzy.model_id.trim() : candidate;
}

export function CoderPanel() {
  const { activeProjectId, activeConversationId, projects, conversations } = useChatStore();
  const activeConversation = activeConversationId
    ? conversations.find((c) => c.id === activeConversationId)
    : null;
  const activeProject = projects.find(
    (p) => p.id === (activeConversation?.project_id ?? activeProjectId)
  );
  const workspacePath = activeProject?.workspace_path?.trim() ?? "";

  const selectedMode = useToolModeStore((s) => s.toolModes.codex);
  const setToolMode = useToolModeStore((s) => s.setMode);
  const mode: ToolMode = selectedMode ?? "shell";

  const [isStarting, setIsStarting] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [piExecutable, setPiExecutable] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelConfigs, setModelConfigs] = useState<Awaited<ReturnType<typeof modelListAll>>>([]);
  const [modelVerified, setModelVerified] = useState(false);
  const [piStatus, setPiStatus] = useState<"checking" | "ready" | "missing">("checking");
  const [piStatusDetail, setPiStatusDetail] = useState("");

  const verifyRequestSeq = useRef(0);
  const pollingRef = useRef<Record<number, boolean>>({});

  const termContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const activeTabRef = useRef<string | null>(null);
  const tabsRef = useRef<typeof tabs>([]);
  const modeRef = useRef<ToolMode>(mode);

  const tabs = useCoderSessionStore((s) => s.tabs);
  const activeTabId = useCoderSessionStore((s) => s.activeTabId);
  const addTab = useCoderSessionStore((s) => s.addTab);
  const removeTab = useCoderSessionStore((s) => s.removeTab);
  const setActiveTab = useCoderSessionStore((s) => s.setActiveTab);
  const appendEntry = useCoderSessionStore((s) => s.appendEntry);
  const clearEntries = useCoderSessionStore((s) => s.clearEntries);
  const setSessionId = useCoderSessionStore((s) => s.setSessionId);
  const nextSessionIndex = useCoderSessionStore((s) => s.nextSessionIndex);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId]
  );

  useEffect(() => {
    activeTabRef.current = activeTabId;
  }, [activeTabId]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const effectiveMode: ToolMode = useMemo(() => {
    if (mode === "sandbox" && !workspacePath) return "shell";
    return mode;
  }, [mode, workspacePath]);

  useEffect(() => {
    modeRef.current = effectiveMode;
  }, [effectiveMode]);

  const persistSetting = (key: string, value: string) => {
    void settingsSet(key, value).catch(console.error);
  };

  const appendAndMaybeWrite = (tabId: string, kind: CoderEntryKind, text: string) => {
    appendEntry(tabId, kind, text);
    if (activeTabRef.current === tabId && xtermRef.current) {
      xtermRef.current.write(entryToTerminalChunk(kind, text));
    }
  };

  const buildCodexStartCommand = () => {
    const execCandidate = piExecutable.trim() || "codex";
    const execToken = execCandidate.includes(" ") ? shellQuote(execCandidate) : execCandidate;
    const isCodexExecutable =
      /(^|[\\/])codex(?:\.exe)?$/i.test(execCandidate.trim()) ||
      /^codex(?:\.exe)?$/i.test(execCandidate.trim());
    const codexFlags = isCodexExecutable
      ? " -c check_for_update_on_startup=false --no-alt-screen -a never -s workspace-write"
      : "";
    // Always pass a model — never let Codex fall through to its hardcoded
    // OpenAI default. If selectedModel is empty, pick the first available model.
    // If nothing is available at all, return null so the caller can show an error.
    const effectiveModel = selectedModel || availableModels[0] || "";
    if (!effectiveModel) return null;
    return `${execToken}${codexFlags} --model ${shellQuote(effectiveModel)}`;
  };

  const closeTab = async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.sessionId) {
      try {
        await terminalSessionClose(tab.sessionId, effectiveMode);
      } catch {
        // ignore close races
      }
    }
    removeTab(tabId);
  };

  const createSessionTab = async () => {
    setIsStarting(true);
    const requestedCwd = workspacePath || activeTab?.cwd || ".";
    const sessionIndex = nextSessionIndex();
    const tabId = `coder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const term = xtermRef.current;
      const cols = term?.cols ?? 120;
      const rows = term?.rows ?? 28;
      const started = await terminalSessionStart(
        requestedCwd,
        null,
        cols,
        rows,
        effectiveMode,
        effectiveMode === "root",
        true,
        selectedModel || null
      );
      addTab({
        id: tabId,
        title: `Session ${sessionIndex}`,
        sessionId: started.sessionId,
        cwd: started.cwd || requestedCwd,
        createdAt: Date.now(),
      });
      appendAndMaybeWrite(tabId, "meta", `session ${started.sessionId} started • cwd=${started.cwd || requestedCwd}`);
      const startCmd = buildCodexStartCommand();
      if (startCmd === null) {
        appendAndMaybeWrite(tabId, "warn", "No model configured. Add a model endpoint in Settings → Language Model or select one in the Codex panel.");
        return;
      }
      appendAndMaybeWrite(tabId, "command", `${started.cwd || requestedCwd} $ ${startCmd}`);
      await terminalSessionWrite(started.sessionId, `${startCmd}\n`, effectiveMode);
    } catch (e) {
      addTab({
        id: tabId,
        title: `Session ${sessionIndex}`,
        sessionId: null,
        cwd: requestedCwd,
        createdAt: Date.now(),
      });
      appendAndMaybeWrite(tabId, "stderr", String(e));
    } finally {
      setIsStarting(false);
    }
  };

  const checkPi = async (executableOverride?: string) => {
    const execPath = (executableOverride ?? piExecutable).trim();
    const lowerExec = execPath.toLowerCase();
    const canRetryWithoutOverride =
      executableOverride === undefined &&
      !!execPath &&
      lowerExec !== "pi" &&
      lowerExec !== "pi.exe" &&
      lowerExec !== "codex" &&
      lowerExec !== "codex.exe";
    setPiStatus("checking");
    setPiStatusDetail("Checking coder executable...");
    try {
      const result = await coderPiVersion(
        workspacePath || activeTab?.cwd || ".",
        null,
        30000,
        execPath || undefined,
        effectiveMode,
        effectiveMode === "root"
      );
      if (result.exitCode === 0) {
        setPiStatus("ready");
        setPiStatusDetail(result.stdout.trim() || "codex is available.");
      } else {
        setPiStatus("missing");
        setPiStatusDetail(result.stderr.trim() || "coder returned a non-zero exit code.");
      }
    } catch (e) {
      const message = String(e);
      const isNotFound =
        /no such file|not found|cannot find the file|failed to run coder executable/i.test(message);
      if (canRetryWithoutOverride && isNotFound) {
        try {
          const retry = await coderPiVersion(
            workspacePath || activeTab?.cwd || ".",
            null,
            30000,
            undefined,
            effectiveMode,
            effectiveMode === "root"
          );
          if (retry.exitCode === 0) {
            setPiExecutable("");
            persistSetting("coder_pi_executable", "");
            setPiStatus("ready");
            setPiStatusDetail(
              `${retry.stdout.trim() || "codex is available."} (ignored invalid override: ${execPath})`
            );
            return;
          }
          setPiStatus("missing");
          setPiStatusDetail(retry.stderr.trim() || "coder returned a non-zero exit code.");
          return;
        } catch (retryErr) {
          setPiStatus("missing");
          setPiStatusDetail(String(retryErr));
          return;
        }
      }
      setPiStatus("missing");
      setPiStatusDetail(message);
    }
  };

  const runPiDiagnostics = async () => {
    const execPath = piExecutable.trim();
    const targetTabId = activeTab?.id;
    if (!targetTabId) return;
    appendAndMaybeWrite(targetTabId, "meta", "[diagnostics] collecting coder resolution details...");
    try {
      const result = await coderPiDiagnostics(
        workspacePath || activeTab?.cwd || ".",
        null,
        execPath || undefined,
        effectiveMode,
        effectiveMode === "root"
      );
      appendAndMaybeWrite(
        targetTabId,
        "meta",
        [
          `[diagnostics] cwd=${result.cwd}`,
          `[diagnostics] requestedExecutable=${result.requestedExecutable || "(none)"}`,
          `[diagnostics] fallbackBinary=${result.fallbackBinary}`,
          `[diagnostics] pathProbe=${result.pathProbe || "(not found on PATH)"}`,
        ].join("\n")
      );
      if (result.candidates.length === 0) {
        appendAndMaybeWrite(targetTabId, "warn", "[diagnostics] no executable candidates were generated");
      } else {
        result.candidates.forEach((candidate, index) => {
          appendAndMaybeWrite(
            targetTabId,
            "meta",
            `[diagnostics:candidate ${index + 1}] source=${candidate.source} path=${candidate.path} exists=${candidate.exists} file=${candidate.isFile} executable=${candidate.isExecutable}`
          );
        });
      }
    } catch (e) {
      appendAndMaybeWrite(targetTabId, "stderr", `[diagnostics failed] ${String(e)}`);
    }
  };

  useEffect(() => {
    const container = termContainerRef.current;
    if (!container) return;

    const term = new XTerm({
      theme: XTERM_THEME,
      fontFamily:
        '"Cascadia Code", "JetBrains Mono", "Fira Code", Menlo, Consolas, "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 8000,
      allowTransparency: false,
      convertEol: false,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
        } catch {
          // ignore fit race
        }
        const sid = tabsRef.current.find((t) => t.id === activeTabRef.current)?.sessionId;
        if (sid) {
          void terminalSessionResize(sid, term.cols, term.rows, modeRef.current).catch(() => {});
        }
      });
    });
    resizeObserver.observe(container);

    term.onData((data) => {
      const sid = tabsRef.current.find((t) => t.id === activeTabRef.current)?.sessionId;
      if (!sid || !data) return;
      void terminalSessionWrite(sid, data, modeRef.current).catch(() => {});
    });

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const [allSettings, models] = await Promise.all([settingsGetAll(), modelListAll()]);
        const modelCandidates = Array.from(
          new Set(models.map((m) => m.model_id.trim()).filter((m) => Boolean(m)))
        );
        const configuredExecutable = allSettings["coder_pi_executable"]?.trim() || "";
        const configuredModel = allSettings["coder_model"]?.trim() || "";
        const globalModel = allSettings["model"]?.trim() || "";
        const bestModel = resolveCanonicalModelId(
          configuredModel || pickBestCodingModel(modelCandidates) || globalModel,
          models
        );
        const configuredMode = allSettings["coder_mode"] as ToolMode | undefined;
        const resolvedMode =
          configuredMode === "sandbox" || configuredMode === "shell" || configuredMode === "root"
            ? configuredMode
            : "shell";

        setPiExecutable(configuredExecutable);
        setAvailableModels(modelCandidates);
        setModelConfigs(models);
        setSelectedModel(bestModel);
        setToolMode("codex", resolvedMode);
        setConfigLoaded(true);
      } catch (e) {
        console.error("Failed to load coder settings:", e);
        setConfigLoaded(true); // Still mark as loaded to avoid hanging
      }
    };

    void loadConfig();
  }, [setToolMode]);

  useEffect(() => {
    if (!activeTabId && tabs.length > 0) {
      setActiveTab(tabs[0].id);
    }
  }, [activeTabId, setActiveTab, tabs]);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.reset();
    if (!activeTab) {
      term.writeln("No active coder session.");
      return;
    }
    if (activeTab.entries.length === 0) {
      term.writeln("Coder session ready.");
      return;
    }
    for (const entry of activeTab.entries) {
      term.write(entryToTerminalChunk(entry.kind, entry.text));
    }
    term.focus();
  }, [activeTabId]);

  useEffect(() => {
    void checkPi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMode]);

  useEffect(() => {
    // Wait for config to load before creating the first session tab.
    // This ensures availableModels and selectedModel are populated before
    // buildCodexStartCommand() is called.
    if (configLoaded && tabs.length === 0) {
      void createSessionTab();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, tabs.length]);

  useEffect(() => {
    const targetModel = normalizePiModel(selectedModel);
    const seq = ++verifyRequestSeq.current;
    if (!targetModel) {
      setModelVerified(false);
      return;
    }
    const cfg = modelConfigs.find(
      (m) =>
        m.model_id.trim().toLowerCase() === targetModel.toLowerCase() ||
        m.name.trim().toLowerCase() === targetModel.toLowerCase()
    );
    if (!cfg) {
      setModelVerified(false);
      return;
    }
    void (async () => {
      try {
        const result = await modelVerify(cfg.id, true);
        if (seq !== verifyRequestSeq.current) return;
        setModelVerified(Boolean(result.ok && result.response_ok));
      } catch {
        if (seq !== verifyRequestSeq.current) return;
        setModelVerified(false);
      }
    })();
  }, [selectedModel, modelConfigs]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      for (const tab of tabs) {
        const sid = tab.sessionId;
        if (!sid) continue;
        if (pollingRef.current[sid]) continue;
        pollingRef.current[sid] = true;
        try {
          const result = await terminalSessionRead(sid, effectiveMode);
          if (result.output) {
            appendEntry(tab.id, "stdout", result.output);
            if (activeTabRef.current === tab.id && xtermRef.current) {
              xtermRef.current.write(result.output);
            }
          }
          if (result.exited) {
            appendAndMaybeWrite(tab.id, "warn", `session exited (${result.exitCode ?? -1})`);
            setSessionId(tab.id, null);
          }
        } catch {
          // ignore transient read errors
        } finally {
          pollingRef.current[sid] = false;
        }
      }
    }, 60);
    return () => window.clearInterval(timer);
  }, [appendEntry, effectiveMode, setSessionId, tabs]);

  const titleNode = (
    <span className="inline-flex items-center gap-1.5">
      <span>Codex</span>
      <span className="inline-flex items-center gap-1 text-[11px] text-text-dark">
        (
        <select
          value={selectedModel}
          onChange={(e) => {
            const next = resolveCanonicalModelId(e.target.value, modelConfigs);
            setSelectedModel(next);
            setModelVerified(false);
            persistSetting("coder_model", next);
          }}
          className="max-w-[220px] bg-transparent border-0 p-0 text-[11px] text-text-med outline-none focus:text-text-norm"
          title="Preferred coding model"
        >
          <option value="">auto</option>
          {availableModels.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        )
        {modelVerified ? (
          <span title="Model API verified with a brief test prompt">
            <CheckCircle2 size={12} className="text-accent-green" />
          </span>
        ) : null}
      </span>
    </span>
  );

  return (
    <PanelWrapper
      fill
      title={titleNode}
      icon={<Bot size={16} className="text-accent-primary" />}
      actions={
        <div className="scrollbar-none flex max-w-[560px] items-center gap-1 overflow-x-auto whitespace-nowrap">
          {(["sandbox", "shell", "root"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setToolMode("codex", m);
                persistSetting("coder_mode", m);
              }}
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors uppercase",
                mode === m
                  ? m === "root"
                    ? "bg-accent-red/15 text-accent-red"
                    : m === "shell"
                      ? "bg-accent-gold/15 text-accent-gold"
                      : "bg-accent-green/15 text-accent-green"
                  : "bg-line-med text-text-med"
              )}
              title={`Set mode: ${m}`}
            >
              {m}
            </button>
          ))}
          <button
            onClick={() => void createSessionTab()}
            disabled={isStarting}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark disabled:opacity-50"
            title="Start a new Codex session tab"
          >
            <Plus size={10} />
            New Session
          </button>
          <button
            onClick={() => void checkPi()}
            disabled={isStarting}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark disabled:opacity-50"
            title="Check Codex availability"
          >
            {piStatus === "checking" ? <RefreshCw size={10} className="animate-spin" /> : null}
            Check Codex
          </button>
          <button
            onClick={() => void runPiDiagnostics()}
            disabled={isStarting || !activeTab}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark disabled:opacity-50"
            title="Run Codex resolution diagnostics"
          >
            Diagnose
          </button>
          <button
            onClick={() => {
              if (!activeTab) return;
              clearEntries(activeTab.id);
              if (xtermRef.current) {
                xtermRef.current.reset();
                xtermRef.current.focus();
              }
            }}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark"
            title="Clear output"
          >
            <Trash2 size={10} />
            Clear
          </button>
        </div>
      }
    >
      <div className="h-full flex flex-col min-h-0 p-3 gap-0">
        <div className="flex items-end gap-0.5 overflow-x-auto scrollbar-none px-1 pt-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-t px-2 py-1 text-[11px] border border-b-0 -mb-px",
                activeTab?.id === tab.id
                  ? "border-accent-primary/40 bg-bg-dark text-text-norm"
                  : "border-line-med bg-line-light text-text-med hover:text-text-norm hover:bg-bg-norm/60"
              )}
              title={tab.cwd}
            >
              <span className="truncate max-w-[140px]">{tab.title}</span>
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  tab.sessionId ? "bg-accent-green" : "bg-accent-red"
                )}
              />
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTab(tab.id);
                }}
                className="inline-flex items-center rounded p-0.5 hover:bg-line-dark"
                title="Close session"
              >
                <X size={10} />
              </span>
            </button>
          ))}
        </div>
        <div className="w-full border-b border-line-dark mb-[5px]" />

        <div
          ref={termContainerRef}
          className="flex-1 min-h-0 overflow-hidden rounded-b border border-line-med border-t-0 bg-bg-dark"
          onClick={() => xtermRef.current?.focus()}
          title={activeTab?.cwd || "Codex terminal"}
        />

        <div
          className={cn(
            "text-[10px] truncate",
            piStatus === "ready"
              ? "text-accent-green/80"
              : piStatus === "checking"
                ? "text-accent-gold/80"
                : "text-accent-red/85"
          )}
          title={piStatusDetail}
        >
          {piStatus === "ready"
            ? "codex ready"
            : piStatus === "checking"
              ? "checking codex..."
              : "codex missing"} • {piStatusDetail}
        </div>
      </div>
    </PanelWrapper>
  );
}
