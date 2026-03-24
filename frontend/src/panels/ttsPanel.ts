export function renderTtsActions(): string {
  return "<span></span>";
}

export function renderTtsBody(): string {
  return `
    <div class="primary-pane-body">
      <div class="config-table">
        <div class="config-row">
          <span class="config-key">Provider</span>
          <span class="config-value">System Voice Engine</span>
          <span class="config-meta">Ready</span>
        </div>
        <div class="config-row">
          <span class="config-key">Default Voice</span>
          <span class="config-value">Alloy</span>
          <span class="config-meta">Selected</span>
        </div>
        <div class="config-row">
          <span class="config-key">Output</span>
          <span class="config-value">16-bit PCM / 24 kHz</span>
          <span class="config-meta">Realtime</span>
        </div>
      </div>
    </div>
  `;
}
