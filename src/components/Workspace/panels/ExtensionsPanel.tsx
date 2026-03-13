import { Boxes, Briefcase, ChevronDown, ChevronUp, Cloud, Download, HardDrive, Link2, Power, PowerOff, ShieldCheck, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../../lib/utils";
import { getAllToolManifests } from "../../../core/tooling/registry";
import { useToolCatalogStore } from "../../../store/toolCatalogStore";
import { usePremiumStore } from "../../../store/premiumStore";
import { PremiumToolModal } from "./PremiumToolModal";
import { PanelWrapper } from "./shared";

const REQUIRED_TOOL_IDS = new Set(["tools", "llm", "help", "serve"]);
const PREMIUM_TOOLS = [
  {
    id: "premium-business-analyst",
    title: "Business Analyst",
    description: "Autonomous market, feasibility, GTM, roadmap, and pitch-deck planning.",
    priceLabel: "$29/mo",
    icon: Briefcase,
  },
  {
    id: "premium-google-drive",
    title: "Google Drive Integration",
    description: "Sync files, search docs, and attach workspace assets from Drive.",
    priceLabel: "$9/mo",
    icon: HardDrive,
  },
  {
    id: "premium-cloud-sync",
    title: "Cloud Account Sync",
    description: "Cross-device state sync for projects, tasks, tools, and memory.",
    priceLabel: "$12/mo",
    icon: Cloud,
  },
  {
    id: "premium-specialist-agents",
    title: "Specialist Agents",
    description: "Domain experts for legal, finance, security, and research workflows.",
    priceLabel: "$29/mo",
    icon: Sparkles,
  },
  {
    id: "premium-vector-rag",
    title: "Managed Vector DB + RAG Indexing",
    description: "Hosted embeddings, semantic search, and document sync.",
    priceLabel: "$19/mo",
    icon: Cloud,
  },
  {
    id: "premium-team-memory",
    title: "Team Memory Cloud",
    description: "Shared long-term memory across users and workspaces.",
    priceLabel: "$15/mo",
    icon: Cloud,
  },
  {
    id: "premium-browser-cloud",
    title: "Browser Automation Cloud",
    description: "Remote authenticated browser sessions for agent tasks.",
    priceLabel: "$25/mo",
    icon: Cloud,
  },
  {
    id: "premium-secrets-vault",
    title: "Secure Vault + Secrets Manager",
    description: "Encrypted credentials with rotation and audit trails.",
    priceLabel: "$18/mo",
    icon: ShieldCheck,
  },
  {
    id: "premium-exec-sandbox",
    title: "Code Execution Sandbox Cloud",
    description: "Scalable isolated runners for heavy or long jobs.",
    priceLabel: "$22/mo",
    icon: Cloud,
  },
  {
    id: "premium-connectors-pack",
    title: "Enterprise Connectors Pack",
    description: "Salesforce, Jira, Notion, Confluence, Slack, and more.",
    priceLabel: "$30/mo",
    icon: Link2,
  },
  {
    id: "premium-meeting-intel",
    title: "Meeting Intelligence",
    description: "Calendar + transcript ingestion with action extraction.",
    priceLabel: "$16/mo",
    icon: Sparkles,
  },
  {
    id: "premium-voice-agent",
    title: "Voice/Phone Agent",
    description: "PSTN calling, voicemail workflows, and call summaries.",
    priceLabel: "$35/mo",
    icon: Sparkles,
  },
  {
    id: "premium-alert-ops",
    title: "Monitoring + Alert Ops",
    description: "Incident triage with Datadog, Grafana, and CloudWatch.",
    priceLabel: "$24/mo",
    icon: Cloud,
  },
  {
    id: "premium-compliance",
    title: "Specialist Compliance Agents",
    description: "SOC2/HIPAA/GDPR checks with evidence mapping.",
    priceLabel: "$39/mo",
    icon: ShieldCheck,
  },
  {
    id: "premium-finops",
    title: "FinOps/Cost Optimizer",
    description: "Cloud spend analytics and optimization suggestions.",
    priceLabel: "$21/mo",
    icon: Cloud,
  },
  {
    id: "premium-hitl",
    title: "Human-in-the-loop Workflow",
    description: "Approvals, escalation queues, and reviewer dashboards.",
    priceLabel: "$20/mo",
    icon: Sparkles,
  },
  {
    id: "premium-routing",
    title: "Model Routing Premium",
    description: "Policy-based orchestration with reliability SLAs.",
    priceLabel: "$17/mo",
    icon: Sparkles,
  },
  {
    id: "premium-org-analytics",
    title: "Org Analytics",
    description: "Usage, quality, latency, and cost dashboards by team.",
    priceLabel: "$14/mo",
    icon: Cloud,
  },
  {
    id: "premium-backup",
    title: "Backup/Restore + Versioned State",
    description: "Encrypted snapshots and cross-device rollback.",
    priceLabel: "$12/mo",
    icon: Cloud,
  },
] as const;

const BUSINESS_ANALYST_PREMIUM_SPEC = {
  tool_id: "premium-business-analyst",
  mode: "autonomous-long-run",
  estimated_runtime_hours: { min: 6, max: 24 },
  intake: {
    required_inputs: [
      "business_idea",
      "target_customer",
      "initial_geography",
      "product_scope",
      "risk_tolerance",
      "timeline_months",
      "capital_constraints",
    ],
    clarification_objectives: [
      "validate problem urgency",
      "quantify market potential",
      "define beachhead segment",
      "align near-term GTM with long-term defensibility under AI progress",
    ],
  },
  specialist_agents: [
    {
      id: "agent_market_research",
      role: "Market intelligence and TAM/SAM/SOM modeling",
      outputs: ["market_map", "segment_prioritization", "pricing_benchmarks"],
    },
    {
      id: "agent_economic_analysis",
      role: "Macroeconomic and industry-cycle assessment",
      outputs: ["macro_risks", "demand_sensitivity", "scenario_analysis"],
    },
    {
      id: "agent_ai_feasibility",
      role: "AI progress impact and moat durability analysis",
      outputs: ["automation_risk_map", "defensibility_strategy", "talent_requirements"],
    },
    {
      id: "agent_gtm_strategy",
      role: "Go-to-market planning and channel strategy",
      outputs: ["channel_plan", "sales_motion", "launch_sequence"],
    },
    {
      id: "agent_financial_modeling",
      role: "Unit economics and runway planning",
      outputs: ["3_year_model", "break_even_timeline", "capital_plan"],
    },
    {
      id: "agent_technical_roadmap",
      role: "Architecture and implementation roadmap",
      outputs: ["platform_plan", "milestone_map", "staffing_plan"],
    },
    {
      id: "agent_pitch_deck",
      role: "Narrative and investor-ready deck drafting",
      outputs: ["deck_outline", "slide_copy", "data_exhibits"],
    },
  ],
  external_data_sources: [
    { id: "data_gov", type: "federal_api", endpoint: "https://api.data.gov" },
    { id: "bls", type: "federal_api", endpoint: "https://api.bls.gov/publicAPI/v2" },
    { id: "bea", type: "federal_api", endpoint: "https://apps.bea.gov/api/data" },
    { id: "census", type: "federal_api", endpoint: "https://api.census.gov/data" },
    { id: "fred", type: "public_api", endpoint: "https://api.stlouisfed.org/fred" },
    { id: "saas_ma_database", type: "public_dataset", endpoint: "https://softwareequity.com/saas-ma-deal-database" },
  ],
  deliverables: [
    "comprehensive_business_plan",
    "market_analysis_report",
    "economic_feasibility_report",
    "ai_progress_feasibility_assessment",
    "go_to_market_plan",
    "technical_roadmap",
    "investor_pitch_deck",
    "risk_register_with_mitigation_plan",
  ],
};

export function ToolsPanel() {
  const {
    enabledToolIds,
    optionalTools,
    isToolEnabled,
    setToolEnabled,
    installOptionalTool,
    uninstallOptionalTool,
    setOptionalToolEnabled,
  } = useToolCatalogStore();
  const [showToolsJson, setShowToolsJson] = useState(false);
  const [showAllPremium, setShowAllPremium] = useState(false);
  const [showBusinessAnalystSpec, setShowBusinessAnalystSpec] = useState(false);
  const [selectedPremiumToolId, setSelectedPremiumToolId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const visiblePremiumTools = showAllPremium ? PREMIUM_TOOLS : PREMIUM_TOOLS.slice(0, 10);
  const { entitlements } = usePremiumStore();

  const hiddenOptionalToolIds = useMemo(
    () =>
      new Set(
        optionalTools
          .filter((tool) => !tool.installed && tool.linkedToolId)
          .map((tool) => tool.linkedToolId as string)
      ),
    [optionalTools]
  );
  const visibleOptionalTools = useMemo(
    () => optionalTools.filter((tool) => tool.id !== "premium-business-analyst"),
    [optionalTools]
  );
  const allHostedTools = useMemo(
    () => getAllToolManifests().filter((tool) => !hiddenOptionalToolIds.has(tool.id)),
    [hiddenOptionalToolIds]
  );
  const activeTools = useMemo(
    () => allHostedTools.filter((tool) => enabledToolIds.includes(tool.id)),
    [allHostedTools, enabledToolIds]
  );
  const sortedHostedTools = useMemo(
    () =>
      [...allHostedTools].sort((a, b) => {
        const pinnedOrder: Record<string, number> = {
          serve: 0,
          tools: 1,
        };
        const aPinned = pinnedOrder[a.id];
        const bPinned = pinnedOrder[b.id];
        if (aPinned != null || bPinned != null) {
          if (aPinned == null) return 1;
          if (bPinned == null) return -1;
          if (aPinned !== bPinned) return aPinned - bPinned;
        }
        const aRequired = REQUIRED_TOOL_IDS.has(a.id) ? 0 : 1;
        const bRequired = REQUIRED_TOOL_IDS.has(b.id) ? 0 : 1;
        if (aRequired !== bRequired) return aRequired - bRequired;
        return a.title.localeCompare(b.title);
      }),
    [allHostedTools]
  );

  const toolsJson = useMemo(
    () =>
      JSON.stringify(
        {
          active_tools: activeTools.map((tool) => ({
            id: tool.id,
            title: tool.title,
            description: tool.description,
            category: tool.category,
            mode: tool.defaultMode,
            allowed_modes: tool.allowedModes,
            core: tool.core,
          })),
          optional_tools: optionalTools.map((tool) => ({
            id: tool.id,
            title: tool.title,
            description: tool.description,
            source: tool.source,
            repo: tool.repo ?? null,
            installed: tool.installed,
            enabled: tool.enabled,
            linked_tool_id: tool.linkedToolId ?? null,
          })),
        },
        null,
        2
      ),
    [activeTools, optionalTools]
  );

  const copyToolsJson = async () => {
    try {
      await navigator.clipboard.writeText(toolsJson);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1200);
  };
  const businessPremiumOptional = optionalTools.find((tool) => tool.id === "premium-business-analyst") ?? null;
  const selectedPremiumTool = PREMIUM_TOOLS.find((tool) => tool.id === selectedPremiumToolId) ?? null;

  return (
    <PanelWrapper
      title={(
        <span className="inline-flex items-center gap-2">
          <span>Tools</span>
          <span className="text-[11px] text-text-med">Active {activeTools.length}</span>
          <span className="text-text-dark">|</span>
          <span className="text-[11px] text-text-med">Optional {visibleOptionalTools.length}</span>
        </span>
      )}
      icon={<Boxes size={16} className="text-accent-primary" />}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-3 pb-2">
            <div className="text-[10px] uppercase tracking-wider text-text-dark mb-2">Active Tools</div>
            <div className="rounded border border-line-med bg-line-light overflow-hidden">
              {sortedHostedTools.map((tool) => {
                const enabled = isToolEnabled(tool.id);
                const required = REQUIRED_TOOL_IDS.has(tool.id);
                const showUnderDevelopmentTag = tool.id === "notes" || tool.id === "extensions" || tool.id === "project";
                const Icon = tool.icon;
                return (
                  <div
                    key={tool.id}
                    className="flex items-center justify-between px-3 py-2 border-b border-line-light last:border-b-0"
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      {Icon ? <Icon size={12} className="text-text-dark flex-shrink-0" /> : null}
                      <div className="text-xs font-medium text-text-norm truncate">{tool.title}</div>
                      {showUnderDevelopmentTag && (
                        <span className="text-[10px] text-amber-300 whitespace-nowrap">(Under development)</span>
                      )}
                      {(tool.core || required) && <ShieldCheck size={11} className="text-accent-primary/90 flex-shrink-0" />}
                      <span className="text-[10px] text-text-dark truncate">{tool.description}</span>
                    </div>
                    <button
                      onClick={() => !required && setToolEnabled(tool.id, !enabled)}
                      disabled={required}
                      className={cn(
                        "ml-2 px-2 py-1 rounded text-[10px] transition-colors inline-flex items-center gap-1",
                        required
                          ? "border border-line-dark bg-transparent text-text-med"
                          : enabled
                          ? "bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
                          : "bg-line-med text-text-dark hover:text-text-med",
                        required && "cursor-default"
                      )}
                    >
                      {required ? (
                        "Required"
                      ) : (
                        <>
                          {enabled ? <Power size={10} /> : <PowerOff size={10} />}
                          {enabled ? "Enabled" : "Disabled"}
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="px-3 pb-3">
            <div className="text-[10px] uppercase tracking-wider text-text-dark mb-2">Optional Tools</div>
            <div className="rounded border border-line-med bg-line-light overflow-hidden">
              {visibleOptionalTools.map((tool) => (
                <div
                  key={tool.id}
                  className="px-3 py-2 border-b border-line-light last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <Download size={11} className="text-text-dark flex-shrink-0" />
                      <div className="text-xs font-medium text-text-norm truncate">{tool.title}</div>
                      <span className="text-[10px] text-text-dark truncate">{tool.description}</span>
                      <div className="text-[10px] text-text-dark truncate">
                        {tool.source === "github" ? "github" : "local"}{tool.repo ? ` · ${tool.repo}` : ""}
                      </div>
                    </div>
                    {!tool.installed ? (
                      <button
                        onClick={() => installOptionalTool(tool.id)}
                        className="px-2 py-1 rounded text-[10px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors inline-flex items-center gap-1"
                      >
                        <Download size={10} />
                        Install
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setOptionalToolEnabled(tool.id, !tool.enabled)}
                          className={cn(
                            "px-2 py-1 rounded text-[10px] transition-colors",
                            tool.enabled
                              ? "bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
                              : "bg-line-med text-text-med hover:text-text-norm"
                          )}
                        >
                          {tool.enabled ? "Enabled" : "Disabled"}
                        </button>
                        <button
                          onClick={() => uninstallOptionalTool(tool.id)}
                          className="px-2 py-1 rounded text-[10px] bg-accent-red/12 text-accent-red hover:bg-accent-red/20 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="px-3 pb-3">
            <div className="text-[10px] uppercase tracking-wider text-accent-gold/75 mb-2">Premium Tools</div>
            <div className="rounded border border-accent-gold/20 bg-accent-gold/[0.06] overflow-hidden">
              {visiblePremiumTools.map((tool) => {
                const Icon = tool.icon;
                const isBusinessTool = tool.id === "premium-business-analyst";
                return (
                  <div
                    key={tool.id}
                    className="flex items-center justify-between px-3 py-2 border-b border-accent-gold/15 last:border-b-0 cursor-pointer hover:bg-accent-gold/5 transition-colors"
                    onClick={() => setSelectedPremiumToolId(tool.id)}
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <Icon size={12} className="text-accent-gold/80 flex-shrink-0" />
                      <div className="text-xs font-medium text-accent-gold/90 truncate">{tool.title}</div>
                      <span className="text-[10px] text-accent-gold/65 truncate">{tool.description}</span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-2">
                      <span className="text-[10px] text-accent-gold/85">{tool.priceLabel}</span>
                      <button
                        onClick={() => setSelectedPremiumToolId(tool.id)}
                        className="px-2 py-1 rounded text-[10px] bg-accent-gold/20 text-accent-gold hover:bg-accent-gold/30 transition-colors"
                        title={isBusinessTool ? "Requires payment" : "Coming soon"}
                      >
                        {isBusinessTool ? (
                          businessPremiumOptional?.installed || entitlements.business_analyst?.active
                            ? "Unlocked"
                            : "Unlock"
                        ) : (
                          "Coming soon"
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {PREMIUM_TOOLS.length > 10 && (
              <button
                onClick={() => setShowAllPremium((v) => !v)}
                className="mt-2 text-[10px] text-accent-gold/80 hover:text-accent-gold underline underline-offset-2"
              >
                {showAllPremium ? "View less" : "View more"}
              </button>
            )}
            <button
              onClick={() => setShowBusinessAnalystSpec((v) => !v)}
              className="ml-3 mt-2 text-[10px] text-accent-gold/80 hover:text-accent-gold underline underline-offset-2"
            >
              {showBusinessAnalystSpec ? "Hide Business Analyst spec" : "Show Business Analyst spec"}
            </button>
            {showBusinessAnalystSpec && (
              <pre className="mt-2 max-h-40 overflow-auto rounded border border-accent-gold/20 bg-black/20 p-2 text-[10px] leading-4 text-accent-gold/90">
                {JSON.stringify(BUSINESS_ANALYST_PREMIUM_SPEC, null, 2)}
              </pre>
            )}
          </div>
        </div>

        <div className="border-t border-line-light bg-black/20">
          <div className="flex items-center justify-between px-3 py-1.5">
            <button
              onClick={() => setShowToolsJson((v) => !v)}
              className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-text-med hover:text-text-norm transition-colors"
              title="Toggle tools JSON"
            >
              {showToolsJson ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
              Tools JSON
            </button>
            <button
              onClick={() => void copyToolsJson()}
              className="px-1.5 py-0.5 rounded text-[10px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
            >
              {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy"}
            </button>
          </div>
          {showToolsJson && (
            <textarea
              readOnly
              aria-label="Tools JSON"
              value={toolsJson}
              className="mx-2 mb-2 block w-[calc(100%-1rem)] max-h-32 min-h-24 rounded bg-black/30 p-2 text-[10px] leading-4 text-accent-green/90 font-mono outline-none resize-y"
            />
          )}
        </div>
      </div>
      <PremiumToolModal
        open={Boolean(selectedPremiumTool)}
        onClose={() => setSelectedPremiumToolId(null)}
        tool={selectedPremiumTool
          ? {
              key: selectedPremiumTool.id === "premium-business-analyst" ? "business_analyst" : null,
              title: selectedPremiumTool.title,
              description: selectedPremiumTool.description,
              priceLabel: selectedPremiumTool.id === "premium-business-analyst" ? "$29/month" : selectedPremiumTool.priceLabel,
              quotaLabel:
                selectedPremiumTool.id === "premium-business-analyst"
                  ? "Up to 5 reports per billing month"
                  : "Not yet available",
              comingSoon: selectedPremiumTool.id !== "premium-business-analyst",
            }
          : null}
      />
    </PanelWrapper>
  );
}
