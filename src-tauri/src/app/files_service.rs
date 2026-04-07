use crate::contracts::{
    FilesCreateDirectoryResponse, FilesDeletePathResponse, FilesListDirectoryEntry,
    FilesListDirectoryResponse, FilesReadFileResponse, FilesWriteFileResponse,
};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone)]
pub struct FilesService {
    root_path: PathBuf,
}

impl FilesService {
    pub fn new() -> Self {
        Self {
            root_path: default_workspace_root(),
        }
    }

    pub fn root_path(&self) -> &Path {
        self.root_path.as_path()
    }

    pub fn list_directory(
        &self,
        path: Option<&str>,
        correlation_id: String,
    ) -> Result<FilesListDirectoryResponse, String> {
        let target = resolve_existing_target_path(self.root_path.as_path(), path)?;
        let entries = list_directory_entries(target.as_path())?;
        Ok(FilesListDirectoryResponse {
            correlation_id,
            root_path: path_to_string(self.root_path.as_path()),
            listed_path: path_to_string(target.as_path()),
            entries,
        })
    }

    pub fn read_file(
        &self,
        path: &str,
        correlation_id: String,
    ) -> Result<FilesReadFileResponse, String> {
        const MAX_EDIT_BYTES: u64 = 1_000_000;
        let target = resolve_existing_target_path(self.root_path.as_path(), Some(path))?;
        let metadata = std::fs::metadata(target.as_path())
            .map_err(|e| format!("failed reading file metadata: {e}"))?;
        if !metadata.is_file() {
            return Err("requested path is not a file".to_string());
        }
        let size_bytes = metadata.len();
        if size_bytes > MAX_EDIT_BYTES {
            return Ok(FilesReadFileResponse {
                correlation_id,
                path: path_to_string(target.as_path()),
                content: String::new(),
                size_bytes,
                read_only: true,
                is_binary: false,
            });
        }
        let bytes =
            std::fs::read(target.as_path()).map_err(|e| format!("failed reading file: {e}"))?;
        let is_binary = bytes.iter().any(|b| *b == 0);
        let content = if is_binary {
            String::new()
        } else {
            String::from_utf8(bytes).map_err(|_| "file is not valid UTF-8 text".to_string())?
        };
        Ok(FilesReadFileResponse {
            correlation_id,
            path: path_to_string(target.as_path()),
            content,
            size_bytes,
            read_only: is_binary,
            is_binary,
        })
    }

    pub fn write_file(
        &self,
        path: &str,
        content: &str,
        correlation_id: String,
    ) -> Result<FilesWriteFileResponse, String> {
        let target = resolve_writable_target_path(self.root_path.as_path(), path)?;
        if target.is_dir() {
            return Err("requested path is a directory".to_string());
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed creating parent directories: {e}"))?;
        }
        std::fs::write(target.as_path(), content.as_bytes())
            .map_err(|e| format!("failed writing file: {e}"))?;
        Ok(FilesWriteFileResponse {
            correlation_id,
            path: path_to_string(target.as_path()),
            size_bytes: content.len() as u64,
        })
    }

    pub fn delete_path(
        &self,
        path: &str,
        recursive: bool,
        correlation_id: String,
    ) -> Result<FilesDeletePathResponse, String> {
        let target = resolve_existing_target_path(self.root_path.as_path(), Some(path))?;
        let metadata = std::fs::metadata(target.as_path())
            .map_err(|e| format!("failed reading target metadata: {e}"))?;
        if metadata.is_dir() {
            if recursive {
                std::fs::remove_dir_all(target.as_path())
                    .map_err(|e| format!("failed deleting directory recursively: {e}"))?;
            } else {
                std::fs::remove_dir(target.as_path())
                    .map_err(|e| format!("failed deleting directory: {e}"))?;
            }
        } else {
            std::fs::remove_file(target.as_path())
                .map_err(|e| format!("failed deleting file: {e}"))?;
        }
        Ok(FilesDeletePathResponse {
            correlation_id,
            path: path_to_string(target.as_path()),
            deleted: true,
        })
    }

    pub fn create_directory(
        &self,
        path: &str,
        recursive: bool,
        correlation_id: String,
    ) -> Result<FilesCreateDirectoryResponse, String> {
        let target = resolve_writable_target_path(self.root_path.as_path(), path)?;
        let already_exists = target.exists();
        if already_exists && !target.is_dir() {
            return Err("requested path already exists as a file".to_string());
        }
        if recursive {
            std::fs::create_dir_all(target.as_path())
                .map_err(|e| format!("failed creating directory recursively: {e}"))?;
        } else {
            std::fs::create_dir(target.as_path())
                .map_err(|e| format!("failed creating directory: {e}"))?;
        }
        Ok(FilesCreateDirectoryResponse {
            correlation_id,
            path: path_to_string(target.as_path()),
            created: !already_exists,
        })
    }
}

impl Default for FilesService {
    fn default() -> Self {
        Self::new()
    }
}

fn default_workspace_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.ends_with("src-tauri") {
        cwd.parent().unwrap_or(cwd.as_path()).to_path_buf()
    } else {
        cwd
    }
}

fn canonical_workspace_root(root: &Path) -> Result<PathBuf, String> {
    root.canonicalize()
        .map_err(|e| format!("failed resolving workspace root: {e}"))
}

fn resolve_requested_path(canonical_root: &Path, requested: &str) -> PathBuf {
    let raw = PathBuf::from(requested);
    if raw.is_absolute() {
        raw
    } else {
        canonical_root.join(raw)
    }
}

fn find_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if candidate.exists() {
            return Some(candidate.to_path_buf());
        }
        current = candidate.parent();
    }
    None
}

fn resolve_existing_target_path(root: &Path, requested: Option<&str>) -> Result<PathBuf, String> {
    let canonical_root = canonical_workspace_root(root)?;
    let requested = requested.unwrap_or("").trim();
    if requested.is_empty() {
        return Ok(canonical_root);
    }
    let joined = resolve_requested_path(canonical_root.as_path(), requested);
    let canonical_target = joined
        .canonicalize()
        .map_err(|e| format!("failed resolving requested path: {e}"))?;
    if !canonical_target.starts_with(canonical_root.as_path()) {
        return Err("requested path is outside workspace root".to_string());
    }
    Ok(canonical_target)
}

fn resolve_writable_target_path(root: &Path, requested: &str) -> Result<PathBuf, String> {
    let canonical_root = canonical_workspace_root(root)?;
    let trimmed = requested.trim();
    if trimmed.is_empty() {
        return Err("path is required".to_string());
    }
    let joined = resolve_requested_path(canonical_root.as_path(), trimmed);
    let existing_anchor = find_existing_ancestor(joined.as_path())
        .ok_or_else(|| "failed resolving requested path: no existing parent".to_string())?;
    let canonical_anchor = existing_anchor
        .canonicalize()
        .map_err(|e| format!("failed resolving requested path: {e}"))?;
    if !canonical_anchor.starts_with(canonical_root.as_path()) {
        return Err("requested path is outside workspace root".to_string());
    }
    Ok(joined)
}

fn list_directory_entries(path: &Path) -> Result<Vec<FilesListDirectoryEntry>, String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("failed reading path metadata: {e}"))?;
    if !metadata.is_dir() {
        return Err("requested path is not a directory".to_string());
    }

    let mut entries = Vec::<FilesListDirectoryEntry>::new();
    let read_dir = std::fs::read_dir(path).map_err(|e| format!("failed listing directory: {e}"))?;
    for entry in read_dir {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let entry_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let is_dir = file_type.is_dir();
        let metadata = entry.metadata().ok();
        let size_bytes = metadata
            .as_ref()
            .map(|meta| if meta.is_file() { meta.len() } else { 0 })
            .unwrap_or(0);
        let modified_ms = metadata
            .as_ref()
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|dur| dur.as_millis() as i64);
        entries.push(FilesListDirectoryEntry {
            name: file_name,
            path: path_to_string(entry_path.as_path()),
            is_dir,
            size_bytes,
            modified_ms,
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a
            .name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase()),
    });
    Ok(entries)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
