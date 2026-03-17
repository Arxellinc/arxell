use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

use crate::AppState;

/// Skill category determines how the skill is activated
#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SkillCategory {
    /// Always injected into context (e.g., system prompt, available skills list)
    AlwaysActive,
    /// User can toggle on/off
    UserSelectable,
}

impl Default for SkillCategory {
    fn default() -> Self {
        Self::UserSelectable
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SkillMeta {
    pub id: String,
    pub name: String,
    pub path: String,
    pub description: String,
    /// Whether this skill is always active or user-selectable
    pub category: SkillCategory,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SkillsResolveResult {
    pub available: Vec<SkillMeta>,
    pub enabled_ids: Vec<String>,
    pub context_markdown: String,
}

fn legacy_skills_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("skills"))
}

fn skills_dir(_app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = arx_rs::Config::config_dir().join("skills");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Skills that should always be active and injected into context
const ALWAYS_ACTIVE_SKILLS: &[&str] = &["directives", "available-skills"];
const LOCAL_SKILLS_DIRS: &[&str] = &[".arx/skills", ".kon/skills"];

fn enabled_key(conversation_id: &str) -> String {
    format!("chat.skills.enabled.{}", conversation_id)
}

fn mode_budget(mode_id: Option<&str>) -> usize {
    match mode_id.unwrap_or("chat").to_ascii_lowercase().as_str() {
        "voice" => 2_200,
        "chat" => 4_000,
        "tools" => 6_000,
        "full" => 8_000,
        _ => 4_000,
    }
}

fn parse_skill(path: &std::path::Path) -> Option<SkillMeta> {
    let id = path.file_stem()?.to_string_lossy().into_owned();
    let content = std::fs::read_to_string(path).ok()?;

    let mut name = id.replace('-', " ");
    // Capitalise first letter
    if let Some(first) = name.get_mut(0..1) {
        first.make_ascii_uppercase();
    }
    let mut description = String::new();
    let mut past_heading = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(h) = trimmed.strip_prefix("# ") {
            name = h.to_string();
            past_heading = true;
        } else if past_heading && description.is_empty() {
            // First non-empty line after heading
            let s = trimmed.trim_start_matches(|c: char| !c.is_alphanumeric());
            description = s.to_string();
            break;
        } else if !past_heading && description.is_empty() {
            description = trimmed.to_string();
            break;
        }
    }

    // Determine category based on skill ID
    let category = if ALWAYS_ACTIVE_SKILLS.contains(&id.as_str()) {
        SkillCategory::AlwaysActive
    } else {
        SkillCategory::UserSelectable
    };

    Some(SkillMeta {
        id,
        name,
        path: path.to_string_lossy().into_owned(),
        description,
        category,
    })
}

fn collect_skill_dirs(app: &AppHandle, workspace_path: Option<&str>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(workspace) = workspace_path {
        let ws = PathBuf::from(workspace);
        for rel in LOCAL_SKILLS_DIRS {
            dirs.push(ws.join(rel));
        }
    }

    if let Ok(global) = skills_dir(app) {
        dirs.push(global);
    }

    dirs
}

fn list_skills_internal(
    app: &AppHandle,
    workspace_path: Option<&str>,
) -> Result<Vec<SkillMeta>, String> {
    let mut by_id: HashMap<String, SkillMeta> = HashMap::new();

    for dir in collect_skill_dirs(app, workspace_path) {
        if !dir.exists() {
            continue;
        }
        let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.extension().map(|e| e == "md").unwrap_or(false) {
                continue;
            }
            if let Some(meta) = parse_skill(&path) {
                // Local workspace skills override global skills with the same ID.
                by_id.entry(meta.id.clone()).or_insert(meta);
            }
        }
    }

    let mut skills: Vec<SkillMeta> = by_id.into_values().collect();
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

fn read_enabled_ids(state: &State<'_, AppState>, conversation_id: Option<&str>) -> Vec<String> {
    let Some(conversation_id) = conversation_id else {
        return Vec::new();
    };
    if conversation_id.trim().is_empty() {
        return Vec::new();
    }
    let key = enabled_key(conversation_id);
    let db = state.db.lock().unwrap();
    let raw = db.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get::<_, String>(0),
    );
    let Ok(raw) = raw else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default()
}

fn persist_enabled_ids(
    state: &State<'_, AppState>,
    conversation_id: &str,
    enabled_ids: &[String],
) -> Result<(), String> {
    let key = enabled_key(conversation_id);
    let value = serde_json::to_string(enabled_ids).map_err(|e| e.to_string())?;
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn resolve_enabled_ids(available: &[SkillMeta], requested: Vec<String>) -> Vec<String> {
    let mut known = HashSet::new();
    let mut always = Vec::new();
    for skill in available {
        known.insert(skill.id.clone());
        if skill.category == SkillCategory::AlwaysActive {
            always.push(skill.id.clone());
        }
    }

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for id in always {
        if seen.insert(id.clone()) {
            out.push(id);
        }
    }
    for id in requested {
        if known.contains(&id) && seen.insert(id.clone()) {
            out.push(id);
        }
    }
    out
}

fn build_context_markdown(
    available: &[SkillMeta],
    enabled_ids: &[String],
    mode_id: Option<&str>,
) -> String {
    if enabled_ids.is_empty() {
        return String::new();
    }

    let mut by_id = HashMap::new();
    for skill in available {
        by_id.insert(skill.id.as_str(), skill);
    }

    let mut pieces = vec!["## Active Skills".to_string(), "".to_string()];
    let mut deferred = Vec::new();
    let mut used = 0usize;
    let budget = mode_budget(mode_id);

    // Keep context lean: include full text while under budget, then fall back to summaries.
    for id in enabled_ids {
        let Some(skill) = by_id.get(id.as_str()) else {
            continue;
        };
        let content = std::fs::read_to_string(&skill.path).unwrap_or_default();
        let trimmed = content.trim();
        if trimmed.is_empty() {
            continue;
        }
        let block = format!("### {}\n\n{}\n", skill.name, trimmed);
        let block_len = block.len();
        if used + block_len <= budget {
            pieces.push(block);
            used += block_len;
        } else {
            deferred.push(format!(
                "- {} (`{}`): {}",
                skill.name, skill.id, skill.description
            ));
        }
    }

    if !deferred.is_empty() {
        pieces.push("### Deferred Skills".to_string());
        pieces.push(
            "These remain enabled but are summarized to stay within context budget:".to_string(),
        );
        pieces.push("".to_string());
        pieces.push(deferred.join("\n"));
    }

    pieces.join("\n")
}

#[tauri::command]
pub fn cmd_skills_list(
    app: AppHandle,
    workspace_path: Option<String>,
) -> Result<Vec<SkillMeta>, String> {
    list_skills_internal(&app, workspace_path.as_deref())
}

#[tauri::command]
pub fn cmd_skills_dir(app: AppHandle) -> Result<String, String> {
    let dir = skills_dir(&app).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn cmd_skills_resolve(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: Option<String>,
    workspace_path: Option<String>,
    mode_id: Option<String>,
) -> Result<SkillsResolveResult, String> {
    let available = list_skills_internal(&app, workspace_path.as_deref())?;
    let requested = read_enabled_ids(&state, conversation_id.as_deref());
    let enabled_ids = resolve_enabled_ids(&available, requested);
    let context_markdown = build_context_markdown(&available, &enabled_ids, mode_id.as_deref());
    Ok(SkillsResolveResult {
        available,
        enabled_ids,
        context_markdown,
    })
}

#[tauri::command]
pub fn cmd_skills_set_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
    workspace_path: Option<String>,
    mode_id: Option<String>,
    enabled_ids: Vec<String>,
) -> Result<SkillsResolveResult, String> {
    let available = list_skills_internal(&app, workspace_path.as_deref())?;
    let resolved_enabled = resolve_enabled_ids(&available, enabled_ids);
    persist_enabled_ids(&state, &conversation_id, &resolved_enabled)?;
    let context_markdown =
        build_context_markdown(&available, &resolved_enabled, mode_id.as_deref());
    Ok(SkillsResolveResult {
        available,
        enabled_ids: resolved_enabled,
        context_markdown,
    })
}

/// Called from lib.rs setup to seed default skills when directory is empty.
pub fn seed_default_skills(app: &AppHandle) {
    let dir = match skills_dir(app) {
        Ok(d) => d,
        Err(_) => return,
    };
    if let Ok(legacy_dir) = legacy_skills_dir(app) {
        if legacy_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&legacy_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.extension().map(|e| e == "md").unwrap_or(false) {
                        continue;
                    }
                    let Some(name) = path.file_name() else {
                        continue;
                    };
                    let dest = dir.join(name);
                    if !dest.exists() {
                        let _ = std::fs::copy(&path, &dest);
                    }
                }
            }
        }
    }

    let defaults: &[(&str, &str)] = &[
        // Always-active skills (injected into every context)
        (
            "directives.md",
            r#"# Directives

You are a helpful AI assistant with access to tools for reading and writing files in the user's workspace. Be concise, accurate, and helpful.

When writing code or creating files, always use the write_to_file tool rather than pasting content into chat. Write complete, working code without placeholders.
"#,
        ),
        (
            "available-skills.md",
            r#"# skills

This skill is automatically populated with the list of available skills. It is always active so the assistant knows what capabilities it has.
"#,
        ),
        // User-selectable skills
        (
            "personality.md",
            r#"# Personality

You are friendly, curious, and thoughtful. You communicate clearly and adapt your tone to match the user's needs.

- Be direct when discussing technical topics
- Use examples and analogies to explain complex concepts
- Acknowledge uncertainty when appropriate
- Ask clarifying questions when the request is ambiguous
"#,
        ),
        (
            "code-review.md",
            r#"# code

Analyze the provided code for correctness, performance, security, and style.
Suggest specific improvements with code examples where applicable.

Check for: logic errors, edge cases, error handling, naming conventions,
code duplication, and potential security vulnerabilities.
"#,
        ),
        (
            "document-writer.md",
            r#"# Writing

Generate clear, well-structured documentation for the provided code or feature.

Include: overview, usage examples, parameter descriptions, return values, and
common pitfalls. Format as Markdown suitable for a README or wiki page.
"#,
        ),
        (
            "refactor.md",
            r#"# Refactor

Refactor the provided code to improve readability, reduce duplication, and
follow best practices for the given language.

Preserve all existing behaviour. Explain each change and why it improves
the code.
"#,
        ),
        (
            "browser.md",
            r#"# Browser

You can browse the web to research topics, look up documentation, verify facts, and read articles using the browser_fetch tool.

## Tool: browser_fetch

Fetch and read any web page:

<browser_fetch>
<url>https://example.com/page</url>
<mode>markdown</mode>
</browser_fetch>

**Modes:**
- `markdown` — converts the page to structured plain text (best for articles, docs, search results)
- `text` — stripped plain text, most compact
- `html` — raw HTML source (use when inspecting page structure)

The result is returned to you automatically so you can read and reason about the content.

## Guidelines

- Use `markdown` mode for most tasks — it preserves headings, lists, and structure while being compact
- Fetch primary sources rather than relying on training data for facts, versions, or current information
- When multiple sources are needed, issue multiple browser_fetch calls in sequence
- Always cite the URL when using fetched content in your response
- For API documentation, prefer `text` mode to reduce noise
- The visual browser panel in the workspace shows the same page; the user sees what you're reading
"#,
        ),
        (
            "voice.md",
            r#"# Voice

Voice conversation mode is active. Your responses will be spoken with text-to-speech while they stream.

Guidelines for voice mode:
- Keep responses concise by default (usually 1-4 short sentences unless asked for detail)
- Put the direct answer first, then brief supporting detail
- Use natural spoken phrasing and avoid long lists unless requested
- Avoid markdown-heavy formatting and code fences unless the user asks for code
- Ask one clarifying question when needed instead of giving long assumptions
- Prefer practical next actions in plain language

Thinking mode may be disabled for lower latency. If the user explicitly asks for deeper reasoning, they can enable it manually.
"#,
        ),
    ];

    for (filename, content) in defaults {
        let path = dir.join(filename);
        if !path.exists() {
            let _ = std::fs::write(&path, content);
        }
    }
}
