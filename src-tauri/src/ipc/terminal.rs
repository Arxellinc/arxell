use crate::app::terminal_service::TerminalService;
use crate::contracts::{
    EventSeverity, EventStage, Subsystem, TerminalCloseSessionRequest,
    TerminalCloseSessionResponse, TerminalInputRequest, TerminalInputResponse,
    TerminalOpenSessionRequest, TerminalOpenSessionResponse, TerminalResizeRequest,
    TerminalResizeResponse,
};
use crate::observability::EventHub;
use serde_json::json;
use std::sync::Arc;

#[derive(Clone)]
pub struct TerminalCommandHandler {
    hub: EventHub,
    service: Arc<TerminalService>,
}

impl TerminalCommandHandler {
    pub fn new(hub: EventHub, service: Arc<TerminalService>) -> Self {
        Self { hub, service }
    }

    pub async fn open_session(
        &self,
        req: TerminalOpenSessionRequest,
    ) -> Result<TerminalOpenSessionResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.terminal.open_session",
            EventStage::Start,
            EventSeverity::Info,
            json!({"cols": req.cols, "rows": req.rows}),
        ));

        let result = self.service.open_session(req.clone());
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.terminal.open_session",
                EventStage::Complete,
                EventSeverity::Info,
                json!({"sessionId": response.session_id}),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.terminal.open_session",
                EventStage::Error,
                EventSeverity::Error,
                json!({"error": error}),
            )),
        }
        result
    }

    pub async fn send_input(
        &self,
        req: TerminalInputRequest,
    ) -> Result<TerminalInputResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.terminal.send_input",
            EventStage::Start,
            EventSeverity::Info,
            json!({"sessionId": req.session_id}),
        ));

        let result = self.service.send_input(req.clone());
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.terminal.send_input",
                EventStage::Complete,
                EventSeverity::Info,
                json!({"accepted": response.accepted}),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.terminal.send_input",
                EventStage::Error,
                EventSeverity::Error,
                json!({"error": error}),
            )),
        }
        result
    }

    pub async fn resize(
        &self,
        req: TerminalResizeRequest,
    ) -> Result<TerminalResizeResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.terminal.resize",
            EventStage::Start,
            EventSeverity::Info,
            json!({"sessionId": req.session_id, "cols": req.cols, "rows": req.rows}),
        ));

        let result = self.service.resize(req.clone());
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.terminal.resize",
                EventStage::Complete,
                EventSeverity::Info,
                json!({"ok": true}),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.terminal.resize",
                EventStage::Error,
                EventSeverity::Error,
                json!({"error": error}),
            )),
        }
        result
    }

    pub async fn close_session(
        &self,
        req: TerminalCloseSessionRequest,
    ) -> Result<TerminalCloseSessionResponse, String> {
        self.hub.emit(self.hub.make_event(
            &req.correlation_id,
            Subsystem::Ipc,
            "cmd.terminal.close_session",
            EventStage::Start,
            EventSeverity::Info,
            json!({"sessionId": req.session_id}),
        ));

        let result = self.service.close_session(req.clone());
        match &result {
            Ok(response) => self.hub.emit(self.hub.make_event(
                &response.correlation_id,
                Subsystem::Ipc,
                "cmd.terminal.close_session",
                EventStage::Complete,
                EventSeverity::Info,
                json!({"closed": response.closed}),
            )),
            Err(error) => self.hub.emit(self.hub.make_event(
                &req.correlation_id,
                Subsystem::Ipc,
                "cmd.terminal.close_session",
                EventStage::Error,
                EventSeverity::Error,
                json!({"error": error}),
            )),
        }
        result
    }
}
