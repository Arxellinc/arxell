//! Looper command handler
//!
//! Thin wrapper around LooperHandler that emits IPC events for each operation.
//! Follows the same pattern as FlowCommandHandler.

use crate::contracts::{
    EventSeverity, EventStage, LooperAdvanceRequest, LooperAdvanceResponse,
    LooperCheckOpenCodeRequest, LooperCheckOpenCodeResponse, LooperCloseRequest,
    LooperCloseResponse, LooperListRequest, LooperListResponse, LooperPauseRequest,
    LooperPauseResponse, LooperStartRequest, LooperStartResponse, LooperStatusRequest,
    LooperStatusResponse, LooperStopRequest, LooperStopResponse,
    LooperSubmitQuestionsRequest, LooperSubmitQuestionsResponse, Subsystem,
};
use crate::observability::EventHub;
use crate::tools::looper_handler::LooperHandler;
use serde_json::json;
use std::sync::Arc;

#[derive(Clone)]
pub struct LooperCommandHandler {
    hub: EventHub,
    handler: Arc<LooperHandler>,
}

impl LooperCommandHandler {
    pub fn new(hub: EventHub, handler: Arc<LooperHandler>) -> Self {
        Self { hub, handler }
    }

    pub async fn start(&self, req: LooperStartRequest) -> Result<LooperStartResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.looper.start",
            EventStage::Start,
            EventSeverity::Info,
            json!({
                "loopId": req.loop_id,
                "iteration": req.iteration,
                "cwd": req.cwd,
            }),
        ));

        let result = self.handler.start(req.clone()).await;
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.start",
                EventStage::Complete,
                EventSeverity::Info,
                json!({
                    "loopId": response.loop_id,
                    "status": response.status,
                }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.start",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn stop(&self, req: LooperStopRequest) -> Result<LooperStopResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.looper.stop",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "loopId": req.loop_id }),
        ));

        let result = self.handler.stop(req.clone()).await;
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.stop",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "loopId": response.loop_id, "stopped": response.stopped }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.stop",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn pause(&self, req: LooperPauseRequest) -> Result<LooperPauseResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.looper.pause",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "loopId": req.loop_id, "paused": req.paused }),
        ));

        let result = self.handler.pause(req.clone()).await;
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.pause",
                EventStage::Complete,
                EventSeverity::Info,
                json!({
                    "loopId": response.loop_id,
                    "paused": response.paused,
                    "updated": response.updated
                }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.pause",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn advance(
        &self,
        req: LooperAdvanceRequest,
    ) -> Result<LooperAdvanceResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.looper.advance",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "loopId": req.loop_id, "nextPhase": req.next_phase }),
        ));

        let result = self.handler.advance(req.clone()).await;
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.advance",
                EventStage::Complete,
                EventSeverity::Info,
                json!({
                    "loopId": response.loop_id,
                    "activePhase": response.active_phase,
                }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.advance",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn status(&self, req: LooperStatusRequest) -> Result<LooperStatusResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.looper.status",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "loopId": req.loop_id }),
        ));

        let result = self.handler.status(req.clone()).await;
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.status",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "loopId": req.loop_id }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.status",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn list(&self, req: LooperListRequest) -> Result<LooperListResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.looper.list",
            EventStage::Start,
            EventSeverity::Info,
            json!({}),
        ));

        let result = self.handler.list(req.clone()).await;
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.list",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "count": response.loops.len() }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.list",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn close(&self, req: LooperCloseRequest) -> Result<LooperCloseResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.looper.close",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "loopId": req.loop_id }),
        ));

        let result = self.handler.close(req.clone()).await;
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.close",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "loopId": response.loop_id, "closed": response.closed }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.close",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn check_opencode(
        &self,
        req: LooperCheckOpenCodeRequest,
    ) -> Result<LooperCheckOpenCodeResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.looper.check_opencode",
            EventStage::Start,
            EventSeverity::Info,
            json!({}),
        ));

        let result = self.handler.check_opencode(req.clone()).await;
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.check_opencode",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "installed": response.installed }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.check_opencode",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }

    pub async fn submit_questions(
        &self,
        req: LooperSubmitQuestionsRequest,
    ) -> Result<LooperSubmitQuestionsResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.looper.submit_questions",
            EventStage::Start,
            EventSeverity::Info,
            json!({ "loopId": req.loop_id, "answersCount": req.answers.len() }),
        ));

        let result = self.handler.submit_questions(req.clone()).await;
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.submit_questions",
                EventStage::Complete,
                EventSeverity::Info,
                json!({ "loopId": response.loop_id, "submitted": response.submitted }),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.looper.submit_questions",
                EventStage::Error,
                EventSeverity::Error,
                json!({ "error": error }),
            )),
        }
        result
    }
}
