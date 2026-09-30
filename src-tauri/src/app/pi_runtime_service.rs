use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::RwLock;
use std::time::Duration;

const PROBE_TIMEOUT_SECS: u64 = 10;

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

        let found_candidate = candidates.iter().any(|candidate| candidate.is_file());
        let node_available = node_version_supported();
        let npm_available = command_succeeds("npm", &["--version"]);
        let bash_path = discover_bash();
        let mut last_error = None;

        for candidate in candidates {
            match probe_candidate(&candidate) {
                Ok(version) => {
                    let executable = canonical_display(&candidate);
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
            status: if explicit || found_candidate {
                PiRuntimeStatus::LaunchFailed
            } else {
                PiRuntimeStatus::NotFound
            },
            installed: found_candidate,
            compatible: false,
            version: None,
            executable_path: None,
            bash_path,
            node_available,
            npm_available,
            error_code: Some(if explicit {
                "invalid_executable_path".to_string()
            } else if found_candidate {
                "pi_launch_failed".to_string()
            } else {
                "pi_not_found".to_string()
            }),
            error_message: Some(last_error.unwrap_or_else(|| {
                if !node_available {
                    "Automatic Pi installation requires Node.js 22.19.0 or newer and npm. Install or update Node.js, then retry."
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

    for directory in supplemental_bin_directories() {
        for name in executable_names {
            candidates.push(directory.join(name));
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

    // Prefer an existing user/system installation. The app-managed copy is a fallback only.
    for name in executable_names {
        let managed_runtime = state_root.join("pi-runtime");
        candidates.push(managed_runtime.join("node_modules").join(".bin").join(name));
        candidates.push(managed_runtime.join("bin").join(name));
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| path.is_file())
        .filter(|path| seen.insert(path.to_string_lossy().to_lowercase()))
        .collect()
}

/// Directories that GUI-launched apps commonly miss because their inherited
/// PATH is minimal. Applied to candidate discovery, probe subprocesses, and
/// Node/npm availability checks.
fn supplemental_bin_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();
    #[cfg(target_os = "macos")]
    {
        directories.push(PathBuf::from("/opt/homebrew/bin"));
        directories.push(PathBuf::from("/usr/local/bin"));
    }
    #[cfg(target_os = "windows")]
    {
        // npm's default global install root (%APPDATA%\npm) is not on PATH
        // for GUI apps even though `npm install -g` puts pi.cmd there.
        if let Some(root) = env::var_os("APPDATA") {
            directories.push(PathBuf::from(root).join("npm"));
        }
    }
    if let Some(home) = dirs::home_dir() {
        directories.push(home.join(".local/bin"));
    }
    directories
}

fn augment_path_from(existing: Option<std::ffi::OsString>) -> std::ffi::OsString {
    let mut entries = supplemental_bin_directories();
    if let Some(path) = existing {
        entries.extend(env::split_paths(&path));
    }
    let mut seen = HashSet::new();
    let unique = entries
        .into_iter()
        .filter(|entry| seen.insert(entry.to_string_lossy().to_lowercase()))
        .collect::<Vec<_>>();
    env::join_paths(unique).unwrap_or_else(|_| env::var_os("PATH").unwrap_or_default())
}

fn augmented_path() -> std::ffi::OsString {
    augment_path_from(env::var_os("PATH"))
}

/// Run a probe command with piped output and a hard deadline so a hung
/// wrapper (waiting on stdin, network, or a broken shim) cannot freeze the
/// readiness probe. Returns `None` on timeout.
fn run_probe_with_timeout(command: &mut Command, timeout: Duration) -> Option<Output> {
    command
        .env("PATH", augmented_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    let mut child = command.spawn().ok()?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return None,
        }
    }
    child.wait_with_output().ok()
}

fn probe_candidate(candidate: &Path) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let extension = candidate
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if matches!(extension.to_ascii_lowercase().as_str(), "cmd" | "bat") {
            let mut command = Command::new("cmd");
            command
                .args(["/D", "/S", "/C"])
                .arg(candidate)
                .arg("--version");
            command
        } else {
            let mut command = Command::new(candidate);
            command.arg("--version");
            command
        }
    };
    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = Command::new(candidate);
        command.arg("--version");
        command
    };

    let output = run_probe_with_timeout(&mut command, Duration::from_secs(PROBE_TIMEOUT_SECS))
        .ok_or_else(|| {
            format!(
                "{} --version did not finish within {PROBE_TIMEOUT_SECS}s",
                candidate.display()
            )
        })?;
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

fn node_version_supported() -> bool {
    let mut command = Command::new("node");
    command.arg("--version");
    let Some(output) =
        run_probe_with_timeout(&mut command, Duration::from_secs(PROBE_TIMEOUT_SECS))
    else {
        return false;
    };
    let version = String::from_utf8_lossy(&output.stdout);
    output.status.success() && is_supported_pi_node_version(version.trim())
}

fn is_supported_pi_node_version(value: &str) -> bool {
    parse_version(value).is_some_and(|version| version >= (22, 19, 0))
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

fn canonical_display(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

fn command_succeeds(command: &str, args: &[&str]) -> bool {
    #[cfg(target_os = "windows")]
    let mut probe = {
        let mut probe = Command::new("cmd");
        probe.args(["/D", "/S", "/C", command]);
        probe.args(args);
        probe
    };
    #[cfg(not(target_os = "windows"))]
    let mut probe = {
        let mut probe = Command::new(command);
        probe.args(args);
        probe
    };
    run_probe_with_timeout(&mut probe, Duration::from_secs(PROBE_TIMEOUT_SECS))
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
    fn semantic_versions_are_parsed_without_a_supported_range_gate() {
        assert!(parse_version("0.81.1").is_some());
        assert!(parse_version("v0.84.2").is_some());
        assert!(parse_version("0.99.1").is_some());
        assert!(parse_version("invalid").is_none());
    }

    #[test]
    fn automatic_pi_install_requires_node_22_19_or_newer() {
        assert!(!is_supported_pi_node_version("v20.19.0"));
        assert!(!is_supported_pi_node_version("v22.18.9"));
        assert!(is_supported_pi_node_version("v22.19.0"));
        assert!(is_supported_pi_node_version("v24.0.0"));
        assert!(!is_supported_pi_node_version("not-node"));
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
    fn explicit_runtime_probe_accepts_newer_versions() {
        let Some(previous) = fake_version_executable("0.81.1", "previous") else {
            return;
        };
        let Some(newer) = fake_version_executable("0.84.2", "newer") else {
            return;
        };
        let Some(current) = fake_version_executable("0.99.1", "current") else {
            return;
        };

        for (path, version) in [
            (&previous, "0.81.1"),
            (&newer, "0.84.2"),
            (&current, "0.99.1"),
        ] {
            let probe = PiRuntimeService::new(std::env::temp_dir()).probe(path.to_str());
            assert_eq!(probe.status, PiRuntimeStatus::Ready);
            assert!(probe.compatible);
            assert_eq!(probe.version.as_deref(), Some(version));
        }

        let _ = std::fs::remove_file(previous);
        let _ = std::fs::remove_file(newer);
        let _ = std::fs::remove_file(current);
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

    #[test]
    fn augmented_path_prepends_supplemental_dirs_without_duplicates() {
        let supplemental = supplemental_bin_directories();
        assert!(!supplemental.is_empty());
        #[cfg(target_os = "macos")]
        assert!(supplemental.contains(&PathBuf::from("/opt/homebrew/bin")));
        #[cfg(target_os = "windows")]
        assert!(supplemental.iter().any(|dir| dir.ends_with("npm")));

        let base = if cfg!(target_os = "windows") {
            env::join_paths([PathBuf::from("C:\\tools")]).unwrap()
        } else {
            env::join_paths([PathBuf::from("/custom/bin")]).unwrap()
        };
        let augmented = augment_path_from(Some(base));
        let entries: Vec<PathBuf> = env::split_paths(&augmented).collect();
        assert_eq!(entries.first(), supplemental.first());
        assert!(
            entries.contains(&PathBuf::from(if cfg!(target_os = "windows") {
                "C:\\tools"
            } else {
                "/custom/bin"
            }))
        );
        // A supplemental directory already present in PATH must not duplicate.
        let with_dup = augment_path_from(Some(env::join_paths([supplemental[0].clone()]).unwrap()));
        let dup_entries: Vec<PathBuf> = env::split_paths(&with_dup).collect();
        assert_eq!(
            dup_entries
                .iter()
                .filter(|entry| **entry == supplemental[0])
                .count(),
            1
        );
    }

    #[test]
    fn hung_executable_times_out_instead_of_blocking_the_probe() {
        if !command_succeeds("node", &["--version"]) {
            return;
        }
        let extension = if cfg!(target_os = "windows") {
            "cmd"
        } else {
            "sh"
        };
        let path = std::env::temp_dir().join(format!(
            "arxell-pi-hung-{}-{}.{}",
            std::process::id(),
            "probe",
            extension
        ));
        let script = if cfg!(target_os = "windows") {
            "@node -e \"setTimeout(()=>{},30000)\"\r\n".to_string()
        } else {
            "#!/bin/sh\nexec node -e \"setTimeout(()=>{},30000)\"\n".to_string()
        };
        // Write-then-rename so the fixture is never exec'd mid-write
        // (executing a file that is open for writing fails with ETXTBSY
        // under load).
        let staging = path.with_extension("tmp");
        if std::fs::write(&staging, script).is_err() {
            return;
        }
        if std::fs::rename(&staging, &path).is_err() {
            return;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(mut permissions) = std::fs::metadata(&path).map(|m| m.permissions()) {
                permissions.set_mode(0o700);
                let _ = std::fs::set_permissions(&path, permissions);
            }
        }

        let started = std::time::Instant::now();
        let result = probe_candidate(&path);
        let elapsed = started.elapsed();
        let _ = std::fs::remove_file(&path);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("did not finish within"));
        assert!(
            elapsed < Duration::from_secs(PROBE_TIMEOUT_SECS + 10),
            "probe took {elapsed:?}"
        );
    }

    #[test]
    fn managed_npm_binary_is_discovered() {
        let root =
            std::env::temp_dir().join(format!("arxell-managed-pi-runtime-{}", std::process::id()));
        let executable_name = if cfg!(target_os = "windows") {
            "pi.cmd"
        } else {
            "pi"
        };
        let executable = root
            .join("pi-runtime")
            .join("node_modules")
            .join(".bin")
            .join(executable_name);
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, "managed pi fixture").unwrap();

        let candidates = discover_pi_candidates(&root);
        assert!(candidates.contains(&executable));

        let _ = std::fs::remove_dir_all(root);
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
        // Write-then-rename so the wrapper is never exec'd mid-write
        // (executing a file that is open for writing fails with ETXTBSY
        // under load).
        let staging = path.with_extension("tmp");
        std::fs::write(&staging, script).ok()?;
        std::fs::rename(&staging, &path).ok()?;
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
