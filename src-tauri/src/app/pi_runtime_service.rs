use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::RwLock;

pub const PI_MIN_VERSION: (u64, u64, u64) = (0, 81, 0);
pub const PI_MAX_EXCLUSIVE_VERSION: (u64, u64, u64) = (0, 82, 0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PiRuntimeStatus {
    Ready,
    NotFound,
    IncompatibleVersion,
    MissingBash,
    LaunchFailed,
}

impl PiRuntimeStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::NotFound => "not_found",
            Self::IncompatibleVersion => "incompatible_version",
            Self::MissingBash => "missing_bash",
            Self::LaunchFailed => "launch_failed",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiRuntimeProbe {
    pub status: PiRuntimeStatus,
    pub installed: bool,
    pub compatible: bool,
    pub version: Option<String>,
    pub executable_path: Option<String>,
    pub bash_path: Option<String>,
    pub node_available: bool,
    pub npm_available: bool,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

pub struct PiRuntimeService {
    state_root: PathBuf,
    selected_executable: RwLock<Option<PathBuf>>,
}

impl PiRuntimeService {
    pub fn new(state_root: PathBuf) -> Self {
        Self {
            state_root,
            selected_executable: RwLock::new(None),
        }
    }

    pub fn probe(&self, requested_path: Option<&str>) -> PiRuntimeProbe {
        let requested = requested_path
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let candidates = if let Some(path) = requested {
            vec![path]
        } else if let Some(path) = self
            .selected_executable
            .read()
            .ok()
            .and_then(|path| path.clone())
        {
            vec![path]
        } else {
            discover_pi_candidates(&self.state_root)
        };

        let node_available = command_succeeds("node", &["--version"]);
        let npm_available = command_succeeds("npm", &["--version"]);
        let bash_path = discover_bash();
        let mut last_error = None;

        for candidate in candidates {
            match probe_candidate(&candidate) {
                Ok(version) => {
                    let executable = canonical_display(&candidate);
                    let compatible = version_is_supported(&version);
                    if !compatible {
                        return PiRuntimeProbe {
                            status: PiRuntimeStatus::IncompatibleVersion,
                            installed: true,
                            compatible: false,
                            version: Some(version),
                            executable_path: Some(executable),
                            bash_path,
                            node_available,
                            npm_available,
                            error_code: Some("incompatible_version".to_string()),
                            error_message: Some(format!(
                                "Arxell supports Pi >= {} and < {}.",
                                format_version(PI_MIN_VERSION),
                                format_version(PI_MAX_EXCLUSIVE_VERSION)
                            )),
                        };
                    }
                    if cfg!(target_os = "windows") && bash_path.is_none() {
                        return PiRuntimeProbe {
                            status: PiRuntimeStatus::MissingBash,
                            installed: true,
                            compatible: true,
                            version: Some(version),
                            executable_path: Some(executable),
                            bash_path: None,
                            node_available,
                            npm_available,
                            error_code: Some("missing_bash".to_string()),
                            error_message: Some(
                                "Pi requires Git Bash on Windows. Install Git for Windows or set PI_SHELL_PATH."
                                    .to_string(),
                            ),
                        };
                    }
                    if let Ok(mut selected) = self.selected_executable.write() {
                        *selected = Some(candidate);
                    }
                    return PiRuntimeProbe {
                        status: PiRuntimeStatus::Ready,
                        installed: true,
                        compatible: true,
                        version: Some(version),
                        executable_path: Some(executable),
                        bash_path,
                        node_available,
                        npm_available,
                        error_code: None,
                        error_message: None,
                    };
                }
                Err(error) => last_error = Some(error),
            }
        }

        let explicit = requested_path
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_some();
        PiRuntimeProbe {
            status: if explicit {
                PiRuntimeStatus::LaunchFailed
            } else {
                PiRuntimeStatus::NotFound
            },
            installed: false,
            compatible: false,
            version: None,
            executable_path: None,
            bash_path,
            node_available,
            npm_available,
            error_code: Some(if explicit {
                "invalid_executable_path".to_string()
            } else {
                "pi_not_found".to_string()
            }),
            error_message: Some(last_error.unwrap_or_else(|| {
                if !node_available {
                    "Pi was not found and Node.js is unavailable. Install Node.js, then install Pi."
                        .to_string()
                } else {
                    "Pi was not found in managed, explicit, PATH, npm, pnpm, Yarn, or Bun locations."
                        .to_string()
                }
            })),
        }
    }

    pub fn selected_executable(&self) -> Option<PathBuf> {
        self.selected_executable.read().ok()?.clone()
    }
}

fn discover_pi_candidates(state_root: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(explicit) = env::var_os("ARXELL_PI_EXECUTABLE").filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(explicit));
    }

    let executable_names: &[&str] = if cfg!(target_os = "windows") {
        &["pi.cmd", "pi.exe", "pi.bat"]
    } else {
        &["pi"]
    };
    for name in executable_names {
        candidates.push(state_root.join("pi-runtime").join("bin").join(name));
    }

    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            for name in executable_names {
                candidates.push(directory.join(name));
            }
        }
    }

    if let Some(home) = dirs::home_dir() {
        let directories = [
            home.join(".local/bin"),
            home.join(".npm-global/bin"),
            home.join(".bun/bin"),
            home.join(".yarn/bin"),
            home.join("Library/pnpm"),
            home.join(".local/share/pnpm"),
        ];
        for directory in directories {
            for name in executable_names {
                candidates.push(directory.join(name));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        for variable in ["APPDATA", "LOCALAPPDATA", "ProgramFiles"] {
            if let Some(root) = env::var_os(variable) {
                let root = PathBuf::from(root);
                for directory in [root.clone(), root.join("pnpm"), root.join("nodejs")] {
                    for name in executable_names {
                        candidates.push(directory.join(name));
                    }
                }
            }
        }
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| path.is_file())
        .filter(|path| seen.insert(path.to_string_lossy().to_lowercase()))
        .collect()
}

fn probe_candidate(candidate: &Path) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let output = {
        let extension = candidate
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if matches!(extension.to_ascii_lowercase().as_str(), "cmd" | "bat") {
            Command::new("cmd")
                .args(["/D", "/S", "/C"])
                .arg(candidate)
                .arg("--version")
                .output()
        } else {
            Command::new(candidate).arg("--version").output()
        }
    };
    #[cfg(not(target_os = "windows"))]
    let output = Command::new(candidate).arg("--version").output();

    let output =
        output.map_err(|error| format!("Could not launch {}: {error}", candidate.display()))?;
    if !output.status.success() {
        let diagnostic = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "{} --version failed: {}",
            candidate.display(),
            diagnostic.trim().chars().take(300).collect::<String>()
        ));
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_version(&version)
        .ok_or_else(|| format!("{} returned an invalid version", candidate.display()))?;
    Ok(version)
}

fn version_is_supported(version: &str) -> bool {
    parse_version(version)
        .map(|parsed| parsed >= PI_MIN_VERSION && parsed < PI_MAX_EXCLUSIVE_VERSION)
        .unwrap_or(false)
}

fn parse_version(value: &str) -> Option<(u64, u64, u64)> {
    let value = value.trim().trim_start_matches('v');
    let mut parts =
        value.split(|character: char| character == '.' || character == '-' || character == '+');
    Some((
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ))
}

fn format_version(version: (u64, u64, u64)) -> String {
    format!("{}.{}.{}", version.0, version.1, version.2)
}

fn canonical_display(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

fn command_succeeds(command: &str, args: &[&str]) -> bool {
    #[cfg(target_os = "windows")]
    let output = Command::new("cmd")
        .args(["/D", "/S", "/C", command])
        .args(args)
        .output();
    #[cfg(not(target_os = "windows"))]
    let output = Command::new(command).args(args).output();
    output
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn discover_bash() -> Option<String> {
    if let Some(explicit) = env::var_os("PI_SHELL_PATH").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(canonical_display(&path));
        }
    }
    #[cfg(target_os = "windows")]
    {
        let mut candidates = Vec::new();
        for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Some(root) = env::var_os(variable) {
                let root = PathBuf::from(root);
                candidates.push(root.join("Git/bin/bash.exe"));
                candidates.push(root.join("Programs/Git/bin/bash.exe"));
            }
        }
        if let Some(path) = env::var_os("PATH") {
            for directory in env::split_paths(&path) {
                candidates.push(directory.join("bash.exe"));
            }
        }
        candidates
            .into_iter()
            .find(|candidate| candidate.is_file())
            .map(|path| canonical_display(&path))
    }
    #[cfg(not(target_os = "windows"))]
    {
        [PathBuf::from("/bin/bash"), PathBuf::from("/usr/bin/bash")]
            .into_iter()
            .find(|candidate| candidate.is_file())
            .map(|path| canonical_display(&path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_version_range_is_explicit() {
        assert!(version_is_supported("0.81.0"));
        assert!(version_is_supported("v0.81.99"));
        assert!(!version_is_supported("0.80.9"));
        assert!(!version_is_supported("0.82.0"));
        assert!(!version_is_supported("invalid"));
    }

    #[test]
    fn runtime_probe_contract_serializes_camel_case_status() {
        let probe = PiRuntimeProbe {
            status: PiRuntimeStatus::Ready,
            installed: true,
            compatible: true,
            version: Some("0.81.1".to_string()),
            executable_path: Some("/runtime/pi".to_string()),
            bash_path: Some("/bin/bash".to_string()),
            node_available: true,
            npm_available: true,
            error_code: None,
            error_message: None,
        };
        let value = serde_json::to_value(probe).unwrap();
        assert_eq!(value["status"], "ready");
        assert_eq!(value["executablePath"], "/runtime/pi");
        assert_eq!(value["nodeAvailable"], true);
    }

    #[test]
    fn explicit_missing_executable_is_typed() {
        let service = PiRuntimeService::new(std::env::temp_dir());
        let probe = service.probe(Some("/definitely/missing/arxell-pi"));
        assert_eq!(probe.status, PiRuntimeStatus::LaunchFailed);
        assert_eq!(probe.error_code.as_deref(), Some("invalid_executable_path"));
        assert!(!probe.installed);
    }

    #[test]
    fn explicit_runtime_probe_reports_ready_and_incompatible_versions() {
        let Some(ready) = fake_version_executable("0.81.1", "ready") else {
            return;
        };
        let Some(incompatible) = fake_version_executable("0.82.0", "incompatible") else {
            return;
        };
        let service = PiRuntimeService::new(std::env::temp_dir());

        let ready_probe = service.probe(ready.to_str());
        assert_eq!(ready_probe.status, PiRuntimeStatus::Ready);
        assert!(ready_probe.compatible);
        assert_eq!(ready_probe.version.as_deref(), Some("0.81.1"));

        let incompatible_probe =
            PiRuntimeService::new(std::env::temp_dir()).probe(incompatible.to_str());
        assert_eq!(
            incompatible_probe.status,
            PiRuntimeStatus::IncompatibleVersion
        );
        assert_eq!(
            incompatible_probe.error_code.as_deref(),
            Some("incompatible_version")
        );
        let _ = std::fs::remove_file(ready);
        let _ = std::fs::remove_file(incompatible);
    }

    #[test]
    fn candidate_discovery_deduplicates_paths() {
        let root = std::env::temp_dir().join("arxell-runtime-discovery-test");
        let candidates = discover_pi_candidates(&root);
        let unique = candidates
            .iter()
            .map(|path| path.to_string_lossy().to_lowercase())
            .collect::<HashSet<_>>();
        assert_eq!(unique.len(), candidates.len());
    }

    fn fake_version_executable(version: &str, label: &str) -> Option<PathBuf> {
        if !command_succeeds("node", &["--version"]) {
            return None;
        }
        let extension = if cfg!(target_os = "windows") {
            "cmd"
        } else {
            "sh"
        };
        let path = std::env::temp_dir().join(format!(
            "arxell-pi-version-{}-{}.{}",
            std::process::id(),
            label,
            extension
        ));
        let script = if cfg!(target_os = "windows") {
            format!("@node -e \"console.log('{}')\"\r\n", version)
        } else {
            format!("#!/bin/sh\nexec node -e \"console.log('{}')\"\n", version)
        };
        std::fs::write(&path, script).ok()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&path).ok()?.permissions();
            permissions.set_mode(0o700);
            std::fs::set_permissions(&path, permissions).ok()?;
        }
        Some(path)
    }
}
