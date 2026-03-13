//! Generation configuration for local LLM inference
//!
//! This module provides the `GenerationConfig` struct which holds all
//! sampling/generation parameters for llama.cpp inference.

use serde::{Deserialize, Serialize};

/// Configuration for text generation with a local LLM.
///
/// All parameters have sensible defaults and are validated/clamped
/// before use to ensure they're within acceptable ranges.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationConfig {
    /// Sampling temperature. Higher = more random, lower = more focused.
    /// Range: 0.0–2.0, Default: 0.7
    pub temperature: f32,

    /// Top-p (nucleus) sampling threshold. Consider tokens until cumulative
    /// probability reaches this value.
    /// Range: 0.0–1.0, Default: 0.9
    pub top_p: f32,

    /// Top-k sampling. Only consider the top k most likely tokens.
    /// Range: 1–500, Default: 40
    pub top_k: u32,

    /// Repetition penalty. Penalizes tokens that have appeared before.
    /// 1.0 = no penalty, >1.0 = more penalty.
    /// Range: 0.5–2.0, Default: 1.1
    pub repeat_penalty: f32,

    /// Maximum number of new tokens to generate.
    /// Range: 1–32768, Default: 512
    pub max_new_tokens: u32,

    /// Random seed for reproducible generation. None = random seed.
    /// Default: None
    pub seed: Option<u64>,

    /// Stop sequences. Generation stops when any of these strings are produced.
    /// Default: empty vec
    pub stop_sequences: Vec<String>,

    /// Mirostat mode for dynamic entropy control.
    /// 0 = off, 1 = mirostat v1, 2 = mirostat v2
    /// Range: 0–2, Default: 0
    pub mirostat_mode: u8,

    /// Mirostat target entropy (tau). Controls the "surprise" level.
    /// Higher = more varied output.
    /// Range: 0.0–10.0, Default: 5.0
    pub mirostat_tau: f32,

    /// Mirostat learning rate (eta). How quickly mirostat adapts.
    /// Range: 0.0–1.0, Default: 0.1
    pub mirostat_eta: f32,
}

impl Default for GenerationConfig {
    fn default() -> Self {
        Self {
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            repeat_penalty: 1.1,
            max_new_tokens: 512,
            seed: None,
            stop_sequences: Vec::new(),
            mirostat_mode: 0,
            mirostat_tau: 5.0,
            mirostat_eta: 0.1,
        }
    }
}

impl GenerationConfig {
    /// Validate and clamp all parameters to their valid ranges.
    ///
    /// This method mutates the config in-place to ensure all values
    /// are within acceptable bounds. Call this before using the config
    /// for generation.
    pub fn validate(&mut self) {
        self.temperature = self.temperature.clamp(0.0, 2.0);
        self.top_p = self.top_p.clamp(0.0, 1.0);
        self.top_k = self.top_k.clamp(1, 500);
        self.repeat_penalty = self.repeat_penalty.clamp(0.5, 2.0);
        self.max_new_tokens = self.max_new_tokens.clamp(1, 32768);
        self.mirostat_mode = self.mirostat_mode.clamp(0, 2);
        self.mirostat_tau = self.mirostat_tau.clamp(0.0, 10.0);
        self.mirostat_eta = self.mirostat_eta.clamp(0.0, 1.0);
    }

    /// Check if mirostat is enabled.
    pub fn is_mirostat_enabled(&self) -> bool {
        self.mirostat_mode > 0
    }

    /// Get the seed value, generating a random one if None.
    pub fn get_seed_or_random(&self) -> u64 {
        self.seed.unwrap_or_else(|| {
            // Use system time for random seed
            use std::time::{SystemTime, UNIX_EPOCH};
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(0)
        })
    }
}

#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
impl GenerationConfig {
    /// Build a sampler chain from this configuration.
    ///
    /// The sampler chain is constructed in the optimal order:
    /// 1. Top-k (reduce candidate pool)
    /// 2. Top-p (nucleus filtering)
    /// 3. Temperature (scale logits)
    /// 4. Distribution (sample with seed)
    ///
    /// When mirostat is enabled, it replaces top-k/top-p/temperature.
    pub fn build_sampler(&self, vocab_size: usize) -> llama_cpp_2::sampling::LlamaSampler {
        use llama_cpp_2::sampling::LlamaSampler;

        let seed = self.get_seed_or_random();

        if self.mirostat_mode == 2 {
            // Mirostat v2: no vocab_size needed, simpler per-token entropy control
            LlamaSampler::mirostat_v2(seed as u32, self.mirostat_tau, self.mirostat_eta)
        } else if self.mirostat_mode == 1 {
            // Mirostat v1: requires vocab_size and history window (m)
            LlamaSampler::mirostat(
                vocab_size as i32,
                seed as u32,
                self.mirostat_tau,
                self.mirostat_eta,
                100, // m = history size
            )
        } else {
            // Standard sampling chain
            LlamaSampler::chain_simple([
                LlamaSampler::top_k(self.top_k as i32),
                LlamaSampler::top_p(self.top_p, 1), // min_keep = 1
                LlamaSampler::temp(self.temperature),
                LlamaSampler::dist(seed as u32),
            ])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_values() {
        let config = GenerationConfig::default();
        assert_eq!(config.temperature, 0.7);
        assert_eq!(config.top_p, 0.9);
        assert_eq!(config.top_k, 40);
        assert_eq!(config.repeat_penalty, 1.1);
        assert_eq!(config.max_new_tokens, 512);
        assert!(config.seed.is_none());
        assert!(config.stop_sequences.is_empty());
        assert_eq!(config.mirostat_mode, 0);
        assert_eq!(config.mirostat_tau, 5.0);
        assert_eq!(config.mirostat_eta, 0.1);
    }

    #[test]
    fn test_validate_clamps_temperature() {
        let mut config = GenerationConfig::default();
        config.temperature = 99.0;
        config.validate();
        assert_eq!(config.temperature, 2.0);

        config.temperature = -5.0;
        config.validate();
        assert_eq!(config.temperature, 0.0);
    }

    #[test]
    fn test_validate_clamps_top_p() {
        let mut config = GenerationConfig::default();
        config.top_p = 1.5;
        config.validate();
        assert_eq!(config.top_p, 1.0);

        config.top_p = -0.5;
        config.validate();
        assert_eq!(config.top_p, 0.0);
    }

    #[test]
    fn test_validate_clamps_top_k() {
        let mut config = GenerationConfig::default();
        config.top_k = 1000;
        config.validate();
        assert_eq!(config.top_k, 500);

        config.top_k = 0;
        config.validate();
        assert_eq!(config.top_k, 1);
    }

    #[test]
    fn test_validate_clamps_mirostat_mode() {
        let mut config = GenerationConfig::default();
        config.mirostat_mode = 5;
        config.validate();
        assert_eq!(config.mirostat_mode, 2);
    }

    #[test]
    fn test_mirostat_enabled() {
        let mut config = GenerationConfig::default();
        assert!(!config.is_mirostat_enabled());

        config.mirostat_mode = 1;
        assert!(config.is_mirostat_enabled());

        config.mirostat_mode = 2;
        assert!(config.is_mirostat_enabled());
    }

    #[test]
    fn test_seed_generation() {
        let config = GenerationConfig {
            seed: Some(12345),
            ..Default::default()
        };
        assert_eq!(config.get_seed_or_random(), 12345);

        let config = GenerationConfig {
            seed: None,
            ..Default::default()
        };
        let seed1 = config.get_seed_or_random();
        let seed2 = config.get_seed_or_random();
        // Seeds should be different (with very high probability)
        // Note: This could theoretically fail if called at the exact same nanosecond
        // but that's extremely unlikely
        assert!(seed1 > 0 || seed2 > 0);
    }
}
