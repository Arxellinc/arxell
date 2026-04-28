import { iconHtml } from "../icons";
import { APP_ICON } from "../icons/map";
import type { AvatarMeshSetting } from "./types";
import { AVATAR_MESH_GROUPS, AVATAR_MORPHS, AVATAR_ARM_BONES } from "./types";
import type { AvatarState, PrimaryPanelBindings, PrimaryPanelRenderState } from "./types";
import { escapeHtml } from "./utils";

export function renderAvatarPreview(avatar: AvatarState, options: { context: "chat" | "tools" }): string {
  if (!avatar.active) return "";
  const isMaximized = avatar.maximized;
  const contextClass = options.context === "tools" ? "is-tools" : "is-chat";
  const sizeClass = isMaximized ? "is-maximized" : "is-minimized";
  const assetUrl = avatar.assetUrl || "/avatar/wireframe.glb";
  const assetName = avatar.assetName?.trim() || (avatar.assetKind === "image" ? "Avatar image" : "wireframe.glb");
  const placementButton =
    options.context === "tools"
      ? `<button type="button" class="icon-btn-sm avatar-preview-btn" data-avatar-action="view-chat" title="View in chat" aria-label="View avatar in chat">${iconHtml("message-square", { size: 16, tone: "dark" })}</button>`
      : `<button type="button" class="icon-btn-sm avatar-preview-btn" data-avatar-action="view-tools" title="View in tools" aria-label="View avatar in tools">${iconHtml(APP_ICON.action.toolsPanel, { size: 16, tone: "dark" })}</button>`;
  const stageHtml =
    avatar.assetKind === "image"
      ? `<img class="avatar-preview-image" src="${escapeHtml(assetUrl)}" alt="${escapeHtml(assetName)}" />`
      : `<div
        class="avatar-preview-stage"
        data-avatar-stage="true"
        data-avatar-asset-kind="glb"
        data-avatar-asset-url="${escapeHtml(assetUrl)}"
        data-avatar-asset-name="${escapeHtml(assetName)}"
        data-avatar-mesh-settings="${escapeHtml(JSON.stringify(avatar.meshes))}"
        data-avatar-bg-color="${escapeHtml(avatar.bgColor)}"
        data-avatar-bg-opacity="${avatar.bgOpacity}"
        data-avatar-morphs="${escapeHtml(JSON.stringify(avatar.morphs.filter((m) => m.value > 0)))}"
        data-avatar-arm-bones="${escapeHtml(JSON.stringify(avatar.armBones.filter((b) => b.x !== 0 || b.y !== 0 || b.z !== 0)))}"
      >
        <div class="avatar-preview-placeholder" aria-hidden="true">${iconHtml(APP_ICON.sidebar.avatar, { size: 24, tone: "dark" })}</div>
      </div>`;
  const borderStyle = avatar.borderSize > 0 ? `border: ${avatar.borderSize}px solid ${avatar.borderColor};` : "";
  return `
    <section class="avatar-preview ${contextClass} ${sizeClass}" style="${borderStyle}" aria-label="AI avatar preview">
      <div class="avatar-preview-toolbar">
        <button type="button" class="icon-btn-sm avatar-preview-btn" data-avatar-action="close" title="Close" aria-label="Hide AI avatar">${iconHtml("circle-x", { size: 16, tone: "dark" })}</button>
        ${placementButton}
        <button type="button" class="icon-btn-sm avatar-preview-btn" data-avatar-action="toggle-size" title="${isMaximized ? "Minimize" : "Maximize"}" aria-label="${isMaximized ? "Minimize avatar" : "Maximize avatar"}">${iconHtml(isMaximized ? "minus" : "fullscreen", { size: 16, tone: "dark" })}</button>
      </div>
      ${stageHtml}
    </section>
  `;
}

export function renderAvatarActions(state: PrimaryPanelRenderState): string {
  const tab = state.avatarActiveTab;
  const tabAppClass = tab === "appearance" ? " is-active" : "";
  const tabAniClass = tab === "animation" ? " is-active" : "";
  return `
    <div class="mm-tab-bar">
      <button type="button" class="mm-tab-btn${tabAppClass}" data-avatar-tab="appearance">Appearance</button>
      <button type="button" class="mm-tab-btn${tabAniClass}" data-avatar-tab="animation">Animation</button>
    </div>
  `;
}

function renderMeshRow(ms: AvatarMeshSetting): string {
  const group = AVATAR_MESH_GROUPS.find((g) => g.key === ms.key);
  const label = group?.label ?? ms.key;
  return `
    <div class="avatar-mesh-row" data-avatar-mesh-key="${escapeHtml(ms.key)}">
      <span class="avatar-mesh-cell">
        <input type="checkbox" class="avatar-mesh-visible" ${ms.visible ? "checked" : ""} />
      </span>
      <span class="avatar-mesh-label">${escapeHtml(label)}</span>
      <span class="avatar-mesh-cell avatar-mesh-color-cell">
        <input type="color" class="avatar-color-input avatar-mesh-color" value="${escapeHtml(ms.color)}" />
        <span class="avatar-color-hex">${escapeHtml(ms.color.toUpperCase())}</span>
      </span>
      <span class="avatar-mesh-cell">
        <input type="number" class="avatar-mesh-opacity" min="0" max="100" step="1" value="${Math.round(ms.opacity * 100)}" />
      </span>
      <span class="avatar-mesh-cell avatar-mesh-texture-cell">
        ${ms.textureName ? `<span class="avatar-mesh-texture-name">${escapeHtml(ms.textureName)}</span>` : ""}
        <button type="button" class="tool-action-btn avatar-mesh-texture-btn">${ms.textureName ? "Change" : "Upload"}</button>
        ${ms.textureName ? `<button type="button" class="avatar-mesh-texture-clear" title="Remove texture">&times;</button>` : ""}
      </span>
    </div>
  `;
}

export function renderAvatarBody(state: PrimaryPanelRenderState): string {
  const placementLabel = state.avatar.placement === "tools" ? "Tools panel" : "Chat window";
  const statusLabel = state.avatar.active ? `Active in ${placementLabel}` : "Inactive";
  const tab = state.avatarActiveTab;
  const appearanceContent = tab === "appearance" ? renderAppearanceTab(state) : "";
  const animationContent = tab === "animation" ? renderAnimationTab(state) : "";
  return `
    <section class="primary-pane-body avatar-panel">
      <div class="avatar-panel-header">
        <div class="avatar-panel-title">AI Avatar <span class="avatar-panel-status">${escapeHtml(statusLabel)}</span></div>
        <div class="avatar-panel-header-actions">
          <button type="button" class="tool-action-btn" id="avatarPanelToggleBtn">${state.avatar.active ? "Disable" : "Enable"}</button>
          <button type="button" class="tool-action-btn" id="avatarToggleBtn">${state.avatar.active ? "Hide Preview" : "Show Preview"}</button>
        </div>
      </div>
      ${appearanceContent}
      ${animationContent}
      <div class="avatar-panel-preview-wrap">
        ${state.avatar.active && state.avatar.placement !== "tools" ? renderAvatarPreview(state.avatar, { context: "tools" }) : state.avatar.active && state.avatar.placement === "tools" ? '<div class="avatar-panel-empty">Preview is in the tools panel.</div>' : '<div class="avatar-panel-empty">Preview is available when enabled.</div>'}
      </div>
    </section>
  `;
}

function renderAppearanceTab(state: PrimaryPanelRenderState): string {
  return `
    <div class="avatar-panel-controls">
      <label class="field">
        <span>Source</span>
        <select class="field-select" id="avatarSourceSelect">
          <option value="glb"${state.avatar.assetKind === "glb" ? " selected" : ""}>Bundled wireframe .glb</option>
          <option value="image"${state.avatar.assetKind === "image" ? " selected" : ""}>Static image</option>
        </select>
      </label>
      <input type="file" id="avatarImageInput" accept="image/*" hidden />
      <div class="avatar-panel-row">
        <button type="button" class="tool-action-btn" id="avatarUploadImageBtn">Upload image</button>
        <button type="button" class="tool-action-btn" id="avatarUseWireframeBtn">Use wireframe</button>
        <button type="button" class="tool-action-btn" id="avatarViewChatBtn">View in chat</button>
        <button type="button" class="tool-action-btn" id="avatarViewToolsBtn">View in tools</button>
      </div>
      <div class="avatar-mesh-table">
        <div class="avatar-mesh-header">
          <span class="avatar-mesh-cell">Show</span>
          <span class="avatar-mesh-label">Mesh</span>
          <span class="avatar-mesh-cell">Color</span>
          <span class="avatar-mesh-cell">Op.</span>
          <span class="avatar-mesh-cell avatar-mesh-texture-cell">Texture</span>
        </div>
        ${state.avatar.meshes.map(renderMeshRow).join("")}
      </div>
      <div class="avatar-ui-table">
        <div class="avatar-mesh-header">
          <span class="avatar-mesh-label">UI Control</span>
          <span class="avatar-mesh-cell" style="visibility:hidden">Color</span>
          <span class="avatar-mesh-cell" style="visibility:hidden">Op.</span>
        </div>
        <div class="avatar-mesh-row avatar-ui-row">
          <span class="avatar-mesh-label">Background</span>
          <span class="avatar-mesh-cell avatar-mesh-color-cell">
            <input type="color" class="avatar-color-input avatar-bg-color" id="avatarBgColor" value="${escapeHtml(state.avatar.bgColor)}" />
            <span class="avatar-color-hex">${escapeHtml(state.avatar.bgColor.toUpperCase())}</span>
          </span>
          <span class="avatar-mesh-cell">
            <input type="number" class="avatar-mesh-opacity avatar-bg-opacity" min="0" max="100" step="1" value="${state.avatar.bgOpacity}" />
          </span>
        </div>
        <div class="avatar-mesh-row avatar-ui-row">
          <span class="avatar-mesh-label">Border</span>
          <span class="avatar-mesh-cell avatar-mesh-color-cell">
            <input type="color" class="avatar-color-input avatar-border-color-input" id="avatarBorderColor" value="${escapeHtml(state.avatar.borderColor)}" />
            <span class="avatar-color-hex">${escapeHtml(state.avatar.borderColor.toUpperCase())}</span>
          </span>
          <span class="avatar-mesh-cell"></span>
        </div>
        <div class="avatar-mesh-row avatar-ui-row">
          <span class="avatar-mesh-label">Border size</span>
          <span class="avatar-mesh-cell">
            <input type="number" class="avatar-mesh-opacity avatar-border-size" id="avatarBorderSize" min="0" max="20" step="1" value="${state.avatar.borderSize}" />
          </span>
          <span class="avatar-mesh-cell"></span>
        </div>
      </div>
      <input type="file" id="avatarMeshTextureInput" accept="image/*" hidden />
    </div>
  `;
}

function renderAnimationTab(state: PrimaryPanelRenderState): string {
  return `
    <div class="avatar-panel-controls">
      <div class="avatar-mesh-table avatar-morph-table">
        <div class="avatar-mesh-header">
          <span class="avatar-mesh-label">Morph Target</span>
          <span class="avatar-mesh-cell">Value</span>
        </div>
        ${state.avatar.morphs.map((m) => `
          <div class="avatar-mesh-row" data-avatar-morph="${escapeHtml(m.name)}">
            <span class="avatar-mesh-label">${escapeHtml(m.name)}</span>
            <span class="avatar-mesh-cell">
              <input type="number" class="avatar-morph-value" min="0" max="1" step="0.05" value="${m.value}" />
            </span>
          </div>
        `).join("")}
      </div>
      <div class="avatar-mesh-table avatar-bone-table">
        <div class="avatar-mesh-header">
          <span class="avatar-mesh-label">Arm Bone</span>
          <span class="avatar-mesh-cell">X°</span>
          <span class="avatar-mesh-cell">Y°</span>
          <span class="avatar-mesh-cell">Z°</span>
        </div>
        ${state.avatar.armBones.map((b) => `
          <div class="avatar-mesh-row" data-avatar-bone="${escapeHtml(b.key)}">
            <span class="avatar-mesh-label">${escapeHtml(b.label)}</span>
            <span class="avatar-mesh-cell">
              <input type="number" class="avatar-bone-input avatar-bone-x" min="-180" max="180" step="1" value="${b.x}" />
            </span>
            <span class="avatar-mesh-cell">
              <input type="number" class="avatar-bone-input avatar-bone-y" min="-180" max="180" step="1" value="${b.y}" />
            </span>
            <span class="avatar-mesh-cell">
              <input type="number" class="avatar-bone-input avatar-bone-z" min="-180" max="180" step="1" value="${b.z}" />
            </span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

export function bindAvatarPanel(bindings: PrimaryPanelBindings): void {
  const toggleBtn = document.querySelector<HTMLButtonElement>("#avatarToggleBtn");
  const panelToggleBtn = document.querySelector<HTMLButtonElement>("#avatarPanelToggleBtn");
  const viewChatBtn = document.querySelector<HTMLButtonElement>("#avatarViewChatBtn");
  const viewToolsBtn = document.querySelector<HTMLButtonElement>("#avatarViewToolsBtn");
  const uploadImageBtn = document.querySelector<HTMLButtonElement>("#avatarUploadImageBtn");
  const useWireframeBtn = document.querySelector<HTMLButtonElement>("#avatarUseWireframeBtn");
  const sourceSelect = document.querySelector<HTMLSelectElement>("#avatarSourceSelect");
  if (toggleBtn) toggleBtn.onclick = () => { void bindings.onToggleAvatar(); };
  if (panelToggleBtn) panelToggleBtn.onclick = () => { void bindings.onToggleAvatar(); };
  if (viewChatBtn) viewChatBtn.onclick = () => { void bindings.onSetAvatarPlacement("chat"); };
  if (viewToolsBtn) viewToolsBtn.onclick = () => { void bindings.onSetAvatarPlacement("tools"); };
  if (uploadImageBtn) uploadImageBtn.onclick = () => { void bindings.onAvatarUploadImage(); };
  if (useWireframeBtn) useWireframeBtn.onclick = () => { void bindings.onAvatarUseWireframe(); };
  if (sourceSelect) {
    sourceSelect.onchange = () => {
      if (sourceSelect.value === "image") {
        void bindings.onAvatarUploadImage();
      } else {
        void bindings.onAvatarUseWireframe();
      }
    };
  }
  document.querySelectorAll<HTMLElement>("[data-avatar-mesh-key]").forEach((row) => {
    const key = row.dataset.avatarMeshKey ?? "";
    const checkbox = row.querySelector<HTMLInputElement>(".avatar-mesh-visible");
    const colorInput = row.querySelector<HTMLInputElement>(".avatar-mesh-color");
    const opacityInput = row.querySelector<HTMLInputElement>(".avatar-mesh-opacity");
    const uploadBtn = row.querySelector<HTMLButtonElement>(".avatar-mesh-texture-btn");
    const clearBtn = row.querySelector<HTMLButtonElement>(".avatar-mesh-texture-clear");
    if (checkbox) checkbox.onchange = () => { void bindings.onAvatarMeshUpdate(key, { visible: checkbox.checked }); };
    if (colorInput) colorInput.oninput = () => { void bindings.onAvatarMeshUpdate(key, { color: colorInput.value }); };
    if (opacityInput) opacityInput.oninput = () => { void bindings.onAvatarMeshUpdate(key, { opacity: Math.max(0, Math.min(100, parseInt(opacityInput.value, 10) || 0)) / 100 }); };
    if (uploadBtn) uploadBtn.onclick = () => { bindings.onAvatarMeshTextureUpload(key); };
    if (clearBtn) clearBtn.onclick = () => { void bindings.onAvatarMeshUpdate(key, { textureUrl: "", textureName: "" }); };
  });
  const borderSizeInput = document.querySelector<HTMLInputElement>("#avatarBorderSize");
  const borderColorInput = document.querySelector<HTMLInputElement>("#avatarBorderColor");
  if (borderSizeInput) borderSizeInput.oninput = () => { void bindings.onAvatarBorderChange(parseInt(borderSizeInput.value, 10) || 0, borderColorInput?.value ?? "#000000"); };
  if (borderColorInput) borderColorInput.oninput = () => { void bindings.onAvatarBorderChange(parseInt(borderSizeInput?.value ?? "0", 10) || 0, borderColorInput.value); };
  const bgColorInput = document.querySelector<HTMLInputElement>("#avatarBgColor");
  const bgOpacityInput = document.querySelector<HTMLInputElement>(".avatar-bg-opacity");
  if (bgColorInput) bgColorInput.oninput = () => { void bindings.onAvatarBgChange(bgColorInput.value, parseInt(bgOpacityInput?.value ?? "50", 10) || 0); };
  if (bgOpacityInput) bgOpacityInput.oninput = () => { void bindings.onAvatarBgChange(bgColorInput?.value ?? "#000000", parseInt(bgOpacityInput.value, 10) || 0); };
  document.querySelectorAll<HTMLButtonElement>("[data-avatar-tab]").forEach((btn) => {
    btn.onclick = () => {
      const t = btn.dataset.avatarTab;
      if (t === "appearance" || t === "animation") void bindings.onAvatarSetActiveTab(t);
    };
  });
  document.querySelectorAll<HTMLElement>("[data-avatar-morph]").forEach((row) => {
    const name = row.dataset.avatarMorph ?? "";
    const input = row.querySelector<HTMLInputElement>(".avatar-morph-value");
    if (input) input.oninput = () => { void bindings.onAvatarMorphChange(name, parseFloat(input.value) || 0); };
  });
  document.querySelectorAll<HTMLElement>("[data-avatar-bone]").forEach((row) => {
    const key = row.dataset.avatarBone ?? "";
    const xInput = row.querySelector<HTMLInputElement>(".avatar-bone-x");
    const yInput = row.querySelector<HTMLInputElement>(".avatar-bone-y");
    const zInput = row.querySelector<HTMLInputElement>(".avatar-bone-z");
    if (xInput) xInput.oninput = () => { void bindings.onAvatarBoneChange(key, "x", parseFloat(xInput.value) || 0); };
    if (yInput) yInput.oninput = () => { void bindings.onAvatarBoneChange(key, "y", parseFloat(yInput.value) || 0); };
    if (zInput) zInput.oninput = () => { void bindings.onAvatarBoneChange(key, "z", parseFloat(zInput.value) || 0); };
  });
}
