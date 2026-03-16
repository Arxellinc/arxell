use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::{KonError, KonResult};

pub const CONFIG_DIR_NAME: &str = ".kon";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub llm: LlmConfig,
    pub compaction: CompactionConfig,
    pub agent: AgentRuntimeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub default_provider: String,
    pub default_model: String,
    pub default_base_url: String,
    pub default_thinking_level: String,
    pub tool_call_idle_timeout_seconds: f64,
    pub system_prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompactionConfig {
    pub on_overflow: String,
    pub buffer_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRuntimeConfig {
    pub max_turns: i64,
    pub default_context_window: i64,
}

const DEFAULT_CONFIG: &str = r#"
[llm]
default_provider = "openai-compatible"
default_model = "gpt-4.1"
default_base_url = "http://127.0.0.1:8765"
default_thinking_level = "medium"
tool_call_idle_timeout_seconds = 120
system_prompt = "You are an expert coding assistant. Be concise and accurate."

[compaction]
on_overflow = "continue"
buffer_tokens = 20000

[agent]
max_turns = 500
default_context_window = 200000
"#;

impl Default for Config {
    fn default() -> Self {
        toml::from_str(DEFAULT_CONFIG).expect("valid built-in config")
    }
}

impl Config {
    pub fn config_dir() -> PathBuf {
        dirs_home().join(CONFIG_DIR_NAME)
    }

    pub fn config_file() -> PathBuf {
        Self::config_dir().join("config.toml")
    }

    pub fn load() -> KonResult<Self> {
        let path = Self::config_file();
        if !path.exists() {
            std::fs::create_dir_all(Self::config_dir())?;
            std::fs::write(&path, DEFAULT_CONFIG)?;
            return Ok(Self::default());
        }
        let txt = std::fs::read_to_string(&path)?;
        match toml::from_str::<Self>(&txt) {
            Ok(v) => Ok(v),
            Err(_) => Ok(Self::default()),
        }
    }

    pub fn validate(&self) -> KonResult<()> {
        if self.agent.max_turns <= 0 {
            return Err(KonError::InvalidArgument("agent.max_turns must be > 0".to_string()));
        }
        Ok(())
    }
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}
