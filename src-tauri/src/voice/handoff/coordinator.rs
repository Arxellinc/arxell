use crate::voice::handoff::contracts::{HandoffSafePoint, HandoffState};
use crate::voice::vad::contracts::VadEvent;

pub fn cutover_allowed(safe_point: HandoffSafePoint, events: &[VadEvent]) -> bool {
    match safe_point {
        HandoffSafePoint::Immediate => true,
        HandoffSafePoint::SegmentBoundary => events
            .iter()
            .any(|event| matches!(event, VadEvent::SegmentClosed { .. })),
        HandoffSafePoint::MicroTurnBoundary => events
            .iter()
            .any(|event| matches!(event, VadEvent::MicroTurnReady { .. })),
        HandoffSafePoint::InterruptionBoundary => events
            .iter()
            .any(|event| matches!(event, VadEvent::InterruptionDetected { .. })),
    }
}

pub fn is_transition_active(state: HandoffState) -> bool {
    matches!(
        state,
        HandoffState::Requested
            | HandoffState::Preparing
            | HandoffState::ReadyToCutover
            | HandoffState::CutoverInProgress
    )
}
