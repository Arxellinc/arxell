import type { ReactNode } from "react";
import { useState, useCallback, useRef, useEffect } from "react";
import { ChevronDown, ChevronUp, Copy, Check } from "lucide-react";
import { cn } from "../../../lib/utils";

const DEFAULT_SIDEBAR_WIDTH = 224; // ~w-56
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 400;

interface SplitPaneLayoutProps {
  /** Content for the left sidebar (list, search, etc.) */
  sidebar: ReactNode;
  /** Main content area */
  content: ReactNode;
  /** Optional JSON data to display in collapsible footer */
  jsonData?: object | null;
  /** Label for the JSON section */
  jsonLabel?: string;
  /** Whether to show the JSON section */
  showJson?: boolean;
  /** Controlled sidebar width (for persistence) */
  sidebarWidth?: number;
  /** Callback when sidebar width changes */
  onSidebarWidthChange?: (width: number) => void;
  /** Storage key for persisting sidebar width */
  storageKey?: string;
}

export function SplitPaneLayout({
  sidebar,
  content,
  jsonData,
  jsonLabel = "Data",
  showJson = true,
  sidebarWidth: controlledWidth,
  onSidebarWidthChange,
  storageKey,
}: SplitPaneLayoutProps) {
  // Initialize from storage or default
  const getInitialWidth = useCallback(() => {
    if (controlledWidth !== undefined) return controlledWidth;
    if (storageKey) {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
          return parsed;
        }
      }
    }
    return DEFAULT_SIDEBAR_WIDTH;
  }, [controlledWidth, storageKey]);

  const [sidebarWidth, setSidebarWidth] = useState(getInitialWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [jsonExpanded, setJsonExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync with controlled width
  useEffect(() => {
    if (controlledWidth !== undefined && controlledWidth !== sidebarWidth) {
      setSidebarWidth(controlledWidth);
    }
  }, [controlledWidth, sidebarWidth]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, e.clientX - rect.left));
      setSidebarWidth(newWidth);
      onSidebarWidthChange?.(newWidth);
      if (storageKey) {
        localStorage.setItem(storageKey, String(newWidth));
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, onSidebarWidthChange, storageKey]);

  const copyJson = async () => {
    if (!jsonData) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(jsonData, null, 2));
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1200);
  };

  const jsonString = jsonData ? JSON.stringify(jsonData, null, 2) : "";

  return (
    <div ref={containerRef} className="flex-1 flex min-h-0 overflow-hidden">
      {/* Sidebar */}
      <div
        style={{ width: sidebarWidth }}
        className="flex-shrink-0 border-r border-line-med overflow-y-auto"
      >
        {sidebar}
      </div>

      {/* Resizer */}
      <div
        className={cn(
          "w-1 flex-shrink-0 cursor-col-resize hover:bg-accent-primary/30 transition-colors",
          isResizing && "bg-accent-primary/50"
        )}
        onMouseDown={handleMouseDown}
      />

      {/* Main content area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Content */}
        <div className="flex-1 min-w-0 overflow-auto">
          {content}
        </div>

        {/* Collapsible JSON section */}
        {showJson && jsonData && (
          <div className="border-t border-line-light bg-black/20 flex-shrink-0">
            <div className="flex items-center justify-between px-3 py-1.5">
              <button
                onClick={() => setJsonExpanded((v) => !v)}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-text-med hover:text-text-norm transition-colors"
                title="Toggle JSON view"
              >
                {jsonExpanded ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
                {jsonLabel}
              </button>
              <button
                onClick={() => void copyJson()}
                className="px-1.5 py-0.5 rounded text-[10px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors inline-flex items-center gap-1"
              >
                {copyState === "copied" ? (
                  <>
                    <Check size={10} className="text-accent-green" />
                    Copied
                  </>
                ) : copyState === "error" ? (
                  "Error"
                ) : (
                  <>
                    <Copy size={10} />
                    Copy
                  </>
                )}
              </button>
            </div>
            {jsonExpanded && (
              <textarea
                readOnly
                aria-label={`${jsonLabel} JSON`}
                value={jsonString}
                className="block w-full max-h-40 min-h-24 px-3 pb-2 bg-transparent text-[10px] leading-4 text-accent-green/90 font-mono outline-none resize-y"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Sidebar item component for consistent styling
interface SidebarItemProps {
  id: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  actions?: ReactNode;
  className?: string;
}

export function SidebarItem({
  title,
  subtitle,
  icon,
  selected,
  onClick,
  actions,
  className,
}: SidebarItemProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "px-3 py-2 border-b border-line-light cursor-pointer transition-colors group",
        selected
          ? "bg-accent-primary/10 border-l-2 border-l-accent-primary"
          : "hover:bg-line-light border-l-2 border-l-transparent",
        className
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {icon && <span className="flex-shrink-0 opacity-60">{icon}</span>}
          <span className="text-xs font-medium text-text-med truncate">{title}</span>
        </div>
        {actions && (
          <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {actions}
          </div>
        )}
      </div>
      {subtitle && (
        <p className="text-[10px] text-text-dark truncate mt-0.5 ml-6">{subtitle}</p>
      )}
    </div>
  );
}

// Sidebar search component
interface SidebarSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SidebarSearch({ value, onChange, placeholder = "Search..." }: SidebarSearchProps) {
  return (
    <div className="p-2 border-b border-line-light flex-shrink-0">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2 py-1.5 text-xs bg-line-light border border-line-med rounded text-text-norm placeholder:text-text-dark focus:outline-none focus:border-accent-primary/50"
      />
    </div>
  );
}

// Sidebar header component
interface SidebarHeaderProps {
  title: string;
  count?: number;
}

export function SidebarHeader({ title, count }: SidebarHeaderProps) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-text-dark px-3 py-2 border-b border-line-light flex-shrink-0">
      {title}
      {count !== undefined && (
        <span className="ml-1 text-text-med">({count})</span>
      )}
    </div>
  );
}

// Collapsible sidebar section component
interface SidebarSectionProps {
  title: string;
  count?: number;
  collapsed?: boolean;
  onToggle?: () => void;
  children: ReactNode;
  defaultCollapsed?: boolean;
}

export function SidebarSection({
  title,
  count,
  collapsed: controlledCollapsed,
  onToggle,
  children,
  defaultCollapsed = false
}: SidebarSectionProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const collapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;

  const handleToggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalCollapsed(!internalCollapsed);
    }
  };

  return (
    <div className="flex-shrink-0">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-dark hover:text-text-med hover:bg-line-light transition-colors"
      >
        <span className="flex items-center gap-1">
          <ChevronDown
            size={10}
            className={cn(
              "transition-transform duration-150",
              collapsed && "-rotate-90"
            )}
          />
          {title}
          {count !== undefined && (
            <span className="text-text-med">({count})</span>
          )}
        </span>
      </button>
      {!collapsed && (
        <div className="border-b border-line-light">
          {children}
        </div>
      )}
    </div>
  );
}

// Empty state component
interface EmptyStateProps {
  message: string;
  icon?: ReactNode;
}

export function EmptyState({ message, icon }: EmptyStateProps) {
  return (
    <div className="p-4 text-center text-xs text-text-dark italic">
      {icon && <div className="mb-2 flex justify-center">{icon}</div>}
      {message}
    </div>
  );
}
