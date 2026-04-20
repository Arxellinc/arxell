use crate::voice::speculation::contracts::SpeculationDecision;
use crate::voice::vad::contracts::VadEvent;

pub fn confirm_from_events(events: &[VadEvent]) -> SpeculationDecision {
    if events
        .iter()
        .any(|event| matches!(event, VadEvent::InterruptionDetected { .. }))
    {
        return SpeculationDecision::Cancel;
    }
    if events
        .iter()
        .any(|event| matches!(event, VadEvent::SegmentClosed { .. }))
    {
        return SpeculationDecision::Commit;
    }
    SpeculationDecision::None
}
