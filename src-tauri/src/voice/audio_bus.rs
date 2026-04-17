use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFrame {
    pub samples: Vec<f32>,
    pub sample_rate_hz: u32,
    pub timestamp_ms: u64,
}

impl AudioFrame {
    pub fn duration_ms(&self) -> u32 {
        if self.sample_rate_hz == 0 {
            return 0;
        }
        ((self.samples.len() as u64 * 1000) / self.sample_rate_hz as u64) as u32
    }

    pub fn rms(&self) -> f32 {
        if self.samples.is_empty() {
            return 0.0;
        }
        let sum = self
            .samples
            .iter()
            .map(|sample| sample * sample)
            .sum::<f32>();
        (sum / self.samples.len() as f32).sqrt()
    }
}
