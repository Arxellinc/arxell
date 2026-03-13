import { useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, X, Trash2, Plus, ChevronDown, ChevronUp, ScrollText, Code2, Copy, Gauge, HardDrive, Network, ScanSearch } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { cn } from "../../lib/utils";

interface LogEntry {
  level: "info" | "warn" | "error" | "debug" | "log";
  message: string;
  timestamp: number;
  source: "backend" | "console";
}

type TerminalTabType = "logs" | "console" | "dom" | "network" | "performance" | "storage";

interface TerminalTab {
  id: string;
  name: string;
  type: TerminalTabType;
  logs: LogEntry[];
}

interface TerminalProps {
  height: number;
  onHeightChange: (height: number) => void;
}

let tabIdCounter = 0;

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

export function Terminal({ height, onHeightChange }: TerminalProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: "console-0", name: "Console", type: "console", logs: [] },
    { id: "logs-0", name: "Backend Logs", type: "logs", logs: [] },
    { id: "dom-0", name: "DOM / Style", type: "dom", logs: [] },
    { id: "network-0", name: "Network", type: "network", logs: [] },
    { id: "performance-0", name: "Performance", type: "performance", logs: [] },
    { id: "storage-0", name: "Storage", type: "storage", logs: [] },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("console-0");
  const [isExpanded, setIsExpanded] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [domSnapshot, setDomSnapshot] = useState<string>("");
  const [networkSnapshot, setNetworkSnapshot] = useState<string>("");
  const [performanceSnapshot, setPerformanceSnapshot] = useState<string>("");
  const [storageSnapshot, setStorageSnapshot] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Add a log entry to specific tab types
  const addLogEntry = (entry: LogEntry, tabType: "logs" | "console" | "both") => {
    setTabs((prevTabs) =>
      prevTabs.map((tab) => {
        if (tabType === "both" || tab.type === tabType) {
          return { ...tab, logs: [...tab.logs.slice(-500), entry] };
        }
        return tab;
      })
    );
  };

  // Set up console interception
  useEffect(() => {
    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
      debug: console.debug,
    };

    const interceptConsole = (level: LogEntry["level"]) => {
      return (...args: unknown[]) => {
        // Call original method
        originalConsole[level](...args);

        // Format the message
        const message = args
          .map((arg) => {
            if (typeof arg === "string") return arg;
            if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          })
          .join(" ");

        addLogEntry(
          {
            level,
            message,
            timestamp: Date.now(),
            source: "console",
          },
          "console"
        );
      };
    };

    console.log = interceptConsole("log");
    console.warn = interceptConsole("warn");
    console.error = interceptConsole("error");
    console.info = interceptConsole("info");
    console.debug = interceptConsole("debug");

    return () => {
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.info = originalConsole.info;
      console.debug = originalConsole.debug;
    };
  }, []);

  // Set up backend log event listeners
  useEffect(() => {
    const handlers = [
      { event: "log:info", level: "info" as const },
      { event: "log:warn", level: "warn" as const },
      { event: "log:error", level: "error" as const },
      { event: "log:debug", level: "debug" as const },
    ];

    const unlisteners = handlers.map(({ event, level }) =>
      listen<string>(event, (e) => {
        addLogEntry(
          {
            level,
            message: e.payload,
            timestamp: Date.now(),
            source: "backend",
          },
          "logs"
        );
      })
    );

    void Promise.all(unlisteners);

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current && isExpanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeTab?.logs, isExpanded]);

  useEffect(() => {
    const refreshDevSnapshots = async () => {
      const activeEl = document.activeElement as HTMLElement | null;
      const bodyStyle = window.getComputedStyle(document.body);
      const allNodes = document.querySelectorAll("*").length;
      const styleSheets = Array.from(document.styleSheets ?? []);
      const media = styleSheets.filter((sheet) => {
        try {
          return Boolean(sheet.media?.mediaText);
        } catch {
          return false;
        }
      }).length;
      setDomSnapshot(
        [
          `Nodes: ${allNodes.toLocaleString()}`,
          `Stylesheets: ${styleSheets.length} (${media} with media query)`,
          `Focused Element: ${activeEl ? `${activeEl.tagName.toLowerCase()}${activeEl.id ? `#${activeEl.id}` : ""}${activeEl.className ? `.${String(activeEl.className).replace(/\s+/g, ".")}` : ""}` : "none"}`,
          `Body Font: ${bodyStyle.fontFamily}`,
          `Body Color: ${bodyStyle.color}`,
          `Body Background: ${bodyStyle.backgroundColor}`,
        ].join("\n")
      );

      const nav = navigator as Navigator & {
        connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
      };
      const conn = nav.connection;
      const resources = performance
        .getEntriesByType("resource")
        .slice(-8)
        .map((entry) => {
          const r = entry as PerformanceResourceTiming;
          const ms = Number.isFinite(r.duration) ? `${Math.round(r.duration)}ms` : "-";
          return `- ${r.initiatorType || "resource"} ${r.name} (${ms})`;
        });
      setNetworkSnapshot(
        [
          `Online: ${navigator.onLine ? "yes" : "no"}`,
          `Connection Type: ${conn?.effectiveType ?? "n/a"}`,
          `Downlink: ${conn?.downlink ? `${conn.downlink} Mbps` : "n/a"}`,
          `RTT: ${conn?.rtt ? `${conn.rtt} ms` : "n/a"}`,
          `Save-Data: ${conn?.saveData ? "on" : "off"}`,
          "",
          "Recent Resource Requests:",
          ...(resources.length > 0 ? resources : ["- none observed yet"]),
        ].join("\n")
      );

      const perfMem = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      const navEntries = performance.getEntriesByType("navigation");
      const navTiming = navEntries.length > 0 ? (navEntries[0] as PerformanceNavigationTiming) : null;
      setPerformanceSnapshot(
        [
          `Time Origin: ${Math.round(performance.timeOrigin)}`,
          `Now: ${Math.round(performance.now())}ms`,
          `JS Heap Used: ${formatBytes(perfMem?.usedJSHeapSize ?? null)}`,
          `JS Heap Total: ${formatBytes(perfMem?.totalJSHeapSize ?? null)}`,
          `JS Heap Limit: ${formatBytes(perfMem?.jsHeapSizeLimit ?? null)}`,
          `DOM Content Loaded: ${navTiming ? `${Math.round(navTiming.domContentLoadedEventEnd)}ms` : "n/a"}`,
          `Load Event End: ${navTiming ? `${Math.round(navTiming.loadEventEnd)}ms` : "n/a"}`,
        ].join("\n")
      );

      const storage = navigator.storage;
      if (storage?.estimate) {
        try {
          const estimate = await storage.estimate();
          const used = estimate.usage ?? 0;
          const quota = estimate.quota ?? 0;
          const percent = quota > 0 ? ((used / quota) * 100).toFixed(2) : "0.00";
          setStorageSnapshot(
            [
              `Storage Used: ${formatBytes(used)}`,
              `Storage Quota: ${formatBytes(quota)}`,
              `Usage: ${percent}%`,
              "",
              "Note: this is browser/webview storage usage for the app context.",
            ].join("\n")
          );
        } catch {
          setStorageSnapshot("Storage estimate is unavailable in this runtime.");
        }
      } else {
        setStorageSnapshot("Storage estimate API is unavailable in this runtime.");
      }
    };

    void refreshDevSnapshots();
    const id = window.setInterval(() => {
      void refreshDevSnapshots();
    }, 3000);
    return () => window.clearInterval(id);
  }, []);

  const addTab = (type: "logs" | "console") => {
    const newTab: TerminalTab = {
      id: `${type}-${++tabIdCounter}`,
      name: type === "logs" ? "Backend Logs" : "Console",
      type,
      logs: [],
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const closeTab = (tabId: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const newTabs = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      }
      return newTabs;
    });
  };

  const clearLogs = () => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId ? { ...tab, logs: [] } : tab
      )
    );
  };

  const copyActiveTabLogs = async () => {
    if (!activeTab) return;
    let content = "";
    if (activeTab.type === "console" || activeTab.type === "logs") {
      content = activeTab.logs
        .map((log) => {
          const time = new Date(log.timestamp).toLocaleTimeString();
          return `${time} ${getLevelPrefix(log.level)} ${log.message}`;
        })
        .join("\n");
    } else if (activeTab.type === "dom") {
      content = domSnapshot;
    } else if (activeTab.type === "network") {
      content = networkSnapshot;
    } else if (activeTab.type === "performance") {
      content = performanceSnapshot;
    } else if (activeTab.type === "storage") {
      content = storageSnapshot;
    }
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1200);
    } catch {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 1200);
    }
  };

  const getLevelColor = (level: LogEntry["level"]) => {
    switch (level) {
      case "error":
        return "text-accent-red";
      case "warn":
        return "text-accent-gold";
      case "debug":
        return "text-text-dark";
      default:
        return "text-text-med";
    }
  };

  const getLevelPrefix = (level: LogEntry["level"]) => {
    switch (level) {
      case "error":
        return "[ERROR]";
      case "warn":
        return "[WARN]";
      case "debug":
        return "[DEBUG]";
      case "info":
        return "[INFO]";
      default:
        return "[LOG]";
    }
  };

  const getTabIcon = (type: TerminalTabType) => {
    switch (type) {
      case "console":
        return <Code2 size={10} />;
      case "logs":
        return <ScrollText size={10} />;
      case "dom":
        return <ScanSearch size={10} />;
      case "network":
        return <Network size={10} />;
      case "performance":
        return <Gauge size={10} />;
      case "storage":
        return <HardDrive size={10} />;
      default:
        return <Code2 size={10} />;
    }
  };

  const activeTabHasContent = (() => {
    if (!activeTab) return false;
    if (activeTab.type === "console" || activeTab.type === "logs") return activeTab.logs.length > 0;
    if (activeTab.type === "dom") return domSnapshot.trim().length > 0;
    if (activeTab.type === "network") return networkSnapshot.trim().length > 0;
    if (activeTab.type === "performance") return performanceSnapshot.trim().length > 0;
    if (activeTab.type === "storage") return storageSnapshot.trim().length > 0;
    return false;
  })();

  const renderTruncatedLines = (text: string) => {
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) {
      return <div className="truncate text-[11px] leading-5 text-text-med" title={text}>{text}</div>;
    }
    return (
      <div className="space-y-0.5 text-[11px] leading-5 text-text-med">
        {lines.map((line, index) => (
          <div key={index} className="truncate" title={line}>
            {line || " "}
          </div>
        ))}
      </div>
    );
  };

  const renderDevSnapshot = (text: string) => renderTruncatedLines(text);

  const renderActiveTabContent = () => {
    if (!activeTab) return <div className="text-text-dark italic">No tab selected.</div>;
    if (activeTab.type === "dom") return renderDevSnapshot(domSnapshot || "Collecting DOM/style data...");
    if (activeTab.type === "network") return renderDevSnapshot(networkSnapshot || "Collecting network data...");
    if (activeTab.type === "performance") return renderDevSnapshot(performanceSnapshot || "Collecting performance data...");
    if (activeTab.type === "storage") return renderDevSnapshot(storageSnapshot || "Collecting storage data...");
    if (activeTab.logs.length === 0) {
      return (
        <div className="text-text-dark italic">
          {activeTab.type === "console" ? "No console output yet..." : "No backend logs yet..."}
        </div>
      );
    }
    return activeTab.logs.map((log, i) => (
      <div key={i} className={cn("flex gap-2 min-w-0", getLevelColor(log.level))}>
        <span className="text-text-dark shrink-0 select-none">
          {new Date(log.timestamp).toLocaleTimeString()}
        </span>
        <span className="shrink-0 select-none">{getLevelPrefix(log.level)}</span>
        <span className="min-w-0 flex-1 truncate" title={log.message}>
          {log.message}
        </span>
      </div>
    ));
  };

  if (!isExpanded) {
    const totalLogs = tabs.reduce((sum, tab) => sum + tab.logs.length, 0);
    return (
      <div className="border-t border-line-light bg-bg-dark flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs text-text-dark">
          <TerminalIcon size={12} />
          <span>Console</span>
          {totalLogs > 0 && (
            <span className="text-text-dark">({totalLogs} entries)</span>
          )}
        </div>
        <button
          onClick={() => setIsExpanded(true)}
          className="p-1 hover:bg-line-med rounded text-text-dark hover:text-text-med transition-colors"
        >
          <ChevronUp size={14} />
        </button>
      </div>
    );
  }

  return (
    <div
      className="border-t border-line-light bg-bg-dark flex flex-col"
      style={{ height }}
    >
      {/* Tab bar */}
      <div className="flex items-center border-b border-line-light bg-bg-dark">
        <div className="flex items-center overflow-x-auto scrollbar-none flex-1">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={cn(
                  "group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer border-r border-line-light flex-shrink-0 transition-colors relative",
                  isActive
                    ? "bg-bg-dark text-text-norm"
                    : "text-text-dark hover:text-text-med hover:bg-line-light"
                )}
                onClick={() => setActiveTabId(tab.id)}
              >
                {getTabIcon(tab.type)}
                <span className="text-[11px] font-medium">{tab.name}</span>
                {tab.logs.length > 0 && (
                  <span className="text-[9px] text-text-dark">
                    {tab.logs.length}
                  </span>
                )}
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 ml-0.5 p-0.5 rounded hover:bg-line-med text-text-dark hover:text-text-med transition-all flex-shrink-0"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Add tab buttons */}
        <button
          onClick={() => addTab("console")}
          className="p-1.5 hover:bg-line-med text-text-dark hover:text-text-med transition-colors flex-shrink-0"
          title="New console tab"
        >
          <Plus size={12} />
        </button>

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 px-1 border-l border-line-light">
          <button
            onClick={() => void copyActiveTabLogs()}
            disabled={!activeTabHasContent}
            className="p-1 hover:bg-line-med rounded text-text-dark hover:text-text-med transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            title="Copy current tab output"
          >
            <Copy size={12} />
          </button>
          {copyState !== "idle" && (
            <span
              className={cn(
                "px-1 text-[10px]",
                copyState === "copied" ? "text-accent-green" : "text-accent-red"
              )}
            >
              {copyState === "copied" ? "Copied" : "Copy failed"}
            </span>
          )}
          <button
            onClick={clearLogs}
            disabled={!activeTab || (activeTab.type !== "console" && activeTab.type !== "logs")}
            className="p-1 hover:bg-line-med rounded text-text-dark hover:text-text-med transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            title="Clear logs"
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1 hover:bg-line-med rounded text-text-dark hover:text-text-med transition-colors"
          >
            <ChevronDown size={12} />
          </button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto font-mono text-[11px] p-2 space-y-0.5 select-text"
        style={{ userSelect: 'text' }}
      >
        {renderActiveTabContent()}
      </div>
    </div>
  );
}
