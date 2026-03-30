//! STT event payload types for Tauri event system.
//! These types are used for communication between the Rust backend and React frontend.

use serde::{Deserialize, Serialize};

/// Payload emitted when a transcription is complete.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TranscriptPayload {
    /// The transcribed text.
    pub text: String,
    /// Whether this is a final transcript (always true for current implementation).
    pub is_final: bool,
    /// Unique identifier for this utterance (UUID v4).
    pub utterance_id: String,
}

/// Payload emitted when VAD state changes.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VADPayload {
    /// Whether speech is currently detected.
    pub is_speaking: bool,
}

/// Payload emitted to report STT status.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct STTStatusPayload {
    /// Current status: "starting" | "running" | "stopped" | "error"
    pub status: String,
    /// Optional error message when status is "error".
    pub message: Option<String>,
}

/// Payload emitted for pipeline-level errors.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PipelineErrorPayload {
    /// Error source: "stt" | "llm" | "tts"
    pub source: String,
    /// Human-readable error message.
    pub message: String,
    /// Optional details for debugging.
    pub details: Option<String>,
}
