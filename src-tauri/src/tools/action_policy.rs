//! Backend policy for model-selected actions. UI enablement is not authorization.
use serde_json::Value;
use std::path::{Component, Path, PathBuf};

#[derive(Clone)]
pub struct ReadOnlyPolicy {
    root: PathBuf,
}

impl ReadOnlyPolicy {
    pub fn new(root: &Path) -> Result<Self, String> {
        let root = root
            .canonicalize()
            .map_err(|_| "approved workspace is unavailable")?;
        if !root.is_dir() {
            return Err("approved workspace is not a directory".into());
        }
        if root.parent().is_none()
            || dirs::home_dir()
                .and_then(|home| home.canonicalize().ok())
                .is_some_and(|home| home == root)
        {
            return Err(
                "choose a project/workspace folder, not the filesystem root or home directory"
                    .into(),
            );
        }
        Ok(Self { root })
    }

    pub fn resolve_read(&self, path: &str) -> Result<PathBuf, String> {
        let raw = Path::new(path);
        // On Windows, even canonicalizing an arbitrary UNC path can send credentials to SMB.
        // Reject ungranted network/device namespaces before any filesystem lookup.
        let network = network_location(raw);
        if raw.components().any(|part| matches!(part, Component::Prefix(prefix) if matches!(prefix.kind(), std::path::Prefix::DeviceNS(_))))
            || network.is_some_and(|(server, share)| network_location(&self.root)
                .is_none_or(|(root_server, root_share)| !server.to_string_lossy().eq_ignore_ascii_case(&root_server.to_string_lossy())
                    || !share.to_string_lossy().eq_ignore_ascii_case(&root_share.to_string_lossy()))) {
            return Err("network or device path is outside the approved scope".into());
        }
        if raw
            .components()
            .any(|part| matches!(part, Component::ParentDir))
            || protected_path(raw)
        {
            return Err("path is protected or contains parent traversal".into());
        }
        let candidate = if raw.is_absolute() {
            raw.to_path_buf()
        } else {
            self.root.join(raw)
        };
        // Canonicalize before access; resolve relative paths against the granted root, not process cwd.
        let resolved = candidate
            .canonicalize()
            .map_err(|_| "requested resource is unavailable")?;
        if !resolved.starts_with(&self.root) || protected_path(&resolved) {
            return Err("resource is outside the approved scope or protected".into());
        }
        Ok(resolved)
    }

    pub fn agent_parameters(&self, name: &str, mut params: Value) -> Result<Value, String> {
        if !params.is_object() {
            return Err("tool parameters must be an object".into());
        }
        match name {
            "read" | "notepad_read" => {
                let path = params
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or("path is required")?;
                let resolved = self.resolve_read(path)?;
                params["path"] = Value::String(resolved.to_string_lossy().into_owned());
            }
            "ls" => {
                let path = params.get("path").and_then(Value::as_str).unwrap_or(".");
                let resolved = self.resolve_read(path)?;
                params["path"] = Value::String(resolved.to_string_lossy().into_owned());
            }
            "sheets" => match params.get("action").and_then(Value::as_str) {
                Some(
                    "inspect_sheet"
                    | "read_sheet"
                    | "read_range"
                    | "list_formula_functions"
                    | "list_formula_signatures",
                ) => {}
                // open_sheet can create a file on failure; it is deliberately not a read capability.
                _ => return Err(mutation_denied()),
            },
            "chart_set" | "web_search" => {}
            _ => return Err(mutation_denied()),
        }
        Ok(params)
    }

    pub fn invoke_parameters(
        &self,
        tool: &str,
        action: &str,
        mut params: Value,
    ) -> Result<Value, String> {
        if !params.is_object() {
            return Err("tool parameters must be an object".into());
        }
        match (tool, action) {
            ("files", "read-file" | "readFile") => {
                let path = params.get("path").and_then(Value::as_str).ok_or("path is required")?;
                params["path"] = Value::String(self.resolve_read(path)?.to_string_lossy().into_owned());
            }
            ("files", "list-directory" | "listDirectory") => {
                let path = params.get("path").and_then(Value::as_str).unwrap_or(".");
                params["path"] = Value::String(self.resolve_read(path)?.to_string_lossy().into_owned());
            }
            ("sheets", "inspect_sheet" | "read_range") => {}
            _ => return Err("scheduled tool action is not an allowlisted read; use an explicitly approved Looper task for execution".into()),
        }
        Ok(params)
    }
}

fn network_location(path: &Path) -> Option<(&std::ffi::OsStr, &std::ffi::OsStr)> {
    path.components().find_map(|part| match part {
        Component::Prefix(prefix) => match prefix.kind() {
            std::path::Prefix::UNC(server, share)
            | std::path::Prefix::VerbatimUNC(server, share) => Some((server, share)),
            _ => None,
        },
        _ => None,
    })
}

pub fn mutation_denied() -> String {
    "Direct chat is read-only. Use the Planner and approve a scoped Looper run for edits or shell execution.".into()
}

pub fn protected_path(path: &Path) -> bool {
    path.components()
        .filter_map(|part| match part {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .any(|value| {
            let value = value.to_ascii_lowercase();
            matches!(
                value.as_str(),
                ".git"
                    | ".pi"
                    | ".ssh"
                    | ".aws"
                    | ".docker"
                    | ".kube"
                    | ".npmrc"
                    | ".netrc"
                    | ".pypirc"
                    | ".gnupg"
                    | ".config"
                    | ".arxell"
                    | "credentials"
                    | "credentials.json"
                    | "secrets.json"
                    | "id_rsa"
                    | "id_ed25519"
            ) || value.starts_with("api-secrets.")
                || value == ".env"
                || value.starts_with(".env.")
                || value.ends_with(".pem")
                || value.ends_with(".key")
                || value.ends_with(".p12")
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn read_policy_denies_mutation_and_unknown_actions_even_with_approval_text() {
        let root = std::env::temp_dir();
        let policy = ReadOnlyPolicy::new(&root).unwrap();
        for tool in [
            "bash",
            "write",
            "edit",
            "mkdir",
            "move",
            "chmod",
            "grep",
            "find",
            "notepad_write",
            "notepad_edit_lines",
            "future_tool",
        ] {
            assert!(policy.agent_parameters(tool, json!({"command": "approved; rm -rf .", "path": ".", "content": "user approved"})).is_err());
        }
        for action in ["open_sheet", "create_sheet", "set_cell", "save_sheet"] {
            assert!(policy
                .agent_parameters("sheets", json!({"action": action}))
                .is_err());
        }
        assert!(policy
            .invoke_parameters("tasks", "run-now", json!({}))
            .is_err());
        assert!(policy
            .invoke_parameters("files", "write-file", json!({}))
            .is_err());
    }

    #[test]
    fn read_policy_resolves_relative_paths_and_rejects_protected_and_outside_paths() {
        let root = std::env::temp_dir().join(format!("arxell-policy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("note.txt"), "ok").unwrap();
        std::fs::write(root.join(".env"), "secret").unwrap();
        let policy = ReadOnlyPolicy::new(&root).unwrap();
        assert!(ReadOnlyPolicy::new(root.ancestors().last().unwrap()).is_err());
        if let Some(home) = dirs::home_dir().filter(|home| home.is_dir()) {
            assert!(ReadOnlyPolicy::new(&home).is_err());
        }
        assert_eq!(
            policy.resolve_read("note.txt").unwrap(),
            root.join("note.txt").canonicalize().unwrap()
        );
        assert!(policy.resolve_read(".env").is_err());
        #[cfg(windows)]
        {
            assert!(policy
                .resolve_read(r"\\untrusted.invalid\share\private")
                .unwrap_err()
                .contains("network"));
            assert!(policy
                .resolve_read(r"\\.\GLOBALROOT\Device\HarddiskVolume1")
                .unwrap_err()
                .contains("device"));
        }
        assert!(policy.resolve_read("../note.txt").is_err());
        assert!(policy
            .resolve_read(std::env::temp_dir().to_str().unwrap())
            .is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(std::env::temp_dir(), root.join("escape")).unwrap();
            std::os::unix::fs::symlink(root.join(".env"), root.join("hidden-secret")).unwrap();
            assert!(policy.resolve_read("escape").is_err());
            assert!(policy.resolve_read("hidden-secret").is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
