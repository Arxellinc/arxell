use crate::config::{DEFAULT_LOCAL_SKILLS_DIR, LEGACY_LOCAL_SKILLS_DIR, LOCAL_SKILLS_DIR_ENV};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub file_path: String,
    pub base_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillWarning {
    pub skill_path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoadSkillsResult {
    pub skills: Vec<Skill>,
    pub warnings: Vec<SkillWarning>,
}

fn parse_frontmatter(content: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    if !content.starts_with("---") {
        return out;
    }
    let rest = &content[3..];
    if let Some(idx) = rest.find("\n---") {
        let fm = &rest[..idx];
        for line in fm.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = line.split_once(':') {
                out.insert(k.trim().to_string(), v.trim().trim_matches('"').to_string());
            }
        }
    }
    out
}

fn load_skill_dir(skill_dir: &Path) -> (Option<Skill>, Vec<SkillWarning>) {
    let mut warnings = Vec::new();
    let file = skill_dir.join("SKILL.md");
    if !file.is_file() {
        return (None, warnings);
    }

    let content = match std::fs::read_to_string(&file) {
        Ok(c) => c,
        Err(e) => {
            warnings.push(SkillWarning {
                skill_path: file.display().to_string(),
                message: e.to_string(),
            });
            return (None, warnings);
        }
    };

    let fm = parse_frontmatter(&content);
    let parent_name = skill_dir
        .file_name()
        .and_then(|x| x.to_str())
        .unwrap_or_default()
        .to_string();
    let name = fm
        .get("name")
        .cloned()
        .unwrap_or_else(|| parent_name.clone());
    let description = fm.get("description").cloned().unwrap_or_default();

    if description.trim().is_empty() {
        warnings.push(SkillWarning {
            skill_path: file.display().to_string(),
            message: "description is required".to_string(),
        });
        return (None, warnings);
    }

    (
        Some(Skill {
            name,
            description,
            file_path: file.display().to_string(),
            base_dir: skill_dir.display().to_string(),
        }),
        warnings,
    )
}

fn load_skills_from_dir(dir: &Path) -> LoadSkillsResult {
    let mut result = LoadSkillsResult::default();
    if !dir.exists() {
        return result;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return result;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|x| x.to_str()) {
            if name.starts_with('.') {
                continue;
            }
        }
        let (skill, warnings) = load_skill_dir(&path);
        result.warnings.extend(warnings);
        if let Some(s) = skill {
            result.skills.push(s);
        }
    }
    result
}

pub fn load_skills(cwd: Option<&str>) -> LoadSkillsResult {
    let cwd = cwd
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let global = crate::config::Config::config_dir().join("skills");

    let mut map = std::collections::HashMap::<String, Skill>::new();
    let mut warnings = Vec::new();
    let mut sources = Vec::new();

    if let Ok(local_override) = std::env::var(LOCAL_SKILLS_DIR_ENV) {
        let trimmed = local_override.trim();
        if !trimmed.is_empty() {
            let override_path = PathBuf::from(trimmed);
            let path = if override_path.is_absolute() {
                override_path
            } else {
                cwd.join(override_path)
            };
            sources.push(path);
        }
    }

    if sources.is_empty() {
        sources.push(cwd.join(DEFAULT_LOCAL_SKILLS_DIR));
        // Keep legacy compatibility for existing workspaces.
        sources.push(cwd.join(LEGACY_LOCAL_SKILLS_DIR));
    }
    sources.push(global);

    for src_dir in sources {
        let src = load_skills_from_dir(&src_dir);
        warnings.extend(src.warnings);
        for s in src.skills {
            map.entry(s.name.clone()).or_insert(s);
        }
    }

    let mut skills = map.into_values().collect::<Vec<_>>();
    skills.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));

    LoadSkillsResult { skills, warnings }
}

pub fn format_skills_for_prompt(skills: &[Skill]) -> String {
    if skills.is_empty() {
        return String::new();
    }
    let mut lines = vec!["# Skills".to_string(), String::new()];
    for s in skills {
        let summary = summarize_skill_description(s.description.as_str());
        lines.push(format!("- {}: {}", s.name, summary));
    }
    lines.join("\n")
}

fn summarize_skill_description(description: &str) -> String {
    let trimmed = description.trim();
    let sentence = trimmed
        .split(['.', '!', '?'])
        .next()
        .unwrap_or(trimmed)
        .trim();
    let normalized = sentence
        .replace("This skill should be used when the user asks to", "Use for")
        .replace("This skill should be used when the user wants to", "Use for")
        .replace("This skill should be used when", "Use for")
        .replace("Provides comprehensive guidance for", "Guidance for")
        .replace("Provides comprehensive", "")
        .replace("Provides", "")
        .replace("  ", " ");
    let words = normalized.split_whitespace().collect::<Vec<_>>();
    if words.len() <= 12 {
        return words.join(" ");
    }
    format!("{}...", words[..12].join(" "))
}
