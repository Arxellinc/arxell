use crate::voice::handoff::contracts::HandoffState;

pub fn rollback_state() -> HandoffState {
    HandoffState::RolledBack
}
