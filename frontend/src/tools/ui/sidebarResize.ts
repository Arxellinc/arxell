export interface ToolSidebarResizeOptions {
  event: MouseEvent;
  target: HTMLElement;
  rootSelector: string;
  panelSelector?: string;
  collapsed: boolean;
  minWidth: number;
  maxWidth: number;
  widthCssVar: string;
  onWidthChange: (width: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}

export function handleToolSidebarResize(options: ToolSidebarResizeOptions): boolean {
  const { event, target, rootSelector, panelSelector, collapsed, minWidth, maxWidth, widthCssVar, onWidthChange, onResizeStart, onResizeEnd } = options;

  if (event.button !== 0) return false;
  if (collapsed) return true;

  const resizeHandle = target.closest<HTMLElement>("[data-tool-action=\"resize-sidebar\"], [data-files-action=\"resize-sidebar\"]");
  if (!resizeHandle) return false;

  const root = resizeHandle.closest<HTMLElement>(rootSelector);
  if (!root) return true;

  event.preventDefault();
  event.stopPropagation();

  const startX = event.clientX;
  const panel = panelSelector ? root.querySelector<HTMLElement>(panelSelector) : null;
  const startWidth = panel
    ? Math.max(minWidth, Math.round(panel.getBoundingClientRect().width))
    : Math.max(minWidth, Math.round(root.getBoundingClientRect().width));
  root.classList.add("is-resizing");
  onResizeStart?.();

  const onMove = (moveEvent: MouseEvent) => {
    const delta = moveEvent.clientX - startX;
    const nextWidth = Math.max(minWidth, Math.min(maxWidth, Math.round(startWidth - delta)));
    root.style.setProperty(widthCssVar, `${nextWidth}px`);
    onWidthChange(nextWidth);
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    root.classList.remove("is-resizing");
    onResizeEnd?.();
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp, { once: true });
  return true;
}