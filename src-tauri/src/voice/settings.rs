use crate::voice::vad::settings::{default_config_for, SHERPA_SILERO_ID};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalVoiceConfig {
    pub sample_rate_hz: u32,
}

impl Default for GlobalVoiceConfig {
    fn default() -> Self {
        Self {
            sample_rate_hz: 16_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedVoiceSettings {
    pub version: u32,
    pub selected_vad_method: String,
    pub global_voice_config: GlobalVoiceConfig,
    pub vad_methods: HashMap<String, Value>,
}

impl Default for PersistedVoiceSettings {
    fn default() -> Self {
        let selected = SHERPA_SILERO_ID.to_string();
        let mut vad_methods = HashMap::new();
        vad_methods.insert(selected.clone(), default_config_for(SHERPA_SILERO_ID));
        Self {
            version: 1,
            selected_vad_method: selected,
            global_voice_config: GlobalVoiceConfig::default(),
            vad_methods,
        }
    }
}

#[derive(Debug, Clone)]
pub struct VoiceSettingsStore {
    path: PathBuf,
}

impl VoiceSettingsStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn default_path() -> PathBuf {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".arx")
            .join("voice-settings.json")
    }

    pub fn load(&self) -> PersistedVoiceSettings {
        let Ok(raw) = fs::read_to_string(&self.path) else {
            return PersistedVoiceSettings::default();
        };
        serde_json::from_str::<PersistedVoiceSettings>(&raw).unwrap_or_default()
    }

    pub fn save(&self, settings: &PersistedVoiceSettings) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                format!(
                    "failed creating voice settings dir '{}': {err}",
                    parent.display()
                )
            })?;
        }
        let payload = serde_json::to_string_pretty(settings)
            .map_err(|err| format!("failed serializing voice settings: {err}"))?;
        fs::write(&self.path, format!("{payload}\n")).map_err(|err| {
            format!(
                "failed writing voice settings '{}': {err}",
                self.path.display()
            )
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}
