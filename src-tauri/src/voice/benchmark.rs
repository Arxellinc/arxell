use crate::voice::audio_bus::AudioFrame;
use crate::voice::vad::contracts::{VadConfig, VadError, VadEvent};
use crate::voice::vad::registry;
use crate::voice::vad::settings::default_config_for;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VadBenchmarkCase {
    pub name: String,
    pub frames: Vec<AudioFrame>,
    pub expected_speech_start_ms: Option<u64>,
    pub expected_speech_end_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VadBenchmarkResult {
    pub method_id: String,
    pub case_name: String,
    pub speech_start_ms: Option<u64>,
    pub speech_end_ms: Option<u64>,
    pub onset_latency_ms: Option<i64>,
    pub end_latency_ms: Option<i64>,
    pub speech_probability_count: u32,
    pub false_start: bool,
    pub missed_speech: bool,
}

pub fn evaluate_case(
    method_id: &str,
    case: &VadBenchmarkCase,
) -> Result<VadBenchmarkResult, VadError> {
    let mut strategy = registry::instantiate(method_id)?;
    strategy.start_session(VadConfig {
        method_id: method_id.to_string(),
        version: 2,
        settings: default_config_for(method_id),
    })?;

    let mut speech_start_ms = None;
    let mut speech_end_ms = None;
    let mut speech_probability_count = 0u32;

    for frame in &case.frames {
        let events = strategy.process_frame(frame.clone())?;
        for event in events {
            match event {
                VadEvent::SpeechStart if speech_start_ms.is_none() => {
                    speech_start_ms = Some(frame.timestamp_ms);
                }
                VadEvent::SpeechEnd => {
                    speech_end_ms = Some(frame.timestamp_ms);
                }
                VadEvent::SpeechProbability { .. } => {
                    speech_probability_count = speech_probability_count.saturating_add(1);
                }
                _ => {}
            }
        }
    }

    let onset_latency_ms = match (speech_start_ms, case.expected_speech_start_ms) {
        (Some(actual), Some(expected)) => Some(actual as i64 - expected as i64),
        _ => None,
    };
    let end_latency_ms = match (speech_end_ms, case.expected_speech_end_ms) {
        (Some(actual), Some(expected)) => Some(actual as i64 - expected as i64),
        _ => None,
    };

    Ok(VadBenchmarkResult {
        method_id: method_id.to_string(),
        case_name: case.name.clone(),
        speech_start_ms,
        speech_end_ms,
        onset_latency_ms,
        end_latency_ms,
        speech_probability_count,
        false_start: speech_start_ms.is_some() && case.expected_speech_start_ms.is_none(),
        missed_speech: speech_start_ms.is_none() && case.expected_speech_start_ms.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voice::vad::settings::ONNX_SILERO_ID;

    fn frame(value: f32, timestamp_ms: u64) -> AudioFrame {
        AudioFrame {
            samples: vec![value; 1600],
            sample_rate_hz: 16_000,
            timestamp_ms,
        }
    }

    #[test]
    fn benchmark_records_onset_and_end_latency() {
        let case = VadBenchmarkCase {
            name: "synthetic-quiet-speech".to_string(),
            frames: vec![
                frame(0.0, 0),
                frame(0.02, 100),
                frame(0.02, 200),
                frame(0.0, 300),
                frame(0.0, 400),
                frame(0.0, 500),
                frame(0.0, 600),
                frame(0.0, 700),
                frame(0.0, 800),
                frame(0.0, 900),
            ],
            expected_speech_start_ms: Some(100),
            expected_speech_end_ms: Some(900),
        };
        let result = evaluate_case(ONNX_SILERO_ID, &case).unwrap();
        assert_eq!(result.method_id, ONNX_SILERO_ID);
        assert!(result.speech_start_ms.is_some());
        assert!(result.speech_probability_count > 0);
    }
}
