import { escapeHtml } from "../panels/utils.js";

export interface HeaderModelOption {
  id: string;
  label: string;
}

export function renderChatHeaderModelSelect(input: {
  options: HeaderModelOption[];
  activeModelId: string;
  paneId: string;
  scopeId?: string;
}): string {
  const options = input.options;
  if (!options.length) {
    return '<span class="chat-header-model-wrap"><span class="chat-header-model-fallback">No models</span></span>';
  }
  const activeOption = options.find((option) => option.id === input.activeModelId) ?? options[0];
  const activeLabel = activeOption?.label ?? "Select chat model";
  const optionsHtml = options
    .map((option) => {
      const selected = option.id === input.activeModelId ? " selected" : "";
      return `<option value="${escapeHtml(option.id)}"${selected}>${escapeHtml(option.label)}</option>`;
    })
    .join("");
  return `
    <span class="chat-header-model-wrap" title="${escapeHtml(activeLabel)}">
      <span class="chat-header-model-label" aria-hidden="true">${escapeHtml(activeLabel)}</span>
      <select id="chatHeaderModelSelect${input.scopeId ?? ""}" class="chat-header-model-select" aria-label="Chat model" title="${escapeHtml(activeLabel)}" data-chat-pane-id="${escapeHtml(input.paneId)}">
        ${optionsHtml}
      </select>
      <span class="chat-header-model-chevron" aria-hidden="true">⌄</span>
    </span>
  `;
}
