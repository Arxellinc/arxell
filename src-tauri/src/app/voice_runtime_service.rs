use crate::contracts::{EventSeverity, EventStage, Subsystem};
use crate::observability::EventHub;
use crate::voice::audio_bus::AudioFrame;
use crate::voice::session::{VoiceRuntimeState, VoiceSessionId};
use crate::voice::settings::{PersistedVoiceSettings, VoiceSettingsStore};
use crate::voice::vad::contracts::{VadConfig, VadError, VadEvent, VadManifest, VadStrategy};
use crate::voice::vad::registry;
use crate::voice::vad::settings::default_config_for;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "message", rename_all = "camelCase")]
pub enum VoiceRuntimeError {
    InvalidTransition(String),
    VoiceSessionActive,
    Vad(VadError),
    Persistence(String),
}

impl std::fmt::Display for VoiceRuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidTransition(message) | Self::Persistence(message) => f.write_str(message),
            Self::VoiceSessionActive => f.write_str("voice session is active"),
            Self::Vad(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for VoiceRuntimeError {}

impl From<VadError> for VoiceRuntimeError {
    fn from(value: VadError) -> Self {
        Self::Vad(value)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRuntimeSnapshot {
    pub state: VoiceRuntimeState,
    pub session_id: Option<VoiceSessionId>,
    pub selected_vad_method: String,
}

struct VoiceRuntimeInner {
    state: VoiceRuntimeState,
    session_id: Option<VoiceSessionId>,
    settings: PersistedVoiceSettings,
    strategy: Option<Box<dyn VadStrategy>>,
}

pub struct VoiceRuntimeService {
    hub: EventHub,
    settings_store: VoiceSettingsStore,
    inner: Mutex<VoiceRuntimeInner>,
}

impl VoiceRuntimeService {
    pub fn new(hub: EventHub) -> Self {
        Self::new_with_store(
            hub,
            VoiceSettingsStore::new(VoiceSettingsStore::default_path()),
        )
    }

    pub fn new_with_store(hub: EventHub, settings_store: VoiceSettingsStore) -> Self {
        let mut settings = settings_store.load();
        if registry::validate_method(&settings.selected_vad_method).is_err() {
            settings.selected_vad_method =
                crate::voice::vad::settings::SHERPA_SILERO_ID.to_string();
        }
        Self {
            hub,
            settings_store,
            inner: Mutex::new(VoiceRuntimeInner {
                state: VoiceRuntimeState::Idle,
                session_id: None,
                settings,
                strategy: None,
            }),
        }
    }

    pub fn list_vad_methods(&self, include_experimental: bool) -> Vec<VadManifest> {
        registry::list_methods(include_experimental)
    }

    pub fn snapshot(&self) -> VoiceRuntimeSnapshot {
        let inner = self.inner.lock().expect("voice runtime lock poisoned");
        VoiceRuntimeSnapshot {
            state: inner.state,
            session_id: inner.session_id.clone(),
            selected_vad_method: inner.settings.selected_vad_method.clone(),
        }
    }

    pub fn settings(&self) -> PersistedVoiceSettings {
        self.inner
            .lock()
            .expect("voice runtime lock poisoned")
            .settings
            .clone()
    }

    pub fn set_vad_method(
        &self,
        correlation_id: &str,
        method_id: &str,
    ) -> Result<VoiceRuntimeSnapshot, VoiceRuntimeError> {
        registry::validate_method(method_id)?;
        let mut inner = self.inner.lock().expect("voice runtime lock poisoned");
        if inner.state != VoiceRuntimeState::Idle {
            drop(inner);
            self.emit(
                correlation_id,
                "voice.vad.method.change_rejected",
                EventStage::Error,
                EventSeverity::Warn,
                json!({"methodId": method_id, "reason": "voice_session_active"}),
            );
            return Err(VoiceRuntimeError::VoiceSessionActive);
        }

        inner.settings.selected_vad_method = method_id.to_string();
        inner
            .settings
            .vad_methods
            .entry(method_id.to_string())
            .or_insert_with(|| default_config_for(method_id));
        inner.strategy = None;
        self.settings_store
            .save(&inner.settings)
            .map_err(VoiceRuntimeError::Persistence)?;
        let snapshot = VoiceRuntimeSnapshot {
            state: inner.state,
            session_id: inner.session_id.clone(),
            selected_vad_method: inner.settings.selected_vad_method.clone(),
        };
        drop(inner);
        self.emit(
            correlation_id,
            "voice.vad.method.changed",
            EventStage::Complete,
            EventSeverity::Info,
            json!({"methodId": method_id}),
        );
        Ok(snapshot)
    }

    pub fn update_vad_config(
        &self,
        correlation_id: &str,
        method_id: &str,
        config: Value,
    ) -> Result<PersistedVoiceSettings, VoiceRuntimeError> {
        registry::validate_method(method_id)?;
        let mut inner = self.inner.lock().expect("voice runtime lock poisoned");
        inner
            .settings
            .vad_methods
            .insert(method_id.to_string(), config);
        self.settings_store
            .save(&inner.settings)
            .map_err(VoiceRuntimeError::Persistence)?;
        let settings = inner.settings.clone();
        drop(inner);
        self.emit(
            correlation_id,
            "voice.vad.config.updated",
            EventStage::Complete,
            EventSeverity::Info,
            json!({"methodId": method_id}),
        );
        Ok(settings)
    }

    pub fn start_session(
        &self,
        correlation_id: &str,
    ) -> Result<VoiceRuntimeSnapshot, VoiceRuntimeError> {
        let mut inner = self.inner.lock().expect("voice runtime lock poisoned");
        if inner.state != VoiceRuntimeState::Idle {
            let state = inner.state;
            drop(inner);
            self.emit_invalid_transition(correlation_id, "start_session", state);
            return Err(VoiceRuntimeError::InvalidTransition(format!(
                "start_session is invalid from {state:?}"
            )));
        }

        inner.state = VoiceRuntimeState::Starting;
        let session_id = VoiceSessionId::new();
        let method_id = inner.settings.selected_vad_method.clone();
        let config_value = inner
            .settings
            .vad_methods
            .get(&method_id)
            .cloned()
            .unwrap_or_else(|| default_config_for(&method_id));
        let mut strategy = registry::instantiate(&method_id)?;
        strategy.start_session(VadConfig {
            method_id: method_id.clone(),
            version: inner.settings.version,
            settings: config_value,
        })?;
        inner.strategy = Some(strategy);
        inner.session_id = Some(session_id.clone());
        inner.state = VoiceRuntimeState::Running;
        let snapshot = VoiceRuntimeSnapshot {
            state: inner.state,
            session_id: inner.session_id.clone(),
            selected_vad_method: method_id.clone(),
        };
        drop(inner);
        self.emit(
            correlation_id,
            "voice.vad.session.start",
            EventStage::Start,
            EventSeverity::Info,
            json!({"sessionId": session_id, "methodId": method_id}),
        );
        Ok(snapshot)
    }

    pub fn stop_session(
        &self,
        correlation_id: &str,
    ) -> Result<VoiceRuntimeSnapshot, VoiceRuntimeError> {
        let mut inner = self.inner.lock().expect("voice runtime lock poisoned");
        if inner.state != VoiceRuntimeState::Starting && inner.state != VoiceRuntimeState::Running {
            let state = inner.state;
            drop(inner);
            self.emit_invalid_transition(correlation_id, "stop_session", state);
            return Err(VoiceRuntimeError::InvalidTransition(format!(
                "stop_session is invalid from {state:?}"
            )));
        }
        inner.state = VoiceRuntimeState::Stopping;
        if let Some(strategy) = inner.strategy.as_mut() {
            let events = strategy.flush()?;
            self.emit_vad_events(correlation_id, &events);
            strategy.reset()?;
        }
        let session_id = inner.session_id.take();
        let method_id = inner.settings.selected_vad_method.clone();
        inner.strategy = None;
        inner.state = VoiceRuntimeState::Idle;
        let snapshot = VoiceRuntimeSnapshot {
            state: inner.state,
            session_id: None,
            selected_vad_method: method_id.clone(),
        };
        drop(inner);
        self.emit(
            correlation_id,
            "voice.vad.session.complete",
            EventStage::Complete,
            EventSeverity::Info,
            json!({"sessionId": session_id, "methodId": method_id}),
        );
        Ok(snapshot)
    }

    pub fn ingest_frame(
        &self,
        correlation_id: &str,
        frame: AudioFrame,
    ) -> Result<Vec<VadEvent>, VoiceRuntimeError> {
        let mut inner = self.inner.lock().expect("voice runtime lock poisoned");
        if inner.state != VoiceRuntimeState::Running {
            let state = inner.state;
            drop(inner);
            self.emit_invalid_transition(correlation_id, "ingest_frame", state);
            return Err(VoiceRuntimeError::InvalidTransition(format!(
                "ingest_frame is invalid from {state:?}"
            )));
        }
        let Some(strategy) = inner.strategy.as_mut() else {
            return Err(VoiceRuntimeError::InvalidTransition(
                "voice session has no active VAD strategy".to_string(),
            ));
        };
        let events = strategy.process_frame(frame)?;
        drop(inner);
        self.emit_vad_events(correlation_id, &events);
        Ok(events)
    }

    fn emit_invalid_transition(
        &self,
        correlation_id: &str,
        operation: &str,
        state: VoiceRuntimeState,
    ) {
        self.emit(
            correlation_id,
            "voice.vad.error",
            EventStage::Error,
            EventSeverity::Error,
            json!({"operation": operation, "state": state, "reason": "invalid_transition"}),
        );
    }

    fn emit_vad_events(&self, correlation_id: &str, events: &[VadEvent]) {
        for event in events {
            let (action, stage) = match event {
                VadEvent::SpeechStart | VadEvent::SegmentOpened { .. } => {
                    ("voice.vad.segment.start", EventStage::Start)
                }
                VadEvent::SegmentExtended { .. } | VadEvent::SpeechProbability { .. } => {
                    ("voice.vad.segment.progress", EventStage::Progress)
                }
                VadEvent::SpeechEnd | VadEvent::SegmentClosed { .. } => {
                    ("voice.vad.segment.complete", EventStage::Complete)
                }
                VadEvent::MicroTurnReady { .. } => {
                    ("voice.vad.microturn.ready", EventStage::Progress)
                }
                VadEvent::StateChanged { .. } | VadEvent::DebugMarker { .. } => {
                    ("voice.vad.debug", EventStage::Progress)
                }
            };
            self.emit(
                correlation_id,
                action,
                stage,
                EventSeverity::Debug,
                serde_json::to_value(event).unwrap_or_else(|_| json!({})),
            );
        }
    }

    fn emit(
        &self,
        correlation_id: &str,
        action: &str,
        stage: EventStage,
        severity: EventSeverity,
        payload: Value,
    ) {
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            action,
            stage,
            severity,
            payload,
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voice::settings::VoiceSettingsStore;
    use crate::voice::vad::settings::{ENERGY_BASIC_ID, SHERPA_SILERO_ID};

    fn service() -> VoiceRuntimeService {
        let path = std::env::temp_dir().join(format!(
            "arxell-voice-settings-test-{}.json",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        VoiceRuntimeService::new_with_store(EventHub::new(), VoiceSettingsStore::new(path))
    }

    #[test]
    fn rejects_method_switch_while_session_active() {
        let service = service();
        service.set_vad_method("corr-1", ENERGY_BASIC_ID).unwrap();
        service.start_session("corr-2").unwrap();
        let err = service
            .set_vad_method("corr-3", SHERPA_SILERO_ID)
            .unwrap_err();
        assert_eq!(err, VoiceRuntimeError::VoiceSessionActive);
    }
}
