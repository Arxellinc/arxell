use crate::contracts::WorkspaceToolRecord;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

const TOOL_REGISTRY_ENV_PATH: &str = "ARXELL_TOOL_REGISTRY_PATH";
const TOOL_REGISTRY_VERSION: u32 = 1;

struct WorkspaceToolManifest {
    tool_id: &'static str,
    title: &'static str,
    description: &'static str,
    category: &'static str,
    core: bool,
    default_enabled: bool,
}

const WORKSPACE_TOOL_MANIFESTS: &[WorkspaceToolManifest] = &[
    WorkspaceToolManifest {
        tool_id: "terminal",
        title: "Terminal",
        description: "PTY shell sessions for local command execution",
        category: "workspace",
        core: true,
        default_enabled: true,
    },
    WorkspaceToolManifest {
        tool_id: "files",
        title: "Files",
        description: "Workspace file browsing and editing integrations",
        category: "workspace",
        core: false,
        default_enabled: true,
    },
    WorkspaceToolManifest {
        tool_id: "notepad",
        title: "Notepad",
        description: "Tabbed text editor for workspace files and scratch buffers",
        category: "workspace",
        core: false,
        default_enabled: true,
    },
    WorkspaceToolManifest {
        tool_id: "webSearch",
        title: "WebSearch",
        description: "Search and fetch web context for tasks",
        category: "agent",
        core: false,
        default_enabled: true,
    },
    WorkspaceToolManifest {
        tool_id: "chart",
        title: "Chart",
        description: "Mermaid flowcharts and diagrams",
        category: "agent",
        core: false,
        default_enabled: true,
    },
    WorkspaceToolManifest {
        tool_id: "flow",
        title: "Flow",
        description: "Node-based workflow orchestration surface",
        category: "agent",
        core: false,
        default_enabled: true,
    },
    WorkspaceToolManifest {
        tool_id: "tasks",
        title: "Tasks",
        description: "Task planning and status tracking",
        category: "agent",
        core: false,
        default_enabled: true,
    },
    WorkspaceToolManifest {
        tool_id: "memory",
        title: "Memory",
        description: "Persistent context and memory references",
        category: "data",
        core: false,
        default_enabled: true,
    },
    WorkspaceToolManifest {
        tool_id: "skills",
        title: "Skills",
        description: "Reusable skill packs and directives",
        category: "agent",
        core: false,
        default_enabled: true,
    },
    WorkspaceToolManifest {
        tool_id: "opencode",
        title: "OpenCode",
        description: "AI-powered coding agent in your terminal",
        category: "workspace",
        core: false,
        default_enabled: true,
    },
    WorkspaceToolManifest {
        tool_id: "looper",
        title: "Looper",
        description:
            "Multi-agent Ralph loop orchestration with Planner, Executor, Validator, and Critic",
        category: "workspace",
        core: false,
        default_enabled: true,
    },
];

#[derive(Debug, Default, Serialize, Deserialize)]
struct ToolRegistrySnapshot {
    version: u32,
    #[serde(default)]
    enabled: HashMap<String, bool>,
    #[serde(default)]
    icon: HashMap<String, bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifest {
    id: String,
    name: String,
    version: String,
    entry: String,
    category: Option<String>,
    min_host_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginPermissions {
    capabilities: Vec<String>,
}

#[derive(Debug, Clone)]
struct PluginDiscovery {
    manifest: PluginManifest,
    permissions: PluginPermissions,
    entry_path: PathBuf,
}

struct WorkspaceToolsState {
    tools: HashMap<String, WorkspaceToolRecord>,
    plugin_ids: HashSet<String>,
    plugin_capabilities: HashMap<String, HashSet<String>>,
}

pub struct WorkspaceToolsService {
    state: RwLock<WorkspaceToolsState>,
    registry_path: PathBuf,
    plugins_root: PathBuf,
}

impl WorkspaceToolsService {
    pub fn new() -> Self {
        let registry_path = default_registry_path();
        let snapshot = read_registry_snapshot(&registry_path);
        let plugins_root = default_plugins_root();

        let mut tools = HashMap::new();
        for manifest in WORKSPACE_TOOL_MANIFESTS {
            let enabled = snapshot
                .enabled
                .get(manifest.tool_id)
                .copied()
                .unwrap_or(manifest.default_enabled);
            let icon = snapshot.icon.get(manifest.tool_id).copied().unwrap_or(true);
            tools.insert(
                manifest.tool_id.to_string(),
                WorkspaceToolRecord {
                    tool_id: manifest.tool_id.to_string(),
                    title: manifest.title.to_string(),
                    description: manifest.description.to_string(),
                    category: manifest.category.to_string(),
                    core: manifest.core,
                    optional: !manifest.core,
                    version: "1.0.0".to_string(),
                    source: "builtin".to_string(),
                    enabled,
                    icon,
                    status: status_for_enabled(enabled).to_string(),
                    entry: None,
                },
            );
        }

        let mut state = WorkspaceToolsState {
            tools,
            plugin_ids: HashSet::new(),
            plugin_capabilities: HashMap::new(),
        };
        apply_plugins(&mut state, &plugins_root, &snapshot);

        Self {
            state: RwLock::new(state),
            registry_path,
            plugins_root,
        }
    }

    pub fn list(&self) -> Vec<WorkspaceToolRecord> {
        let mut state = self.state.write().expect("workspace tools lock poisoned");
        let snapshot = read_registry_snapshot(&self.registry_path);
        apply_plugins(&mut state, &self.plugins_root, &snapshot);

        let mut records: Vec<_> = state.tools.values().cloned().collect();
        records.sort_by(|a, b| a.tool_id.cmp(&b.tool_id));
        records
    }

    pub fn plugins_root_path(&self) -> PathBuf {
        self.plugins_root.clone()
    }

    pub fn state_root_path(&self) -> PathBuf {
        self.registry_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf()
    }

    pub fn set_enabled(&self, tool_id: &str, enabled: bool) -> Result<(), String> {
        let mut state = self.state.write().expect("workspace tools lock poisoned");
        let snapshot = read_registry_snapshot(&self.registry_path);
        apply_plugins(&mut state, &self.plugins_root, &snapshot);
        let Some(tool) = state.tools.get_mut(tool_id) else {
            return Err(format!("workspace tool not found: {tool_id}"));
        };
        tool.enabled = enabled;
        tool.status = status_for_enabled(enabled).to_string();
        self.persist_snapshot(&state.tools)?;
        Ok(())
    }

    pub fn set_icon(&self, tool_id: &str, icon: bool) -> Result<(), String> {
        let mut state = self.state.write().expect("workspace tools lock poisoned");
        let snapshot = read_registry_snapshot(&self.registry_path);
        apply_plugins(&mut state, &self.plugins_root, &snapshot);
        let Some(tool) = state.tools.get_mut(tool_id) else {
            return Err(format!("workspace tool not found: {tool_id}"));
        };
        tool.icon = icon;
        self.persist_snapshot(&state.tools)?;
        Ok(())
    }

    pub fn forget_tool(&self, tool_id: &str) -> Result<(), String> {
        let normalized = tool_id.trim();
        if normalized.is_empty() {
            return Err("tool id is required".to_string());
        }
        let mut snapshot = read_registry_snapshot(&self.registry_path);
        snapshot.enabled.remove(normalized);
        snapshot.icon.remove(normalized);
        self.persist_registry_snapshot(&snapshot)?;

        let mut state = self.state.write().expect("workspace tools lock poisoned");
        state.tools.remove(normalized);
        state.plugin_ids.remove(normalized);
        state.plugin_capabilities.remove(normalized);
        apply_plugins(&mut state, &self.plugins_root, &snapshot);
        Ok(())
    }

    pub fn create_app_tool_plugin(
        &self,
        tool_id: &str,
        name: &str,
        icon: &str,
        description: &str,
    ) -> Result<WorkspaceToolRecord, String> {
        let tool_id = sanitize_tool_id(tool_id);
        if tool_id.is_empty() {
            return Err("tool id is required".to_string());
        }
        if WORKSPACE_TOOL_MANIFESTS
            .iter()
            .any(|manifest| manifest.tool_id == tool_id.as_str())
        {
            return Err(format!("tool id is reserved: {tool_id}"));
        }

        let plugin_dir = self.plugins_root.join(tool_id.as_str());
        if plugin_dir.exists() {
            return Err(format!("tool already exists: {tool_id}"));
        }

        let dist_dir = plugin_dir.join("dist");
        fs::create_dir_all(dist_dir.as_path())
            .map_err(|e| format!("failed creating plugin directory: {e}"))?;

        let title = name.trim();
        let title = if title.is_empty() {
            tool_id.as_str()
        } else {
            title
        };
        let description = description.trim();
        let description = if description.is_empty() {
            "Generated workspace app tool"
        } else {
            description
        };
        let icon = icon.trim();
        let icon = if icon.is_empty() { "wrench" } else { icon };

        let manifest = json!({
            "id": tool_id,
            "name": title,
            "version": "1.0.0",
            "entry": "dist/index.html",
            "category": "workspace",
            "icon": icon
        });
        let permissions = json!({ "capabilities": ["files.read"] });

        fs::write(
            plugin_dir.join("manifest.json"),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&manifest)
                    .map_err(|e| format!("failed serializing plugin manifest: {e}"))?
            ),
        )
        .map_err(|e| format!("failed writing plugin manifest: {e}"))?;
        fs::write(
            plugin_dir.join("permissions.json"),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&permissions)
                    .map_err(|e| format!("failed serializing plugin permissions: {e}"))?
            ),
        )
        .map_err(|e| format!("failed writing plugin permissions: {e}"))?;
        fs::write(
            dist_dir.join("index.html"),
            render_plugin_index_html(title, description),
        )
        .map_err(|e| format!("failed writing plugin index: {e}"))?;
        fs::write(dist_dir.join("main.js"), render_plugin_main_js(title))
            .map_err(|e| format!("failed writing plugin script: {e}"))?;

        let snapshot = read_registry_snapshot(&self.registry_path);
        let mut state = self.state.write().expect("workspace tools lock poisoned");
        apply_plugins(&mut state, &self.plugins_root, &snapshot);
        state
            .tools
            .get(tool_id.as_str())
            .cloned()
            .ok_or_else(|| format!("created plugin was not discovered: {tool_id}"))
    }

    pub fn ensure_custom_tool_capability(
        &self,
        custom_tool_id: &str,
        capability: &str,
    ) -> Result<(), String> {
        let mut state = self.state.write().expect("workspace tools lock poisoned");
        let snapshot = read_registry_snapshot(&self.registry_path);
        apply_plugins(&mut state, &self.plugins_root, &snapshot);

        let Some(tool) = state.tools.get(custom_tool_id) else {
            return Err("plugin_not_found".to_string());
        };
        if tool.source != "custom" && tool.source != "plugin" {
            return Err("plugin_not_found".to_string());
        }
        if !tool.enabled {
            return Err("plugin_disabled".to_string());
        }

        let Some(capabilities) = state.plugin_capabilities.get(custom_tool_id) else {
            return Err("plugin_permissions_missing".to_string());
        };
        if !capabilities.contains(capability) {
            return Err("capability_denied".to_string());
        }
        Ok(())
    }

    pub fn ensure_plugin_capability(
        &self,
        plugin_id: &str,
        capability: &str,
    ) -> Result<(), String> {
        self.ensure_custom_tool_capability(plugin_id, capability)
    }

    pub fn export_snapshot_json(&self) -> Result<String, String> {
        let state = self.state.read().expect("workspace tools lock poisoned");
        let enabled = state
            .tools
            .iter()
            .map(|(tool_id, tool)| (tool_id.clone(), tool.enabled))
            .collect::<HashMap<_, _>>();
        let icon = state
            .tools
            .iter()
            .map(|(tool_id, tool)| (tool_id.clone(), tool.icon))
            .collect::<HashMap<_, _>>();
        let snapshot = ToolRegistrySnapshot {
            version: TOOL_REGISTRY_VERSION,
            enabled,
            icon,
        };
        serde_json::to_string_pretty(&snapshot)
            .map(|payload| format!("{payload}\n"))
            .map_err(|e| format!("failed serializing tool registry export: {e}"))
    }

    pub fn import_snapshot_json(
        &self,
        snapshot_json: &str,
    ) -> Result<Vec<WorkspaceToolRecord>, String> {
        let parsed = serde_json::from_str::<ToolRegistrySnapshot>(snapshot_json)
            .map_err(|e| format!("invalid tool registry import payload: {e}"))?;
        let mut state = self.state.write().expect("workspace tools lock poisoned");
        for (tool_id, tool) in state.tools.iter_mut() {
            let enabled = parsed.enabled.get(tool_id).copied().unwrap_or(tool.enabled);
            tool.enabled = enabled;
            tool.status = status_for_enabled(enabled).to_string();
            tool.icon = parsed.icon.get(tool_id).copied().unwrap_or(tool.icon);
        }
        self.persist_snapshot(&state.tools)?;
        let mut records: Vec<_> = state.tools.values().cloned().collect();
        records.sort_by(|a, b| a.tool_id.cmp(&b.tool_id));
        Ok(records)
    }

    fn persist_snapshot(&self, tools: &HashMap<String, WorkspaceToolRecord>) -> Result<(), String> {
        let enabled = tools
            .iter()
            .map(|(tool_id, tool)| (tool_id.clone(), tool.enabled))
            .collect::<HashMap<_, _>>();
        let icon = tools
            .iter()
            .map(|(tool_id, tool)| (tool_id.clone(), tool.icon))
            .collect::<HashMap<_, _>>();
        let snapshot = ToolRegistrySnapshot {
            version: TOOL_REGISTRY_VERSION,
            enabled,
            icon,
        };
        self.persist_registry_snapshot(&snapshot)
    }

    fn persist_registry_snapshot(&self, snapshot: &ToolRegistrySnapshot) -> Result<(), String> {
        let Some(parent) = self.registry_path.parent() else {
            return Err("invalid tool registry path".to_string());
        };
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed creating tool registry dir: {e}"))?;
        let payload = serde_json::to_string_pretty(snapshot)
            .map_err(|e| format!("failed serializing tool registry: {e}"))?;
        let tmp_path = self.registry_path.with_extension("json.tmp");
        fs::write(&tmp_path, format!("{payload}\n"))
            .map_err(|e| format!("failed writing tool registry snapshot: {e}"))?;
        fs::rename(&tmp_path, &self.registry_path)
            .map_err(|e| format!("failed replacing tool registry snapshot: {e}"))?;
        Ok(())
    }
}

impl Default for WorkspaceToolsService {
    fn default() -> Self {
        Self::new()
    }
}

fn status_for_enabled(enabled: bool) -> &'static str {
    if enabled {
        "ready"
    } else {
        "disabled"
    }
}

fn apply_plugins(
    state: &mut WorkspaceToolsState,
    plugins_root: &Path,
    snapshot: &ToolRegistrySnapshot,
) {
    for plugin_id in state.plugin_ids.iter() {
        state.tools.remove(plugin_id.as_str());
    }
    state.plugin_ids.clear();
    state.plugin_capabilities.clear();

    let builtins: HashSet<&str> = WORKSPACE_TOOL_MANIFESTS.iter().map(|m| m.tool_id).collect();
    for plugin in discover_plugins(plugins_root) {
        let plugin_id = plugin.manifest.id.trim().to_string();
        if plugin_id.is_empty() || builtins.contains(plugin_id.as_str()) {
            continue;
        }

        let enabled = snapshot
            .enabled
            .get(plugin_id.as_str())
            .copied()
            .unwrap_or(true);
        let icon = snapshot
            .icon
            .get(plugin_id.as_str())
            .copied()
            .unwrap_or(true);
        let category = normalize_category(plugin.manifest.category.as_deref());
        let capabilities = plugin
            .permissions
            .capabilities
            .iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect::<HashSet<_>>();
        let mut description = format!("Custom tool ({})", plugin_id);
        if !capabilities.is_empty() {
            let mut sorted = capabilities.iter().cloned().collect::<Vec<_>>();
            sorted.sort();
            description = format!("{description}; capabilities {}", sorted.join(","));
        }
        if let Some(min_host) = plugin.manifest.min_host_version.as_ref() {
            if !min_host.trim().is_empty() {
                description = format!("{description}; minHostVersion {min_host}");
            }
        }

        state.tools.insert(
            plugin_id.clone(),
            WorkspaceToolRecord {
                tool_id: plugin_id.clone(),
                title: plugin.manifest.name,
                description,
                category: category.to_string(),
                core: false,
                optional: true,
                version: plugin.manifest.version,
                source: "custom".to_string(),
                enabled,
                icon,
                status: status_for_enabled(enabled).to_string(),
                entry: Some(path_to_string(plugin.entry_path.as_path())),
            },
        );
        state.plugin_ids.insert(plugin_id);
        state
            .plugin_capabilities
            .insert(plugin.manifest.id.trim().to_string(), capabilities);
    }
}

fn discover_plugins(root: &Path) -> Vec<PluginDiscovery> {
    let read_dir = match fs::read_dir(root) {
        Ok(dir) => dir,
        Err(_) => return Vec::new(),
    };

    let mut discovered = Vec::new();
    for entry in read_dir {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let plugin_dir = entry.path();
        if !plugin_dir.is_dir() {
            continue;
        }

        let manifest_path = plugin_dir.join("manifest.json");
        let manifest_raw = match fs::read_to_string(&manifest_path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };
        let manifest = match serde_json::from_str::<PluginManifest>(&manifest_raw) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };
        let permissions_path = plugin_dir.join("permissions.json");
        let permissions_raw = match fs::read_to_string(&permissions_path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };
        let permissions = match serde_json::from_str::<PluginPermissions>(&permissions_raw) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };

        let entry_rel = manifest.entry.trim();
        if entry_rel.is_empty() {
            continue;
        }
        let entry_path = plugin_dir.join(entry_rel);
        if !entry_path.is_file() {
            continue;
        }

        discovered.push(PluginDiscovery {
            manifest,
            permissions,
            entry_path,
        });
    }

    discovered
}

fn normalize_category(input: Option<&str>) -> &'static str {
    match input.unwrap_or("workspace").trim() {
        "workspace" => "workspace",
        "agent" => "agent",
        "models" => "models",
        "data" => "data",
        "media" => "media",
        "ops" => "ops",
        _ => "workspace",
    }
}

fn sanitize_tool_id(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.trim().to_lowercase().chars() {
        let next = if ch.is_ascii_alphanumeric() { ch } else { '-' };
        if next == '-' {
            if last_dash {
                continue;
            }
            last_dash = true;
        } else {
            last_dash = false;
        }
        out.push(next);
        if out.len() >= 40 {
            break;
        }
    }
    out.trim_matches('-').to_string()
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn render_plugin_index_html(title: &str, description: &str) -> String {
    format!(
        r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{}</title>
    <style>
      :root {{ color-scheme: dark; }}
      body {{ margin: 0; font: 13px/1.45 ui-sans-serif, system-ui, sans-serif; background: #10151b; color: #d8e0ea; }}
      .wrap {{ padding: 14px; display: grid; gap: 12px; }}
      .panel {{ border: 1px solid #2d3948; border-radius: 8px; padding: 12px; background: #151d26; }}
      h1 {{ margin: 0; font-size: 16px; }}
      p {{ margin: 6px 0 0; color: #9aa8b8; }}
      button {{ height: 30px; border-radius: 6px; border: 1px solid #3a4a5d; background: #202b37; color: #edf3fb; padding: 0 12px; }}
      pre {{ margin: 0; white-space: pre-wrap; word-break: break-word; color: #c5d1df; }}
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="panel">
        <h1>{}</h1>
        <p>{}</p>
      </section>
      <section class="panel">
        <button id="runBtn" type="button">Run</button>
      </section>
      <section class="panel"><pre id="output">Ready.</pre></section>
    </main>
    <script src="./main.js"></script>
  </body>
</html>
"#,
        escape_html(title),
        escape_html(title),
        escape_html(description)
    )
}

fn render_plugin_main_js(title: &str) -> String {
    format!(
        r#"(() => {{
  const output = document.getElementById("output");
  const runBtn = document.getElementById("runBtn");
  function setOutput(text) {{
    if (output) output.textContent = text;
  }}
  window.addEventListener("message", (event) => {{
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "plugin.init" || data.type === "customTool.init") {{
      setOutput("Ready.");
    }}
  }});
  if (runBtn) {{
    runBtn.addEventListener("click", () => {{
      setOutput("Ran at " + new Date().toLocaleTimeString());
    }});
  }}
  window.parent.postMessage({{ type: "plugin.ready", title: {} }}, "*");
}})();
"#,
        serde_json::to_string(title).unwrap_or_else(|_| "\"App Tool\"".to_string())
    )
}

fn default_registry_path() -> PathBuf {
    if let Ok(raw) = std::env::var(TOOL_REGISTRY_ENV_PATH) {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    default_app_state_root().join("tools-registry.json")
}

fn default_plugins_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let workspace_root = if cwd.ends_with("src-tauri") {
        cwd.parent().unwrap_or(cwd.as_path()).to_path_buf()
    } else {
        cwd
    };
    workspace_root.join("plugins")
}

fn default_app_state_root() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let trimmed = appdata.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed).join("arxell-lite");
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            let trimmed = home.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed)
                    .join("Library")
                    .join("Application Support")
                    .join("arxell-lite");
            }
        }
    }

    if let Ok(xdg_state_home) = std::env::var("XDG_STATE_HOME") {
        let trimmed = xdg_state_home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("arxell-lite");
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed)
                .join(".local")
                .join("state")
                .join("arxell-lite");
        }
    }

    std::env::temp_dir().join("arxell-lite")
}

fn read_registry_snapshot(path: &PathBuf) -> ToolRegistrySnapshot {
    let Ok(raw) = fs::read_to_string(path) else {
        return ToolRegistrySnapshot {
            version: TOOL_REGISTRY_VERSION,
            enabled: HashMap::new(),
            icon: HashMap::new(),
        };
    };
    let Ok(parsed) = serde_json::from_str::<ToolRegistrySnapshot>(&raw) else {
        return ToolRegistrySnapshot {
            version: TOOL_REGISTRY_VERSION,
            enabled: HashMap::new(),
            icon: HashMap::new(),
        };
    };
    parsed
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
