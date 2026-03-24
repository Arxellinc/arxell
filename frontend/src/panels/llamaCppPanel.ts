export function renderLlamaCppActions(): string {
  return "<span></span>";
}

export function renderLlamaCppBody(): string {
  return `
    <div class="primary-pane-body">
      <div class="config-table">
        <div class="config-row">
          <span class="config-key">Binary</span>
          <span class="config-value">llama-server</span>
          <span class="config-meta">Detected</span>
        </div>
        <div class="config-row">
          <span class="config-key">Runtime</span>
          <span class="config-value">CPU (AVX2)</span>
          <span class="config-meta">Healthy</span>
        </div>
        <div class="config-row">
          <span class="config-key">Server Endpoint</span>
          <span class="config-value">http://127.0.0.1:8080</span>
          <span class="config-meta">Offline</span>
        </div>
      </div>
    </div>
  `;
}
