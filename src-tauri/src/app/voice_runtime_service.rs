use crate::app::voice_handoff_service::VoiceHandoffService;
use crate::app::voice_speculation_service::VoiceSpeculationService;
use crate::contracts::{EventSeverity, EventStage, Subsystem};
use crate::observability::EventHub;
use crate::voice::audio_bus::AudioFrame;
use crate::voice::handoff::contracts::HandoffState;
use crate::voice::session::{VoiceRuntimeState, VoiceSessionId};
use crate::voice::settings::{DuplexMode, PersistedVoiceSettings, VoiceSettingsStore};
use crate::voice::shadow_eval::{ShadowComparisonSummary, ShadowEvalRecord};
use crate::voice::speculation::contracts::SpeculationState;
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
    HandoffRejected(String),
    ShadowRejected(String),
    Vad(VadError),
    Persistence(String),
}

impl std::fmt::Display for VoiceRuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidTransition(message)
            | Self::Persistence(message)
            | Self::HandoffRejected(message)
            | Self::ShadowRejected(message) => f.write_str(message),
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
    pub active_vad_method_id: String,
    pub standby_vad_method_id: Option<String>,
    pub shadow_vad_method_id: Option<String>,
    pub handoff_state: HandoffState,
    pub speculation_state: SpeculationState,
    pub duplex_mode: DuplexMode,
    pub shadow_summary: Option<ShadowComparisonSummary>,
}

struct VoiceRuntimeInner {
    state: VoiceRuntimeState,
    session_id: Option<VoiceSessionId>,
    settings: PersistedVoiceSettings,
    strategy: Option<Box<dyn VadStrategy>>,
    standby_strategy: Option<Box<dyn VadStrategy>>,
    standby_method_id: Option<String>,
    shadow_strategy: Option<Box<dyn VadStrategy>>,
    shadow_eval: Option<ShadowEvalRecord>,
    handoff_state: HandoffState,
    speculation: VoiceSpeculationService,
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
                speculation: VoiceSpeculationService::new(settings.speculation.clone()),
                settings,
                strategy: None,
                standby_strategy: None,
                standby_method_id: None,
                shadow_strategy: None,
                shadow_eval: None,
                handoff_state: HandoffState::None,
            }),
        }
    }

    pub fn list_vad_methods(&self, include_experimental: bool) -> Vec<VadManifest> {
        registry::list_methods(include_experimental)
    }

    pub fn snapshot(&self) -> VoiceRuntimeSnapshot {
        let inner = self.inner.lock().expect("voice runtime lock poisoned");
        Self::snapshot_from_inner(&inner)
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
        let snapshot = Self::snapshot_from_inner(&inner);
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
        inner.state = VoiceRuntimeState::RunningSingle;
        let snapshot = Self::snapshot_from_inner(&inner);
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
        if inner.state != VoiceRuntimeState::Starting && !inner.state.is_running() {
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
        inner.standby_strategy = None;
        inner.standby_method_id = None;
        inner.shadow_strategy = None;
        inner.shadow_eval = None;
        inner.handoff_state = HandoffState::None;
        let speculation_config = inner.settings.speculation.clone();
        inner.speculation.reconfigure(speculation_config);
        inner.state = VoiceRuntimeState::Idle;
        let snapshot = Self::snapshot_from_inner(&inner);
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
        if !inner.state.is_running() || inner.state == VoiceRuntimeState::HandingOff {
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
        let events = strategy.process_frame(frame.clone())?;
        let shadow_events = if let Some(shadow_strategy) = inner.shadow_strategy.as_mut() {
            match shadow_strategy.process_frame(frame) {
                Ok(events) => events,
                Err(err) => {
                    let method_id = inner
                        .shadow_eval
                        .as_ref()
                        .map(|record| record.shadow_method_id.clone())
                        .unwrap_or_else(|| "unknown".to_string());
                    drop(inner);
                    self.emit(
                        correlation_id,
                        "voice.vad.shadow.error",
                        EventStage::Error,
                        EventSeverity::Warn,
                        json!({"methodId": method_id, "error": err.to_string()}),
                    );
                    return Err(VoiceRuntimeError::Vad(err));
                }
            }
        } else {
            Vec::new()
        };
        if let Some(eval) = inner.shadow_eval.as_mut() {
            eval.observe(&events, &shadow_events);
        }
        let shadow_summary = inner.shadow_eval.as_ref().map(|eval| eval.summary());
        let prefix = inner.speculation.on_vad_events(&events);
        let speculation_state = inner.speculation.state;
        drop(inner);
        self.emit_vad_events(correlation_id, &events);
        if !shadow_events.is_empty() {
            self.emit(
                correlation_id,
                "voice.vad.shadow.metric",
                EventStage::Progress,
                EventSeverity::Debug,
                json!({"events": shadow_events, "summary": shadow_summary}),
            );
        }
        if let Some(prefix) = prefix {
            self.emit(
                correlation_id,
                "voice.speculation.prefix.generated",
                EventStage::Progress,
                EventSeverity::Info,
                json!({"text": prefix.text, "maxPrefixMs": prefix.max_prefix_ms, "state": speculation_state}),
            );
            self.emit(
                correlation_id,
                "voice.speculation.speaking",
                EventStage::Start,
                EventSeverity::Info,
                json!({"kind": "speculative_prefix"}),
            );
        }
        Ok(events)
    }

    pub fn request_handoff(
        &self,
        correlation_id: &str,
        target_method_id: &str,
    ) -> Result<VoiceRuntimeSnapshot, VoiceRuntimeError> {
        registry::validate_method(target_method_id)?;
        let manifest = registry::manifest(target_method_id)?;
        let mut inner = self.inner.lock().expect("voice runtime lock poisoned");
        if !inner.state.is_running() {
            drop(inner);
            self.emit(
                correlation_id,
                "voice.vad.handoff.rejected",
                EventStage::Error,
                EventSeverity::Warn,
                json!({"targetMethodId": target_method_id, "reason": "runtime_not_running"}),
            );
            return Err(VoiceRuntimeError::HandoffRejected(
                "handoff requires a running session".to_string(),
            ));
        }
        if let Err(reason) = VoiceHandoffService::eligible(&manifest, inner.handoff_state) {
            drop(inner);
            self.emit(
                correlation_id,
                "voice.vad.handoff.rejected",
                EventStage::Error,
                EventSeverity::Warn,
                json!({"targetMethodId": target_method_id, "reason": reason}),
            );
            return Err(VoiceRuntimeError::HandoffRejected(reason));
        }

        let config_value = inner
            .settings
            .vad_methods
            .get(target_method_id)
            .cloned()
            .unwrap_or_else(|| default_config_for(target_method_id));
        inner.handoff_state = HandoffState::Preparing;
        inner.state = VoiceRuntimeState::HandingOff;
        drop(inner);
        self.emit(
            correlation_id,
            "voice.vad.handoff.requested",
            EventStage::Start,
            EventSeverity::Info,
            json!({"targetMethodId": target_method_id}),
        );
        self.emit(
            correlation_id,
            "voice.vad.handoff.preparing",
            EventStage::Progress,
            EventSeverity::Info,
            json!({"targetMethodId": target_method_id}),
        );

        let mut standby = registry::instantiate(target_method_id)?;
        if let Err(err) = standby.start_session(VadConfig {
            method_id: target_method_id.to_string(),
            version: self.settings().version,
            settings: config_value,
        }) {
            let mut inner = self.inner.lock().expect("voice runtime lock poisoned");
            inner.handoff_state = HandoffState::RolledBack;
            inner.state = if inner.shadow_strategy.is_some() {
                VoiceRuntimeState::RunningDual
            } else {
                VoiceRuntimeState::RunningSingle
            };
            drop(inner);
            self.emit(
                correlation_id,
                "voice.vad.handoff.rollback",
                EventStage::Error,
                EventSeverity::Warn,
                json!({"targetMethodId": target_method_id, "error": err.to_string()}),
            );
            return Err(VoiceRuntimeError::Vad(err));
        }

        let mut inner = self.inner.lock().expect("voice runtime lock poisoned");
        inner.handoff_state = HandoffState::ReadyToCutover;
        inner.standby_method_id = Some(target_method_id.to_string());
        inner.standby_strategy = Some(standby);
        drop(inner);
        self.emit(
            correlation_id,
            "voice.vad.handoff.ready",
            EventStage::Progress,
            EventSeverity::Info,
            json!({"targetMethodId": target_method_id}),
        );
        self.cutover_handoff(correlation_id)
    }

    pub fn cutover_handoff(
        &self,
        correlation_id: &str,
    ) -> Result<VoiceRuntimeSnapshot, VoiceRuntimeError> {
        let mut inner = self.inner.lock().expect("voice runtime lock poisoned");
        if inner.handoff_state != HandoffState::ReadyToCutover {
            let state = inner.handoff_state;
            drop(inner);
            return Err(VoiceRuntimeError::HandoffRejected(format!(
                "handoff cutover requires ready state, got {state:?}"
            )));
        }
        inner.handoff_state = HandoffState::CutoverInProgress;
        let target = inner.standby_method_id.clone().ok_or_else(|| {
            VoiceRuntimeError::HandoffRejected("missing standby method".to_string())
        })?;
        let standby = inner.standby_strategy.take().ok_or_else(|| {
            VoiceRuntimeError::HandoffRejected("missing standby strategy".to_string())
        })?;
        inner.strategy = Some(standby);
        inner.settings.selected_vad_method = target.clone();
        inner.standby_method_id = None;
        inner.handoff_state = HandoffState::Completed;
        inner.state = if inner.shadow_strategy.is_some() {
            VoiceRuntimeState::RunningDual
        } else {
            VoiceRuntimeState::RunningSingle
        };
        self.settings_store
            .save(&inner.settings)
            .map_err(VoiceRuntimeError::Persistence)?;
        let snapshot = Self::snapshot_from_inner(&inner);
        drop(inner);
        self.emit(
            correlation_id,
            "voice.vad.handoff.cutover",
            EventStage::Progress,
            EventSeverity::Info,
            json!({"targetMethodId": target}),
        );
        self.emit(
            correlation_id,
            "voice.vad.handoff.complete",
            EventStage::Complete,
            EventSeverity::Info,
            json!({"activeMethodId": target}),
        );
        Ok(snapshot)
    }

    pub fn set_shadow_method(
        &self,
        correlation_id: &str,
        method_id: Option<String>,
    ) -> Result<VoiceRuntimeSnapshot, VoiceRuntimeError> {
        if let Some(method_id) = method_id.as_deref() {
            registry::validate_method(method_id)?;
        }
        let mut inner = self.inner.lock().expect("voice runtime lock poisoned");
        inner.settings.shadow_vad_method = method_id;
        self.settings_store
            .save(&inner.settings)
            .map_err(VoiceRuntimeError::Persistence)?;
        let snapshot = Self::snapshot_from_inner(&inner);
        drop(inner);
        self.emit(
            correlation_id,
            "voice.vad.shadow.method.changed",
            EventStage::Complete,
            EventSeverity::Info,
            json!({"shadowMethodId": snapshot.shadow_vad_method_id}),
        );
        Ok(snapshot)
    }

    pub fn start_shadow_eval(
        &self,
        correlation_id: &str,
    ) -> Result<VoiceRuntimeSnapshot, VoiceRuntimeError> {
        let mut inner = self.inner.lock().expect("voice runtime lock poisoned");
        if !inner.state.is_running() {
            return Err(VoiceRuntimeError::ShadowRejected(
                "shadow evaluation requires a running session".to_string(),
            ));
        }
        if inner.shadow_strategy.is_some() {
            return Err(VoiceRuntimeError::ShadowRejected(
                "shadow evaluation is already active".to_string(),
            ));
        }
        let shadow_id = inner.settings.shadow_vad_method.clone().ok_or_else(|| {
            VoiceRuntimeError::ShadowRejected("no shadow method selected".to_string())
        })?;
        let active_id = inner.settings.selected_vad_method.clone();
        if shadow_id == active_id {
            return Err(VoiceRuntimeError::ShadowRejected(
                "shadow method must differ from active method".to_string(),
            ));
        }
        let config = inner
            .settings
            .vad_methods
            .get(&shadow_id)
            .cloned()
            .unwrap_or_else(|| default_config_for(&shadow_id));
        let mut shadow = registry::instantiate(&shadow_id)?;
        shadow.start_session(VadConfig {
            method_id: shadow_id.clone(),
            version: inner.settings.version,
            settings: config,
        })?;
        inner.shadow_eval = Some(ShadowEvalRecord::new(active_id.clone(), shadow_id.clone()));
        inner.shadow_strategy = Some(shadow);
        inner.state = VoiceRuntimeState::RunningDual;
        let snapshot = Self::snapshot_from_inner(&inner);
        drop(inner);
        self.emit(
            correlation_id,
            "voice.vad.shadow.started",
            EventStage::Start,
            EventSeverity::Info,
            json!({"activeMethodId": active_id, "shadowMethodId": shadow_id}),
        );
        Ok(snapshot)
    }

    pub fn stop_shadow_eval(
        &self,
        correlation_id: &str,
    ) -> Result<VoiceRuntimeSnapshot, VoiceRuntimeError> {
        let mut inner = self.inner.lock().expect("voice runtime lock poisoned");
        let summary = inner.shadow_eval.as_ref().map(|eval| eval.summary());
        inner.shadow_strategy = None;
        inner.shadow_eval = None;
        if inner.state == VoiceRuntimeState::RunningDual {
            inner.state = VoiceRuntimeState::RunningSingle;
        }
        let snapshot = Self::snapshot_from_inner(&inner);
        drop(inner);
        self.emit(
            correlation_id,
            "voice.vad.shadow.summary",
            EventStage::Complete,
            EventSeverity::Info,
            json!({"summary": summary}),
        );
        Ok(snapshot)
    }

    pub fn set_duplex_mode(
        &self,
        correlation_id: &str,
        duplex_mode: DuplexMode,
    ) -> Result<VoiceRuntimeSnapshot, VoiceRuntimeError> {
        let mut inner = self.inner.lock().expect("voice runtime lock poisoned");
        inner.settings.duplex_mode = duplex_mode;
        inner.settings.speculation.enabled =
            matches!(duplex_mode, DuplexMode::FullDuplexSpeculative);
        let speculation_config = inner.settings.speculation.clone();
        inner.speculation.reconfigure(speculation_config);
        self.settings_store
            .save(&inner.settings)
            .map_err(VoiceRuntimeError::Persistence)?;
        let snapshot = Self::snapshot_from_inner(&inner);
        drop(inner);
        self.emit(
            correlation_id,
            "voice.duplex.mode.changed",
            EventStage::Complete,
            EventSeverity::Info,
            json!({"duplexMode": duplex_mode}),
        );
        Ok(snapshot)
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

    fn snapshot_from_inner(inner: &VoiceRuntimeInner) -> VoiceRuntimeSnapshot {
        VoiceRuntimeSnapshot {
            state: inner.state,
            session_id: inner.session_id.clone(),
            selected_vad_method: inner.settings.selected_vad_method.clone(),
            active_vad_method_id: inner.settings.selected_vad_method.clone(),
            standby_vad_method_id: inner.standby_method_id.clone(),
            shadow_vad_method_id: inner.settings.shadow_vad_method.clone(),
            handoff_state: inner.handoff_state,
            speculation_state: inner.speculation.state,
            duplex_mode: inner.settings.duplex_mode,
            shadow_summary: inner.shadow_eval.as_ref().map(|eval| eval.summary()),
        }
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
                VadEvent::InterruptionDetected { .. } => {
                    ("voice.vad.interruption.detected", EventStage::Progress)
                }
                VadEvent::OverlapDetected { .. } => {
                    ("voice.vad.overlap.detected", EventStage::Progress)
                }
                VadEvent::TurnYieldLikely { .. } => {
                    ("voice.vad.turn_yield.likely", EventStage::Progress)
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
    use crate::voice::vad::settings::{ENERGY_BASIC_ID, MICROTURN_V1_ID, SHERPA_SILERO_ID};

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

    #[test]
    fn handoff_switches_active_method_mid_session() {
        let service = service();
        service.set_vad_method("corr-1", ENERGY_BASIC_ID).unwrap();
        service.start_session("corr-2").unwrap();
        let snapshot = service.request_handoff("corr-3", SHERPA_SILERO_ID).unwrap();
        assert_eq!(snapshot.active_vad_method_id, SHERPA_SILERO_ID);
        assert_eq!(snapshot.handoff_state, HandoffState::Completed);
        assert_eq!(snapshot.state, VoiceRuntimeState::RunningSingle);
    }

    #[test]
    fn shadow_eval_runs_without_changing_active_method() {
        let service = service();
        service.set_vad_method("corr-1", ENERGY_BASIC_ID).unwrap();
        service
            .set_shadow_method("corr-2", Some(MICROTURN_V1_ID.to_string()))
            .unwrap();
        service.start_session("corr-3").unwrap();
        let snapshot = service.start_shadow_eval("corr-4").unwrap();
        assert_eq!(snapshot.active_vad_method_id, ENERGY_BASIC_ID);
        assert_eq!(
            snapshot.shadow_vad_method_id.as_deref(),
            Some(MICROTURN_V1_ID)
        );
        assert_eq!(snapshot.state, VoiceRuntimeState::RunningDual);
    }

    #[test]
    fn duplex_speculative_mode_updates_speculation_state() {
        let service = service();
        let snapshot = service
            .set_duplex_mode("corr-1", DuplexMode::FullDuplexSpeculative)
            .unwrap();
        assert_eq!(snapshot.duplex_mode, DuplexMode::FullDuplexSpeculative);
        assert_eq!(snapshot.speculation_state, SpeculationState::Listening);
    }
}
