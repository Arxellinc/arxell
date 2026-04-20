use crate::voice::audio_bus::AudioFrame;
use crate::voice::vad::contracts::{
    SegmentCloseReason, VadCapabilities, VadConfig, VadError, VadEvent, VadManifest, VadStatus,
    VadStrategy,
};
use crate::voice::vad::settings::{default_config_for, MicroturnV1Config, MICROTURN_V1_ID};

#[derive(Default)]
pub struct MicroturnV1Strategy {
    config: MicroturnV1Config,
    in_speech: bool,
    speech_ms: u32,
    segment_counter: u64,
    active_segment_id: Option<String>,
    active_start_ms: u64,
    next_microturn_due_ms: u64,
}

impl MicroturnV1Strategy {
    pub fn manifest_static() -> VadManifest {
        VadManifest {
            id: MICROTURN_V1_ID.to_string(),
            display_name: "Microturn v1".to_string(),
            status: VadStatus::Experimental,
            description: "Experimental periodic micro-turn segmentation for short voice turns."
                .to_string(),
            capabilities: Self::capabilities_static(),
            default_config: default_config_for(MICROTURN_V1_ID),
        }
    }

    fn capabilities_static() -> VadCapabilities {
        VadCapabilities {
            supports_endpointing: true,
            supports_micro_turns: true,
            supports_speech_probability: true,
            supports_partial_segmentation: true,
            supports_live_handoff: true,
            supports_speculative_onset: true,
            ..VadCapabilities::default()
        }
    }

    fn next_segment_id(&mut self) -> String {
        self.segment_counter += 1;
        format!("microturn-v1-{}", self.segment_counter)
    }
}

impl VadStrategy for MicroturnV1Strategy {
    fn id(&self) -> &'static str {
        MICROTURN_V1_ID
    }

    fn display_name(&self) -> &'static str {
        "Microturn v1"
    }

    fn manifest(&self) -> VadManifest {
        Self::manifest_static()
    }

    fn capability_flags(&self) -> VadCapabilities {
        Self::capabilities_static()
    }

    fn start_session(&mut self, config: VadConfig) -> Result<(), VadError> {
        self.config = serde_json::from_value(config.settings).map_err(|err| {
            VadError::InvalidConfig(format!("invalid microturn-v1 config: {err}"))
        })?;
        self.reset()
    }

    fn process_frame(&mut self, frame: AudioFrame) -> Result<Vec<VadEvent>, VadError> {
        let rms = frame.rms();
        let probability = (rms / self.config.threshold.max(0.000001)).clamp(0.0, 1.0);
        let voice_like = rms >= self.config.threshold;
        let mut events = vec![VadEvent::SpeechProbability { value: probability }];

        if voice_like {
            self.speech_ms = self.speech_ms.saturating_add(frame.duration_ms());
            if !self.in_speech && self.speech_ms >= self.config.min_speech_ms {
                self.in_speech = true;
                self.active_start_ms = frame.timestamp_ms.saturating_sub(self.speech_ms as u64);
                self.next_microturn_due_ms =
                    self.active_start_ms + self.config.microturn_window_ms as u64;
                let segment_id = self.next_segment_id();
                self.active_segment_id = Some(segment_id.clone());
                events.push(VadEvent::SpeechStart);
                events.push(VadEvent::SegmentOpened { segment_id });
            }
            if let Some(segment_id) = self.active_segment_id.clone() {
                events.push(VadEvent::SegmentExtended {
                    segment_id: segment_id.clone(),
                });
                if self.in_speech && frame.timestamp_ms >= self.next_microturn_due_ms {
                    events.push(VadEvent::MicroTurnReady {
                        segment_id,
                        start_ms: self.active_start_ms,
                        end_ms: frame.timestamp_ms,
                    });
                    self.next_microturn_due_ms = self
                        .next_microturn_due_ms
                        .saturating_add(self.config.microturn_window_ms as u64);
                }
            }
            return Ok(events);
        }

        self.speech_ms = 0;
        if self.in_speech {
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
        self.active_segment_id = None;
        self.active_start_ms = 0;
        self.next_microturn_due_ms = 0;
        Ok(())
    }
}
