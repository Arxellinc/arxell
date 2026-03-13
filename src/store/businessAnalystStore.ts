import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { fetchDataGovBusinessSnapshot, fetchFredMacroSnapshot, type ConnectorResult } from "../core/business/connectors";

export type BusinessRunStatus = "draft" | "intake" | "running" | "reviewing" | "completed" | "failed" | "paused" | "cancelled";
export type SpecialistTaskStatus = "pending" | "running" | "completed" | "failed";

export interface BusinessIntake {
  business_idea: string;
  target_customer: string;
  geography: string;
  budget_usd: string;
  timeline_months: string;
  constraints: string;
  objectives: string;
}

export interface SpecialistTask {
  id: string;
  title: string;
  status: SpecialistTaskStatus;
  owner: string;
  output_summary: string;
}

export interface BusinessArtifact {
  id: string;
  type:
    | "business_plan"
    | "market_analysis"
    | "economic_feasibility"
    | "ai_feasibility"
    | "gtm_plan"
    | "technical_roadmap"
    | "pitch_deck";
  title: string;
  content: string;
  updated_at: string;
}

export interface BusinessRun {
  id: string;
  name: string;
  project_id: string | null;
  project_workspace_path: string;
  status: BusinessRunStatus;
  intake: BusinessIntake;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  estimated_hours: number;
  elapsed_minutes: number;
  connector_status: Array<{
    source: string;
    ok: boolean;
    fetched_at: string;
    notes: string;
    error: string | null;
  }>;
  evidence: Array<{
    source: string;
    title: string;
    value: string;
    date: string | null;
    url: string;
  }>;
  tasks: SpecialistTask[];
  artifacts: BusinessArtifact[];
}

export interface ArtifactCitation {
  artifact_type: BusinessArtifact["type"];
  evidence_refs: Array<{
    source: string;
    title: string;
    date: string | null;
    url: string;
  }>;
}

interface BusinessAnalystState {
  runs: BusinessRun[];
  createRun: (
    name: string,
    intake: BusinessIntake,
    context?: { projectId?: string | null; projectWorkspacePath?: string }
  ) => BusinessRun;
  updateRunIntake: (runId: string, intake: Partial<BusinessIntake>) => void;
  setRunStatus: (runId: string, status: BusinessRunStatus) => void;
  advanceRun: (runId: string) => void;
  cancelRun: (runId: string) => void;
  enrichRunWithExternalData: (runId: string, options?: { fredApiKey?: string; dataGovQuery?: string }) => Promise<void>;
  exportRunBundle: (runId: string) => string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
}

const DEFAULT_TASKS: Omit<SpecialistTask, "id">[] = [
  { title: "Market Analysis", status: "pending", owner: "agent_market_research", output_summary: "" },
  { title: "Economic Analysis", status: "pending", owner: "agent_economic_analysis", output_summary: "" },
  { title: "AI Feasibility", status: "pending", owner: "agent_ai_feasibility", output_summary: "" },
  { title: "GTM Strategy", status: "pending", owner: "agent_gtm_strategy", output_summary: "" },
  { title: "Financial Modeling", status: "pending", owner: "agent_financial_modeling", output_summary: "" },
  { title: "Technical Roadmap", status: "pending", owner: "agent_technical_roadmap", output_summary: "" },
  { title: "Pitch Deck", status: "pending", owner: "agent_pitch_deck", output_summary: "" },
];

function makeDefaultArtifacts(name: string): BusinessArtifact[] {
  const templates: Array<{ type: BusinessArtifact["type"]; title: string }> = [
    { type: "business_plan", title: "Comprehensive Business Plan" },
    { type: "market_analysis", title: "Market Analysis" },
    { type: "economic_feasibility", title: "Economic Feasibility" },
    { type: "ai_feasibility", title: "AI Progress Feasibility" },
    { type: "gtm_plan", title: "Go-To-Market Plan" },
    { type: "technical_roadmap", title: "Technical Roadmap" },
    { type: "pitch_deck", title: "Pitch Deck Outline" },
  ];
  return templates.map((template) => ({
    id: makeId("artifact"),
    type: template.type,
    title: template.title,
    content: `# ${template.title}\n\nRun: ${name}\n\nPending generation.`,
    updated_at: nowIso(),
  }));
}

function generateArtifactContent(type: BusinessArtifact["type"], run: BusinessRun): string {
  const intake = run.intake;
  const base = [
    `# ${run.name} - ${type.replace(/_/g, " ")}`,
    "",
    `Business Idea: ${intake.business_idea || "-"}`,
    `Target Customer: ${intake.target_customer || "-"}`,
    `Geography: ${intake.geography || "-"}`,
    `Budget (USD): ${intake.budget_usd || "-"}`,
    `Timeline (months): ${intake.timeline_months || "-"}`,
    "",
  ];
  if (run.evidence.length > 0) {
    base.push("## External Evidence Snapshot");
    run.evidence.slice(0, 5).forEach((item) => {
      base.push(`- [${item.source}] ${item.title}: ${item.value}${item.date ? ` (${item.date})` : ""}`);
    });
    base.push("");
  }
  if (type === "business_plan") {
    base.push("## Executive Summary", "- Problem, solution, market, and milestones.");
  } else if (type === "market_analysis") {
    base.push("## Market Sizing", "- TAM/SAM/SOM assumptions and competitor scan.");
  } else if (type === "economic_feasibility") {
    base.push("## Economic Outlook", "- Macro risk, demand sensitivity, and scenario impacts.");
  } else if (type === "ai_feasibility") {
    base.push("## AI Feasibility", "- Automation risk, defensibility, and capability roadmap.");
  } else if (type === "gtm_plan") {
    base.push("## GTM Strategy", "- Channel sequence, pricing tests, and launch timeline.");
  } else if (type === "technical_roadmap") {
    base.push("## Technical Roadmap", "- Milestones, architecture, and staffing phases.");
  } else if (type === "pitch_deck") {
    base.push("## Pitch Deck", "- Problem, solution, market, traction, model, ask.");
  }
  base.push("", `Generated: ${nowIso()}`);
  return base.join("\n");
}

export function buildCitationIndex(run: BusinessRun): ArtifactCitation[] {
  const topEvidence = run.evidence.slice(0, 8);
  return run.artifacts.map((artifact) => ({
    artifact_type: artifact.type,
    evidence_refs: topEvidence.map((item) => ({
      source: item.source,
      title: item.title,
      date: item.date,
      url: item.url,
    })),
  }));
}

export const useBusinessAnalystStore = create<BusinessAnalystState>()(
  persist<BusinessAnalystState>(
    (set, get) => ({
      runs: [] as BusinessRun[],

      createRun: (name, intake, context) => {
        const created: BusinessRun = {
          id: makeId("ba_run"),
          name: name.trim() || "Business Analyst Run",
          project_id: context?.projectId ?? null,
          project_workspace_path: context?.projectWorkspacePath?.trim() ?? "",
          status: "intake",
          intake,
          created_at: nowIso(),
          updated_at: nowIso(),
          started_at: null,
          completed_at: null,
          estimated_hours: 8,
          elapsed_minutes: 0,
          connector_status: [],
          evidence: [],
          tasks: DEFAULT_TASKS.map((task) => ({ ...task, id: makeId("ba_task") })),
          artifacts: makeDefaultArtifacts(name),
        };
        set((state) => ({ runs: [created, ...state.runs] }));
        return created;
      },

      updateRunIntake: (runId, intake) =>
        set((state) => ({
          runs: state.runs.map((run) =>
            run.id === runId
              ? { ...run, intake: { ...run.intake, ...intake }, updated_at: nowIso() }
              : run
          ),
        })),

      setRunStatus: (runId, status) =>
        set((state) => ({
          runs: state.runs.map((run) =>
            run.id === runId
              ? {
                  ...run,
                  status,
                  started_at: status === "running" && !run.started_at ? nowIso() : run.started_at,
                  completed_at: status === "completed" ? nowIso() : run.completed_at,
                  updated_at: nowIso(),
                }
              : run
          ),
        })),

      advanceRun: (runId) =>
        set((state) => ({
          runs: state.runs.map((run) => {
            if (run.id !== runId || run.status === "completed" || run.status === "cancelled") return run;
            const nextTaskIndex = run.tasks.findIndex((task) => task.status !== "completed");
            if (nextTaskIndex === -1) {
              return {
                ...run,
                status: "completed",
                completed_at: nowIso(),
                updated_at: nowIso(),
              };
            }
            const nextTasks: SpecialistTask[] = run.tasks.map((task, idx) => {
              if (idx === nextTaskIndex) {
                return {
                  ...task,
                  status: "completed",
                  output_summary: `${task.title} completed with synthesized findings.`,
                };
              }
              if (idx === nextTaskIndex + 1 && task.status === "pending") {
                return { ...task, status: "running" };
              }
              return task;
            });
            const nextRun = {
              ...run,
              status: "running" as BusinessRunStatus,
              started_at: run.started_at ?? nowIso(),
              elapsed_minutes: run.elapsed_minutes + 45,
              tasks: nextTasks,
              updated_at: nowIso(),
            };
            const completedCount = nextTasks.filter((task) => task.status === "completed").length;
            const nextArtifacts = nextRun.artifacts.map((artifact, idx) =>
              idx < completedCount
                ? { ...artifact, content: generateArtifactContent(artifact.type, nextRun), updated_at: nowIso() }
                : artifact
            );
            const allDone = nextTasks.every((task) => task.status === "completed");
            return {
              ...nextRun,
              tasks: nextTasks,
              artifacts: nextArtifacts,
              status: allDone ? "completed" : nextRun.status,
              completed_at: allDone ? nowIso() : nextRun.completed_at,
            };
          }),
        })),

      cancelRun: (runId) =>
        set((state) => ({
          runs: state.runs.map((run) =>
            run.id === runId ? { ...run, status: "cancelled", updated_at: nowIso() } : run
          ),
        })),

      enrichRunWithExternalData: async (runId, options) => {
        const [fred, dataGov] = await Promise.all([
          fetchFredMacroSnapshot(options?.fredApiKey),
          fetchDataGovBusinessSnapshot(options?.dataGovQuery ?? "small business"),
        ]);
        const connectorResults: ConnectorResult[] = [fred, dataGov];
        const evidence = connectorResults.flatMap((result) => result.observations);
        set((state) => ({
          runs: state.runs.map((run) => {
            if (run.id !== runId) return run;
            const nextRun: BusinessRun = {
              ...run,
              updated_at: nowIso(),
              connector_status: connectorResults.map((result) => ({
                source: result.source,
                ok: result.ok,
                fetched_at: result.fetched_at,
                notes: result.notes,
                error: result.error,
              })),
              evidence,
            };
            return {
              ...nextRun,
              artifacts: nextRun.artifacts.map((artifact) => ({
                ...artifact,
                content: generateArtifactContent(artifact.type, nextRun),
                updated_at: nowIso(),
              })),
            };
          }),
        }));
      },

      exportRunBundle: (runId): string | null => {
        const run = get().runs.find((item) => item.id === runId);
        if (!run) return null;
        return JSON.stringify(
          {
            run: {
              id: run.id,
              name: run.name,
              status: run.status,
              project_id: run.project_id,
              project_workspace_path: run.project_workspace_path,
              created_at: run.created_at,
              updated_at: run.updated_at,
              started_at: run.started_at,
              completed_at: run.completed_at,
              estimated_hours: run.estimated_hours,
              elapsed_minutes: run.elapsed_minutes,
            },
            intake: run.intake,
            tasks: run.tasks,
            connectors: run.connector_status,
            evidence: run.evidence,
            citations: buildCitationIndex(run),
            artifacts: run.artifacts.map((artifact) => ({
              type: artifact.type,
              title: artifact.title,
              updated_at: artifact.updated_at,
              content: artifact.content,
            })),
          },
          null,
          2
        );
      },
    }),
    {
      name: "arx-business-analyst-store",
      version: 1,
      storage: createJSONStorage(() => localStorage),
    }
  )
);
