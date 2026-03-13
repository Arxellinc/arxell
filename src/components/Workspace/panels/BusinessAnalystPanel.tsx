import { BarChart3, Copy, FileJson2, FileSearch, FileText, Pause, Play, SkipForward, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../../lib/utils";
import { buildCitationIndex, useBusinessAnalystStore, type BusinessIntake } from "../../../store/businessAnalystStore";
import { useChatStore } from "../../../store/chatStore";
import { usePremiumStore } from "../../../store/premiumStore";
import { projectCreate, projectList, projectUpdate } from "../../../lib/tauri";
import { codeWriteFile } from "../../../core/tooling/client";
import { PanelWrapper } from "./shared";
import { useOptionalAuth } from "../../../lib/auth";

const EMPTY_INTAKE: BusinessIntake = {
  business_idea: "",
  target_customer: "",
  geography: "",
  budget_usd: "",
  timeline_months: "",
  constraints: "",
  objectives: "",
};
const BUSINESS_PROJECT_NAME = "Business Analyst";
const BUSINESS_WORKSPACE_DIRNAME = "arx-business-analyst-workspace";

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function joinPath(...parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, idx) => {
      if (idx === 0) return part.replace(/\/+$/, "");
      return part.replace(/^\/+/, "").replace(/\/+$/, "");
    })
    .join("/");
}

function parentDir(path: string): string {
  const normalized = normalizePath(path);
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}

export function BusinessAnalystPanel() {
  const { isSignedIn, getToken } = useOptionalAuth();
  const { runs, createRun, setRunStatus, advanceRun, cancelRun, enrichRunWithExternalData, exportRunBundle } = useBusinessAnalystStore();
  const { projects, addProject, setProjects, setActiveProject } = useChatStore();
  const { entitlements, preflightBusinessReport } = usePremiumStore();
  const [draftName, setDraftName] = useState("Business Analyst Run");
  const [intake, setIntake] = useState<BusinessIntake>(EMPTY_INTAKE);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(runs[0]?.id ?? null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [contentView, setContentView] = useState<"artifacts" | "evidence">("artifacts");
  const [fredApiKey, setFredApiKey] = useState("");
  const [dataGovQuery, setDataGovQuery] = useState("small business");
  const [enriching, setEnriching] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [premiumError, setPremiumError] = useState<string | null>(null);

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const selectedArtifact = selectedRun?.artifacts.find((artifact) => artifact.id === selectedArtifactId)
    ?? selectedRun?.artifacts[0]
    ?? null;

  const progress = useMemo(() => {
    if (!selectedRun) return 0;
    if (selectedRun.tasks.length === 0) return 0;
    const done = selectedRun.tasks.filter((task) => task.status === "completed").length;
    return Math.round((done / selectedRun.tasks.length) * 100);
  }, [selectedRun]);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1200);
  };

  const onCreateRun = () => {
    void (async () => {
      setPremiumError(null);
      if (!entitlements.business_analyst?.active) {
        setPremiumError("Business Analyst premium subscription is required.");
        return;
      }
      if (!isSignedIn) {
        setPremiumError("Sign in required before starting a premium report.");
        return;
      }
      const token = await getToken({ template: "premium_api" });
      const preflight = await preflightBusinessReport(token ?? undefined);
      if (!preflight.allowed) {
        setPremiumError(preflight.reason || "Report quota reached for this billing cycle.");
        return;
      }
      const project = await ensureBusinessProject();
      if (!project) return;
      const created = createRun(draftName, intake, {
        projectId: project.id,
        projectWorkspacePath: project.workspace_path,
      });
      setSelectedRunId(created.id);
      setSelectedArtifactId(created.artifacts[0]?.id ?? null);
      await persistRunOutputs(created);
    })();
  };

  const onEnrich = async () => {
    if (!selectedRun) return;
    setEnriching(true);
    try {
      await enrichRunWithExternalData(selectedRun.id, { fredApiKey: fredApiKey.trim(), dataGovQuery });
      const run = useBusinessAnalystStore.getState().runs.find((item) => item.id === selectedRun.id);
      if (run) await persistRunOutputs(run);
    } finally {
      setEnriching(false);
    }
  };

  const ensureBusinessProject = async (): Promise<{ id: string; workspace_path: string } | null> => {
    try {
      const existing = projects.find((project) => project.name === BUSINESS_PROJECT_NAME) ?? null;
      const existingWorkspaceRoots = projects
        .map((project) => normalizePath(project.workspace_path))
        .filter(Boolean);
      const fallbackRoot = existingWorkspaceRoots[0] ?? "/tmp";

      let project = existing;
      let targetWorkspace = project ? normalizePath(project.workspace_path) : "";
      if (!targetWorkspace) {
        targetWorkspace = joinPath(fallbackRoot, BUSINESS_WORKSPACE_DIRNAME);
      }
      const bootstrapRoot = (() => {
        const parent = parentDir(targetWorkspace);
        return parent && parent !== targetWorkspace ? parent : fallbackRoot;
      })();

      if (!project) {
        project = await projectCreate(BUSINESS_PROJECT_NAME, targetWorkspace);
        addProject(project);
      } else if (normalizePath(project.workspace_path) !== targetWorkspace) {
        await projectUpdate(project.id, { workspacePath: targetWorkspace });
      }

      // Seed canonical project structure before tool writes use workspace root-guard.
      await codeWriteFile(
        joinPath(targetWorkspace, "README.md"),
        [
          "# Business Analyst Project",
          "",
          "This workspace stores autonomous Business Analyst runs, artifacts, and evidence.",
        ].join("\n"),
        bootstrapRoot,
        "sandbox"
      );
      await codeWriteFile(
        joinPath(targetWorkspace, "business_analyst", ".project.json"),
        JSON.stringify(
          {
            project_name: BUSINESS_PROJECT_NAME,
            initialized_at: new Date().toISOString(),
            structure: ["business_analyst/runs/<run_id>/"],
          },
          null,
          2
        ),
        bootstrapRoot,
        "sandbox"
      );

      const refreshed = await projectList();
      setProjects(refreshed);
      const refreshedProject = refreshed.find((item) => item.id === project.id) ?? project;
      setActiveProject(refreshedProject.id);
      return { id: refreshedProject.id, workspace_path: normalizePath(refreshedProject.workspace_path) };
    } catch (error) {
      console.error("Failed to ensure Business Analyst project:", error);
      return null;
    }
  };

  const persistRunOutputs = async (run: NonNullable<typeof selectedRun>) => {
    const workspace = normalizePath(run.project_workspace_path);
    if (!workspace) return;
    const runRoot = joinPath(workspace, "business_analyst", "runs", run.id);
    const rootGuard = workspace;
    try {
      await codeWriteFile(
        joinPath(runRoot, "run_summary.json"),
        JSON.stringify(
          {
            id: run.id,
            name: run.name,
            project_id: run.project_id,
            status: run.status,
            created_at: run.created_at,
            updated_at: run.updated_at,
            started_at: run.started_at,
            completed_at: run.completed_at,
            estimated_hours: run.estimated_hours,
            elapsed_minutes: run.elapsed_minutes,
          },
          null,
          2
        ),
        rootGuard,
        "sandbox"
      );
      await codeWriteFile(joinPath(runRoot, "intake.json"), JSON.stringify(run.intake, null, 2), rootGuard, "sandbox");
      await codeWriteFile(joinPath(runRoot, "tasks.json"), JSON.stringify(run.tasks, null, 2), rootGuard, "sandbox");
      await codeWriteFile(joinPath(runRoot, "evidence.json"), JSON.stringify(run.evidence, null, 2), rootGuard, "sandbox");
      await codeWriteFile(
        joinPath(runRoot, "citations.json"),
        JSON.stringify(buildCitationIndex(run), null, 2),
        rootGuard,
        "sandbox"
      );
      await codeWriteFile(
        joinPath(runRoot, "connector_status.json"),
        JSON.stringify(run.connector_status, null, 2),
        rootGuard,
        "sandbox"
      );
      for (const artifact of run.artifacts) {
        await codeWriteFile(
          joinPath(runRoot, "artifacts", `${artifact.type}.md`),
          artifact.content,
          rootGuard,
          "sandbox"
        );
      }
    } catch (error) {
      console.error("Failed to persist Business Analyst outputs:", error);
    }
  };

  return (
    <PanelWrapper
      title="Business Analyst"
      icon={<BarChart3 size={16} className="text-accent-gold" />}
      actions={
        <button
          onClick={onCreateRun}
          className="px-2 py-1 rounded text-[11px] bg-accent-gold/20 text-accent-gold hover:bg-accent-gold/30 transition-colors"
        >
          New Run
        </button>
      }
    >
      <div className="flex h-full min-h-0">
        <div className="w-[320px] border-r border-line-light p-3 overflow-y-auto space-y-2">
          {premiumError ? (
            <div className="rounded border border-accent-red/30 bg-accent-red/10 p-2 text-[11px] text-accent-red">
              {premiumError}
            </div>
          ) : null}
          <div className="text-[11px] uppercase tracking-wider text-text-dark">Intake</div>
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Run name"
            className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-gold/50"
          />
          <textarea
            value={intake.business_idea}
            onChange={(e) => setIntake((v) => ({ ...v, business_idea: e.target.value }))}
            placeholder="Business idea"
            className="w-full min-h-16 px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-gold/50 resize-y"
          />
          <input
            type="text"
            value={intake.target_customer}
            onChange={(e) => setIntake((v) => ({ ...v, target_customer: e.target.value }))}
            placeholder="Target customer"
            className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-gold/50"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={intake.geography}
              onChange={(e) => setIntake((v) => ({ ...v, geography: e.target.value }))}
              placeholder="Geography"
              className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-gold/50"
            />
            <input
              type="text"
              value={intake.timeline_months}
              onChange={(e) => setIntake((v) => ({ ...v, timeline_months: e.target.value }))}
              placeholder="Timeline (months)"
              className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-gold/50"
            />
          </div>
          <input
            type="text"
            value={intake.budget_usd}
            onChange={(e) => setIntake((v) => ({ ...v, budget_usd: e.target.value }))}
            placeholder="Budget (USD)"
            className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-gold/50"
          />
          <textarea
            value={intake.objectives}
            onChange={(e) => setIntake((v) => ({ ...v, objectives: e.target.value }))}
            placeholder="Objectives"
            className="w-full min-h-12 px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-gold/50 resize-y"
          />
          <textarea
            value={intake.constraints}
            onChange={(e) => setIntake((v) => ({ ...v, constraints: e.target.value }))}
            placeholder="Constraints"
            className="w-full min-h-12 px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-gold/50 resize-y"
          />

          <div className="pt-2 border-t border-line-med">
            <div className="text-[11px] uppercase tracking-wider text-text-dark mb-1">Runs</div>
            <div className="space-y-1">
              {runs.length === 0 ? (
                <div className="text-[11px] text-text-dark italic">No runs yet.</div>
              ) : (
                runs.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => {
                      setSelectedRunId(run.id);
                      setSelectedArtifactId(run.artifacts[0]?.id ?? null);
                    }}
                    className={cn(
                      "w-full text-left px-2 py-1.5 rounded text-xs border transition-colors",
                      selectedRunId === run.id
                        ? "border-accent-gold/50 bg-accent-gold/10 text-accent-gold"
                        : "border-line-med bg-line-light text-text-med hover:bg-line-med"
                    )}
                  >
                    <div className="truncate">{run.name}</div>
                    <div className="text-[10px] text-text-dark">{run.status}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          {selectedRun ? (
            <>
              <div className="px-3 py-2 border-b border-line-light flex items-center gap-2">
                <div className="text-sm text-text-norm truncate">{selectedRun.name}</div>
                <span className="text-[10px] uppercase text-text-dark">{selectedRun.status}</span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => {
                      if (!selectedRun) return;
                      const bundle = exportRunBundle(selectedRun.id);
                      if (bundle) void copyText(bundle);
                    }}
                    className="px-2 py-1 rounded text-[10px] bg-line-med text-text-med hover:bg-line-dark"
                  >
                    <FileJson2 size={11} className="inline mr-1" />
                    {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Export"}
                  </button>
                  <button
                    onClick={() => {
                      setRunStatus(selectedRun.id, selectedRun.status === "running" ? "paused" : "running");
                      const run = useBusinessAnalystStore.getState().runs.find((item) => item.id === selectedRun.id);
                      if (run) void persistRunOutputs(run);
                    }}
                    className="px-2 py-1 rounded text-[10px] bg-line-med text-text-med hover:bg-line-dark"
                  >
                    {selectedRun.status === "running" ? <Pause size={11} className="inline mr-1" /> : <Play size={11} className="inline mr-1" />}
                    {selectedRun.status === "running" ? "Pause" : "Start"}
                  </button>
                  <button
                    onClick={() => {
                      advanceRun(selectedRun.id);
                      const run = useBusinessAnalystStore.getState().runs.find((item) => item.id === selectedRun.id);
                      if (run) void persistRunOutputs(run);
                    }}
                    className="px-2 py-1 rounded text-[10px] bg-accent-gold/20 text-accent-gold hover:bg-accent-gold/30"
                  >
                    <SkipForward size={11} className="inline mr-1" />
                    Advance
                  </button>
                  <button
                    onClick={() => void onEnrich()}
                    disabled={enriching}
                    className="px-2 py-1 rounded text-[10px] bg-sky-500/20 text-sky-200 hover:bg-sky-500/30 disabled:opacity-60"
                  >
                    {enriching ? "Enriching..." : "Live Data"}
                  </button>
                  <button
                    onClick={() => {
                      cancelRun(selectedRun.id);
                      const run = useBusinessAnalystStore.getState().runs.find((item) => item.id === selectedRun.id);
                      if (run) void persistRunOutputs(run);
                    }}
                    className="px-2 py-1 rounded text-[10px] bg-accent-red/12 text-accent-red hover:bg-accent-red/20"
                  >
                    <Square size={10} className="inline mr-1" />
                    Cancel
                  </button>
                </div>
              </div>

              <div className="px-3 py-2 border-b border-line-light">
                <div className="h-2 rounded bg-line-med overflow-hidden">
                  <div className="h-full bg-accent-gold/70" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-1 text-[10px] text-text-dark">
                  Progress {progress}% · elapsed {selectedRun.elapsed_minutes} min · est. {selectedRun.estimated_hours}h
                </div>
                <div className="mt-1 text-[10px] text-text-dark">
                  Project: {selectedRun.project_workspace_path || "(not linked yet)"}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="password"
                    value={fredApiKey}
                    onChange={(e) => setFredApiKey(e.target.value)}
                    placeholder="FRED API key (optional)"
                    className="px-2 py-1 bg-line-light border border-line-med rounded text-[10px] text-text-norm outline-none focus:border-sky-400/60"
                  />
                  <input
                    type="text"
                    value={dataGovQuery}
                    onChange={(e) => setDataGovQuery(e.target.value)}
                    placeholder="data.gov query"
                    className="px-2 py-1 bg-line-light border border-line-med rounded text-[10px] text-text-norm outline-none focus:border-sky-400/60"
                  />
                </div>
              </div>

              <div className="flex-1 min-h-0 flex">
                <div className="w-[280px] border-r border-line-light overflow-y-auto">
                  <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-text-dark border-b border-line-light">
                    Specialist Tasks
                  </div>
                  {selectedRun.tasks.map((task) => (
                    <div key={task.id} className="px-3 py-2 border-b border-line-light">
                      <div className="text-xs text-text-norm">{task.title}</div>
                      <div className="text-[10px] text-text-dark">{task.owner}</div>
                      <div className="text-[10px] mt-1 text-accent-gold/80">{task.status}</div>
                    </div>
                  ))}
                  <div className="px-3 py-2 border-t border-line-light">
                    <div className="text-[10px] uppercase tracking-wider text-text-dark mb-1">Connectors</div>
                    {selectedRun.connector_status.length === 0 ? (
                      <div className="text-[10px] text-text-dark italic">No connector runs yet.</div>
                    ) : (
                      selectedRun.connector_status.map((source) => (
                        <div key={`${source.source}:${source.fetched_at}`} className="text-[10px] mb-1">
                          <span className={cn(source.ok ? "text-accent-green" : "text-accent-red")}>
                            {source.ok ? "ok" : "fail"}
                          </span>{" "}
                          <span className="text-text-med">{source.source}</span>
                          <div className="text-text-dark truncate">
                            {source.notes}
                            {source.error ? ` · ${source.error}` : ""}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="px-3 py-2 border-b border-line-light flex items-center gap-2">
                    <button
                      onClick={() => setContentView("artifacts")}
                      className={cn(
                        "px-2 py-1 rounded text-[10px]",
                        contentView === "artifacts" ? "bg-accent-gold/20 text-accent-gold" : "bg-line-light text-text-dark"
                      )}
                    >
                      <FileText size={10} className="inline mr-1" />
                      Artifacts
                    </button>
                    <button
                      onClick={() => setContentView("evidence")}
                      className={cn(
                        "px-2 py-1 rounded text-[10px]",
                        contentView === "evidence" ? "bg-sky-500/20 text-sky-100" : "bg-line-light text-text-dark"
                      )}
                    >
                      <FileSearch size={10} className="inline mr-1" />
                      Evidence ({selectedRun.evidence.length})
                    </button>
                    <div className="ml-auto">
                      {contentView === "evidence" ? (
                        <button
                          onClick={() => void copyText(JSON.stringify(selectedRun.evidence, null, 2))}
                          className="px-2 py-1 rounded text-[10px] bg-line-med text-text-med hover:bg-line-dark"
                        >
                          <Copy size={10} className="inline mr-1" />
                          Copy Evidence
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {contentView === "artifacts" ? (
                    <>
                      <div className="px-3 py-2 border-b border-line-light flex items-center gap-1 overflow-x-auto">
                        {selectedRun.artifacts.map((artifact) => (
                          <button
                            key={artifact.id}
                            onClick={() => setSelectedArtifactId(artifact.id)}
                            className={cn(
                              "px-2 py-1 rounded text-[10px] whitespace-nowrap",
                              (selectedArtifact?.id === artifact.id)
                                ? "bg-accent-gold/20 text-accent-gold"
                                : "bg-line-light text-text-dark"
                            )}
                          >
                            <FileText size={10} className="inline mr-1" />
                            {artifact.title}
                          </button>
                        ))}
                      </div>
                      <div className="flex-1 p-3 overflow-auto">
                        {selectedArtifact ? (
                          <pre className="whitespace-pre-wrap text-xs text-text-med leading-5">
                            {selectedArtifact.content}
                          </pre>
                        ) : (
                          <div className="text-xs text-text-dark italic">Select an artifact.</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 p-3 overflow-auto">
                      {selectedRun.evidence.length === 0 ? (
                        <div className="text-xs text-text-dark italic">No evidence yet. Run Live Data first.</div>
                      ) : (
                        <div className="space-y-2">
                          {selectedRun.evidence.map((item, idx) => (
                            <div key={`${item.source}:${item.title}:${idx}`} className="rounded border border-line-med bg-line-light p-2">
                              <div className="text-[11px] text-text-norm">{item.title}</div>
                              <div className="text-[10px] text-text-dark">{item.source}{item.date ? ` · ${item.date}` : ""}</div>
                              <div className="mt-1 text-[11px] text-text-med whitespace-pre-wrap">{item.value}</div>
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-block text-[10px] text-sky-300 hover:text-sky-200 underline underline-offset-2"
                              >
                                Source
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-text-dark">Create a run to begin.</div>
          )}
        </div>
      </div>
    </PanelWrapper>
  );
}
