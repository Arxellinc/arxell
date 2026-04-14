use crate::app::flow_service::FlowService;
use crate::contracts::{
    EventSeverity, EventStage, FlowListRunsRequest, FlowListRunsResponse, FlowNudgeRequest,
    FlowNudgeResponse, FlowPauseRequest, FlowPauseResponse, FlowRerunValidationRequest,
    FlowRerunValidationResponse, FlowStartRequest, FlowStartResponse, FlowStatusRequest,
    FlowStatusResponse, FlowStopRequest, FlowStopResponse, Subsystem,
};
use crate::observability::EventHub;
use serde_json::json;
use std::sync::Arc;

#[derive(Clone)]
pub struct FlowCommandHandler {
    hub: EventHub,
    service: Arc<FlowService>,
}

impl FlowCommandHandler {
    pub fn new(hub: EventHub, service: Arc<FlowService>) -> Self {
        Self { hub, service }
    }

    pub async fn start(&self, req: FlowStartRequest) -> Result<FlowStartResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.flow.start",
            EventStage::Start,
            EventSeverity::Info,
            json!({
                "mode": req.mode,
                "maxIterations": req.max_iterations,
                "dryRun": req.dry_run,
                "autoPush": req.auto_push,
            }),
        ));

        let result = self.service.start(req.clone());
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.start",
                EventStage::Complete,
                EventSeverity::Info,
                json!({
                    "runId": response.run_id,
                    "status": response.status,
                }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.start",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn stop(&self, req: FlowStopRequest) -> Result<FlowStopResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.flow.stop",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "runId": req.run_id }),
        ));

        let result = self.service.stop(req.clone());
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.stop",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "runId": response.run_id, "stopped": response.stopped }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.stop",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn status(&self, req: FlowStatusRequest) -> Result<FlowStatusResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.flow.status",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "runId": req.run_id }),
        ));

        let result = self.service.status(req.clone());
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.status",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "runId": response.run.run_id, "status": response.run.status }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.status",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn list_runs(
        &self,
        req: FlowListRunsRequest,
    ) -> Result<FlowListRunsResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.flow.list_runs",
            EventStage::Start,
            EventSeverity::Info,
            json!({}),
        ));

        let result = self.service.list_runs(req.clone());
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.list_runs",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "count": response.runs.len() }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.list_runs",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn rerun_validation(
        &self,
        req: FlowRerunValidationRequest,
    ) -> Result<FlowRerunValidationResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.flow.rerun_validation",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "runId": req.run_id, "iteration": req.iteration }),
        ));
        let result = self.service.rerun_validation(req.clone());
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.rerun_validation",
                EventStage::Complete,
                EventSeverity::Info,
                json!({
                    "runId": response.run_id,
                    "iteration": response.iteration,
                    "ok": response.ok,
                    "count": response.results.len(),
                }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.rerun_validation",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn pause(&self, req: FlowPauseRequest) -> Result<FlowPauseResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.flow.pause",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "runId": req.run_id, "paused": req.paused }),
        ));
        let result = self.service.pause(req.clone());
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.pause",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "runId": response.run_id, "paused": response.paused, "updated": response.updated }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.pause",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn nudge(&self, req: FlowNudgeRequest) -> Result<FlowNudgeResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.flow.nudge",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "runId": req.run_id }),
        ));
        let result = self.service.nudge(req.clone());
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.nudge",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "runId": response.run_id, "accepted": response.accepted }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.flow.nudge",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }
}
