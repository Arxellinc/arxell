use crate::voice::settings::SpeculationConfig;
use crate::voice::speculation::confirmer;
use crate::voice::speculation::contracts::{
    SpeculationDecision, SpeculationState, SpeculativePrefix,
};
use crate::voice::speculation::fast_path;
use crate::voice::speculation::policy;
use crate::voice::vad::contracts::VadEvent;

#[derive(Debug, Clone)]
pub struct VoiceSpeculationService {
    pub state: SpeculationState,
    config: SpeculationConfig,
}

impl VoiceSpeculationService {
    pub fn new(config: SpeculationConfig) -> Self {
        Self {
            state: policy::initial_state(&config),
            config,
        }
    }

    pub fn reconfigure(&mut self, config: SpeculationConfig) {
        self.config = config;
        self.state = policy::initial_state(&self.config);
    }

    pub fn on_vad_events(&mut self, events: &[VadEvent]) -> Option<SpeculativePrefix> {
        if self.state == SpeculationState::Disabled {
            return None;
        }
        let decision = confirmer::confirm_from_events(events);
        match decision {
            SpeculationDecision::Cancel => {
                self.state = SpeculationState::Cancelled;
                return None;
            }
            SpeculationDecision::Commit => {
                self.state = SpeculationState::Committed;
                return None;
            }
            _ => {}
        }
        let prefix = fast_path::maybe_generate_prefix(events, self.config.max_prefix_ms)?;
        self.state = SpeculationState::SpeakingSpeculativePrefix;
        Some(prefix)
    }
}
