use crate::voice::audio_bus::AudioFrame;
use crate::voice::vad::contracts::{
    SegmentCloseReason, VadCapabilities, VadConfig, VadError, VadEvent, VadManifest, VadStatus,
    VadStrategy,
};
use crate::voice::vad::settings::{default_config_for, HybridInterruptConfig, HYBRID_INTERRUPT_ID};

#[derive(Default)]
pub struct HybridInterruptStrategy {
    config: HybridInterruptConfig,
    in_speech: bool,
    overlap_ms: u32,
    silence_ms: u32,
    segment_counter: u64,
    active_segment_id: Option<String>,
}

impl HybridInterruptStrategy {
    pub fn manifest_static() -> VadManifest {
        VadManifest {
            id: HYBRID_INTERRUPT_ID.to_string(),
            display_name: "Hybrid Interrupt".to_string(),
            status: VadStatus::Experimental,
            description:
                "Interruption-aware VAD with overlap and speculative-onset safety signals."
                    .to_string(),
            capabilities: Self::capabilities_static(),
            default_config: default_config_for(HYBRID_INTERRUPT_ID),
        }
    }

    fn capabilities_static() -> VadCapabilities {
        VadCapabilities {
            supports_endpointing: true,
            supports_interruption_signals: true,
            supports_micro_turns: true,
            supports_overlap_turn_yield_hints: true,
            supports_speech_probability: true,
            supports_partial_segmentation: true,
            supports_live_handoff: true,
            supports_speculative_onset: true,
        }
    }

    fn next_segment_id(&mut self) -> String {
        self.segment_counter += 1;
        format!("hybrid-interrupt-{}", self.segment_counter)
    }
}

impl VadStrategy for HybridInterruptStrategy {
    fn id(&self) -> &'static str {
        HYBRID_INTERRUPT_ID
    }

    fn display_name(&self) -> &'static str {
        "Hybrid Interrupt"
    }

    fn manifest(&self) -> VadManifest {
        Self::manifest_static()
    }

    fn capability_flags(&self) -> VadCapabilities {
        Self::capabilities_static()
    }

    fn start_session(&mut self, config: VadConfig) -> Result<(), VadError> {
        self.config = serde_json::from_value(config.settings).map_err(|err| {
            VadError::InvalidConfig(format!("invalid hybrid_interrupt config: {err}"))
        })?;
        self.reset()
    }

    fn process_frame(&mut self, frame: AudioFrame) -> Result<Vec<VadEvent>, VadError> {
        let duration_ms = frame.duration_ms();
        let rms = frame.rms();
        let threshold = self.config.interrupt_threshold.max(0.000001);
        let confidence = (rms / threshold).clamp(0.0, 1.0);
        let voice_like = rms >= threshold;
        let mut events = vec![VadEvent::SpeechProbability { value: confidence }];

        if voice_like {
            self.silence_ms = 0;
            self.overlap_ms = self.overlap_ms.saturating_add(duration_ms);
            if !self.in_speech {
                self.in_speech = true;
                let segment_id = self.next_segment_id();
                self.active_segment_id = Some(segment_id.clone());
                events.push(VadEvent::SpeechStart);
                events.push(VadEvent::SegmentOpened { segment_id });
            } else if let Some(segment_id) = self.active_segment_id.clone() {
                events.push(VadEvent::SegmentExtended { segment_id });
            }

            if self.overlap_ms >= self.config.min_overlap_ms {
                events.push(VadEvent::OverlapDetected {
                    confidence,
                    duration_ms: self.overlap_ms,
                });
                if confidence >= self.config.assistant_speaking_sensitivity {
                    events.push(VadEvent::InterruptionDetected { confidence });
                }
            }
            if confidence < self.config.yield_bias {
                events.push(VadEvent::TurnYieldLikely {
                    confidence: 1.0 - confidence,
                });
            }
            return Ok(events);
        }

        self.overlap_ms = 0;
        self.silence_ms = self.silence_ms.saturating_add(duration_ms);
        if self.in_speech && self.silence_ms >= self.config.min_overlap_ms {
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
        self.overlap_ms = 0;
        self.silence_ms = 0;
        self.active_segment_id = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn emits_interruption_after_overlap_window() {
        let mut strategy = HybridInterruptStrategy::default();
        strategy
            .start_session(VadConfig {
                method_id: HYBRID_INTERRUPT_ID.to_string(),
                version: 2,
                settings: json!({
                    "interruptThreshold": 0.01,
                    "minOverlapMs": 100,
                    "cancelTtsOnInterrupt": true,
                    "resumeAfterFalseInterrupt": true,
                    "yieldBias": 0.45,
                    "assistantSpeakingSensitivity": 0.65
                }),
            })
            .unwrap();
        let events = strategy
            .process_frame(AudioFrame {
                samples: vec![0.02; 1600],
                sample_rate_hz: 16_000,
                timestamp_ms: 100,
            })
            .unwrap();
        assert!(events
            .iter()
            .any(|event| matches!(event, VadEvent::InterruptionDetected { .. })));
    }
}
