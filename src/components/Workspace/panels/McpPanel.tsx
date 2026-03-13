import {
  Box,
  ChevronDown,
  ChevronUp,
  Download,
  Link2,
  Plus,
  X,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../../lib/utils";
import {
  buildMcpWorkspaceJson,
  getSeedTemplates,
  useMcpStore,
  type McpPackage,
  type McpServer,
  type McpServerTemplate,
  type McpSourceKind,
  type McpTemplateSeed,
} from "../../../store/mcpStore";
import { PanelWrapper } from "./shared";

function parseTemplateCatalog(value: string): McpServerTemplate[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item, index) => {
      const candidate = item as Partial<McpServerTemplate> & { id?: string; name?: string };
      const name = (candidate.name ?? "").trim();
      if (!name) return null;
      return {
        id: candidate.id?.trim() || `catalog_${index}_${name.toLowerCase().replace(/\s+/g, "_")}`,
        name,
        description: (candidate.description ?? "").trim(),
        transport: candidate.transport ?? "http",
        endpoint: (candidate.endpoint ?? "").trim(),
        command: (candidate.command ?? "").trim(),
        args: (candidate.args ?? "").trim(),
        env_json: (candidate.env_json ?? "{}").trim(),
        tools: Array.isArray(candidate.tools) ? candidate.tools.map((tool) => String(tool)) : [],
        auth_required: Boolean(candidate.auth_required),
      } satisfies McpServerTemplate;
    })
    .filter((item): item is McpServerTemplate => Boolean(item));
}

export function McpPanel() {
  const {
    servers,
    externalSources,
    packages,
    addServer,
    updateServer,
    removeServer,
    addExternalSource,
    removeExternalSource,
    setExternalSourceEnabled,
    importTemplateToServer,
    addPackage,
    removePackage,
    installPackageAsServer,
  } = useMcpStore();

  const [selectedId, setSelectedId] = useState<string | null>(servers[0]?.id ?? null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSourceCreate, setShowSourceCreate] = useState(false);
  const [showPackageCreate, setShowPackageCreate] = useState(false);

  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createTransport, setCreateTransport] = useState<McpServer["transport"]>("http");
  const [createEndpoint, setCreateEndpoint] = useState("http://127.0.0.1:7777/mcp");
  const [createCommand, setCreateCommand] = useState("");
  const [createArgs, setCreateArgs] = useState("");
  const [createTools, setCreateTools] = useState("");
  const [createEnvJson, setCreateEnvJson] = useState("{}");
  const [createEnabled, setCreateEnabled] = useState(true);
  const [createAuthRequired, setCreateAuthRequired] = useState(false);

  const [sourceName, setSourceName] = useState("");
  const [sourceDescription, setSourceDescription] = useState("");
  const [sourceKind, setSourceKind] = useState<McpSourceKind>("registry");
  const [sourceLocation, setSourceLocation] = useState("");
  const [sourceSeed, setSourceSeed] = useState<McpTemplateSeed>("official");
  const [sourceCatalogJson, setSourceCatalogJson] = useState("");
  const [sourceError, setSourceError] = useState<string | null>(null);

  const [packageName, setPackageName] = useState("");
  const [packageVersion, setPackageVersion] = useState("0.1.0");
  const [packageDescription, setPackageDescription] = useState("");
  const [packageTransport, setPackageTransport] = useState<McpPackage["transport"]>("stdio");
  const [packageEndpoint, setPackageEndpoint] = useState("");
  const [packageCommand, setPackageCommand] = useState("");
  const [packageArgs, setPackageArgs] = useState("");
  const [packageTools, setPackageTools] = useState("");
  const [packageEnvJson, setPackageEnvJson] = useState("{}");

  const [showJson, setShowJson] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [showDevBanner, setShowDevBanner] = useState(true);

  useEffect(() => {
    if (!selectedId && servers.length > 0) {
      setSelectedId(servers[0].id);
    }
  }, [selectedId, servers]);

  const selected = servers.find((item) => item.id === selectedId) ?? null;
  const mcpJson = useMemo(
    () => buildMcpWorkspaceJson(servers, externalSources, packages),
    [externalSources, packages, servers]
  );

  const createServer = () => {
    const name = createName.trim();
    if (!name) return;
    const created = addServer({
      name,
      description: createDescription.trim(),
      transport: createTransport,
      endpoint: createEndpoint.trim(),
      command: createCommand.trim(),
      args: createArgs.trim(),
      env_json: createEnvJson.trim() || "{}",
      enabled: createEnabled,
      status: createEnabled ? "running" : "stopped",
      tools: createTools.split(",").map((item) => item.trim()).filter(Boolean),
      auth_required: createAuthRequired,
      last_error: null,
      origin: "manual",
      source_label: null,
      source_ref: null,
    });
    setSelectedId(created.id);
    setCreateName("");
    setCreateDescription("");
    setCreateTransport("http");
    setCreateEndpoint("http://127.0.0.1:7777/mcp");
    setCreateCommand("");
    setCreateArgs("");
    setCreateTools("");
    setCreateEnvJson("{}");
    setCreateEnabled(true);
    setCreateAuthRequired(false);
    setShowCreate(false);
  };

  const createSource = () => {
    setSourceError(null);
    const name = sourceName.trim();
    if (!name) return;
    const location = sourceLocation.trim();

    let templates: McpServerTemplate[];
    if (sourceCatalogJson.trim()) {
      try {
        templates = parseTemplateCatalog(sourceCatalogJson.trim());
      } catch {
        setSourceError("Catalog JSON must be a valid JSON array.");
        return;
      }
    } else {
      templates = getSeedTemplates(sourceSeed);
    }

    addExternalSource({
      name,
      kind: sourceKind,
      location,
      description: sourceDescription.trim(),
      enabled: true,
      templates,
    });

    setSourceName("");
    setSourceDescription("");
    setSourceKind("registry");
    setSourceLocation("");
    setSourceSeed("official");
    setSourceCatalogJson("");
    setShowSourceCreate(false);
  };

  const createPackage = () => {
    const name = packageName.trim();
    if (!name) return;
    addPackage({
      name,
      version: packageVersion.trim() || "0.1.0",
      description: packageDescription.trim(),
      transport: packageTransport,
      endpoint: packageEndpoint.trim(),
      command: packageCommand.trim(),
      args: packageArgs.trim(),
      env_json: packageEnvJson.trim() || "{}",
      tools: packageTools.split(",").map((item) => item.trim()).filter(Boolean),
    });
    setPackageName("");
    setPackageVersion("0.1.0");
    setPackageDescription("");
    setPackageTransport("stdio");
    setPackageEndpoint("");
    setPackageCommand("");
    setPackageArgs("");
    setPackageTools("");
    setPackageEnvJson("{}");
    setShowPackageCreate(false);
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(mcpJson);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1200);
  };

  const statusChip = (status: McpServer["status"]) => {
    if (status === "running") return "bg-accent-green/15 text-accent-green";
    if (status === "error") return "bg-accent-red/15 text-accent-red";
    return "bg-line-med text-text-dark";
  };

  const sourceChip = (origin: McpServer["origin"]) => {
    if (origin === "external") return "bg-accent-primary/15 text-accent-primary";
    if (origin === "package") return "bg-accent-gold/15 text-accent-gold";
    return "bg-line-med text-text-dark";
  };

  return (
    <PanelWrapper
      title="MCP"
      icon={<Wrench size={16} className="text-accent-primary" />}
      actions={
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCreate((value) => !value)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
          >
            <Plus size={12} />
            Server
          </button>
          <button
            onClick={() => setShowSourceCreate((value) => !value)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
          >
            <Link2 size={12} />
            Source
          </button>
          <button
            onClick={() => setShowPackageCreate((value) => !value)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
          >
            <Box size={12} />
            Package
          </button>
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {showDevBanner && (
          <div className="flex items-center justify-between gap-2 border border-amber-400 bg-black/80 px-3 py-1 text-[11px] text-amber-300">
            <span>MCP is under development.</span>
            <button
              onClick={() => setShowDevBanner(false)}
              className="rounded p-0.5 text-amber-300/90 hover:bg-amber-400/20 hover:text-amber-200"
              title="Dismiss"
              aria-label="Dismiss under development notice"
            >
              <X size={11} />
            </button>
          </div>
        )}
        {(showCreate || showSourceCreate || showPackageCreate) && (
          <div className="m-3 mb-2 space-y-2">
            {showCreate && (
              <div className="rounded border border-line-med bg-line-light p-3 space-y-2">
                <div className="text-[11px] uppercase tracking-wider text-text-dark">New MCP Server</div>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="MCP server name"
                  className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                />
                <input
                  type="text"
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="Description"
                  className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={createTransport}
                    onChange={(e) => setCreateTransport(e.target.value as McpServer["transport"])}
                    className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                  >
                    <option value="http">http</option>
                    <option value="sse">sse</option>
                    <option value="websocket">websocket</option>
                    <option value="stdio">stdio</option>
                  </select>
                  <input
                    type="text"
                    value={createEndpoint}
                    onChange={(e) => setCreateEndpoint(e.target.value)}
                    placeholder="Endpoint (network transports)"
                    className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={createCommand}
                    onChange={(e) => setCreateCommand(e.target.value)}
                    placeholder="Command (stdio)"
                    className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                  />
                  <input
                    type="text"
                    value={createArgs}
                    onChange={(e) => setCreateArgs(e.target.value)}
                    placeholder="Args"
                    className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                  />
                </div>
                <input
                  type="text"
                  value={createTools}
                  onChange={(e) => setCreateTools(e.target.value)}
                  placeholder="Tools (comma separated)"
                  className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                />
                <textarea
                  value={createEnvJson}
                  onChange={(e) => setCreateEnvJson(e.target.value)}
                  placeholder="Env JSON"
                  className="w-full min-h-16 px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50 resize-y font-mono"
                />
                <div className="flex items-center gap-3 text-[11px] text-text-med">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={createEnabled}
                      onChange={(e) => setCreateEnabled(e.target.checked)}
                      className="accent-indigo-500"
                    />
                    Enabled
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={createAuthRequired}
                      onChange={(e) => setCreateAuthRequired(e.target.checked)}
                      className="accent-indigo-500"
                    />
                    Auth required
                  </label>
                </div>
                <button
                  onClick={createServer}
                  className="px-2 py-1 rounded text-[11px] bg-accent-primary/25 text-accent-primary hover:bg-accent-primary/35 transition-colors"
                >
                  Create Server
                </button>
              </div>
            )}

            {showSourceCreate && (
              <div className="rounded border border-line-med bg-line-light p-3 space-y-2">
                <div className="text-[11px] uppercase tracking-wider text-text-dark">External MCP Source</div>
                <input
                  type="text"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder="Source name"
                  className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={sourceKind}
                    onChange={(e) => setSourceKind(e.target.value as McpSourceKind)}
                    className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                  >
                    <option value="registry">registry</option>
                    <option value="github">github</option>
                    <option value="url">url</option>
                  </select>
                  <select
                    value={sourceSeed}
                    onChange={(e) => setSourceSeed(e.target.value as McpTemplateSeed)}
                    className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                  >
                    <option value="official">official templates</option>
                    <option value="community">community templates</option>
                    <option value="empty">empty</option>
                  </select>
                </div>
                <input
                  type="text"
                  value={sourceLocation}
                  onChange={(e) => setSourceLocation(e.target.value)}
                  placeholder="Location (URL/repo/path)"
                  className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                />
                <textarea
                  value={sourceDescription}
                  onChange={(e) => setSourceDescription(e.target.value)}
                  placeholder="Description"
                  className="w-full min-h-12 px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50 resize-y"
                />
                <textarea
                  value={sourceCatalogJson}
                  onChange={(e) => setSourceCatalogJson(e.target.value)}
                  placeholder="Optional catalog JSON array of templates"
                  className="w-full min-h-14 px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50 resize-y font-mono"
                />
                {sourceError && <p className="text-[10px] text-accent-red">{sourceError}</p>}
                <button
                  onClick={createSource}
                  className="px-2 py-1 rounded text-[11px] bg-accent-primary/25 text-accent-primary hover:bg-accent-primary/35 transition-colors"
                >
                  Add Source
                </button>
              </div>
            )}

            {showPackageCreate && (
              <div className="rounded border border-line-med bg-line-light p-3 space-y-2">
                <div className="text-[11px] uppercase tracking-wider text-text-dark">Local MCP Package</div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={packageName}
                    onChange={(e) => setPackageName(e.target.value)}
                    placeholder="Package name"
                    className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                  />
                  <input
                    type="text"
                    value={packageVersion}
                    onChange={(e) => setPackageVersion(e.target.value)}
                    placeholder="Version"
                    className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                  />
                </div>
                <textarea
                  value={packageDescription}
                  onChange={(e) => setPackageDescription(e.target.value)}
                  placeholder="Package description"
                  className="w-full min-h-12 px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50 resize-y"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={packageTransport}
                    onChange={(e) => setPackageTransport(e.target.value as McpPackage["transport"])}
                    className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                  >
                    <option value="stdio">stdio</option>
                    <option value="http">http</option>
                    <option value="sse">sse</option>
                    <option value="websocket">websocket</option>
                  </select>
                  <input
                    type="text"
                    value={packageEndpoint}
                    onChange={(e) => setPackageEndpoint(e.target.value)}
                    placeholder="Endpoint"
                    className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={packageCommand}
                    onChange={(e) => setPackageCommand(e.target.value)}
                    placeholder="Command"
                    className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                  />
                  <input
                    type="text"
                    value={packageArgs}
                    onChange={(e) => setPackageArgs(e.target.value)}
                    placeholder="Args"
                    className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                  />
                </div>
                <input
                  type="text"
                  value={packageTools}
                  onChange={(e) => setPackageTools(e.target.value)}
                  placeholder="Tools (comma separated)"
                  className="w-full px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                />
                <textarea
                  value={packageEnvJson}
                  onChange={(e) => setPackageEnvJson(e.target.value)}
                  placeholder="Env JSON"
                  className="w-full min-h-12 px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50 resize-y font-mono"
                />
                <button
                  onClick={createPackage}
                  className="px-2 py-1 rounded text-[11px] bg-accent-primary/25 text-accent-primary hover:bg-accent-primary/35 transition-colors"
                >
                  Create Package
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 flex border-t border-line-light">
          <div className="w-[260px] flex-shrink-0 border-r border-line-light overflow-y-auto">
            {servers.length === 0 ? (
              <div className="p-4 text-center text-xs text-text-dark italic">No MCP servers configured</div>
            ) : (
              servers.map((server) => (
                <div
                  key={server.id}
                  onClick={() => setSelectedId(server.id)}
                  className={cn(
                    "group px-3 py-2 border-b border-line-light cursor-pointer hover:bg-line-light transition-colors",
                    selectedId === server.id && "bg-accent-primary/10 border-l-2 border-l-accent-primary"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className={cn("mt-0.5 rounded px-1 py-0.5 text-[9px] uppercase", statusChip(server.status))}>
                      {server.status}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-text-norm truncate">{server.name}</div>
                      <div className="text-[10px] text-text-dark truncate">
                        {server.transport} · {server.enabled ? "enabled" : "disabled"} · {server.tools.length} tools
                      </div>
                      <div className="mt-1 inline-flex rounded px-1 py-0.5 text-[9px] uppercase tracking-wide text-text-med bg-line-light">
                        <span className={cn("rounded px-1 py-0.5", sourceChip(server.origin))}>{server.origin}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeServer(server.id);
                        if (selectedId === server.id) {
                          const fallback = servers.find((item) => item.id !== server.id) ?? null;
                          setSelectedId(fallback?.id ?? null);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent-red/20 text-text-dark hover:text-accent-red transition-all"
                      title="Delete MCP server"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto">
            <div className="p-3 space-y-3">
              <section className="rounded border border-line-med bg-line-light">
                <div className="border-b border-line-med px-3 py-2 text-[11px] uppercase tracking-wider text-text-dark">
                  Selected Server
                </div>
                {selected ? (
                  <div className="space-y-2 p-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={selected.name}
                        onChange={(e) => updateServer(selected.id, { name: e.target.value })}
                        className="flex-1 min-w-0 px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                      />
                      <select
                        value={selected.status}
                        onChange={(e) => updateServer(selected.id, { status: e.target.value as McpServer["status"] })}
                        className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                      >
                        <option value="running">running</option>
                        <option value="stopped">stopped</option>
                        <option value="error">error</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <select
                        value={selected.transport}
                        onChange={(e) => updateServer(selected.id, { transport: e.target.value as McpServer["transport"] })}
                        className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-norm outline-none focus:border-accent-primary/50"
                      >
                        <option value="http">http</option>
                        <option value="sse">sse</option>
                        <option value="websocket">websocket</option>
                        <option value="stdio">stdio</option>
                      </select>
                      <input
                        type="text"
                        value={selected.endpoint}
                        onChange={(e) => updateServer(selected.id, { endpoint: e.target.value })}
                        placeholder="Endpoint"
                        className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-med outline-none focus:border-accent-primary/50"
                      />
                      <input
                        type="text"
                        value={selected.command}
                        onChange={(e) => updateServer(selected.id, { command: e.target.value })}
                        placeholder="Command"
                        className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-med outline-none focus:border-accent-primary/50"
                      />
                      <input
                        type="text"
                        value={selected.args}
                        onChange={(e) => updateServer(selected.id, { args: e.target.value })}
                        placeholder="Args"
                        className="px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-med outline-none focus:border-accent-primary/50"
                      />
                      <input
                        type="text"
                        value={selected.tools.join(", ")}
                        onChange={(e) =>
                          updateServer(selected.id, {
                            tools: e.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                          })
                        }
                        placeholder="Tools (comma separated)"
                        className="md:col-span-2 px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-med outline-none focus:border-accent-primary/50"
                      />
                    </div>
                    <div className="text-[11px] text-text-med flex items-center gap-3">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={selected.enabled}
                          onChange={(e) => updateServer(selected.id, { enabled: e.target.checked })}
                          className="accent-indigo-500"
                        />
                        Enabled
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={selected.auth_required}
                          onChange={(e) => updateServer(selected.id, { auth_required: e.target.checked })}
                          className="accent-indigo-500"
                        />
                        Auth required
                      </label>
                    </div>
                    <textarea
                      value={selected.description}
                      onChange={(e) => updateServer(selected.id, { description: e.target.value })}
                      className="w-full min-h-16 px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-med outline-none focus:border-accent-primary/50 resize-y"
                      placeholder="Server description"
                    />
                    <textarea
                      value={selected.env_json}
                      onChange={(e) => updateServer(selected.id, { env_json: e.target.value })}
                      className="w-full min-h-24 px-2 py-1.5 bg-line-light border border-line-med rounded text-xs text-text-med outline-none focus:border-accent-primary/50 resize-y font-mono"
                      placeholder="Environment JSON"
                    />
                  </div>
                ) : (
                  <div className="p-4 text-xs text-text-dark">Select an MCP server</div>
                )}
              </section>

              <section className="rounded border border-line-med bg-line-light p-3">
                <div className="text-[11px] uppercase tracking-wider text-text-dark mb-2">External Sources</div>
                <div className="space-y-2">
                  {externalSources.length === 0 ? (
                    <div className="text-[11px] text-text-dark italic">No sources added</div>
                  ) : (
                    externalSources.map((source) => (
                      <div key={source.id} className="rounded border border-line-med bg-black/20 p-2 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs text-text-norm truncate">{source.name}</div>
                            <div className="text-[10px] text-text-dark truncate">{source.kind} · {source.location || "no location"}</div>
                          </div>
                          <button
                            onClick={() => removeExternalSource(source.id)}
                            className="p-1 rounded text-text-dark hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                            title="Remove source"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                        <label className="flex items-center gap-1.5 text-[10px] text-text-med">
                          <input
                            type="checkbox"
                            checked={source.enabled}
                            onChange={(e) => setExternalSourceEnabled(source.id, e.target.checked)}
                            className="accent-accent-primary"
                          />
                          Enabled
                        </label>
                        <div className="space-y-1">
                          {source.templates.length === 0 ? (
                            <div className="text-[10px] text-text-dark italic">No templates in source</div>
                          ) : (
                            source.templates.map((template) => (
                              <div key={template.id} className="flex items-center justify-between gap-2 rounded bg-black/30 px-2 py-1">
                                <div className="min-w-0">
                                  <div className="text-[10px] text-text-med truncate">{template.name}</div>
                                  <div className="text-[9px] text-text-dark truncate">{template.transport} · {template.tools.length} tools</div>
                                </div>
                                <button
                                  onClick={() => {
                                    const created = importTemplateToServer(source.id, template.id);
                                    if (created) setSelectedId(created.id);
                                  }}
                                  disabled={!source.enabled}
                                  className={cn(
                                    "px-1.5 py-0.5 rounded text-[9px] transition-colors",
                                    source.enabled
                                      ? "bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
                                      : "bg-line-light text-text-dark cursor-not-allowed"
                                  )}
                                >
                                  <Download size={9} className="inline mr-1" />
                                  Install
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded border border-line-med bg-line-light p-3">
                <div className="text-[11px] uppercase tracking-wider text-text-dark mb-2">Local Packages</div>
                <div className="space-y-2">
                  {packages.length === 0 ? (
                    <div className="text-[11px] text-text-dark italic">No local packages yet</div>
                  ) : (
                    packages.map((pkg) => (
                      <div key={pkg.id} className="rounded border border-line-med bg-black/20 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs text-text-norm truncate">{pkg.name}</div>
                            <div className="text-[10px] text-text-dark truncate">v{pkg.version} · {pkg.transport}</div>
                          </div>
                          <button
                            onClick={() => removePackage(pkg.id)}
                            className="p-1 rounded text-text-dark hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                            title="Remove package"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                        <div className="mt-2 text-[10px] text-text-dark">{pkg.description || "No description"}</div>
                        <button
                          onClick={() => {
                            const created = installPackageAsServer(pkg.id);
                            if (created) setSelectedId(created.id);
                          }}
                          className="mt-2 px-2 py-1 rounded text-[10px] bg-accent-gold/20 text-accent-gold hover:bg-accent-gold/30 transition-colors"
                        >
                          Install as Server
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>

        <div className="border-t border-line-light bg-black/20">
          <div className="flex items-center justify-between px-3 py-1.5">
            <button
              onClick={() => setShowJson((value) => !value)}
              className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-text-med hover:text-text-norm transition-colors"
              title="Toggle MCP workspace JSON"
            >
              {showJson ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
              MCP JSON
            </button>
            <button
              onClick={() => void copyJson()}
              className="px-1.5 py-0.5 rounded text-[10px] bg-line-med text-text-med hover:text-text-norm hover:bg-line-dark transition-colors"
            >
              {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy"}
            </button>
          </div>
          {showJson && (
            <pre className="mx-2 mb-2 max-h-36 overflow-auto rounded bg-black/30 p-2 text-[10px] leading-4 text-accent-green/90">
              {mcpJson}
            </pre>
          )}
        </div>
      </div>
    </PanelWrapper>
  );
}
