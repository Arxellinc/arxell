import { listen } from "@tauri-apps/api/event";
import {
  Plus,
  Save,
  Play,
  Network,
  Trash2,
  Link2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  TestTube2,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  Pencil,
  FolderPlus,
  PlusSquare,
  Menu,
  FolderOpen,
  Copy,
  Upload,
  Download,
  X,
  Zap,
  GitBranch,
  Globe,
  Pause,
  Square,
  Wrench,
  Database,
  Bot,
  Check,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../../lib/utils";
import {
  a2aNodeTypeList,
  a2aTemplateCreate,
  a2aTemplateDelete,
  a2aTemplateList,
  a2aWorkflowCreate,
  a2aWorkflowDelete,
  a2aWorkflowGet,
  a2aWorkflowList,
  a2aWorkflowNodeTest,
  a2aWorkflowRunGet,
  a2aWorkflowRunList,
  a2aWorkflowRunCancel,
  a2aWorkflowRunPause,
  a2aWorkflowRunResume,
  a2aWorkflowPreflight,
  a2aWorkflowRunStart,
  a2aWorkflowUpdate,
  memoryList,
  skillsList,
  type A2AExecutionItem,
  type A2ANodeTypeDef,
  type MemoryEntry,
  type SkillMeta,
  type A2AWorkflowDefinition,
  type A2AWorkflowEdge,
  type A2AWorkflowGroup,
  type A2AWorkflowNode,
  type A2ATemplateRecord,
  type A2AWorkflowRecord,
  type A2AWorkflowRunDetail,
  type A2AWorkflowRunRecord,
} from "../../../lib/tauri";
import { getAllToolManifests } from "../../../core/tooling/registry";
import { useFlowExecutionStore } from "../../../store/flowExecutionStore";
import { useToolCatalogStore } from "../../../store/toolCatalogStore";
import { useFlowWorkflowStore } from "../../../store/flowWorkflowStore";
import { PanelWrapper } from "./shared";

const GRID_STEP = 10;
const GRID_W = 1200;
const GRID_H = 1200;
const NODE_W = 180;
const NODE_H = 88;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
const ZOOM_INCREMENT = 0.125;
const GRID_TARGET_PIXEL_SPACING = 18;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function snap(v: number) {
  return Math.round(v / GRID_STEP) * GRID_STEP;
}

function quantizeZoom(v: number) {
  const snapped = Math.round(v / ZOOM_INCREMENT) * ZOOM_INCREMENT;
  return clamp(snapped, MIN_ZOOM, MAX_ZOOM);
}

function formatZoomPercent(zoom: number) {
  const percent = clamp(zoom, MIN_ZOOM, MAX_ZOOM) * 100;
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`;
}

function normalizeGroups(nodes: A2AWorkflowNode[], groups?: A2AWorkflowGroup[]) {
  // Keep grouping organizational and resilient across import/export/version drift:
  // merge explicit group.node_ids with per-node group_id and drop missing-node refs.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const explicit = (Array.isArray(groups) ? groups : [])
    .map((g) => ({
      id: g.id,
      label: g.label || "Group",
      color: g.color,
      node_ids: Array.from(
        new Set((Array.isArray(g.node_ids) ? g.node_ids : []).filter((id) => nodeIds.has(id)))
      ),
    }));

  const byId = new Map<string, A2AWorkflowGroup>();
  const order: string[] = [];
  for (const group of explicit) {
    if (!group.id) continue;
    byId.set(group.id, group);
    order.push(group.id);
  }

  for (const node of nodes) {
    const groupId = typeof node.group_id === "string" ? node.group_id.trim() : "";
    if (!groupId) continue;
    if (!byId.has(groupId)) {
      byId.set(groupId, {
        id: groupId,
        label: "Group",
        color: "rgba(56,189,248,0.12)",
        node_ids: [],
      });
      order.push(groupId);
    }
    const group = byId.get(groupId)!;
    if (!group.node_ids.includes(node.id)) group.node_ids.push(node.id);
  }

  return order
    .map((id) => byId.get(id))
    .filter((g): g is A2AWorkflowGroup => Boolean(g))
    .map((g) => ({ ...g, node_ids: g.node_ids.filter((id) => nodeIds.has(id)) }))
    .filter((g) => g.node_ids.length > 0);
}

function normalizeNodesWithPositions(nodes: A2AWorkflowNode[]) {
  return (Array.isArray(nodes) ? nodes : []).map((node, index) => {
    const groupId =
      typeof node.group_id === "string" && node.group_id.trim().length > 0
        ? node.group_id.trim()
        : undefined;
    const raw = node.position;
    const hasValidPosition =
      raw &&
      Number.isFinite(raw.x) &&
      Number.isFinite(raw.y);
    if (hasValidPosition) {
      return {
        ...node,
        group_id: groupId,
        position: {
          x: clamp(snap(raw.x), 0, GRID_W - NODE_W),
          y: clamp(snap(raw.y), 0, GRID_H - NODE_H),
        },
      };
    }
    // Back-compat and resilience: if a saved workflow/node lacks coordinates,
    // assign a stable fallback layout so restart/load never stacks nodes at 0,0.
    const col = index % 4;
    const row = Math.floor(index / 4);
    return {
      ...node,
      group_id: groupId,
      position: {
        x: 80 + col * 260,
        y: 120 + row * 180,
      },
    };
  });
}

function parseDefinition(row: A2AWorkflowRecord): A2AWorkflowDefinition {
  try {
    const parsed = JSON.parse(row.definition_json) as A2AWorkflowDefinition;
    const rawNodes = normalizeNodesWithPositions(Array.isArray(parsed.nodes) ? parsed.nodes : []);
    const membership = new Map<string, string>();
    for (const group of Array.isArray(parsed.groups) ? parsed.groups : []) {
      const groupId = typeof group.id === "string" ? group.id.trim() : "";
      if (!groupId) continue;
      for (const nodeId of Array.isArray(group.node_ids) ? group.node_ids : []) {
        if (!membership.has(nodeId)) membership.set(nodeId, groupId);
      }
    }
    const nodes = rawNodes.map((node) => {
      if (node.group_id) return node;
      const groupId = membership.get(node.id);
      return groupId ? { ...node, group_id: groupId } : node;
    });
    const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
    return {
      workflow_id: row.workflow_id,
      name: row.name,
      active: row.active,
      version: row.version,
      nodes,
      edges,
      groups: normalizeGroups(nodes, parsed.groups),
    };
  } catch {
    return {
      workflow_id: row.workflow_id,
      name: row.name,
      active: row.active,
      version: row.version,
      nodes: [],
      edges: [],
      groups: [],
    };
  }
}

function sanitizeDefinition(raw: Partial<A2AWorkflowDefinition>, fallbackName = "Template"): A2AWorkflowDefinition {
  const rawNodes = normalizeNodesWithPositions(Array.isArray(raw.nodes) ? raw.nodes : []);
  const membership = new Map<string, string>();
  for (const group of Array.isArray(raw.groups) ? raw.groups : []) {
    const groupId = typeof group.id === "string" ? group.id.trim() : "";
    if (!groupId) continue;
    for (const nodeId of Array.isArray(group.node_ids) ? group.node_ids : []) {
      if (!membership.has(nodeId)) membership.set(nodeId, groupId);
    }
  }
  const nodes = rawNodes.map((node) => {
    if (node.group_id) return node;
    const groupId = membership.get(node.id);
    return groupId ? { ...node, group_id: groupId } : node;
  });
  const edges = Array.isArray(raw.edges) ? raw.edges : [];
  return {
    workflow_id: typeof raw.workflow_id === "string" ? raw.workflow_id : "",
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : fallbackName,
    active: Boolean(raw.active),
    version: typeof raw.version === "number" ? raw.version : 1,
    nodes,
    edges,
    groups: normalizeGroups(nodes, raw.groups),
  };
}

function centerOf(node: A2AWorkflowNode): { x: number; y: number } {
  const p = node.position ?? { x: 0, y: 0 };
  return { x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 };
}

type PortSide = "left" | "right" | "top" | "bottom";
type PortShape = "circle" | "square";
type PortRole = "flow" | "agent" | "memory" | "skills" | "tools";
type PortDirection = "in" | "out" | "both";

interface NodePortDef {
  id: string;
  label: string;
  side: PortSide;
  index: number;
  count: number;
  shape: PortShape;
  symbol: string;
  role: PortRole;
  direction: PortDirection;
  maxConnections: number;
}

interface PendingConnection {
  sourceNodeId: string;
  sourcePortId: string;
}

type ConnectorRole = "memory" | "skills" | "tools";

interface ConnectorPickerState {
  nodeId: string;
  role: ConnectorRole;
  x: number;
  y: number;
}

interface MemoryRefBinding {
  namespace: string;
  key: string;
}

interface OpenWorkflowTab {
  tabId: string;
  workflowId: string;
  title: string;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  build: (name: string) => A2AWorkflowDefinition;
}

interface LibraryTemplateEntry {
  id: string;
  name: string;
  description: string;
  source: "builtin" | "custom";
  build: (name: string) => A2AWorkflowDefinition;
}

interface NodeLibraryItem {
  type: string;
  name: string;
  templateParams: Record<string, unknown>;
}

interface NodeLibrarySection {
  id: string;
  title: string;
  items: NodeLibraryItem[];
}

type CanvasContextMenu =
  | { kind: "node"; nodeId: string; x: number; y: number }
  | { kind: "group"; groupId: string; x: number; y: number }
  | { kind: "canvas"; x: number; y: number };

function defaultDefinition(name = "New Workflow"): A2AWorkflowDefinition {
  const nodes: A2AWorkflowNode[] = [
    {
      id: "n_manual",
      type: "trigger.manual",
      name: "Manual Trigger",
      params: {},
      position: { x: 80, y: 120 },
    },
    {
      id: "n_map",
      type: "transform.map",
      name: "Map",
      params: { fields: { message: "{{ $json.message }}" } },
      position: { x: 340, y: 120 },
    },
    {
      id: "n_out",
      type: "output.respond",
      name: "Output",
      params: {},
      position: { x: 620, y: 120 },
    },
  ];
  return {
    workflow_id: "",
    name,
    active: false,
    version: 1,
    nodes,
    edges: [
      {
        id: "e_1",
        source: "n_manual",
        source_output: "main",
        target: "n_map",
        target_input: "main",
      },
      {
        id: "e_2",
        source: "n_map",
        source_output: "main",
        target: "n_out",
        target_input: "main",
      },
    ],
    groups: [
      {
        id: "g_default",
        label: "Main Group",
        color: "rgba(56,189,248,0.12)",
        node_ids: nodes.map((n) => n.id),
      },
    ],
  };
}

function singleAgentQueryDefinition(name = "Single-Agent Query"): A2AWorkflowDefinition {
  const nodes: A2AWorkflowNode[] = [
    {
      id: "n_manual",
      type: "trigger.manual",
      name: "Manual Trigger",
      params: {},
      position: { x: 80, y: 140 },
    },
    {
      id: "n_query",
      type: "llm.query",
      name: "Query LLM",
      params: { prompt: "{{ $json.question }}" },
      position: { x: 350, y: 140 },
    },
    {
      id: "n_out",
      type: "output.respond",
      name: "Output",
      params: {},
      position: { x: 640, y: 140 },
    },
  ];
  return {
    workflow_id: "",
    name,
    active: false,
    version: 1,
    nodes,
    edges: [
      {
        id: "e_1",
        source: "n_manual",
        source_output: "main",
        target: "n_query",
        target_input: "main",
      },
      {
        id: "e_2",
        source: "n_query",
        source_output: "main",
        target: "n_out",
        target_input: "main",
      },
    ],
    groups: [
      {
        id: "g_default",
        label: "Main Group",
        color: "rgba(56,189,248,0.12)",
        node_ids: nodes.map((n) => n.id),
      },
    ],
  };
}

function codingRalphLoopDefinition(name = "Coding Ralph Loop"): A2AWorkflowDefinition {
  const nodes: A2AWorkflowNode[] = [
    {
      id: "n_manual",
      type: "trigger.manual",
      name: "Manual Trigger",
      params: {},
      position: { x: 80, y: 180 },
    },
    {
      id: "n_architect",
      type: "ai.agent",
      name: "Architect Manager",
      params: {
        text: "{{ $json.task || $json.question || 'Plan implementation' }}",
        maxIterations: 6,
      },
      position: { x: 360, y: 120 },
    },
    {
      id: "n_impl",
      type: "ai.agent",
      name: "Implementer",
      params: {
        text: "{{ $node[\"Architect Manager\"].json.agent_prompt_user }}",
        maxIterations: 8,
      },
      position: { x: 640, y: 120 },
    },
    {
      id: "n_test",
      type: "ai.agent",
      name: "Tester",
      params: {
        text: "Validate implementation quality and identify defects.",
        maxIterations: 6,
      },
      position: { x: 920, y: 120 },
    },
    {
      id: "n_review",
      type: "llm.query",
      name: "Reviewer",
      params: {
        prompt:
          "Summarize architecture, implementation, tests, and residual risks from prior stages.",
      },
      position: { x: 1200, y: 120 },
    },
    {
      id: "n_out",
      type: "output.respond",
      name: "Output",
      params: {},
      position: { x: 1460, y: 120 },
    },
  ];

  return {
    workflow_id: "",
    name,
    active: false,
    version: 1,
    nodes,
    edges: [
      { id: "e_1", source: "n_manual", source_output: "main", target: "n_architect", target_input: "main" },
      { id: "e_2", source: "n_architect", source_output: "main", target: "n_impl", target_input: "main" },
      { id: "e_3", source: "n_impl", source_output: "main", target: "n_test", target_input: "main" },
      { id: "e_4", source: "n_test", source_output: "main", target: "n_review", target_input: "main" },
      { id: "e_5", source: "n_review", source_output: "main", target: "n_out", target_input: "main" },
    ],
    groups: [
      {
        id: "g_ralph",
        label: "Ralph Loop",
        color: "rgba(56,189,248,0.12)",
        node_ids: nodes.map((n) => n.id),
      },
    ],
  };
}

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "tpl_blank",
    name: "Blank Workflow",
    description: "Manual trigger -> map -> output",
    build: (name) => defaultDefinition(name),
  },
  {
    id: "tpl_single_query",
    name: "Single-Agent Query",
    description: "Manual trigger -> LLM query -> output",
    build: (name) => singleAgentQueryDefinition(name),
  },
  {
    id: "tpl_coding_ralph_loop",
    name: "Coding Ralph Loop",
    description: "Architect -> implement -> test -> review",
    build: (name) => codingRalphLoopDefinition(name),
  },
];

function nodeLibraryIcon(nodeType: string) {
  if (nodeType === "ai.agent") return <Bot size={12} />;
  if (nodeType.startsWith("trigger.")) return <Zap size={12} />;
  if (nodeType.startsWith("core.")) return <GitBranch size={12} />;
  if (nodeType.startsWith("transform.")) return <PlusSquare size={12} />;
  if (nodeType.startsWith("logic.")) return <GitBranch size={12} />;
  if (nodeType.startsWith("http.") || nodeType.startsWith("util.http")) return <Globe size={12} />;
  if (nodeType.startsWith("util.")) return <Wrench size={12} />;
  if (nodeType.startsWith("db.")) return <Database size={12} />;
  if (nodeType.startsWith("ai.")) return <Bot size={12} />;
  if (nodeType.startsWith("llm.")) return <Bot size={12} />;
  if (nodeType.startsWith("tool.")) return <Wrench size={12} />;
  if (nodeType.startsWith("memory.")) return <Database size={12} />;
  if (nodeType.startsWith("skill.")) return <FolderPlus size={12} />;
  if (nodeType.startsWith("output.")) return <Upload size={12} />;
  return <PlusSquare size={12} />;
}

function templateIcon(templateId: string) {
  if (templateId === "tpl_coding_ralph_loop") return <GitBranch size={12} />;
  if (templateId === "tpl_single_query") return <Bot size={12} />;
  return <PlusSquare size={12} />;
}

function librarySectionIcon(sectionId: string) {
  if (sectionId === "primary") return <Bot size={11} />;
  if (sectionId === "templates") return <FolderOpen size={11} />;
  if (sectionId === "runs") return <Play size={11} />;
  if (sectionId === "triggers") return <Zap size={11} />;
  if (sectionId === "flow_control") return <GitBranch size={11} />;
  if (sectionId === "transform") return <PlusSquare size={11} />;
  if (sectionId === "utility") return <Wrench size={11} />;
  if (sectionId === "datastore") return <Database size={11} />;
  if (sectionId === "ai") return <Bot size={11} />;
  if (sectionId === "outputs") return <Upload size={11} />;
  return <PlusSquare size={11} />;
}

const NODE_LIBRARY_SECTIONS: NodeLibrarySection[] = [
  {
    id: "primary",
    title: "Primary",
    items: [
      { type: "ai.agent", name: "Agent", templateParams: { text: "{{ $json.question }}", maxIterations: 3 } },
    ],
  },
  {
    id: "triggers",
    title: "Triggers",
    items: [
      { type: "trigger.manual", name: "Manual Trigger", templateParams: {} },
      { type: "trigger.schedule", name: "Schedule Trigger", templateParams: { rule: "interval", amount: 5, unit: "minutes" } },
      { type: "trigger.webhook", name: "Webhook Trigger", templateParams: { httpMethod: "POST", path: "flow-webhook" } },
      { type: "trigger.error", name: "Error Trigger", templateParams: {} },
    ],
  },
  {
    id: "flow_control",
    title: "Flow Control",
    items: [
      { type: "logic.if", name: "IF", templateParams: { conditions: [{ value1: "{{ $json.flag }}", operation: "isTrue" }], combineConditions: "all" } },
      { type: "logic.switch", name: "Switch", templateParams: { mode: "rules", value: "{{ $json.type }}", rules: [{ value: "a", outputIndex: 0 }, { value: "b", outputIndex: 1 }], fallbackOutput: 2 } },
      { type: "core.merge", name: "Merge", templateParams: { mode: "append" } },
      { type: "core.split_in_batches", name: "Split In Batches", templateParams: { batchSize: 10 } },
      { type: "core.noop", name: "NoOp", templateParams: {} },
      { type: "core.stop_and_error", name: "Stop And Error", templateParams: { errorMessage: "Stopped by flow" } },
      { type: "core.wait", name: "Wait", templateParams: { resume: "timeInterval", amount: 5, unit: "seconds" } },
    ],
  },
  {
    id: "transform",
    title: "Data Transform",
    items: [
      { type: "transform.set", name: "Set", templateParams: { includeOtherFields: true, fields: { result: "{{ $json.value }}" } } },
      { type: "transform.map", name: "Map", templateParams: { fields: { value: "{{ $json.value }}" } } },
      { type: "transform.filter", name: "Filter", templateParams: { conditions: [{ value1: "{{ $json.value }}", operation: "isNotEmpty" }], combineConditions: "all" } },
      { type: "transform.sort", name: "Sort", templateParams: { sortField: { fieldName: "id", order: "ascending" } } },
      { type: "transform.limit", name: "Limit", templateParams: { maxItems: 10, keep: "firstItems" } },
      { type: "transform.remove_duplicates", name: "Remove Duplicates", templateParams: { compare: "selectedFields", fields: ["id"] } },
      { type: "transform.aggregate", name: "Aggregate", templateParams: { aggregate: "aggregateAllItemData", destinationField: "items" } },
      { type: "transform.summarize", name: "Summarize", templateParams: { fieldsToSplitBy: ["category"], fieldsToSummarize: [{ aggregation: "count", field: "id", outputField: "count" }] } },
      { type: "transform.rename_keys", name: "Rename Keys", templateParams: { keys: [{ currentKey: "old", newKey: "new" }] } },
      { type: "transform.compare_datasets", name: "Compare Datasets", templateParams: { mergeByFields: [{ fieldInput1: "id", fieldInput2: "id" }] } },
      { type: "transform.item_lists", name: "Item Lists", templateParams: { operation: "splitOutItems", fieldToSplitOut: "items" } },
    ],
  },
  {
    id: "utility",
    title: "Utility",
    items: [
      { type: "util.http_request", name: "HTTP Request", templateParams: { method: "GET", url: "https://example.com" } },
      { type: "util.respond_to_webhook", name: "Respond To Webhook", templateParams: { responseCode: 200 } },
      { type: "util.read_write_file", name: "Read/Write File", templateParams: { operation: "read", filePath: "/tmp/flow.txt" } },
      { type: "util.crypto", name: "Crypto", templateParams: { action: "hash", value: "{{ $json.value }}", dataPropertyName: "hash" } },
      { type: "util.datetime", name: "DateTime", templateParams: { action: "getCurrentTime" } },
      { type: "util.execute_workflow", name: "Execute Workflow", templateParams: { workflowId: "" } },
      { type: "util.send_email", name: "Send Email", templateParams: { credentialId: "", to: "", subject: "", text: "" } },
      { type: "util.sticky_note", name: "Sticky Note", templateParams: { content: "Add notes here" } },
    ],
  },
  {
    id: "datastore",
    title: "Data Stores",
    items: [
      { type: "db.sqlite", name: "SQLite", templateParams: { operation: "executeQuery", query: "SELECT 1 as ok" } },
      { type: "db.postgres", name: "Postgres", templateParams: { credentialId: "", operation: "executeQuery", query: "SELECT NOW()" } },
      { type: "db.mysql", name: "MySQL", templateParams: { credentialId: "", operation: "executeQuery", query: "SELECT NOW()" } },
      { type: "db.mariadb", name: "MariaDB", templateParams: { credentialId: "", operation: "executeQuery", query: "SELECT NOW()" } },
      { type: "db.mssql", name: "Microsoft SQL", templateParams: { credentialId: "", operation: "executeQuery", query: "SELECT GETDATE()" } },
      { type: "db.redis", name: "Redis", templateParams: { credentialId: "", operation: "get", key: "sample" } },
      { type: "db.mongodb", name: "MongoDB", templateParams: { credentialId: "", operation: "find", database: "", collection: "items", query: {} } },
    ],
  },
  {
    id: "ai",
    title: "AI Components",
    items: [
      { type: "llm.query", name: "LLM Query", templateParams: { prompt: "{{ $json.question }}" } },
      { type: "ai.chat_model", name: "Chat Model", templateParams: { model: "gpt-4o-mini", temperature: 0.3 } },
      { type: "ai.memory", name: "Memory Connector", templateParams: { sessionId: "{{ $json.sessionId }}", contextWindowLength: 8 } },
      { type: "ai.tool", name: "Tool Connector", templateParams: { description: "Callable tool" } },
      { type: "tool.invoke", name: "Tool Invoke", templateParams: { action: "skills.list" } },
      { type: "memory.read", name: "Memory Read", templateParams: { namespace: "user" } },
      { type: "memory.write", name: "Memory Write", templateParams: { namespace: "user" } },
      { type: "skill.run", name: "Skill Run", templateParams: { mode: "list" } },
    ],
  },
  {
    id: "outputs",
    title: "Outputs",
    items: [
      { type: "output.respond", name: "Output", templateParams: {} },
    ],
  },
];
const NODE_LIBRARY: NodeLibraryItem[] = NODE_LIBRARY_SECTIONS.flatMap((section) => section.items);
const NODE_DRAG_MIME = "application/x-a2a-node-template";

const NODE_PORTS: NodePortDef[] = [
  { id: "flow_in_1", label: "Input 1", side: "left", index: 0, count: 3, shape: "circle", symbol: ">", role: "flow", direction: "in", maxConnections: 1 },
  { id: "flow_in_2", label: "Input 2", side: "left", index: 1, count: 3, shape: "circle", symbol: ">", role: "flow", direction: "in", maxConnections: 1 },
  { id: "flow_in_3", label: "Input 3", side: "left", index: 2, count: 3, shape: "circle", symbol: ">", role: "flow", direction: "in", maxConnections: 1 },
  { id: "flow_out_1", label: "Output 1", side: "right", index: 0, count: 3, shape: "circle", symbol: ">", role: "flow", direction: "out", maxConnections: 12 },
  { id: "flow_out_2", label: "Output 2", side: "right", index: 1, count: 3, shape: "circle", symbol: ">", role: "flow", direction: "out", maxConnections: 12 },
  { id: "flow_out_3", label: "Output 3", side: "right", index: 2, count: 3, shape: "circle", symbol: ">", role: "flow", direction: "out", maxConnections: 12 },
  { id: "agent_1", label: "Agent Link 1", side: "top", index: 0, count: 3, shape: "square", symbol: "+", role: "agent", direction: "both", maxConnections: 6 },
  { id: "agent_2", label: "Agent Link 2", side: "top", index: 1, count: 3, shape: "square", symbol: "+", role: "agent", direction: "both", maxConnections: 6 },
  { id: "agent_3", label: "Agent Link 3", side: "top", index: 2, count: 3, shape: "square", symbol: "+", role: "agent", direction: "both", maxConnections: 6 },
  { id: "memory_1", label: "Memory", side: "bottom", index: 0, count: 3, shape: "square", symbol: "◆", role: "memory", direction: "in", maxConnections: 1 },
  { id: "skills_1", label: "Skills", side: "bottom", index: 1, count: 3, shape: "square", symbol: "◆", role: "skills", direction: "in", maxConnections: 1 },
  { id: "tools_1", label: "Tools", side: "bottom", index: 2, count: 3, shape: "square", symbol: "◆", role: "tools", direction: "in", maxConnections: 1 },
];

const PORT_BY_ID = new Map(NODE_PORTS.map((port) => [port.id, port]));

function supportsOut(direction: PortDirection) {
  return direction === "out" || direction === "both";
}

function supportsIn(direction: PortDirection) {
  return direction === "in" || direction === "both";
}

function getDefaultPortIdForLegacy(kind: "source" | "target") {
  return kind === "source" ? "flow_out_2" : "flow_in_2";
}

function getPortById(portId: string, kind: "source" | "target"): NodePortDef | null {
  // Back-compat: older saved workflows may still use "main" pins.
  if (PORT_BY_ID.has(portId)) return PORT_BY_ID.get(portId) ?? null;
  if (portId === "main") {
    return PORT_BY_ID.get(getDefaultPortIdForLegacy(kind)) ?? null;
  }
  return null;
}

function countPortConnections(edges: A2AWorkflowEdge[], nodeId: string, portId: string, endpoint: "source" | "target") {
  if (endpoint === "source") {
    return edges.filter((edge) => edge.source === nodeId && edge.source_output === portId).length;
  }
  return edges.filter((edge) => edge.target === nodeId && edge.target_input === portId).length;
}

function totalPortConnections(edges: A2AWorkflowEdge[], nodeId: string, portId: string) {
  return (
    countPortConnections(edges, nodeId, portId, "source") +
    countPortConnections(edges, nodeId, portId, "target")
  );
}

function isConnectionCompatible(sourcePort: NodePortDef, targetPort: NodePortDef) {
  return supportsOut(sourcePort.direction) && supportsIn(targetPort.direction) && sourcePort.role === targetPort.role;
}

function portWorldPosition(node: A2AWorkflowNode, port: NodePortDef) {
  const p = node.position ?? { x: 0, y: 0 };
  const fraction = (port.index + 1) / (port.count + 1);
  if (port.side === "left") return { x: p.x, y: p.y + fraction * NODE_H };
  if (port.side === "right") return { x: p.x + NODE_W, y: p.y + fraction * NODE_H };
  if (port.side === "top") return { x: p.x + fraction * NODE_W, y: p.y };
  return { x: p.x + fraction * NODE_W, y: p.y + NODE_H };
}

function edgeColor(definition: A2AWorkflowDefinition, edge: A2AWorkflowEdge) {
  const sourcePort = getPortById(edge.source_output, "source");
  const targetPort = getPortById(edge.target_input, "target");
  if (!sourcePort || !targetPort) return "rgba(148,163,184,0.75)";
  if (!isConnectionCompatible(sourcePort, targetPort)) return "rgba(148,163,184,0.75)";
  const role = sourcePort.role;
  if (role === "flow") return "rgba(74,222,128,0.95)";
  return "rgba(96,165,250,0.95)";
}

function edgeMarkerId(definition: A2AWorkflowDefinition, edge: A2AWorkflowEdge) {
  const sourcePort = getPortById(edge.source_output, "source");
  const targetPort = getPortById(edge.target_input, "target");
  if (!sourcePort || !targetPort) return "a2a-edge-arrow-gray";
  if (!isConnectionCompatible(sourcePort, targetPort)) return "a2a-edge-arrow-gray";
  if (sourcePort.role === "flow") return "a2a-edge-arrow-green";
  return "a2a-edge-arrow-blue";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function readMemoryRefs(value: unknown): MemoryRefBinding[] {
  if (!Array.isArray(value)) return [];
  const refs: MemoryRefBinding[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { namespace?: unknown; key?: unknown };
    const namespace = typeof candidate.namespace === "string" ? candidate.namespace.trim() : "";
    const key = typeof candidate.key === "string" ? candidate.key.trim() : "";
    if (!namespace || !key) continue;
    refs.push({ namespace, key });
  }
  return refs;
}

function memoryRefId(ref: MemoryRefBinding): string {
  return `${ref.namespace}/${ref.key}`;
}

function readNodeMemoryRefs(params: Record<string, unknown> | undefined): MemoryRefBinding[] {
  const refs = readMemoryRefs(params?.memory_refs);
  const legacy = typeof params?.memory === "string" ? params.memory.trim() : "";
  if (!legacy) return refs;
  const slash = legacy.indexOf("/");
  if (slash > 0 && slash < legacy.length - 1) {
    const legacyRef = { namespace: legacy.slice(0, slash), key: legacy.slice(slash + 1) };
    if (!refs.some((ref) => ref.namespace === legacyRef.namespace && ref.key === legacyRef.key)) {
      return [...refs, legacyRef];
    }
    return refs;
  }
  if (!refs.some((ref) => ref.namespace === "user" && ref.key === legacy)) {
    return [...refs, { namespace: "user", key: legacy }];
  }
  return refs;
}

function readNodeSkills(params: Record<string, unknown> | undefined): string[] {
  const next = readStringArray(params?.skills);
  const legacy = typeof params?.skill === "string" ? params.skill.trim() : "";
  if (!legacy) return next;
  return next.includes(legacy) ? next : [...next, legacy];
}

function readNodeTools(params: Record<string, unknown> | undefined): string[] {
  const next = readStringArray(params?.tools);
  const legacy = typeof params?.tool === "string" ? params.tool.trim() : "";
  if (!legacy) return next;
  return next.includes(legacy) ? next : [...next, legacy];
}

export function FlowPanel() {
  const {
    currentWorkflowId,
    definition,
    selectedNodeIds,
    viewport,
    dirty,
    setCurrentWorkflow,
    setSelectedNodeIds,
    setViewport,
    patchDefinition,
    setDirty,
  } = useFlowWorkflowStore();
  const { activeRunId, nodeSnapshots, setActiveRun, setNodeSnapshot, resetSnapshots, setLastError } =
    useFlowExecutionStore();
  const enabledToolIds = useToolCatalogStore((state) => state.enabledToolIds);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [libraryExpanded, setLibraryExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      [...NODE_LIBRARY_SECTIONS.map((section) => section.id), "templates"].map((id) => [id, false])
    )
  );
  const [openRecentMenu, setOpenRecentMenu] = useState(false);
  const [collapsedSectionPopup, setCollapsedSectionPopup] = useState<{ sectionId: string; top: number } | null>(null);
  const [openTabs, setOpenTabs] = useState<OpenWorkflowTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<A2AWorkflowRecord[]>([]);
  const [nodeTypeDefs, setNodeTypeDefs] = useState<A2ANodeTypeDef[]>([]);
  const [customTemplates, setCustomTemplates] = useState<A2ATemplateRecord[]>([]);
  const [runs, setRuns] = useState<A2AWorkflowRunRecord[]>([]);
  const [runDetail, setRunDetail] = useState<A2AWorkflowRunDetail | null>(null);
  const [runTimeoutMs, setRunTimeoutMs] = useState(120000);
  const [error, setError] = useState<string | null>(null);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
  const [nodeParamsText, setNodeParamsText] = useState("{}");
  const [gridVisible, setGridVisible] = useState(true);
  const [shiftPanReady, setShiftPanReady] = useState(false);
  const [portHover, setPortHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<{
    sourceNodeId: string;
    sourcePortId: string;
    pointerX: number;
    pointerY: number;
  } | null>(null);
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [panState, setPanState] = useState<{
    originClientX: number;
    originClientY: number;
    startViewportX: number;
    startViewportY: number;
  } | null>(null);
  const [marqueeState, setMarqueeState] = useState<{
    originClientX: number;
    originClientY: number;
    startCanvasX: number;
    startCanvasY: number;
    currentCanvasX: number;
    currentCanvasY: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
  const [dragState, setDragState] = useState<{
    originClientX: number;
    originClientY: number;
    originalPositions: Record<string, { x: number; y: number }>;
  } | null>(null);
  const [groupDragState, setGroupDragState] = useState<{
    originClientX: number;
    originClientY: number;
    originalPositions: Record<string, { x: number; y: number }>;
  } | null>(null);
  const [connectorPicker, setConnectorPicker] = useState<ConnectorPickerState | null>(null);
  const [connectorPickerLoading, setConnectorPickerLoading] = useState(false);
  const [connectorPickerError, setConnectorPickerError] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<SkillMeta[]>([]);
  const [availableMemoryEntries, setAvailableMemoryEntries] = useState<MemoryEntry[]>([]);
  const [manualMemoryNamespace, setManualMemoryNamespace] = useState("user");
  const [manualMemoryKey, setManualMemoryKey] = useState("");

  const supportedNodeTypeSet = useMemo(() => {
    const allowed = new Set<string>();
    for (const def of nodeTypeDefs) {
      if (def.tier !== "hidden") allowed.add(def.id);
    }
    return allowed;
  }, [nodeTypeDefs]);

  const nodeLibrary = useMemo(
    () =>
      supportedNodeTypeSet.size === 0
        ? NODE_LIBRARY
        : NODE_LIBRARY.filter((item) => supportedNodeTypeSet.has(item.type)),
    [supportedNodeTypeSet]
  );

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const openRecentRef = useRef<HTMLDivElement | null>(null);
  const collapsedSidebarRef = useRef<HTMLDivElement | null>(null);
  const connectorPickerRef = useRef<HTMLDivElement | null>(null);
  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);
  const isCanvasInteractiveTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    // Marquee selection should only start from true empty canvas space.
    // Any target marked interactive (nodes/ports/groups/edges/controls) opts out.
    return Boolean(target.closest('[data-a2a-interactive="true"]'));
  }, []);

  const selectedNode = useMemo(() => {
    if (!definition || selectedNodeIds.length === 0) return null;
    const id = selectedNodeIds[selectedNodeIds.length - 1];
    return definition.nodes.find((n) => n.id === id) ?? null;
  }, [definition, selectedNodeIds]);
  const inspectorNode = useMemo(() => {
    if (!definition || !inspectorNodeId) return null;
    return definition.nodes.find((n) => n.id === inspectorNodeId) ?? null;
  }, [definition, inspectorNodeId]);
  const enabledTools = useMemo(
    () =>
      getAllToolManifests()
        .filter((manifest) => enabledToolIds.includes(manifest.id))
        .map((manifest) => ({ id: manifest.id, title: manifest.title, description: manifest.description })),
    [enabledToolIds]
  );
  const connectorNode = useMemo(() => {
    if (!definition || !connectorPicker) return null;
    return definition.nodes.find((node) => node.id === connectorPicker.nodeId) ?? null;
  }, [connectorPicker, definition]);
  const connectorNodeParams = (connectorNode?.params ?? {}) as Record<string, unknown>;
  const selectedMemoryRefs = useMemo(() => readNodeMemoryRefs(connectorNodeParams), [connectorNodeParams]);
  const selectedSkills = useMemo(() => readNodeSkills(connectorNodeParams), [connectorNodeParams]);
  const selectedTools = useMemo(() => readNodeTools(connectorNodeParams), [connectorNodeParams]);
  const availableMemoryRefs = useMemo(() => {
    const dedupe = new Map<string, MemoryRefBinding>();
    for (const entry of availableMemoryEntries) {
      const namespace = entry.namespace.trim();
      const key = entry.key.trim();
      if (!namespace || !key) continue;
      const ref = { namespace, key };
      dedupe.set(memoryRefId(ref), ref);
    }
    for (const ref of selectedMemoryRefs) {
      dedupe.set(memoryRefId(ref), ref);
    }
    return Array.from(dedupe.values()).sort((a, b) => {
      if (a.namespace === b.namespace) return a.key.localeCompare(b.key);
      return a.namespace.localeCompare(b.namespace);
    });
  }, [availableMemoryEntries, selectedMemoryRefs]);
  const activeRunRecord = useMemo(() => {
    if (!activeRunId) return null;
    if (runDetail?.run.run_id === activeRunId) return runDetail.run;
    return runs.find((run) => run.run_id === activeRunId) ?? null;
  }, [activeRunId, runDetail, runs]);
  const activeRunStatus = activeRunRecord?.status ?? null;
  const activeRunIsLive = activeRunStatus === "running" || activeRunStatus === "paused";
  const editedNode = inspectorNode ?? selectedNode;
  const selectedNodeFromContext = useMemo(() => {
    if (!definition || !contextMenu || contextMenu.kind !== "node") return null;
    return definition.nodes.find((n) => n.id === contextMenu.nodeId) ?? null;
  }, [contextMenu, definition]);
  const selectedGroupFromContext = useMemo(() => {
    if (!definition || !contextMenu || contextMenu.kind !== "group") return null;
    return (definition.groups ?? []).find((g) => g.id === contextMenu.groupId) ?? null;
  }, [contextMenu, definition]);
  const selectedNodeInAnyGroup = useMemo(() => {
    if (!definition || !selectedNodeFromContext) return false;
    return normalizeGroups(definition.nodes, definition.groups).some((g) =>
      g.node_ids.includes(selectedNodeFromContext.id)
    );
  }, [definition, selectedNodeFromContext]);
  const libraryTemplates = useMemo<LibraryTemplateEntry[]>(() => {
    const builtIn: LibraryTemplateEntry[] = WORKFLOW_TEMPLATES.map((tpl) => ({
      id: tpl.id,
      name: tpl.name,
      description: tpl.description,
      source: "builtin",
      build: tpl.build,
    }));
    const custom: LibraryTemplateEntry[] = customTemplates.map((tpl) => {
      let parsed: A2AWorkflowDefinition | null = null;
      try {
        parsed = sanitizeDefinition(JSON.parse(tpl.definition_json) as Partial<A2AWorkflowDefinition>, tpl.name);
      } catch {
        parsed = null;
      }
      return {
        id: tpl.template_id,
        name: tpl.name,
        description: parsed ? "Custom template" : "Invalid template data",
        source: "custom" as const,
        build: (name: string) => {
          if (!parsed) return defaultDefinition(name);
          const base = sanitizeDefinition(parsed, name);
          return {
            ...base,
            workflow_id: "",
            name,
            active: false,
            version: 1,
          };
        },
      };
    });
    return [...builtIn, ...custom];
  }, [customTemplates]);

  const updateNodeParams = useCallback(
    (nodeId: string, updater: (params: Record<string, unknown>) => Record<string, unknown>) => {
      patchDefinition((current) => ({
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id !== nodeId) return node;
          const base = (node.params ?? {}) as Record<string, unknown>;
          return { ...node, params: updater(base) };
        }),
      }));
    },
    [patchDefinition]
  );

  const toggleNodeSkill = useCallback(
    (nodeId: string, skillId: string) => {
      updateNodeParams(nodeId, (params) => {
        const current = readNodeSkills(params);
        const next = current.includes(skillId)
          ? current.filter((id) => id !== skillId)
          : [...current, skillId];
        const nextParams: Record<string, unknown> = { ...params, skills: next };
        delete nextParams.skill;
        return nextParams;
      });
    },
    [updateNodeParams]
  );

  const toggleNodeTool = useCallback(
    (nodeId: string, toolId: string) => {
      updateNodeParams(nodeId, (params) => {
        const current = readNodeTools(params);
        const next = current.includes(toolId)
          ? current.filter((id) => id !== toolId)
          : [...current, toolId];
        const nextParams: Record<string, unknown> = { ...params, tools: next };
        delete nextParams.tool;
        return nextParams;
      });
    },
    [updateNodeParams]
  );

  const toggleNodeMemoryRef = useCallback(
    (nodeId: string, ref: MemoryRefBinding) => {
      const refId = memoryRefId(ref);
      updateNodeParams(nodeId, (params) => {
        const current = readNodeMemoryRefs(params);
        const next = current.some((entry) => memoryRefId(entry) === refId)
          ? current.filter((entry) => memoryRefId(entry) !== refId)
          : [...current, ref];
        const nextParams: Record<string, unknown> = { ...params, memory_refs: next };
        delete nextParams.memory;
        return nextParams;
      });
    },
    [updateNodeParams]
  );

  const addManualMemoryRef = useCallback(() => {
    if (!connectorPicker || connectorPicker.role !== "memory") return;
    const namespace = manualMemoryNamespace.trim();
    const key = manualMemoryKey.trim();
    if (!namespace || !key) return;
    toggleNodeMemoryRef(connectorPicker.nodeId, { namespace, key });
    setManualMemoryKey("");
  }, [connectorPicker, manualMemoryKey, manualMemoryNamespace, toggleNodeMemoryRef]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 4500);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    setNodeParamsText(JSON.stringify(editedNode?.params ?? {}, null, 2));
  }, [editedNode?.id, editedNode?.params]);

  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = () => setContextMenu(null);
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [contextMenu]);

  useEffect(() => {
    if (!openRecentMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!openRecentRef.current) return;
      if (!openRecentRef.current.contains(event.target as Node)) {
        setOpenRecentMenu(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [openRecentMenu]);

  useEffect(() => {
    if (!collapsedSectionPopup) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (collapsedSidebarRef.current?.contains(target)) return;
      setCollapsedSectionPopup(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [collapsedSectionPopup]);

  useEffect(() => {
    if (!connectorPicker) return;
    let cancelled = false;

    setConnectorPickerLoading(true);
    setConnectorPickerError(null);
    const load = async () => {
      try {
        if (connectorPicker.role === "skills") {
          const rows = await skillsList();
          if (!cancelled) setAvailableSkills(Array.isArray(rows) ? rows : []);
        } else if (connectorPicker.role === "memory") {
          const [userRows, episodicRows] = await Promise.all([
            memoryList("user").catch((): MemoryEntry[] => []),
            memoryList("episodic").catch((): MemoryEntry[] => []),
          ]);
          if (!cancelled) {
            setAvailableMemoryEntries([...(Array.isArray(userRows) ? userRows : []), ...(Array.isArray(episodicRows) ? episodicRows : [])]);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setConnectorPickerError(err instanceof Error ? err.message : "Failed to load connector options");
        }
      } finally {
        if (!cancelled) setConnectorPickerLoading(false);
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [connectorPicker]);

  useEffect(() => {
    if (!connectorPicker || connectorPicker.role !== "memory") return;
    setManualMemoryNamespace("user");
    setManualMemoryKey("");
  }, [connectorPicker]);

  useEffect(() => {
    if (!connectorPicker) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (connectorPickerRef.current?.contains(target)) return;
      setConnectorPicker(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [connectorPicker]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShiftPanReady(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") setShiftPanReady(false);
    };
    const onBlur = () => setShiftPanReady(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const reloadWorkflows = useCallback(async () => {
    const rows = await a2aWorkflowList();
    setWorkflows(rows);
    if (!currentWorkflowId && rows.length > 0) {
      const row = rows[0];
      const detail = await a2aWorkflowGet(row.workflow_id);
      if (detail) setCurrentWorkflow(detail.workflow_id, parseDefinition(detail));
    }
  }, [currentWorkflowId, setCurrentWorkflow]);

  const reloadTemplates = useCallback(async () => {
    const rows = await a2aTemplateList();
    setCustomTemplates(rows);
  }, []);

  const reloadNodeTypes = useCallback(async () => {
    const rows = await a2aNodeTypeList();
    setNodeTypeDefs(Array.isArray(rows) ? rows : []);
  }, []);

  const reloadRuns = useCallback(async () => {
    const rows = await a2aWorkflowRunList(currentWorkflowId ?? undefined, 80);
    setRuns(rows);
    if (activeRunId) {
      const detail = await a2aWorkflowRunGet(activeRunId);
      setRunDetail(detail);
      if (detail) {
        for (const row of detail.node_runs) {
          setNodeSnapshot(row.node_id, {
            status: row.status === "succeeded" ? "succeeded" : row.status === "failed" ? "failed" : "running",
            input_json: row.input_json,
            output_json: row.output_json ?? undefined,
            error: row.error ?? undefined,
          });
        }
      }
    }
  }, [activeRunId, currentWorkflowId, setNodeSnapshot]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await reloadNodeTypes();
      await reloadWorkflows();
      await reloadTemplates();
      await reloadRuns();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [reloadNodeTypes, reloadRuns, reloadTemplates, reloadWorkflows]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!currentWorkflowId || !definition) return;
    setOpenTabs((tabs) => {
      const existing = tabs.find((t) => t.workflowId === currentWorkflowId);
      if (existing) {
        return tabs.map((t) =>
          t.workflowId === currentWorkflowId ? { ...t, title: definition.name } : t
        );
      }
      return [...tabs, { tabId: currentWorkflowId, workflowId: currentWorkflowId, title: definition.name }];
    });
    setActiveTabId(currentWorkflowId);
  }, [currentWorkflowId, definition?.name]);

  const applyZoom = (factor: number) => {
    const nextZoom = quantizeZoom(viewport.zoom * factor);
    if (Math.abs(nextZoom - viewport.zoom) < 0.0001) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    const anchorX = rect ? rect.width / 2 : window.innerWidth / 2;
    const anchorY = rect ? rect.height / 2 : window.innerHeight / 2;

    const worldX = (anchorX - viewport.x) / viewport.zoom;
    const worldY = (anchorY - viewport.y) / viewport.zoom;

    setViewport({
      zoom: nextZoom,
      x: anchorX - worldX * nextZoom,
      y: anchorY - worldY * nextZoom,
    });
  };

  const nudgeZoom = (delta: 1 | -1) => {
    const target = quantizeZoom(viewport.zoom + delta * ZOOM_INCREMENT);
    if (Math.abs(target - viewport.zoom) < 0.0001) return;
    const factor = target / Math.max(viewport.zoom, 0.0001);
    applyZoom(factor);
  };

  useEffect(() => {
    let disposed = false;
    let unlistenChanged: (() => void) | null = null;
    let unlistenTrace: (() => void) | null = null;

    void listen<{ kind: string; workflow_id?: string | null; run_id?: string | null }>(
      "a2a:workflow_changed",
      (event) => {
        if (disposed) return;
        const payload = event.payload;
        if (!payload.workflow_id || payload.workflow_id === currentWorkflowId) {
          void reloadWorkflows();
        }
        if (payload.kind?.startsWith?.("template_")) {
          void reloadTemplates();
        }
        if (payload.run_id) {
          setActiveRun(payload.run_id);
          void reloadRuns();
        }
      }
    ).then((fn) => {
      if (disposed) fn();
      else unlistenChanged = fn;
    });

    void listen<{ run_id: string; node_id: string; status: string; detail: Record<string, unknown> }>(
      "a2a:run_trace_chunk",
      (event) => {
        if (disposed) return;
        const payload = event.payload;
        setNodeSnapshot(payload.node_id, {
          status:
            payload.status === "succeeded"
              ? "succeeded"
              : payload.status === "failed"
              ? "failed"
              : "running",
          error:
            typeof payload.detail?.error === "string" ? (payload.detail.error as string) : undefined,
        });
      }
    ).then((fn) => {
      if (disposed) fn();
      else unlistenTrace = fn;
    });

    return () => {
      disposed = true;
      if (unlistenChanged) unlistenChanged();
      if (unlistenTrace) unlistenTrace();
    };
  }, [currentWorkflowId, reloadRuns, reloadTemplates, reloadWorkflows, setActiveRun, setNodeSnapshot]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const accel = event.ctrlKey || event.metaKey;
      if (!accel) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        nudgeZoom(1);
      } else if (event.key === "-") {
        event.preventDefault();
        nudgeZoom(-1);
      } else if (event.key === "0") {
        event.preventDefault();
        setViewport({ x: 0, y: 0, zoom: 1 });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setViewport, viewport, canvasRef, nudgeZoom]);

  useEffect(() => {
    if (!dirty || !definition || !currentWorkflowId) return;
    if (dragState || groupDragState || marqueeState || panState || connectionDrag) return;
    const snapshot = JSON.stringify(definition);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await a2aWorkflowUpdate(currentWorkflowId, {
            name: definition.name,
            active: definition.active,
            definition,
          });
          const latest = useFlowWorkflowStore.getState();
          if (
            latest.currentWorkflowId === currentWorkflowId &&
            latest.definition &&
            JSON.stringify(latest.definition) === snapshot
          ) {
            setDirty(false);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [
    connectionDrag,
    currentWorkflowId,
    definition,
    dirty,
    dragState,
    groupDragState,
    marqueeState,
    panState,
    setDirty,
  ]);

  const handleCreateWorkflow = async () => {
    const base = defaultDefinition(`Workflow ${workflows.length + 1}`);
    const created = await a2aWorkflowCreate(base.name, base, false);
    setCurrentWorkflow(created.workflow_id, parseDefinition(created));
    setOpenTabs((tabs) => {
      const existing = tabs.find((t) => t.workflowId === created.workflow_id);
      if (existing) return tabs;
      return [...tabs, { tabId: created.workflow_id, workflowId: created.workflow_id, title: created.name }];
    });
    setActiveTabId(created.workflow_id);
    setSelectedGroupIds([]);
    setDirty(false);
    await loadAll();
  };

  const handleSelectWorkflow = async (workflow_id: string) => {
    const row = await a2aWorkflowGet(workflow_id);
    if (!row) return;
    setCurrentWorkflow(row.workflow_id, parseDefinition(row));
    setOpenTabs((tabs) => {
      const existing = tabs.find((t) => t.workflowId === row.workflow_id);
      if (existing) {
        return tabs.map((t) => (t.workflowId === row.workflow_id ? { ...t, title: row.name } : t));
      }
      return [...tabs, { tabId: row.workflow_id, workflowId: row.workflow_id, title: row.name }];
    });
    setActiveTabId(row.workflow_id);
    setDirty(false);
    setSelectedGroupIds([]);
    resetSnapshots();
    setActiveRun(null);
    setRunDetail(null);
    await reloadRuns();
  };

  const handleSave = async () => {
    if (!definition) return;
    setSaving(true);
    setError(null);
    try {
      if (!currentWorkflowId) {
        const created = await a2aWorkflowCreate(definition.name, definition, Boolean(definition.active));
        setCurrentWorkflow(created.workflow_id, parseDefinition(created));
      } else {
        const updated = await a2aWorkflowUpdate(currentWorkflowId, {
          name: definition.name,
          definition,
          active: Boolean(definition.active),
        });
        if (updated) {
          setCurrentWorkflow(updated.workflow_id, parseDefinition(updated));
        }
      }
      setDirty(false);
      await reloadWorkflows();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    if (!currentWorkflowId || !definition || activeRunIsLive) return;
    setRunning(true);
    setError(null);
    resetSnapshots();
    try {
      const preflight = await a2aWorkflowPreflight(definition);
      if (!preflight.ok) {
        const blocking = preflight.issues.filter((issue) => issue.blocking);
        const summary = blocking
          .slice(0, 3)
          .map((issue) => issue.message)
          .join(" | ");
        setError(
          blocking.length > 0
            ? `Preflight failed (${blocking.length}): ${summary}`
            : "Workflow preflight failed"
        );
        return;
      }
      const run = await a2aWorkflowRunStart(
        currentWorkflowId,
        [{ message: "hello from A2A", question: "What is A2A and what can it do?" }],
        "manual",
        runTimeoutMs
      );
      setActiveRun(run.run_id);
      await reloadRuns();
      const detail = await a2aWorkflowRunGet(run.run_id);
      setRunDetail(detail);
      if (run.status === "failed" || run.status === "timed_out") {
        setLastError(run.error ?? "Workflow run failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const handlePauseRun = async () => {
    if (!activeRunId) return;
    setError(null);
    try {
      await a2aWorkflowRunPause(activeRunId);
      await reloadRuns();
      const detail = await a2aWorkflowRunGet(activeRunId);
      setRunDetail(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleResumeRun = async () => {
    if (!activeRunId) return;
    setError(null);
    try {
      await a2aWorkflowRunResume(activeRunId);
      await reloadRuns();
      const detail = await a2aWorkflowRunGet(activeRunId);
      setRunDetail(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCancelRun = async () => {
    if (!activeRunId) return;
    setError(null);
    try {
      await a2aWorkflowRunCancel(activeRunId);
      await reloadRuns();
      const detail = await a2aWorkflowRunGet(activeRunId);
      setRunDetail(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async () => {
    if (!currentWorkflowId) return;
    const ok = await a2aWorkflowDelete(currentWorkflowId);
    if (!ok) return;
    const deletedId = currentWorkflowId;
    setCurrentWorkflow(null, null);
    setSelectedGroupIds([]);
    setRunDetail(null);
    setActiveRun(null);
    setDirty(false);
    setOpenTabs((tabs) => tabs.filter((t) => t.workflowId !== deletedId));
    setActiveTabId((prev) => (prev === deletedId ? null : prev));
    await loadAll();
  };

  const handleDuplicateWorkflow = async () => {
    if (!definition) return;
    const dupName = `${definition.name} Copy`;
    const payload: A2AWorkflowDefinition = {
      ...definition,
      workflow_id: "",
      name: dupName,
    };
    const created = await a2aWorkflowCreate(dupName, payload, Boolean(definition.active));
    await handleSelectWorkflow(created.workflow_id);
    await reloadWorkflows();
  };

  const handleCreateFromTemplate = async (template: LibraryTemplateEntry) => {
    const baseName = template.name;
    const usedNames = new Set(workflows.map((w) => w.name));
    let name = baseName;
    let i = 2;
    while (usedNames.has(name)) {
      name = `${baseName} ${i}`;
      i += 1;
    }
    const created = await a2aWorkflowCreate(name, template.build(name), false);
    await handleSelectWorkflow(created.workflow_id);
    await reloadWorkflows();
  };

  const handleSaveCurrentAsTemplate = async () => {
    if (!definition) return;
    const defaultName = `${definition.name || "Workflow"} Template`;
    const name = prompt("Template name", defaultName)?.trim();
    if (!name) return;
    await a2aTemplateCreate(name, {
      ...definition,
      workflow_id: "",
      name,
      active: false,
      version: 1,
    });
    await reloadTemplates();
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!templateId) return;
    if (!confirm("Delete this template?")) return;
    await a2aTemplateDelete(templateId);
    await reloadTemplates();
  };

  const handleExportWorkflow = async () => {
    if (!definition) return;
    const payload = JSON.stringify(definition, null, 2);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      }
    } catch {
      // no-op: clipboard availability varies by environment.
    }
    try {
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(definition.name || "workflow").replace(/\s+/g, "_")}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // no-op fallback; clipboard copy may still have succeeded.
    }
  };

  const handleImportWorkflow = async () => {
    const raw = prompt("Paste workflow JSON to import");
    if (!raw || !raw.trim()) return;
    try {
      const parsed = JSON.parse(raw) as A2AWorkflowDefinition;
      const importName = (parsed.name?.trim() || "Imported Workflow");
      const created = await a2aWorkflowCreate(importName, {
        ...parsed,
        workflow_id: "",
      }, Boolean(parsed.active));
      await handleSelectWorkflow(created.workflow_id);
      await reloadWorkflows();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid import JSON");
    }
  };

  const handleCloseTab = async (tabId: string) => {
    const remaining = openTabs.filter((t) => t.tabId !== tabId);
    setOpenTabs(remaining);
    if (activeTabId !== tabId) return;
    if (remaining.length === 0) {
      setActiveTabId(null);
      setCurrentWorkflow(null, null);
      setSelectedNodeIds([]);
      setSelectedGroupIds([]);
      return;
    }
    const fallback = remaining[remaining.length - 1];
    setActiveTabId(fallback.tabId);
    await handleSelectWorkflow(fallback.workflowId);
  };

  const handleAddNode = (template: NodeLibraryItem) => {
    handleAddNodeAt(template, null, null);
  };

  const toggleLibrarySection = (sectionId: string) => {
    setLibraryExpanded((current) => ({ ...current, [sectionId]: !current[sectionId] }));
  };

  const orderedLibrarySections = useMemo(() => {
    const filtered = NODE_LIBRARY_SECTIONS.map((section) => ({
      ...section,
      items:
        supportedNodeTypeSet.size === 0
          ? section.items
          : section.items.filter((item) => supportedNodeTypeSet.has(item.type)),
    })).filter((section) => section.items.length > 0);

    return [
      ...filtered.filter((section) => section.id === "primary"),
      { id: "templates", title: "Templates", items: [] as NodeLibraryItem[] },
      ...filtered.filter((section) => section.id === "triggers"),
      ...filtered.filter((section) => section.id === "ai"),
      ...filtered.filter((section) => !["primary", "triggers", "ai"].includes(section.id)),
    ];
  }, [supportedNodeTypeSet]);

  const handleAddNodeAt = (
    template: NodeLibraryItem,
    worldX: number | null,
    worldY: number | null
  ) => {
    patchDefinition((current) => {
      const id = `n_${Math.random().toString(36).slice(2, 8)}`;
      const offset = current.nodes.length * 20;
      const nextGroups = normalizeGroups(current.nodes, current.groups).map((g) => ({ ...g, node_ids: [...g.node_ids] }));
      // New nodes are ungrouped unless exactly one group is actively selected.
      // This keeps multi-group organization predictable after deselection.
      if (selectedGroupIds.length === 1) {
        const selectedGroup = nextGroups.find((g) => g.id === selectedGroupIds[0]);
        if (selectedGroup) {
          selectedGroup.node_ids = [...new Set([...selectedGroup.node_ids, id])];
        }
      }
      const baseX =
        worldX === null
          ? 80 + offset
          : clamp(worldX - NODE_W / 2, 0, GRID_W - NODE_W);
      const baseY =
        worldY === null
          ? 260 + offset
          : clamp(worldY - NODE_H / 2, 0, GRID_H - NODE_H);
      return {
        ...current,
        nodes: [
          ...current.nodes,
          {
            id,
            type: template.type,
            name: template.name,
            params: template.templateParams,
            group_id: selectedGroupIds.length === 1 ? selectedGroupIds[0] : undefined,
            position: { x: snap(baseX), y: snap(baseY) },
          },
        ],
        groups: nextGroups,
      };
    });
  };

  const createGroupWithNodes = (nodeIds: string[]) => {
    if (!definition) return;
    const ids = [...new Set(nodeIds)];
    if (ids.length === 0) return;
    const label = prompt("Group name", `Group ${Math.max(1, (definition.groups ?? []).length + 1)}`)?.trim();
    if (!label) return;
    patchDefinition((current) => {
      const groupId = `g_${Math.random().toString(36).slice(2, 8)}`;
      // Move selected nodes out of prior groups before creating the new group so
      // membership stays one-group-at-a-time and drag behavior remains unambiguous.
      const existing = normalizeGroups(current.nodes, current.groups).map((g) => ({
        ...g,
        node_ids: g.node_ids.filter((id) => !ids.includes(id)),
      }));
      const groups = [
        ...existing.filter((g) => g.node_ids.length > 0),
        {
          id: groupId,
          label,
          color: "rgba(56,189,248,0.12)",
          node_ids: ids,
        },
      ];
      return {
        ...current,
        nodes: current.nodes.map((node) =>
          ids.includes(node.id) ? { ...node, group_id: groupId } : node
        ),
        groups,
      };
    });
    setContextMenu(null);
  };

  const createGroupFromSelection = () => {
    createGroupWithNodes(selectedNodeIds);
  };

  const createGroupFromToolbar = () => {
    if (!definition) return;
    if (selectedNodeIds.length >= 1) {
      createGroupWithNodes(selectedNodeIds);
      return;
    }
    setError("Select one or more nodes to create a group");
  };

  const renameGroupFromContext = () => {
    if (!selectedGroupFromContext) return;
    const label = prompt("Rename group", selectedGroupFromContext.label)?.trim();
    if (!label) return;
    patchDefinition((current) => ({
      ...current,
      groups: normalizeGroups(current.nodes, current.groups).map((g) =>
        g.id === selectedGroupFromContext.id ? { ...g, label } : g
      ),
    }));
    setContextMenu(null);
  };

  const removeGroupFromContext = () => {
    if (!selectedGroupFromContext) return;
    patchDefinition((current) => {
      const groupId = selectedGroupFromContext.id;
      return {
        ...current,
        nodes: current.nodes.map((node) =>
          node.group_id === groupId ? { ...node, group_id: undefined } : node
        ),
        groups: normalizeGroups(current.nodes, current.groups).filter((g) => g.id !== groupId),
      };
    });
    setSelectedGroupIds((prev) => prev.filter((id) => id !== selectedGroupFromContext.id));
    setContextMenu(null);
  };

  const removeNodeFromGroupFromContext = () => {
    if (!selectedNodeFromContext) return;
    const nodeId = selectedNodeFromContext.id;
    patchDefinition((current) => {
      const nextNodes = current.nodes.map((node) =>
        node.id === nodeId ? { ...node, group_id: undefined } : node
      );
      return {
        ...current,
        nodes: nextNodes,
        groups: normalizeGroups(nextNodes, current.groups).map((g) => ({
          ...g,
          node_ids: g.node_ids.filter((id) => id !== nodeId),
        })),
      };
    });
    setContextMenu(null);
  };

  const startGroupDrag = (event: React.PointerEvent<HTMLDivElement>, groupId: string, nodeIds: string[]) => {
    if (!definition) return;
    const positions: Record<string, { x: number; y: number }> = {};
    for (const id of nodeIds) {
      const node = definition.nodes.find((n) => n.id === id);
      if (!node) continue;
      const p = node.position ?? { x: 0, y: 0 };
      positions[id] = { x: p.x, y: p.y };
    }
    setSelectedGroupIds([groupId]);
    setSelectedNodeIds(nodeIds);
    setGroupDragState({
      originClientX: event.clientX,
      originClientY: event.clientY,
      originalPositions: positions,
    });
  };

  const startNodeDrag = (event: React.PointerEvent<HTMLDivElement>, nodeId: string) => {
    if (!definition) return;
    const selected = selectedNodeIds.includes(nodeId)
      ? selectedNodeIds
      : [nodeId];
    if (!selectedNodeIds.includes(nodeId)) {
      setSelectedNodeIds(selected);
    }
    const positions: Record<string, { x: number; y: number }> = {};
    for (const id of selected) {
      const node = definition.nodes.find((n) => n.id === id);
      if (node) {
        const p = node.position ?? { x: 0, y: 0 };
        positions[id] = { x: p.x, y: p.y };
      }
    }
    setDragState({
      originClientX: event.clientX,
      originClientY: event.clientY,
      originalPositions: positions,
    });
  };

  useEffect(() => {
    if (!dragState) return;
    const onMove = (event: PointerEvent) => {
      if (!definition) return;
      const dx = (event.clientX - dragState.originClientX) / viewport.zoom;
      const dy = (event.clientY - dragState.originClientY) / viewport.zoom;
      patchDefinition((current) => ({
        ...current,
        nodes: current.nodes.map((n) => {
          const base = dragState.originalPositions[n.id];
          if (!base) return n;
          return {
            ...n,
            position: {
              x: clamp(snap(base.x + dx), 0, GRID_W - NODE_W),
              y: clamp(snap(base.y + dy), 0, GRID_H - NODE_H),
            },
          };
        }),
      }));
    };
    const onUp = () => setDragState(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [definition, dragState, patchDefinition, viewport.zoom]);

  useEffect(() => {
    if (!groupDragState) return;
    const onMove = (event: PointerEvent) => {
      const dx = (event.clientX - groupDragState.originClientX) / viewport.zoom;
      const dy = (event.clientY - groupDragState.originClientY) / viewport.zoom;
      patchDefinition((current) => ({
        ...current,
        nodes: current.nodes.map((n) => {
          const base = groupDragState.originalPositions[n.id];
          if (!base) return n;
          return {
            ...n,
            position: {
              x: clamp(snap(base.x + dx), 0, GRID_W - NODE_W),
              y: clamp(snap(base.y + dy), 0, GRID_H - NODE_H),
            },
          };
        }),
      }));
    };
    const onUp = () => setGroupDragState(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [groupDragState, patchDefinition, viewport.zoom]);

  useEffect(() => {
    if (!panState) return;
    const onMove = (event: PointerEvent) => {
      const dx = event.clientX - panState.originClientX;
      const dy = event.clientY - panState.originClientY;
      setViewport({
        ...viewport,
        x: panState.startViewportX + dx,
        y: panState.startViewportY + dy,
      });
    };
    const onUp = () => setPanState(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [panState, setViewport, viewport]);

  useEffect(() => {
    if (!marqueeState) return;
    const onMove = (event: PointerEvent) => {
      const point = getCanvasPoint(event.clientX, event.clientY);
      setMarqueeState((current) =>
        current
          ? {
              ...current,
              currentCanvasX: point.x,
              currentCanvasY: point.y,
            }
          : null
      );
    };
    const onUp = () => {
      const minCanvasX = Math.min(marqueeState.startCanvasX, marqueeState.currentCanvasX);
      const minCanvasY = Math.min(marqueeState.startCanvasY, marqueeState.currentCanvasY);
      const maxCanvasX = Math.max(marqueeState.startCanvasX, marqueeState.currentCanvasX);
      const maxCanvasY = Math.max(marqueeState.startCanvasY, marqueeState.currentCanvasY);

      const minWorldX = (minCanvasX - viewport.x) / viewport.zoom;
      const minWorldY = (minCanvasY - viewport.y) / viewport.zoom;
      const maxWorldX = (maxCanvasX - viewport.x) / viewport.zoom;
      const maxWorldY = (maxCanvasY - viewport.y) / viewport.zoom;

      if (definition) {
        const ids = definition.nodes
          .filter((n) => {
            const p = n.position ?? { x: 0, y: 0 };
            const nx1 = p.x;
            const ny1 = p.y;
            const nx2 = p.x + NODE_W;
            const ny2 = p.y + NODE_H;
            const intersects = nx1 <= maxWorldX && nx2 >= minWorldX && ny1 <= maxWorldY && ny2 >= minWorldY;
            return intersects;
          })
          .map((n) => n.id);
        setSelectedNodeIds(ids);
        setSelectedGroupIds([]);
      }
      setMarqueeState(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [definition, getCanvasPoint, marqueeState, setSelectedNodeIds, viewport.x, viewport.y, viewport.zoom]);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const direction: 1 | -1 = event.deltaY < 0 ? 1 : -1;
    nudgeZoom(direction);
  };

  const dragHasNodeTemplate = (event: React.DragEvent) => {
    return Array.from(event.dataTransfer.types ?? []).includes(NODE_DRAG_MIME);
  };

  const resolveTemplateFromDrag = (event: React.DragEvent) => {
    const raw =
      event.dataTransfer.getData(NODE_DRAG_MIME) ||
      event.dataTransfer.getData("text/plain");
    if (!raw) return null;
    return nodeLibrary.find((item) => item.type === raw) ?? null;
  };

  const handleCanvasDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const template = resolveTemplateFromDrag(event);
    if (!template) return;
    const point = getCanvasPoint(event.clientX, event.clientY);
    const worldX = (point.x - viewport.x) / viewport.zoom;
    const worldY = (point.y - viewport.y) / viewport.zoom;
    handleAddNodeAt(template, worldX, worldY);
  };

  const tryConnectPorts = useCallback(
    (sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string) => {
      if (!definition) return false;
      const sourcePort = getPortById(sourcePortId, "source");
      const targetPort = getPortById(targetPortId, "target");
      if (!sourcePort || !targetPort) return false;
      if (sourceNodeId === targetNodeId) return false;
      if (!isConnectionCompatible(sourcePort, targetPort)) return false;

      const sourceCount = countPortConnections(definition.edges, sourceNodeId, sourcePort.id, "source");
      const targetCount = countPortConnections(definition.edges, targetNodeId, targetPort.id, "target");
      if (sourceCount >= sourcePort.maxConnections || targetCount >= targetPort.maxConnections) return false;

      const duplicate = definition.edges.some(
        (edge) =>
          edge.source === sourceNodeId &&
          edge.source_output === sourcePort.id &&
          edge.target === targetNodeId &&
          edge.target_input === targetPort.id
      );
      if (duplicate) return false;

      // One connection path for both click-connect and drag-connect to keep
      // validation/limits identical regardless of interaction style.
      patchDefinition((current) => ({
        ...current,
        edges: [
          ...current.edges,
          {
            id: `e_${Math.random().toString(36).slice(2, 8)}`,
            source: sourceNodeId,
            source_output: sourcePort.id,
            target: targetNodeId,
            target_input: targetPort.id,
          },
        ],
      }));
      return true;
    },
    [definition, patchDefinition]
  );

  const onPortClick = (nodeId: string, portId: string) => {
    if (!definition) return;
    const node = definition.nodes.find((entry) => entry.id === nodeId);
    const port = getPortById(portId, "target");
    if (!port) return;
    const isAgentBindingPort =
      node?.type === "ai.agent" &&
      (port.role === "memory" || port.role === "skills" || port.role === "tools");
    if (isAgentBindingPort) {
      return;
    }

    if (!pendingConnection) {
      if (!supportsOut(port.direction)) return;
      const outgoingCount = countPortConnections(definition.edges, nodeId, port.id, "source");
      if (outgoingCount >= port.maxConnections) return;
      setPendingConnection({ sourceNodeId: nodeId, sourcePortId: port.id });
      return;
    }

    if (pendingConnection.sourceNodeId === nodeId && pendingConnection.sourcePortId === port.id) {
      setPendingConnection(null);
      return;
    }

    if (pendingConnection.sourceNodeId === nodeId) return;
    const connected = tryConnectPorts(
      pendingConnection.sourceNodeId,
      pendingConnection.sourcePortId,
      nodeId,
      port.id
    );
    if (connected) {
      setPendingConnection(null);
    }
  };

  useEffect(() => {
    if (!connectionDrag) return;
    const onMove = (event: PointerEvent) => {
      const point = getCanvasPoint(event.clientX, event.clientY);
      setConnectionDrag((current) =>
        current
          ? {
              ...current,
              pointerX: point.x,
              pointerY: point.y,
            }
          : null
      );
    };
    const onUp = () => {
      setConnectionDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [connectionDrag, getCanvasPoint]);

  const autoWireNode = (targetNodeId: string) => {
    if (!definition) return;
    const sourceNodeId =
      pendingConnection?.sourceNodeId ?? selectedNodeIds.find((id) => id !== targetNodeId) ?? null;
    if (!sourceNodeId || sourceNodeId === targetNodeId) return;

    const sourcePorts = NODE_PORTS.filter((port) => supportsOut(port.direction));
    const targetPorts = NODE_PORTS.filter((port) => supportsIn(port.direction));

    patchDefinition((current) => {
      const currentEdges = [...current.edges];
      const sourceUsage = new Map<string, number>();
      const targetUsage = new Map<string, number>();
      for (const port of sourcePorts) {
        sourceUsage.set(port.id, countPortConnections(currentEdges, sourceNodeId, port.id, "source"));
      }
      for (const port of targetPorts) {
        targetUsage.set(port.id, countPortConnections(currentEdges, targetNodeId, port.id, "target"));
      }

      for (const sourcePort of sourcePorts) {
        const sourceUsed = sourceUsage.get(sourcePort.id) ?? 0;
        if (sourceUsed >= sourcePort.maxConnections) continue;

        const candidateTarget = targetPorts.find((targetPort) => {
          if (!isConnectionCompatible(sourcePort, targetPort)) return false;
          const used = targetUsage.get(targetPort.id) ?? 0;
          if (used >= targetPort.maxConnections) return false;
          const exists = currentEdges.some(
            (edge) =>
              edge.source === sourceNodeId &&
              edge.source_output === sourcePort.id &&
              edge.target === targetNodeId &&
              edge.target_input === targetPort.id
          );
          return !exists;
        });

        if (!candidateTarget) continue;
        currentEdges.push({
          id: `e_${Math.random().toString(36).slice(2, 8)}`,
          source: sourceNodeId,
          source_output: sourcePort.id,
          target: targetNodeId,
          target_input: candidateTarget.id,
        });
        sourceUsage.set(sourcePort.id, (sourceUsage.get(sourcePort.id) ?? 0) + 1);
        targetUsage.set(candidateTarget.id, (targetUsage.get(candidateTarget.id) ?? 0) + 1);
      }
      return { ...current, edges: currentEdges };
    });

    setPendingConnection(null);
    setContextMenu(null);
  };

  const upsertNodeParam = (key: "model" | "skill" | "memory" | "tool" | "api") => {
    if (!selectedNodeFromContext) return;
    const value = prompt(`Set ${key} for ${selectedNodeFromContext.name}`);
    if (!value || !value.trim()) return;
    patchDefinition((current) => ({
      ...current,
      nodes: current.nodes.map((n) =>
        n.id === selectedNodeFromContext.id
          ? { ...n, params: { ...(n.params ?? {}), [key]: value.trim() } }
          : n
      ),
    }));
    setContextMenu(null);
  };

  const removeNodeFromContext = () => {
    if (!selectedNodeFromContext) return;
    const nodeId = selectedNodeFromContext.id;
    patchDefinition((current) => ({
      ...current,
      nodes: current.nodes.filter((n) => n.id !== nodeId),
      edges: current.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      groups: normalizeGroups(
        current.nodes.filter((n) => n.id !== nodeId),
        (current.groups ?? []).map((g) => ({
          ...g,
          node_ids: g.node_ids.filter((id) => id !== nodeId),
        }))
      ),
    }));
    setSelectedNodeIds(selectedNodeIds.filter((id) => id !== nodeId));
    setContextMenu(null);
  };

  const removeEdge = (edgeId: string) => {
    patchDefinition((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.id !== edgeId),
    }));
    setHoveredEdgeId((current) => (current === edgeId ? null : current));
  };

  const runNodeTest = async () => {
    if (!editedNode) return;
    try {
      const result = await a2aWorkflowNodeTest(editedNode, [
        { json: { value: 1, flag: true, message: "sample" }, pairedItem: { item: 0 } },
      ] as A2AExecutionItem[]);
      setNodeSnapshot(editedNode.id, {
        status: "succeeded",
        output_json: JSON.stringify(result, null, 2),
      });
    } catch (e) {
      setNodeSnapshot(editedNode.id, {
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const saveSelectedNodeParams = () => {
    if (!editedNode) return;
    try {
      const parsed = JSON.parse(nodeParamsText) as Record<string, unknown>;
      patchDefinition((current) => ({
        ...current,
        nodes: current.nodes.map((n) => (n.id === editedNode.id ? { ...n, params: parsed } : n)),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid node params JSON");
    }
  };

  const nodeStatus = (nodeId: string) => nodeSnapshots[nodeId]?.status ?? "idle";
  const latestNodeRunById = useMemo(() => {
    const map = new Map<string, (A2AWorkflowRunDetail["node_runs"][number])>();
    for (const row of runDetail?.node_runs ?? []) {
      const prev = map.get(row.node_id);
      if (!prev || row.started_at_ms > prev.started_at_ms) {
        map.set(row.node_id, row);
      }
    }
    return map;
  }, [runDetail?.node_runs]);
  const inspectorNodeRun = inspectorNode ? latestNodeRunById.get(inspectorNode.id) ?? null : null;
  const inspectorStyle = useMemo(() => {
    if (!inspectorNode) return null;
    const p = inspectorNode.position ?? { x: 0, y: 0 };
    const left = viewport.x + (p.x + NODE_W / 2) * viewport.zoom;
    const top = viewport.y + p.y * viewport.zoom - 18;
    return { left, top };
  }, [inspectorNode, viewport.x, viewport.y, viewport.zoom]);
  const gridMultiplier = useMemo(() => {
    const worldStepTarget = GRID_TARGET_PIXEL_SPACING / viewport.zoom;
    const exponent = Math.round(Math.log(worldStepTarget / GRID_STEP) / Math.log(5));
    return Math.max(1, Math.pow(5, exponent));
  }, [viewport.zoom]);
  const effectiveGridStep = GRID_STEP * gridMultiplier;
  const effectiveGridPixels = Math.max(1, Math.round(effectiveGridStep * viewport.zoom));
  const gridOffsetX = useMemo(() => {
    if (!gridVisible || effectiveGridPixels <= 0) return 0;
    const mod = ((viewport.x % effectiveGridPixels) + effectiveGridPixels) % effectiveGridPixels;
    return Math.round(mod);
  }, [effectiveGridPixels, gridVisible, viewport.x]);
  const gridOffsetY = useMemo(() => {
    if (!gridVisible || effectiveGridPixels <= 0) return 0;
    const mod = ((viewport.y % effectiveGridPixels) + effectiveGridPixels) % effectiveGridPixels;
    return Math.round(mod);
  }, [effectiveGridPixels, gridVisible, viewport.y]);
  const panNudge = Math.max(20, Math.round(40 * viewport.zoom));
  const nodeTitleFontPx = Math.max(8, Math.round(11 * viewport.zoom));
  const nodeTypeFontPx = Math.max(7, Math.round(10 * viewport.zoom));
  const nodeIdFontPx = Math.max(6, Math.round(9 * viewport.zoom));
  const nodePadX = Math.max(4, Math.round(8 * viewport.zoom));
  const nodePadY = Math.max(2, Math.round(4 * viewport.zoom));
  const nodeHeaderMinHeight = Math.max(16, Math.round(22 * viewport.zoom));
  // Connectors scale with zoom but retain a minimal visible size.
  const portHitSize = clamp(Math.round(10 * viewport.zoom), 4, 12);
  const showNodeType = viewport.zoom >= 0.6;
  const showNodeId = viewport.zoom >= 0.85;
  const gridBackgroundStyle = useMemo(
    () => ({
      backgroundImage: gridVisible
        ? "radial-gradient(circle at 0.5px 0.5px, rgba(255,255,255,0.26) 0.85px, transparent 0.95px)"
        : "none",
      backgroundSize: `${effectiveGridPixels}px ${effectiveGridPixels}px`,
      backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
    }),
    [effectiveGridPixels, gridOffsetX, gridOffsetY, gridVisible]
  );
  const groupVisuals = useMemo(() => {
    if (!definition) return [];
    const groups = normalizeGroups(definition.nodes, definition.groups);
    const visuals: Array<{
      id: string;
      label: string;
      color: string;
      x: number;
      y: number;
      w: number;
      h: number;
      nodeIds: string[];
    }> = [];
    for (const group of groups) {
      const nodes = group.node_ids
        .map((id) => definition.nodes.find((n) => n.id === id))
        .filter((n): n is A2AWorkflowNode => Boolean(n));
      if (nodes.length === 0) continue;
      const xs = nodes.map((n) => (n.position?.x ?? 0));
      const ys = nodes.map((n) => (n.position?.y ?? 0));
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs.map((x) => x + NODE_W));
      const maxY = Math.max(...ys.map((y) => y + NODE_H));
      const padX = 24;
      const padY = 28;
      visuals.push({
        id: group.id,
        label: group.label,
        color: group.color ?? "rgba(56,189,248,0.12)",
        x: minX - padX,
        y: minY - padY,
        w: maxX - minX + padX * 2,
        h: maxY - minY + padY * 2,
        nodeIds: group.node_ids,
      });
    }
    return visuals;
  }, [definition]);

  return (
    <PanelWrapper
      title={(
        <div className="inline-flex items-center gap-2">
          <span className="text-text-med">Flow</span>
          {definition ? (
            <div className="inline-flex items-center gap-2">
              <div className="relative min-w-[220px] max-w-[460px]">
                <input
                  value={definition.name ?? ""}
                  onChange={(event) =>
                    patchDefinition((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  className="h-7 w-full rounded border border-line-med bg-transparent px-2 pr-7 text-sm text-text-norm focus:outline-none focus:ring-1 focus:ring-accent-primary/60"
                  placeholder="Workflow name"
                  aria-label="Workflow name"
                />
                <Pencil
                  size={12}
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-dark"
                />
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px]",
                  dirty ? "text-text-dark" : "text-accent-primary"
                )}
                title={dirty ? "Unsaved changes" : "Saved"}
              >
                {dirty ? <Save size={11} /> : <Check size={11} />}
                {dirty ? "Unsaved" : "Saved"}
              </span>
            </div>
          ) : (
            <span className="text-sm text-text-norm">Workflow</span>
          )}
        </div>
      )}
      icon={<Network size={16} className="text-accent-primary" />}
      actions={(
        <>
          <button
            onClick={() => void handleCreateWorkflow()}
            className="h-7 w-7 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
            title="New workflow"
          >
            <Plus size={14} />
          </button>
          <div className="relative" ref={openRecentRef}>
            <button
              onClick={() => {
                void reloadWorkflows();
                setOpenRecentMenu((v) => !v);
              }}
              className="h-7 w-7 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
              title="Open recent workflows"
            >
              <FolderOpen size={14} />
            </button>
            {openRecentMenu ? (
              <div className="absolute right-0 mt-1 w-72 max-h-72 overflow-auto rounded border border-line-med bg-bg-norm shadow-xl z-50">
                <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-dark border-b border-line-light">
                  Open Recent
                </div>
                {workflows.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-text-dark">No workflows found</div>
                ) : (
                  workflows.slice(0, 20).map((wf) => (
                    <button
                      key={wf.workflow_id}
                      onClick={() => {
                        void handleSelectWorkflow(wf.workflow_id);
                        setOpenRecentMenu(false);
                      }}
                      className="w-full text-left px-2 py-2 border-b border-line-light last:border-b-0 hover:bg-line-light"
                    >
                      <div className="text-xs text-text-norm truncate">{wf.name}</div>
                      <div className="text-[10px] text-text-dark">v{wf.version} • {wf.active ? "active" : "inactive"}</div>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
          <button
            onClick={() => void handleSave()}
            disabled={!definition || saving}
            className="h-7 w-7 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light disabled:opacity-60"
            title="Save"
          >
            <Save size={14} />
          </button>
          <button
            onClick={() => void handleDuplicateWorkflow()}
            disabled={!definition}
            className="h-7 w-7 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light disabled:opacity-60"
            title="Duplicate workflow"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={() => void handleDelete()}
            disabled={!currentWorkflowId}
            className="h-7 w-7 inline-flex items-center justify-center rounded text-text-med hover:text-accent-red hover:bg-accent-red/10 disabled:opacity-60"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
          <div className="w-px h-5 bg-line-light mx-1" />
          <button
            onClick={() => void handleImportWorkflow()}
            className="h-7 w-7 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
            title="Import workflow JSON"
          >
            <Upload size={14} />
          </button>
          <button
            onClick={() => void handleExportWorkflow()}
            disabled={!definition}
            className="h-7 w-7 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light disabled:opacity-60"
            title="Export workflow JSON"
          >
            <Download size={14} />
          </button>
        </>
      )}
      fill
    >
      <div className="h-full min-h-0 flex flex-col">
        {openTabs.length > 1 ? (
          <div className="h-9 border-b border-line-med bg-bg-norm flex items-center gap-1 px-2 overflow-x-auto">
            {openTabs.map((tab) => (
              <div
                key={tab.tabId}
                className={cn(
                  "h-7 pl-2 pr-1 rounded border inline-flex items-center gap-1 text-xs",
                  activeTabId === tab.tabId
                    ? "border-accent-primary/45 bg-accent-primary/10 text-text-norm"
                    : "border-line-light text-text-med hover:text-text-norm hover:bg-line-light"
                )}
              >
                <button
                  className="truncate max-w-[180px]"
                  onClick={() => void handleSelectWorkflow(tab.workflowId)}
                  title={tab.title}
                >
                  {tab.title}
                  {activeTabId === tab.tabId && dirty ? " •" : ""}
                </button>
                <button
                  className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-line-light"
                  onClick={() => void handleCloseTab(tab.tabId)}
                  title="Close tab"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className={cn("h-full grid min-h-0 flex-1", sidebarCollapsed ? "grid-cols-[56px_1fr]" : "grid-cols-[240px_1fr]")}>
        <div ref={collapsedSidebarRef} className="relative border-r border-line-med min-h-0 overflow-y-auto bg-bg-norm">
          {sidebarCollapsed ? (
            <div className="h-full flex flex-col items-center py-2 gap-1 overflow-y-auto">
              <button
                onClick={() => {
                  setSidebarCollapsed(false);
                  setCollapsedSectionPopup(null);
                }}
                className="h-8 w-8 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
                title="Expand sidebar"
              >
                <Menu size={14} />
              </button>
              <div className="w-8 h-px bg-line-light my-1" />
              {orderedLibrarySections.map((section) => (
                <button
                  key={`collapsed_section_${section.id}`}
                  onClick={(event) => {
                    const sidebarRect = collapsedSidebarRef.current?.getBoundingClientRect();
                    const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                    const top = sidebarRect ? rect.top - sidebarRect.top : 12;
                    setCollapsedSectionPopup((current) =>
                      current?.sectionId === section.id ? null : { sectionId: section.id, top }
                    );
                  }}
                  className={cn(
                    "h-8 w-8 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light",
                    collapsedSectionPopup?.sectionId === section.id && "text-text-norm bg-line-light"
                  )}
                  title={section.title}
                >
                  {librarySectionIcon(section.id)}
                </button>
              ))}
              <div className="w-8 h-px bg-line-light my-1" />
              <button
                onClick={(event) => {
                  const sidebarRect = collapsedSidebarRef.current?.getBoundingClientRect();
                  const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  const top = sidebarRect ? rect.top - sidebarRect.top : 12;
                  setCollapsedSectionPopup((current) =>
                    current?.sectionId === "runs" ? null : { sectionId: "runs", top }
                  );
                }}
                className={cn(
                  "h-8 w-8 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light",
                  collapsedSectionPopup?.sectionId === "runs" && "text-text-norm bg-line-light"
                )}
                title="Runs"
              >
                {librarySectionIcon("runs")}
              </button>
            </div>
          ) : (
            <>
              <div className="p-3 border-b border-line-light">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-text-dark">Menu</div>
                  <button
                    onClick={() => {
                      setSidebarCollapsed(true);
                      setCollapsedSectionPopup(null);
                    }}
                    className="h-7 w-7 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
                    title="Collapse sidebar"
                  >
                    <Menu size={14} />
                  </button>
                </div>
              </div>

              <div className="p-3 border-b border-line-light">
                <div className="text-[10px] uppercase tracking-wider text-text-dark mb-2">Node Library</div>
                <div className="space-y-2">
                  {orderedLibrarySections.map((section) => {
                    const expanded = libraryExpanded[section.id] ?? false;
                    return (
                      <div key={section.id} className="rounded border border-line-light">
                        <button
                          onClick={() => toggleLibrarySection(section.id)}
                          className="w-full px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-dark inline-flex items-center justify-between hover:bg-line-light"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-text-med">{librarySectionIcon(section.id)}</span>
                            <span>{section.title}</span>
                          </span>
                          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        </button>
                        {expanded ? (
                          <div className="p-1.5 pt-0 space-y-1">
                            {section.id === "templates"
                              ? (
                                <>
                                  <button
                                    onClick={() => void handleSaveCurrentAsTemplate()}
                                    disabled={!definition}
                                    className="w-full rounded border border-line-light px-2 py-1.5 text-left text-xs text-text-med hover:text-text-norm hover:bg-line-light disabled:opacity-60 inline-flex items-center gap-2"
                                  >
                                    <PlusSquare size={12} />
                                    <span className="truncate">Save Current As Template</span>
                                  </button>
                                  {libraryTemplates.map((tpl) => (
                                    <div
                                      key={tpl.id}
                                      className="w-full rounded border border-line-light px-2 py-1.5 text-left text-xs text-text-med hover:text-text-norm hover:bg-line-light inline-flex items-start gap-2"
                                    >
                                      <button
                                        onClick={() => void handleCreateFromTemplate(tpl)}
                                        className="flex-1 min-w-0 inline-flex items-start gap-2 text-left"
                                      >
                                        <span className="text-text-dark mt-0.5">{templateIcon(tpl.id)}</span>
                                        <span className="min-w-0">
                                          <div className="truncate">{tpl.name}</div>
                                          <div className="text-[10px] text-text-dark truncate">{tpl.description}</div>
                                        </span>
                                      </button>
                                      {tpl.source === "custom" ? (
                                        <button
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void handleDeleteTemplate(tpl.id);
                                          }}
                                          className="h-5 w-5 inline-flex items-center justify-center rounded text-text-dark hover:text-accent-red hover:bg-accent-red/10"
                                          title="Delete template"
                                        >
                                          <Trash2 size={11} />
                                        </button>
                                      ) : null}
                                    </div>
                                  ))}
                                </>
                              )
                              : section.items.map((item) => (
                                  <button
                                    key={item.type}
                                    onClick={() => handleAddNode(item)}
                                    disabled={!definition}
                                    draggable
                                    onDragStart={(event) => {
                                      event.dataTransfer.setData(NODE_DRAG_MIME, item.type);
                                      event.dataTransfer.setData("text/plain", item.type);
                                      event.dataTransfer.effectAllowed = "copy";
                                    }}
                                    className="w-full rounded border border-line-light px-2 py-1.5 text-left text-xs text-text-med hover:text-text-norm hover:bg-line-light disabled:opacity-60 inline-flex items-center gap-2"
                                  >
                                    <span className="text-text-dark">{nodeLibraryIcon(item.type)}</span>
                                    <span className="truncate">{item.name}</span>
                                  </button>
                                ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-text-dark mb-2">Runs</div>
                <div className="space-y-1">
                  {runs.map((run) => (
                    <button
                      key={run.run_id}
                      onClick={async () => {
                        setActiveRun(run.run_id);
                        const detail = await a2aWorkflowRunGet(run.run_id);
                        setRunDetail(detail);
                      }}
                      className={cn(
                        "w-full rounded border px-2 py-1.5 text-left text-xs transition-colors",
                        activeRunId === run.run_id
                          ? "border-accent-primary/40 bg-accent-primary/10 text-text-norm"
                          : "border-line-light text-text-med hover:text-text-norm hover:bg-line-light"
                      )}
                    >
                      <div className="inline-flex items-center gap-1">
                        <Play size={11} />
                        <span className="truncate">{run.status} • {run.trigger_type}</span>
                      </div>
                      <div className="text-[10px] text-text-dark truncate">{run.run_id}</div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {sidebarCollapsed && collapsedSectionPopup ? (
            <div
              className="absolute left-[52px] z-40 w-64 rounded border border-line-med bg-bg-norm/95 p-2 shadow-xl backdrop-blur-sm"
              style={{ top: clamp(collapsedSectionPopup.top, 8, 520) }}
            >
              <div className="mb-1 text-[10px] uppercase tracking-wider text-text-dark inline-flex items-center gap-1.5">
                <span className="text-text-med">{librarySectionIcon(collapsedSectionPopup.sectionId)}</span>
                <span>
                  {collapsedSectionPopup.sectionId === "runs"
                    ? "Runs"
                    : orderedLibrarySections.find((section) => section.id === collapsedSectionPopup.sectionId)?.title ?? "Section"}
                </span>
              </div>
              <div className="max-h-[60vh] overflow-y-auto space-y-1 pr-0.5">
                {collapsedSectionPopup.sectionId === "templates" ? (
                  <>
                    <button
                      onClick={() => void handleSaveCurrentAsTemplate()}
                      disabled={!definition}
                      className="w-full rounded border border-line-light px-2 py-1.5 text-left text-xs text-text-med hover:text-text-norm hover:bg-line-light disabled:opacity-60 inline-flex items-center gap-2"
                    >
                      <PlusSquare size={12} />
                      <span className="truncate">Save Current As Template</span>
                    </button>
                    {libraryTemplates.map((tpl) => (
                      <div
                        key={`collapsed_popup_tpl_${tpl.id}`}
                        className="w-full rounded border border-line-light px-2 py-1.5 text-left text-xs text-text-med hover:text-text-norm hover:bg-line-light inline-flex items-start gap-2"
                      >
                        <button
                          onClick={() => void handleCreateFromTemplate(tpl)}
                          className="flex-1 min-w-0 inline-flex items-start gap-2 text-left"
                        >
                          <span className="text-text-dark mt-0.5">{templateIcon(tpl.id)}</span>
                          <span className="min-w-0">
                            <div className="truncate">{tpl.name}</div>
                            <div className="text-[10px] text-text-dark truncate">{tpl.description}</div>
                          </span>
                        </button>
                        {tpl.source === "custom" ? (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDeleteTemplate(tpl.id);
                            }}
                            className="h-5 w-5 inline-flex items-center justify-center rounded text-text-dark hover:text-accent-red hover:bg-accent-red/10"
                            title="Delete template"
                          >
                            <Trash2 size={11} />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </>
                ) : collapsedSectionPopup.sectionId === "runs" ? (
                  runs.map((run) => (
                    <button
                      key={`collapsed_popup_run_${run.run_id}`}
                      onClick={async () => {
                        setActiveRun(run.run_id);
                        const detail = await a2aWorkflowRunGet(run.run_id);
                        setRunDetail(detail);
                        setCollapsedSectionPopup(null);
                      }}
                      className={cn(
                        "w-full rounded border px-2 py-1.5 text-left text-xs transition-colors",
                        activeRunId === run.run_id
                          ? "border-accent-primary/40 bg-accent-primary/10 text-text-norm"
                          : "border-line-light text-text-med hover:text-text-norm hover:bg-line-light"
                      )}
                    >
                      <div className="inline-flex items-center gap-1">
                        <Play size={11} />
                        <span className="truncate">{run.status} • {run.trigger_type}</span>
                      </div>
                    </button>
                  ))
                ) : (
                  (orderedLibrarySections.find((section) => section.id === collapsedSectionPopup.sectionId)?.items ?? []).map((item) => (
                    <button
                      key={`collapsed_popup_node_${item.type}`}
                      onClick={() => {
                        handleAddNode(item);
                        setCollapsedSectionPopup(null);
                      }}
                      disabled={!definition}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(NODE_DRAG_MIME, item.type);
                        event.dataTransfer.setData("text/plain", item.type);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      className="w-full rounded border border-line-light px-2 py-1.5 text-left text-xs text-text-med hover:text-text-norm hover:bg-line-light disabled:opacity-60 inline-flex items-center gap-2"
                    >
                      <span className="text-text-dark">{nodeLibraryIcon(item.type)}</span>
                      <span className="truncate">{item.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="relative min-h-0 overflow-hidden bg-bg-dark">
          <div className="absolute left-3 top-3 z-40 rounded border border-line-med bg-bg-norm/95 p-1 backdrop-blur-sm flex items-center gap-1">
            <button
              onClick={() => {
                const first = nodeLibrary[0];
                if (first) handleAddNode(first);
              }}
              disabled={!definition || nodeLibrary.length === 0}
              className="h-6 w-6 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light disabled:opacity-50"
              title="Add node"
            >
              <PlusSquare size={12} />
            </button>
            <button
              onClick={createGroupFromToolbar}
              disabled={!definition || definition.nodes.length === 0}
              className="h-6 w-6 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light disabled:opacity-50"
              title="Add group"
            >
              <FolderPlus size={12} />
            </button>
            <div className="w-px h-4 bg-line-light mx-0.5" />
            <button
              onClick={() => void handleSave()}
              disabled={!definition || saving}
              className="h-6 w-6 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light disabled:opacity-50"
              title="Save"
            >
              <Save size={12} />
            </button>
            <button
              onClick={() => void handleRun()}
              disabled={!currentWorkflowId || running || activeRunIsLive}
              className="h-6 w-6 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light disabled:opacity-50"
              title="Execute"
            >
              <Play size={12} />
            </button>
            <button
              onClick={() => void handlePauseRun()}
              disabled={!activeRunId || activeRunStatus !== "running"}
              className="h-6 w-6 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light disabled:opacity-50"
              title="Pause run"
            >
              <Pause size={12} />
            </button>
            <button
              onClick={() => void handleResumeRun()}
              disabled={!activeRunId || activeRunStatus !== "paused"}
              className="h-6 w-6 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light disabled:opacity-50"
              title="Resume run"
            >
              <RotateCcw size={12} />
            </button>
            <button
              onClick={() => void handleCancelRun()}
              disabled={!activeRunId || (activeRunStatus !== "running" && activeRunStatus !== "paused")}
              className="h-6 w-6 inline-flex items-center justify-center rounded text-text-med hover:text-accent-red hover:bg-accent-red/10 disabled:opacity-50"
              title="Cancel run"
            >
              <Square size={12} />
            </button>
            <div className="ml-1 px-1 py-0.5 rounded border border-line-light bg-bg-dark/50">
              <label className="text-[10px] text-text-dark mr-1">Max runtime</label>
              <select
                value={runTimeoutMs}
                onChange={(event) => setRunTimeoutMs(Number(event.target.value))}
                className="text-[10px] bg-transparent text-text-med outline-none"
                title="Workflow runtime timeout"
              >
                <option value={60000}>1m</option>
                <option value={120000}>2m</option>
                <option value={300000}>5m</option>
                <option value={600000}>10m</option>
                <option value={1800000}>30m</option>
              </select>
            </div>
          </div>
          <div
            ref={canvasRef}
            className="absolute inset-0 overflow-hidden"
            onWheel={handleWheel}
            onDragOver={(event) => {
              if (dragHasNodeTemplate(event)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={handleCanvasDrop}
            onPointerDown={(event) => {
              if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
                event.preventDefault();
                setPanState({
                  originClientX: event.clientX,
                  originClientY: event.clientY,
                  startViewportX: viewport.x,
                  startViewportY: viewport.y,
                });
                return;
              }
              const clickedInteractive = isCanvasInteractiveTarget(event.target);
              if (!clickedInteractive) {
                // Preserve selection for right-click context actions (e.g. Add To Group).
                // Clear selection only on primary-button empty-canvas clicks.
                if (event.button === 0) {
                  setSelectedNodeIds([]);
                  setSelectedGroupIds([]);
                  setPendingConnection(null);
                  setConnectionDrag(null);
                  const point = getCanvasPoint(event.clientX, event.clientY);
                  setMarqueeState({
                    originClientX: event.clientX,
                    originClientY: event.clientY,
                    startCanvasX: point.x,
                    startCanvasY: point.y,
                    currentCanvasX: point.x,
                    currentCanvasY: point.y,
                  });
                }
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({ kind: "canvas", x: event.clientX, y: event.clientY });
            }}
            style={{ cursor: panState ? "grabbing" : shiftPanReady ? "grab" : "default" }}
          >
            <div
              className="absolute inset-0 pointer-events-none"
              // CSS-only grid backdrop. Keep this layer non-interactive so all
              // pointer semantics belong to nodes/edges/context menu handlers.
              style={gridBackgroundStyle}
            />
            <div
              className="absolute left-0 top-0"
              style={{
                width: GRID_W * viewport.zoom,
                height: GRID_H * viewport.zoom,
                transform: `translate(${viewport.x}px, ${viewport.y}px)`,
                transformOrigin: "0 0",
              }}
              onPointerDown={(event) => {
                // Clicking empty world-space should always clear selection state.
                // This is important for creating new groups/nodes outside active groups.
                const clickedInteractive = isCanvasInteractiveTarget(event.target);
                if (!clickedInteractive) {
                  // Keep selection intact on right-click so context menu group actions
                  // can operate on the current multi-selection.
                  if (event.button === 0 && !event.shiftKey) {
                    setSelectedNodeIds([]);
                    setSelectedGroupIds([]);
                    setPendingConnection(null);
                    setConnectionDrag(null);
                    const point = getCanvasPoint(event.clientX, event.clientY);
                    setMarqueeState({
                      originClientX: event.clientX,
                      originClientY: event.clientY,
                      startCanvasX: point.x,
                      startCanvasY: point.y,
                      currentCanvasX: point.x,
                      currentCanvasY: point.y,
                    });
                  }
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ kind: "canvas", x: event.clientX, y: event.clientY });
              }}
            >
              {groupVisuals.map((group) => {
                const selected = selectedGroupIds.includes(group.id);
                return (
                  <div
                    key={group.id}
                    className={cn(
                      "absolute rounded-md border-2 border-dashed",
                      selected ? "border-accent-primary" : "border-slate-400/70"
                    )}
                    data-a2a-interactive="true"
                    style={{
                      left: group.x * viewport.zoom,
                      top: group.y * viewport.zoom,
                      width: group.w * viewport.zoom,
                      height: group.h * viewport.zoom,
                      backgroundColor: group.color,
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      // Group selection should always work on click; drag is optional.
                      setSelectedGroupIds([group.id]);
                      setSelectedNodeIds(group.nodeIds);
                      if (event.button === 0 && !event.shiftKey) {
                        startGroupDrag(event, group.id, group.nodeIds);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setSelectedGroupIds([group.id]);
                      setContextMenu({ kind: "group", groupId: group.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <div
                      data-a2a-interactive="true"
                      className="absolute left-2 -top-5 px-2 py-0.5 rounded bg-bg-norm/90 border border-line-med text-[10px] text-text-med"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        setSelectedGroupIds([group.id]);
                        setSelectedNodeIds(group.nodeIds);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setSelectedGroupIds([group.id]);
                        setContextMenu({ kind: "group", groupId: group.id, x: event.clientX, y: event.clientY });
                      }}
                    >
                      {group.label}
                    </div>
                  </div>
                );
              })}
              <svg className="absolute inset-0" width={GRID_W * viewport.zoom} height={GRID_H * viewport.zoom}>
                <defs>
                  <marker
                    id="a2a-edge-arrow-gray"
                    viewBox="0 0 10 10"
                    refX="10"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.9)" />
                  </marker>
                  <marker
                    id="a2a-edge-arrow-green"
                    viewBox="0 0 10 10"
                    refX="10"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(74,222,128,0.95)" />
                  </marker>
                  <marker
                    id="a2a-edge-arrow-blue"
                    viewBox="0 0 10 10"
                    refX="10"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(96,165,250,0.95)" />
                  </marker>
                </defs>
                {definition?.edges.map((edge) => {
                  const source = definition.nodes.find((n) => n.id === edge.source);
                  const target = definition.nodes.find((n) => n.id === edge.target);
                  if (!source || !target) return null;
                  const sourcePort = getPortById(edge.source_output, "source");
                  const targetPort = getPortById(edge.target_input, "target");
                  const s = sourcePort ? portWorldPosition(source, sourcePort) : centerOf(source);
                  const t = targetPort ? portWorldPosition(target, targetPort) : centerOf(target);
                  const sx = s.x * viewport.zoom;
                  const sy = s.y * viewport.zoom;
                  const rawTx = t.x * viewport.zoom;
                  const rawTy = t.y * viewport.zoom;
                  const vX = rawTx - sx;
                  const vY = rawTy - sy;
                  const vLen = Math.max(1, Math.hypot(vX, vY));
                  const ux = vX / vLen;
                  const uy = vY / vLen;
                  const half = Math.max(2, portHitSize / 2);
                  const borderDistance =
                    targetPort?.shape === "square"
                      ? half / Math.max(Math.abs(ux), Math.abs(uy), 0.0001)
                      : half;
                  const tx = rawTx - ux * borderDistance;
                  const ty = rawTy - uy * borderDistance;
                  const dx = Math.max(40 * viewport.zoom, Math.abs(tx - sx) * 0.33);
                  const cx1 = sx + dx;
                  const cx2 = tx - dx;
                  const stroke = edgeColor(definition, edge);
                  const isHovered = hoveredEdgeId === edge.id;
                  return (
                    <path
                      key={edge.id}
                      data-a2a-interactive="true"
                      d={`M ${sx} ${sy} C ${cx1} ${sy}, ${cx2} ${ty}, ${tx} ${ty}`}
                      stroke={stroke}
                      strokeWidth={isHovered ? 3 : 1.5}
                      fill="none"
                      markerEnd={`url(#${edgeMarkerId(definition, edge)})`}
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                      onMouseEnter={() => setHoveredEdgeId(edge.id)}
                      onMouseLeave={() =>
                        setHoveredEdgeId((current) => (current === edge.id ? null : current))
                      }
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        removeEdge(edge.id);
                      }}
                    />
                  );
                })}
                {definition && connectionDrag ? (() => {
                  const sourceNode = definition.nodes.find((n) => n.id === connectionDrag.sourceNodeId);
                  const sourcePort = getPortById(connectionDrag.sourcePortId, "source");
                  if (!sourceNode || !sourcePort) return null;
                  const s = portWorldPosition(sourceNode, sourcePort);
                  const sx = s.x * viewport.zoom;
                  const sy = s.y * viewport.zoom;
                  const tx = connectionDrag.pointerX - viewport.x;
                  const ty = connectionDrag.pointerY - viewport.y;
                  const dx = Math.max(30 * viewport.zoom, Math.abs(tx - sx) * 0.33);
                  const cx1 = sx + dx;
                  const cx2 = tx - dx;
                  const stroke = sourcePort.role === "flow" ? "rgba(74,222,128,0.8)" : "rgba(96,165,250,0.8)";
                  return (
                    <path
                      d={`M ${sx} ${sy} C ${cx1} ${sy}, ${cx2} ${ty}, ${tx} ${ty}`}
                      stroke={stroke}
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      fill="none"
                      style={{ pointerEvents: "none" }}
                    />
                  );
                })() : null}
              </svg>

              {definition?.nodes.map((node) => {
                const p = node.position ?? { x: 0, y: 0 };
                const status = nodeStatus(node.id);
                return (
                  <div
                    key={node.id}
                    data-a2a-interactive="true"
                    className={cn(
                      "absolute rounded border shadow-sm select-none",
                      selectedNodeIds.includes(node.id)
                        ? "border-accent-primary bg-bg-norm"
                        : "bg-bg-norm/95"
                    )}
                    style={{
                      left: p.x * viewport.zoom,
                      top: p.y * viewport.zoom,
                      width: NODE_W * viewport.zoom,
                      height: NODE_H * viewport.zoom,
                      borderColor: selectedNodeIds.includes(node.id) ? undefined : "#94a3b8",
                    }}
                    onPointerDown={(event) => {
                      if (event.button === 0 && event.shiftKey) {
                        event.preventDefault();
                        event.stopPropagation();
                        setPanState({
                          originClientX: event.clientX,
                          originClientY: event.clientY,
                          startViewportX: viewport.x,
                          startViewportY: viewport.y,
                        });
                        return;
                      }
                      event.stopPropagation();
                      if (event.shiftKey) {
                        const exists = selectedNodeIds.includes(node.id);
                        setSelectedNodeIds(
                          exists ? selectedNodeIds.filter((id) => id !== node.id) : [...selectedNodeIds, node.id]
                        );
                      } else {
                        setSelectedNodeIds([node.id]);
                        setSelectedGroupIds([]);
                      }
                      startNodeDrag(event, node.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!selectedNodeIds.includes(node.id)) {
                        setSelectedNodeIds([node.id]);
                      }
                      setContextMenu({ kind: "node", nodeId: node.id, x: event.clientX, y: event.clientY });
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      setSelectedNodeIds([node.id]);
                      setInspectorNodeId(node.id);
                    }}
                  >
                    {NODE_PORTS.map((port) => {
                      const fraction = (port.index + 1) / (port.count + 1);
                      const relX =
                        port.side === "left"
                          ? 0
                          : port.side === "right"
                          ? 100
                          : fraction * 100;
                      const relY =
                        port.side === "top"
                          ? 0
                          : port.side === "bottom"
                          ? 100
                          : fraction * 100;
                      const transform =
                        "translate(-50%, -50%)";
                      const isPendingSource =
                        pendingConnection?.sourceNodeId === node.id &&
                        pendingConnection.sourcePortId === port.id;
                      const sourcePort = pendingConnection
                        ? getPortById(pendingConnection.sourcePortId, "source")
                        : null;
                      const compatibleTarget = sourcePort
                        ? pendingConnection?.sourceNodeId !== node.id &&
                          isConnectionCompatible(sourcePort, port) &&
                          supportsIn(port.direction)
                        : false;
                      const incompatibleTarget = Boolean(
                        pendingConnection &&
                          pendingConnection.sourceNodeId !== node.id &&
                          (!sourcePort || !compatibleTarget)
                      );
                      const count = definition
                        ? totalPortConnections(definition.edges, node.id, port.id)
                        : 0;
                      const isAgentBindingPort =
                        node.type === "ai.agent" &&
                        (port.role === "memory" || port.role === "skills" || port.role === "tools");
                      const bindingCount =
                        port.role === "memory"
                          ? readNodeMemoryRefs((node.params ?? {}) as Record<string, unknown>).length
                          : port.role === "skills"
                          ? readNodeSkills((node.params ?? {}) as Record<string, unknown>).length
                          : port.role === "tools"
                          ? readNodeTools((node.params ?? {}) as Record<string, unknown>).length
                          : 0;
                      const displayCount = isAgentBindingPort ? bindingCount : count;
                      const portEdges = definition
                        ? definition.edges.filter(
                            (edge) =>
                              (edge.source === node.id && edge.source_output === port.id) ||
                              (edge.target === node.id && edge.target_input === port.id)
                          )
                        : [];
                      const portReady = definition
                        ? portEdges.some((edge) => edgeColor(definition, edge) !== "rgba(148,163,184,0.75)")
                        : false;
                      const connectedColor = portReady
                        ? port.role === "flow"
                          ? "rgba(74,222,128,0.95)"
                          : "rgba(96,165,250,0.95)"
                        : isAgentBindingPort && bindingCount > 0
                        ? "rgba(96,165,250,0.95)"
                        : "rgba(148,163,184,0.85)";

                      return (
                        <button
                          key={`${node.id}_${port.id}`}
                          data-a2a-interactive="true"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (isAgentBindingPort) {
                              setConnectorPicker({
                                nodeId: node.id,
                                role: port.role as ConnectorRole,
                                x: event.clientX,
                                y: event.clientY,
                              });
                              return;
                            }
                            onPortClick(node.id, port.id);
                          }}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (isAgentBindingPort) return;
                            if (!supportsOut(port.direction)) return;
                            const point = getCanvasPoint(event.clientX, event.clientY);
                            setPendingConnection({ sourceNodeId: node.id, sourcePortId: port.id });
                            setConnectionDrag({
                              sourceNodeId: node.id,
                              sourcePortId: port.id,
                              pointerX: point.x,
                              pointerY: point.y,
                            });
                          }}
                          onPointerUp={(event) => {
                            if (!connectionDrag) return;
                            event.preventDefault();
                            event.stopPropagation();
                            const connected = tryConnectPorts(
                              connectionDrag.sourceNodeId,
                              connectionDrag.sourcePortId,
                              node.id,
                              port.id
                            );
                            if (connected) setPendingConnection(null);
                            setConnectionDrag(null);
                          }}
                          onMouseEnter={(event) => {
                            const roleLabel = port.role.charAt(0).toUpperCase() + port.role.slice(1);
                            setPortHover({
                              x: event.clientX + 10,
                              y: event.clientY + 10,
                              text: `${port.label} • ${roleLabel}`,
                            });
                          }}
                          onMouseLeave={() => setPortHover(null)}
                          className={cn(
                            "absolute border border-transparent hover:border-slate-100 bg-slate-400 hover:bg-slate-300 inline-flex items-center justify-center",
                            port.shape === "circle" ? "rounded-full" : "rounded-[2px]",
                            isPendingSource && "ring-2 ring-accent-primary/80",
                            compatibleTarget && "ring-2 ring-accent-green/80",
                            incompatibleTarget && "opacity-50"
                          )}
                          style={{
                            width: portHitSize,
                            height: portHitSize,
                            left: `${relX}%`,
                            top: `${relY}%`,
                            transform,
                            borderColor: displayCount > 0 ? connectedColor : undefined,
                          }}
                          title={`${port.label} (${port.role})`}
                        >
                          {displayCount > 0 ? (
                            <span className="absolute -right-1 -top-1 min-w-3 h-3 px-0.5 rounded-full bg-accent-primary text-[8px] leading-3 text-white">
                              {displayCount}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                    <div
                      className="border-b border-line-light flex items-center justify-between"
                      style={{ padding: `${nodePadY}px ${nodePadX}px`, minHeight: nodeHeaderMinHeight }}
                    >
                      <span className="font-medium text-text-norm truncate" style={{ fontSize: nodeTitleFontPx }}>
                        {node.name}
                      </span>
                      <div className="flex items-center gap-1">
                        {showNodeType ? (
                          <span className="px-1.5 py-0.5 rounded bg-line-light text-[9px] text-text-med max-w-[70px] truncate">
                            {typeof node.params?.model === "string" && node.params.model.trim()
                              ? node.params.model.trim()
                              : "model:auto"}
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full",
                            status === "succeeded"
                              ? "bg-accent-green"
                              : status === "failed"
                              ? "bg-accent-red"
                              : status === "running"
                              ? "bg-accent-gold animate-pulse"
                              : "bg-line-dark"
                          )}
                        />
                      </div>
                    </div>
                    {showNodeType ? (
                      <div
                        className="text-text-dark truncate"
                        style={{ padding: `${nodePadY}px ${nodePadX}px`, fontSize: nodeTypeFontPx }}
                      >
                        {node.type}
                      </div>
                    ) : null}
                    {showNodeId ? (
                      <div
                        className="absolute text-text-dark"
                        style={{ right: Math.max(2, nodePadX - 1), bottom: Math.max(2, nodePadY - 1), fontSize: nodeIdFontPx }}
                      >
                        {node.id}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          {marqueeState ? (
            <div
              className="absolute z-30 border border-accent-primary/70 bg-accent-primary/15 pointer-events-none"
              style={{
                left: Math.min(marqueeState.startCanvasX, marqueeState.currentCanvasX),
                top: Math.min(marqueeState.startCanvasY, marqueeState.currentCanvasY),
                width: Math.abs(marqueeState.currentCanvasX - marqueeState.startCanvasX),
                height: Math.abs(marqueeState.currentCanvasY - marqueeState.startCanvasY),
              }}
            />
          ) : null}
          {contextMenu && (
            <div
              data-a2a-interactive="true"
              className="fixed z-50 min-w-44 rounded border border-line-med bg-bg-norm shadow-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {(contextMenu.kind === "node" || contextMenu.kind === "canvas") ? (
                <>
                  {contextMenu.kind === "canvas" ? (
                    <>
                      <button
                        className="block w-full text-left px-2 py-1.5 text-xs text-text-med hover:bg-line-light hover:text-text-norm"
                        onClick={() => {
                          const first = nodeLibrary[0];
                          if (first) handleAddNode(first);
                          setContextMenu(null);
                        }}
                      >
                        New Node
                      </button>
                      <button
                        className="block w-full text-left px-2 py-1.5 text-xs text-text-med hover:bg-line-light hover:text-text-norm disabled:opacity-50"
                        disabled={selectedNodeIds.length < 1}
                        onClick={createGroupFromSelection}
                      >
                        New Group
                      </button>
                      <div className="h-px bg-line-light" />
                    </>
                  ) : null}
                  {contextMenu.kind === "node" ? (
                    <>
                      <button
                        className="block w-full text-left px-2 py-1.5 text-xs text-text-med hover:bg-line-light hover:text-text-norm"
                        onClick={() => {
                          setInspectorNodeId(contextMenu.nodeId);
                          setContextMenu(null);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="block w-full text-left px-2 py-1.5 text-xs text-text-med hover:bg-line-light hover:text-text-norm"
                        onClick={() => {
                          autoWireNode(contextMenu.nodeId);
                        }}
                      >
                        Auto-wire Compatible
                      </button>
                      <div className="h-px bg-line-light" />
                    </>
                  ) : null}
                  {selectedNodeIds.length >= 2 ? (
                    <button
                      className="block w-full text-left px-2 py-1.5 text-xs text-text-med hover:bg-line-light hover:text-text-norm"
                      onClick={createGroupFromSelection}
                    >
                      Add To Group
                    </button>
                  ) : null}
                  {contextMenu.kind === "node" ? (
                    <>
                      <button
                        className="block w-full text-left px-2 py-1.5 text-xs text-text-med hover:bg-line-light hover:text-text-norm"
                        onClick={() => upsertNodeParam("model")}
                      >
                        Change Model
                      </button>
                      <button
                        className="block w-full text-left px-2 py-1.5 text-xs text-text-med hover:bg-line-light hover:text-text-norm"
                        onClick={() => upsertNodeParam("skill")}
                      >
                        Add Skill
                      </button>
                      <button
                        className="block w-full text-left px-2 py-1.5 text-xs text-text-med hover:bg-line-light hover:text-text-norm"
                        onClick={() => upsertNodeParam("memory")}
                      >
                        Add Memory Item
                      </button>
                      <button
                        className="block w-full text-left px-2 py-1.5 text-xs text-text-med hover:bg-line-light hover:text-text-norm"
                        onClick={() => upsertNodeParam("tool")}
                      >
                        Add Tool
                      </button>
                      <button
                        className="block w-full text-left px-2 py-1.5 text-xs text-text-med hover:bg-line-light hover:text-text-norm"
                        onClick={() => upsertNodeParam("api")}
                      >
                        Add API
                      </button>
                      {selectedNodeInAnyGroup ? (
                        <button
                          className="block w-full text-left px-2 py-1.5 text-xs text-text-med hover:bg-line-light hover:text-text-norm"
                          onClick={removeNodeFromGroupFromContext}
                        >
                          Remove from Group
                        </button>
                      ) : null}
                      <div className="h-px bg-line-light" />
                      <button
                        className="block w-full text-left px-2 py-1.5 text-xs text-accent-red hover:bg-accent-red/10"
                        onClick={removeNodeFromContext}
                      >
                        Delete Node
                      </button>
                    </>
                  ) : null}
                </>
              ) : null}
              {contextMenu.kind === "group" ? (
                <>
                  <button
                    className="block w-full text-left px-2 py-1.5 text-xs text-text-med hover:bg-line-light hover:text-text-norm"
                    onClick={renameGroupFromContext}
                  >
                    Rename Group
                  </button>
                  <button
                    className="block w-full text-left px-2 py-1.5 text-xs text-accent-red hover:bg-accent-red/10"
                    onClick={removeGroupFromContext}
                  >
                    Remove Group
                  </button>
                </>
              ) : null}
            </div>
          )}
          {connectorPicker && connectorNode && connectorNode.type === "ai.agent" ? (
            <div
              ref={connectorPickerRef}
              data-a2a-interactive="true"
              className="fixed z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded border border-line-med bg-bg-norm shadow-xl"
              style={{ left: clamp(connectorPicker.x + 8, 8, window.innerWidth - 296), top: clamp(connectorPicker.y + 8, 8, window.innerHeight - 380) }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-line-light px-2.5 py-2">
                <div className="text-xs text-text-norm">
                  {connectorPicker.role === "memory"
                    ? "Memory"
                    : connectorPicker.role === "skills"
                    ? "Skills"
                    : "Tools"}
                </div>
                <button
                  className="h-5 w-5 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
                  onClick={() => setConnectorPicker(null)}
                >
                  <X size={11} />
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto p-2 space-y-1">
                {connectorPickerLoading ? (
                  <div className="text-xs text-text-dark px-1 py-1">Loading…</div>
                ) : null}
                {connectorPickerError ? (
                  <div className="text-xs text-accent-red px-1 py-1">{connectorPickerError}</div>
                ) : null}

                {!connectorPickerLoading && connectorPicker.role === "skills" ? (
                  availableSkills.length > 0 ? (
                    availableSkills.map((skill) => {
                      const checked = selectedSkills.includes(skill.id);
                      return (
                        <button
                          key={`skill_pick_${skill.id}`}
                          className={cn(
                            "w-full rounded border px-2 py-1.5 text-left text-xs transition-colors",
                            checked
                              ? "border-accent-primary/50 bg-accent-primary/10 text-text-norm"
                              : "border-line-light text-text-med hover:text-text-norm hover:bg-line-light"
                          )}
                          onClick={() => toggleNodeSkill(connectorPicker.nodeId, skill.id)}
                        >
                          <div className="inline-flex items-center gap-1">
                            {checked ? <Check size={11} /> : <span className="inline-block h-[11px] w-[11px]" />}
                            <span className="truncate">{skill.name}</span>
                          </div>
                          <div className="truncate text-[10px] text-text-dark mt-0.5">{skill.id}</div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="text-xs text-text-dark px-1 py-1">No skills found.</div>
                  )
                ) : null}

                {!connectorPickerLoading && connectorPicker.role === "tools" ? (
                  enabledTools.length > 0 ? (
                    enabledTools.map((tool) => {
                      const checked = selectedTools.includes(tool.id);
                      return (
                        <button
                          key={`tool_pick_${tool.id}`}
                          className={cn(
                            "w-full rounded border px-2 py-1.5 text-left text-xs transition-colors",
                            checked
                              ? "border-accent-primary/50 bg-accent-primary/10 text-text-norm"
                              : "border-line-light text-text-med hover:text-text-norm hover:bg-line-light"
                          )}
                          onClick={() => toggleNodeTool(connectorPicker.nodeId, tool.id)}
                        >
                          <div className="inline-flex items-center gap-1">
                            {checked ? <Check size={11} /> : <span className="inline-block h-[11px] w-[11px]" />}
                            <span className="truncate">{tool.title}</span>
                          </div>
                          <div className="truncate text-[10px] text-text-dark mt-0.5">{tool.id}</div>
                        </button>
                      );
                    })
                  ) : (
                    <div className="text-xs text-text-dark px-1 py-1">No enabled tools.</div>
                  )
                ) : null}

                {!connectorPickerLoading && connectorPicker.role === "memory" ? (
                  <>
                    {availableMemoryRefs.length > 0 ? (
                      availableMemoryRefs.map((ref) => {
                        const checked = selectedMemoryRefs.some((entry) => memoryRefId(entry) === memoryRefId(ref));
                        return (
                          <button
                            key={`mem_pick_${memoryRefId(ref)}`}
                            className={cn(
                              "w-full rounded border px-2 py-1.5 text-left text-xs transition-colors",
                              checked
                                ? "border-accent-primary/50 bg-accent-primary/10 text-text-norm"
                                : "border-line-light text-text-med hover:text-text-norm hover:bg-line-light"
                            )}
                            onClick={() => toggleNodeMemoryRef(connectorPicker.nodeId, ref)}
                          >
                            <div className="inline-flex items-center gap-1">
                              {checked ? <Check size={11} /> : <span className="inline-block h-[11px] w-[11px]" />}
                              <span className="truncate">{ref.namespace}/{ref.key}</span>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="text-xs text-text-dark px-1 py-1">No memory entries found.</div>
                    )}
                    <div className="mt-2 border-t border-line-light pt-2">
                      <div className="grid grid-cols-2 gap-1">
                        <input
                          value={manualMemoryNamespace}
                          onChange={(event) => setManualMemoryNamespace(event.target.value)}
                          className="w-full rounded border border-line-light bg-bg-dark px-2 py-1 text-[11px] text-text-norm"
                          placeholder="namespace"
                        />
                        <input
                          value={manualMemoryKey}
                          onChange={(event) => setManualMemoryKey(event.target.value)}
                          className="w-full rounded border border-line-light bg-bg-dark px-2 py-1 text-[11px] text-text-norm"
                          placeholder="key"
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addManualMemoryRef();
                            }
                          }}
                        />
                      </div>
                      <button
                        onClick={addManualMemoryRef}
                        className="mt-1.5 w-full rounded border border-line-light px-2 py-1 text-[11px] text-text-med hover:bg-line-light hover:text-text-norm"
                      >
                        Add Memory Reference
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
          {portHover ? (
            <div
              className="fixed z-50 pointer-events-none rounded border border-line-med bg-bg-norm/95 px-2 py-1 text-[10px] text-text-med shadow-lg"
              style={{ left: portHover.x, top: portHover.y }}
            >
              {portHover.text}
            </div>
          ) : null}
          <div data-a2a-interactive="true" className="absolute right-3 top-3 z-40 flex items-start gap-2">
            <div className="rounded border border-line-med bg-bg-norm/95 px-2 py-1.5 backdrop-blur-sm">
              <div className="flex items-center gap-1">
              <button
                onClick={() => nudgeZoom(1)}
                className="h-6 w-6 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
                title="Zoom in"
              >
                <ZoomIn size={12} />
              </button>
              <div className="min-w-12 text-center text-[10px] text-text-med tabular-nums">
                {formatZoomPercent(viewport.zoom)}
              </div>
              <button
                onClick={() => nudgeZoom(-1)}
                className="h-6 w-6 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
                title="Zoom out"
              >
                <ZoomOut size={12} />
              </button>
              <button
                onClick={() => setViewport({ x: 0, y: 0, zoom: 1 })}
                className="h-6 w-6 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
                title="Reset view"
              >
                <RotateCcw size={12} />
              </button>
              <button
                onClick={() => setGridVisible((v) => !v)}
                className={cn(
                  "h-6 w-6 inline-flex items-center justify-center rounded",
                  gridVisible
                    ? "text-accent-primary bg-accent-primary/10"
                    : "text-text-med hover:text-text-norm hover:bg-line-light"
                )}
                title="Toggle grid"
              >
                <Grid3X3 size={12} />
              </button>
            </div>
            </div>
            <div className="rounded border border-line-med bg-bg-norm/95 p-1 backdrop-blur-sm">
              <div className="grid grid-cols-3 gap-0.5">
                <span />
                <button
                  onClick={() => setViewport({ ...viewport, y: viewport.y + panNudge })}
                  className="h-5 w-5 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
                  title="Pan up"
                >
                  <ChevronUp size={11} />
                </button>
                <span />
                <button
                  onClick={() => setViewport({ ...viewport, x: viewport.x + panNudge })}
                  className="h-5 w-5 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
                  title="Pan left"
                >
                  <ChevronLeft size={11} />
                </button>
                <button
                  onClick={() => setViewport({ x: 0, y: 0, zoom: viewport.zoom })}
                  className="h-5 w-5 inline-flex items-center justify-center rounded text-[8px] text-text-med hover:text-text-norm hover:bg-line-light"
                  title="Center position"
                >
                  C
                </button>
                <button
                  onClick={() => setViewport({ ...viewport, x: viewport.x - panNudge })}
                  className="h-5 w-5 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
                  title="Pan right"
                >
                  <ChevronRight size={11} />
                </button>
                <span />
                <button
                  onClick={() => setViewport({ ...viewport, y: viewport.y - panNudge })}
                  className="h-5 w-5 inline-flex items-center justify-center rounded text-text-med hover:text-text-norm hover:bg-line-light"
                  title="Pan down"
                >
                  <ChevronDown size={11} />
                </button>
                <span />
              </div>
            </div>
          </div>
          {inspectorNode && inspectorStyle && (
            <div
              data-a2a-interactive="true"
              className="absolute z-40 w-[860px] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-full rounded border border-line-med bg-bg-norm/95 shadow-2xl backdrop-blur-sm"
              style={{ left: inspectorStyle.left, top: inspectorStyle.top }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-line-light">
                <div className="text-xs text-text-norm">
                  {inspectorNode.name}
                  <span className="ml-2 text-[10px] text-text-dark">{inspectorNode.type}</span>
                </div>
                <button
                  className="h-6 px-2 rounded text-xs text-text-med hover:text-text-norm hover:bg-line-light"
                  onClick={() => setInspectorNodeId(null)}
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-3 gap-0 min-h-[260px] max-h-[420px]">
                <div className="border-r border-line-light p-2 min-h-0 overflow-auto">
                  <div className="text-[10px] uppercase tracking-wider text-text-dark mb-1">Input</div>
                  <pre className="text-[10px] font-mono leading-4 bg-bg-dark rounded p-2 max-h-[330px] overflow-auto">
                    {inspectorNodeRun?.input_json ?? "No input captured yet"}
                  </pre>
                </div>
                <div className="border-r border-line-light p-2 min-h-0 overflow-auto">
                  <div className="text-[10px] uppercase tracking-wider text-text-dark mb-1">Work</div>
                  <textarea
                    value={nodeParamsText}
                    onChange={(e) => setNodeParamsText(e.target.value)}
                    className="w-full min-h-[180px] rounded border border-line-med bg-bg-dark px-2 py-1 text-[11px] font-mono text-text-norm"
                  />
                  <div className="mt-2 flex gap-1">
                    <button
                      onClick={saveSelectedNodeParams}
                      className="flex-1 h-7 rounded bg-line-light text-text-med hover:text-text-norm hover:bg-line-med text-xs"
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => void runNodeTest()}
                      className="h-7 px-2 rounded bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30 text-xs inline-flex items-center gap-1"
                    >
                      <TestTube2 size={12} />
                      Test
                    </button>
                  </div>
                </div>
                <div className="p-2 min-h-0 overflow-auto">
                  <div className="text-[10px] uppercase tracking-wider text-text-dark mb-1">Output</div>
                  <pre className="text-[10px] font-mono leading-4 bg-bg-dark rounded p-2 max-h-[330px] overflow-auto">
                    {inspectorNodeRun?.output_json ?? "No output captured yet"}
                  </pre>
                  {inspectorNodeRun?.error ? (
                    <div className="mt-2 text-[10px] text-accent-red">{inspectorNodeRun.error}</div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div className="absolute left-3 top-3 text-xs text-text-med bg-bg-norm/90 border border-line-med rounded px-2 py-1">
              Loading...
            </div>
          )}
          {error && (
            <div className="absolute left-3 bottom-16 z-[120] max-w-[60%] text-xs text-accent-red bg-bg-norm/95 border border-accent-red/40 rounded px-2 py-1">
              {error}
            </div>
          )}
        </div>

      </div>
      </div>
    </PanelWrapper>
  );
}
