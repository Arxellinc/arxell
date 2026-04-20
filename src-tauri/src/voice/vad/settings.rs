use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const ENERGY_BASIC_ID: &str = "energy-basic";
pub const SHERPA_SILERO_ID: &str = "sherpa-silero";
pub const MICROTURN_V1_ID: &str = "microturn-v1";
pub const HYBRID_INTERRUPT_ID: &str = "hybrid_interrupt";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnergyBasicConfig {
    pub threshold: f32,
    pub min_speech_ms: u32,
    pub min_silence_ms: u32,
    pub hangover_ms: u32,
}

impl Default for EnergyBasicConfig {
    fn default() -> Self {
        Self {
            threshold: 0.0012,
            min_speech_ms: 120,
            min_silence_ms: 240,
            hangover_ms: 80,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SherpaSileroConfig {
    pub base_threshold: f32,
    pub start_frames: u32,
    pub end_frames: u32,
    pub dynamic_multiplier: f32,
    pub noise_adaptation_alpha: f32,
    pub pre_speech_ms: u32,
    pub min_utterance_ms: u32,
    pub max_utterance_s: u32,
    pub force_flush_s: f32,
}

impl Default for SherpaSileroConfig {
    fn default() -> Self {
        Self {
            base_threshold: 0.0012,
            start_frames: 2,
            end_frames: 8,
            dynamic_multiplier: 2.4,
            noise_adaptation_alpha: 0.03,
            pre_speech_ms: 200,
            min_utterance_ms: 200,
            max_utterance_s: 30,
            force_flush_s: 3.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MicroturnV1Config {
    pub threshold: f32,
    pub microturn_window_ms: u32,
    pub min_speech_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HybridInterruptConfig {
    pub interrupt_threshold: f32,
    pub min_overlap_ms: u32,
    pub cancel_tts_on_interrupt: bool,
    pub resume_after_false_interrupt: bool,
    pub yield_bias: f32,
    pub assistant_speaking_sensitivity: f32,
}

impl Default for HybridInterruptConfig {
    fn default() -> Self {
        Self {
            interrupt_threshold: 0.0018,
            min_overlap_ms: 120,
            cancel_tts_on_interrupt: true,
            resume_after_false_interrupt: true,
            yield_bias: 0.45,
            assistant_speaking_sensitivity: 0.65,
        }
    }
}

impl Default for MicroturnV1Config {
    fn default() -> Self {
        Self {
            threshold: 0.0012,
            microturn_window_ms: 700,
            min_speech_ms: 120,
        }
    }
}

pub fn default_config_for(method_id: &str) -> Value {
    match method_id {
        ENERGY_BASIC_ID => {
            serde_json::to_value(EnergyBasicConfig::default()).unwrap_or_else(|_| json!({}))
        }
        SHERPA_SILERO_ID => {
            serde_json::to_value(SherpaSileroConfig::default()).unwrap_or_else(|_| json!({}))
        }
        MICROTURN_V1_ID => {
            serde_json::to_value(MicroturnV1Config::default()).unwrap_or_else(|_| json!({}))
        }
        HYBRID_INTERRUPT_ID => {
            serde_json::to_value(HybridInterruptConfig::default()).unwrap_or_else(|_| json!({}))
        }
        _ => json!({}),
    }
}
