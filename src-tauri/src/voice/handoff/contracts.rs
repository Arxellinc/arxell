use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HandoffState {
    None,
    Requested,
    Preparing,
    ReadyToCutover,
    CutoverInProgress,
    Completed,
    RolledBack,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HandoffSafePoint {
    Immediate,
    SegmentBoundary,
    MicroTurnBoundary,
    InterruptionBoundary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffRequest {
    pub target_method_id: String,
    pub safe_point: HandoffSafePoint,
}
