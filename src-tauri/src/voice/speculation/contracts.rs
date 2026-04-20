use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpeculationState {
    Disabled,
    Listening,
    DraftingFastPath,
    SpeakingSpeculativePrefix,
    AwaitingConfirmation,
    Committed,
    Cancelled,
    Replaced,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpeculationDecision {
    None,
    GeneratePrefix,
    Commit,
    Cancel,
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeculativePrefix {
    pub text: String,
    pub max_prefix_ms: u32,
}
