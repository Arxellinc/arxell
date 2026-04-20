use crate::voice::audio_bus::AudioFrame;
use crate::voice::vad::contracts::{
    SegmentCloseReason, VadCapabilities, VadConfig, VadError, VadEvent, VadManifest, VadStatus,
    VadStrategy,
};
use crate::voice::vad::settings::{default_config_for, EnergyBasicConfig, ENERGY_BASIC_ID};

#[derive(Default)]
pub struct EnergyBasicStrategy {
    config: EnergyBasicConfig,
    in_speech: bool,
    speech_ms: u32,
    silence_ms: u32,
    segment_counter: u64,
    active_segment_id: Option<String>,
}

impl EnergyBasicStrategy {
    pub fn manifest_static() -> VadManifest {
        VadManifest {
            id: ENERGY_BASIC_ID.to_string(),
            display_name: "Energy Basic".to_string(),
            status: VadStatus::Stable,
            description: "Deterministic threshold-based voice activity detection.".to_string(),
            capabilities: Self::capabilities_static(),
            default_config: default_config_for(ENERGY_BASIC_ID),
        }
    }

    fn capabilities_static() -> VadCapabilities {
        VadCapabilities {
            supports_endpointing: true,
            supports_speech_probability: true,
            supports_partial_segmentation: true,
            supports_live_handoff: true,
            ..VadCapabilities::default()
        }
    }

    fn next_segment_id(&mut self) -> String {
        self.segment_counter += 1;
        format!("energy-basic-{}", self.segment_counter)
    }
}

impl VadStrategy for EnergyBasicStrategy {
    fn id(&self) -> &'static str {
        ENERGY_BASIC_ID
    }

    fn display_name(&self) -> &'static str {
        "Energy Basic"
    }

    fn manifest(&self) -> VadManifest {
        Self::manifest_static()
    }

    fn capability_flags(&self) -> VadCapabilities {
        Self::capabilities_static()
    }

    fn start_session(&mut self, config: VadConfig) -> Result<(), VadError> {
        self.config = serde_json::from_value(config.settings).map_err(|err| {
            VadError::InvalidConfig(format!("invalid energy-basic config: {err}"))
        })?;
        self.reset()
    }

    fn process_frame(&mut self, frame: AudioFrame) -> Result<Vec<VadEvent>, VadError> {
        let duration_ms = frame.duration_ms();
        let rms = frame.rms();
        let probability = (rms / self.config.threshold.max(0.000001)).clamp(0.0, 1.0);
        let voice_like = rms >= self.config.threshold;
        let mut events = vec![VadEvent::SpeechProbability { value: probability }];

        if voice_like {
            self.speech_ms = self.speech_ms.saturating_add(duration_ms);
            self.silence_ms = 0;
            if !self.in_speech && self.speech_ms >= self.config.min_speech_ms {
                self.in_speech = true;
                let segment_id = self.next_segment_id();
                self.active_segment_id = Some(segment_id.clone());
                events.push(VadEvent::SpeechStart);
                events.push(VadEvent::SegmentOpened { segment_id });
            } else if let Some(segment_id) = self.active_segment_id.clone() {
                events.push(VadEvent::SegmentExtended { segment_id });
            }
            return Ok(events);
        }

        self.silence_ms = self.silence_ms.saturating_add(duration_ms);
        self.speech_ms = 0;
        if self.in_speech
            && self.silence_ms
                >= self
                    .config
                    .min_silence_ms
                    .saturating_add(self.config.hangover_ms)
        {
            self.in_speech = false;
            events.push(VadEvent::SpeechEnd);
            if let Some(segment_id) = self.active_segment_id.take() {
                events.push(VadEvent::SegmentClosed {
                    segment_id,
                    reason: SegmentCloseReason::Silence,
                });
            }
        }
        Ok(events)
    }

    fn flush(&mut self) -> Result<Vec<VadEvent>, VadError> {
        if !self.in_speech {
            return Ok(Vec::new());
        }
        self.in_speech = false;
        let mut events = vec![VadEvent::SpeechEnd];
        if let Some(segment_id) = self.active_segment_id.take() {
            events.push(VadEvent::SegmentClosed {
                segment_id,
                reason: SegmentCloseReason::Flush,
            });
        }
        Ok(events)
    }

    fn reset(&mut self) -> Result<(), VadError> {
        self.in_speech = false;
        self.speech_ms = 0;
        self.silence_ms = 0;
        self.active_segment_id = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn frame(value: f32, timestamp_ms: u64) -> AudioFrame {
        AudioFrame {
            samples: vec![value; 1600],
            sample_rate_hz: 16_000,
            timestamp_ms,
        }
    }

    #[test]
    fn detects_speech_start_and_end_from_energy() {
        let mut strategy = EnergyBasicStrategy::default();
        strategy
            .start_session(VadConfig {
                method_id: ENERGY_BASIC_ID.to_string(),
                version: 1,
                settings: json!({
                    "threshold": 0.01,
                    "minSpeechMs": 100,
                    "minSilenceMs": 100,
                    "hangoverMs": 0
                }),
            })
            .unwrap();

        let events = strategy.process_frame(frame(0.02, 100)).unwrap();
        assert!(events
            .iter()
            .any(|event| matches!(event, VadEvent::SpeechStart)));
        let events = strategy.process_frame(frame(0.0, 200)).unwrap();
        assert!(events
            .iter()
            .any(|event| matches!(event, VadEvent::SpeechEnd)));
    }
}
