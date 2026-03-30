use crate::config::Config;
use crate::context::shared::escape_xml;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const CANDIDATES: [&str; 2] = ["AGENTS.md", "CLAUDE.md"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextFile {
    pub path: String,
    pub content: String,
}

fn find_git_root(start: &Path) -> Option<PathBuf> {
    let mut cur = start.to_path_buf();
    loop {
        if cur.join(".git").is_dir() {
            return Some(cur);
        }
        if !cur.pop() {
            return None;
        }
    }
}

fn stop_dir(cwd: &Path) -> PathBuf {
    if let Some(root) = find_git_root(cwd) {
        return root;
    }
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| cwd.to_path_buf());
    if cwd.starts_with(&home) {
        home
    } else {
        cwd.to_path_buf()
    }
}

fn load_from_dir(dir: &Path) -> Option<ContextFile> {
    for name in CANDIDATES {
        let path = dir.join(name);
        if path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                return Some(ContextFile {
                    path: path.display().to_string(),
                    content,
                });
            }
        }
    }
    None
}

pub fn load_agents_files(cwd: Option<&str>) -> Vec<ContextFile> {
    let cwd = cwd
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let cwd = cwd.canonicalize().unwrap_or(cwd);

    let mut files = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let global = Config::config_dir();
    if global.exists() {
        if let Some(cf) = load_from_dir(&global) {
            seen.insert(cf.path.clone());
            files.push(cf);
        }
    }

    let stop = stop_dir(&cwd);
    let mut stack = Vec::new();
    let mut cur = cwd.as_path();
    loop {
        if let Some(cf) = load_from_dir(cur) {
            if !seen.contains(&cf.path) {
                seen.insert(cf.path.clone());
                stack.push(cf);
            }
        }
        if cur == stop.as_path() {
            break;
        }
        if let Some(p) = cur.parent() {
            cur = p;
        } else {
            break;
        }
    }
    stack.reverse();
    files.extend(stack);
    files
}

pub fn format_agents_files_for_prompt(agents_files: &[ContextFile]) -> String {
    if agents_files.is_empty() {
        return String::new();
    }
    let mut lines = vec![
        "# Project Context".to_string(),
        String::new(),
        "<project_guidelines>".to_string(),
    ];
    for cf in agents_files {
        lines.push(format!("<file path=\"{}\">", escape_xml(&cf.path)));
        lines.push(escape_xml(&cf.content));
        lines.push("</file>".to_string());
    }
    lines.push("</project_guidelines>".to_string());
    lines.join("\n")
}
