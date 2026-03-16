use crate::config::CONFIG_DIR_NAME;
use crate::context::shared::escape_xml;
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
    let name = fm.get("name").cloned().unwrap_or_else(|| parent_name.clone());
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
    let local = cwd.join(CONFIG_DIR_NAME).join("skills");
    let global = crate::config::Config::config_dir().join("skills");

    let mut map = std::collections::HashMap::<String, Skill>::new();
    let mut warnings = Vec::new();

    for src in [load_skills_from_dir(&local), load_skills_from_dir(&global)] {
        warnings.extend(src.warnings);
        for s in src.skills {
            map.entry(s.name.clone()).or_insert(s);
        }
    }

    LoadSkillsResult {
        skills: map.into_values().collect(),
        warnings,
    }
}

pub fn format_skills_for_prompt(skills: &[Skill]) -> String {
    if skills.is_empty() {
        return String::new();
    }
    let mut lines = vec![
        "# Skills".to_string(),
        String::new(),
        "<available_skills>".to_string(),
    ];
    for s in skills {
        lines.push("<skill>".to_string());
        lines.push(format!("<name>{}</name>", escape_xml(&s.name)));
        lines.push(format!("<description>{}</description>", escape_xml(&s.description)));
        lines.push(format!("<location>{}</location>", escape_xml(&s.file_path)));
        lines.push("</skill>".to_string());
    }
    lines.push("</available_skills>".to_string());
    lines.join("\n")
}
