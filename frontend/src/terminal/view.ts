import type { TerminalSessionMeta } from "./manager";

export function renderTerminalWorkspace(
  sessions: TerminalSessionMeta[],
  activeSessionId: string | null
): string {
  const tabs = sessions
    .map((session) => {
      const active = session.sessionId === activeSessionId ? " is-active" : "";
      return `<button type="button" class="terminal-tab${active}" data-terminal-session-id="${session.sessionId}" title="${session.title}">
        <span class="terminal-tab-label">${session.title}</span>
        <span class="terminal-tab-close" data-terminal-close-session-id="${session.sessionId}" role="button" aria-label="Close terminal ${session.title}" title="Close terminal">×</span>
      </button>`;
    })
    .join("");

  return `
    <div class="terminal-workspace">
      <div class="terminal-toolbar">
        <div class="terminal-tabs">
          ${tabs}
          <button type="button" class="terminal-tab terminal-tab-new" data-terminal-action="new" aria-label="Add terminal" title="Add terminal">
            <span class="terminal-tab-plus">+</span>
            <span class="terminal-tab-label">New</span>
          </button>
        </div>
        <div class="terminal-actions">
          <select class="terminal-shell-select" id="terminalShellSelect" aria-label="Shell profile">
            <option value="default">Default</option>
            <option value="bash">bash</option>
            <option value="zsh">zsh</option>
            <option value="powershell">powershell</option>
          </select>
        </div>
      </div>
      <div class="terminal-host" id="terminalHost"></div>
    </div>
  `;
}
