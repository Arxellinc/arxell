import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type McpTransport = "stdio" | "http" | "sse" | "websocket";
export type McpServerStatus = "stopped" | "running" | "error";
export type McpSourceKind = "registry" | "github" | "url";
export type McpServerOrigin = "manual" | "external" | "package";
export type McpTemplateSeed = "official" | "community" | "empty";

export interface McpServer {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  endpoint: string;
  command: string;
  args: string;
  env_json: string;
  enabled: boolean;
  status: McpServerStatus;
  tools: string[];
  auth_required: boolean;
  last_error: string | null;
  origin: McpServerOrigin;
  source_label: string | null;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface McpServerTemplate {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  endpoint: string;
  command: string;
  args: string;
  env_json: string;
  tools: string[];
  auth_required: boolean;
}

export interface McpExternalSource {
  id: string;
  name: string;
  kind: McpSourceKind;
  location: string;
  description: string;
  enabled: boolean;
  templates: McpServerTemplate[];
  created_at: string;
  updated_at: string;
}

export interface McpPackage {
  id: string;
  name: string;
  version: string;
  description: string;
  transport: McpTransport;
  endpoint: string;
  command: string;
  args: string;
  env_json: string;
  tools: string[];
  created_at: string;
  updated_at: string;
}

interface McpState {
  servers: McpServer[];
  externalSources: McpExternalSource[];
  packages: McpPackage[];
  addServer: (server: Omit<McpServer, "id" | "created_at" | "updated_at">) => McpServer;
  updateServer: (
    id: string,
    patch: Partial<
      Pick<
        McpServer,
        | "name"
        | "description"
        | "transport"
        | "endpoint"
        | "command"
        | "args"
        | "env_json"
        | "enabled"
        | "status"
        | "tools"
        | "auth_required"
        | "last_error"
        | "origin"
        | "source_label"
        | "source_ref"
      >
    >
  ) => void;
  removeServer: (id: string) => void;
  addExternalSource: (
    source: Omit<McpExternalSource, "id" | "created_at" | "updated_at">
  ) => McpExternalSource;
  removeExternalSource: (id: string) => void;
  setExternalSourceEnabled: (id: string, enabled: boolean) => void;
  importTemplateToServer: (sourceId: string, templateId: string) => McpServer | null;
  addPackage: (pkg: Omit<McpPackage, "id" | "created_at" | "updated_at">) => McpPackage;
  removePackage: (id: string) => void;
  installPackageAsServer: (packageId: string) => McpServer | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
}

function cloneTemplate(template: McpServerTemplate): McpServerTemplate {
  return {
    ...template,
    tools: [...template.tools],
  };
}

const OFFICIAL_TEMPLATES: McpServerTemplate[] = [
  {
    id: "official-filesystem",
    name: "Filesystem MCP",
    description: "Read/write access helpers for workspace files.",
    transport: "stdio",
    endpoint: "",
    command: "npx",
    args: "-y @modelcontextprotocol/server-filesystem",
    env_json: '{"MCP_ROOT":"/workspace"}',
    tools: ["fs.read", "fs.write", "fs.list"],
    auth_required: false,
  },
  {
    id: "official-github",
    name: "GitHub MCP",
    description: "Repository and issue operations through GitHub APIs.",
    transport: "http",
    endpoint: "https://mcp.github.tools/v1",
    command: "",
    args: "",
    env_json: '{"GITHUB_TOKEN":"${GITHUB_TOKEN}"}',
    tools: ["github.search", "github.issue.get", "github.pr.list"],
    auth_required: true,
  },
];

const COMMUNITY_TEMPLATES: McpServerTemplate[] = [
  {
    id: "community-jira",
    name: "Jira MCP",
    description: "Jira project, issue, and sprint operations.",
    transport: "http",
    endpoint: "https://mcp.community.tools/jira",
    command: "",
    args: "",
    env_json: '{"JIRA_TOKEN":"${JIRA_TOKEN}","JIRA_BASE_URL":"https://example.atlassian.net"}',
    tools: ["jira.search", "jira.issue.get", "jira.issue.transition"],
    auth_required: true,
  },
  {
    id: "community-slack",
    name: "Slack MCP",
    description: "Channel history and message posting tools.",
    transport: "sse",
    endpoint: "https://mcp.community.tools/slack/sse",
    command: "",
    args: "",
    env_json: '{"SLACK_BOT_TOKEN":"${SLACK_BOT_TOKEN}"}',
    tools: ["slack.channels.list", "slack.messages.read", "slack.messages.post"],
    auth_required: true,
  },
];

export function getSeedTemplates(seed: McpTemplateSeed): McpServerTemplate[] {
  if (seed === "official") return OFFICIAL_TEMPLATES.map(cloneTemplate);
  if (seed === "community") return COMMUNITY_TEMPLATES.map(cloneTemplate);
  return [];
}

const INITIAL_SERVERS: McpServer[] = [
  {
    id: "mcp_docs",
    name: "Docs MCP",
    description: "Internal docs and knowledge base lookup",
    transport: "http",
    endpoint: "http://127.0.0.1:7777/mcp",
    command: "",
    args: "",
    env_json: "{}",
    enabled: true,
    status: "running",
    tools: ["docs.search", "docs.get_page", "docs.list_spaces"],
    auth_required: false,
    last_error: null,
    origin: "manual",
    source_label: null,
    source_ref: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  },
  {
    id: "mcp_repo",
    name: "Repo MCP",
    description: "Repository intelligence and issue context",
    transport: "stdio",
    endpoint: "",
    command: "npx",
    args: "-y @modelcontextprotocol/server-git",
    env_json: '{"REPO_PATH":"/workspace"}',
    enabled: false,
    status: "stopped",
    tools: ["repo.status", "repo.diff", "repo.blame"],
    auth_required: false,
    last_error: null,
    origin: "manual",
    source_label: null,
    source_ref: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  },
];

const INITIAL_SOURCES: McpExternalSource[] = [
  {
    id: "source_official",
    name: "Official MCP Registry",
    kind: "registry",
    location: "https://registry.modelcontextprotocol.io",
    description: "Curated templates from official MCP projects.",
    enabled: true,
    templates: getSeedTemplates("official"),
    created_at: nowIso(),
    updated_at: nowIso(),
  },
];

const INITIAL_PACKAGES: McpPackage[] = [
  {
    id: "pkg_workspace",
    name: "Workspace Utilities",
    version: "0.1.0",
    description: "Local helpers for workspace health and diagnostics.",
    transport: "stdio",
    endpoint: "",
    command: "node",
    args: "./mcp/workspace-utils/index.js",
    env_json: "{}",
    tools: ["workspace.summary", "workspace.check_health"],
    created_at: nowIso(),
    updated_at: nowIso(),
  },
];

const MCP_STORE_VERSION = 1;

function normalizeServer(server: Partial<McpServer>, fallbackId: string): McpServer {
  const now = nowIso();
  return {
    id: typeof server.id === "string" && server.id.trim() ? server.id : fallbackId,
    name: typeof server.name === "string" ? server.name : "Unnamed MCP Server",
    description: typeof server.description === "string" ? server.description : "",
    transport: server.transport ?? "http",
    endpoint: typeof server.endpoint === "string" ? server.endpoint : "",
    command: typeof server.command === "string" ? server.command : "",
    args: typeof server.args === "string" ? server.args : "",
    env_json: typeof server.env_json === "string" ? server.env_json : "{}",
    enabled: Boolean(server.enabled),
    status: server.status ?? "stopped",
    tools: Array.isArray(server.tools) ? server.tools.map((tool) => String(tool)) : [],
    auth_required: Boolean(server.auth_required),
    last_error: typeof server.last_error === "string" ? server.last_error : null,
    origin: server.origin ?? "manual",
    source_label: typeof server.source_label === "string" ? server.source_label : null,
    source_ref: typeof server.source_ref === "string" ? server.source_ref : null,
    created_at: typeof server.created_at === "string" ? server.created_at : now,
    updated_at: typeof server.updated_at === "string" ? server.updated_at : now,
  };
}

function normalizeSource(source: Partial<McpExternalSource>, fallbackId: string): McpExternalSource {
  const now = nowIso();
  return {
    id: typeof source.id === "string" && source.id.trim() ? source.id : fallbackId,
    name: typeof source.name === "string" ? source.name : "Unnamed Source",
    kind: source.kind ?? "registry",
    location: typeof source.location === "string" ? source.location : "",
    description: typeof source.description === "string" ? source.description : "",
    enabled: Boolean(source.enabled),
    templates: Array.isArray(source.templates)
      ? source.templates.map((template, idx) => ({
          id: template?.id ?? `tpl_${idx}`,
          name: template?.name ?? `Template ${idx + 1}`,
          description: template?.description ?? "",
          transport: template?.transport ?? "http",
          endpoint: template?.endpoint ?? "",
          command: template?.command ?? "",
          args: template?.args ?? "",
          env_json: template?.env_json ?? "{}",
          tools: Array.isArray(template?.tools) ? template.tools.map((tool) => String(tool)) : [],
          auth_required: Boolean(template?.auth_required),
        }))
      : [],
    created_at: typeof source.created_at === "string" ? source.created_at : now,
    updated_at: typeof source.updated_at === "string" ? source.updated_at : now,
  };
}

function normalizePackage(pkg: Partial<McpPackage>, fallbackId: string): McpPackage {
  const now = nowIso();
  return {
    id: typeof pkg.id === "string" && pkg.id.trim() ? pkg.id : fallbackId,
    name: typeof pkg.name === "string" ? pkg.name : "Unnamed Package",
    version: typeof pkg.version === "string" ? pkg.version : "0.1.0",
    description: typeof pkg.description === "string" ? pkg.description : "",
    transport: pkg.transport ?? "stdio",
    endpoint: typeof pkg.endpoint === "string" ? pkg.endpoint : "",
    command: typeof pkg.command === "string" ? pkg.command : "",
    args: typeof pkg.args === "string" ? pkg.args : "",
    env_json: typeof pkg.env_json === "string" ? pkg.env_json : "{}",
    tools: Array.isArray(pkg.tools) ? pkg.tools.map((tool) => String(tool)) : [],
    created_at: typeof pkg.created_at === "string" ? pkg.created_at : now,
    updated_at: typeof pkg.updated_at === "string" ? pkg.updated_at : now,
  };
}

export function buildMcpJson(servers: McpServer[]): string {
  return JSON.stringify(
    servers.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      enabled: s.enabled,
      status: s.status,
      transport: s.transport,
      endpoint: s.endpoint || null,
      command: s.command || null,
      args: s.args || null,
      tools: s.tools,
      auth_required: s.auth_required,
      origin: s.origin,
      source_label: s.source_label,
      source_ref: s.source_ref,
      updated_at: s.updated_at,
    })),
    null,
    2
  );
}

export function buildMcpWorkspaceJson(
  servers: McpServer[],
  externalSources: McpExternalSource[],
  packages: McpPackage[]
): string {
  return JSON.stringify(
    {
      servers: servers.map((server) => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        status: server.status,
        transport: server.transport,
        endpoint: server.endpoint || null,
        command: server.command || null,
        args: server.args || null,
        origin: server.origin,
        source_label: server.source_label,
        source_ref: server.source_ref,
        tools: server.tools,
      })),
      external_sources: externalSources.map((source) => ({
        id: source.id,
        name: source.name,
        kind: source.kind,
        location: source.location,
        enabled: source.enabled,
        template_count: source.templates.length,
        templates: source.templates.map((template) => ({
          id: template.id,
          name: template.name,
          transport: template.transport,
          tools: template.tools,
        })),
      })),
      local_packages: packages.map((pkg) => ({
        id: pkg.id,
        name: pkg.name,
        version: pkg.version,
        transport: pkg.transport,
        command: pkg.command || null,
        endpoint: pkg.endpoint || null,
        tools: pkg.tools,
      })),
    },
    null,
    2
  );
}

export const useMcpStore = create<McpState>()(
  persist(
    (set) => ({
      servers: INITIAL_SERVERS,
      externalSources: INITIAL_SOURCES,
      packages: INITIAL_PACKAGES,

      addServer: (server) => {
        const created: McpServer = {
          ...server,
          id: makeId("mcp"),
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        set((state) => ({ servers: [created, ...state.servers] }));
        return created;
      },

      updateServer: (id, patch) =>
        set((state) => ({
          servers: state.servers.map((server) =>
            server.id === id
              ? {
                  ...server,
                  ...patch,
                  updated_at: nowIso(),
                }
              : server
          ),
        })),

      removeServer: (id) =>
        set((state) => ({ servers: state.servers.filter((server) => server.id !== id) })),

      addExternalSource: (source) => {
        const created: McpExternalSource = {
          ...source,
          templates: source.templates.map(cloneTemplate),
          id: makeId("source"),
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        set((state) => ({ externalSources: [created, ...state.externalSources] }));
        return created;
      },

      removeExternalSource: (id) =>
        set((state) => ({ externalSources: state.externalSources.filter((source) => source.id !== id) })),

      setExternalSourceEnabled: (id, enabled) =>
        set((state) => ({
          externalSources: state.externalSources.map((source) =>
            source.id === id ? { ...source, enabled, updated_at: nowIso() } : source
          ),
        })),

      importTemplateToServer: (sourceId, templateId) => {
        let created: McpServer | null = null;
        set((state) => {
          const source = state.externalSources.find((item) => item.id === sourceId);
          if (!source || !source.enabled) return state;
          const template = source.templates.find((item) => item.id === templateId);
          if (!template) return state;

          created = {
            id: makeId("mcp"),
            name: template.name,
            description: template.description,
            transport: template.transport,
            endpoint: template.endpoint,
            command: template.command,
            args: template.args,
            env_json: template.env_json,
            enabled: true,
            status: "running",
            tools: [...template.tools],
            auth_required: template.auth_required,
            last_error: null,
            origin: "external",
            source_label: source.name,
            source_ref: `${source.id}:${template.id}`,
            created_at: nowIso(),
            updated_at: nowIso(),
          };
          return { servers: [created, ...state.servers] };
        });
        return created;
      },

      addPackage: (pkg) => {
        const created: McpPackage = {
          ...pkg,
          tools: [...pkg.tools],
          id: makeId("pkg"),
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        set((state) => ({ packages: [created, ...state.packages] }));
        return created;
      },

      removePackage: (id) =>
        set((state) => ({ packages: state.packages.filter((pkg) => pkg.id !== id) })),

      installPackageAsServer: (packageId) => {
        let created: McpServer | null = null;
        set((state) => {
          const pkg = state.packages.find((item) => item.id === packageId);
          if (!pkg) return state;
          created = {
            id: makeId("mcp"),
            name: `${pkg.name} (${pkg.version})`,
            description: pkg.description,
            transport: pkg.transport,
            endpoint: pkg.endpoint,
            command: pkg.command,
            args: pkg.args,
            env_json: pkg.env_json,
            enabled: true,
            status: "running",
            tools: [...pkg.tools],
            auth_required: false,
            last_error: null,
            origin: "package",
            source_label: pkg.name,
            source_ref: pkg.id,
            created_at: nowIso(),
            updated_at: nowIso(),
          };
          return { servers: [created, ...state.servers] };
        });
        return created;
      },
    }),
    {
      name: "arx-mcp-store",
      version: MCP_STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        servers: state.servers,
        externalSources: state.externalSources,
        packages: state.packages,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<McpState>) ?? {};
        const servers = Array.isArray(persisted.servers)
          ? persisted.servers.map((server, idx) => normalizeServer(server, `mcp_persisted_${idx}`))
          : currentState.servers;
        const externalSources = Array.isArray(persisted.externalSources)
          ? persisted.externalSources.map((source, idx) => normalizeSource(source, `source_persisted_${idx}`))
          : currentState.externalSources;
        const packages = Array.isArray(persisted.packages)
          ? persisted.packages.map((pkg, idx) => normalizePackage(pkg, `pkg_persisted_${idx}`))
          : currentState.packages;
        return {
          ...currentState,
          servers,
          externalSources,
          packages,
        };
      },
    }
  )
);
