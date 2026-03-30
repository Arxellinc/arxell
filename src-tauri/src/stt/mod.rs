//! STT module - Speech-to-Text functionality using whisper.cpp
//!
//! This module provides:
//! - WhisperSupervisor for managing the whisper.cpp child process
//! - WhisperClient for HTTP communication with the whisper server
//! - Tauri commands for start, stop, transcribe, and status

#[cfg(feature = "tauri-runtime")]
pub mod client;
#[cfg(feature = "tauri-runtime")]
pub mod events;
#[cfg(feature = "tauri-runtime")]
pub mod supervisor;

use std::sync::Arc;
use tokio::sync::Mutex;

/// Managed state for the STT system
#[cfg(feature = "tauri-runtime")]
pub struct STTState {
    pub supervisor: Arc<Mutex<supervisor::WhisperSupervisor>>,
}

#[cfg(not(feature = "tauri-runtime"))]
pub struct STTState {
    pub supervisor: Arc<Mutex<()>>,
}

impl STTState {
    pub fn new() -> Self {
        #[cfg(feature = "tauri-runtime")]
        {
            Self {
                supervisor: Arc::new(Mutex::new(supervisor::WhisperSupervisor::new())),
            }
        }
        #[cfg(not(feature = "tauri-runtime"))]
        {
            Self {
                supervisor: Arc::new(Mutex::new(())),
            }
        }
    }
}

impl Default for STTState {
    fn default() -> Self {
        Self::new()
    }
}

/// Start the STT service (whisper.cpp server)
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn start_stt(
    app: tauri::AppHandle,
    state: tauri::State<'_, STTState>,
) -> Result<(), String> {
    use log::info;
    use tauri::Emitter;

    info!("Starting STT service");
    let supervisor = state.supervisor.lock().await;
    supervisor.start(&app).await
}

/// Stop the STT service (whisper.cpp server)
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stop_stt(state: tauri::State<'_, STTState>) -> Result<(), String> {
    use log::info;

    info!("Stopping STT service");
    let supervisor = state.supervisor.lock().await;
    supervisor.stop().await
}

/// Transcribe a chunk of PCM audio
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn transcribe_chunk(
    app: tauri::AppHandle,
    state: tauri::State<'_, STTState>,
    pcm_samples: Vec<f32>,
    utterance_id: String,
) -> Result<(), String> {
    use log::{error, info};
    use tauri::Emitter;

    info!(
        "Received transcription request: {} samples, utterance_id: {}",
        pcm_samples.len(),
        utterance_id
    );

    let supervisor = state.supervisor.lock().await;

    // Get endpoint
    let endpoint = match supervisor.endpoint().await {
        Some(e) => {
            info!("STT endpoint: {}", e);
            e
        }
        None => {
            let err = "STT service not running".to_string();
            let _ = app.emit(
                "pipeline://error",
                events::PipelineErrorPayload {
                    source: "stt".to_string(),
                    message: err.clone(),
                    details: None,
                },
            );
            return Err(err);
        }
    };

    // Extract port from endpoint
    let port = endpoint
        .strip_prefix("http://127.0.0.1:")
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| "Invalid endpoint".to_string())?;

    info!(
        "Calling whisper server at port {} with {} samples",
        port,
        pcm_samples.len()
    );

    // Create client and run inference
    let client = client::WhisperClient::new(port);
    match client.transcribe(&pcm_samples).await {
        Ok(transcript) => {
            info!("Transcription complete: {} chars", transcript.len());

            // Emit transcript event
            let _ = app.emit(
                "stt://transcript",
                events::TranscriptPayload {
                    text: transcript,
                    is_final: true,
                    utterance_id,
                },
            );

            Ok(())
        }
        Err(e) => {
            error!("Transcription failed: {}", e);

            // Emit error event but don't restart - transient errors don't need restart
            let _ = app.emit(
                "pipeline://error",
                events::PipelineErrorPayload {
                    source: "stt".to_string(),
                    message: format!("Transcription failed: {}", e),
                    details: None,
                },
            );

            // Return Ok since error was emitted via event
            Ok(())
        }
    }
}

/// Get the current STT status
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn stt_status(
    state: tauri::State<'_, STTState>,
) -> Result<events::STTStatusPayload, String> {
    let supervisor = state.supervisor.lock().await;
    let status = supervisor.status().await;

    match status {
        supervisor::SupervisorStatus::Starting => Ok(events::STTStatusPayload {
            status: "starting".to_string(),
            message: None,
        }),
        supervisor::SupervisorStatus::Running => Ok(events::STTStatusPayload {
            status: "running".to_string(),
            message: None,
        }),
        supervisor::SupervisorStatus::Stopped => Ok(events::STTStatusPayload {
            status: "stopped".to_string(),
            message: None,
        }),
        supervisor::SupervisorStatus::Error(msg) => Ok(events::STTStatusPayload {
            status: "error".to_string(),
            message: Some(msg),
        }),
    }
}

/// Generate a new UUID for an utterance
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub fn generate_utterance_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Update VAD status
#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn update_vad_status(app: tauri::AppHandle, is_speaking: bool) -> Result<(), String> {
    use tauri::Emitter;
    let _ = app.emit("stt://vad", events::VADPayload { is_speaking });
    Ok(())
}
