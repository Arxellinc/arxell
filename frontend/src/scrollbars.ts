import { OverlayScrollbars, type OverlayScrollbars as OverlayScrollbarsInstance } from "overlayscrollbars";
import "overlayscrollbars/overlayscrollbars.css";

const instances = new Map<HTMLElement, OverlayScrollbarsInstance>();
let syncQueued = false;

const SCROLLABLE_OVERFLOW_VALUES = new Set(["auto", "scroll", "overlay"]);

function isScrollableOverflow(value: string): boolean {
  return SCROLLABLE_OVERFLOW_VALUES.has(value);
}

function shouldEnhance(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  if (element === document.body || element === document.documentElement) return false;
  if (element.closest(".xterm")) return false;
  if (element.closest(".os-scrollbar")) return false;
  if (element.classList.contains("files-editor-scroll")) return false;
  if (element.classList.contains("notepad-editor-scroll")) return false;
  if (element.classList.contains("notepad-editor-code-wrap")) return false;

  const style = window.getComputedStyle(element);
  if (style.display === "inline") return false;

  const canScrollX = isScrollableOverflow(style.overflowX);
  const canScrollY = isScrollableOverflow(style.overflowY);
  if (!canScrollX && !canScrollY) return false;

  const hasOverflowX = element.scrollWidth > element.clientWidth + 1;
  const hasOverflowY = element.scrollHeight > element.clientHeight + 1;
  return hasOverflowX || hasOverflowY;
}

function syncNow(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) return;

  const nextTargets = new Set<HTMLElement>();
  const all = root.querySelectorAll<HTMLElement>("*");
  for (const element of all) {
    if (!shouldEnhance(element)) continue;
    nextTargets.add(element);
    if (instances.has(element)) continue;
    const instance = OverlayScrollbars(element, {
      scrollbars: {
        theme: "os-theme-arxell",
        autoHide: "scroll",
        autoHideDelay: 400,
        clickScroll: false,
        dragScroll: true
      }
    });
    instances.set(element, instance);
  }

  for (const [element, instance] of instances.entries()) {
    if (nextTargets.has(element) && element.isConnected) {
      instance.update();
      continue;
    }
    instance.destroy();
    instances.delete(element);
  }
}

export function syncOverlayScrollbars(): void {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    syncQueued = false;
    syncNow();
  });
}

export function destroyOverlayScrollbars(): void {
  for (const instance of instances.values()) {
    instance.destroy();
  }
  instances.clear();
}
