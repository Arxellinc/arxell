//! WhisperClient handles HTTP communication with the whisper.cpp server.
//! Implements inline WAV encoding to avoid external dependencies.

const SAMPLE_RATE: u32 = 16000;
const CHANNELS: u16 = 1;
const BITS_PER_SAMPLE: u16 = 16;

/// WhisperClient for communicating with the whisper.cpp HTTP server.
pub struct WhisperClient {
    base_url: String,
    client: reqwest::Client,
}

impl WhisperClient {
    /// Create a new WhisperClient.
    pub fn new(port: u16) -> Self {
        let base_url = format!("http://127.0.0.1:{}", port);
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("Failed to build HTTP client");
        
        Self { base_url, client }
    }

    /// Transcribe PCM audio samples.
    /// Takes raw Float32 samples at 16kHz mono and returns the transcription.
    pub async fn transcribe(&self, pcm_samples: &[f32]) -> Result<String, String> {
        let wav_data = encode_wav(pcm_samples)?;
        
        // Build multipart form manually
        let form = reqwest::multipart::Form::new()
            .part("file", reqwest::multipart::Part::bytes(wav_data)
                .file_name("audio.wav")
                .mime_str("audio/wav")
                .map_err(|e| format!("Failed to set mime type: {}", e))?);

        let response = self.client
            .post(format!("{}/inference", self.base_url))
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(format!("Server returned {}: {}", status.as_u16(), body));
        }

        // Parse JSON response - whisper.cpp returns {"text": "..."}
        let json: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Failed to parse response: {} - body: {}", e, body))?;

        json.get("text")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("Response missing 'text' field: {}", body))
    }
}

/// Encode Float32 PCM samples to WAV format.
/// Minimal inline implementation - no external audio crate needed.
fn encode_wav(samples: &[f32]) -> Result<Vec<u8>, String> {
    let num_samples = samples.len();
    let data_size = (num_samples * 2) as u32; // 16-bit samples
    let file_size = 36u32 + data_size; // Total file size minus 8 bytes

    let mut buffer = Vec::with_capacity(44 + data_size as usize);

    // RIFF header
    buffer.extend_from_slice(b"RIFF");
    buffer.extend_from_slice(&file_size.to_le_bytes());
    buffer.extend_from_slice(b"WAVE");

    // fmt chunk
    buffer.extend_from_slice(b"fmt ");
    buffer.extend_from_slice(&16u32.to_le_bytes()); // Chunk size
    buffer.extend_from_slice(&1u16.to_le_bytes()); // Audio format (PCM)
    buffer.extend_from_slice(&CHANNELS.to_le_bytes());
    buffer.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    // Byte rate = sample_rate * num_channels * bits_per_sample/8
    let byte_rate = SAMPLE_RATE * CHANNELS as u32 * (BITS_PER_SAMPLE as u32 / 8);
    buffer.extend_from_slice(&byte_rate.to_le_bytes());
    // Block align = num_channels * bits_per_sample/8
    let block_align = CHANNELS * (BITS_PER_SAMPLE / 8);
    buffer.extend_from_slice(&block_align.to_le_bytes());
    buffer.extend_from_slice(&BITS_PER_SAMPLE.to_le_bytes());

    // data chunk
    buffer.extend_from_slice(b"data");
    buffer.extend_from_slice(&data_size.to_le_bytes());

    // Convert Float32 to Int16 and write samples
    for &sample in samples {
        // Clamp to [-1.0, 1.0] and convert to i16
        let clamped = sample.max(-1.0).min(1.0);
        let int_sample = (clamped * 32767.0) as i16;
        buffer.extend_from_slice(&int_sample.to_le_bytes());
    }

    Ok(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_wav() {
        // Generate 1 second of 440Hz sine wave at 16kHz
        let samples: Vec<f32> = (0..16000)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 16000.0).sin())
            .collect();

        let wav = encode_wav(&samples).unwrap();
        
        // Verify WAV header
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(&wav[36..40], b"data");
        
        // Should have 44 byte header + 32000 bytes of data (16000 samples * 2 bytes)
        assert_eq!(wav.len(), 32044);
    }
}
