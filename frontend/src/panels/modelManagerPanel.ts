export function renderModelManagerActions(): string {
  return "<span></span>";
}

export function renderModelManagerBody(): string {
  return `
    <div class="primary-pane-body">
      <div class="config-table">
        <div class="config-row">
          <span class="config-key">llama-3.1-8b-instruct</span>
          <span class="config-value">GGUF Q4_K_M · 4.9 GB</span>
          <span class="config-meta">Installed</span>
        </div>
        <div class="config-row">
          <span class="config-key">whisper-small</span>
          <span class="config-value">GGML · 465 MB</span>
          <span class="config-meta">Installed</span>
        </div>
        <div class="config-row">
          <span class="config-key">gpt-4.1</span>
          <span class="config-value">API endpoint</span>
          <span class="config-meta">Available</span>
        </div>
      </div>
    </div>
  `;
}
