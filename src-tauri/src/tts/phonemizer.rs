#![cfg(feature = "tauri-runtime")]

use std::path::{Path, PathBuf};
use std::process::Command;

pub trait Phonemizer: Send + Sync {
    fn phonemize(&self, text: &str) -> Result<String, String>;
}

#[derive(Debug, Clone)]
pub struct EspeakPhonemizer {
    bin_path: PathBuf,
    data_path: Option<PathBuf>,
    is_system: bool,
}

impl EspeakPhonemizer {
    pub fn new(resources_dir: &Path) -> Result<Self, String> {
        let base = resources_dir.join("espeak-ng");
        let bin_candidates = [
            base.join("espeak-ng"),
            base.join("bin").join("espeak-ng"),
        ];
        if let Some(bin_path) = bin_candidates.iter().find(|p| p.is_file()).cloned() {
            let data_candidates = [
                base.join("espeak-ng-data"),
                base.join("share").join("espeak-ng-data"),
            ];
            let data_path = data_candidates
                .iter()
                .find(|p| p.is_dir())
                .cloned()
                .ok_or_else(|| "bundled espeak-ng-data not found in resources/espeak-ng".to_string())?;
            log::info!("[tts] using bundled espeak-ng: {:?}", bin_path);
            return Ok(Self { bin_path, data_path: Some(data_path), is_system: false });
        }

        let system_bin = which_espeak_ng();
        if let Some(bin_path) = system_bin {
            log::warn!("[tts] bundled espeak-ng not found, falling back to system binary: {:?}", bin_path);
            return Ok(Self { bin_path, data_path: None, is_system: true });
        }

        Err("espeak-ng not found: neither bundled binary nor system binary available".to_string())
    }

    pub fn bin_path(&self) -> &Path {
        &self.bin_path
    }

    pub fn data_path(&self) -> Option<&Path> {
        self.data_path.as_deref()
    }
}

fn which_espeak_ng() -> Option<PathBuf> {
    let candidates = ["espeak-ng", "espeak"];
    for name in &candidates {
        if let Ok(output) = std::process::Command::new("which")
            .arg(name)
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    let p = PathBuf::from(&path);
                    if p.is_file() {
                        return Some(p);
                    }
                }
            }
        }
    }
    None
}

impl Phonemizer for EspeakPhonemizer {
    fn phonemize(&self, text: &str) -> Result<String, String> {
        let mut cmd = Command::new(&self.bin_path);
        if let Some(ref data_path) = self.data_path {
            cmd.env("ESPEAK_DATA_PATH", data_path);
        }
        let output = cmd
            .arg("-q")
            .arg("--ipa")
            .arg("-v")
            .arg("en-us")
            .arg(text)
            .output()
            .map_err(|e| {
                if self.is_system {
                    format!("failed to run system espeak-ng: {e}")
                } else {
                    format!("failed to run bundled espeak-ng: {e}")
                }
            })?;
        if !output.status.success() {
            return Err(format!(
                "espeak-ng failed with status {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockPhonemizer {
        output: String,
    }

    impl Phonemizer for MockPhonemizer {
        fn phonemize(&self, _text: &str) -> Result<String, String> {
            Ok(self.output.clone())
        }
    }

    #[test]
    fn mock_phonemizer_returns_fixed_output() {
        let mock = MockPhonemizer {
            output: "hɛˈloʊ".to_string(),
        };
        let result = mock.phonemize("hello");
        assert_eq!(result.unwrap(), "hɛˈloʊ");
    }

    #[test]
    fn espeak_phonemizer_missing_binary_falls_back_or_errors() {
        let result = EspeakPhonemizer::new(Path::new("/nonexistent"));
        match result {
            Ok(phonemizer) => {
                assert!(phonemizer.is_system, "expected system fallback");
            }
            Err(err) => {
                assert!(
                    err.contains("espeak-ng not found"),
                    "unexpected error: {err}"
                );
            }
        }
    }
}
