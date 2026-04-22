use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct UserProjectPaths {
    pub project_name: String,
    pub project_slug: String,
    pub root_path: PathBuf,
    pub tasks_path: PathBuf,
    pub sheets_path: PathBuf,
    pub looper_path: PathBuf,
    pub files_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct UserProjectsRoots {
    pub content_root: PathBuf,
    pub projects_root: PathBuf,
    pub tools_root: PathBuf,
}

#[derive(Debug, Clone)]
pub struct UserProjectsService {
    content_root: PathBuf,
    projects_root: PathBuf,
    tools_root: PathBuf,
}

impl UserProjectsService {
    pub fn new() -> Self {
        let documents_root = resolve_documents_root();
        let content_root = documents_root.join("Arxell");
        let projects_root = content_root.join("Projects");
        let tools_root = default_tools_root();
        Self {
            content_root,
            projects_root,
            tools_root,
        }
    }

    pub fn roots(&self) -> UserProjectsRoots {
        UserProjectsRoots {
            content_root: self.content_root.clone(),
            projects_root: self.projects_root.clone(),
            tools_root: self.tools_root.clone(),
        }
    }

    pub fn ensure_roots(&self) -> Result<UserProjectsRoots, String> {
        std::fs::create_dir_all(&self.projects_root)
            .map_err(|e| format!("failed creating Arxell projects root: {e}"))?;
        Ok(self.roots())
    }

    pub fn ensure_project(&self, project_name: &str) -> Result<UserProjectPaths, String> {
        let trimmed = project_name.trim();
        if trimmed.is_empty() {
            return Err("project name is required".to_string());
        }
        self.ensure_roots()?;
        let project_slug = slugify_project_name(trimmed);
        let root_path = self.projects_root.join(filesystem_project_dir_name(trimmed));
        let tasks_path = root_path.join("tasks");
        let sheets_path = root_path.join("sheets");
        let looper_path = root_path.join("looper");
        let files_path = root_path.join("files");
        for path in [&root_path, &tasks_path, &sheets_path, &looper_path, &files_path] {
            std::fs::create_dir_all(path)
                .map_err(|e| format!("failed creating project directory {}: {e}", path.display()))?;
        }
        Ok(UserProjectPaths {
            project_name: trimmed.to_string(),
            project_slug,
            root_path,
            tasks_path,
            sheets_path,
            looper_path,
            files_path,
        })
    }
}

impl Default for UserProjectsService {
    fn default() -> Self {
        Self::new()
    }
}

fn resolve_documents_root() -> PathBuf {
    if let Some(path) = dirs::document_dir() {
        return path;
    }
    if let Some(path) = dirs::home_dir() {
        return path.join("Documents");
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn default_tools_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let workspace_root = if cwd.ends_with("src-tauri") {
        cwd.parent().unwrap_or(cwd.as_path()).to_path_buf()
    } else {
        cwd
    };
    workspace_root.join("plugins")
}

fn filesystem_project_dir_name(value: &str) -> String {
    let mut out = String::new();
    let mut last_was_space = false;
    for ch in value.trim().chars() {
        let next = match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if c.is_control() => continue,
            c if c.is_whitespace() => ' ',
            c => c,
        };
        if next == ' ' {
            if out.is_empty() || last_was_space {
                continue;
            }
            last_was_space = true;
        } else {
            last_was_space = false;
        }
        out.push(next);
    }
    out.trim_matches([' ', '.']).to_string()
}

fn slugify_project_name(value: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;
    for ch in value.trim().chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            slug.push(lower);
            last_was_dash = false;
            continue;
        }
        if !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "project".to_string()
    } else {
        slug
    }
}

pub fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
