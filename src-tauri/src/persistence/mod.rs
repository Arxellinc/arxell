use crate::contracts::{ConversationMessageRecord, ConversationSummaryRecord};
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
        out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
        Ok(out)
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
