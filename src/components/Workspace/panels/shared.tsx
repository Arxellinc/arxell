import type { ReactNode } from "react";
import { TASK_DESCRIPTION_TEMPLATE, type AgentTask } from "../../../store/taskStore";

export interface StorageDevice {
  name: string;
  mountPoint: string;
  fileSystem: string;
  kind: string;
  totalMb: number;
  availableMb: number;
  usedMb: number;
  usagePercent: number;
  isRemovable: boolean;
}

export interface DisplayInfo {
  name: string | null;
  width: number;
  height: number;
  scaleFactor: number;
  x: number;
  y: number;
  isPrimary: boolean;
}

export interface SystemIdentity {
  osName: string | null;
  osVersion: string | null;
  kernelVersion: string | null;
  hostName: string | null;
  uptimeSecs: number;
  bootTimeSecs: number;
  userName: string | null;
  cpuName: string;
  cpuArch: string;
  cpuPhysicalCores: number;
  cpuLogicalCores: number;
}

interface PanelWrapperProps {
  title: ReactNode;
  icon: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /** When true the content area uses flex-col + overflow-hidden so children
   *  can fill the remaining height with flex-1. Use for panels (e.g. Terminal)
   *  that manage their own scrolling internally. */
  fill?: boolean;
}

export function PanelWrapper({ title, icon, children, actions, fill }: PanelWrapperProps) {
  return (
    <div className="flex flex-col h-full bg-bg-dark">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line-med bg-bg-norm flex-shrink-0">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-text-norm">{title}</span>
        </div>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      <div className={fill ? "relative flex-1 min-h-0 flex flex-col overflow-hidden" : "flex-1 overflow-auto"}>
        {children}
      </div>
    </div>
  );
}

export interface ApiFormState {
  name: string;
  api_type: "chat" | "voice" | "data" | "speech" | "other";
  model_id: string;
  base_url: string;
  api_key: string;
  parameter_count: string;
  speed_tps: string;
  context_length: string;
  monthly_cost: string;
  cost_per_million_tokens: string;
  is_primary: boolean;
}

export type VerifyState = {
  state: "idle" | "checking" | "ok" | "fail";
  message: string;
};

export const DEFAULT_API_FORM: ApiFormState = {
  name: "",
  api_type: "chat",
  model_id: "",
  base_url: "http://127.0.0.1:1234/v1",
  api_key: "",
  parameter_count: "",
  speed_tps: "",
  context_length: "",
  monthly_cost: "",
  cost_per_million_tokens: "",
  is_primary: false,
};

export function normalizeApiBaseUrl(value: string): string {
  let root = value.trim().replace(/\/+$/, "");
  root = root
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/completions$/i, "")
    .replace(/\/responses$/i, "")
    .replace(/\/models$/i, "")
    .replace(/\/+$/, "");

  if (!root) return "";
  const nestedVersionMatch = root.match(/^(.*\/v\d+)\/v1$/i);
  if (nestedVersionMatch) {
    root = nestedVersionMatch[1];
  }
  if (/\/v\d+$/i.test(root)) return root;
  if (root.toLowerCase().endsWith("/v1")) return root;
  return `${root}/v1`;
}

export function maskApiKey(value: string): string {
  if (!value) return "Not set";
  if (value.length <= 6) return "******";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

export function toOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export function formatSizeBillions(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${(value / 1_000_000_000).toFixed(1)}B`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `$${value.toFixed(2)}`;
}

export function extractLatencyLabel(message: string): string | null {
  const match = message.match(/(\d+)\s*ms/i);
  return match ? `${match[1]}ms` : null;
}

export function buildTaskBody(task: AgentTask): string {
  const due = task.due_at ? new Date(task.due_at).toLocaleString() : "None";
  const deps = Array.isArray(task.dependencies) && task.dependencies.length > 0
    ? task.dependencies.join(", ")
    : "None";
  const effort = task.estimated_effort_hours ?? "-";
  const createdBy = task.created_by ?? "user";
  return [
    `# ${task.title || "Untitled Task"}`,
    `Project: ${task.project_name}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority ?? 50}`,
    `Due: ${due}`,
    `Effort: ${effort}`,
    `Dependencies: ${deps}`,
    `Created By: ${createdBy}`,
    "",
    task.description || TASK_DESCRIPTION_TEMPLATE,
  ].join("\n");
}

export function extractTaskDescription(bodyText: string): string {
  const parts = bodyText.split(/\n\s*\n/);
  if (parts.length <= 1) return "";
  return parts.slice(1).join("\n\n").trim();
}

export type BrowserMode = "browser" | "reader" | "markdown";

export interface BrowserSafetySettings {
  disableJavascript: boolean;
  allowHttpHttpsOnly: boolean;
  redirectRecheck: boolean;
  blockPrivateTargets: boolean;
  timeoutMs: number;
  maxRedirects: number;
  maxResponseBytes: number;
  maxConcurrency: number;
}

export function proxyUrl(target: string, mode: BrowserMode, safety?: BrowserSafetySettings): string {
  const params = new URLSearchParams({
    url: target,
    mode,
  });
  if (safety) {
    params.set("disableJavascript", String(safety.disableJavascript));
    params.set("allowHttpHttpsOnly", String(safety.allowHttpHttpsOnly));
    params.set("redirectRecheck", String(safety.redirectRecheck));
    params.set("blockPrivateTargets", String(safety.blockPrivateTargets));
    params.set("timeoutMs", String(safety.timeoutMs));
    params.set("maxRedirects", String(safety.maxRedirects));
    params.set("maxResponseBytes", String(safety.maxResponseBytes));
    params.set("maxConcurrency", String(safety.maxConcurrency));
  }
  return `webproxy://fetch?${params.toString()}`;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}
