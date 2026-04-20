use serde::{Deserialize, Serialize};
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceSessionId(pub String);

impl VoiceSessionId {
    pub fn new() -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        Self(format!("voice-{now}"))
    }
}

impl Default for VoiceSessionId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for VoiceSessionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceRuntimeState {
    Idle,
    Starting,
    Running,
    RunningSingle,
    RunningDual,
    HandingOff,
    Stopping,
    Error,
}

impl VoiceRuntimeState {
    pub fn is_running(self) -> bool {
        matches!(
            self,
            Self::Running | Self::RunningSingle | Self::RunningDual | Self::HandingOff
        )
    }
}
