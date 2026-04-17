/**
 * Terminal Tool
 *
 * PTY shell sessions for local command execution
 */

import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "xterm";
import type { DisplayMode } from "../../layout";
import type { ChatIpcClient } from "../../ipcClient";
import { renderToolToolbar } from "../ui/toolbar";
import { TERMINAL_DATA_ATTR, TERMINAL_UI_ID } from "../ui/constants";
import type { TerminalShellProfile } from "./types";
import "./styles.css";

export interface TerminalSessionMeta {
  sessionId: string;
  title: string;
  shell: string;
  createdAtMs: number;
  status: "running" | "exited";
}

interface SessionRuntime {
  meta: TerminalSessionMeta;
  term: Terminal;
  fit: FitAddon;
  resizeObserver: ResizeObserver | null;
  resizeScheduled: boolean;
  lastCols: number;
  lastRows: number;
  lastHostWidth: number;
  lastHostHeight: number;
}

export class TerminalManager {
  private sessions = new Map<string, SessionRuntime>();
  private client: ChatIpcClient | null = null;
  private mode: DisplayMode = "dark";

  ensureSession(meta: {
    sessionId: string;
    title?: string;
    shell?: string;
    createdAtMs?: number;
    status?: "running" | "exited";
  }): TerminalSessionMeta {
    const existing = this.sessions.get(meta.sessionId);
    if (existing) {
      existing.meta.title = meta.title ?? existing.meta.title;
      existing.meta.shell = meta.shell ?? existing.meta.shell;
      existing.meta.status = meta.status ?? existing.meta.status;
      return existing.meta;
    }

    const fit = new FitAddon();
    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      scrollback: 10000,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: this.themeForMode(this.mode)
    });
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon());

    terminal.onData((input) => {
      if (!this.client) return;
      void this.client.sendTerminalInput({
        sessionId: meta.sessionId,
        input,
        correlationId: nextCorrelationId()
      });
    });

    const sessionMeta: TerminalSessionMeta = {
      sessionId: meta.sessionId,
      title: meta.title ?? `Terminal ${this.sessions.size + 1}`,
      shell: meta.shell ?? "remote",
      createdAtMs: meta.createdAtMs ?? Date.now(),
      status: meta.status ?? "running"
    };
    this.sessions.set(meta.sessionId, {
      meta: sessionMeta,
      term: terminal,
      fit,
      resizeObserver: null,
      resizeScheduled: false,
      lastCols: -1,
      lastRows: -1,
      lastHostWidth: -1,
      lastHostHeight: -1
    });
    return sessionMeta;
  }

  setClient(client: ChatIpcClient): void {
    this.client = client;
  }

  setDisplayMode(mode: DisplayMode): void {
    this.mode = mode;
    for (const runtime of this.sessions.values()) {
      runtime.term.options.theme = this.themeForMode(mode);
    }
  }

  listSessions(): TerminalSessionMeta[] {
    return [...this.sessions.values()]
      .map((s) => s.meta)
      .sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  async createSession(opts?: { shell?: string; cwd?: string }): Promise<TerminalSessionMeta> {
    if (!this.client) throw new Error("terminal client unavailable");
    const openRequest: {
      correlationId: string;
      cols: number;
      rows: number;
      shell?: string;
      cwd?: string;
    } = {
      correlationId: nextCorrelationId(),
      cols: 120,
      rows: 36
    };
    if (opts?.shell) openRequest.shell = opts.shell;
    if (opts?.cwd) openRequest.cwd = opts.cwd;
    const response = await this.client.openTerminalSession({
      ...openRequest
    });

    return this.ensureSession({
      sessionId: response.sessionId,
      title: `Terminal ${this.sessions.size + 1}`,
      shell: opts?.shell ?? "default",
      createdAtMs: Date.now(),
      status: "running"
    });
  }

  mountSession(sessionId: string, host: HTMLElement): void {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) return;

    if (!runtime.term.element) {
      runtime.term.open(host);
    } else if (runtime.term.element.parentElement !== host) {
      host.replaceChildren(runtime.term.element);
    }
    this.fitAndResize(sessionId, runtime, host);

    runtime.resizeObserver?.disconnect();
    const observer = new ResizeObserver(() => {
      if (runtime.resizeScheduled) return;
      runtime.resizeScheduled = true;
      requestAnimationFrame(() => {
        runtime.resizeScheduled = false;
        const current = this.sessions.get(sessionId);
        if (!current) return;
        this.fitAndResize(sessionId, current, host);
      });
    });
    observer.observe(host);
    runtime.resizeObserver = observer;
  }

  writeOutput(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.term.write(data);
  }

  markExited(sessionId: string): void {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) return;
    runtime.meta.status = "exited";
    runtime.term.writeln("\r\n[process exited]");
  }

  async restartSession(sessionId: string): Promise<TerminalSessionMeta | null> {
    const existing = this.sessions.get(sessionId);
    if (!existing) return null;
    const shell = existing.meta.shell === "default" ? undefined : existing.meta.shell;
    await this.closeSession(sessionId);
    return shell ? this.createSession({ shell }) : this.createSession();
  }

  async closeSession(sessionId: string): Promise<void> {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) return;
    runtime.resizeObserver?.disconnect();
    runtime.term.dispose();
    this.sessions.delete(sessionId);
    if (this.client) {
      await this.client.closeTerminalSession({
        sessionId,
        correlationId: nextCorrelationId()
      });
    }
  }

  async closeAll(): Promise<void> {
    const sessionIds = [...this.sessions.keys()];
    for (const sessionId of sessionIds) {
      await this.closeSession(sessionId);
    }
  }

  private sendResize(sessionId: string, cols: number, rows: number): void {
    if (!this.client) return;
    void this.client.resizeTerminal({
      sessionId,
      cols,
      rows,
      correlationId: nextCorrelationId()
    });
  }

  private fitAndResize(sessionId: string, runtime: SessionRuntime, host: HTMLElement): void {
    const hostWidth = host.clientWidth;
    const hostHeight = host.clientHeight;
    const hostChanged = hostWidth !== runtime.lastHostWidth || hostHeight !== runtime.lastHostHeight;

    if (!hostChanged && runtime.lastCols >= 0 && runtime.lastRows >= 0) {
      return;
    }

    runtime.lastHostWidth = hostWidth;
    runtime.lastHostHeight = hostHeight;
    runtime.fit.fit();

    const cols = runtime.term.cols;
    const rows = runtime.term.rows;
    if (cols === runtime.lastCols && rows === runtime.lastRows) {
      return;
    }

    runtime.lastCols = cols;
    runtime.lastRows = rows;
    this.sendResize(sessionId, cols, rows);
  }

  private themeForMode(mode: DisplayMode) {
    if (mode === "light") {
      return {
        background: "#ffffff",
        foreground: "#1a1d23",
        cursor: "#1a1d23",
        selectionBackground: "#dbe7fb"
      };
    }
    if (mode === "dark") {
      return {
        background: "#181818",
        foreground: "#d4d4d4",
        cursor: "#569cd6",
        selectionBackground: "#264f78"
      };
    }
    return {
      background: "#0d1115",
      foreground: "#c7d2d3",
      cursor: "#00f0ff",
      selectionBackground: "#2a3a3d"
    };
  }
}

function nextCorrelationId(): string {
  return `term-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

export function renderTerminalWorkspace(
  sessions: TerminalSessionMeta[],
  activeSessionId: string | null
): string {
  return `
    <div class="terminal-workspace">
      <div class="terminal-host" id="terminalHost"></div>
    </div>
  `;
}

export function renderTerminalToolbar(
  sessions: TerminalSessionMeta[],
  activeSessionId: string | null,
  shellProfile: TerminalShellProfile
): string {
  const toolbar = renderToolToolbar({
    tabsMode: "dynamic",
    tabs: [
      ...sessions.map((session) => ({
        id: session.sessionId,
        label: session.title,
        active: session.sessionId === activeSessionId,
        closable: true,
        buttonAttrs: {
          [TERMINAL_DATA_ATTR.sessionId]: session.sessionId
        },
        closeAttrs: {
          [TERMINAL_DATA_ATTR.closeSessionId]: session.sessionId
        }
      })),
      {
        id: "terminal-new-tab",
        label: "+New",
        active: false,
        closable: false,
        buttonAttrs: {
          [TERMINAL_DATA_ATTR.action]: "new"
        }
      }
    ],
    actions: [
      {
        id: "terminal-shell",
        title: `Shell profile: ${shellProfile}`,
        icon: "cpu",
        active: shellProfile !== "default",
        buttonAttrs: {
          id: TERMINAL_UI_ID.shellButton
        }
      }
    ]
  });

  const shellOptions: Array<{ id: TerminalShellProfile; label: string }> = [
    { id: "default", label: "Default" },
    { id: "bash", label: "bash" },
    { id: "zsh", label: "zsh" },
    { id: "powershell", label: "PowerShell" }
  ];

  const popover = `<div class="tool-toolbar-popover" id="${TERMINAL_UI_ID.shellPopover}" hidden>
    ${shellOptions
      .map((option) => {
        const selected = shellProfile === option.id;
        return `<button type="button" class="tool-toolbar-popover-item${selected ? " is-active" : ""}" ${TERMINAL_DATA_ATTR.shellProfile}="${option.id}">
          <span class="tool-toolbar-popover-label">${option.label}</span>
          <span class="tool-toolbar-popover-check">${selected ? "✓" : ""}</span>
        </button>`;
      })
      .join("")}
  </div>`;

  return `${toolbar}${popover}`;
}
