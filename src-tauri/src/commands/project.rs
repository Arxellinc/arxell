use chrono::Utc;
use std::path::{Path, PathBuf};
use tauri::State;
use uuid::Uuid;

use crate::db::{
    gen_project_id,
    models::{Conversation, Project},
};
use crate::AppState;

fn user_home_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(PathBuf::from)
        .or_else(|| std::env::var("USERPROFILE").ok().map(PathBuf::from))
}

fn default_projects_root() -> PathBuf {
    let mut base = user_home_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    base.push("Documents");
    base.push("Arxell");
    base.push("Projects");
    base
}

fn sanitize_project_segment(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.trim().chars() {
        let keep = ch.is_ascii_alphanumeric() || ch == '-' || ch == '_';
        if keep {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed
    }
}

fn default_workspace_for_project(project_name: &str, project_id: &str) -> PathBuf {
    let mut path = default_projects_root();
    let slug = sanitize_project_segment(project_name);
    let suffix: String = project_id.chars().take(8).collect();
    path.push(format!("{slug}-{suffix}"));
    path
}

fn expand_home_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = user_home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn ensure_workspace_dir(path: &Path) -> Result<String, String> {
    std::fs::create_dir_all(path).map_err(|e| {
        format!(
            "Failed to create workspace directory '{}': {}",
            path.display(),
            e
        )
    })?;
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    Ok(canonical.to_string_lossy().to_string())
}

fn ensure_project_workspace(
    db: &rusqlite::Connection,
    project_id: &str,
    project_name: &str,
    current_workspace_path: &str,
) -> Result<String, String> {
    let trimmed = current_workspace_path.trim();
    let resolved_path = if trimmed.is_empty() {
        default_workspace_for_project(project_name, project_id)
    } else {
        expand_home_path(trimmed)
    };
    let canonical = ensure_workspace_dir(&resolved_path)?;
    if canonical != trimmed {
        db.execute(
            "UPDATE projects SET workspace_path = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![canonical, Utc::now().timestamp_millis(), project_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(canonical)
}

fn query_projects(db: &rusqlite::Connection) -> Result<Vec<Project>, String> {
    let mut stmt = db
        .prepare("SELECT id, name, description, workspace_path, created_at, updated_at FROM projects ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let v: Vec<Project> = stmt
        .query_map([], Project::from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(v)
}

fn ensure_default_project_id(db: &rusqlite::Connection) -> Result<String, String> {
    if let Ok((id, name, workspace_path)) = db.query_row(
        "SELECT id, name, workspace_path FROM projects WHERE lower(trim(name)) = 'general' ORDER BY updated_at DESC LIMIT 1",
        [],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
    ) {
        let _ = ensure_project_workspace(db, &id, &name, &workspace_path)?;
        return Ok(id);
    }

    if let Ok((id, name, workspace_path)) = db.query_row(
        "SELECT id, name, workspace_path FROM projects ORDER BY updated_at DESC LIMIT 1",
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        },
    ) {
        let _ = ensure_project_workspace(db, &id, &name, &workspace_path)?;
        return Ok(id);
    }

    let now = Utc::now().timestamp_millis();
    let id = gen_project_id();
    let workspace_path = ensure_workspace_dir(&default_workspace_for_project("General", &id))?;
    db.execute(
        "INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?1, 'General', '', ?2, ?3, ?3)",
        rusqlite::params![id, workspace_path, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

fn resolve_project_id_for_conversation(
    db: &rusqlite::Connection,
    project_id: Option<String>,
) -> Result<String, String> {
    if let Some(pid) = project_id
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
    {
        let exists = db
            .query_row(
                "SELECT 1 FROM projects WHERE id = ?1 LIMIT 1",
                rusqlite::params![&pid],
                |row| row.get::<_, i64>(0),
            )
            .ok()
            .is_some();
        if exists {
            return Ok(pid);
        }
    }

    ensure_default_project_id(db)
}

fn query_conversations(
    db: &rusqlite::Connection,
    project_id: &str,
) -> Result<Vec<Conversation>, String> {
    let mut stmt = db
        .prepare("SELECT id, project_id, title, model, created_at, updated_at FROM conversations WHERE project_id = ?1 ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let v: Vec<Conversation> = stmt
        .query_map(rusqlite::params![project_id], Conversation::from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(v)
}

#[tauri::command]
pub fn cmd_project_create(
    state: State<'_, AppState>,
    name: String,
    workspace_path: String,
) -> Result<Project, String> {
    let now = Utc::now().timestamp_millis();
    let id = gen_project_id();
    let resolved_workspace = if workspace_path.trim().is_empty() {
        ensure_workspace_dir(&default_workspace_for_project(&name, &id))?
    } else {
        ensure_workspace_dir(&expand_home_path(&workspace_path))?
    };
    let project = Project {
        id,
        name,
        description: String::new(),
        workspace_path: resolved_workspace,
        created_at: now,
        updated_at: now,
    };
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO projects (id, name, description, workspace_path, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![project.id, project.name, project.description, project.workspace_path, project.created_at, project.updated_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(project)
}

#[tauri::command]
pub fn cmd_project_list(state: State<'_, AppState>) -> Result<Vec<Project>, String> {
    let db = state.db.lock().unwrap();
    let mut projects = query_projects(&db)?;
    for project in &mut projects {
        let ensured =
            ensure_project_workspace(&db, &project.id, &project.name, &project.workspace_path)?;
        project.workspace_path = ensured;
    }
    Ok(projects)
}

#[tauri::command]
pub fn cmd_project_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cmd_project_update(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    workspace_path: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let now = Utc::now().timestamp_millis();

    if let Some(n) = name {
        db.execute(
            "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![n, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(d) = description {
        db.execute(
            "UPDATE projects SET description = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![d, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(w) = workspace_path {
        let project_name: String = db
            .query_row(
                "SELECT name FROM projects WHERE id = ?1",
                rusqlite::params![id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| e.to_string())?;
        let ensured = ensure_project_workspace(&db, &id, &project_name, &w)?;
        db.execute(
            "UPDATE projects SET workspace_path = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![ensured, now, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn cmd_conversation_create(
    state: State<'_, AppState>,
    project_id: Option<String>,
    title: String,
) -> Result<Conversation, String> {
    let now = Utc::now().timestamp_millis();
    let db = state.db.lock().unwrap();
    let resolved_project_id = resolve_project_id_for_conversation(&db, project_id)?;
    let conv = Conversation {
        id: Uuid::new_v4().to_string(),
        project_id: Some(resolved_project_id),
        title,
        model: String::new(),
        created_at: now,
        updated_at: now,
    };
    db.execute(
        "INSERT INTO conversations (id, project_id, title, model, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![conv.id, conv.project_id, conv.title, conv.model, conv.created_at, conv.updated_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(conv)
}

#[tauri::command]
pub fn cmd_conversation_list(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<Conversation>, String> {
    let db = state.db.lock().unwrap();
    query_conversations(&db, &project_id)
}

#[tauri::command]
pub fn cmd_conversation_list_all(state: State<'_, AppState>) -> Result<Vec<Conversation>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, project_id, title, model, created_at, updated_at FROM conversations ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let v: Vec<Conversation> = stmt
        .query_map([], Conversation::from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(v)
}

#[tauri::command]
pub fn cmd_conversation_get_last(
    state: State<'_, AppState>,
) -> Result<Option<Conversation>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, project_id, title, model, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 1")
        .map_err(|e| e.to_string())?;
    let result: Option<Conversation> = stmt
        .query_map([], Conversation::from_row)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .next();
    Ok(result)
}

#[tauri::command]
pub fn cmd_conversation_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "DELETE FROM conversations WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cmd_conversation_update_title(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![title, Utc::now().timestamp_millis(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cmd_conversation_assign_project(
    state: State<'_, AppState>,
    id: String,
    project_id: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let resolved_project_id = resolve_project_id_for_conversation(&db, project_id)?;
    db.execute(
        "UPDATE conversations SET project_id = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![Some(resolved_project_id), Utc::now().timestamp_millis(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cmd_conversation_branch_from_message(
    state: State<'_, AppState>,
    source_conversation_id: Option<String>,
    project_id: Option<String>,
    content: String,
    title: Option<String>,
) -> Result<Conversation, String> {
    let trimmed_content = content.trim();
    if trimmed_content.is_empty() {
        return Err("Cannot branch from an empty message".to_string());
    }

    let db = state.db.lock().unwrap();
    let now = Utc::now().timestamp_millis();

    let inferred_project_id = if project_id
        .as_deref()
        .map(|v| v.trim().is_empty())
        .unwrap_or(true)
    {
        if let Some(source_id) = source_conversation_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            db.query_row(
                "SELECT project_id FROM conversations WHERE id = ?1 LIMIT 1",
                rusqlite::params![source_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
        } else {
            None
        }
    } else {
        None
    };

    let resolved_project_id =
        resolve_project_id_for_conversation(&db, project_id.or(inferred_project_id))?;

    let clean_title = title
        .unwrap_or_else(|| "Branched Chat".to_string())
        .trim()
        .to_string();
    let final_title = if clean_title.is_empty() {
        "Branched Chat".to_string()
    } else {
        clean_title
    };

    let conv = Conversation {
        id: Uuid::new_v4().to_string(),
        project_id: Some(resolved_project_id),
        title: final_title,
        model: String::new(),
        created_at: now,
        updated_at: now,
    };

    db.execute(
        "INSERT INTO conversations (id, project_id, title, model, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6)",
        rusqlite::params![conv.id, conv.project_id, conv.title, conv.model, conv.created_at, conv.updated_at],
    )
    .map_err(|e| e.to_string())?;

    let assistant_msg_id = Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1,?2,'assistant',?3,?4)",
        rusqlite::params![assistant_msg_id, conv.id, trimmed_content, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(conv)
}
