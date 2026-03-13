import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, PanelRight, PanelTop, Terminal } from "lucide-react";
import { useToolPanelStore, type ToolPanelId } from "../../store/toolPanelStore";
import { useServeStore } from "../../store/serveStore";
import { useToolCatalogStore } from "../../store/toolCatalogStore";
import { cn } from "../../lib/utils";
import { getToolManifest, getToolbarAuxTools, getToolbarMainTools } from "../../core/tooling/registry";

interface ToolBarButtonProps {
  panelId: ToolPanelId;
  isActive: boolean;
  onClick: () => void;
  orientation: "left" | "top";
}

type ToolbarEntry =
  | { key: string; kind: "panel"; panelId: ToolPanelId }
  | { key: string; kind: "console" };

function ToolBarButton({ panelId, isActive, onClick, orientation }: ToolBarButtonProps) {
  const config = getToolManifest(panelId);
  const Icon = config?.icon;
  const { isLoaded, isLoading } = useServeStore();

  const isServePanel = panelId === "serve";
  const dotColor = isServePanel
    ? isLoading
      ? "bg-accent-gold"
      : isLoaded
        ? "bg-accent-green"
        : "bg-line-dark"
    : null;

  if (!config || !Icon) return null;

  return (
    <button
      onClick={onClick}
      className={cn(
        orientation === "left"
          ? "w-full flex flex-col items-center gap-0.5 py-2 px-1"
          : "h-full min-w-14 flex flex-col items-center justify-center gap-0.5 px-2",
        "transition-colors group relative",
        isActive
          ? "bg-line-med text-text-norm"
          : "text-text-dark hover:text-text-med hover:bg-line-light"
      )}
      title={config.description}
    >
      <div className="relative">
        <Icon
          size={18}
          className={cn(
            "transition-colors",
            isActive ? "text-accent-primary" : "group-hover:text-text-med"
          )}
        />
        {isServePanel && (
          <div
            className={cn(
              "absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full",
              dotColor,
              isLoading && "animate-pulse"
            )}
          />
        )}
      </div>
      <span
        className={cn(
          "text-[9px] font-medium transition-colors",
          isActive ? "text-accent-primary" : "text-text-dark group-hover:text-text-med"
        )}
      >
        {config.title}
      </span>
      {isActive && (
        <div
          className={cn(
            orientation === "left"
              ? "absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-6 rounded-r"
              : "absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-7 rounded-t",
            "bg-accent-primary"
          )}
        />
      )}
    </button>
  );
}

interface ConsoleButtonProps {
  isActive: boolean;
  onClick: () => void;
  orientation: "left" | "top";
}

function ConsoleButton({ isActive, onClick, orientation }: ConsoleButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        orientation === "left"
          ? "w-full flex flex-col items-center gap-0.5 py-2 px-1"
          : "h-full min-w-14 flex flex-col items-center justify-center gap-0.5 px-2",
        "transition-colors group relative",
        isActive
          ? "bg-accent-green/10 text-accent-green"
          : "text-text-dark hover:text-text-med hover:bg-line-light"
      )}
      title="Toggle console panel"
    >
      <Terminal size={18} className={cn("transition-colors", isActive ? "text-accent-green" : "group-hover:text-text-med")} />
      <span className={cn("text-[9px] font-medium transition-colors", isActive ? "text-accent-green" : "text-text-dark group-hover:text-text-med")}>
        Console
      </span>
      {isActive && (
        <div
          className={cn(
            orientation === "left"
              ? "absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-6 rounded-r"
              : "absolute left-1/2 -translate-x-1/2 bottom-0 h-[2px] w-7 rounded-t",
            "bg-accent-green"
          )}
        />
      )}
    </button>
  );
}

export function ToolBar() {
  const {
    activePanel,
    togglePanel,
    setPanel,
    consoleVisible,
    toggleConsole,
    toolbarPosition,
    toggleToolbarPosition,
  } = useToolPanelStore();
  const { enabledToolIds } = useToolCatalogStore();
  const isHorizontal = toolbarPosition === "top";
  const overflowWrapRef = useRef<HTMLDivElement>(null);
  const horizontalTrackRef = useRef<HTMLDivElement>(null);
  const verticalTrackRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState<number>(999);
  const [verticalVisibleCount, setVerticalVisibleCount] = useState<number>(999);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const mainPanels = useMemo(
    () => getToolbarMainTools().filter((tool) => enabledToolIds.includes(tool.id)),
    [enabledToolIds]
  );
  const auxPanels = useMemo(
    () => getToolbarAuxTools().filter((tool) => enabledToolIds.includes(tool.id)),
    [enabledToolIds]
  );
  const enabledPanelIds = useMemo(
    () => new Set([...mainPanels, ...auxPanels].map((tool) => tool.id)),
    [auxPanels, mainPanels]
  );
  const horizontalEntries = useMemo<ToolbarEntry[]>(
    () => [
      ...mainPanels.map((panel) => ({ key: `panel:${panel.id}`, kind: "panel" as const, panelId: panel.id })),
      ...auxPanels.map((panel) => ({ key: `panel:${panel.id}`, kind: "panel" as const, panelId: panel.id })),
      { key: "console", kind: "console" as const },
    ],
    [auxPanels, mainPanels]
  );
  const verticalPinnedEntries = useMemo<ToolbarEntry[]>(() => {
    const entries: ToolbarEntry[] = [];
    if (enabledToolIds.includes("settings")) {
      entries.push({ key: "panel:settings", kind: "panel", panelId: "settings" });
    }
    if (enabledToolIds.includes("help")) {
      entries.push({ key: "panel:help", kind: "panel", panelId: "help" });
    }
    entries.push({ key: "console", kind: "console" });
    return entries;
  }, [enabledToolIds]);
  const verticalPinnedKeys = useMemo(
    () => new Set(verticalPinnedEntries.map((entry) => entry.key)),
    [verticalPinnedEntries]
  );
  const verticalPrimaryEntries = useMemo(
    () => horizontalEntries.filter((entry) => !verticalPinnedKeys.has(entry.key)),
    [horizontalEntries, verticalPinnedKeys]
  );
  const visibleHorizontalEntries = horizontalEntries.slice(0, Math.max(0, visibleCount));
  const overflowHorizontalEntries = horizontalEntries.slice(Math.max(0, visibleCount));
  const visibleVerticalEntries = verticalPrimaryEntries.slice(0, Math.max(0, verticalVisibleCount));
  const overflowVerticalEntries = verticalPrimaryEntries.slice(Math.max(0, verticalVisibleCount));

  useEffect(() => {
    if (activePanel !== "none" && !enabledPanelIds.has(activePanel)) {
      setPanel("files");
    }
  }, [activePanel, enabledPanelIds, setPanel]);

  useEffect(() => {
    if (!isHorizontal) return;
    const track = horizontalTrackRef.current;
    if (!track) return;

    const recalc = () => {
      const available = track.clientWidth;
      const itemWidth = 52;
      const menuWidth = 34;
      const raw = Math.max(0, Math.floor((available + 4) / itemWidth));
      let next = Math.min(horizontalEntries.length, raw);
      if (next < horizontalEntries.length) {
        next = Math.max(0, Math.floor((available - menuWidth + 4) / itemWidth));
      }
      setVisibleCount(Math.min(horizontalEntries.length, next));
    };

    recalc();
    const observer = new ResizeObserver(recalc);
    observer.observe(track);
    return () => observer.disconnect();
  }, [horizontalEntries.length, isHorizontal]);

  useEffect(() => {
    if (isHorizontal) return;
    const track = verticalTrackRef.current;
    if (!track) return;

    const recalc = () => {
      const available = track.clientHeight;
      const itemHeight = 52;
      const menuHeight = 34;
      const raw = Math.max(0, Math.floor((available + 2) / itemHeight));
      let next = Math.min(verticalPrimaryEntries.length, raw);
      if (next < verticalPrimaryEntries.length) {
        next = Math.max(0, Math.floor((available - menuHeight + 2) / itemHeight));
      }
      setVerticalVisibleCount(Math.min(verticalPrimaryEntries.length, next));
    };

    recalc();
    const observer = new ResizeObserver(recalc);
    observer.observe(track);
    return () => observer.disconnect();
  }, [isHorizontal, verticalPrimaryEntries.length]);

  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!overflowWrapRef.current?.contains(event.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [overflowOpen]);

  useEffect(() => {
    const hasOverflow = isHorizontal
      ? overflowHorizontalEntries.length > 0
      : overflowVerticalEntries.length > 0;
    if (!hasOverflow && overflowOpen) {
      setOverflowOpen(false);
    }
  }, [isHorizontal, overflowHorizontalEntries.length, overflowOpen, overflowVerticalEntries.length]);

  const renderEntry = (entry: ToolbarEntry, orientation: "left" | "top") => {
    if (entry.kind === "console") {
      return (
        <ConsoleButton
          key={entry.key}
          isActive={consoleVisible}
          onClick={toggleConsole}
          orientation={orientation}
        />
      );
    }
    return (
      <ToolBarButton
        key={entry.key}
        panelId={entry.panelId}
        isActive={activePanel === entry.panelId}
        onClick={() => togglePanel(entry.panelId)}
        orientation={orientation}
      />
    );
  };

  return (
    <div
      className={cn(
        isHorizontal
          ? "h-12 w-full flex flex-row items-center px-1.5 gap-1 border-b border-line-light"
          : "w-12 flex flex-col items-center py-2 gap-0.5 border-r border-line-light",
        "bg-bg-norm flex-shrink-0"
      )}
    >
      <button
        onClick={toggleToolbarPosition}
        title={isHorizontal ? "Move toolbar to left side" : "Move toolbar to top"}
        className={cn(
          isHorizontal
            ? "h-full min-w-12 px-2 flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
            : "w-full py-2 px-1 flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
        )}
      >
        {isHorizontal ? <PanelRight size={16} /> : <PanelTop size={16} />}
      </button>

      <div className={cn(isHorizontal ? "w-px h-7 bg-line-light" : "w-8 h-px bg-line-light my-1")} />

      {isHorizontal ? (
        <>
          <div ref={horizontalTrackRef} className="flex-1 min-w-0 h-full">
            <div className="flex h-full items-center gap-0 overflow-hidden">
              {visibleHorizontalEntries.map((entry) => renderEntry(entry, "top"))}
            </div>
          </div>

          {overflowHorizontalEntries.length > 0 && (
            <div ref={overflowWrapRef} className="relative h-full flex items-center">
              <button
                onClick={() => setOverflowOpen((v) => !v)}
                title="More tools"
                className="h-full min-w-10 px-2 rounded text-text-med hover:text-text-norm hover:bg-line-light transition-colors"
              >
                <ChevronDown size={16} />
              </button>
              {overflowOpen && (
                <div className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-44 rounded-md border border-line-med bg-bg-light shadow-xl ring-1 ring-text-dark/35 p-1">
                  {overflowHorizontalEntries.map((entry) => {
                    if (entry.kind === "console") {
                      return (
                        <button
                          key={entry.key}
                          onClick={() => {
                            toggleConsole();
                            setOverflowOpen(false);
                          }}
                          className={cn(
                            "w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors",
                            consoleVisible
                              ? "text-accent-green bg-accent-green/10"
                              : "text-text-med hover:text-text-norm hover:bg-line-light"
                          )}
                        >
                          <Terminal size={13} />
                          <span>Console</span>
                        </button>
                      );
                    }

                    const config = getToolManifest(entry.panelId);
                    const Icon = config?.icon;
                    if (!config || !Icon) return null;
                    return (
                      <button
                        key={entry.key}
                        onClick={() => {
                          togglePanel(entry.panelId);
                          setOverflowOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors",
                          activePanel === entry.panelId
                            ? "text-accent-primary bg-accent-primary/10"
                            : "text-text-med hover:text-text-norm hover:bg-line-light"
                        )}
                      >
                        <Icon size={13} />
                        <span>{config.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div ref={verticalTrackRef} className="flex-1 min-h-0 w-full px-1">
            <div className="flex h-full flex-col gap-0 overflow-hidden">
              {visibleVerticalEntries.map((entry) => renderEntry(entry, "left"))}
            </div>
          </div>

          {overflowVerticalEntries.length > 0 && (
            <div ref={overflowWrapRef} className="relative w-full px-1">
              <button
                onClick={() => setOverflowOpen((v) => !v)}
                title="More tools"
                className="w-full py-2 px-1 flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light transition-colors"
              >
                <ChevronDown size={16} />
              </button>
              {overflowOpen && (
                <div className="absolute left-[calc(100%+6px)] bottom-0 z-40 min-w-44 rounded-md border border-line-med bg-bg-light shadow-xl ring-1 ring-text-dark/35 p-1">
                  {overflowVerticalEntries.map((entry) => {
                    if (entry.kind === "console") {
                      return (
                        <button
                          key={entry.key}
                          onClick={() => {
                            toggleConsole();
                            setOverflowOpen(false);
                          }}
                          className={cn(
                            "w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors",
                            consoleVisible
                              ? "text-accent-green bg-accent-green/10"
                              : "text-text-med hover:text-text-norm hover:bg-line-light"
                          )}
                        >
                          <Terminal size={13} />
                          <span>Console</span>
                        </button>
                      );
                    }

                    const config = getToolManifest(entry.panelId);
                    const Icon = config?.icon;
                    if (!config || !Icon) return null;
                    return (
                      <button
                        key={entry.key}
                        onClick={() => {
                          togglePanel(entry.panelId);
                          setOverflowOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors",
                          activePanel === entry.panelId
                            ? "text-accent-primary bg-accent-primary/10"
                            : "text-text-med hover:text-text-norm hover:bg-line-light"
                        )}
                      >
                        <Icon size={13} />
                        <span>{config.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {verticalPinnedEntries.length > 0 && (
            <>
              <div className="w-8 h-px bg-line-light my-1" />
              {verticalPinnedEntries.map((entry) => (
                <div key={entry.key} className="w-full px-1">
                  {renderEntry(entry, "left")}
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
