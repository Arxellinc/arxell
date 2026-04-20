use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceControlSignal {
    StartCanonicalSegment { segment_id: String },
    FinalizeCanonicalSegment { segment_id: String },
    CancelSpeculativeSpeech { reason: String },
}
