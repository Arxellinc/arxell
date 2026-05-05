#![cfg(feature = "tauri-runtime")]

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct KokoroConfig {
    vocab: HashMap<String, i64>,
}

#[derive(Debug, Clone)]
pub struct KokoroTokenizer {
    vocab: HashMap<char, i64>,
}

impl KokoroTokenizer {
    pub fn from_config_path(path: &Path) -> Result<Self, String> {
        let raw = fs::read_to_string(path)
            .map_err(|e| format!("failed reading kokoro config at {}: {e}", path.display()))?;
        let config: KokoroConfig =
            serde_json::from_str(&raw).map_err(|e| format!("invalid kokoro config json: {e}"))?;
        let mut vocab = HashMap::new();
        for (k, v) in config.vocab {
            let mut chars = k.chars();
            if let Some(ch) = chars.next() {
                if chars.next().is_none() {
                    vocab.insert(ch, v);
                }
            }
        }
        Ok(Self { vocab })
    }

    pub fn tokenize_phonemes(&self, phonemes: &str) -> Vec<i64> {
        phonemes
            .chars()
            .filter_map(|ch| self.vocab.get(&ch).copied())
            .collect()
    }

    pub fn pad_with_boundaries(&self, tokens: &[i64]) -> Vec<i64> {
        let mut out = Vec::with_capacity(tokens.len() + 2);
        out.push(0);
        out.extend_from_slice(tokens);
        out.push(0);
        out
    }

    pub fn token_count(&self, phonemes: &str) -> usize {
        self.tokenize_phonemes(phonemes).len()
    }
}

#[cfg(test)]
mod tests {
    use super::KokoroTokenizer;
    use std::path::Path;

    fn tokenizer() -> KokoroTokenizer {
        KokoroTokenizer::from_config_path(Path::new("resources/kokoro/config.json"))
            .expect("tokenizer should load config")
    }

    #[test]
    fn tokenizes_known_symbols_and_drops_unknown() {
        let t = tokenizer();
        let tokens = t.tokenize_phonemes("a?🙂");
        assert_eq!(tokens, vec![43, 6]);
    }

    #[test]
    fn pads_with_zero_boundaries() {
        let t = tokenizer();
        let padded = t.pad_with_boundaries(&[43, 6]);
        assert_eq!(padded, vec![0, 43, 6, 0]);
    }

    #[test]
    fn empty_input_yields_empty_tokens() {
        let t = tokenizer();
        assert!(t.tokenize_phonemes("").is_empty());
        assert!(t.tokenize_phonemes("🙂🤖").is_empty());
    }

    #[test]
    fn stress_and_punctuation_symbols() {
        let t = tokenizer();
        let tokens = t.tokenize_phonemes("ˈˌːʰʲ");
        assert_eq!(tokens, vec![156, 157, 158, 162, 164]);
    }

    #[test]
    fn multi_char_phoneme_string() {
        let t = tokenizer();
        let tokens = t.tokenize_phonemes("hɛˈloʊ wɜːld");
        assert_eq!(tokens, vec![50, 86, 156, 54, 57, 135, 16, 65, 87, 158, 54, 46]);
    }

    #[test]
    fn boundary_padding_on_empty() {
        let t = tokenizer();
        let padded = t.pad_with_boundaries(&[]);
        assert_eq!(padded, vec![0, 0]);
    }

    #[test]
    fn long_sequence_within_limit() {
        let t = tokenizer();
        let phonemes: String = "ɑ".repeat(500);
        let tokens = t.tokenize_phonemes(&phonemes);
        assert_eq!(tokens.len(), 500);
        let padded = t.pad_with_boundaries(&tokens);
        assert_eq!(padded.len(), 502);
        assert_eq!(*padded.first().unwrap(), 0);
        assert_eq!(*padded.last().unwrap(), 0);
    }

    #[test]
    fn mixed_ipa_phonemes() {
        let t = tokenizer();
        let tokens = t.tokenize_phonemes("ðɪs ɪz ɐ tɛst");
        assert!(tokens.len() > 0);
        assert!(tokens.iter().all(|&t| t > 0));
    }
}
