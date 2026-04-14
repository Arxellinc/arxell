use crate::contracts::WorkspaceToolRecord;
use serde::{Deserialize, Serialize};
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
        tool_id: "createTool",
        title: "Create Tool",
        description: "Scaffold and register custom workspace tools",
        category: "workspace",
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
        let Some(parent) = self.registry_path.parent() else {
            return Err("invalid tool registry path".to_string());
        };
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed creating tool registry dir: {e}"))?;
        let payload = serde_json::to_string_pretty(&snapshot)
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
