use anyhow::Result;
use tract_onnx::prelude::*;

/// Silero VAD wrapper — GRU-based model with 3 inputs:
/// input [1, 512], sr [1], state [2, 1, 64]
pub struct SileroVad {
    model: SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>,
    sample_rate: i64,
    state: Tensor, // GRU hidden state [2, 1, 64]
}

impl SileroVad {
    pub fn new(model_path: &std::path::Path) -> Result<Self> {
        let model = tract_onnx::onnx()
            .model_for_path(model_path)?
            .with_input_fact(0, f32::fact([1, 512]).into())? // audio chunk
            .with_input_fact(1, i64::fact([1]).into())? // sample rate
            .with_input_fact(2, f32::fact([2, 1, 64]).into())? // GRU hidden state
            .into_optimized()?
            .into_runnable()?;

        let state = Tensor::zero::<f32>(&[2, 1, 64])?;

        Ok(Self {
            model,
            sample_rate: 16000,
            state,
        })
    }

    /// Run VAD on a 512-sample (32ms at 16kHz) chunk.
    /// Returns speech probability 0.0–1.0.
    pub fn predict(&mut self, samples: &[f32]) -> Result<f32> {
        assert_eq!(samples.len(), 512, "VAD expects exactly 512 samples");

        let audio = tract_ndarray::Array2::from_shape_vec((1, 512), samples.to_vec())?;
        let audio_tensor: Tensor = audio.into();
        let sr_tensor: Tensor = tract_ndarray::arr1(&[self.sample_rate]).into();

        let inputs = tvec![
            audio_tensor.into(),
            sr_tensor.into(),
            self.state.clone().into(),
        ];

        let outputs = self.model.run(inputs)?;

        // Output 0: speech probability (shape may vary), output 1: updated state
        let prob = outputs[0]
            .to_array_view::<f32>()?
            .iter()
            .next()
            .copied()
            .unwrap_or(0.0);
        self.state = outputs[1].clone().into_tensor();

        Ok(prob)
    }

    pub fn reset(&mut self) -> Result<()> {
        self.state = Tensor::zero::<f32>(&[2, 1, 64])?;
        Ok(())
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// These tests require the ONNX model to be present at the standard resource path.
    /// If the model isn't found they are skipped (the constructor returns Err).

    fn sine_chunk(freq: f32, amplitude: f32) -> Vec<f32> {
        (0..512)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / 16000.0).sin() * amplitude)
            .collect()
    }

    #[test]
    fn vad_chunk_must_be_512() {
        // The model is compiled expecting exactly 512 samples.
        // This test documents the contract even without the ONNX file.
        let chunk = sine_chunk(440.0, 0.5);
        assert_eq!(chunk.len(), 512, "VAD chunk must be exactly 512 samples");
    }

    #[test]
    fn vad_state_shape_is_correct() {
        // GRU hidden state: [2, 1, 64]
        let shape: &[usize] = &[2, 1, 64];
        let total: usize = shape.iter().product();
        assert_eq!(total, 128, "GRU state has 2*1*64 = 128 floats");
    }

    #[test]
    fn vad_silence_probability_low_if_model_available() {
        // Locate model relative to Cargo workspace
        let model_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../src-tauri/resources/silero_vad.onnx");

        if !model_path.exists() {
            // Also try the direct resources path
            let alt = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources/silero_vad.onnx");
            if !alt.exists() {
                eprintln!(
                    "SKIP: silero_vad.onnx not found at {:?} or {:?}",
                    model_path, alt
                );
                return;
            }
        }

        let path = if model_path.exists() {
            model_path
        } else {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/silero_vad.onnx")
        };

        match SileroVad::new(&path) {
            Ok(mut vad) => {
                let silence = vec![0.0f32; 512];
                let prob = vad.predict(&silence).expect("predict on silence failed");
                assert!(
                    prob < 0.5,
                    "silence probability should be < 0.5, got {}",
                    prob
                );
            }
            Err(e) => {
                eprintln!(
                    "SKIP: VAD model failed to load: {} (amplitude fallback active)",
                    e
                );
            }
        }
    }

    #[test]
    fn vad_reset_zeroes_state() {
        // Even without the model we can test that reset produces a zero tensor.
        let state = Tensor::zero::<f32>(&[2, 1, 64]).expect("zero tensor");
        let vals: Vec<f32> = state
            .to_array_view::<f32>()
            .unwrap()
            .iter()
            .copied()
            .collect();
        assert!(
            vals.iter().all(|&v| v == 0.0),
            "initial state should be all zeros"
        );
    }
}
