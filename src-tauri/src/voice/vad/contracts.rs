use crate::voice::audio_bus::AudioFrame;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Stable boundary between voice orchestration and concrete VAD methods.
/// Strategy implementations must keep all method-specific config and runtime
/// state inside their own modules.
pub trait VadStrategy: Send {
    fn id(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn manifest(&self) -> VadManifest;
    fn capability_flags(&self) -> VadCapabilities;
    fn start_session(&mut self, config: VadConfig) -> Result<(), VadError>;
    fn process_frame(&mut self, frame: AudioFrame) -> Result<Vec<VadEvent>, VadError>;
    fn flush(&mut self) -> Result<Vec<VadEvent>, VadError>;
    fn reset(&mut self) -> Result<(), VadError>;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VadStatus {
    Stable,
    Experimental,
    Hidden,
    Deprecated,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VadCapabilities {
    pub supports_endpointing: bool,
    pub supports_interruption_signals: bool,
    pub supports_micro_turns: bool,
    pub supports_overlap_turn_yield_hints: bool,
    pub supports_speech_probability: bool,
    pub supports_partial_segmentation: bool,
    pub supports_live_handoff: bool,
    pub supports_speculative_onset: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VadManifest {
    pub id: String,
    pub display_name: String,
    pub status: VadStatus,
    pub description: String,
    pub capabilities: VadCapabilities,
    pub default_config: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VadConfig {
    pub method_id: String,
    pub version: u32,
    pub settings: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SegmentCloseReason {
    Silence,
    MaxLength,
    Flush,
    Reset,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum VadEvent {
    SpeechStart,
    SpeechEnd,
    SpeechProbability {
        value: f32,
    },
    SegmentOpened {
        segment_id: String,
    },
    SegmentExtended {
        segment_id: String,
    },
    SegmentClosed {
        segment_id: String,
        reason: SegmentCloseReason,
    },
    MicroTurnReady {
        segment_id: String,
        start_ms: u64,
        end_ms: u64,
    },
    InterruptionDetected {
        confidence: f32,
    },
    OverlapDetected {
        confidence: f32,
        duration_ms: u32,
    },
    TurnYieldLikely {
        confidence: f32,
    },
    StateChanged {
        from: String,
        to: String,
    },
    DebugMarker {
        label: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "message", rename_all = "camelCase")]
pub enum VadError {
    UnknownMethod(String),
    InvalidConfig(String),
    Runtime(String),
}

impl std::fmt::Display for VadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownMethod(message)
            | Self::InvalidConfig(message)
            | Self::Runtime(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for VadError {}
