import { iconHtml } from "../icons";
import type { IconName } from "../icons";

interface PaneMenuItem {
  id: string;
  icon: IconName;
  label: string;
}

const PANE_MENU_ITEMS: PaneMenuItem[] = [
  { id: "pane-menu-1", icon: "separator-vertical", label: "Split Vertical (new)" },
  { id: "pane-menu-2", icon: "separator-horizontal", label: "Split Horizontal (new)" },
  { id: "pane-menu-3", icon: "panel-right-close", label: "Move Right"},
  { id: "pane-menu-4", icon: "panel-left-open", label: "Move Left" },
  { id: "pane-menu-5", icon: "trash-2", label: "Remove" }
];
const PANE_MENU_DIVIDER_AFTER: string[] = ["pane-menu-2", "pane-menu-4"];

let globalListenerAttached = false;
const openMenus = new Set<string>();

function closeAllPaneMenus(): void {
  for (const id of openMenus) {
    const el = document.querySelector(`#${id}`);
    if (el) el.classList.remove("is-open");
  }
  openMenus.clear();
}

function ensureGlobalListener(): void {
  if (globalListenerAttached) return;
  globalListenerAttached = true;
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Node)) {
      closeAllPaneMenus();
      return;
    }
    let insideAny = false;
    for (const id of openMenus) {
      const el = document.querySelector(`#${id}`);
      if (el && el.contains(target)) {
        insideAny = true;
        break;
      }
    }
    if (!insideAny) {
      closeAllPaneMenus();
    }
  });
}

export function renderPaneMenu(menuId: string, triggerIcon: IconName): string {
  const itemsHtml = PANE_MENU_ITEMS.map(
    (item) =>
      `<button type="button" class="pane-menu-item" data-pane-menu-item="${item.id}">
        ${iconHtml(item.icon, { size: 16, tone: "dark" })}
        <span>${item.label}</span>
      </button>${PANE_MENU_DIVIDER_AFTER.includes(item.id) ? '<hr class="pane-menu-divider" />' : ""}`
  ).join("");

  return `<span class="pane-menu-wrap" id="${menuId}">
    <button type="button" class="topbar-icon-btn pane-menu-trigger" aria-label="Pane menu" title="Pane menu">
      ${iconHtml(triggerIcon, { size: 16, tone: "dark" })}
    </button>
    <span class="pane-menu">${itemsHtml}</span>
  </span>`;
}

export function bindPaneMenu(menuId: string, handlers?: Record<string, () => void>): void {
  const wrap = document.querySelector(`#${menuId}`);
  if (!wrap) return;

  const trigger = wrap.querySelector<HTMLButtonElement>(".pane-menu-trigger");
  if (!trigger) return;

  trigger.onclick = (e) => {
    e.stopPropagation();
    const wasOpen = wrap.classList.contains("is-open");
    closeAllPaneMenus();
    if (!wasOpen) {
      wrap.classList.add("is-open");
      openMenus.add(menuId);
    }
  };

  if (handlers) {
    const items = wrap.querySelectorAll<HTMLButtonElement>("[data-pane-menu-item]");
    for (const item of items) {
      const itemId = item.getAttribute("data-pane-menu-item");
      if (itemId && handlers[itemId]) {
        item.onclick = (e) => {
          e.stopPropagation();
          closeAllPaneMenus();
          handlers[itemId]!();
        };
      }
    }
  }

  ensureGlobalListener();
}
