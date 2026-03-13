import { useEffect, useState, useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  X,
  Upload,
  Cpu,
  ChevronDown,
  ChevronUp,
  Check,
  Loader2,
  AlertCircle,
  Server,
  MemoryStick,
  HardDrive,
  Zap,
  Plus,
  Box,
  FolderOpen,
  Settings,
  Globe,
  Cog,
  Activity,
  Download,
  Brain,
  Wrench,
  Eye,
  Trash2,
  Search,
  Cloud,
} from "lucide-react";
import {
  useServeStore,
  type ModelLoadConfig,
  type GenerationConfig,
  type EngineInstallProgress,
  DEFAULT_MODEL_LOAD_CONFIG,
} from "../store/serveStore";
import { cn } from "../lib/utils";
import type { ModelInfo, DeviceInfo, SystemResources, AvailableModel, RuntimeStatus } from "../types/model";
import { NpuSetupModal } from "./NpuSetupModal";
import {
  llmModelListAll,
  llmModelSetPrimary,
  type ModelConfig as LlmModelConfig,
} from "../core/tooling/client";
import { settingsGet, settingsSet } from "../lib/tauri";

interface ServePanelProps {
  open: boolean;
  onClose: () => void;
}

// Props for the content-only version (used in workspace panel)
export interface ServePanelContentProps {
  showCloseButton?: boolean;
  onClose?: () => void;
}

interface SupportedModelPreset {
  id: string;
  name: string;
  paramsLabel: string;
  sizeLabel: string;
  hasToolUse: boolean;
  hasThinking: boolean;
  hasVision: boolean;
  repoId: string;
  pinnedFile: string;
  quantizationOptions?: string[];
  query: string;
  summary: string;
  updatedLabel: string;
}

interface GpuUsageSnapshot {
  id: string;
  utilizationPercent: number | null;
  memoryTotalMb: number | null;
  memoryUsedMb: number | null;
}

interface SystemUsageSnapshot {
  cpuUtilizationPercent: number | null;
  memoryUsagePercent: number;
  gpus: GpuUsageSnapshot[];
  npuUtilizationPercent: number | null;
  timestampMs: number;
}

const DEFAULT_CONTEXT_OVERRIDE = 12_000;
const CONTEXT_OVERRIDE_STORAGE_KEY = "arx_model_context_override";

const SUPPORTED_MODELS: SupportedModelPreset[] = [
  { id: "qwen35-4b", name: "Qwen3.5 4B", paramsLabel: "4B", sizeLabel: "~4 GB", hasToolUse: true, hasThinking: true, hasVision: false, repoId: "unsloth/Qwen3.5-4B-GGUF", pinnedFile: "Q4_K_M", quantizationOptions: ["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0"], query: "Qwen3.5 4B GGUF", summary: "Compact Qwen3.5 4B instruct model — fast inference, low VRAM.", updatedLabel: "Recently updated" },
  { id: "qwen35-2b", name: "Qwen3.5 2B", paramsLabel: "2B", sizeLabel: "~2 GB", hasToolUse: true, hasThinking: true, hasVision: false, repoId: "unsloth/Qwen3.5-2B-GGUF", pinnedFile: "Q4_K_M", quantizationOptions: ["Q4_K_M", "Q5_K_M", "Q8_0"], query: "Qwen3.5 2B GGUF", summary: "Smallest Qwen3.5 option for fastest local startup and low VRAM usage.", updatedLabel: "Recently updated" },
  { id: "gpt-oss-20b", name: "GPT-OSS 20B", paramsLabel: "20B", sizeLabel: "~13 GB", hasToolUse: true, hasThinking: true, hasVision: false, repoId: "Arxell/gpt-oss-20b-MXFP4", pinnedFile: "gpt-oss-20b-MXFP4.gguf", quantizationOptions: ["gpt-oss-20b-MXFP4.gguf"], query: "Arxell gpt-oss-20b-MXFP4 gguf", summary: "Open-weight GPT-OSS 20B model for local reasoning and coding.", updatedLabel: "Last updated recently" },
  { id: "qwen35-35b-a3b", name: "Qwen3.5 35B A3B", paramsLabel: "35B-A3B", sizeLabel: "~22 GB", hasToolUse: true, hasThinking: true, hasVision: true, repoId: "unsloth/Qwen3.5-35B-A3B-GGUF", pinnedFile: "Q4_K_M", quantizationOptions: ["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "F16"], query: "Qwen3.5 35B A3B GGUF", summary: "Reasoning VLM with tool use. 35B total / 3B active MoE.", updatedLabel: "Last updated 3 days ago" },
  { id: "qwen35-27b", name: "Qwen3.5 27B", paramsLabel: "27B", sizeLabel: "~17 GB", hasToolUse: true, hasThinking: true, hasVision: false, repoId: "unsloth/Qwen3.5-27B-GGUF", pinnedFile: "Q4_K_M", quantizationOptions: ["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "F16"], query: "Qwen3.5 27B GGUF", summary: "General-purpose Qwen3.5 27B instruct model for local reasoning and coding.", updatedLabel: "Recently updated" },
  { id: "qwen35-9b", name: "Qwen3.5 9B", paramsLabel: "9B", sizeLabel: "~6 GB", hasToolUse: true, hasThinking: true, hasVision: false, repoId: "unsloth/Qwen3.5-9B-GGUF", pinnedFile: "Q4_K_M", quantizationOptions: ["Q4_K_M", "Q5_K_M", "Q6_K", "Q8_0", "F16"], query: "Qwen3.5 9B GGUF", summary: "Smaller Qwen3.5 model for faster local inference with strong quality per size.", updatedLabel: "Recently updated" },
  { id: "gpt-oss-120b", name: "GPT-OSS 120B", paramsLabel: "120B", sizeLabel: "~70 GB", hasToolUse: true, hasThinking: true, hasVision: false, repoId: "unsloth/gpt-oss-120b-GGUF", pinnedFile: "Q4_K_M", query: "gpt-oss-120b GGUF", summary: "Larger GPT-OSS 120B model for higher quality local reasoning.", updatedLabel: "Last updated recently" },
  { id: "qwen3-coder-next", name: "Qwen3 Coder Next", paramsLabel: "80B-A3B", sizeLabel: "~30 GB", hasToolUse: true, hasThinking: true, hasVision: false, repoId: "Qwen/Qwen3-Coder-Next-GGUF", pinnedFile: "Q4_K_M", query: "Qwen Coder Next 80B GGUF", summary: "Coding-focused 80B MoE with strong tool usage.", updatedLabel: "Last updated 24 days ago" },
  { id: "glm47-flash", name: "Glm 4.7 Flash", paramsLabel: "30B-A3B", sizeLabel: "~20 GB", hasToolUse: true, hasThinking: true, hasVision: false, repoId: "AaryanK/GLM-4.7-Flash-GGUF", pinnedFile: "Q4_K_M", query: "GLM 4.7 Flash GGUF", summary: "30B A3B MoE from Z.ai, 128k context.", updatedLabel: "Last updated 38 days ago" },
  { id: "glm46v-flash", name: "Glm 4.6v Flash", paramsLabel: "9B", sizeLabel: "~6 GB", hasToolUse: true, hasThinking: true, hasVision: true, repoId: "eaddario/GLM-4.6V-Flash-GGUF", pinnedFile: "Q4_K_M", query: "GLM 4.6V Flash GGUF", summary: "9B vision-language model, local + low-latency.", updatedLabel: "Last updated 70 days ago" },
  { id: "ministral-14b-reason", name: "Ministral 3 14B Reasoning", paramsLabel: "14B", sizeLabel: "~9 GB", hasToolUse: true, hasThinking: true, hasVision: false, repoId: "mistralai/Ministral-3.1-14B-Instruct-2509-GGUF", pinnedFile: "Q4_K_M", query: "Ministral 3 14B Reasoning GGUF", summary: "Reasoning post-train of Ministral 3 14B.", updatedLabel: "Last updated 87 days ago" },
  { id: "ministral-3b", name: "Ministral 3 3B", paramsLabel: "3B (+ vision encoder)", sizeLabel: "~2.5 GB", hasToolUse: true, hasThinking: false, hasVision: true, repoId: "mistralai/Ministral-3B-Instruct-2505-GGUF", pinnedFile: "Q4_K_M", query: "Ministral 3 3B GGUF", summary: "Smallest Ministral 3 model for edge deployment.", updatedLabel: "Last updated 87 days ago" },
];

const DEFAULT_UNSLOTH_QUANTS = ["Q4_K_M", "Q5_K_M", "Q8_0"];
const UNSLOTH_DYNAMIC_MODEL_REPOS: string[] = [
  "unsloth/Nemotron-3-Nano-30B-A3B-GGUF",
  "unsloth/GLM-4.7-GGUF",
  "unsloth/MiniMax-M2.1-GGUF",
  "unsloth/Qwen-Image-Edit-2511-GGUF",
  "unsloth/Devstral-Small-2-24B-Instruct-2512-GGUF",
  "unsloth/Ministral-3-14B-Instruct-2512-GGUF",
  "unsloth/GLM-4.6V-Flash-GGUF",
  "unsloth/Qwen3-Next-80B-A3B-Instruct-GGUF",
  "unsloth/Ministral-3-14B-Reasoning-2512-GGUF",
  "unsloth/functiongemma-270m-it-GGUF",
  "unsloth/Kimi-K2-Thinking-GGUF",
  "unsloth/GLM-4.6-GGUF",
  "unsloth/Qwen3-VL-30B-A3B-Instruct-GGUF",
  "unsloth/DeepSeek-V3.1-GGUF",
  "unsloth/DeepSeek-V3.1-Terminus-GGUF",
  "unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF",
  "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF",
  "unsloth/Qwen3-30B-A3B-Thinking-2507-GGUF",
  "unsloth/Qwen3-235B-A22B-Thinking-2507-GGUF",
  "unsloth/Qwen3-Coder-480B-A35B-Instruct-GGUF",
  "unsloth/Qwen3-235B-A22B-Instruct-2507-GGUF",
  "unsloth/Kimi-K2-Instruct-GGUF",
  "unsloth/Llama-4-Maverick-17B-128E-Instruct-GGUF",
  "unsloth/gemma-3n-E4B-it-GGUF",
  "unsloth/gemma-3n-E2B-it-GGUF",
  "unsloth/Magistral-Small-2506-GGUF",
  "unsloth/Mistral-Small-3.2-24B-Instruct-2506-GGUF",
  "unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF",
  "unsloth/DeepSeek-R1-0528-GGUF",
  "unsloth/Devstral-Small-2505-GGUF",
  "unsloth/Phi-4-reasoning-plus-GGUF",
  "unsloth/Phi-4-mini-reasoning-GGUF",
  "unsloth/Phi-4-reasoning-GGUF",
  "unsloth/Qwen3-32B-GGUF",
  "unsloth/Qwen3-14B-GGUF",
  "unsloth/Qwen3-8B-GGUF",
  "unsloth/Qwen3-30B-A3B-GGUF",
  "unsloth/Qwen3-235B-A22B-GGUF",
  "unsloth/Qwen3-4B-GGUF",
  "unsloth/Qwen3-0.6B-GGUF",
  "unsloth/DeepSeek-R1-GGUF-UD",
  "unsloth/DeepSeek-V3-0324-GGUF-UD",
  "unsloth/Llama-4-Scout-17B-16E-Instruct-GGUF",
  "unsloth/gemma-3-27b-it-GGUF",
  "unsloth/gemma-3-12b-it-GGUF",
  "unsloth/gemma-3-4b-it-GGUF",
  "unsloth/gemma-3-1b-it-GGUF",
  "unsloth/GLM-4.5-Air-GGUF",
  "unsloth/GLM-4-32B-0414-GGUF",
  "unsloth/QwQ-32B-GGUF",
  "unsloth/Mistral-Small-3.1-24B-Instruct-2503-GGUF",
  "unsloth/Llama-3.1-8B-Instruct-GGUF",
  "unsloth/gemma-3-27b-it-qat-GGUF",
  "unsloth/gemma-3-12b-it-qat-GGUF",
  "unsloth/gemma-3-4b-it-qat-GGUF",
  "unsloth/DeepSeek-R1-Distill-Llama-8B-GGUF",
  "unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF",
  "unsloth/gpt-oss-20b-GGUF",
  "unsloth/gpt-oss-120b-GGUF",
  "unsloth/granite-4.0-h-small-GGUF",
  "unsloth/Qwen3-VL-8B-Instruct-GGUF",
  "unsloth/Qwen3-VL-4B-Instruct-GGUF",
  "unsloth/Qwen3-Next-80B-A3B-Thinking-GGUF",
  "unsloth/MiniMax-M2-GGUF",
  "unsloth/DictaLM-3.0-24B-Thinking-GGUF",
  "unsloth/GLM-4.6V-GGUF",
];

const ARXELL_MODELS: Array<{ repoId: string; quantOptions: string[] }> = [
  { repoId: "Arxell/Qwen3.5-35B-A3B-MXFP4", quantOptions: ["MXFP4"] },
  { repoId: "Arxell/GLM-4.7-Flash-MXFP4", quantOptions: ["MXFP4"] },
  { repoId: "Arxell/gpt-oss-20b-MXFP4", quantOptions: ["MXFP4"] },
  { repoId: "Arxell/Qwen3.5-4B-Q4", quantOptions: ["Q4"] },
];

// Format bytes to human readable
function formatBytes(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${mb.toLocaleString()} MB`;
}

// Format parameter count
function formatParams(count: number | null): string {
  if (count === null) return "Unknown";
  if (count >= 1e12) return `${(count / 1e12).toFixed(1)}T`;
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)}B`;
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  return count.toLocaleString();
}

function extractParamsLabel(repoId: string): string | null {
  const base = repoId.split("/").pop() ?? repoId;
  const m = base.match(/(\d+(?:\.\d+)?)\s*B/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)} B`;
}

function formatQuantLabel(raw: string): string {
  const mxfp = raw.match(/mxfp\d+/i);
  if (mxfp) return mxfp[0].toUpperCase();
  return raw;
}

function getInitialContextOverride(): number {
  if (typeof window === "undefined") return DEFAULT_CONTEXT_OVERRIDE;
  const raw = window.localStorage?.getItem(CONTEXT_OVERRIDE_STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 512 ? parsed : DEFAULT_CONTEXT_OVERRIDE;
}

// Error banner component
function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-accent-red/10 border border-accent-red/20 text-accent-red text-xs">
      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
      <span className="flex-1">{message}</span>
      <button
        onClick={onDismiss}
        className="p-0.5 hover:bg-accent-red/20 rounded transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function SystemResourcesSection({
  resources,
  usage,
}: {
  resources: SystemResources | null;
  usage: SystemUsageSnapshot | null;
}) {
  if (!resources) return <div className="text-xs text-text-dark">Loading system info...</div>;

  const telemetryBacked = usage?.gpus?.filter(
    (g) => g.memoryTotalMb != null || g.memoryUsedMb != null || g.utilizationPercent != null
  ) ?? [];
  const primaryUsage = (telemetryBacked.length ? telemetryBacked : usage?.gpus ?? [])
    .slice()
    .sort((a, b) => {
      const aTotal = a.memoryTotalMb ?? -1;
      const bTotal = b.memoryTotalMb ?? -1;
      if (aTotal !== bTotal) return bTotal - aTotal;
      const aUsed = a.memoryUsedMb ?? -1;
      const bUsed = b.memoryUsedMb ?? -1;
      return bUsed - aUsed;
    })[0];
  const primaryGpu = resources.gpus[0];

  const cpuFreeGb = resources.memory.availableMb / 1024;
  const gpuTotalMb = primaryUsage?.memoryTotalMb ?? primaryGpu?.vramMb ?? null;
  const gpuUsedMb = primaryUsage?.memoryUsedMb ?? null;
  const gpuFreeMb =
    gpuTotalMb != null && gpuUsedMb != null ? Math.max(0, gpuTotalMb - gpuUsedMb) : null;

  const cpuFreePct =
    resources.memory.totalMb > 0
      ? Math.max(0, Math.min(100, (resources.memory.availableMb / resources.memory.totalMb) * 100))
      : 0;
  const gpuFreePct =
    gpuTotalMb != null && gpuTotalMb > 0 && gpuFreeMb != null
      ? Math.max(0, Math.min(100, (gpuFreeMb / gpuTotalMb) * 100))
      : null;
  const renderBar = (pct: number | null, fillClass: string) => (
    <div className="w-[90px] h-2 rounded-full bg-line-med/80 overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all", fillClass)}
        style={{ width: `${pct ?? 0}%` }}
      />
    </div>
  );

  return (
    <div className="flex items-center gap-4 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="text-text-norm">CPU ({cpuFreeGb.toFixed(1)}gb free)</span>
        {renderBar(cpuFreePct, "bg-accent-primary")}
      </div>
      <div className="h-3 border-l border-line-med/80" />
      <div className="flex items-center gap-2">
        <span className="text-text-norm">
          GPU ({gpuFreeMb != null ? `${(gpuFreeMb / 1024).toFixed(1)}gb free` : "N/A"})
        </span>
        {renderBar(gpuFreePct, gpuFreePct != null ? "bg-accent-green" : "bg-line-dark")}
      </div>
    </div>
  );
}

function RuntimeSection({
  runtimeStatus,
  systemResources,
  onInstall,
  installingEngineId,
  installProgress,
}: {
  runtimeStatus: RuntimeStatus | null;
  systemResources: SystemResources | null;
  onInstall: (engineId: string) => void;
  installingEngineId: string | null;
  installProgress: EngineInstallProgress | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAllRuntimes, setShowAllRuntimes] = useState(false);
  const [showNpuSetup, setShowNpuSetup] = useState(false);

  if (!runtimeStatus) {
    return (
      <div className="p-3 rounded-lg bg-line-light border border-line-light">
        <div className="flex items-center gap-2 text-xs text-text-dark">
          <Cog size={14} />
          <span>Loading runtime info...</span>
        </div>
      </div>
    );
  }

  const { engines, activeEngine, hasAvailableEngine, warning } = runtimeStatus;
  const gpuEngineUnavailable = engines.some(
    (e) => !e.isAvailable && e.backend !== "cpu" && e.isRecommended && (e.isApplicable ?? true)
  );
  const primaryNpu = systemResources?.npus?.[0] ?? null;

  const isApplicable = (engine: (typeof engines)[number]) => engine.isApplicable ?? true;
  const getStatus = (engine: (typeof engines)[number]) => {
    if (activeEngine === engine.id) return "Active";
    if (!isApplicable(engine)) return "Not Applicable";
    return engine.isAvailable ? "Available" : "Not Installed";
  };
  const statusClass = (status: string) => {
    if (status === "Active") return "bg-accent-green/20 text-accent-green";
    if (status === "Available") return "bg-line-med text-text-med";
    if (status === "Not Applicable") return "bg-line-light text-text-dark";
    return "bg-accent-red/20 text-accent-red";
  };
  const sorted = engines.slice().sort((a, b) => {
    const aApp = isApplicable(a) ? 0 : 1;
    const bApp = isApplicable(b) ? 0 : 1;
    if (aApp !== bApp) return aApp - bApp;
    return a.name.localeCompare(b.name);
  });
  const applicable = sorted.filter((e) => isApplicable(e));
  const nonApplicable = sorted.filter((e) => !isApplicable(e));
  const visibleEngines = showAllRuntimes ? [...applicable, ...nonApplicable] : applicable;

  return (
    <div className="rounded-lg bg-line-light border border-line-light p-3">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-purple-400" />
          <span className="text-xs font-medium text-text-norm">Runtime</span>
          {hasAvailableEngine &&
            engines.some((e) => e.isAvailable && e.backend !== "cpu" && (e.isApplicable ?? true)) && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent-green/20 text-accent-green">
              GPU Ready
            </span>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-text-med hover:text-text-norm inline-flex items-center gap-1"
        >
          <span>{expanded ? "Collapse" : "Expand"}</span>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>
      {!expanded && (
        <div className="mt-1 text-[10px] text-text-dark">Expand to view runtime options</div>
      )}
      {expanded && (
        <>

          {/* Warning Banner for unavailable recommended engine */}
          {(warning || gpuEngineUnavailable) && (
            <div className="flex items-start gap-2 p-2 rounded bg-accent-gold/10 border border-accent-gold/20 text-accent-gold text-[11px] mt-3 mb-3">
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              <span>
                {warning ?? "Recommended GPU engine not installed. Click Download to set it up."}
              </span>
            </div>
          )}

          {/* Install progress bar */}
          {installingEngineId && installProgress && (
            <div className="mb-3 p-2 rounded bg-accent-primary/10 border border-accent-primary/20">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-accent-primary font-medium">
                  {installProgress.stage === "done"
                    ? "Installation complete"
                    : installProgress.stage === "error"
                    ? "Installation failed"
                    : "Installing..."}
                </span>
                <span className="text-[10px] text-accent-primary font-mono">
                  {Math.round(installProgress.percentage)}%
                </span>
              </div>
              <div className="w-full h-1 bg-line-med rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    installProgress.stage === "done"
                      ? "bg-accent-green"
                      : installProgress.stage === "error"
                      ? "bg-accent-red"
                      : "bg-accent-primary"
                  )}
                  style={{ width: `${installProgress.percentage}%` }}
                />
              </div>
              <p className="text-[10px] text-text-med mt-1 truncate">{installProgress.message}</p>
            </div>
          )}

          {/* Engine List */}
          <div className="space-y-1.5">
            {visibleEngines.map((engine) => {
              const isInstalling = installingEngineId === engine.id;
              const status = getStatus(engine);
              const canInstall =
                status === "Not Installed" && engine.backend !== "cpu" && isApplicable(engine);

              const prefix =
                engine.backend === "cpu"
                  ? "CPU"
                  : engine.backend === "cuda" ||
                    engine.backend === "vulkan" ||
                    engine.backend === "rocm" ||
                    engine.backend === "metal"
                  ? "GPU"
                  : "NPU";

              return (
                <div key={engine.id} className={cn("flex items-center justify-between p-2 rounded bg-line-light")}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full flex-shrink-0",
                        status === "Active"
                          ? "bg-accent-green"
                          : status === "Available"
                          ? "bg-line-med"
                          : status === "Not Applicable"
                          ? "bg-line-med"
                          : "bg-accent-red/60"
                      )}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs truncate text-text-norm">
                          {prefix} — {engine.name}
                        </span>
                        <span className={cn("px-1.5 py-0.5 rounded text-[9px] flex-shrink-0", statusClass(status))}>
                          {status}
                        </span>
                        {engine.isRecommended && engine.backend === "vulkan" && (
                          <span className="px-1 py-0.5 rounded text-[9px] bg-purple-500/20 text-purple-300 flex-shrink-0">
                            Recommended
                          </span>
                        )}
                      </div>
                      {engine.error && status !== "Not Installed" && status !== "Not Applicable" && (
                        <span className="text-[10px] text-accent-red/80 truncate">{engine.error}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {canInstall && (
                      <button
                        onClick={() => onInstall(engine.id)}
                        disabled={!!installingEngineId}
                        title={`Download and install ${engine.name}`}
                        className={cn(
                          "flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors",
                          installingEngineId
                            ? "opacity-40 cursor-not-allowed bg-line-light text-text-dark"
                            : "bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
                        )}
                      >
                        {isInstalling ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <Download size={10} />
                        )}
                        <span>{isInstalling ? "Installing..." : "Download"}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-1.5">
            <div className="flex items-center justify-between p-2 rounded bg-line-light">
              <div className="flex items-center gap-2 min-w-0">
                <div className={cn("w-2 h-2 rounded-full", primaryNpu?.isAvailable ? "bg-accent-green" : "bg-line-med")} />
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs text-text-norm truncate">
                    NPU — {primaryNpu ? primaryNpu.name : "No NPU detected"}
                  </span>
                  <span className={cn("px-1.5 py-0.5 rounded text-[9px]", statusClass(primaryNpu?.isAvailable ? "Available" : "Not Installed"))}>
                    {primaryNpu?.isAvailable ? "Available" : "Not Installed"}
                  </span>
                </div>
              </div>
              {primaryNpu && !primaryNpu.isAvailable && primaryNpu.npuType === "amd_xdna" && (
                <button
                  onClick={() => setShowNpuSetup(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
                >
                  <Download size={10} />
                  Install Runtime
                </button>
              )}
            </div>
          </div>

          {nonApplicable.length > 0 && (
            <div className="mt-1.5 flex justify-center">
              <button
                onClick={() => setShowAllRuntimes((v) => !v)}
                className="text-[10px] text-text-dark hover:text-text-med"
              >
                {showAllRuntimes
                  ? "Hide non-applicable runtimes"
                  : `View all runtimes (${nonApplicable.length} hidden)`}
              </button>
            </div>
          )}
        </>
      )}
      <NpuSetupModal open={showNpuSetup} onClose={() => setShowNpuSetup(false)} />
    </div>
  );
}

// Available Models Table
function AvailableModelsTable({
  models,
  onSelectModel,
  onDeleteModel,
  isLoading,
  deletingPath,
  selectedPath,
}: {
  models: AvailableModel[];
  onSelectModel: (path: string) => void;
  onDeleteModel: (model: AvailableModel) => void;
  isLoading: boolean;
  deletingPath: string | null;
  selectedPath: string | null;
}) {
  if (models.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <Box size={24} className="text-text-dark mb-2" />
        <p className="text-xs text-text-dark">No models in models folder</p>
        <p className="text-[10px] text-text-dark mt-1">Place .gguf files in the models directory</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line-light">
            <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wide text-text-dark font-medium">Name</th>
            <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wide text-text-dark font-medium">Size</th>
            <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wide text-text-dark font-medium w-28">Actions</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => (
            <tr 
              key={model.path} 
              className={cn(
                "border-b border-line-light hover:bg-line-light",
                isLoading ? "cursor-not-allowed opacity-70" : "cursor-pointer",
                selectedPath === model.path && "bg-accent-primary/10"
              )}
              onClick={() => {
                if (isLoading) return;
                onSelectModel(model.path);
              }}
            >
              <td className="py-2 px-2">
                <span className="text-text-norm truncate block max-w-[220px]" title={model.name}>
                  {model.name}
                </span>
              </td>
              <td className="py-2 px-2 text-right text-text-med font-mono">
                {formatBytes(model.sizeMb)}
              </td>
              <td className="py-2 px-2 text-right">
                <div className="inline-flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isLoading) return;
                      onSelectModel(model.path);
                    }}
                    disabled={isLoading}
                    className={cn(
                      "px-2 py-1 rounded text-[10px] transition-colors disabled:opacity-50",
                      selectedPath === model.path
                        ? "bg-accent-primary text-text-norm"
                        : "bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
                    )}
                  >
                    {selectedPath === model.path ? "Selected" : "Select"}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isLoading || deletingPath) return;
                      onDeleteModel(model);
                    }}
                    disabled={isLoading || !!deletingPath}
                    className="px-2 py-1 rounded text-[10px] bg-accent-red/20 text-accent-red hover:bg-accent-red/30 disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {deletingPath === model.path ? (
                      <>
                        <Loader2 size={10} className="animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      "Delete"
                    )}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Loading indicator for vRAM allocation
function VramLoadingIndicator({ progress }: { progress: { stage: string; percentage: number; message: string } | null }) {
  if (!progress) return null;
  
  return (
    <div className="rounded-lg bg-accent-primary/10 border border-accent-primary/20 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Loader2 size={14} className="animate-spin text-accent-primary" />
        <span className="text-xs text-text-norm">Loading into VRAM</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between text-[10px]">
          <span className="text-text-med">{progress.message}</span>
          <span className="text-text-dark font-mono">{progress.percentage.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 bg-line-light rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-accent-primary to-purple-500 rounded-full transition-all duration-300"
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// Model Configuration Panel - shown before loading
function ModelConfigPanel({
  modelInfo,
  config,
  devices,
  systemResources,
  onConfigChange,
  onLoad,
  onCancel,
  isLoading,
  loadProgress,
}: {
  modelInfo: ModelInfo | null;
  config: ModelLoadConfig;
  devices: DeviceInfo[];
  systemResources: SystemResources | null;
  onConfigChange: (config: ModelLoadConfig) => void;
  onLoad: () => void;
  onCancel: () => void;
  isLoading: boolean;
  loadProgress: { stage: string; percentage: number; message: string } | null;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const orderedDevices = [...devices].sort((a, b) => {
    const rank = (d: DeviceInfo) => {
      if (!d.is_available) return 99;
      if (d.device_type === "cpu") return 10;
      return 0;
    };
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return a.name.localeCompare(b.name);
  });

  // Get CPU thread count from system resources
  const cpuThreads = systemResources?.cpu?.physicalCores ?? 4;
  const logicalThreads = systemResources?.cpu?.logicalCores ?? 64;
  const contextMin = 512;
  const contextMax = modelInfo?.contextLength ?? 131072;
  const contextValue = Math.max(
    contextMin,
    Math.min(config.context_override ?? Math.min(contextMax, DEFAULT_CONTEXT_OVERRIDE), contextMax)
  );
  const cacheTypeOptions = ["f16", "f32", "bf16", "q8_0", "q6_K", "q5_0", "q4_0"];

  return (
    <div className="rounded-lg bg-line-light border border-line-light overflow-hidden">
      {/* Model Preview Header */}
      <div className="p-3 border-b border-line-light bg-line-light">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-primary/20 flex items-center justify-center">
              <Settings size={18} className="text-accent-primary" />
            </div>
            <div>
              {modelInfo ? (
                <>
                  <div className="text-sm font-medium text-text-norm">{modelInfo.name}</div>
                  <div className="flex items-center gap-2 text-[10px] text-text-dark">
                    <span>{modelInfo.architecture}</span>
                    {modelInfo.quantization && (
                      <>
                        <span>•</span>
                        <span>{modelInfo.quantization}</span>
                      </>
                    )}
                    <span>•</span>
                    <span>{formatParams(modelInfo.parameterCount)}</span>
                    <span>•</span>
                    <span>{modelInfo.contextLength.toLocaleString()} ctx</span>
                  </div>
                </>
              ) : (
                <div className="text-sm text-text-med">No model selected</div>
              )}
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded hover:bg-line-med text-text-dark hover:text-text-med transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Loading Progress */}
      {isLoading && loadProgress && (
        <div className="p-3 border-b border-line-light">
          <VramLoadingIndicator progress={loadProgress} />
        </div>
      )}

      {/* Configuration Options */}
      <div className="p-3 space-y-4">
        {/* Device Selection */}
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-text-med">Compute Device</label>
          <select
            value={config.device_override ?? ""}
            onChange={(e) => onConfigChange({ ...config, device_override: e.target.value || undefined })}
            disabled={isLoading}
            className="w-full bg-line-light border border-line-med rounded-lg px-3 py-2 text-sm text-text-norm outline-none transition-colors font-mono appearance-none cursor-pointer focus:border-accent-primary/50 disabled:opacity-50"
          >
            {orderedDevices.map((device) => (
              <option key={device.id} value={device.id} className="bg-bg-light">
                {device.name} {device.vram_mb ? `(${formatBytes(device.vram_mb)})` : ''}
              </option>
            ))}
            <option value="" className="bg-bg-light">Auto-select (recommended)</option>
          </select>
        </div>

        {/* Context Length */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-text-med">Context Length</label>
            <span className="text-[10px] text-text-dark">
              Model max: {modelInfo?.contextLength.toLocaleString() ?? 'Unknown'} — higher = more VRAM
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={contextMin}
              max={contextMax}
              step="1"
              value={contextValue}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                onConfigChange({
                  ...config,
                  context_override: Math.max(contextMin, Math.min(val, contextMax)),
                });
              }}
              disabled={isLoading}
              className="flex-1 h-1 bg-line-med rounded-full appearance-none cursor-pointer slider-thumb disabled:opacity-50"
            />
            <input
              type="number"
              min={contextMin}
              max={contextMax}
              value={contextValue}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) {
                  onConfigChange({
                    ...config,
                    context_override: Math.max(contextMin, Math.min(val, contextMax)),
                  });
                }
              }}
              disabled={isLoading}
              className="w-24 bg-line-light border border-line-med rounded-lg px-2 py-1.5 text-xs text-text-norm outline-none focus:border-accent-primary/50 transition-colors font-mono disabled:opacity-50"
            />
          </div>
        </div>

        {/* GPU Offload Layers */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-text-med">GPU Layers</label>
            <div className="flex items-center gap-1.5">
              {(config.n_gpu_layers == null || config.n_gpu_layers < 0 || config.n_gpu_layers >= 999) && (
                <span className="px-1 py-0.5 rounded text-[9px] bg-accent-primary/20 text-accent-primary">
                  Recommended
                </span>
              )}
              {config.n_gpu_layers === 0 && (
                <span className="px-1 py-0.5 rounded text-[9px] bg-accent-gold/20 text-accent-gold">
                  CPU only
                </span>
              )}
              <span className="text-[10px] text-text-dark">
                {config.n_gpu_layers == null || config.n_gpu_layers < 0 || config.n_gpu_layers >= 999
                  ? "All layers to GPU"
                  : config.n_gpu_layers === 0
                  ? "No GPU offload"
                  : `${config.n_gpu_layers} layers`}
              </span>
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="999"
            value={
              config.n_gpu_layers == null || config.n_gpu_layers < 0
                ? 999
                : config.n_gpu_layers
            }
            onChange={(e) => {
              const val = parseInt(e.target.value);
              onConfigChange({
                ...config,
                // Store -1 ("all layers") when slider is at maximum
                n_gpu_layers: val >= 999 ? -1 : val,
              });
            }}
            disabled={isLoading}
            className="w-full h-1 bg-line-med rounded-full appearance-none cursor-pointer slider-thumb disabled:opacity-50"
          />
          <div className="flex justify-between text-[10px] text-text-dark">
            <span>CPU only (0)</span>
            <span>Partial offload</span>
            <span>All to GPU (max)</span>
          </div>
        </div>

        {/* VRAM Estimation */}
        {(() => {
          const gpuVramMb = systemResources?.gpus?.[0]?.vramMb;
          const modelSizeMb = modelInfo?.fileSizeMb;
          if (!modelSizeMb) return null;

          const isNoneGpu = config.n_gpu_layers === 0;
          // Estimate: weights occupy ~105% of file size (quantized weights + small overhead).
          // KV-cache is allocated per-inference, not counted here.
          const estimatedVramMb = Math.ceil(modelSizeMb * 1.05);

          if (isNoneGpu) {
            return (
              <div className="flex items-start gap-1.5 p-2 rounded bg-accent-gold/10 border border-accent-gold/20 text-[11px] text-accent-gold">
                <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
                <span>
                  <strong>CPU-only mode:</strong> ~{formatBytes(modelSizeMb)} will load into system RAM. Inference will be very slow and may cause memory pressure.
                </span>
              </div>
            );
          }

          if (!gpuVramMb) {
            return (
              <div className="flex items-center gap-1.5 text-[10px] text-text-dark">
                <Cpu size={11} className="flex-shrink-0" />
                <span>Full GPU load requires ~{formatBytes(estimatedVramMb)} VRAM (GPU VRAM size unknown)</span>
              </div>
            );
          }

          const doesntFit = gpuVramMb < estimatedVramMb;
          const tightFit = !doesntFit && gpuVramMb < Math.ceil(estimatedVramMb * 1.15);

          if (!doesntFit && !tightFit) {
            return (
              <div className="flex items-center gap-1.5 p-2 rounded bg-accent-green/10 border border-accent-green/20 text-[10px] text-accent-green">
                <Check size={11} className="flex-shrink-0" />
                <span>Fits in VRAM — ~{formatBytes(estimatedVramMb)} needed, {formatBytes(gpuVramMb)} available</span>
              </div>
            );
          }

          if (tightFit) {
            return (
              <div className="flex items-center gap-1.5 p-2 rounded bg-accent-gold/10 border border-accent-gold/20 text-[10px] text-accent-gold">
                <AlertCircle size={11} className="flex-shrink-0" />
                <span>Tight VRAM fit — ~{formatBytes(estimatedVramMb)} needed, {formatBytes(gpuVramMb)} available. Reduce GPU layers if loading fails.</span>
              </div>
            );
          }

          // Doesn't fit — suggest a partial-offload layer percentage
          const gpuFraction = gpuVramMb / estimatedVramMb;
          const suggestedPct = Math.max(5, Math.floor(gpuFraction * 100));

          return (
            <div className="p-2 rounded bg-accent-red/10 border border-accent-red/20 text-[10px] text-accent-red">
              <div className="flex items-start gap-1.5">
                <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
                <span>
                  <strong>VRAM insufficient</strong> — model needs ~{formatBytes(estimatedVramMb)} but only {formatBytes(gpuVramMb)} available.
                  {" "}Reduce GPU layers to ~{suggestedPct}% of max for partial offload, or the system will crash or be very slow.
                </span>
              </div>
            </div>
          );
        })()}

        {/* CPU Threads */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-med">CPU Threads</label>
              <span className="text-[10px] text-text-dark">
                {config.n_threads ?? `Auto (${cpuThreads})`}
              </span>
            </div>
            <input
              type="number"
              min="1"
              max={logicalThreads}
              placeholder={`Auto (${cpuThreads} cores)`}
              value={config.n_threads ?? ""}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  n_threads: e.target.value ? parseInt(e.target.value) : undefined,
                })
              }
              disabled={isLoading}
              className="w-full bg-line-light border border-line-med rounded-lg px-3 py-2 text-sm text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 transition-colors font-mono disabled:opacity-50"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-med">Batch Threads</label>
              <span className="text-[10px] text-text-dark">
                {config.n_threads_batch ?? "Auto"}
              </span>
            </div>
            <input
              type="number"
              min="1"
              max={logicalThreads}
              placeholder="Auto"
              value={config.n_threads_batch ?? ""}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  n_threads_batch: e.target.value ? parseInt(e.target.value) : undefined,
                })
              }
              disabled={isLoading}
              className="w-full bg-line-light border border-line-med rounded-lg px-3 py-2 text-sm text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 transition-colors font-mono disabled:opacity-50"
            />
          </div>
        </div>

        {/* Batch Size */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-med">Batch Size</label>
            <input
              type="number"
              min="1"
              max="8192"
              placeholder="512"
              value={config.batch_size ?? ""}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  batch_size: e.target.value ? parseInt(e.target.value) : undefined,
                })
              }
              disabled={isLoading}
              className="w-full bg-line-light border border-line-med rounded-lg px-3 py-2 text-sm text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 transition-colors font-mono disabled:opacity-50"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-med">Micro Batch</label>
            <input
              type="number"
              min="1"
              max="2048"
              placeholder="128"
              value={config.ubatch_size ?? ""}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  ubatch_size: e.target.value ? parseInt(e.target.value) : undefined,
                })
              }
              disabled={isLoading}
              className="w-full bg-line-light border border-line-med rounded-lg px-3 py-2 text-sm text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 transition-colors font-mono disabled:opacity-50"
            />
          </div>
        </div>

        {/* Advanced Settings Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-xs text-text-med hover:text-text-norm transition-colors"
        >
          <ChevronDown size={12} className={cn("transition-transform", showAdvanced && "rotate-180")} />
          Advanced Settings
        </button>

        {/* Advanced Settings */}
        {showAdvanced && (
          <div className="space-y-4 p-3 rounded-lg bg-line-light border border-line-light">
            {/* Memory Options */}
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-text-dark">Memory Options</div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-text-med cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.use_mmap ?? true}
                    onChange={(e) => onConfigChange({ ...config, use_mmap: e.target.checked })}
                    disabled={isLoading}
                    className="rounded border-line-dark bg-line-light"
                  />
                  Memory Map (faster load)
                </label>
                <label className="flex items-center gap-2 text-xs text-text-med cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.use_mlock ?? false}
                    onChange={(e) => onConfigChange({ ...config, use_mlock: e.target.checked })}
                    disabled={isLoading}
                    className="rounded border-line-dark bg-line-light"
                  />
                  Lock Memory (prevent swap)
                </label>
                <label className="flex items-center gap-2 text-xs text-text-med cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.flash_attn ?? false}
                    onChange={(e) => onConfigChange({ ...config, flash_attn: e.target.checked })}
                    disabled={isLoading}
                    className="rounded border-line-dark bg-line-light"
                  />
                  Flash Attention
                </label>
              </div>
            </div>

            {/* KV Cache Types */}
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-text-dark">KV Cache Types</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-text-dark">K Cache Type</label>
                  <select
                    value={config.cache_type_k ?? ""}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        cache_type_k: e.target.value || undefined,
                      })
                    }
                    disabled={isLoading}
                    className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-xs text-text-norm outline-none focus:border-accent-primary/50 font-mono disabled:opacity-50"
                  >
                    <option value="">Default</option>
                    {cacheTypeOptions.map((opt) => (
                      <option key={`k-${opt}`} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-text-dark">V Cache Type</label>
                  <select
                    value={config.cache_type_v ?? ""}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        cache_type_v: e.target.value || undefined,
                      })
                    }
                    disabled={isLoading}
                    className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-xs text-text-norm outline-none focus:border-accent-primary/50 font-mono disabled:opacity-50"
                  >
                    <option value="">Default</option>
                    {cacheTypeOptions.map((opt) => (
                      <option key={`v-${opt}`} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* RoPE Settings */}
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-text-dark">RoPE Scaling (Extended Context)</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-text-dark">RoPE Scale</label>
                  <input
                    type="number"
                    min="0.1"
                    max="10"
                    step="0.1"
                    placeholder="1.0"
                    value={config.rope_freq_scale ?? ""}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        rope_freq_scale: e.target.value ? parseFloat(e.target.value) : undefined,
                      })
                    }
                    disabled={isLoading}
                    className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-xs text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 font-mono disabled:opacity-50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-text-dark">RoPE Base</label>
                  <input
                    type="number"
                    min="1000"
                    max="1000000"
                    placeholder="10000"
                    value={config.rope_freq_base ?? ""}
                    onChange={(e) =>
                      onConfigChange({
                        ...config,
                        rope_freq_base: e.target.value ? parseFloat(e.target.value) : undefined,
                      })
                    }
                    disabled={isLoading}
                    className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-xs text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 font-mono disabled:opacity-50"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Load Button */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-line-light text-text-med hover:bg-line-med hover:text-text-norm transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onLoad}
            disabled={isLoading || !modelInfo}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all",
              isLoading || !modelInfo
                ? "bg-line-light text-text-dark cursor-not-allowed"
                : "bg-accent-primary hover:bg-accent-primary text-text-norm"
            )}
          >
            {isLoading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <Zap size={14} />
                Load Model
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Loaded Model Card with server info
function LoadedModelCard({
  modelInfo,
  generationConfig,
  activeDevice,
  inferenceEndpoint,
  loadProgress,
  isLoading,
  onUnload,
  onUpdateConfig,
  isUpdating,
}: {
  modelInfo: ModelInfo;
  generationConfig: GenerationConfig;
  activeDevice: DeviceInfo | null;
  inferenceEndpoint: string | null;
  loadProgress: { stage: string; percentage: number; message: string } | null;
  isLoading: boolean;
  onUnload: () => void;
  onUpdateConfig: (config: GenerationConfig) => void;
  isUpdating: boolean;
}) {
  const [localConfig, setLocalConfig] = useState<GenerationConfig>(generationConfig);
  const [showSettings, setShowSettings] = useState(false);

  // Sync local config with prop changes, with defensive check
  useEffect(() => {
    if (generationConfig && typeof generationConfig.temperature === 'number') {
      setLocalConfig(generationConfig);
    }
  }, [generationConfig]);

  // Defensive check - ensure localConfig is valid before rendering sliders
  if (!localConfig || typeof localConfig.temperature !== 'number') {
    return (
      <div className="rounded-lg bg-accent-primary/10 border border-accent-primary/20 p-3">
        <div className="flex items-center gap-2 text-text-med">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-xs">Initializing model configuration...</span>
        </div>
      </div>
    );
  }

  const shortModelName =
    modelInfo.name.length > 42 ? `${modelInfo.name.slice(0, 39)}...` : modelInfo.name;
  const endpointText = inferenceEndpoint ?? "Endpoint unavailable";
  const modelDetailItems = [
    endpointText,
    modelInfo.architecture,
    modelInfo.quantization,
    formatParams(modelInfo.parameterCount),
    `${modelInfo.contextLength.toLocaleString()} ctx`,
    activeDevice?.name,
  ].filter(Boolean) as string[];
  const modelDetailLine = modelDetailItems.join(" • ");

  return (
    <div className="rounded-lg bg-line-light border border-line-light overflow-hidden">
      {/* Model header */}
      <div className="p-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="w-2 h-2 rounded-full bg-accent-green flex-shrink-0" title="Active" />
              <div className="text-xs text-text-norm truncate" title={modelInfo.name}>
                {shortModelName}
              </div>
            </div>
            <div className="pl-3.5 mt-1 text-[10px] text-text-med truncate" title={modelDetailLine}>
              {modelDetailLine}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onUnload}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-accent-red/20 text-accent-red hover:bg-accent-red/30 transition-colors"
          >
            <Trash2 size={10} />
            Unload
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-line-med text-[10px] text-text-med hover:text-text-norm hover:border-line-light transition-colors"
            title="Show model details and settings"
          >
            <span>Details</span>
            <ChevronDown
              size={12}
              className={cn("transition-transform", showSettings && "rotate-180")}
            />
          </button>
        </div>
      </div>

      {/* VRAM loading indicator when loading but model info is available */}
      {isLoading && loadProgress && (
        <div className="border-t border-line-med p-3">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 size={12} className="animate-spin text-accent-primary" />
            <span className="text-[10px] text-text-med">{loadProgress.message}</span>
            <span className="text-[10px] text-text-dark font-mono ml-auto">{loadProgress.percentage.toFixed(0)}%</span>
          </div>
          <div className="h-1 bg-line-light rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-accent-primary to-purple-500 rounded-full transition-all duration-300"
              style={{ width: `${loadProgress.percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Compact generation settings */}
      {showSettings && (
        <div className="border-t border-line-med p-3 space-y-3">
          <div className="space-y-1.5 text-[10px]">
            <div className="flex items-center gap-1.5 text-accent-green">
              <Globe size={10} />
              <span>Local Inference Active</span>
            </div>
            <div className="flex items-center gap-1.5 text-text-dark">
              <Server size={10} />
              <span>Ready for generation</span>
            </div>
            {activeDevice && (
              <div className="flex items-center gap-1.5 text-text-med">
                <MemoryStick size={10} className="text-purple-400" />
                <span>{activeDevice.name}</span>
                {activeDevice.vram_mb && (
                  <span className="text-text-dark">({formatBytes(activeDevice.vram_mb)})</span>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-text-med">
              <Server size={10} />
              <span className="font-mono text-text-norm break-all">{endpointText}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {/* Temperature */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-[10px] text-text-dark">Temp</label>
                <span className="text-[10px] font-mono text-text-med">
                  {typeof localConfig.temperature === 'number' && !isNaN(localConfig.temperature)
                    ? localConfig.temperature.toFixed(2)
                    : '0.70'}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.01"
                value={typeof localConfig.temperature === 'number' && !isNaN(localConfig.temperature)
                  ? localConfig.temperature
                  : 0.7}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    setLocalConfig({ ...localConfig, temperature: val });
                  }
                }}
                className="w-full h-1 bg-line-med rounded-full appearance-none cursor-pointer slider-thumb"
              />
            </div>

            {/* Top-p */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-[10px] text-text-dark">Top-p</label>
                <span className="text-[10px] font-mono text-text-med">
                  {typeof localConfig.top_p === 'number' && !isNaN(localConfig.top_p)
                    ? localConfig.top_p.toFixed(2)
                    : '0.90'}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={typeof localConfig.top_p === 'number' && !isNaN(localConfig.top_p)
                  ? localConfig.top_p
                  : 0.9}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    setLocalConfig({ ...localConfig, top_p: val });
                  }
                }}
                className="w-full h-1 bg-line-med rounded-full appearance-none cursor-pointer slider-thumb"
              />
            </div>

            {/* Max tokens */}
            <div className="space-y-1">
              <label className="text-[10px] text-text-dark">Max tokens</label>
              <input
                type="number"
                min="1"
                max="32768"
                value={typeof localConfig.max_new_tokens === 'number' && !isNaN(localConfig.max_new_tokens)
                  ? localConfig.max_new_tokens
                  : 512}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 1) {
                    setLocalConfig({ ...localConfig, max_new_tokens: val });
                  }
                }}
                className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-[10px] text-text-norm outline-none focus:border-accent-primary/50 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {/* Top-k */}
            <div className="space-y-1">
              <label className="text-[10px] text-text-dark">Top-k</label>
              <input
                type="number"
                min="1"
                max="500"
                value={typeof localConfig.top_k === 'number' && !isNaN(localConfig.top_k)
                  ? localConfig.top_k
                  : 40}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 1) {
                    setLocalConfig({ ...localConfig, top_k: val });
                  }
                }}
                className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-[10px] text-text-norm outline-none focus:border-accent-primary/50 font-mono"
              />
            </div>

            {/* Repeat penalty */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-[10px] text-text-dark">Repeat</label>
                <span className="text-[10px] font-mono text-text-med">
                  {typeof localConfig.repeat_penalty === 'number' && !isNaN(localConfig.repeat_penalty)
                    ? localConfig.repeat_penalty.toFixed(2)
                    : '1.10'}
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.01"
                value={typeof localConfig.repeat_penalty === 'number' && !isNaN(localConfig.repeat_penalty)
                  ? localConfig.repeat_penalty
                  : 1.1}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val)) {
                    setLocalConfig({ ...localConfig, repeat_penalty: val });
                  }
                }}
                className="w-full h-1 bg-line-med rounded-full appearance-none cursor-pointer slider-thumb"
              />
            </div>

            {/* Seed */}
            <div className="space-y-1">
              <label className="text-[10px] text-text-dark">Seed</label>
              <input
                type="number"
                placeholder="Random"
                value={localConfig.seed ?? ""}
                onChange={(e) => {
                  const val = e.target.value ? parseInt(e.target.value) : null;
                  if (e.target.value === "" || (val !== null && !isNaN(val))) {
                    setLocalConfig({ ...localConfig, seed: val });
                  }
                }}
                className="w-full bg-line-light border border-line-med rounded px-2 py-1 text-[10px] text-text-norm placeholder-text-dark outline-none focus:border-accent-primary/50 font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => {
                if (generationConfig && typeof generationConfig.temperature === 'number') {
                  setLocalConfig(generationConfig);
                }
              }}
              className="px-2 py-1 rounded text-[10px] text-text-med hover:text-text-norm hover:bg-line-light transition-colors"
            >
              Reset
            </button>
            <button
              onClick={() => onUpdateConfig(localConfig)}
              disabled={isUpdating}
              className="px-2 py-1 rounded text-[10px] bg-accent-primary text-text-norm hover:bg-accent-primary transition-colors disabled:opacity-50"
            >
              {isUpdating ? "Applying..." : "Apply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Content component for use in workspace panel (no modal wrapper)
export function ServePanelContent({ showCloseButton = false, onClose }: ServePanelContentProps) {
  const {
    isLoaded,
    isLoading,
    loadProgress,
    modelInfo,
    activeDevice,
    availableDevices,
    generationConfig,
    error,
    systemResources,
    availableModels,
    runtimeStatus,
    inferenceEndpoint,
    installingEngineId,
    installProgress,
    initialize,
    previewModel,
    loadModel,
    unloadModel,
    setGenerationConfig,
    setError,
    fetchSystemResources,
    fetchAvailableModels,
    fetchRuntimeStatus,
    openModelsFolder,
    installEngine,
  } = useServeStore();

  // Local state
  const [selectedModelPath, setSelectedModelPath] = useState<string | null>(null);
  const [previewModelInfo, setPreviewModelInfo] = useState<ModelInfo | null>(null);
  const [loadConfig, setLoadConfig] = useState<ModelLoadConfig>({ ...DEFAULT_MODEL_LOAD_CONFIG });
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [configUpdating, setConfigUpdating] = useState(false);
  const [showUnloadConfirm, setShowUnloadConfirm] = useState(false);
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [catalogDownloadingId, setCatalogDownloadingId] = useState<string | null>(null);
  const [selectedQuantByModelId, setSelectedQuantByModelId] = useState<Record<string, string>>({});
  const [lastLoadedContextOverride, setLastLoadedContextOverride] = useState<number>(getInitialContextOverride);
  const [systemUsage, setSystemUsage] = useState<SystemUsageSnapshot | null>(null);
  const [showAllAvailableModels, setShowAllAvailableModels] = useState(false);
  const [deletingModelPath, setDeletingModelPath] = useState<string | null>(null);
  const [provider, setProvider] = useState("unsloth_dynamic");
  const [providerQuery, setProviderQuery] = useState("");
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [providerSelectedRepoId, setProviderSelectedRepoId] = useState<string | null>(null);
  const [providerSelectedQuant, setProviderSelectedQuant] = useState<string>("Q4_K_M");
  const [showApiSelector, setShowApiSelector] = useState(false);
  const [apiConfigs, setApiConfigs] = useState<LlmModelConfig[]>([]);
  const [primaryApiConfig, setPrimaryApiConfig] = useState<LlmModelConfig | null>(null);
  const [primaryLlmSource, setPrimaryLlmSource] = useState<"local" | "api">("local");
  const [apiConfigsLoading, setApiConfigsLoading] = useState(false);
  const [switchingApiId, setSwitchingApiId] = useState<string | null>(null);

  // Initialize on mount
  useEffect(() => {
    initialize();
    fetchSystemResources();
    fetchAvailableModels();
    fetchRuntimeStatus();
  }, []);

  // Refresh system resources periodically
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSystemResources();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<SystemUsageSnapshot>("system:usage", (ev) => {
      const snap = ev.payload;
      setSystemUsage(snap);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  // Handle model selection - preview and show config
  const handleSelectModel = async (path: string) => {
    if (isLoading) return;
    setSelectedModelPath(path);
    setPreviewError(null);
    setLoadError(null);

    try {
      const info = await previewModel(path);
      const preferredDevice = availableDevices.find(
        (d) => d.is_available && d.device_type !== "cpu"
      ) ?? availableDevices.find((d) => d.is_available);
      setPreviewModelInfo(info);
      setLoadConfig({
        ...DEFAULT_MODEL_LOAD_CONFIG,
        path: path,
        // Prefer explicit GPU selection in the config UI so users can see and
        // control the target device before loading.
        device_override: preferredDevice?.id,
        // Default to 12k on first app start, then remember the most recent
        // user-loaded value across model selections/sessions.
        context_override: Math.max(
          512,
          Math.min(lastLoadedContextOverride, info.contextLength ?? 131072)
        ),
      });
      setShowConfigPanel(true);
    } catch (e) {
      setPreviewError(`Failed to read model metadata: ${e}`);
      setPreviewModelInfo(null);
    }
  };

  // Browse for model file
  const handleBrowse = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          { name: "GGUF Models", extensions: ["gguf"] },
        ],
      });

      if (selected && typeof selected === "string") {
        await handleSelectModel(selected);
      }
    } catch (e) {
      setPreviewError(`Failed to open file dialog: ${e}`);
    }
  };

  // Load model with current config
  const handleLoad = async () => {
    if (!selectedModelPath) return;

    setLoadError(null);
    try {
      const config: ModelLoadConfig = {
        ...loadConfig,
        path: selectedModelPath,
        source: "LocalGguf",
      };
      await loadModel(config);
      await settingsSet("primary_llm_source", "local");
      const loadedContext = config.context_override;
      if (typeof loadedContext === "number" && Number.isFinite(loadedContext) && loadedContext >= 512) {
        setLastLoadedContextOverride(loadedContext);
        if (typeof window !== "undefined") {
          window.localStorage?.setItem(CONTEXT_OVERRIDE_STORAGE_KEY, String(loadedContext));
        }
      }
      setShowConfigPanel(false);
      setSelectedModelPath(null);
      setPreviewModelInfo(null);
    } catch (e) {
      setLoadError(`Failed to load model: ${e}`);
    }
  };

  // Cancel model selection
  const handleCancelSelection = () => {
    setShowConfigPanel(false);
    setSelectedModelPath(null);
    setPreviewModelInfo(null);
    setPreviewError(null);
    setLoadConfig({ ...DEFAULT_MODEL_LOAD_CONFIG });
  };

  // Unload model
  const handleUnload = async () => {
    setShowUnloadConfirm(false);
    try {
      await unloadModel();
      setShowConfigPanel(false);
      setSelectedModelPath(null);
      setPreviewModelInfo(null);
      setPreviewError(null);
      setLoadConfig({ ...DEFAULT_MODEL_LOAD_CONFIG });
      setLoadError(null);
    } catch (e) {
      setLoadError(`Failed to unload model: ${e}`);
    }
  };

  // Update generation config
  const handleUpdateConfig = async (config: GenerationConfig) => {
    setConfigUpdating(true);
    try {
      await setGenerationConfig(config);
    } catch (e) {
      console.error("Failed to update config:", e);
    } finally {
      setConfigUpdating(false);
    }
  };

  // Check if we can load another model (sufficient resources)
  const canLoadAnother = useCallback(() => {
    if (!systemResources) return false;
    // Simple heuristic: at least 4GB available RAM
    return systemResources.memory.availableMb > 4096;
  }, [systemResources]);

  const openExternal = async (url: string) => {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  const loadApiConfigs = useCallback(async () => {
    setApiConfigsLoading(true);
    try {
      const models = await llmModelListAll();
      const chatModels = models.filter((cfg) => (cfg.api_type || "chat") === "chat");
      setApiConfigs(chatModels);
      setPrimaryApiConfig(chatModels.find((cfg) => cfg.is_primary) ?? null);
    } catch (e) {
      setLoadError(`Failed to load API endpoints: ${e}`);
    } finally {
      setApiConfigsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadApiConfigs();
  }, [loadApiConfigs]);

  useEffect(() => {
    let active = true;
    const refreshSource = async () => {
      const sourceRaw = ((await settingsGet("primary_llm_source")) ?? "local")
        .trim()
        .toLowerCase();
      const source = sourceRaw === "api" ? "api" : "local";
      if (active) {
        setPrimaryLlmSource(source);
      }
    };
    void refreshSource();
    const timer = window.setInterval(() => {
      void refreshSource();
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const handleUseApiEndpoint = useCallback(async (cfg: LlmModelConfig) => {
    setSwitchingApiId(cfg.id);
    setLoadError(null);
    try {
      if (isLoaded) {
        await unloadModel();
      }
      await llmModelSetPrimary(cfg.id);
      await Promise.all([
        settingsSet("base_url", cfg.base_url),
        settingsSet("api_key", cfg.api_key ?? ""),
        settingsSet("model", cfg.model_id),
        settingsSet("primary_llm_source", "api"),
      ]);
      setPrimaryLlmSource("api");
      setShowApiSelector(false);
      await loadApiConfigs();
    } catch (e) {
      setLoadError(`Failed to switch to API endpoint: ${e}`);
    } finally {
      setSwitchingApiId(null);
    }
  }, [isLoaded, loadApiConfigs, unloadModel]);

  const handleClearApiPrimary = useCallback(async () => {
    setLoadError(null);
    try {
      await settingsSet("primary_llm_source", "local");
      setPrimaryLlmSource("local");
      setShowApiSelector(false);
    } catch (e) {
      setLoadError(`Failed to clear API primary selection: ${e}`);
    }
  }, []);

  const handleDownloadSupportedModel = async (preset: SupportedModelPreset) => {
    setLoadError(null);
    setPreviewError(null);
    setCatalogDownloadingId(preset.id);
    const selectedQuant = selectedQuantByModelId[preset.id] || preset.pinnedFile;
    try {
      const downloadedPinned = await invoke<AvailableModel>("cmd_download_model_from_hf_asset", {
        repoId: preset.repoId,
        fileName: selectedQuant,
      }).catch(async () => {
        return invoke<AvailableModel>("cmd_download_model_from_hf_query", {
          query: `${preset.query} ${selectedQuant}`,
        });
      });

      await fetchAvailableModels();
      // Download-only action: no automatic loading or model switching.
      setSelectedModelPath(downloadedPinned.path);
    } catch (e) {
      setLoadError(`Failed to download model: ${e}`);
    } finally {
      setCatalogDownloadingId(null);
    }
  };

  const handleDeleteAvailableModel = async (model: AvailableModel) => {
    const ok = window.confirm(`Delete model file "${model.name}"?\nThis action cannot be undone.`);
    if (!ok) return;
    setDeletingModelPath(model.path);
    try {
      await invoke<void>("cmd_delete_available_model", { path: model.path });
      await fetchAvailableModels();
      if (selectedModelPath === model.path) {
        setSelectedModelPath(null);
      }
    } catch (e) {
      setLoadError(`Failed to delete model: ${e}`);
    } finally {
      setDeletingModelPath(null);
    }
  };

  const providerModels =
    provider === "unsloth_dynamic"
      ? UNSLOTH_DYNAMIC_MODEL_REPOS.map((repoId) => ({
          repoId,
          label: repoId.replace(/^unsloth\//i, ""),
          params: extractParamsLabel(repoId),
          quantOptions: DEFAULT_UNSLOTH_QUANTS,
        }))
      : provider === "arxell"
      ? ARXELL_MODELS.map((m) => ({
          repoId: m.repoId,
          label: m.repoId.replace(/^Arxell\//i, ""),
          params: extractParamsLabel(m.repoId),
          quantOptions: m.quantOptions,
        }))
      : [];

  const providerFilteredModels = providerModels.filter((m) =>
    providerQuery.trim()
      ? m.label.toLowerCase().includes(providerQuery.trim().toLowerCase())
      : true
  );

  const selectedProviderModel = providerModels.find((m) => m.repoId === providerSelectedRepoId) ?? null;
  const selectedProviderParams = selectedProviderModel?.params
    ? Number.parseFloat(selectedProviderModel.params.replace(" B", ""))
    : NaN;
  const totalGpuGb = (systemResources?.gpus?.[0]?.vramMb ?? 0) / 1024;
  const likelyTooLarge =
    Number.isFinite(selectedProviderParams) && totalGpuGb > 0
      ? selectedProviderParams * 0.6 > totalGpuGb
      : false;

  const handleProviderDownload = async () => {
    if (!selectedProviderModel) return;
    setCatalogDownloadingId(selectedProviderModel.repoId);
    setLoadError(null);
    try {
      const downloaded = await invoke<AvailableModel>("cmd_download_model_from_hf_asset", {
        repoId: selectedProviderModel.repoId,
        fileName: providerSelectedQuant,
      }).catch(async () => {
        return invoke<AvailableModel>("cmd_download_model_from_hf_query", {
          query: `${selectedProviderModel.repoId} ${providerSelectedQuant} GGUF`,
        });
      });
      await fetchAvailableModels();
      setSelectedModelPath(downloaded.path);
    } catch (e) {
      setLoadError(`Failed to download model: ${e}`);
    } finally {
      setCatalogDownloadingId(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-bg-dark">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line-light bg-bg-light flex-shrink-0">
        <div className="flex items-center gap-2">
          <Server size={16} className="text-accent-primary" />
          <span className="text-sm font-medium text-text-norm">Model Server</span>
          {isLoaded && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent-green/20 text-accent-green">
              Active
            </span>
          )}
        </div>
        {showCloseButton && onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-line-med text-text-dark hover:text-text-med transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* System Resources Section */}
          <section className="space-y-2">
            <SystemResourcesSection
              resources={systemResources}
              usage={systemUsage}
            />
          </section>

          {/* Runtime Section - below system specs */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-text-dark uppercase tracking-wide">
              Runtime
            </h3>
            <RuntimeSection
              runtimeStatus={runtimeStatus}
              systemResources={systemResources}
              onInstall={installEngine}
              installingEngineId={installingEngineId}
              installProgress={installProgress}
            />
          </section>

          {/* Loaded Models Section */}
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-text-dark uppercase tracking-wide">
              Primary Agent LLM (Local or API)
            </h3>
            {primaryLlmSource === "api" && primaryApiConfig ? (
              <div className="rounded-lg bg-line-light border border-line-light overflow-hidden">
                <div className="p-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-accent-green flex-shrink-0" title="Active" />
                        <div className="text-xs text-text-norm truncate" title={primaryApiConfig.name}>
                          {primaryApiConfig.name} (API)
                        </div>
                      </div>
                      <div
                        className="pl-3.5 mt-1 text-[10px] text-text-med truncate"
                        title={`${primaryApiConfig.model_id} • ${primaryApiConfig.base_url}`}
                      >
                        {primaryApiConfig.model_id} • {primaryApiConfig.base_url}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setShowApiSelector((v) => !v);
                        if (!showApiSelector) {
                          void loadApiConfigs();
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-line-med text-[10px] text-text-med hover:text-text-norm hover:border-line-light transition-colors"
                    >
                      <Cloud size={10} />
                      Change
                    </button>
                    <button
                      onClick={() => void handleClearApiPrimary()}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-line-med text-[10px] text-text-med hover:text-text-norm hover:border-line-light transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            ) : isLoaded && modelInfo ? (
              <LoadedModelCard
                modelInfo={modelInfo}
                generationConfig={generationConfig}
                activeDevice={activeDevice}
                inferenceEndpoint={inferenceEndpoint}
                loadProgress={loadProgress}
                isLoading={isLoading}
                onUnload={() => setShowUnloadConfirm(true)}
                onUpdateConfig={handleUpdateConfig}
                isUpdating={configUpdating}
              />
            ) : showConfigPanel ? (
              <ModelConfigPanel
                modelInfo={previewModelInfo}
                config={loadConfig}
                devices={availableDevices}
                systemResources={systemResources}
                onConfigChange={setLoadConfig}
                onLoad={handleLoad}
                onCancel={handleCancelSelection}
                isLoading={isLoading}
                loadProgress={loadProgress}
              />
            ) : isLoading && loadProgress ? (
              <VramLoadingIndicator progress={loadProgress} />
            ) : (
              <div className="flex flex-col items-center justify-center py-6 rounded-lg bg-line-light border border-line-light">
                <div className="w-10 h-10 rounded-full bg-line-light flex items-center justify-center mb-2">
                  <Zap size={18} className="text-text-dark" />
                </div>
                <p className="text-xs text-text-dark mb-3">No model loaded</p>
                {!isLoaded && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleBrowse()}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-accent-primary hover:bg-accent-primary text-text-norm transition-colors"
                    >
                      <Upload size={12} />
                      Select Model
                    </button>
                    <button
                      onClick={() => {
                        setShowApiSelector((v) => !v);
                        if (!showApiSelector) {
                          void loadApiConfigs();
                        }
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border border-line-med text-text-med hover:text-text-norm hover:border-line-light hover:bg-line-med transition-colors"
                    >
                      <Cloud size={12} />
                      Use API Endpoint
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Local model controls should remain visible even when primary uses API */}
            {!showConfigPanel && (
              <>
                {isLoaded && canLoadAnother() ? (
                  <button
                    onClick={() => handleBrowse()}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs border border-dashed border-line-dark text-text-med hover:text-text-norm hover:border-line-dark hover:bg-line-light transition-colors"
                  >
                    <Plus size={12} />
                    Load Additional Model
                  </button>
                ) : (
                  <button
                    onClick={() => handleBrowse()}
                    className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs border border-dashed border-line-dark text-text-med hover:text-text-norm hover:border-line-dark hover:bg-line-light transition-colors"
                  >
                    <Upload size={12} />
                    Load Local Model
                  </button>
                )}
              </>
            )}
            {isLoaded && !showConfigPanel && (
              <button
                onClick={() => {
                  setShowApiSelector((v) => !v);
                  if (!showApiSelector) {
                    void loadApiConfigs();
                  }
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs border border-line-med text-text-med hover:text-text-norm hover:border-line-light hover:bg-line-med transition-colors"
              >
                <Cloud size={12} />
                Use API Endpoint
              </button>
            )}
            {showApiSelector && (
              <div className="rounded-lg bg-line-light border border-line-light p-2 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-text-med uppercase tracking-wide">Available API Endpoints</p>
                  <button
                    onClick={() => void loadApiConfigs()}
                    className="text-[10px] text-accent-primary hover:text-accent-primary"
                  >
                    Refresh
                  </button>
                </div>
                {apiConfigsLoading ? (
                  <div className="text-[11px] text-text-dark">Loading endpoints...</div>
                ) : apiConfigs.length === 0 ? (
                  <div className="text-[11px] text-text-dark">
                    No chat API endpoints configured. Add one in the API tool panel.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {apiConfigs.map((cfg) => (
                      <div
                        key={cfg.id}
                        className="rounded border border-line-med bg-bg-light px-2 py-1.5 flex items-center gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] text-text-norm truncate">
                            {cfg.name}
                            {cfg.is_primary ? " (Primary)" : ""}
                          </div>
                          <div className="text-[10px] text-text-dark truncate">
                            {cfg.model_id}
                          </div>
                          <div className="text-[10px] text-text-dark truncate">
                            {cfg.base_url}
                          </div>
                        </div>
                        <button
                          onClick={() => void handleUseApiEndpoint(cfg)}
                          disabled={switchingApiId !== null}
                          className="px-2 py-1 rounded text-[10px] bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 disabled:opacity-50"
                        >
                          {switchingApiId === cfg.id ? "Switching..." : "Use"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Available Models Section */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-text-dark uppercase tracking-wide">
                Available Models
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={openModelsFolder}
                  className="text-[10px] text-text-dark hover:text-text-med flex items-center gap-1"
                  title="Open models folder in file manager"
                >
                  <FolderOpen size={10} />
                  Open Folder
                </button>
                <button
                  onClick={fetchAvailableModels}
                  className="text-[10px] text-accent-primary hover:text-accent-primary"
                >
                  Refresh
                </button>
              </div>
            </div>
            <div className="rounded-lg bg-line-light border border-line-light overflow-hidden">
              <AvailableModelsTable
                models={showAllAvailableModels ? availableModels : availableModels.slice(0, 4)}
                onSelectModel={handleSelectModel}
                onDeleteModel={handleDeleteAvailableModel}
                isLoading={isLoading}
                deletingPath={deletingModelPath}
                selectedPath={selectedModelPath}
              />
            </div>
            {availableModels.length > 4 && (
              <div className="flex justify-center">
                <button
                  onClick={() => setShowAllAvailableModels((v) => !v)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-line-med text-[10px] text-text-med hover:text-text-norm hover:border-line-light"
                >
                  <span>{showAllAvailableModels ? "Show fewer models" : `View all models (${availableModels.length})`}</span>
                  {showAllAvailableModels ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              </div>
            )}
            {availableModels.length === 0 && (
              <p className="text-[10px] text-text-dark text-center py-2">
                Place .gguf files in the models folder or use "Select Model" above
              </p>
            )}
          </section>

          {/* Suggested Models Section */}
          <section className="space-y-2">
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-text-dark uppercase tracking-wide">
                Suggested Models
              </h3>
              <div className="relative">
                <div className="flex items-center gap-2">
                  <select
                    value={provider}
                    onChange={(e) => {
                      setProvider(e.target.value);
                      setProviderQuery("");
                      setProviderSelectedRepoId(null);
                    }}
                    className="h-8 py-0 pr-1 pl-2 leading-8 w-fit bg-line-light border border-line-med rounded-lg text-[11px] text-text-med"
                  >
                    <option value="unsloth_dynamic">Unsloth Dynamic Quants</option>
                    <option value="arxell">Arxell</option>
                  </select>
                  <div className="relative flex-1">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-med" />
                    <input
                      value={providerQuery}
                      onFocus={() => setProviderDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setProviderDropdownOpen(false), 120)}
                      onChange={(e) => {
                        setProviderQuery(e.target.value);
                        setProviderDropdownOpen(true);
                      }}
                      placeholder="Search model by provider"
                      className="w-full h-8 pl-7 pr-2 rounded-lg bg-line-light border-2 border-line-med text-[11px] text-text-norm placeholder:text-text-med outline-none"
                    />
                  </div>
                  <button
                    onClick={() => void handleProviderDownload()}
                    disabled={!selectedProviderModel || !!catalogDownloadingId}
                    className="h-8 px-3 rounded-lg text-[11px] bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {catalogDownloadingId ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                    Download
                  </button>
                </div>
                {providerDropdownOpen && (
                  <div className="absolute z-10 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-line-med bg-bg-light shadow-xl">
                    {providerFilteredModels.map((m) => {
                      const warn = m.params
                        ? Number.parseFloat(m.params.replace(" B", "")) * 0.6 > totalGpuGb && totalGpuGb > 0
                        : false;
                      return (
                        <button
                          key={m.repoId}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setProviderSelectedRepoId(m.repoId);
                            setProviderSelectedQuant(m.quantOptions[0] ?? "Q4_K_M");
                            setProviderQuery(m.label);
                            setProviderDropdownOpen(false);
                          }}
                          className="w-full text-left px-2 py-1.5 hover:bg-line-light text-[11px] text-text-norm flex items-center justify-between"
                        >
                          <span>
                            {m.label}
                            {m.params ? ` (${m.params})` : ""}
                          </span>
                          {warn && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-accent-gold/20 text-accent-gold">
                              VRAM warning
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {selectedProviderModel && (
                <div className="rounded-lg border border-line-med p-2 bg-line-light/40">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-text-norm truncate" title={selectedProviderModel.repoId}>
                      {selectedProviderModel.label}
                    </div>
                    <select
                      value={providerSelectedQuant}
                      onChange={(e) => setProviderSelectedQuant(e.target.value)}
                      className="bg-line-light border border-line-med rounded-lg px-2 py-1 text-[10px] text-text-norm font-mono"
                    >
                      {selectedProviderModel.quantOptions.map((q) => (
                        <option key={q} value={q}>{q}</option>
                      ))}
                    </select>
                  </div>
                  {likelyTooLarge && (
                    <div className="mt-1 text-[10px] text-accent-gold">
                      This model may be too large for current GPU VRAM.
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="rounded-lg bg-line-light border border-line-light overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line-light">
                    <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wide text-text-dark font-medium">Name</th>
                    <th className="w-20 text-left py-2 px-2 text-[10px] uppercase tracking-wide text-text-dark font-medium">Params</th>
                    <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wide text-text-dark font-medium">Size</th>
                    <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wide text-text-dark font-medium">Quant</th>
                    <th className="text-left py-2 px-2 text-[10px] uppercase tracking-wide text-text-dark font-medium">Features</th>
                    <th className="text-right py-2 px-2 text-[10px] uppercase tracking-wide text-text-dark font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {SUPPORTED_MODELS.map((model) => {
                    const isDownloading = catalogDownloadingId === model.id;
                    const repoUrl = `https://huggingface.co/${model.repoId}`;
                    const quantOptions = model.quantizationOptions ?? [model.pinnedFile];
                    const selectedQuant = selectedQuantByModelId[model.id] || model.pinnedFile;
                    return (
                      <tr key={model.id} className="border-b border-line-light hover:bg-line-light">
                        <td className="py-2 px-2 text-text-norm">
                          <div>{model.name}</div>
                        </td>
                        <td className="w-20 py-2 px-2 text-text-med font-mono">{model.paramsLabel}</td>
                        <td className="py-2 px-2 text-text-med font-mono">{model.sizeLabel}</td>
                        <td className="py-2 px-2">
                          {quantOptions.length > 1 ? (
                            <select
                              value={selectedQuant}
                              onChange={(e) =>
                                setSelectedQuantByModelId((prev) => ({ ...prev, [model.id]: e.target.value }))
                              }
                              disabled={!!catalogDownloadingId}
                              className="bg-line-light border border-line-med rounded px-1.5 py-1 text-[10px] text-text-norm font-mono outline-none focus:border-accent-primary/50 disabled:opacity-50"
                              title="Select GGUF quantization"
                            >
                              {quantOptions.map((q) => (
                                <option key={q} value={q} className="bg-bg-light">
                                  {formatQuantLabel(q)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-text-med font-mono text-[10px]">{formatQuantLabel(selectedQuant)}</span>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1.5 text-text-med" title="Tool use • Thinking • Vision">
                            <Wrench size={12} className={cn(model.hasToolUse ? "text-accent-primary" : "text-text-dark")} />
                            <Brain size={12} className={cn(model.hasThinking ? "text-accent-primary" : "text-text-dark")} />
                            <Eye size={12} className={cn(model.hasVision ? "text-accent-primary" : "text-text-dark")} />
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => void openExternal(repoUrl)}
                              className="px-2 py-1 rounded text-[10px] bg-line-light text-text-med hover:bg-line-med transition-colors"
                              title="Open pinned Hugging Face repo"
                            >
                              Open HF
                            </button>
                            <button
                              onClick={() => void handleDownloadSupportedModel(model)}
                              disabled={!!catalogDownloadingId}
                              className={cn(
                                "px-2 py-1 rounded text-[10px] transition-colors flex items-center gap-1",
                                catalogDownloadingId
                                  ? "bg-line-light text-text-dark cursor-not-allowed"
                                  : "bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
                              )}
                              title={`Download ${selectedQuant} GGUF and register in local models`}
                            >
                              {isDownloading ? (
                                <>
                                  <Loader2 size={10} className="animate-spin" />
                                  Downloading...
                                </>
                              ) : (
                                <>
                                  <Download size={10} />
                                  Download
                                </>
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Error Display */}
          {(error || previewError || loadError) && (
            <ErrorBanner
              message={error || previewError || loadError || ""}
              onDismiss={() => {
                setError(null);
                setPreviewError(null);
                setLoadError(null);
              }}
            />
          )}
        </div>
      </div>

      {/* Unload confirmation dialog */}
      {showUnloadConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-bg-light border border-line-med rounded-xl w-full max-w-sm mx-4 shadow-2xl">
            <div className="p-4 space-y-3">
              <h3 className="text-sm font-semibold text-text-norm">Unload Model?</h3>
              <p className="text-xs text-text-med">This will interrupt any active generation.</p>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-line-med">
              <button
                onClick={() => setShowUnloadConfirm(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-text-med hover:text-text-norm hover:bg-line-light transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUnload}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent-red hover:bg-accent-red text-text-norm transition-colors"
              >
                Unload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Modal wrapper for backward compatibility
export function ServePanel({ open, onClose }: ServePanelProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-bg-light border border-line-med rounded-2xl w-full max-w-3xl mx-4 shadow-2xl max-h-[90vh] overflow-hidden">
        <ServePanelContent showCloseButton onClose={onClose} />
      </div>
    </div>
  );
}
