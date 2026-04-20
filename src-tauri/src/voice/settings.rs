use crate::voice::handoff::contracts::HandoffSafePoint;
use crate::voice::vad::settings::{default_config_for, HYBRID_INTERRUPT_ID, SHERPA_SILERO_ID};
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
    #[serde(default = "default_voice_settings_version")]
    pub version: u32,
    pub selected_vad_method: String,
    #[serde(default)]
    pub shadow_vad_method: Option<String>,
    #[serde(default)]
    pub duplex_mode: DuplexMode,
    #[serde(default)]
    pub handoff_policy: HandoffPolicy,
    pub global_voice_config: GlobalVoiceConfig,
    #[serde(default)]
    pub vad_methods: HashMap<String, Value>,
    #[serde(default)]
    pub speculation: SpeculationConfig,
}

impl Default for PersistedVoiceSettings {
    fn default() -> Self {
        let selected = SHERPA_SILERO_ID.to_string();
        let mut vad_methods = HashMap::new();
        vad_methods.insert(selected.clone(), default_config_for(SHERPA_SILERO_ID));
        vad_methods.insert(
            HYBRID_INTERRUPT_ID.to_string(),
            default_config_for(HYBRID_INTERRUPT_ID),
        );
        Self {
            version: 2,
            selected_vad_method: selected,
            shadow_vad_method: None,
            duplex_mode: DuplexMode::SingleTurn,
            handoff_policy: HandoffPolicy::default(),
            global_voice_config: GlobalVoiceConfig::default(),
            vad_methods,
            speculation: SpeculationConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplexMode {
    SingleTurn,
    FullDuplexSpeculative,
    FullDuplexShadowOnly,
}

impl Default for DuplexMode {
    fn default() -> Self {
        Self::SingleTurn
    }
}

fn default_voice_settings_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffPolicy {
    pub enabled: bool,
    pub safe_point: HandoffSafePoint,
}

impl Default for HandoffPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            safe_point: HandoffSafePoint::SegmentBoundary,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeculationConfig {
    pub enabled: bool,
    pub max_prefix_ms: u32,
    pub cancel_on_user_continuation: bool,
}

impl Default for SpeculationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            max_prefix_ms: 800,
            cancel_on_user_continuation: true,
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
        let mut settings = serde_json::from_str::<PersistedVoiceSettings>(&raw).unwrap_or_default();
        if settings.version < 2 {
            settings.version = 2;
            settings.duplex_mode = DuplexMode::SingleTurn;
            settings.handoff_policy = HandoffPolicy::default();
            settings.speculation = SpeculationConfig::default();
        }
        settings
            .vad_methods
            .entry(settings.selected_vad_method.clone())
            .or_insert_with(|| default_config_for(&settings.selected_vad_method));
        settings
            .vad_methods
            .entry(HYBRID_INTERRUPT_ID.to_string())
            .or_insert_with(|| default_config_for(HYBRID_INTERRUPT_ID));
        settings
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
