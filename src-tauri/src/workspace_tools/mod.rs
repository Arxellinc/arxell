use crate::contracts::WorkspaceToolRecord;
use std::collections::HashMap;
use std::sync::RwLock;

pub struct WorkspaceToolsService {
    tools: RwLock<HashMap<String, WorkspaceToolRecord>>,
}

impl WorkspaceToolsService {
    pub fn new() -> Self {
        let mut tools = HashMap::new();
        tools.insert(
            "terminal".to_string(),
            WorkspaceToolRecord {
                tool_id: "terminal".to_string(),
                title: "Terminal".to_string(),
                enabled: true,
                status: "ready".to_string(),
            },
        );
        Self {
            tools: RwLock::new(tools),
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
        tool.status = if enabled {
            "ready".to_string()
        } else {
            "disabled".to_string()
        };
        Ok(())
    }
}

impl Default for WorkspaceToolsService {
    fn default() -> Self {
        Self::new()
    }
}
