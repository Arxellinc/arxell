#[derive(Debug, Clone, Copy, PartialEq)]
pub struct InterruptionDecision {
    pub should_cancel_tts: bool,
    pub confidence: f32,
}

pub trait InterruptionPolicy: Send + Sync {
    fn decide(&self, confidence: f32) -> InterruptionDecision;
}

#[derive(Debug, Clone, Copy)]
pub struct ThresholdInterruptionPolicy {
    pub threshold: f32,
}

impl Default for ThresholdInterruptionPolicy {
    fn default() -> Self {
        Self { threshold: 0.65 }
    }
}

impl InterruptionPolicy for ThresholdInterruptionPolicy {
    fn decide(&self, confidence: f32) -> InterruptionDecision {
        InterruptionDecision {
            should_cancel_tts: confidence >= self.threshold,
            confidence,
        }
    }
}
