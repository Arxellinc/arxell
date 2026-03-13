use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

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

fn skills_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = app.path().app_data_dir()?.join("skills");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Skills that should always be active and injected into context
const ALWAYS_ACTIVE_SKILLS: &[&str] = &["directives", "available-skills"];

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

#[tauri::command]
pub fn cmd_skills_list(app: AppHandle) -> Result<Vec<SkillMeta>, String> {
    let dir = skills_dir(&app).map_err(|e| e.to_string())?;
    let mut skills = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().map(|e| e == "md").unwrap_or(false) {
            if let Some(meta) = parse_skill(&path) {
                skills.push(meta);
            }
        }
    }
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

#[tauri::command]
pub fn cmd_skills_dir(app: AppHandle) -> Result<String, String> {
    let dir = skills_dir(&app).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Called from lib.rs setup to seed default skills when directory is empty.
pub fn seed_default_skills(app: &AppHandle) {
    let dir = match skills_dir(app) {
        Ok(d) => d,
        Err(_) => return,
    };

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
