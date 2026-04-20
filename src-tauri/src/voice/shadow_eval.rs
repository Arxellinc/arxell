use crate::voice::vad::contracts::VadEvent;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowEvalRecord {
    pub active_method_id: String,
    pub shadow_method_id: String,
    pub active_event_count: u64,
    pub shadow_event_count: u64,
    pub disagreement_count: u64,
}

impl ShadowEvalRecord {
    pub fn new(active_method_id: String, shadow_method_id: String) -> Self {
        Self {
            active_method_id,
            shadow_method_id,
            active_event_count: 0,
            shadow_event_count: 0,
            disagreement_count: 0,
        }
    }

    pub fn observe(&mut self, active_events: &[VadEvent], shadow_events: &[VadEvent]) {
        self.active_event_count += active_events.len() as u64;
        self.shadow_event_count += shadow_events.len() as u64;
        if event_kind_signature(active_events) != event_kind_signature(shadow_events) {
            self.disagreement_count += 1;
        }
    }

    pub fn summary(&self) -> ShadowComparisonSummary {
        ShadowComparisonSummary {
            active_method_id: self.active_method_id.clone(),
            shadow_method_id: self.shadow_method_id.clone(),
            active_event_count: self.active_event_count,
            shadow_event_count: self.shadow_event_count,
            disagreement_count: self.disagreement_count,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowComparisonSummary {
    pub active_method_id: String,
    pub shadow_method_id: String,
    pub active_event_count: u64,
    pub shadow_event_count: u64,
    pub disagreement_count: u64,
}

fn event_kind_signature(events: &[VadEvent]) -> Vec<&'static str> {
    events
        .iter()
        .map(|event| match event {
            VadEvent::SpeechStart => "speech_start",
            VadEvent::SpeechEnd => "speech_end",
            VadEvent::SpeechProbability { .. } => "probability",
            VadEvent::SegmentOpened { .. } => "segment_opened",
            VadEvent::SegmentExtended { .. } => "segment_extended",
            VadEvent::SegmentClosed { .. } => "segment_closed",
            VadEvent::MicroTurnReady { .. } => "microturn",
            VadEvent::InterruptionDetected { .. } => "interruption",
            VadEvent::OverlapDetected { .. } => "overlap",
            VadEvent::TurnYieldLikely { .. } => "turn_yield",
            VadEvent::StateChanged { .. } => "state_changed",
            VadEvent::DebugMarker { .. } => "debug",
        })
        .collect()
}
