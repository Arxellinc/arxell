use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::config::Config;
use crate::types::{ContentPart, Message, StopReason, UserContent};
use crate::{KonError, KonResult};

pub const CURRENT_VERSION: i64 = 1;

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHeader {
    #[serde(rename = "type")]
    pub kind: String,
    pub version: i64,
    pub id: String,
    pub timestamp: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryBase {
    pub id: String,
    pub parent_id: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionEntry {
    Message {
        id: String,
        parent_id: Option<String>,
        timestamp: String,
        message: Message,
    },
    ThinkingLevelChange {
        id: String,
        parent_id: Option<String>,
        timestamp: String,
        thinking_level: String,
    },
    ModelChange {
        id: String,
        parent_id: Option<String>,
        timestamp: String,
        provider: String,
        model_id: String,
        base_url: Option<String>,
    },
    Compaction {
        id: String,
        parent_id: Option<String>,
        timestamp: String,
        summary: String,
        first_kept_entry_id: String,
        tokens_before: i64,
        details: Option<serde_json::Value>,
    },
    CustomMessage {
        id: String,
        parent_id: Option<String>,
        timestamp: String,
        custom_type: String,
        content: String,
        display: bool,
        details: Option<serde_json::Value>,
    },
    SessionInfo {
        id: String,
        parent_id: Option<String>,
        timestamp: String,
        name: Option<String>,
    },
}

#[derive(Debug, Clone)]
pub struct Session {
    pub id: String,
    pub cwd: String,
    pub session_file: Option<PathBuf>,
    persist: bool,
    pub header: Option<SessionHeader>,
    pub entries: Vec<SessionEntry>,
    by_id: HashMap<String, usize>,
    pub leaf_id: Option<String>,
    initial_provider: Option<String>,
    initial_model_id: Option<String>,
    initial_thinking_level: String,
    flushed: bool,
}

impl Session {
    pub fn generate_id() -> String {
        Uuid::new_v4().to_string()
    }

    pub fn get_sessions_dir(cwd: &str) -> PathBuf {
        let safe = cwd
            .replace('/', "-")
            .replace('\\', "-")
            .trim_matches('-')
            .to_string();
        let dir = Config::config_dir().join("sessions").join(safe);
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    pub fn create(
        cwd: String,
        persist: bool,
        provider: Option<String>,
        model_id: Option<String>,
        thinking_level: String,
    ) -> KonResult<Self> {
        let session_id = Self::generate_id();
        let timestamp = now_iso();

        let mut s = Self {
            id: session_id.clone(),
            cwd: cwd.clone(),
            session_file: None,
            persist,
            header: Some(SessionHeader {
                kind: "header".to_string(),
                version: CURRENT_VERSION,
                id: session_id.clone(),
                timestamp: timestamp.clone(),
                cwd: cwd.clone(),
            }),
            entries: Vec::new(),
            by_id: HashMap::new(),
            leaf_id: None,
            initial_provider: provider,
            initial_model_id: model_id,
            initial_thinking_level: thinking_level,
            flushed: false,
        };

        if persist {
            let dt = DateTime::parse_from_rfc3339(&timestamp)
                .map_err(|e| KonError::InvalidArgument(e.to_string()))?;
            let file_ts = dt.format("%Y-%m-%dT%H-%M-%S").to_string();
            s.session_file =
                Some(Self::get_sessions_dir(&cwd).join(format!("{}_{}.jsonl", file_ts, s.id)));
        }

        Ok(s)
    }

    pub fn in_memory(
        cwd: String,
        provider: Option<String>,
        model_id: Option<String>,
        thinking_level: String,
    ) -> Self {
        Self::create(cwd, false, provider, model_id, thinking_level).expect("session")
    }

    fn generate_entry_id(&self) -> String {
        Uuid::new_v4().to_string()[..8].to_string()
    }

    fn append_entry(&mut self, entry: SessionEntry) -> KonResult<String> {
        let id = match &entry {
            SessionEntry::Message { id, .. }
            | SessionEntry::ThinkingLevelChange { id, .. }
            | SessionEntry::ModelChange { id, .. }
            | SessionEntry::Compaction { id, .. }
            | SessionEntry::CustomMessage { id, .. }
            | SessionEntry::SessionInfo { id, .. } => id.clone(),
        };
        self.by_id.insert(id.clone(), self.entries.len());
        self.entries.push(entry);
        self.leaf_id = Some(id.clone());
        self.persist_entry()?;
        Ok(id)
    }

    fn persist_entry(&mut self) -> KonResult<()> {
        if !self.persist {
            return Ok(());
        }
        let has_assistant = self.entries.iter().any(|e| {
            matches!(
                e,
                SessionEntry::Message {
                    message: Message::Assistant { .. },
                    ..
                }
            )
        });
        if !has_assistant {
            return Ok(());
        }

        if !self.flushed {
            self.write_all()?;
            self.flushed = true;
        } else if let Some(path) = &self.session_file {
            if let Some(last) = self.entries.last() {
                let mut f = std::fs::OpenOptions::new()
                    .append(true)
                    .create(true)
                    .open(path)?;
                use std::io::Write;
                writeln!(f, "{}", serde_json::to_string(last)?)?;
            }
        }
        Ok(())
    }

    fn write_all(&self) -> KonResult<()> {
        if let Some(path) = &self.session_file {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut f = std::fs::File::create(path)?;
            use std::io::Write;
            if let Some(header) = &self.header {
                writeln!(f, "{}", serde_json::to_string(header)?)?;
            }
            for e in &self.entries {
                writeln!(f, "{}", serde_json::to_string(e)?)?;
            }
        }
        Ok(())
    }

    pub fn append_message(&mut self, message: Message) -> KonResult<String> {
        self.append_entry(SessionEntry::Message {
            id: self.generate_entry_id(),
            parent_id: self.leaf_id.clone(),
            timestamp: now_iso(),
            message,
        })
    }

    pub fn append_model_change(
        &mut self,
        provider: String,
        model_id: String,
        base_url: Option<String>,
    ) -> KonResult<String> {
        self.append_entry(SessionEntry::ModelChange {
            id: self.generate_entry_id(),
            parent_id: self.leaf_id.clone(),
            timestamp: now_iso(),
            provider,
            model_id,
            base_url,
        })
    }

    pub fn append_thinking_level_change(&mut self, thinking_level: String) -> KonResult<String> {
        self.append_entry(SessionEntry::ThinkingLevelChange {
            id: self.generate_entry_id(),
            parent_id: self.leaf_id.clone(),
            timestamp: now_iso(),
            thinking_level,
        })
    }

    pub fn append_compaction(
        &mut self,
        summary: String,
        first_kept_entry_id: String,
        tokens_before: i64,
        details: Option<serde_json::Value>,
    ) -> KonResult<String> {
        self.append_entry(SessionEntry::Compaction {
            id: self.generate_entry_id(),
            parent_id: self.leaf_id.clone(),
            timestamp: now_iso(),
            summary,
            first_kept_entry_id,
            tokens_before,
            details,
        })
    }

    pub fn messages(&self) -> Vec<Message> {
        let last_compaction = self.entries.iter().rev().find_map(|e| {
            if let SessionEntry::Compaction { summary, id, .. } = e {
                Some((id.clone(), summary.clone()))
            } else {
                None
            }
        });

        if last_compaction.is_none() {
            return self
                .entries
                .iter()
                .filter_map(|e| match e {
                    SessionEntry::Message { message, .. } => Some(message.clone()),
                    _ => None,
                })
                .collect();
        }

        let (compaction_id, summary) = last_compaction.expect("checked");
        let mut out = vec![
            Message::User {
                content: UserContent::Text("What did we do so far?".to_string()),
            },
            Message::Assistant {
                content: vec![ContentPart::Text { text: summary }],
                usage: None,
                stop_reason: Some(StopReason::Stop),
            },
        ];

        let mut past = false;
        for e in &self.entries {
            match e {
                SessionEntry::Compaction { id, .. } if *id == compaction_id => {
                    past = true;
                }
                SessionEntry::Message { message, .. } if past => out.push(message.clone()),
                _ => {}
            }
        }

        out
    }

    pub fn all_messages(&self) -> Vec<Message> {
        self.entries
            .iter()
            .filter_map(|e| match e {
                SessionEntry::Message { message, .. } => Some(message.clone()),
                _ => None,
            })
            .collect()
    }

    pub fn load(path: impl AsRef<Path>) -> KonResult<Self> {
        let path = path.as_ref();
        let txt = std::fs::read_to_string(path)?;
        let mut header: Option<SessionHeader> = None;
        let mut entries = Vec::new();

        for line in txt.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let v: serde_json::Value = serde_json::from_str(line)?;
            let kind = v.get("type").and_then(|x| x.as_str()).unwrap_or_default();
            if kind == "header" {
                header = Some(serde_json::from_value(v)?);
                continue;
            }
            if let Ok(e) = serde_json::from_value::<SessionEntry>(v) {
                entries.push(e);
            }
        }

        let header = header.ok_or_else(|| {
            KonError::InvalidArgument(format!("invalid session file: {}", path.display()))
        })?;

        let mut s = Self {
            id: header.id.clone(),
            cwd: header.cwd.clone(),
            session_file: Some(path.to_path_buf()),
            persist: true,
            header: Some(header),
            entries,
            by_id: HashMap::new(),
            leaf_id: None,
            initial_provider: None,
            initial_model_id: None,
            initial_thinking_level: "medium".to_string(),
            flushed: true,
        };

        for (i, e) in s.entries.iter().enumerate() {
            let id = match e {
                SessionEntry::Message { id, .. }
                | SessionEntry::ThinkingLevelChange { id, .. }
                | SessionEntry::ModelChange { id, .. }
                | SessionEntry::Compaction { id, .. }
                | SessionEntry::CustomMessage { id, .. }
                | SessionEntry::SessionInfo { id, .. } => id,
            };
            s.by_id.insert(id.clone(), i);
            s.leaf_id = Some(id.clone());
        }

        Ok(s)
    }

    pub fn continue_recent(cwd: &str) -> KonResult<Self> {
        let dir = Self::get_sessions_dir(cwd);
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("jsonl"))
            .collect();
        if files.is_empty() {
            return Self::create(cwd.to_string(), true, None, None, "medium".to_string());
        }
        files.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
        let last = files.pop().expect("non-empty");
        Self::load(last)
    }

    pub fn model(&self) -> Option<(String, String, Option<String>)> {
        for e in self.entries.iter().rev() {
            if let SessionEntry::ModelChange {
                provider,
                model_id,
                base_url,
                ..
            } = e
            {
                return Some((provider.clone(), model_id.clone(), base_url.clone()));
            }
        }
        if let (Some(p), Some(m)) = (&self.initial_provider, &self.initial_model_id) {
            return Some((p.clone(), m.clone(), None));
        }
        None
    }

    pub fn thinking_level(&self) -> String {
        for e in self.entries.iter().rev() {
            if let SessionEntry::ThinkingLevelChange { thinking_level, .. } = e {
                return thinking_level.clone();
            }
        }
        self.initial_thinking_level.clone()
    }

    pub fn set_model(
        &mut self,
        provider: String,
        model_id: String,
        base_url: Option<String>,
    ) -> KonResult<()> {
        if self
            .model()
            .as_ref()
            .map(|m| m.0 == provider && m.1 == model_id && m.2 == base_url)
            .unwrap_or(false)
        {
            return Ok(());
        }
        let _ = self.append_model_change(provider, model_id, base_url)?;
        Ok(())
    }

    pub fn set_thinking_level(&mut self, thinking_level: String) -> KonResult<()> {
        if self.thinking_level() == thinking_level {
            return Ok(());
        }
        let _ = self.append_thinking_level_change(thinking_level)?;
        Ok(())
    }
}
