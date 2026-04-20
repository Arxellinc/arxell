use crate::voice::settings::SpeculationConfig;
use crate::voice::speculation::contracts::SpeculationState;

pub fn initial_state(config: &SpeculationConfig) -> SpeculationState {
    if config.enabled {
        SpeculationState::Listening
    } else {
        SpeculationState::Disabled
    }
}
