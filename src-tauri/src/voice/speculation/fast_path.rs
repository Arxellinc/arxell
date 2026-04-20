use crate::voice::speculation::contracts::SpeculativePrefix;
use crate::voice::vad::contracts::VadEvent;

pub fn maybe_generate_prefix(events: &[VadEvent], max_prefix_ms: u32) -> Option<SpeculativePrefix> {
    let can_start = events.iter().any(|event| {
        matches!(
            event,
            VadEvent::MicroTurnReady { .. } | VadEvent::TurnYieldLikely { .. }
        )
    });
    can_start.then(|| SpeculativePrefix {
        text: "Okay-".to_string(),
        max_prefix_ms,
    })
}
