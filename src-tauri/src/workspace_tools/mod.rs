use crate::contracts::WorkspaceToolRecord;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
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
        tool_id: "web",
        title: "Web",
        description: "Search and fetch web context for tasks",
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
        default_enabled: false,
    },
    WorkspaceToolManifest {
        tool_id: "llm",
        title: "LLM",
        description: "Model inference and runtime controls",
        category: "models",
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
        tool_id: "models",
        title: "Models",
        description: "Installed model catalog and downloads",
        category: "models",
        core: false,
        default_enabled: true,
    },
    WorkspaceToolManifest {
        tool_id: "voice",
        title: "Voice",
        description: "STT/TTS toolchain and microphone helpers",
        category: "media",
        core: false,
        default_enabled: true,
    },
    WorkspaceToolManifest {
        tool_id: "devices",
        title: "Devices",
        description: "Audio and hardware device controls",
        category: "ops",
        core: false,
        default_enabled: true,
    },
    WorkspaceToolManifest {
        tool_id: "settings",
        title: "Settings",
        description: "System and tool runtime preferences",
        category: "ops",
        core: true,
        default_enabled: true,
    },
];

#[derive(Debug, Default, Serialize, Deserialize)]
struct ToolRegistrySnapshot {
    version: u32,
    enabled: HashMap<String, bool>,
}

pub struct WorkspaceToolsService {
    tools: RwLock<HashMap<String, WorkspaceToolRecord>>,
    registry_path: PathBuf,
}

impl WorkspaceToolsService {
    pub fn new() -> Self {
        let registry_path = default_registry_path();
        let snapshot = read_registry_snapshot(&registry_path);
        let mut tools = HashMap::new();
        for manifest in WORKSPACE_TOOL_MANIFESTS {
            let enabled = snapshot
                .enabled
                .get(manifest.tool_id)
                .copied()
                .unwrap_or(manifest.default_enabled);
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
                    status: status_for_enabled(enabled).to_string(),
                },
            );
        }
        Self {
            tools: RwLock::new(tools),
            registry_path,
        }
    }

    pub fn list(&self) -> Vec<WorkspaceToolRecord> {
        let tools = self.tools.read().expect("workspace tools lock poisoned");
        let mut records: Vec<_> = tools.values().cloned().collect();
        records.sort_by(|a, b| a.tool_id.cmp(&b.tool_id));
        records
    }

    pub fn set_enabled(&self, tool_id: &str, enabled: bool) -> Result<(), String> {
        let mut tools = self.tools.write().expect("workspace tools lock poisoned");
        let Some(tool) = tools.get_mut(tool_id) else {
            return Err(format!("workspace tool not found: {tool_id}"));
        };
        tool.enabled = enabled;
        tool.status = status_for_enabled(enabled).to_string();
        self.persist_snapshot(&tools)?;
        Ok(())
    }

    pub fn export_snapshot_json(&self) -> Result<String, String> {
        let tools = self.tools.read().expect("workspace tools lock poisoned");
        let enabled = tools
            .iter()
            .map(|(tool_id, tool)| (tool_id.clone(), tool.enabled))
            .collect::<HashMap<_, _>>();
        let snapshot = ToolRegistrySnapshot {
            version: TOOL_REGISTRY_VERSION,
            enabled,
        };
        serde_json::to_string_pretty(&snapshot)
            .map(|payload| format!("{payload}\n"))
            .map_err(|e| format!("failed serializing tool registry export: {e}"))
    }

    pub fn import_snapshot_json(&self, snapshot_json: &str) -> Result<Vec<WorkspaceToolRecord>, String> {
        let parsed = serde_json::from_str::<ToolRegistrySnapshot>(snapshot_json)
            .map_err(|e| format!("invalid tool registry import payload: {e}"))?;
        let mut tools = self.tools.write().expect("workspace tools lock poisoned");
        for (tool_id, tool) in tools.iter_mut() {
            let enabled = parsed
                .enabled
                .get(tool_id)
                .copied()
                .unwrap_or(tool.enabled);
            tool.enabled = enabled;
            tool.status = status_for_enabled(enabled).to_string();
        }
        self.persist_snapshot(&tools)?;
        let mut records: Vec<_> = tools.values().cloned().collect();
        records.sort_by(|a, b| a.tool_id.cmp(&b.tool_id));
        Ok(records)
    }

    fn persist_snapshot(&self, tools: &HashMap<String, WorkspaceToolRecord>) -> Result<(), String> {
        let enabled = tools
            .iter()
            .map(|(tool_id, tool)| (tool_id.clone(), tool.enabled))
            .collect::<HashMap<_, _>>();
        let snapshot = ToolRegistrySnapshot {
            version: TOOL_REGISTRY_VERSION,
            enabled,
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

fn default_registry_path() -> PathBuf {
    if let Ok(raw) = std::env::var(TOOL_REGISTRY_ENV_PATH) {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    std::env::temp_dir()
        .join("arxell-lite")
        .join("tools-registry.json")
}

fn read_registry_snapshot(path: &PathBuf) -> ToolRegistrySnapshot {
    let Ok(raw) = fs::read_to_string(path) else {
        return ToolRegistrySnapshot {
            version: TOOL_REGISTRY_VERSION,
            enabled: HashMap::new(),
        };
    };
    let Ok(parsed) = serde_json::from_str::<ToolRegistrySnapshot>(&raw) else {
        return ToolRegistrySnapshot {
            version: TOOL_REGISTRY_VERSION,
            enabled: HashMap::new(),
        };
    };
    parsed
}
