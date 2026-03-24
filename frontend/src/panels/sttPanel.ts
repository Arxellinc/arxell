export function renderSttActions(): string {
  return "<span></span>";
}

export function renderSttBody(): string {
  return `
    <div class="primary-pane-body">
      <div class="config-table">
        <div class="config-row">
          <span class="config-key">Input Device</span>
          <span class="config-value">Default microphone</span>
          <span class="config-meta">Connected</span>
        </div>
        <div class="config-row">
          <span class="config-key">Recognition Model</span>
          <span class="config-value">whisper-small</span>
          <span class="config-meta">Local</span>
        </div>
        <div class="config-row">
          <span class="config-key">Language</span>
          <span class="config-value">Auto-detect</span>
          <span class="config-meta">Enabled</span>
        </div>
      </div>
    </div>
  `;
}
