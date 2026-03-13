use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncBufReadExt as _;
use tokio::process::Command;
use tokio::time::{timeout, Duration, Instant};
use toml::map::Map as TomlMap;
use toml::Value as TomlValue;

use super::terminal::TerminalExecResult;
use crate::AppState;

/// Bundled models.json from the codex-rs source tree, embedded at compile time.
const BUNDLED_CODEX_MODELS_JSON: &str =
    include_str!("../../resources/coder/codex-main/codex-rs/core/models.json");

/// Extract `base_instructions` from the first entry of the bundled models.json.
/// This gives local model entries the same high-quality coding agent system prompt
/// that the built-in codex models use.
fn bundled_base_instructions() -> &'static str {
    static INSTRUCTIONS: OnceLock<String> = OnceLock::new();
    INSTRUCTIONS.get_or_init(|| {
        serde_json::from_str::<serde_json::Value>(BUNDLED_CODEX_MODELS_JSON)
            .ok()
            .and_then(|v| {
                v["models"][0]["base_instructions"]
                    .as_str()
                    .map(String::from)
            })
            .unwrap_or_else(|| {
                "You are a coding agent. Help the user with their coding tasks using shell commands."
                    .to_string()
            })
    })
}

/// Generate a local model catalog JSON for common open-source / local model families.
///
/// Codex looks up model metadata by checking whether the passed model slug *starts with*
/// any catalog entry's slug.  By registering short prefix slugs (e.g. `"glm"`, `"qwen"`)
/// we match all variants of each family regardless of version suffix or namespace prefix.
///
/// The catalog is written to CODEX_HOME and referenced via `model_catalog_json` in
/// config.toml so codex never falls back to its built-in metadata for these models.
fn generate_local_models_catalog() -> String {
    let base_instructions = bundled_base_instructions();

    // (slug, display_name, context_window)
    // Slugs are prefix-matched case-sensitively, so we register both common
    // capitalisation variants.  context_window is in tokens.
    let entries: &[(&str, &str, i64)] = &[
        // Z.ai / Zhipu GLM
        ("glm", "GLM", 131_072),
        ("GLM", "GLM", 131_072),
        // Qwen / Alibaba
        ("qwen", "Qwen", 131_072),
        ("Qwen", "Qwen", 131_072),
        // DeepSeek
        ("deepseek", "DeepSeek", 131_072),
        ("DeepSeek", "DeepSeek", 131_072),
        // Meta LLaMA
        ("llama", "Llama", 131_072),
        ("Llama", "Llama", 131_072),
        ("meta-llama", "Meta Llama", 131_072),
        // Mistral / Codestral / Devstral / Ministral
        ("mistral", "Mistral", 131_072),
        ("Mistral", "Mistral", 131_072),
        ("codestral", "Codestral", 262_144),
        ("devstral", "Devstral", 131_072),
        ("ministral", "Ministral", 131_072),
        // Microsoft Phi
        ("phi", "Phi", 131_072),
        // Google Gemma / CodeGemma
        ("gemma", "Gemma", 131_072),
        ("codegemma", "CodeGemma", 131_072),
        // NVIDIA Nemotron
        ("nemotron", "Nemotron", 131_072),
        // StarCoder / BigCode
        ("starcoder", "StarCoder", 131_072),
        // Command R (Cohere)
        ("command", "Command", 131_072),
        // Yi
        ("yi", "Yi", 131_072),
        // Granite (IBM)
        ("granite", "Granite", 131_072),
        // OpenCoder / InternLM / Smol
        ("opencoder", "OpenCoder", 131_072),
        ("internlm", "InternLM", 131_072),
    ];

    let models: Vec<serde_json::Value> = entries
        .iter()
        .map(|(slug, name, ctx)| {
            serde_json::json!({
                "slug": slug,
                "display_name": name,
                "description": null,
                "supported_reasoning_levels": [],
                "shell_type": "shell_command",
                "visibility": "none",
                "supported_in_api": true,
                "priority": 50,
                "availability_nux": null,
                "upgrade": null,
                "base_instructions": base_instructions,
                "supports_reasoning_summaries": false,
                "support_verbosity": false,
                "default_verbosity": null,
                "apply_patch_tool_type": "freeform",
                "truncation_policy": { "mode": "tokens", "limit": 10000 },
                "supports_parallel_tool_calls": false,
                "context_window": ctx,
                "experimental_supported_tools": []
            })
        })
        .collect();

    serde_json::to_string(&serde_json::json!({ "models": models }))
        .unwrap_or_else(|_| r#"{"models":[]}"#.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiCandidateDiagnostic {
    pub source: String,
    pub path: String,
    pub exists: bool,
    pub is_file: bool,
    pub is_executable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiDiagnosticsResult {
    pub cwd: String,
    pub root_guard: Option<String>,
    pub requested_executable: Option<String>,
    pub fallback_binary: String,
    pub path_probe: Option<String>,
    pub candidates: Vec<PiCandidateDiagnostic>,
}

fn canonical_dir(path: &Path) -> Result<PathBuf, String> {
    let canon = std::fs::canonicalize(path)
        .map_err(|e| format!("Failed to resolve path '{}': {}", path.display(), e))?;
    if !canon.is_dir() {
        return Err(format!("Path is not a directory: {}", canon.display()));
    }
    Ok(canon)
}

fn ensure_within_root(cwd: &Path, root: &Path) -> Result<(), String> {
    let cwd_canon = canonical_dir(cwd)?;
    let root_canon = canonical_dir(root)?;
    if !cwd_canon.starts_with(&root_canon) {
        return Err(format!(
            "Path '{}' is outside allowed root '{}'",
            cwd_canon.display(),
            root_canon.display()
        ));
    }
    Ok(())
}

fn resolve_workdir(cwd: Option<String>, root_guard: Option<String>) -> Result<PathBuf, String> {
    let workdir = if let Some(cwd_raw) = cwd {
        canonical_dir(Path::new(&cwd_raw))?
    } else {
        std::env::current_dir().map_err(|e| format!("Failed to get current dir: {}", e))?
    };

    if let Some(root) = root_guard {
        ensure_within_root(&workdir, Path::new(&root))?;
    }
    Ok(workdir)
}

fn bundled_candidates(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve app resource dir: {}", e))?;

    let mut candidates = if cfg!(target_os = "windows") {
        vec![
            resource_dir.join("coder/codex-main/bin/codex.cmd"),
            resource_dir.join("coder/codex-main/bin/codex.exe"),
            resource_dir.join("coder/windows-x86_64/pi.exe"),
        ]
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            vec![
                resource_dir.join("coder/codex-main/bin/codex"),
                resource_dir.join("coder/macos-aarch64/pi"),
            ]
        } else {
            vec![
                resource_dir.join("coder/codex-main/bin/codex"),
                resource_dir.join("coder/macos-x86_64/pi"),
            ]
        }
    } else {
        if cfg!(target_arch = "aarch64") {
            vec![
                resource_dir.join("coder/codex-main/bin/codex"),
                resource_dir.join("coder/linux-aarch64/pi"),
            ]
        } else {
            vec![
                resource_dir.join("coder/codex-main/bin/codex"),
                resource_dir.join("coder/linux-x86_64/pi"),
            ]
        }
    };

    // Dev-mode fallback: resolve directly from source tree resources.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if cfg!(target_os = "windows") {
        candidates.push(manifest_dir.join("resources/coder/codex-main/bin/codex.cmd"));
        candidates.push(manifest_dir.join("resources/coder/codex-main/bin/codex.exe"));
        candidates.push(manifest_dir.join("resources/coder/windows-x86_64/pi.exe"));
    } else if cfg!(target_os = "macos") {
        candidates.push(manifest_dir.join("resources/coder/codex-main/bin/codex"));
        if cfg!(target_arch = "aarch64") {
            candidates.push(manifest_dir.join("resources/coder/macos-aarch64/pi"));
        } else {
            candidates.push(manifest_dir.join("resources/coder/macos-x86_64/pi"));
        }
    } else if cfg!(target_arch = "aarch64") {
        candidates.push(manifest_dir.join("resources/coder/codex-main/bin/codex"));
        candidates.push(manifest_dir.join("resources/coder/linux-aarch64/pi"));
    } else {
        candidates.push(manifest_dir.join("resources/coder/codex-main/bin/codex"));
        candidates.push(manifest_dir.join("resources/coder/linux-x86_64/pi"));
    }

    Ok(candidates)
}

fn fallback_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "codex.exe"
    } else {
        "codex"
    }
}

fn is_executable_path(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(target_os = "windows")]
    {
        true
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
}

fn first_bundled_hit(app: &AppHandle) -> Result<Option<String>, String> {
    for candidate in bundled_candidates(app)? {
        if is_executable_path(&candidate) {
            return Ok(Some(candidate.to_string_lossy().to_string()));
        }
    }
    Ok(None)
}

fn find_on_path_in_env(command: &str, path_env: &str) -> Option<String> {
    let cmd = command.trim();
    if cmd.is_empty() {
        return None;
    }

    let cmd_path = Path::new(cmd);
    if cmd_path.components().count() > 1 {
        return cmd_path
            .is_file()
            .then(|| cmd_path.to_string_lossy().to_string());
    }

    for base in std::env::split_paths(path_env) {
        let candidate = base.join(cmd);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

fn find_on_path(command: &str) -> Option<String> {
    let path_env = std::env::var("PATH").ok()?;
    find_on_path_in_env(command, &path_env)
}

fn is_default_coder_token(value: &str) -> bool {
    value.eq_ignore_ascii_case("pi")
        || value.eq_ignore_ascii_case("pi.exe")
        || value.eq_ignore_ascii_case("codex")
        || value.eq_ignore_ascii_case("codex.exe")
}

#[cfg(test)]
fn choose_executable(
    override_path: Option<&str>,
    bundled_candidate: Option<&str>,
    fallback: &str,
) -> String {
    let override_trimmed = override_path.unwrap_or("").trim();
    let bundled = bundled_candidate.unwrap_or("").trim();

    if !override_trimmed.is_empty() && !is_default_coder_token(override_trimmed) {
        return override_trimmed.to_string();
    }

    if !bundled.is_empty() {
        return bundled.to_string();
    }

    if !override_trimmed.is_empty() {
        return override_trimmed.to_string();
    }

    fallback.to_string()
}

fn resolve_executable_candidates(
    app: &AppHandle,
    override_path: Option<String>,
) -> Result<Vec<String>, String> {
    let override_trimmed = override_path.unwrap_or_default().trim().to_string();
    let bundled_hit = first_bundled_hit(app)?;
    let explicit_override =
        !override_trimmed.is_empty() && !is_default_coder_token(&override_trimmed);

    let mut candidates: Vec<String> = Vec::new();
    if explicit_override {
        candidates.push(override_trimmed.clone());
    }
    if let Some(bundled) = bundled_hit {
        if !candidates.iter().any(|c| c == &bundled) {
            candidates.push(bundled);
        }
    }

    Ok(candidates)
}

fn get_db_setting(app: &AppHandle, key: &str) -> Option<String> {
    let state = app.try_state::<AppState>()?;
    let db = state.db.lock().ok()?;
    db.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

#[derive(Debug, Clone)]
struct PrimaryModelConfig {
    model_id: String,
    base_url: String,
    api_key: String,
}

#[derive(Debug, Clone)]
struct ProviderModelConfig {
    model_id: String,
    base_url: String,
    api_key: String,
}

#[derive(Debug, Clone)]
struct PiRuntimeModelRow {
    id: String,
    name: String,
    api_type: String,
    model_id: String,
    base_url: String,
    api_key: String,
    is_primary: bool,
    last_available: bool,
    created_at: i64,
}

fn get_primary_model_config(app: &AppHandle) -> Option<PrimaryModelConfig> {
    let state = app.try_state::<AppState>()?;
    let db = state.db.lock().ok()?;
    db.query_row(
        "SELECT model_id, base_url, api_key
         FROM model_configs
         WHERE is_primary = 1
         ORDER BY created_at DESC
         LIMIT 1",
        [],
        |row| {
            Ok(PrimaryModelConfig {
                model_id: row.get::<_, String>(0)?,
                base_url: row.get::<_, String>(1)?,
                api_key: row.get::<_, String>(2)?,
            })
        },
    )
    .ok()
}

fn get_provider_model_config(app: &AppHandle, provider: &str) -> Option<ProviderModelConfig> {
    let state = app.try_state::<AppState>()?;
    let db = state.db.lock().ok()?;
    let provider_like = format!("{}/%", provider.trim().to_ascii_lowercase());
    db.query_row(
        "SELECT model_id, base_url, api_key
         FROM model_configs
         WHERE lower(model_id) LIKE ?1
         ORDER BY is_primary DESC, last_available DESC, created_at ASC
         LIMIT 1",
        rusqlite::params![provider_like],
        |row| {
            Ok(ProviderModelConfig {
                model_id: row.get::<_, String>(0)?,
                base_url: row.get::<_, String>(1)?,
                api_key: row.get::<_, String>(2)?,
            })
        },
    )
    .ok()
}

fn get_model_config_by_model_id(app: &AppHandle, model_id: &str) -> Option<ProviderModelConfig> {
    let wanted = model_id.trim().to_ascii_lowercase();
    if wanted.is_empty() {
        return None;
    }
    let state = app.try_state::<AppState>()?;
    let db = state.db.lock().ok()?;
    db.query_row(
        "SELECT model_id, base_url, api_key
         FROM model_configs
         WHERE lower(trim(model_id)) = ?1
         ORDER BY is_primary DESC, last_available DESC, created_at ASC
         LIMIT 1",
        rusqlite::params![wanted],
        |row| {
            Ok(ProviderModelConfig {
                model_id: row.get::<_, String>(0)?,
                base_url: row.get::<_, String>(1)?,
                api_key: row.get::<_, String>(2)?,
            })
        },
    )
    .ok()
}

fn list_pi_runtime_model_rows(app: &AppHandle) -> Vec<PiRuntimeModelRow> {
    let mut out: Vec<PiRuntimeModelRow> = Vec::new();
    let Some(state) = app.try_state::<AppState>() else {
        return out;
    };
    let Ok(db) = state.db.lock() else {
        return out;
    };

    let Ok(mut stmt) = db.prepare(
        "SELECT id, name, api_type, model_id, base_url, api_key, is_primary, last_available, created_at
         FROM model_configs
         WHERE trim(model_id) != ''
         ORDER BY is_primary DESC, last_available DESC, created_at ASC
         LIMIT 48",
    ) else {
        return out;
    };

    let Ok(rows) = stmt.query_map([], |row| {
        Ok(PiRuntimeModelRow {
            id: row.get::<_, String>(0)?,
            name: row.get::<_, String>(1)?,
            api_type: row.get::<_, String>(2)?,
            model_id: row.get::<_, String>(3)?,
            base_url: row.get::<_, String>(4)?,
            api_key: row.get::<_, String>(5)?,
            is_primary: row.get::<_, i64>(6)? != 0,
            last_available: row.get::<_, i64>(7)? != 0,
            created_at: row.get::<_, i64>(8)?,
        })
    }) else {
        return out;
    };

    for row in rows.flatten() {
        if !row.model_id.trim().is_empty() {
            out.push(row);
        }
    }
    out
}

fn normalize_api_base_url(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let last_segment = trimmed.rsplit('/').next().unwrap_or("");
    let has_version_suffix = last_segment.len() > 1
        && last_segment.as_bytes()[0].eq_ignore_ascii_case(&b'v')
        && last_segment[1..].chars().all(|c| c.is_ascii_digit());
    if has_version_suffix {
        Some(trimmed.to_string())
    } else {
        Some(format!("{trimmed}/v1"))
    }
}

fn canonical_provider_id(raw: &str) -> String {
    let p = raw.trim().to_ascii_lowercase();
    match p.as_str() {
        "azure-openai" | "azure-openai-responses" => "azure-openai-responses".to_string(),
        "google" | "gemini" => "google".to_string(),
        "ai-gateway" | "vercel-ai-gateway" => "vercel-ai-gateway".to_string(),
        "kimi" | "kimi-coding" => "kimi-coding".to_string(),
        "bedrock" | "amazon-bedrock" => "amazon-bedrock".to_string(),
        other => other.to_string(),
    }
}

fn infer_provider_from_base_url(base_url: &str) -> Option<String> {
    let lower = base_url.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return None;
    }
    if (lower.contains("localhost:11434") || lower.contains("127.0.0.1:11434"))
        && (lower.starts_with("http://") || lower.starts_with("https://"))
    {
        return Some("ollama".to_string());
    }
    if (lower.contains("localhost:1234") || lower.contains("127.0.0.1:1234"))
        && (lower.starts_with("http://") || lower.starts_with("https://"))
    {
        return Some("lmstudio".to_string());
    }
    if lower.contains("api.minimax") {
        return Some("minimax".to_string());
    }
    if lower.contains("api.z.ai")
        || lower.contains("open.bigmodel.cn")
        || lower.contains("bigmodel.cn")
    {
        return Some("zai".to_string());
    }
    if lower.contains("api.openrouter.ai") {
        return Some("openrouter".to_string());
    }
    if lower.contains("api.openai.com") {
        return Some("openai".to_string());
    }
    if lower.contains("openai.azure.com") || lower.contains(".azure.com/openai") {
        return Some("azure-openai-responses".to_string());
    }
    if lower.contains("api.anthropic.com") {
        return Some("anthropic".to_string());
    }
    if lower.contains("generativelanguage.googleapis.com")
        || lower.contains("aiplatform.googleapis.com")
    {
        return Some("google".to_string());
    }
    if lower.contains("api.mistral.ai") {
        return Some("mistral".to_string());
    }
    if lower.contains("api.groq.com") {
        return Some("groq".to_string());
    }
    if lower.contains("api.cerebras.ai") {
        return Some("cerebras".to_string());
    }
    if lower.contains("api.x.ai") {
        return Some("xai".to_string());
    }
    if lower.contains("moonshot") || lower.contains("kimi") {
        return Some("kimi-coding".to_string());
    }
    None
}

fn infer_provider_from_freeform_model(model_id: &str) -> Option<String> {
    let lower = model_id.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return None;
    }
    if lower.contains("minimax") {
        return Some("minimax".to_string());
    }
    if lower.contains("glm") || lower.contains("zhipu") || lower.contains("zai") {
        return Some("zai".to_string());
    }
    if lower.contains("kimi") {
        return Some("kimi-coding".to_string());
    }
    if lower.starts_with("gpt-")
        || lower.starts_with("o1")
        || lower.starts_with("o3")
        || lower.starts_with("o4")
    {
        return Some("openai".to_string());
    }
    None
}

fn infer_provider_for_config(model_id: &str, base_url: &str) -> Option<String> {
    provider_from_model_id(model_id)
        .or_else(|| infer_provider_from_base_url(base_url))
        .or_else(|| infer_provider_from_freeform_model(model_id))
        .map(|p| canonical_provider_id(&p))
}

fn is_known_provider(provider: &str) -> bool {
    matches!(
        provider,
        "anthropic"
            | "openai"
            | "ollama"
            | "lmstudio"
            | "azure-openai-responses"
            | "google"
            | "groq"
            | "cerebras"
            | "xai"
            | "openrouter"
            | "vercel-ai-gateway"
            | "zai"
            | "mistral"
            | "minimax"
            | "minimax-cn"
            | "kimi-coding"
            | "opencode"
            | "huggingface"
            | "amazon-bedrock"
    )
}

fn provider_from_model_id(model_id: &str) -> Option<String> {
    let trimmed = model_id.trim();
    let (provider, _) = trimmed.split_once('/')?;
    let p = canonical_provider_id(provider);
    if is_known_provider(&p) {
        Some(p)
    } else {
        None
    }
}

fn parse_pi_model_spec(spec: Option<String>) -> (Option<String>, Option<String>) {
    let raw = spec.unwrap_or_default();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return (None, None);
    }

    let lowered = trimmed.to_ascii_lowercase();
    // These are sentinel/placeholder values — they do not specify a real model
    // or provider. Return (None, None) so the caller falls back to whatever
    // endpoint is actually configured rather than routing to the OpenAI provider.
    if lowered == "default"
        || lowered == "auto"
        || lowered == "openai/default"
        || lowered == "openai/auto"
    {
        return (None, None);
    }

    if let Some((provider, model)) = trimmed.split_once('/') {
        let provider = provider.trim();
        let model = model.trim();
        let canonical = canonical_provider_id(provider);
        if !is_known_provider(&canonical) {
            return (None, Some(trimmed.to_string()));
        }
        if provider.is_empty() {
            return (None, Some(trimmed.to_string()));
        }
        if model.is_empty()
            || model.eq_ignore_ascii_case("default")
            || model.eq_ignore_ascii_case("auto")
        {
            return (Some(canonical), None);
        }
        return (Some(canonical), Some(model.to_string()));
    }

    (None, Some(trimmed.to_string()))
}

fn normalize_model_lookup_key(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect::<String>()
}

fn resolve_model_spec_alias(spec: &str, rows: &[PiRuntimeModelRow]) -> Option<String> {
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        return None;
    }

    let spec_lower = trimmed.to_ascii_lowercase();
    let (_, maybe_short) = parse_pi_model_spec(Some(trimmed.to_string()));
    let short_lower = maybe_short
        .as_deref()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty());

    if let Some(hit) = rows.iter().find(|row| {
        let model_id_lower = row.model_id.trim().to_ascii_lowercase();
        let name_lower = row.name.trim().to_ascii_lowercase();
        model_id_lower == spec_lower
            || name_lower == spec_lower
            || short_lower
                .as_deref()
                .map(|s| model_id_lower == s || name_lower == s)
                .unwrap_or(false)
    }) {
        return Some(hit.model_id.trim().to_string());
    }

    // Fuzzy fallback for abbreviated user-facing names like "GLM-4.7".
    let spec_key = normalize_model_lookup_key(trimmed);
    if spec_key.is_empty() {
        return None;
    }
    rows.iter()
        .find(|row| {
            let model_id_key = normalize_model_lookup_key(&row.model_id);
            let name_key = normalize_model_lookup_key(&row.name);
            model_id_key.starts_with(&spec_key)
                || name_key.starts_with(&spec_key)
                || model_id_key.contains(&spec_key)
                || name_key.contains(&spec_key)
        })
        .map(|row| row.model_id.trim().to_string())
}

fn sanitize_provider_key(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push('_');
        }
    }
    let out = out.trim_matches('_').to_string();
    if out.is_empty() {
        "provider".to_string()
    } else {
        out
    }
}

#[derive(Debug, Clone)]
struct CodexRuntimeConfig {
    codex_home: PathBuf,
    model_to_provider: HashMap<String, String>,
    provider_ids: HashSet<String>,
    provider_to_env_key: HashMap<String, String>,
    provider_to_api_key: HashMap<String, String>,
}

static INTERACTIVE_PROXY_CHILDREN: OnceLock<Mutex<Vec<tokio::process::Child>>> = OnceLock::new();

fn interactive_proxy_children() -> &'static Mutex<Vec<tokio::process::Child>> {
    INTERACTIVE_PROXY_CHILDREN.get_or_init(|| Mutex::new(Vec::new()))
}

fn remember_interactive_proxy_child(child: tokio::process::Child) {
    if let Ok(mut guard) = interactive_proxy_children().lock() {
        guard.push(child);
        if guard.len() > 16 {
            guard.remove(0);
        }
    }
}

const CODER_AUTH_ENV_VARS: &[&str] = &[
    "OPENAI_API_KEY",
    "OPENAI_ORG_ID",
    "OPENAI_ORGANIZATION",
    "CODEX_API_KEY",
    "CHATGPT_API_KEY",
    "OPENAI_ACCESS_TOKEN",
    "OPENAI_SESSION_KEY",
];

pub async fn build_isolated_terminal_env(
    app: &AppHandle,
    preferred_model: Option<&str>,
) -> HashMap<String, String> {
    let mut env_overrides: HashMap<String, String> = HashMap::new();
    env_overrides.insert("ARX_CODER_ISOLATED".to_string(), "1".to_string());

    // Ensure inherited shell/session credentials do not leak into Codex.
    for key in CODER_AUTH_ENV_VARS {
        env_overrides.insert((*key).to_string(), String::new());
    }

    let runtime_rows = list_pi_runtime_model_rows(app);
    let resolved_preferred_model = preferred_model
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| resolve_model_spec_alias(s, &runtime_rows).or_else(|| Some(s.to_string())));

    let mut proxy_url_overrides: HashMap<String, String> = HashMap::new();
    let mut runtime =
        ensure_codex_runtime_config(app, &HashMap::new(), resolved_preferred_model.as_deref());

    if let (Some(runtime_cfg), Some(model_spec)) =
        (runtime.as_ref(), resolved_preferred_model.as_ref())
    {
        let spec_key = model_spec.trim().to_ascii_lowercase();
        let (_, short_model) = parse_pi_model_spec(Some(model_spec.clone()));
        let short_key = short_model
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_ascii_lowercase);

        let endpoint = runtime_rows
            .iter()
            .find(|row| {
                let model_id_key = row.model_id.trim().to_ascii_lowercase();
                if model_id_key == spec_key {
                    return true;
                }
                short_key
                    .as_ref()
                    .map(|s| model_id_key == *s)
                    .unwrap_or(false)
            })
            .and_then(|row| {
                normalize_api_base_url(&row.base_url).map(|base| {
                    (
                        base,
                        row.api_key.trim().to_string(),
                        row.api_type.trim().to_ascii_lowercase(),
                    )
                })
            });

        let provider_id = runtime_cfg
            .model_to_provider
            .get(&spec_key)
            .cloned()
            .or_else(|| {
                short_key
                    .as_ref()
                    .and_then(|k| runtime_cfg.model_to_provider.get(k).cloned())
            });

        if let (Some((base_url, api_key, api_type)), Some(provider_id)) = (endpoint, provider_id) {
            let needs_proxy = if api_type == "chat" || base_url_is_likely_non_responses(&base_url) {
                true
            } else {
                probe_responses_endpoint(
                    &base_url,
                    if api_key.trim().is_empty() {
                        None
                    } else {
                        Some(api_key.as_str())
                    },
                )
                .await
                    == Some(false)
            };

            if needs_proxy {
                if let Some(script) = find_responses_proxy_script(app) {
                    if let Some((child, port)) =
                        spawn_responses_proxy(&script, &base_url, &api_key).await
                    {
                        remember_interactive_proxy_child(child);
                        proxy_url_overrides
                            .insert(provider_id, format!("http://127.0.0.1:{port}/v1"));
                    }
                }
            }
        }
    }

    // Fallback: proxy-enable any provider rows that are clearly non-Responses endpoints
    // (e.g. Z.ai coding API paths), regardless of exact model-name matching.
    for row in &runtime_rows {
        let provider_id = format!("arx_{}", sanitize_provider_key(&row.id));
        if proxy_url_overrides.contains_key(&provider_id) {
            continue;
        }
        if !runtime
            .as_ref()
            .map(|rt| rt.provider_ids.contains(&provider_id))
            .unwrap_or(false)
        {
            continue;
        }

        let Some(base_url) = normalize_api_base_url(&row.base_url) else {
            continue;
        };
        let api_key = row.api_key.trim().to_string();
        let api_type = row.api_type.trim().to_ascii_lowercase();
        let needs_proxy = if api_type == "chat" || base_url_is_likely_non_responses(&base_url) {
            true
        } else {
            probe_responses_endpoint(
                &base_url,
                if api_key.trim().is_empty() {
                    None
                } else {
                    Some(api_key.as_str())
                },
            )
            .await
                == Some(false)
        };
        if !needs_proxy {
            continue;
        }

        if let Some(script) = find_responses_proxy_script(app) {
            if let Some((child, port)) = spawn_responses_proxy(&script, &base_url, &api_key).await {
                remember_interactive_proxy_child(child);
                proxy_url_overrides.insert(provider_id, format!("http://127.0.0.1:{port}/v1"));
            }
        }
    }

    if !proxy_url_overrides.is_empty() {
        runtime = ensure_codex_runtime_config(
            app,
            &proxy_url_overrides,
            resolved_preferred_model.as_deref(),
        );
    }

    if let Some(runtime) = runtime {
        env_overrides.insert(
            "CODEX_HOME".to_string(),
            runtime.codex_home.to_string_lossy().to_string(),
        );
        for (provider_id, env_key) in &runtime.provider_to_env_key {
            if let Some(api_key) = runtime.provider_to_api_key.get(provider_id) {
                if !api_key.trim().is_empty() {
                    env_overrides.insert(env_key.clone(), api_key.clone());
                }
            }
        }
    }

    if let Some(api_key) = get_primary_model_config(app)
        .map(|m| m.api_key.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| {
            get_db_setting(app, "api_key")
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        })
    {
        env_overrides.insert("OPENAI_API_KEY".to_string(), api_key);
    }

    if let Some(base_url) = get_primary_model_config(app)
        .and_then(|m| normalize_api_base_url(&m.base_url))
        .or_else(|| get_db_setting(app, "base_url").and_then(|v| normalize_api_base_url(&v)))
    {
        env_overrides.insert("OPENAI_BASE_URL".to_string(), base_url);
    }

    env_overrides
}

fn ensure_codex_runtime_config(
    app: &AppHandle,
    proxy_url_overrides: &HashMap<String, String>,
    preferred_model: Option<&str>,
) -> Option<CodexRuntimeConfig> {
    let rows = list_pi_runtime_model_rows(app);

    let app_data_dir = app.path().app_data_dir().ok()?;
    let runtime_dir = app_data_dir.join("coder").join("runtime-codex");
    std::fs::create_dir_all(&runtime_dir).ok()?;

    let mut root = TomlMap::new();
    let mut providers = TomlMap::new();
    let mut model_to_provider: HashMap<String, String> = HashMap::new();
    let mut provider_ids: HashSet<String> = HashSet::new();
    let mut provider_to_env_key: HashMap<String, String> = HashMap::new();
    let mut provider_to_api_key: HashMap<String, String> = HashMap::new();
    let mut default_model: Option<String> = None;
    let mut default_provider: Option<String> = None;

    // Always define core providers so plain provider-prefixed model specs like
    // `openai/gpt-4.1`, `ollama/qwen2.5-coder`, or `lmstudio/<model>` work.
    let mut openai_provider = TomlMap::new();
    openai_provider.insert("name".to_string(), TomlValue::String("OpenAI".to_string()));
    openai_provider.insert(
        "wire_api".to_string(),
        TomlValue::String("responses".to_string()),
    );
    openai_provider.insert(
        "requires_openai_auth".to_string(),
        TomlValue::Boolean(false),
    );
    openai_provider.insert(
        "env_key".to_string(),
        TomlValue::String("OPENAI_API_KEY".to_string()),
    );
    providers.insert("openai".to_string(), TomlValue::Table(openai_provider));
    provider_ids.insert("openai".to_string());

    let mut ollama_provider = TomlMap::new();
    ollama_provider.insert("name".to_string(), TomlValue::String("Ollama".to_string()));
    ollama_provider.insert(
        "base_url".to_string(),
        TomlValue::String("http://localhost:11434/v1".to_string()),
    );
    ollama_provider.insert(
        "wire_api".to_string(),
        TomlValue::String("responses".to_string()),
    );
    ollama_provider.insert(
        "requires_openai_auth".to_string(),
        TomlValue::Boolean(false),
    );
    providers.insert("ollama".to_string(), TomlValue::Table(ollama_provider));
    provider_ids.insert("ollama".to_string());

    let mut lmstudio_provider = TomlMap::new();
    lmstudio_provider.insert(
        "name".to_string(),
        TomlValue::String("LM Studio".to_string()),
    );
    lmstudio_provider.insert(
        "base_url".to_string(),
        TomlValue::String("http://localhost:1234/v1".to_string()),
    );
    lmstudio_provider.insert(
        "wire_api".to_string(),
        TomlValue::String("responses".to_string()),
    );
    lmstudio_provider.insert(
        "requires_openai_auth".to_string(),
        TomlValue::Boolean(false),
    );
    providers.insert("lmstudio".to_string(), TomlValue::Table(lmstudio_provider));
    provider_ids.insert("lmstudio".to_string());

    for row in rows {
        let base_url = normalize_api_base_url(&row.base_url);
        let api_key = row.api_key.trim().to_string();
        if row.model_id.trim().is_empty() {
            continue;
        }
        let Some(base_url) = base_url else {
            continue;
        };

        let provider_key = format!("arx_{}", sanitize_provider_key(&row.id));
        let env_key = format!(
            "ARX_CODER_PROVIDER_{}_API_KEY",
            sanitize_provider_key(&row.id).to_ascii_uppercase()
        );
        let model_key = row.model_id.trim().to_ascii_lowercase();
        model_to_provider.insert(model_key, provider_key.clone());
        let (parsed_provider, parsed_model) = parse_pi_model_spec(Some(row.model_id.clone()));
        if let (Some(provider), Some(short_model)) = (parsed_provider, parsed_model) {
            let short_key = short_model.trim().to_ascii_lowercase();
            if !short_key.is_empty() {
                let provider_prefixed =
                    format!("{provider}/{}", short_model.trim()).to_ascii_lowercase();
                model_to_provider.insert(short_key, provider_key.clone());
                model_to_provider.insert(provider_prefixed, provider_key.clone());
            }
        }
        provider_to_env_key.insert(provider_key.clone(), env_key.clone());
        provider_ids.insert(provider_key.clone());
        if !api_key.is_empty() {
            provider_to_api_key.insert(provider_key.clone(), api_key.clone());
        }

        let mut provider_tbl = TomlMap::new();
        provider_tbl.insert(
            "name".to_string(),
            TomlValue::String(if row.name.trim().is_empty() {
                row.model_id.clone()
            } else {
                row.name.clone()
            }),
        );
        let effective_url = proxy_url_overrides
            .get(&provider_key)
            .cloned()
            .unwrap_or_else(|| base_url.clone());
        provider_tbl.insert("base_url".to_string(), TomlValue::String(effective_url));
        provider_tbl.insert(
            "wire_api".to_string(),
            TomlValue::String("responses".to_string()),
        );
        provider_tbl.insert(
            "requires_openai_auth".to_string(),
            TomlValue::Boolean(false),
        );
        if !api_key.is_empty() {
            provider_tbl.insert("env_key".to_string(), TomlValue::String(env_key));
        }
        providers.insert(provider_key.clone(), TomlValue::Table(provider_tbl));

        if default_model.is_none() && row.is_primary {
            default_model = Some(row.model_id.clone());
            default_provider = Some(provider_key.clone());
        }
        if default_model.is_none() && row.last_available {
            default_model = Some(row.model_id.clone());
            default_provider = Some(provider_key.clone());
        }
        if default_model.is_none() {
            default_model = Some(row.model_id.clone());
            default_provider = Some(provider_key.clone());
        }
        let _ = row.created_at;
    }

    // If a specific preferred model was supplied, use it as the config.toml default
    // so Codex loads that model by default — not just the first primary DB entry.
    let (final_model, final_provider) =
        if let Some(pref) = preferred_model.filter(|s| !s.trim().is_empty()) {
            let pref_key = pref.trim().to_ascii_lowercase();
            let pref_provider = model_to_provider.get(&pref_key).cloned().or_else(|| {
                let (_, short) = parse_pi_model_spec(Some(pref.to_string()));
                short.as_deref().and_then(|s| {
                    model_to_provider
                        .get(&s.trim().to_ascii_lowercase())
                        .cloned()
                })
            });
            (
                Some(pref.trim().to_string()),
                pref_provider.or(default_provider),
            )
        } else {
            (default_model, default_provider)
        };
    if let Some(model) = final_model {
        root.insert("model".to_string(), TomlValue::String(model));
    }
    if let Some(provider) = final_provider {
        root.insert("model_provider".to_string(), TomlValue::String(provider));
    }
    root.insert("model_providers".to_string(), TomlValue::Table(providers));
    // Keep headless behavior aligned with app-level policy.
    root.insert(
        "approval_policy".to_string(),
        TomlValue::String("never".to_string()),
    );
    root.insert(
        "sandbox_mode".to_string(),
        TomlValue::String("workspace-write".to_string()),
    );
    // Force Codex to use file-based auth storage instead of the system keyring.
    // This prevents Codex from reading ChatGPT account credentials from the keyring.
    root.insert(
        "cli_auth_credentials_store_mode".to_string(),
        TomlValue::String("file".to_string()),
    );
    // Force API key login method - this explicitly disables ChatGPT account auth.
    // When set to "api", Codex will reject ChatGPT account credentials and require an API key.
    root.insert(
        "forced_login_method".to_string(),
        TomlValue::String("api".to_string()),
    );

    // Write the local-model catalog so Codex can resolve metadata (base_instructions,
    // context_window, etc.) for open-source models without falling back to its
    // built-in OpenAI-centric list.
    let catalog_path = runtime_dir.join("local_models.json");
    let catalog_json = generate_local_models_catalog();
    std::fs::write(&catalog_path, &catalog_json).ok();
    root.insert(
        "model_catalog_json".to_string(),
        TomlValue::String(catalog_path.to_string_lossy().to_string()),
    );

    let config_path = runtime_dir.join("config.toml");
    let payload = TomlValue::Table(root);
    let data = toml::to_string_pretty(&payload).ok()?;
    std::fs::write(&config_path, data).ok()?;

    // Remove any stale auth.json in the isolated CODEX_HOME. We rely on explicit
    // environment-provided provider keys instead of forcing a global auth mode.
    // This avoids "API key auth is missing a key" for local/no-key providers.
    let auth_json_path = runtime_dir.join("auth.json");
    let _ = std::fs::remove_file(&auth_json_path);

    Some(CodexRuntimeConfig {
        codex_home: runtime_dir,
        model_to_provider,
        provider_ids,
        provider_to_env_key,
        provider_to_api_key,
    })
}

fn list_model_fallback_specs(app: &AppHandle) -> Vec<String> {
    let mut specs: Vec<String> = Vec::new();

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(db) = state.db.lock() {
            if let Ok(mut stmt) = db.prepare(
                "SELECT model_id
                 FROM model_configs
                 WHERE trim(model_id) != ''
                   AND lower(trim(api_type)) != 'chat'
                 ORDER BY is_primary DESC, last_available DESC, created_at ASC
                 LIMIT 24",
            ) {
                if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
                    for spec in rows.flatten() {
                        let trimmed = spec.trim();
                        if !trimmed.is_empty() {
                            specs.push(trimmed.to_string());
                        }
                    }
                }
            }
        }
    }

    specs
}

fn push_unique_model_spec(out: &mut Vec<String>, value: Option<String>) {
    let Some(raw) = value else {
        return;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return;
    }
    if out
        .iter()
        .any(|existing| existing.eq_ignore_ascii_case(trimmed))
    {
        return;
    }
    out.push(trimmed.to_string());
}

fn is_model_resolution_failure(output: &str) -> bool {
    let lower = output.to_ascii_lowercase();
    (lower.contains("model")
        && (lower.contains("not found")
            || lower.contains("unknown")
            || lower.contains("unsupported")
            || lower.contains("invalid")))
        || lower.contains("use --list-models")
}

fn is_retryable_provider_failure(output: &str) -> bool {
    let lower = output.to_ascii_lowercase();
    let patterns = [
        "no api key found for",
        "authentication failed for",
        "credentials may have expired",
        "network is unavailable",
        "timed out",
        "timeout",
        "rate limit",
        "429",
        "500",
        "502",
        "503",
        "service unavailable",
        "bad gateway",
        "gateway timeout",
        "connection refused",
        "econnrefused",
        "api error",
        "temporarily unavailable",
    ];
    patterns.iter().any(|p| lower.contains(p))
}

fn append_model_retry_note(stderr: &str, attempts: &[String]) -> String {
    let mut next = stderr.trim_end().to_string();
    if !next.is_empty() {
        next.push('\n');
    }
    next.push_str(&format!(
        "[provider/model fallback] attempted {} candidate(s): {}",
        attempts.len(),
        attempts.join(", ")
    ));
    next
}

fn base_url_is_likely_non_responses(base_url: &str) -> bool {
    let lower = base_url.trim().to_ascii_lowercase();
    lower.contains("api.z.ai") || lower.contains("api.minimax.io")
}

/// Locate the bundled `responses_proxy.cjs` script.
fn find_responses_proxy_script(app: &AppHandle) -> Option<PathBuf> {
    // During dev, Tauri resolves resources relative to the project root.
    // In production, they are bundled alongside the binary.
    if let Ok(p) = app.path().resource_dir() {
        let candidate = p
            .join("resources")
            .join("scripts")
            .join("coder")
            .join("responses_proxy.cjs");
        if candidate.exists() {
            return Some(candidate);
        }
        // Tauri bundles resources at a slightly different path in some layouts
        let candidate2 = p.join("scripts").join("coder").join("responses_proxy.cjs");
        if candidate2.exists() {
            return Some(candidate2);
        }
    }
    // Fallback: look next to the binary
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let c = dir
                .join("resources")
                .join("scripts")
                .join("coder")
                .join("responses_proxy.cjs");
            if c.exists() {
                return Some(c);
            }
        }
    }
    // Dev-mode fallback: resolve directly from source tree resources.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev_candidate = manifest_dir
        .join("resources")
        .join("scripts")
        .join("coder")
        .join("responses_proxy.cjs");
    if dev_candidate.exists() {
        return Some(dev_candidate);
    }
    None
}

/// Spawn a `responses_proxy.js` process that translates `/v1/responses` →
/// `/chat/completions` for the given upstream.  Returns the process handle and
/// the local port it is listening on.
///
/// The process prints `PROXY_READY port=<N>` to stdout once it is ready.
async fn spawn_responses_proxy(
    script: &std::path::Path,
    upstream_url: &str,
    api_key: &str,
) -> Option<(tokio::process::Child, u16)> {
    // Find `node` on PATH
    let node_bin = which_node()?;

    let mut cmd = tokio::process::Command::new(&node_bin);
    cmd.arg(script);
    cmd.arg("--port").arg("0"); // 0 = OS picks a free port
    cmd.arg("--upstream-url").arg(upstream_url);
    if !api_key.is_empty() {
        cmd.arg("--api-key").arg(api_key);
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().ok()?;
    let stdout = child.stdout.take()?;

    // Read lines from the proxy stdout asynchronously until we see PROXY_READY.
    // Use a 10-second timeout so we don't hang indefinitely if the script fails.
    let reader = tokio::io::BufReader::new(stdout);
    let mut lines = reader.lines();
    let port: u16 = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if let Some(rest) = line.strip_prefix("PROXY_READY port=") {
                        if let Ok(p) = rest.trim().parse::<u16>() {
                            return Some(p);
                        }
                    }
                }
                _ => return None,
            }
        }
    })
    .await
    .ok()
    .flatten()?;

    Some((child, port))
}

/// Find the `node` binary.
fn which_node() -> Option<String> {
    // Try common locations first
    for candidate in &["node", "/usr/bin/node", "/usr/local/bin/node"] {
        if let Some(found) = find_on_path(candidate) {
            return Some(found);
        }
        if std::path::Path::new(candidate).exists() {
            return Some(candidate.to_string());
        }
    }
    // Try nvm paths
    if let Ok(home) = std::env::var("HOME") {
        let nvm_node = format!("{home}/.nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_node) {
            let mut versions: Vec<_> = entries.flatten().collect();
            versions.sort_by_key(|e| e.file_name());
            if let Some(last) = versions.last() {
                let p = last.path().join("bin").join("node");
                if p.exists() {
                    return Some(p.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

async fn probe_responses_endpoint(base_url: &str, api_key: Option<&str>) -> Option<bool> {
    let normalized = normalize_api_base_url(base_url)?;
    let url = format!("{}/responses", normalized.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()?;

    let mut req = client
        .post(url)
        .header("content-type", "application/json")
        .body("{}");
    if let Some(key) = api_key.map(str::trim).filter(|k| !k.is_empty()) {
        req = req.header("authorization", format!("Bearer {key}"));
    }

    match req.send().await {
        Ok(resp) => Some(resp.status().as_u16() != 404),
        Err(_) => None,
    }
}

pub fn pi_diagnostics(
    app: &AppHandle,
    cwd: Option<String>,
    root_guard: Option<String>,
    executable_override: Option<String>,
) -> Result<PiDiagnosticsResult, String> {
    let workdir = resolve_workdir(cwd, root_guard.clone())?;
    let fallback = fallback_binary_name().to_string();
    let requested_executable = executable_override
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let bundled_hit = first_bundled_hit(app)?;
    let candidates = resolve_executable_candidates(app, executable_override)?;

    let diagnostics = candidates
        .into_iter()
        .map(|candidate| {
            let source = if requested_executable.as_deref() == Some(candidate.as_str()) {
                "override"
            } else if bundled_hit.as_deref() == Some(candidate.as_str()) {
                "bundled"
            } else if candidate == fallback {
                "path_fallback"
            } else {
                "candidate"
            };
            let path = Path::new(&candidate);
            let exists = path.exists();
            let is_file = path.is_file();
            let is_executable = is_executable_path(path);
            PiCandidateDiagnostic {
                source: source.to_string(),
                path: candidate,
                exists,
                is_file,
                is_executable,
            }
        })
        .collect::<Vec<_>>();

    Ok(PiDiagnosticsResult {
        cwd: workdir.to_string_lossy().to_string(),
        root_guard,
        requested_executable,
        fallback_binary: fallback.clone(),
        path_probe: find_on_path(&fallback),
        candidates: diagnostics,
    })
}

async fn exec_pi(
    app: &AppHandle,
    args: &[String],
    cwd: Option<String>,
    root_guard: Option<String>,
    timeout_ms: Option<u64>,
    executable_override: Option<String>,
    pre_runtime: Option<CodexRuntimeConfig>,
) -> Result<TerminalExecResult, String> {
    let workdir = resolve_workdir(cwd, root_guard)?;
    let executables = resolve_executable_candidates(app, executable_override)?;
    let bundled = bundled_candidates(app)?;
    let codex_runtime = pre_runtime
        .map(Some)
        .unwrap_or_else(|| ensure_codex_runtime_config(app, &HashMap::new(), None));
    let timeout_window = Duration::from_millis(timeout_ms.unwrap_or(300_000).clamp(1_000, 900_000));

    let mut last_error: Option<String> = None;
    let mut not_found_candidates: Vec<String> = Vec::new();
    let requested_provider = args.windows(2).find_map(|w| {
        if w[0] == "--provider" {
            Some(canonical_provider_id(&w[1]))
        } else {
            None
        }
    });
    let requested_model = args.windows(2).find_map(|w| {
        if w[0] == "--model" {
            Some(w[1].trim().to_string())
        } else {
            None
        }
    });
    let inferred_provider_from_model = requested_model
        .as_ref()
        .and_then(|m| provider_from_model_id(m));
    let requested_provider = requested_provider.or(inferred_provider_from_model);
    let requested_model_full = match (requested_provider.as_ref(), requested_model.as_ref()) {
        (Some(provider), Some(model)) if !model.is_empty() => Some(format!("{provider}/{model}")),
        _ => None,
    };
    for executable in executables {
        let mut cmd = Command::new(&executable);
        cmd.args(args);
        cmd.current_dir(&workdir);
        // Isolate Codex from IDE plugin credentials by setting CODEX_HOME and ARX_CODER_ISOLATED.
        // This prevents Codex from reading/writing to ~/.codex or using ChatGPT account auth.
        cmd.env("ARX_CODER_ISOLATED", "1");
        // Clear all OpenAI/ChatGPT related environment variables to prevent IDE plugin leakage.
        // We'll set OPENAI_API_KEY explicitly below only if we have a configured API key.
        cmd.env_remove("OPENAI_API_KEY");
        cmd.env_remove("OPENAI_ORG_ID");
        cmd.env_remove("OPENAI_ORGANIZATION");
        cmd.env_remove("CODEX_API_KEY");
        cmd.env_remove("CHATGPT_API_KEY");
        // Clear any OAuth-related env vars that IDE plugins might set
        cmd.env_remove("OPENAI_ACCESS_TOKEN");
        cmd.env_remove("OPENAI_SESSION_KEY");
        if let Some(runtime) = codex_runtime.as_ref() {
            cmd.env("CODEX_HOME", &runtime.codex_home);
            for (provider_id, env_key) in &runtime.provider_to_env_key {
                if let Some(api_key) = runtime.provider_to_api_key.get(provider_id) {
                    if !api_key.trim().is_empty() {
                        cmd.env(env_key, api_key);
                    }
                }
            }
        }
        let model_cfg = requested_model_full
            .as_ref()
            .and_then(|m| get_model_config_by_model_id(app, m))
            .or_else(|| {
                requested_model
                    .as_ref()
                    .and_then(|m| get_model_config_by_model_id(app, m))
            });
        let inferred_provider_from_cfg = model_cfg
            .as_ref()
            .and_then(|m| infer_provider_for_config(&m.model_id, &m.base_url));
        let provider_cfg = requested_provider
            .as_ref()
            .and_then(|provider| get_provider_model_config(app, provider));
        let primary = get_primary_model_config(app);
        let primary_provider = primary
            .as_ref()
            .and_then(|m| provider_from_model_id(&m.model_id));
        if let Some(api_key) = model_cfg
            .as_ref()
            .map(|m| m.api_key.trim().to_string())
            .filter(|v| !v.is_empty())
            .or_else(|| {
                provider_cfg
                    .as_ref()
                    .map(|m| m.api_key.trim().to_string())
                    .filter(|v| !v.is_empty())
            })
            .or_else(|| {
                primary
                    .as_ref()
                    .map(|m| m.api_key.trim().to_string())
                    .filter(|v| !v.is_empty())
            })
            .or_else(|| {
                get_db_setting(app, "api_key")
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty())
            })
        {
            cmd.env("OPENAI_API_KEY", api_key);
        }
        if let Some(base_url) = model_cfg
            .as_ref()
            .and_then(|m| normalize_api_base_url(&m.base_url))
            .or_else(|| {
                provider_cfg
                    .as_ref()
                    .and_then(|m| normalize_api_base_url(&m.base_url))
            })
            .or_else(|| {
                primary
                    .as_ref()
                    .and_then(|m| normalize_api_base_url(&m.base_url))
            })
            .or_else(|| get_db_setting(app, "base_url").and_then(|v| normalize_api_base_url(&v)))
        {
            cmd.env("OPENAI_BASE_URL", base_url);
        }
        let effective_provider = requested_provider
            .as_ref()
            .cloned()
            .or(inferred_provider_from_cfg.clone())
            .or_else(|| {
                model_cfg
                    .as_ref()
                    .and_then(|m| provider_from_model_id(&m.model_id))
            })
            .or(primary_provider.clone());
        let effective_cfg = model_cfg
            .as_ref()
            .map(|p| (p.api_key.trim(), normalize_api_base_url(&p.base_url)))
            .or_else(|| {
                provider_cfg
                    .as_ref()
                    .map(|p| (p.api_key.trim(), normalize_api_base_url(&p.base_url)))
            })
            .or_else(|| {
                primary
                    .as_ref()
                    .map(|p| (p.api_key.trim(), normalize_api_base_url(&p.base_url)))
            });
        if let Some((api_key, base_url)) = effective_cfg {
            if !api_key.is_empty() {
                match effective_provider.as_deref() {
                    Some("minimax") => {
                        cmd.env("MINIMAX_API_KEY", api_key);
                    }
                    Some("minimax-cn") => {
                        cmd.env("MINIMAX_CN_API_KEY", api_key);
                    }
                    Some("mistral") => {
                        cmd.env("MISTRAL_API_KEY", api_key);
                    }
                    Some("kimi-coding") => {
                        cmd.env("KIMI_API_KEY", api_key);
                    }
                    Some("zai") => {
                        cmd.env("ZAI_API_KEY", api_key);
                    }
                    Some("openrouter") => {
                        cmd.env("OPENROUTER_API_KEY", api_key);
                    }
                    Some("vercel-ai-gateway") => {
                        cmd.env("AI_GATEWAY_API_KEY", api_key);
                    }
                    Some("azure-openai-responses") => {
                        cmd.env("AZURE_OPENAI_API_KEY", api_key);
                    }
                    Some("google") => {
                        cmd.env("GEMINI_API_KEY", api_key);
                    }
                    _ => {}
                }
            }
            if let Some(url) = base_url {
                match effective_provider.as_deref() {
                    Some("minimax") => {
                        cmd.env("MINIMAX_BASE_URL", url);
                    }
                    Some("mistral") => {
                        cmd.env("MISTRAL_BASE_URL", url);
                    }
                    Some("kimi") => {
                        cmd.env("KIMI_BASE_URL", url);
                    }
                    Some("zai") => {
                        cmd.env("ZAI_BASE_URL", url);
                    }
                    _ => {}
                }
            }
        }
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let start = Instant::now();
        match timeout(timeout_window, cmd.output()).await {
            Err(_) => return Err("Coder process timed out".to_string()),
            Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => {
                not_found_candidates.push(executable.clone());
                last_error = Some(format!(
                    "Failed to run coder executable '{}': {}",
                    executable, e
                ));
                continue;
            }
            Ok(Err(e)) => {
                return Err(format!(
                    "Failed to run coder executable '{}': {}",
                    executable, e
                ));
            }
            Ok(Ok(output)) => {
                return Ok(TerminalExecResult {
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    exit_code: output.status.code().unwrap_or(-1),
                    duration_ms: start.elapsed().as_millis(),
                    cwd: workdir.to_string_lossy().to_string(),
                });
            }
        }
    }

    if !not_found_candidates.is_empty() {
        let bundled_notes = if bundled.is_empty() {
            "Bundled candidates: (none)".to_string()
        } else {
            let notes = bundled
                .iter()
                .map(|p| {
                    let exists = p.exists();
                    let executable = is_executable_path(p);
                    format!(
                        "{} [exists={}, executable={}]",
                        p.to_string_lossy(),
                        exists,
                        executable
                    )
                })
                .collect::<Vec<_>>()
                .join("; ");
            format!("Bundled candidates: {}", notes)
        };
        return Err(format!(
            "coder executable not found. Tried: {}. {}. Configure Settings > Coder > Executable or bundle platform binary resources.",
            not_found_candidates.join(", "),
            bundled_notes
        ));
    }

    Err(last_error.unwrap_or_else(|| "Failed to resolve coder executable".to_string()))
}

pub async fn run_pi_prompt(
    app: &AppHandle,
    prompt: String,
    cwd: Option<String>,
    root_guard: Option<String>,
    timeout_ms: Option<u64>,
    executable_override: Option<String>,
    model: Option<String>,
) -> Result<TerminalExecResult, String> {
    let runtime_rows = list_pi_runtime_model_rows(app);

    // Determine the preferred model early so config.toml is written with the correct
    // default from the start.  Priority: explicit model arg > coder_model setting >
    // primary_model.  This ensures Codex never falls back to gpt-5.2-codex or
    // whatever happens to be first-primary in model_configs.
    let coder_model_setting = get_db_setting(app, "coder_model");
    let primary_model = get_primary_model_config(app).map(|m| m.model_id);
    let initial_preferred_raw: Option<String> = model
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .or_else(|| coder_model_setting.clone().filter(|s| !s.trim().is_empty()))
        .or_else(|| primary_model.clone().filter(|s| !s.trim().is_empty()));
    let initial_preferred = initial_preferred_raw
        .as_deref()
        .and_then(|s| resolve_model_spec_alias(s, &runtime_rows))
        .or(initial_preferred_raw);
    // Initial config write — uses preferred model as default in config.toml.
    let runtime = ensure_codex_runtime_config(app, &HashMap::new(), initial_preferred.as_deref());
    let mut model_specs: Vec<String> = Vec::new();
    push_unique_model_spec(&mut model_specs, model.clone());
    push_unique_model_spec(&mut model_specs, coder_model_setting);
    push_unique_model_spec(&mut model_specs, primary_model);
    for spec in list_model_fallback_specs(app) {
        push_unique_model_spec(&mut model_specs, Some(spec));
    }
    push_unique_model_spec(&mut model_specs, get_db_setting(app, "model"));
    if model_specs.len() > 8 {
        model_specs.truncate(8);
    }
    let mut canonical_specs: Vec<String> = Vec::new();
    for spec in model_specs {
        let resolved = resolve_model_spec_alias(&spec, &runtime_rows).unwrap_or(spec);
        push_unique_model_spec(&mut canonical_specs, Some(resolved));
    }
    model_specs = canonical_specs;
    let settings_base_url_provider = get_db_setting(app, "base_url")
        .as_deref()
        .and_then(infer_provider_from_base_url)
        .map(|p| canonical_provider_id(&p));
    let mut model_base_by_key: HashMap<String, (String, String, String)> = HashMap::new();
    for row in &runtime_rows {
        let base = row.base_url.trim().to_string();
        if base.is_empty() {
            continue;
        }
        let api_type = row.api_type.trim().to_ascii_lowercase();
        let key = row.model_id.trim().to_ascii_lowercase();
        if !key.is_empty() {
            model_base_by_key.entry(key).or_insert_with(|| {
                (
                    base.clone(),
                    row.api_key.trim().to_string(),
                    api_type.clone(),
                )
            });
        }
        let (_, short_model) = parse_pi_model_spec(Some(row.model_id.clone()));
        if let Some(short) = short_model {
            let short_key = short.trim().to_ascii_lowercase();
            if !short_key.is_empty() {
                model_base_by_key.entry(short_key).or_insert_with(|| {
                    (
                        base.clone(),
                        row.api_key.trim().to_string(),
                        api_type.clone(),
                    )
                });
            }
        }
    }

    // Pre-locate the proxy script once; None if Node.js runtime is unavailable.
    let proxy_script = find_responses_proxy_script(app);

    let mut attempted_labels: Vec<String> = Vec::new();
    let mut skipped_notes: Vec<String> = Vec::new();
    let mut responses_probe_cache: HashMap<String, Option<bool>> = HashMap::new();
    let mut attempted_exec_count: usize = 0;
    for spec in &model_specs {
        let (parsed_provider, model_id) = parse_pi_model_spec(Some(spec.clone()));
        let resolved_model = model_id.clone().unwrap_or_else(|| spec.trim().to_string());
        if resolved_model.is_empty() {
            continue;
        }
        attempted_labels.push(resolved_model.clone());
        let spec_key = spec.trim().to_ascii_lowercase();
        let model_key_lower = resolved_model.trim().to_ascii_lowercase();
        let endpoint = model_base_by_key
            .get(&spec_key)
            .or_else(|| model_base_by_key.get(&model_key_lower))
            .cloned();

        // Compute provider_id first — needed to build proxy URL overrides for config.toml.
        let provider_id = runtime.as_ref().and_then(|rt| {
            let full_key = spec.trim().to_ascii_lowercase();
            if !full_key.is_empty() {
                if let Some(provider) = rt.model_to_provider.get(&full_key) {
                    return Some(provider.clone());
                }
            }
            let mk = resolved_model.trim().to_ascii_lowercase();
            if let Some(provider) = rt.model_to_provider.get(&mk) {
                return Some(provider.clone());
            }
            parsed_provider
                .as_ref()
                .map(|p| canonical_provider_id(p))
                .filter(|p| rt.provider_ids.contains(p))
                .or_else(|| {
                    settings_base_url_provider
                        .as_ref()
                        .filter(|p| rt.provider_ids.contains(*p))
                        .cloned()
                })
        });

        // Determine whether a responses-proxy is needed and, if so, spawn one.
        // The child is kept alive for the duration of `exec_pi` (kill_on_drop
        // cleans it up afterwards).  When a proxy is spawned we record its URL
        // as an override keyed by provider_id so `ensure_codex_runtime_config`
        // can write the correct base_url directly into config.toml.
        let mut proxy_child: Option<tokio::process::Child> = None;
        let mut proxy_url_overrides: HashMap<String, String> = HashMap::new();

        if let Some((ref base_url, ref api_key, ref api_type)) = endpoint {
            let cache_key = normalize_api_base_url(base_url).unwrap_or(base_url.clone());

            // Decide if we need the proxy:
            //  • api_type == "chat"  → explicitly chat-completions-only
            //  • probe returns 404   → /responses not supported
            //  • known non-responses host → skip the network round-trip
            let needs_proxy = if api_type == "chat" {
                true
            } else if base_url_is_likely_non_responses(&cache_key) {
                true
            } else {
                let probe_result = if let Some(cached) = responses_probe_cache.get(&cache_key) {
                    *cached
                } else {
                    let checked = probe_responses_endpoint(
                        &cache_key,
                        if api_key.trim().is_empty() {
                            None
                        } else {
                            Some(api_key.as_str())
                        },
                    )
                    .await;
                    responses_probe_cache.insert(cache_key.clone(), checked);
                    checked
                };
                probe_result == Some(false)
            };

            if needs_proxy {
                if let Some(ref script) = proxy_script {
                    match spawn_responses_proxy(script, base_url, api_key).await {
                        Some((child, port)) => {
                            proxy_child = Some(child);
                            let purl = format!("http://127.0.0.1:{port}/v1");
                            // Record the proxy URL keyed by provider_id so config.toml
                            // can be rewritten with the correct base_url before exec_pi.
                            if let Some(ref pid) = provider_id {
                                proxy_url_overrides.insert(pid.clone(), purl);
                            }
                        }
                        None => {
                            skipped_notes.push(format!(
                                "[skip] {resolved_model}: failed to spawn responses proxy for {cache_key}"
                            ));
                            continue;
                        }
                    }
                } else {
                    skipped_notes.push(format!(
                        "[skip] {resolved_model}: endpoint needs a responses proxy but Node.js is unavailable"
                    ));
                    continue;
                }
            }
        }

        // (Re-)write config.toml with proxy base_url overrides so Codex routes to
        // the local proxy instead of the remote endpoint that lacks /responses.
        // Also pass the current resolved_model so config.toml's `model` key stays
        // consistent with the --model arg we are about to pass.
        let spec_runtime = if proxy_url_overrides.is_empty() {
            runtime.clone()
        } else {
            ensure_codex_runtime_config(app, &proxy_url_overrides, Some(resolved_model.as_str()))
        };

        let mut args = vec![
            "exec".to_string(),
            "--model".to_string(),
            resolved_model.clone(),
        ];
        if let Some(ref pid) = provider_id {
            args.push("-c".to_string());
            args.push(format!("model_provider=\"{pid}\""));
            // NOTE: base_url is now written directly into config.toml via
            // ensure_codex_runtime_config() above — the `-c` nested-key override
            // approach doesn't work in Codex CLI.
        }
        args.push(prompt.clone());
        attempted_exec_count += 1;
        let result = exec_pi(
            app,
            &args,
            cwd.clone(),
            root_guard.clone(),
            timeout_ms,
            executable_override.clone(),
            spec_runtime,
        )
        .await;
        // Drop the proxy child now that exec_pi is done (kill_on_drop handles it).
        drop(proxy_child);
        let result = result?;
        if result.exit_code == 0 {
            return Ok(result);
        }
        if !is_model_resolution_failure(&result.stderr)
            && !is_retryable_provider_failure(&result.stderr)
        {
            return Ok(result);
        }
    }

    if attempted_exec_count == 0 && !skipped_notes.is_empty() {
        let cwd_value = resolve_workdir(cwd.clone(), root_guard.clone())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        return Ok(TerminalExecResult {
            stdout: String::new(),
            stderr: format!(
                "No configured coder model endpoints are Responses API compatible.\n{}\nUse a provider/base URL that supports POST /responses.",
                skipped_notes.join("\n")
            ),
            exit_code: 1,
            duration_ms: 0,
            cwd: cwd_value,
        });
    }

    attempted_labels.push("auto".to_string());
    let mut auto_args = vec!["exec".to_string()];
    if let Some(ref m) = initial_preferred {
        auto_args.push("--model".to_string());
        auto_args.push(m.clone());
    }
    auto_args.push(prompt);
    let auto_result = exec_pi(
        app,
        &auto_args,
        cwd,
        root_guard,
        timeout_ms,
        executable_override,
        runtime,
    )
    .await?;
    if auto_result.exit_code == 0
        || (!is_model_resolution_failure(&auto_result.stderr)
            && !is_retryable_provider_failure(&auto_result.stderr))
    {
        return Ok(auto_result);
    }
    let mut final_result = auto_result;
    final_result.stderr = append_model_retry_note(&final_result.stderr, &attempted_labels);
    Ok(final_result)
}

pub async fn run_pi_version(
    app: &AppHandle,
    cwd: Option<String>,
    root_guard: Option<String>,
    timeout_ms: Option<u64>,
    executable_override: Option<String>,
) -> Result<TerminalExecResult, String> {
    exec_pi(
        app,
        &[String::from("--version")],
        cwd,
        root_guard,
        timeout_ms,
        executable_override,
        None,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choose_executable_prefers_bundled_when_override_is_default_token() {
        let chosen = choose_executable(Some("codex"), Some("/bundle/codex"), "codex");
        assert_eq!(chosen, "/bundle/codex");
    }

    #[test]
    fn choose_executable_prefers_custom_override_when_non_default() {
        let chosen = choose_executable(Some("/custom/codex"), Some("/bundle/codex"), "codex");
        assert_eq!(chosen, "/custom/codex");
    }

    #[test]
    fn choose_executable_falls_back_to_override_when_bundled_missing() {
        let chosen = choose_executable(Some("codex"), None, "codex");
        assert_eq!(chosen, "codex");
    }

    #[test]
    fn choose_executable_candidates_include_fallback_after_bad_override() {
        let override_trimmed = "oi".to_string();
        let fallback = "codex".to_string();
        let primary = choose_executable(Some(&override_trimmed), None, &fallback);

        let mut candidates: Vec<String> = vec![primary];
        if !candidates.iter().any(|c| c == &override_trimmed) {
            candidates.push(override_trimmed.clone());
        }
        if !candidates.iter().any(|c| c == &fallback) {
            candidates.push(fallback.clone());
        }

        assert_eq!(candidates, vec!["oi".to_string(), "codex".to_string()]);
    }

    #[test]
    fn find_on_path_in_env_returns_none_when_missing() {
        assert_eq!(find_on_path_in_env("codex", "/definitely/not/real"), None);
    }

    #[cfg(unix)]
    #[test]
    fn find_on_path_in_env_finds_temp_executable() {
        use std::os::unix::fs::PermissionsExt;
        let tmp_root = std::env::temp_dir().join(format!("arx-coder-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp_root).unwrap();
        let bin = tmp_root.join("pi-test-binary");
        std::fs::write(&bin, "#!/bin/sh\necho ok\n").unwrap();
        let mut perms = std::fs::metadata(&bin).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&bin, perms).unwrap();

        let hit = find_on_path_in_env("pi-test-binary", &tmp_root.to_string_lossy());
        assert_eq!(hit, Some(bin.to_string_lossy().to_string()));

        let _ = std::fs::remove_file(bin);
        let _ = std::fs::remove_dir(tmp_root);
    }

    #[test]
    fn parse_pi_model_spec_ignores_default_aliases() {
        assert_eq!(
            parse_pi_model_spec(Some("default".to_string())),
            (Some("openai".to_string()), None)
        );
        assert_eq!(
            parse_pi_model_spec(Some("openai/default".to_string())),
            (Some("openai".to_string()), None)
        );
    }

    #[test]
    fn parse_pi_model_spec_extracts_known_provider() {
        assert_eq!(
            parse_pi_model_spec(Some("openai/gpt-4o-mini".to_string())),
            (Some("openai".to_string()), Some("gpt-4o-mini".to_string()))
        );
    }

    #[test]
    fn parse_pi_model_spec_keeps_non_provider_slash_ids_as_model() {
        assert_eq!(
            parse_pi_model_spec(Some("zai-org/glm-4.6v-flash".to_string())),
            (None, Some("zai-org/glm-4.6v-flash".to_string()))
        );
    }

    #[test]
    fn is_model_resolution_failure_detects_model_not_found() {
        assert!(is_model_resolution_failure(
            "Model \"openai/default\" not found. Use --list-models to see available models."
        ));
        assert!(!is_model_resolution_failure(
            "No API key found for minimax."
        ));
    }
}
