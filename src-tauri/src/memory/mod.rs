use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub namespace: String,
    pub key: String,
    pub value: String,
    pub updated_at: i64,
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS agent_memory (
            namespace  TEXT NOT NULL,
            key        TEXT NOT NULL,
            value      TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (namespace, key)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_memory_ns_updated
            ON agent_memory(namespace, updated_at DESC);
        "#,
    )?;
    Ok(())
}

pub fn upsert(conn: &Connection, namespace: &str, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO agent_memory (namespace, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![namespace, key, value, now_ms()],
    )?;
    // Prune episodic entries to 30 most recent so the file stays manageable.
    if namespace == "episodic" {
        conn.execute(
            "DELETE FROM agent_memory
             WHERE namespace = 'episodic'
               AND key NOT IN (
                   SELECT key FROM agent_memory
                   WHERE namespace = 'episodic'
                   ORDER BY updated_at DESC
                   LIMIT 30
               )",
            [],
        )?;
    }
    Ok(())
}

pub fn list(conn: &Connection, namespace: &str) -> Result<Vec<MemoryEntry>> {
    let mut stmt = conn.prepare(
        "SELECT namespace, key, value, updated_at FROM agent_memory
         WHERE namespace = ?1 ORDER BY updated_at DESC",
    )?;
    let rows = stmt
        .query_map(params![namespace], |row| {
            Ok(MemoryEntry {
                namespace: row.get(0)?,
                key: row.get(1)?,
                value: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn delete(conn: &Connection, namespace: &str, key: &str) -> Result<bool> {
    let n = conn.execute(
        "DELETE FROM agent_memory WHERE namespace = ?1 AND key = ?2",
        params![namespace, key],
    )?;
    Ok(n > 0)
}

// ─── Markdown sync ────────────────────────────────────────────────────────────

fn namespace_title(namespace: &str) -> String {
    match namespace {
        "user" => "User Profile".into(),
        "episodic" => "Conversation History".into(),
        other => {
            if let Some(proj) = other.strip_prefix("project_") {
                format!("Project: {proj}")
            } else {
                other.to_string()
            }
        }
    }
}

fn namespace_to_filename(namespace: &str) -> String {
    let safe: String = namespace
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    format!("{safe}.md")
}

fn filename_to_namespace(filename: &str) -> Option<String> {
    filename.strip_suffix(".md").map(|s| s.to_string())
}

/// Regenerate the human-readable markdown file for `namespace` from the DB.
/// Called after every write so the file is always current.
pub fn write_file(conn: &Connection, namespace: &str, memory_dir: &Path) -> Result<()> {
    let mut entries = list(conn, namespace)?;

    // Episodic: render oldest → newest for natural reading order.
    // Everything else: alphabetical by key.
    if namespace == "episodic" {
        entries.sort_by(|a, b| a.key.cmp(&b.key));
    } else {
        entries.sort_by(|a, b| a.key.cmp(&b.key));
    }

    let mut md = format!("# {}\n", namespace_title(namespace));
    for entry in &entries {
        md.push_str(&format!("\n## {}\n{}\n", entry.key, entry.value));
    }

    std::fs::create_dir_all(memory_dir)?;
    std::fs::write(memory_dir.join(namespace_to_filename(namespace)), &md)?;
    Ok(())
}

/// Parse `## key\nvalue` sections from a markdown file.
///
/// Format written by `write_file`:
/// ```text
/// # Title
///
/// ## key1
/// single or multi-line value
///
/// ## key2
/// another value
/// ```
fn parse_markdown(content: &str) -> Vec<(String, String)> {
    let mut result = Vec::new();
    let mut current_key: Option<String> = None;
    let mut current_lines: Vec<&str> = Vec::new();

    for line in content.lines() {
        if let Some(heading) = line.strip_prefix("## ") {
            if let Some(key) = current_key.take() {
                let val = current_lines.join("\n").trim().to_string();
                if !val.is_empty() {
                    result.push((key, val));
                }
            }
            current_key = Some(heading.trim().to_string());
            current_lines.clear();
        } else if line.starts_with("# ") {
            // document title — skip
        } else if current_key.is_some() {
            current_lines.push(line);
        }
    }

    if let Some(key) = current_key {
        let val = current_lines.join("\n").trim().to_string();
        if !val.is_empty() {
            result.push((key, val));
        }
    }

    result
}

/// On startup: import any `.md` files the user may have edited while the app
/// was closed into SQLite, so they take effect immediately.
pub fn sync_from_files(conn: &Connection, memory_dir: &Path) -> Result<()> {
    if !memory_dir.exists() {
        return Ok(());
    }
    for dir_entry in std::fs::read_dir(memory_dir)? {
        let dir_entry = dir_entry?;
        let path = dir_entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let namespace = match filename_to_namespace(&filename) {
            Some(ns) => ns,
            None => continue,
        };
        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        for (key, value) in parse_markdown(&content) {
            upsert(conn, &namespace, &key, &value)?;
        }
    }
    Ok(())
}
