use crate::app::voice_runtime_service::VoiceRuntimeService;
use crate::contracts::{
    EventSeverity, EventStage, Subsystem, VoiceGetVadSettingsRequest, VoiceGetVadSettingsResponse,
    VoiceListVadMethodsRequest, VoiceListVadMethodsResponse, VoiceRuntimeSnapshotResponse,
    VoiceSetVadMethodRequest, VoiceStartSessionRequest, VoiceStopSessionRequest,
    VoiceUpdateVadConfigRequest, VoiceUpdateVadConfigResponse,
};
use crate::observability::EventHub;
use serde_json::json;
use std::sync::Arc;

#[derive(Clone)]
pub struct VoiceCommandHandler {
    hub: EventHub,
    voice: Arc<VoiceRuntimeService>,
}

impl VoiceCommandHandler {
    pub fn new(hub: EventHub, voice: Arc<VoiceRuntimeService>) -> Self {
        Self { hub, voice }
    }

    pub async fn list_vad_methods(
        &self,
        request: VoiceListVadMethodsRequest,
    ) -> Result<VoiceListVadMethodsResponse, String> {
        self.hub.emit(self.hub.make_event(
            &request.correlation_id,
            Subsystem::Ipc,
            "voice.vad.methods.list",
            EventStage::Start,
            EventSeverity::Info,
            json!({"includeExperimental": request.include_experimental}),
        ));
        let snapshot = self.voice.snapshot();
        Ok(VoiceListVadMethodsResponse {
            correlation_id: request.correlation_id,
            methods: self.voice.list_vad_methods(request.include_experimental),
            selected_vad_method: snapshot.selected_vad_method,
            state: snapshot.state,
        })
    }

    pub async fn get_vad_settings(
        &self,
        request: VoiceGetVadSettingsRequest,
    ) -> Result<VoiceGetVadSettingsResponse, String> {
        let snapshot = self.voice.snapshot();
        Ok(VoiceGetVadSettingsResponse {
            correlation_id: request.correlation_id,
            settings: self.voice.settings(),
            state: snapshot.state,
        })
    }

    pub async fn set_vad_method(
        &self,
        request: VoiceSetVadMethodRequest,
    ) -> Result<VoiceRuntimeSnapshotResponse, String> {
        self.voice
            .set_vad_method(&request.correlation_id, &request.method_id)
            .map(|snapshot| VoiceRuntimeSnapshotResponse {
                correlation_id: request.correlation_id,
                snapshot,
            })
            .map_err(|err| err.to_string())
    }

    pub async fn update_vad_config(
        &self,
        request: VoiceUpdateVadConfigRequest,
    ) -> Result<VoiceUpdateVadConfigResponse, String> {
        self.voice
            .update_vad_config(&request.correlation_id, &request.method_id, request.config)
            .map(|settings| VoiceUpdateVadConfigResponse {
                correlation_id: request.correlation_id,
                settings,
            })
            .map_err(|err| err.to_string())
    }

    pub async fn start_session(
        &self,
        request: VoiceStartSessionRequest,
    ) -> Result<VoiceRuntimeSnapshotResponse, String> {
        self.voice
            .start_session(&request.correlation_id)
            .map(|snapshot| VoiceRuntimeSnapshotResponse {
                correlation_id: request.correlation_id,
                snapshot,
            })
            .map_err(|err| err.to_string())
    }

    pub async fn stop_session(
        &self,
        request: VoiceStopSessionRequest,
    ) -> Result<VoiceRuntimeSnapshotResponse, String> {
        self.voice
            .stop_session(&request.correlation_id)
            .map(|snapshot| VoiceRuntimeSnapshotResponse {
                correlation_id: request.correlation_id,
                snapshot,
            })
            .map_err(|err| err.to_string())
    }
}
