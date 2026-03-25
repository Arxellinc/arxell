use crate::contracts::{ConversationMessageRecord, ConversationSummaryRecord};
use crate::contracts::MessageRole;
use rusqlite::{params, Connection};
use serde_json::Deserializer;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub trait ConversationRepository: Send + Sync {
    fn append_message(&self, message: &ConversationMessageRecord) -> Result<(), String>;
    fn list_messages(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationMessageRecord>, String>;
    fn list_conversations(&self) -> Result<Vec<ConversationSummaryRecord>, String>;
    fn conversation_message_count(&self, conversation_id: &str) -> Result<usize, String>;
    fn get_conversation_title(&self, conversation_id: &str) -> Result<Option<String>, String>;
    fn upsert_conversation_title(&self, conversation_id: &str, title: &str) -> Result<(), String>;
    fn get_model_family_thinking_strategy(&self, model_family: &str) -> Result<Option<String>, String>;
    fn upsert_model_family_thinking_strategy(
        &self,
        model_family: &str,
        strategy: &str,
    ) -> Result<(), String>;
    fn delete_conversation(&self, conversation_id: &str) -> Result<bool, String>;
}

pub struct SqliteConversationRepository {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl SqliteConversationRepository {
    pub fn new(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("failed creating sqlite dir: {e}"))?;
        }
        let conn = Connection::open(&path)
            .map_err(|e| format!("failed opening sqlite conversation db: {e}"))?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS conversation_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                correlation_id TEXT NOT NULL,
                timestamp_ms INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_timestamp
                ON conversation_messages(conversation_id, timestamp_ms);
            CREATE INDEX IF NOT EXISTS idx_conversation_messages_timestamp
                ON conversation_messages(timestamp_ms);
            CREATE TABLE IF NOT EXISTS conversation_metadata (
                conversation_id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                updated_at_ms INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS model_family_preferences (
                model_family TEXT PRIMARY KEY,
                thinking_disable_strategy TEXT NOT NULL,
                updated_at_ms INTEGER NOT NULL DEFAULT 0
            );
            "#,
        )
        .map_err(|e| format!("failed initializing sqlite schema: {e}"))?;
        seed_model_family_preferences(&conn)
            .map_err(|e| format!("failed seeding model family preferences: {e}"))?;
        Ok(Self {
            path,
            write_lock: Mutex::new(()),
        })
    }

    pub fn default_path() -> PathBuf {
        if let Ok(raw) = std::env::var("FOUNDATION_CONVERSATION_DB_PATH") {
            return PathBuf::from(raw);
        }
        std::env::temp_dir()
            .join("refactor-ai-foundation")
            .join("conversations.sqlite3")
    }

    fn open_connection(&self) -> Result<Connection, String> {
        Connection::open(&self.path)
            .map_err(|e| format!("failed opening sqlite conversation db: {e}"))
    }
}

impl ConversationRepository for SqliteConversationRepository {
    fn append_message(&self, message: &ConversationMessageRecord) -> Result<(), String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "sqlite conversation write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        conn.execute(
            "INSERT INTO conversation_messages (conversation_id, role, content, correlation_id, timestamp_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                message.conversation_id,
                role_to_str(&message.role),
                message.content,
                message.correlation_id,
                message.timestamp_ms
            ],
        )
        .map_err(|e| format!("failed inserting sqlite conversation record: {e}"))?;
        Ok(())
    }

    fn list_messages(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationMessageRecord>, String> {
        let conn = self.open_connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT conversation_id, role, content, correlation_id, timestamp_ms
                 FROM conversation_messages
                 WHERE conversation_id = ?1
                 ORDER BY timestamp_ms ASC",
            )
            .map_err(|e| format!("failed preparing sqlite message query: {e}"))?;
        let rows = stmt
            .query_map(params![conversation_id], |row| {
                let role_raw: String = row.get(1)?;
                let role = role_from_str(role_raw.as_str()).map_err(|_| {
                    rusqlite::Error::FromSqlConversionFailure(
                        1,
                        rusqlite::types::Type::Text,
                        Box::new(std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!("unknown message role {role_raw}"),
                        )),
                    )
                })?;
                Ok(ConversationMessageRecord {
                    conversation_id: row.get(0)?,
                    role,
                    content: row.get(2)?,
                    correlation_id: row.get(3)?,
                    timestamp_ms: row.get(4)?,
                })
            })
            .map_err(|e| format!("failed querying sqlite messages: {e}"))?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("failed reading sqlite message row: {e}"))?);
        }
        Ok(out)
    }

    fn list_conversations(&self) -> Result<Vec<ConversationSummaryRecord>, String> {
        let conn = self.open_connection()?;
        let mut stmt = conn
            .prepare(
                "SELECT conversation_id, COUNT(*), MAX(timestamp_ms)
                 FROM conversation_messages
                 GROUP BY conversation_id
                 ORDER BY MAX(timestamp_ms) DESC",
            )
            .map_err(|e| format!("failed preparing sqlite conversation summary query: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| format!("failed querying sqlite conversation summaries: {e}"))?;

        let mut out = Vec::new();
        for row in rows {
            let (conversation_id, message_count, updated_at_ms) =
                row.map_err(|e| format!("failed reading sqlite summary row: {e}"))?;
            let count = message_count as usize;
            if count < 3 {
                continue;
            }
            let last_message_preview = conn
                .query_row(
                    "SELECT content
                     FROM conversation_messages
                     WHERE conversation_id = ?1
                     ORDER BY timestamp_ms DESC
                     LIMIT 1",
                    params![conversation_id.as_str()],
                    |r| r.get::<_, String>(0),
                )
                .map(|content| truncate_preview(content.as_str(), 72))
                .unwrap_or_default();
            let title = conn
                .query_row(
                    "SELECT title
                     FROM conversation_metadata
                     WHERE conversation_id = ?1",
                    params![conversation_id.as_str()],
                    |r| r.get::<_, String>(0),
                )
                .unwrap_or_else(|_| String::new());

            out.push(ConversationSummaryRecord {
                conversation_id,
                title,
                message_count: count,
                last_message_preview,
                updated_at_ms,
            });
        }
        Ok(out)
    }

    fn conversation_message_count(&self, conversation_id: &str) -> Result<usize, String> {
        let conn = self.open_connection()?;
        let count = conn
            .query_row(
                "SELECT COUNT(*)
                 FROM conversation_messages
                 WHERE conversation_id = ?1",
                params![conversation_id],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|e| format!("failed querying conversation message count: {e}"))?;
        Ok(count as usize)
    }

    fn get_conversation_title(&self, conversation_id: &str) -> Result<Option<String>, String> {
        let conn = self.open_connection()?;
        let title = conn
            .query_row(
                "SELECT title
                 FROM conversation_metadata
                 WHERE conversation_id = ?1",
                params![conversation_id],
                |r| r.get::<_, String>(0),
            )
            .ok();
        Ok(title.filter(|value| !value.trim().is_empty()))
    }

    fn upsert_conversation_title(&self, conversation_id: &str, title: &str) -> Result<(), String> {
        let normalized = title.trim();
        if normalized.is_empty() {
            return Ok(());
        }
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "sqlite conversation write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        conn.execute(
            "INSERT INTO conversation_metadata (conversation_id, title, updated_at_ms)
             VALUES (?1, ?2, strftime('%s','now') * 1000)
             ON CONFLICT(conversation_id) DO UPDATE SET
                 title = excluded.title,
                 updated_at_ms = excluded.updated_at_ms",
            params![conversation_id, normalized],
        )
        .map_err(|e| format!("failed upserting conversation title: {e}"))?;
        Ok(())
    }

    fn get_model_family_thinking_strategy(&self, model_family: &str) -> Result<Option<String>, String> {
        let conn = self.open_connection()?;
        let normalized = normalize_model_family(model_family);
        let direct = conn
            .query_row(
                "SELECT thinking_disable_strategy
                 FROM model_family_preferences
                 WHERE model_family = ?1",
                params![normalized],
                |r| r.get::<_, String>(0),
            )
            .ok();
        if direct.is_some() {
            return Ok(direct);
        }
        let fallback = conn
            .query_row(
                "SELECT thinking_disable_strategy
                 FROM model_family_preferences
                 WHERE model_family = 'default'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok();
        Ok(fallback)
    }

    fn upsert_model_family_thinking_strategy(
        &self,
        model_family: &str,
        strategy: &str,
    ) -> Result<(), String> {
        let normalized_family = normalize_model_family(model_family);
        let normalized_strategy = strategy.trim().to_ascii_lowercase();
        if normalized_family.is_empty() || normalized_strategy.is_empty() {
            return Ok(());
        }
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "sqlite conversation write lock poisoned".to_string())?;
        let conn = self.open_connection()?;
        conn.execute(
            "INSERT INTO model_family_preferences (model_family, thinking_disable_strategy, updated_at_ms)
             VALUES (?1, ?2, strftime('%s','now') * 1000)
             ON CONFLICT(model_family) DO UPDATE SET
                 thinking_disable_strategy = excluded.thinking_disable_strategy,
                 updated_at_ms = excluded.updated_at_ms",
            params![normalized_family, normalized_strategy],
        )
        .map_err(|e| format!("failed upserting model family strategy: {e}"))?;
        Ok(())
    }

    fn delete_conversation(&self, conversation_id: &str) -> Result<bool, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "sqlite conversation write lock poisoned".to_string())?;
        let mut conn = self.open_connection()?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("failed starting sqlite delete transaction: {e}"))?;
        let removed_messages = tx
            .execute(
                "DELETE FROM conversation_messages WHERE conversation_id = ?1",
                params![conversation_id],
            )
            .map_err(|e| format!("failed deleting conversation messages: {e}"))?;
        let removed_metadata = tx
            .execute(
                "DELETE FROM conversation_metadata WHERE conversation_id = ?1",
                params![conversation_id],
            )
            .map_err(|e| format!("failed deleting conversation metadata: {e}"))?;
        tx.commit()
            .map_err(|e| format!("failed committing sqlite delete transaction: {e}"))?;
        Ok((removed_messages + removed_metadata) > 0)
    }
}

pub struct FileConversationRepository {
    path: PathBuf,
    write_lock: Mutex<()>,
}

impl FileConversationRepository {
    pub fn new(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed creating conversation dir: {e}"))?;
        }

        if !path.exists() {
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .map_err(|e| format!("failed creating conversation log: {e}"))?;
        }

        Ok(Self {
            path,
            write_lock: Mutex::new(()),
        })
    }

    pub fn default_path() -> PathBuf {
        if let Ok(raw) = std::env::var("FOUNDATION_CONVERSATION_LOG_PATH") {
            return PathBuf::from(raw);
        }
        std::env::temp_dir()
            .join("refactor-ai-foundation")
            .join("conversations.jsonl")
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl ConversationRepository for FileConversationRepository {
    fn append_message(&self, message: &ConversationMessageRecord) -> Result<(), String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "conversation write lock poisoned".to_string())?;

        let mut file = OpenOptions::new()
            .append(true)
            .open(&self.path)
            .map_err(|e| format!("failed opening conversation log for append: {e}"))?;

        let line = serde_json::to_string(message)
            .map_err(|e| format!("failed serializing conversation record: {e}"))?;
        file.write_all(line.as_bytes())
            .map_err(|e| format!("failed writing conversation record: {e}"))?;
        file.write_all(b"\n")
            .map_err(|e| format!("failed writing conversation newline: {e}"))?;

        Ok(())
    }

    fn list_messages(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<ConversationMessageRecord>, String> {
        let file = OpenOptions::new()
            .read(true)
            .open(&self.path)
            .map_err(|e| format!("failed opening conversation log for read: {e}"))?;

        let mut out = Vec::new();
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = line.map_err(|e| format!("failed reading conversation line: {e}"))?;
            if line.trim().is_empty() {
                continue;
            }
            let mut stream = Deserializer::from_str(&line).into_iter::<ConversationMessageRecord>();
            let record = match stream.next() {
                Some(Ok(value)) => value,
                Some(Err(e)) => return Err(format!("failed parsing conversation record: {e}")),
                None => continue,
            };

            if record.conversation_id == conversation_id {
                out.push(record);
            }
        }

        out.sort_by_key(|m| m.timestamp_ms);
        Ok(out)
    }

    fn list_conversations(&self) -> Result<Vec<ConversationSummaryRecord>, String> {
        let file = OpenOptions::new()
            .read(true)
            .open(&self.path)
            .map_err(|e| format!("failed opening conversation log for read: {e}"))?;

        let mut by_conversation: HashMap<String, ConversationSummaryRecord> = HashMap::new();
        let reader = BufReader::new(file);
        for line in reader.lines() {
            let line = line.map_err(|e| format!("failed reading conversation line: {e}"))?;
            if line.trim().is_empty() {
                continue;
            }
            let mut stream = Deserializer::from_str(&line).into_iter::<ConversationMessageRecord>();
            let record = match stream.next() {
                Some(Ok(value)) => value,
                Some(Err(e)) => return Err(format!("failed parsing conversation record: {e}")),
                None => continue,
            };

            let summary = by_conversation
                .entry(record.conversation_id.clone())
                .or_insert_with(|| ConversationSummaryRecord {
                    conversation_id: record.conversation_id.clone(),
                    title: String::new(),
                    message_count: 0,
                    last_message_preview: String::new(),
                    updated_at_ms: 0,
                });
            summary.message_count += 1;
            if record.timestamp_ms >= summary.updated_at_ms {
                summary.updated_at_ms = record.timestamp_ms;
                summary.last_message_preview = truncate_preview(&record.content, 72);
            }
        }

        let mut out: Vec<ConversationSummaryRecord> = by_conversation.into_values().collect();
        out.retain(|item| item.message_count >= 3);
        out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
        Ok(out)
    }

    fn conversation_message_count(&self, conversation_id: &str) -> Result<usize, String> {
        Ok(self.list_messages(conversation_id)?.len())
    }

    fn get_conversation_title(&self, _conversation_id: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn upsert_conversation_title(
        &self,
        _conversation_id: &str,
        _title: &str,
    ) -> Result<(), String> {
        Ok(())
    }

    fn get_model_family_thinking_strategy(&self, _model_family: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn upsert_model_family_thinking_strategy(
        &self,
        _model_family: &str,
        _strategy: &str,
    ) -> Result<(), String> {
        Ok(())
    }

    fn delete_conversation(&self, conversation_id: &str) -> Result<bool, String> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| "conversation write lock poisoned".to_string())?;
        let file = OpenOptions::new()
            .read(true)
            .open(&self.path)
            .map_err(|e| format!("failed opening conversation log for delete: {e}"))?;

        let reader = BufReader::new(file);
        let mut kept_lines: Vec<String> = Vec::new();
        let mut removed_any = false;
        for line in reader.lines() {
            let line = line.map_err(|e| format!("failed reading conversation line: {e}"))?;
            if line.trim().is_empty() {
                continue;
            }
            let mut stream = Deserializer::from_str(&line).into_iter::<ConversationMessageRecord>();
            let record = match stream.next() {
                Some(Ok(value)) => value,
                Some(Err(e)) => return Err(format!("failed parsing conversation record: {e}")),
                None => continue,
            };
            if record.conversation_id == conversation_id {
                removed_any = true;
                continue;
            }
            kept_lines.push(line);
        }

        let mut file = OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&self.path)
            .map_err(|e| format!("failed opening conversation log for rewrite: {e}"))?;
        for line in kept_lines {
            file.write_all(line.as_bytes())
                .map_err(|e| format!("failed rewriting conversation line: {e}"))?;
            file.write_all(b"\n")
                .map_err(|e| format!("failed rewriting conversation newline: {e}"))?;
        }
        Ok(removed_any)
    }
}

fn truncate_preview(input: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (idx, ch) in input.chars().enumerate() {
        if idx >= max_chars {
            out.push_str("...");
            return out;
        }
        out.push(ch);
    }
    out
}

fn role_to_str(role: &MessageRole) -> &'static str {
    match role {
        MessageRole::User => "user",
        MessageRole::Assistant => "assistant",
    }
}

fn role_from_str(raw: &str) -> Result<MessageRole, ()> {
    match raw {
        "user" => Ok(MessageRole::User),
        "assistant" => Ok(MessageRole::Assistant),
        _ => Err(()),
    }
}

fn seed_model_family_preferences(conn: &Connection) -> Result<(), rusqlite::Error> {
    for (family, strategy) in [
        ("default", "both"),
        ("qwen", "chat_template"),
        ("deepseek", "chat_template"),
        ("llama", "system_prompt"),
        ("mistral", "system_prompt"),
        ("gemma", "system_prompt"),
        ("phi", "system_prompt"),
    ] {
        conn.execute(
            "INSERT OR IGNORE INTO model_family_preferences (model_family, thinking_disable_strategy, updated_at_ms)
             VALUES (?1, ?2, strftime('%s','now') * 1000)",
            params![family, strategy],
        )?;
    }
    Ok(())
}

fn normalize_model_family(input: &str) -> String {
    input.trim().to_ascii_lowercase()
}
