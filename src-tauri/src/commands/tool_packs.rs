use crate::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const DEFAULT_PACK_REPO: &str = "Arxellinc/tools";
const DEFAULT_PACK_REF: &str = "main";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPackRecord {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
    pub install_path: String,
    pub executable_path: Option<String>,
    pub source_repo: String,
    pub source_ref: String,
    pub installed_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPackIndexEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub latest: String,
    pub manifest_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolPackIndexDoc {
    #[serde(default)]
    packs: Vec<ToolPackIndexEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPackInstallRequest {
    pub id: String,
    pub repo: Option<String>,
    #[serde(rename = "ref")]
    pub git_ref: Option<String>,
    pub manifest_path: Option<String>,
    pub enable: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPackEnableRequest {
    pub id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPackRemoveRequest {
    pub id: String,
    pub remove_files: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolPackManifest {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    assets: HashMap<String, ToolPackAsset>,
    #[serde(default)]
    platforms: HashMap<String, ToolPackAsset>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolPackAsset {
    url: Option<String>,
    archive_path: Option<String>,
    sha256: Option<String>,
    executable: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn platform_key() -> String {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86_64"
    };
    format!("{os}-{arch}")
}

fn packs_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .join("tool-packs");
    std::fs::create_dir_all(&root).map_err(|e| format!("failed to create tool packs dir: {e}"))?;
    Ok(root)
}

fn normalize_ref(input: Option<String>) -> String {
    input
        .unwrap_or_else(|| DEFAULT_PACK_REF.to_string())
        .trim()
        .to_string()
}

fn normalize_repo(input: Option<String>) -> String {
    input
        .unwrap_or_else(|| DEFAULT_PACK_REPO.to_string())
        .trim()
        .to_string()
}

fn is_http_url(value: &str) -> bool {
    let v = value.to_ascii_lowercase();
    v.starts_with("http://") || v.starts_with("https://")
}

fn join_url(base: &str, rel: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        rel.trim_start_matches('/')
    )
}

fn ensure_safe_rel_path(path: &Path) -> Result<(), String> {
    if path.is_absolute() {
        return Err("absolute paths are not allowed in pack archives".to_string());
    }
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("parent directory segments are not allowed in pack archives".to_string());
    }
    Ok(())
}

fn extract_zip_bytes(bytes: &[u8], dest_dir: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes.to_vec()))
        .map_err(|e| format!("invalid pack archive zip: {e}"))?;
    for idx in 0..archive.len() {
        let mut entry = archive
            .by_index(idx)
            .map_err(|e| format!("failed reading archive entry {idx}: {e}"))?;
        let Some(name) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        ensure_safe_rel_path(&name)?;
        let out = dest_dir.join(name);
        if entry.name().ends_with('/') {
            std::fs::create_dir_all(&out)
                .map_err(|e| format!("failed to create dir {}: {e}", out.display()))?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create parent {}: {e}", parent.display()))?;
        }
        let mut file = std::fs::File::create(&out)
            .map_err(|e| format!("failed to create file {}: {e}", out.display()))?;
        std::io::copy(&mut entry, &mut file)
            .map_err(|e| format!("failed to extract {}: {e}", out.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = entry.unix_mode() {
                let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode));
            }
        }
    }
    Ok(())
}

fn pick_asset(manifest: &ToolPackManifest) -> Result<ToolPackAsset, String> {
    let key = platform_key();
    manifest
        .assets
        .get(&key)
        .or_else(|| manifest.platforms.get(&key))
        .or_else(|| manifest.assets.get("any"))
        .or_else(|| manifest.platforms.get("any"))
        .cloned()
        .ok_or_else(|| format!("manifest has no asset for platform '{key}'"))
}

fn resolve_enabled_pack_executable_from_db(
    app: &AppHandle,
    pack_id: &str,
) -> Result<Option<String>, String> {
    let Some(state) = app.try_state::<AppState>() else {
        return Ok(None);
    };
    let db = state
        .db
        .lock()
        .map_err(|_| "failed to lock db for tool pack lookup".to_string())?;
    let row = db
        .query_row(
            "SELECT executable_path FROM tool_packs WHERE id = ?1 AND enabled = 1",
            rusqlite::params![pack_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten();
    Ok(row.filter(|p| Path::new(p).is_file()))
}

pub fn resolve_enabled_pack_executable(app: &AppHandle, pack_id: &str) -> Option<String> {
    resolve_enabled_pack_executable_from_db(app, pack_id)
        .ok()
        .flatten()
}

#[tauri::command]
pub fn cmd_tool_packs_list(state: State<'_, AppState>) -> Result<Vec<ToolPackRecord>, String> {
    let db = state
        .db
        .lock()
        .map_err(|_| "failed to lock db".to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT id, name, version, description, enabled, install_path, executable_path, source_repo, source_ref, installed_at
             FROM tool_packs
             ORDER BY installed_at DESC",
        )
        .map_err(|e| format!("failed to prepare tool pack query: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ToolPackRecord {
                id: r.get(0)?,
                name: r.get(1)?,
                version: r.get(2)?,
                description: r.get(3)?,
                enabled: r.get::<_, i64>(4)? != 0,
                install_path: r.get(5)?,
                executable_path: r.get(6)?,
                source_repo: r.get(7)?,
                source_ref: r.get(8)?,
                installed_at: r.get(9)?,
            })
        })
        .map_err(|e| format!("failed to query tool packs: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("failed to read tool pack row: {e}"))?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn cmd_tool_packs_index(
    app: AppHandle,
    repo: Option<String>,
    git_ref: Option<String>,
) -> Result<Vec<ToolPackIndexEntry>, String> {
    let repo = normalize_repo(repo);
    let git_ref = normalize_ref(git_ref);
    let url = format!(
        "https://raw.githubusercontent.com/{}/{}/index.json",
        repo, git_ref
    );
    let client = app
        .try_state::<AppState>()
        .ok_or_else(|| "app state unavailable".to_string())?
        .http_client
        .clone();
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("failed to fetch pack index: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("pack index request failed: HTTP {}", res.status()));
    }
    let text = res
        .text()
        .await
        .map_err(|e| format!("failed reading pack index body: {e}"))?;
    let doc: ToolPackIndexDoc =
        serde_json::from_str(&text).map_err(|e| format!("invalid pack index JSON: {e}"))?;
    Ok(doc.packs)
}

#[tauri::command]
pub async fn cmd_tool_pack_install(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ToolPackInstallRequest,
) -> Result<ToolPackRecord, String> {
    let pack_id = request.id.trim().to_string();
    if pack_id.is_empty() {
        return Err("pack id is required".to_string());
    }
    let repo = normalize_repo(request.repo);
    let git_ref = normalize_ref(request.git_ref);
    let manifest_rel = request
        .manifest_path
        .clone()
        .unwrap_or_else(|| format!("{pack_id}/manifest.json"));
    let base_raw = format!("https://raw.githubusercontent.com/{}/{}/", repo, git_ref);
    let manifest_url = if is_http_url(&manifest_rel) {
        manifest_rel.clone()
    } else {
        join_url(&base_raw, &manifest_rel)
    };

    let client = state.http_client.clone();
    let manifest_resp = client
        .get(manifest_url.clone())
        .send()
        .await
        .map_err(|e| format!("failed to fetch manifest: {e}"))?;
    if !manifest_resp.status().is_success() {
        return Err(format!(
            "manifest request failed ({}): HTTP {}",
            manifest_url,
            manifest_resp.status()
        ));
    }
    let manifest_text = manifest_resp
        .text()
        .await
        .map_err(|e| format!("failed reading manifest response: {e}"))?;
    let manifest: ToolPackManifest =
        serde_json::from_str(&manifest_text).map_err(|e| format!("invalid manifest JSON: {e}"))?;
    if manifest.id.trim() != pack_id {
        return Err(format!(
            "manifest id '{}' does not match requested id '{}'",
            manifest.id, pack_id
        ));
    }

    let asset = pick_asset(&manifest)?;
    let manifest_dir = manifest_url
        .rsplit_once('/')
        .map(|(d, _)| d.to_string())
        .unwrap_or_else(|| manifest_url.clone());
    let archive_url = asset
        .url
        .clone()
        .or(asset.archive_path.clone())
        .ok_or_else(|| "manifest asset missing url/archivePath".to_string())
        .map(|v| {
            if is_http_url(&v) {
                v
            } else {
                join_url(&manifest_dir, &v)
            }
        })?;

    let archive_resp = client
        .get(archive_url.clone())
        .send()
        .await
        .map_err(|e| format!("failed to download pack archive: {e}"))?;
    if !archive_resp.status().is_success() {
        return Err(format!(
            "pack archive request failed ({}): HTTP {}",
            archive_url,
            archive_resp.status()
        ));
    }
    let archive_bytes = archive_resp
        .bytes()
        .await
        .map_err(|e| format!("failed reading pack archive: {e}"))?;

    if let Some(expected) = asset.sha256.as_ref().map(|s| s.trim().to_ascii_lowercase()) {
        let mut hasher = Sha256::new();
        hasher.update(&archive_bytes);
        let got = format!("{:x}", hasher.finalize());
        if got != expected {
            return Err(format!(
                "pack archive checksum mismatch: expected {expected}, got {got}"
            ));
        }
    }

    let root = packs_root(&app)?;
    let install_dir = root.join(&pack_id).join(&manifest.version);
    let tmp_dir = root.join(format!(".tmp-{}-{}", pack_id, now_ms()));
    if tmp_dir.exists() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("failed to create temp dir: {e}"))?;
    let unpack_dir = tmp_dir.join("unpack");
    std::fs::create_dir_all(&unpack_dir)
        .map_err(|e| format!("failed to create unpack dir: {e}"))?;
    extract_zip_bytes(&archive_bytes, &unpack_dir)?;

    if install_dir.exists() {
        std::fs::remove_dir_all(&install_dir)
            .map_err(|e| format!("failed replacing existing install dir: {e}"))?;
    }
    if let Some(parent) = install_dir.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create install parent dir: {e}"))?;
    }
    std::fs::rename(&unpack_dir, &install_dir)
        .map_err(|e| format!("failed finalizing install directory: {e}"))?;
    let _ = std::fs::remove_dir_all(&tmp_dir);

    let executable_path = asset
        .executable
        .as_ref()
        .map(|rel| install_dir.join(rel))
        .filter(|p| p.is_file());

    #[cfg(unix)]
    if let Some(path) = executable_path.as_ref() {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perm = meta.permissions();
            perm.set_mode(0o755);
            let _ = std::fs::set_permissions(path, perm);
        }
    }

    let enabled = request.enable.unwrap_or(true);
    let rec = ToolPackRecord {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        description: manifest.description.clone(),
        enabled,
        install_path: install_dir.to_string_lossy().to_string(),
        executable_path: executable_path.map(|p| p.to_string_lossy().to_string()),
        source_repo: repo,
        source_ref: git_ref,
        installed_at: now_ms(),
    };

    let db = state
        .db
        .lock()
        .map_err(|_| "failed to lock db".to_string())?;
    db.execute(
        "INSERT INTO tool_packs (id, name, version, description, enabled, install_path, executable_path, manifest_json, source_repo, source_ref, installed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            version=excluded.version,
            description=excluded.description,
            enabled=excluded.enabled,
            install_path=excluded.install_path,
            executable_path=excluded.executable_path,
            manifest_json=excluded.manifest_json,
            source_repo=excluded.source_repo,
            source_ref=excluded.source_ref,
            installed_at=excluded.installed_at",
        rusqlite::params![
            rec.id,
            rec.name,
            rec.version,
            rec.description,
            if rec.enabled { 1 } else { 0 },
            rec.install_path,
            rec.executable_path,
            manifest_text,
            rec.source_repo,
            rec.source_ref,
            rec.installed_at,
        ],
    )
    .map_err(|e| format!("failed to save tool pack record: {e}"))?;
    Ok(rec)
}

#[tauri::command]
pub fn cmd_tool_pack_set_enabled(
    state: State<'_, AppState>,
    request: ToolPackEnableRequest,
) -> Result<(), String> {
    let id = request.id.trim();
    if id.is_empty() {
        return Err("pack id is required".to_string());
    }
    let db = state
        .db
        .lock()
        .map_err(|_| "failed to lock db".to_string())?;
    db.execute(
        "UPDATE tool_packs SET enabled = ?1 WHERE id = ?2",
        rusqlite::params![if request.enabled { 1 } else { 0 }, id],
    )
    .map_err(|e| format!("failed to update pack state: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn cmd_tool_pack_remove(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ToolPackRemoveRequest,
) -> Result<(), String> {
    let id = request.id.trim().to_string();
    if id.is_empty() {
        return Err("pack id is required".to_string());
    }
    let db = state
        .db
        .lock()
        .map_err(|_| "failed to lock db".to_string())?;
    let install_path = db
        .query_row(
            "SELECT install_path FROM tool_packs WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get::<_, String>(0),
        )
        .ok();
    db.execute(
        "DELETE FROM tool_packs WHERE id = ?1",
        rusqlite::params![request.id],
    )
    .map_err(|e| format!("failed to remove tool pack row: {e}"))?;
    drop(db);

    if request.remove_files.unwrap_or(true) {
        if let Some(path) = install_path {
            let p = PathBuf::from(path);
            let _ = std::fs::remove_dir_all(&p);
            if let Ok(root) = packs_root(&app) {
                let top = root.join(request.id);
                let _ = std::fs::remove_dir_all(top);
            }
        }
    }
    Ok(())
}
