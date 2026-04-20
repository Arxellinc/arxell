use crate::voice::handoff::contracts::{HandoffSafePoint, HandoffState};
use crate::voice::handoff::coordinator;
use crate::voice::vad::contracts::{VadEvent, VadManifest};

pub struct VoiceHandoffService;

impl VoiceHandoffService {
    pub fn eligible(manifest: &VadManifest, current: HandoffState) -> Result<(), String> {
        if coordinator::is_transition_active(current) {
            return Err("handoff already in progress".to_string());
        }
        if !manifest.capabilities.supports_live_handoff {
            return Err(format!(
                "method '{}' does not support live handoff",
                manifest.id
            ));
        }
        Ok(())
    }

    pub fn cutover_allowed(safe_point: HandoffSafePoint, events: &[VadEvent]) -> bool {
        coordinator::cutover_allowed(safe_point, events)
    }
}
