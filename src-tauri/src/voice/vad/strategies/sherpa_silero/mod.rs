use crate::voice::audio_bus::AudioFrame;
use crate::voice::vad::contracts::{
    SegmentCloseReason, VadCapabilities, VadConfig, VadError, VadEvent, VadManifest, VadStatus,
    VadStrategy,
};
use crate::voice::vad::settings::{default_config_for, SherpaSileroConfig, SHERPA_SILERO_ID};

#[derive(Default)]
pub struct SherpaSileroStrategy {
    config: SherpaSileroConfig,
    in_speech: bool,
    speech_frames: u32,
    silence_frames: u32,
    noise_floor: f32,
    segment_counter: u64,
    active_segment_id: Option<String>,
}

impl SherpaSileroStrategy {
    pub fn manifest_static() -> VadManifest {
        VadManifest {
            id: SHERPA_SILERO_ID.to_string(),
            display_name: "Sherpa Silero".to_string(),
            status: VadStatus::Stable,
            description: "Production-compatible endpointing adapter for the current Sherpa-backed voice path.".to_string(),
            capabilities: Self::capabilities_static(),
            default_config: default_config_for(SHERPA_SILERO_ID),
        }
    }

    fn capabilities_static() -> VadCapabilities {
        VadCapabilities {
            supports_endpointing: true,
            supports_interruption_signals: true,
            supports_speech_probability: true,
            supports_partial_segmentation: true,
            ..VadCapabilities::default()
        }
    }

    fn next_segment_id(&mut self) -> String {
        self.segment_counter += 1;
        format!("sherpa-silero-{}", self.segment_counter)
    }
}

impl VadStrategy for SherpaSileroStrategy {
    fn id(&self) -> &'static str {
        SHERPA_SILERO_ID
    }

    fn display_name(&self) -> &'static str {
        "Sherpa Silero"
    }

    fn manifest(&self) -> VadManifest {
        Self::manifest_static()
    }

    fn capability_flags(&self) -> VadCapabilities {
        Self::capabilities_static()
    }

    fn start_session(&mut self, config: VadConfig) -> Result<(), VadError> {
        self.config = serde_json::from_value(config.settings).map_err(|err| {
            VadError::InvalidConfig(format!("invalid sherpa-silero config: {err}"))
        })?;
        self.reset()
    }

    fn process_frame(&mut self, frame: AudioFrame) -> Result<Vec<VadEvent>, VadError> {
        let rms = frame.rms();
        if !self.in_speech {
            self.noise_floor = if self.noise_floor == 0.0 {
                rms
            } else {
                self.noise_floor * (1.0 - self.config.noise_adaptation_alpha)
                    + rms * self.config.noise_adaptation_alpha
            };
        }
        let threshold = self
            .config
            .base_threshold
            .max(self.noise_floor * self.config.dynamic_multiplier);
        let probability = (rms / threshold.max(0.000001)).clamp(0.0, 1.0);
        let voice_like = rms >= threshold;
        let mut events = vec![VadEvent::SpeechProbability { value: probability }];

        if voice_like {
            self.speech_frames = self.speech_frames.saturating_add(1);
            self.silence_frames = 0;
            if !self.in_speech && self.speech_frames >= self.config.start_frames {
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

        self.silence_frames = self.silence_frames.saturating_add(1);
        self.speech_frames = 0;
        if self.in_speech && self.silence_frames >= self.config.end_frames {
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
        self.speech_frames = 0;
        self.silence_frames = 0;
        self.noise_floor = 0.0;
        self.active_segment_id = None;
        Ok(())
    }
}
