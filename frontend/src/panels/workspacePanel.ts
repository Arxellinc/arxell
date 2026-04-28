import type { PrimaryPanelBindings, PrimaryPanelRenderState } from "./types";

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function renderWorkspaceActions(): string {
  return `<button type="button" class="icon-btn" data-project-action="create" title="New project">
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
  </button>`;
}

export function renderWorkspaceBody(state: PrimaryPanelRenderState): string {
  const projects = Object.values(state.projectsById).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );

  const modalHtml = state.projectsModalOpen
    ? `<div class="modal-backdrop">
        <div class="modal-box">
          <div class="modal-title">New Project</div>
          <div class="field">
            <label class="field-label">Name</label>
            <input type="text" class="field-input" data-project-input="name" value="${escapeAttr(state.projectsNameDraft)}" placeholder="Project name" autofocus />
          </div>
          <div class="modal-actions">
            <button type="button" class="modal-btn" data-project-action="cancel-modal">Cancel</button>
            <button type="button" class="modal-btn modal-btn-danger" data-project-action="confirm-create">Create</button>
          </div>
        </div>
      </div>`
    : "";

  if (projects.length === 0) {
    return `
      <div class="primary-pane-body">
        <div class="projects-empty">
          <div class="projects-empty-text">No projects yet</div>
          <button type="button" class="modal-btn modal-btn-danger" data-project-action="create">Create project</button>
        </div>
        ${modalHtml}
      </div>
    `;
  }

  const listHtml = projects
    .map((p) => {
      const isActive = state.projectsSelectedId === p.id;
      return `<div class="project-card ${isActive ? "is-active" : ""}" data-project-id="${p.id}">
        <div class="project-card-header">
          <span class="project-card-name">${escapeHtml(p.name)}</span>
          <span class="project-card-date">${formatDate(p.updatedAt)}</span>
        </div>
        <div class="project-card-meta">
          <span class="project-card-id">${p.id}</span>
        </div>
      </div>`;
    })
    .join("");

  return `
    <div class="primary-pane-body">
      <div class="projects-list">${listHtml}</div>
      ${modalHtml}
    </div>
  `;
}

export function bindProjectsPanel(bindings: PrimaryPanelBindings, state: PrimaryPanelRenderState): void {
  const createBtn = document.querySelector<HTMLButtonElement>("[data-project-action=\"create\"]");
  if (createBtn) {
    createBtn.onclick = () => {
      bindings.onProjectSetModalOpen(true);
    };
  }

  const cancelBtn = document.querySelector<HTMLButtonElement>("[data-project-action=\"cancel-modal\"]");
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      bindings.onProjectSetModalOpen(false);
    };
  }

  const confirmBtn = document.querySelector<HTMLButtonElement>("[data-project-action=\"confirm-create\"]");
  if (confirmBtn) {
    confirmBtn.onclick = () => {
      bindings.onProjectCreate(state.projectsNameDraft);
    };
  }

  const nameInput = document.querySelector<HTMLInputElement>("[data-project-input=\"name\"]");
  if (nameInput) {
    nameInput.oninput = () => {
      bindings.onProjectSetNameDraft(nameInput.value);
    };
    nameInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        bindings.onProjectCreate(nameInput.value);
      }
    };
  }

  const cards = document.querySelectorAll<HTMLElement>("[data-project-id]");
  cards.forEach((card) => {
    card.onclick = () => {
      const id = card.getAttribute("data-project-id");
      if (id) bindings.onProjectSelect(id);
    };
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
