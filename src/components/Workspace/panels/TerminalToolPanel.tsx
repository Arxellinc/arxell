import { Terminal as TerminalIcon, ShieldAlert, Trash2, AlertTriangle, Power, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { cn } from "../../../lib/utils";
import { useChatStore } from "../../../store/chatStore";
import { PanelWrapper } from "./shared";
import {
  terminalSessionClose,
  terminalSessionRead,
  terminalSessionResize,
  terminalSessionStart,
  terminalSessionWrite,
} from "../../../core/tooling/client";
import { useToolModeStore } from "../../../core/tooling/security/modeStore";
import type { ToolId, ToolMode } from "../../../core/tooling/types";
import { useTerminalSessionStore } from "../../../store/terminalSessionStore";

// ─── Guard types ─────────────────────────────────────────────────────────────

type GuardPromptKind = "start" | "command";

type GuardPrompt = {
  kind: GuardPromptKind;
  command: string;
  reason: string;
  blockedKey?: CommandKey;
};

const COMMAND_KEYS = ["rm", "rmdir", "del", "sudo", "shutdown"] as const;
type CommandKey = (typeof COMMAND_KEYS)[number];

const DEFAULT_ALLOWED: Record<CommandKey, boolean> = {
  rm: false,
  rmdir: false,
  del: false,
  sudo: true,
  shutdown: true,
};

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isInsidePath(path: string, root: string): boolean {
  const p = normalizePath(path);
  const r = normalizePath(root);
  return p === r || p.startsWith(`${r}/`);
}

function matchBlockedKey(
  command: string,
  allowed: Record<CommandKey, boolean>
): CommandKey | null {
  const chunks = command
    .split(/&&|\|\||\||;|\n/g)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const first = chunk.split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!first) continue;
    if (first === "rm" && !allowed.rm) return "rm";
    if (first === "rmdir" && !allowed.rmdir) return "rmdir";
    if (first === "del" && !allowed.del) return "del";
    if (first === "sudo" && !allowed.sudo) return "sudo";
    if (
      (first === "shutdown" || first === "reboot" || first === "poweroff") &&
      !allowed.shutdown
    )
      return "shutdown";
  }
  return null;
}

// ─── xterm.js theme (VS Code Dark+) ──────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

interface TerminalToolPanelProps {
  toolId?: ToolId;
  title?: ReactNode;
  startupCommand?: string;
  readinessCheck?: (output: string) => boolean;
}

export function TerminalToolPanel({
  toolId = "terminal",
  title = "Terminal",
  startupCommand,
  readinessCheck,
}: TerminalToolPanelProps = {}) {
  const { activeProjectId, projects } = useChatStore();
  const activeProject = projects.find((p) => p.id === activeProjectId);
  const workspacePath = activeProject?.workspace_path?.trim() ?? "";

  const [cwd, setCwd] = useState<string>(workspacePath || ".");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [status, setStatus] = useState("Idle");
  const [isStarting, setIsStarting] = useState(false);
  const [pathGuardEnabled, setPathGuardEnabled] = useState(true);
  const [blockGuardEnabled, setBlockGuardEnabled] = useState(true);
  const [allowed, setAllowed] = useState<Record<CommandKey, boolean>>(DEFAULT_ALLOWED);
  const [guardPrompt, setGuardPrompt] = useState<GuardPrompt | null>(null);

  const selectedMode = useToolModeStore((s) => s.toolModes[toolId]);
  const setToolMode = useToolModeStore((s) => s.setMode);
  const setSharedSession = useTerminalSessionStore((s) => s.setSession);
  const setSharedReady = useTerminalSessionStore((s) => s.setReady);
  const clearSharedSession = useTerminalSessionStore((s) => s.clearSession);
  const mode: ToolMode = selectedMode ?? "sandbox";

  // ── xterm.js DOM refs ──
  const termContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // ── Refs that let the stable `onData` callback read current state ──
  const pollingRef = useRef(false);
  const lineBufferRef = useRef("");
  const autoStartAttemptedRef = useRef(false);
  const sessionIdRef = useRef<number | null>(null);
  const modeRef = useRef<ToolMode>(mode);
  const blockGuardEnabledRef = useRef(blockGuardEnabled);
  const allowedRef = useRef<Record<CommandKey, boolean>>(allowed);
  const guardPromptRef = useRef<GuardPrompt | null>(guardPrompt);
  const readinessBufferRef = useRef("");

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { blockGuardEnabledRef.current = blockGuardEnabled; }, [blockGuardEnabled]);
  useEffect(() => { allowedRef.current = allowed; }, [allowed]);
  useEffect(() => { guardPromptRef.current = guardPrompt; }, [guardPrompt]);
  useEffect(() => {
    // Only set explicit ready state when no readiness check is configured.
    // Otherwise preserve prior readiness and let setReady(...) control transitions.
    const ready = !readinessCheck ? !!sessionId : undefined;
    setSharedSession(toolId, sessionId, mode, ready);
  }, [mode, readinessCheck, sessionId, setSharedSession, toolId]);

  const rootGuard = useMemo(() => {
    if (!pathGuardEnabled) return null;
    return workspacePath || null;
  }, [pathGuardEnabled, workspacePath]);

  // ── Mount xterm.js once ───────────────────────────────────────────────────
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
      scrollback: 5000,
      screenReaderMode: true,
      allowTransparency: false,
      convertEol: false,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // ResizeObserver handles both the initial sizing and future resizes.
    // rAF inside the callback ensures cell dimensions are valid before fit() is called.
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try { fitAddon.fit(); } catch { /* ignore */ }
        const sid = sessionIdRef.current;
        if (sid) {
          void terminalSessionResize(sid, term.cols, term.rows, modeRef.current).catch(() => {});
        }
      });
    });
    resizeObserver.observe(container);

    // ── Wire user input → PTY ──
    term.onData((data) => {
      const sid = sessionIdRef.current;
      if (!sid || !data) return;

      // Block new input while a guard prompt is waiting for confirmation
      if (guardPromptRef.current !== null) return;

      // Ctrl+L: clear terminal screen
      if (data === "\x0c") {
        term.clear();
        lineBufferRef.current = "";
        void terminalSessionWrite(sid, data, modeRef.current).catch(() => {});
        return;
      }

      // Enter key: run command guard check before sending to PTY
      if (data === "\r") {
        const line = lineBufferRef.current.trim();
        if (blockGuardEnabledRef.current && line) {
          const blockedKey = matchBlockedKey(line, allowedRef.current);
          if (blockedKey) {
            setGuardPrompt({
              kind: "command",
              command: line,
              reason: `Command guard blocked '${blockedKey}'`,
              blockedKey,
            });
            return; // Do NOT send Enter — the chars are already in the PTY's readline buffer
          }
        }
        lineBufferRef.current = "";
        void terminalSessionWrite(sid, data, modeRef.current).catch(() => {});
        return;
      }

      // Track line buffer for guard inspection (best-effort — readline may rewrite)
      if (data === "\x03" || data === "\x04") {
        // Ctrl+C / Ctrl+D: reset buffer
        lineBufferRef.current = "";
      } else if (data === "\x7f") {
        // Backspace
        lineBufferRef.current = lineBufferRef.current.slice(0, -1);
      } else if (data === "\x1b[A" || data === "\x1b[B") {
        // Up/Down arrow = history navigation; buffer is no longer reliable
        lineBufferRef.current = "";
      } else if (!data.startsWith("\x1b")) {
        // Printable chars (may be multi-char from paste)
        for (const ch of data) {
          if (ch.charCodeAt(0) >= 32) lineBufferRef.current += ch;
        }
      }

      void terminalSessionWrite(sid, data, modeRef.current).catch(() => {});
    });

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // intentionally run once on mount

  // ── Session management ────────────────────────────────────────────────────

  const closeSession = useCallback(
    async (sid?: number | null) => {
      const target = sid ?? sessionId;
      if (!target) return;
      try {
        await terminalSessionClose(target, mode);
      } catch {
        // ignore close races
      }
      setSessionId((prev) => (prev === target ? null : prev));
    },
    [mode, sessionId]
  );

  const startSession = useCallback(
    async (confirmRoot = false) => {
      if (isStarting) return;
      const requestedCwd =
        pathGuardEnabled && workspacePath ? workspacePath : cwd;

      if (mode === "sandbox" && (!rootGuard || !rootGuard.trim())) {
        setStatus(
          "Sandbox mode requires an active project root (or switch to shell mode)."
        );
        return;
      }

      if (
        pathGuardEnabled &&
        workspacePath &&
        !isInsidePath(requestedCwd, workspacePath)
      ) {
        setGuardPrompt({
          kind: "start",
          command: "",
          reason: `Path guard blocked terminal start outside project root: ${workspacePath}`,
        });
        return;
      }

      if (mode === "root" && !confirmRoot) {
        setGuardPrompt({
          kind: "start",
          command: "",
          reason: "Root mode terminal session requires explicit confirmation.",
        });
        return;
      }

      setIsStarting(true);
      setStatus("Starting session...");

      try {
        if (sessionId) await closeSession(sessionId);

        const term = xtermRef.current;
        const cols = term?.cols ?? 120;
        const rows = term?.rows ?? 28;

        const result = await terminalSessionStart(
          requestedCwd,
          rootGuard,
          cols,
          rows,
          mode,
          mode === "root" && confirmRoot
        );

        setSessionId(result.sessionId);
        setSharedReady(toolId, !readinessCheck);
        setCwd(result.cwd || requestedCwd);
        setStatus(`Session ${result.sessionId} active`);
        lineBufferRef.current = "";
        readinessBufferRef.current = "";

        // Reset terminal view for the new session before optional auto-start command.
        term?.reset();
        term?.focus();

        const command = startupCommand?.trim();
        if (command) {
          // Auto-launch an entry command for specialized tool panels (e.g. Pi).
          await terminalSessionWrite(result.sessionId, `${command}\n`, mode);
        }
      } catch (e) {
        xtermRef.current?.write(
          `\r\n\x1b[31m[start error] ${String(e)}\x1b[0m\r\n`
        );
        setStatus("Start failed");
        setSessionId(null);
      } finally {
        setIsStarting(false);
      }
    },
    [closeSession, cwd, isStarting, mode, pathGuardEnabled, readinessCheck, rootGuard, sessionId, setSharedReady, startupCommand, toolId, workspacePath]
  );

  // ── Sync cwd with workspace ───────────────────────────────────────────────
  useEffect(() => {
    if (!workspacePath) return;
    setCwd((prev) => (prev && prev !== "." ? prev : workspacePath));
  }, [workspacePath]);

  // ── Auto-start session ────────────────────────────────────────────────────
  useEffect(() => {
    if (mode === "root") {
      setStatus("Root mode selected. Click Restart to confirm and start session.");
      return;
    }
    if (sessionId) return;
    if (startupCommand?.trim() && autoStartAttemptedRef.current) return;
    autoStartAttemptedRef.current = true;
    void startSession(false);
  }, [cwd, mode, pathGuardEnabled, sessionId, startSession, startupCommand, workspacePath]);

  // ── Polling loop: PTY output → xterm.js ──────────────────────────────────
  useEffect(() => {
    const sid = sessionId;
    if (!sid) return;

    const timer = window.setInterval(async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const result = await terminalSessionRead(sid, mode);
        if (result.output && xtermRef.current) {
          xtermRef.current.write(result.output);
          if (readinessCheck) {
            readinessBufferRef.current = `${readinessBufferRef.current}${result.output}`.slice(-24000);
          }
          if (readinessCheck && readinessCheck(readinessBufferRef.current)) {
            setSharedReady(toolId, true);
          }
        }
        if (result.exited) {
          const code = result.exitCode ?? -1;
          xtermRef.current?.write(
            `\r\n\x1b[33m[session exited: ${code}]\x1b[0m\r\n`
          );
          setStatus(`Session exited (${code})`);
          setSessionId((prev) => (prev === sid ? null : prev));
        }
      } catch {
        // transient read errors during mode switch or session close are expected
      } finally {
        pollingRef.current = false;
      }
    }, 60);

    return () => window.clearInterval(timer);
  }, [mode, readinessCheck, sessionId, setSharedReady, toolId]);

  // ── Cleanup session on unmount ────────────────────────────────────────────
  useEffect(() => {
    const sid = sessionId;
    return () => {
      if (sid) void closeSession(sid);
      clearSharedSession(toolId);
    };
  }, [clearSharedSession, closeSession, sessionId, toolId]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <PanelWrapper
      fill
      title={title}
      icon={<TerminalIcon size={16} className="text-accent-primary" />}
      actions={
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => xtermRef.current?.reset()}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
            title="Clear terminal output"
          >
            <Trash2 size={12} />
            Clear
          </button>
          <button
            onClick={() => {
              if (sessionId) void closeSession(sessionId);
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
            title="Stop session"
          >
            <Power size={12} />
            Stop
          </button>
          <button
            onClick={() => void startSession(mode === "root")}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
            title="Restart session"
          >
            <RotateCcw size={12} />
            Restart
          </button>
        </div>
      }
    >
      {/* ── Guard / mode bar ── */}
      <div className="flex-shrink-0 flex items-center gap-1.5 overflow-x-auto scrollbar-none whitespace-nowrap border-b border-line-med bg-bg-norm px-3 py-1.5">
          <button
            onClick={() => setPathGuardEnabled((v) => !v)}
            className={cn(
              "px-1.5 py-0.5 rounded text-[10px] transition-colors",
              pathGuardEnabled
                ? "bg-accent-green/10 text-accent-green"
                : "bg-line-med text-text-med"
            )}
            title="Restrict terminal startup path to active project path"
          >
            {pathGuardEnabled ? "PG on" : "PG off"}
          </button>

          <button
            onClick={() => setBlockGuardEnabled((v) => !v)}
            className={cn(
              "px-1.5 py-0.5 rounded text-[10px] transition-colors",
              blockGuardEnabled
                ? "bg-accent-green/10 text-accent-green"
                : "bg-line-med text-text-med"
            )}
            title="Enforce blocked-command policy"
          >
            {blockGuardEnabled ? "CG on" : "CG off"}
          </button>

          <span className="text-[10px] text-text-dark ml-1">Mode:</span>
          {(["sandbox", "shell", "root"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setToolMode(toolId, m)}
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
              title={`Set terminal mode to ${m}`}
            >
              {m}
            </button>
          ))}

          <span className="text-[10px] text-text-dark mr-1">Cmd:</span>
          {COMMAND_KEYS.map((key) => (
            <button
              key={key}
              onClick={() =>
                setAllowed((prev) => ({ ...prev, [key]: !prev[key] }))
              }
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors",
                allowed[key]
                  ? "bg-accent-green/10 text-accent-green"
                  : "bg-accent-red/15 text-accent-red"
              )}
              title={allowed[key] ? `Allowed: ${key}` : `Blocked: ${key}`}
            >
              {key}
            </button>
          ))}

          <span className="text-[10px] text-text-dark ml-auto truncate max-w-[45%]">
            {cwd}
          </span>
        </div>

        {/* ── xterm.js terminal container ── */}
        <div
          ref={termContainerRef}
          className="flex-1 min-h-0 overflow-hidden bg-bg-dark"
          onClick={() => xtermRef.current?.focus()}
          title={status}
        />

        {/* ── Guard prompt overlay ── */}
        {guardPrompt && (
          <div className="absolute right-3 top-16 w-[360px] rounded border border-accent-gold/30 bg-bg-dark/95 shadow-lg p-3 z-20">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-accent-gold mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-accent-gold font-medium mb-1">
                  Guardrail Warning
                </div>
                <div className="text-[11px] text-accent-gold/85 mb-1">
                  {guardPrompt.reason}
                </div>
                {guardPrompt.command ? (
                  <div className="text-[11px] text-text-norm font-mono rounded bg-black/30 px-2 py-1 break-all">
                    {guardPrompt.command}
                  </div>
                ) : null}
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      const prompt = guardPrompt;
                      setGuardPrompt(null);
                      if (prompt.blockedKey) {
                        setAllowed((prev) => ({
                          ...prev,
                          [prompt.blockedKey!]: true,
                        }));
                      }
                      if (prompt.kind === "start") {
                        void startSession(true);
                      } else {
                        // The command chars are already in the PTY's readline buffer.
                        // Only send Enter to execute.
                        lineBufferRef.current = "";
                        const sid = sessionIdRef.current;
                        if (sid) {
                          void terminalSessionWrite(
                            sid,
                            "\r",
                            modeRef.current
                          ).catch(() => {});
                        }
                      }
                    }}
                    className="px-2 py-1 rounded text-[11px] bg-accent-green/20 text-accent-green hover:bg-accent-green/30"
                  >
                    Allow
                  </button>
                  <button
                    onClick={() => {
                      const msg = guardPrompt.command || "session start";
                      setGuardPrompt(null);
                      xtermRef.current?.write(
                        `\r\n\x1b[31m[blocked] ${msg}\x1b[0m\r\n`
                      );
                      // Send Ctrl+C to cancel whatever is in the shell's readline buffer
                      const sid = sessionIdRef.current;
                      if (sid) {
                        void terminalSessionWrite(
                          sid,
                          "\x03",
                          modeRef.current
                        ).catch(() => {});
                      }
                      lineBufferRef.current = "";
                    }}
                    className="px-2 py-1 rounded text-[11px] bg-accent-red/20 text-accent-red hover:bg-accent-red/30"
                  >
                    Block
                  </button>
                </div>
              </div>
              <button
                onClick={() => setGuardPrompt(null)}
                className="p-1 rounded hover:bg-line-med text-text-dark hover:text-text-med"
                title="Dismiss"
              >
                <ShieldAlert size={12} />
              </button>
            </div>
          </div>
        )}
    </PanelWrapper>
  );
}
