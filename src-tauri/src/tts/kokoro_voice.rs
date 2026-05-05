#![cfg(feature = "tauri-runtime")]

use std::fs;
use std::io::Read;
use std::path::Path;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

static VOICE_DATA_CACHE: OnceLock<Mutex<HashMap<String, Vec<f32>>>> = OnceLock::new();

fn voice_cache() -> &'static Mutex<HashMap<String, Vec<f32>>> {
    VOICE_DATA_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn load_voice_style(path: &Path, token_len: usize) -> Result<Vec<f32>, String> {
    load_voice_style_named(path, None, token_len)
}

pub fn load_voice_style_named(path: &Path, voice_name: Option<&str>, token_len: usize) -> Result<Vec<f32>, String> {
    let cache_key = format!("{}::{}", path.display(), voice_name.unwrap_or(""));
    if let Ok(guard) = voice_cache().lock() {
        if let Some(values) = guard.get(&cache_key) {
            return select_style(values, token_len);
        }
    }

    let bytes = fs::read(path)
        .map_err(|e| format!("failed reading voice embedding at {}: {e}", path.display()))?;

    let values = if bytes.starts_with(b"PK") {
        load_voice_data_from_zip(&bytes, voice_name)?
    } else {
        parse_raw_voice_f32(&bytes)?
    };

    let style = select_style(&values, token_len)?;
    if let Ok(mut guard) = voice_cache().lock() {
        guard.insert(cache_key, values);
    }
    Ok(style)
}

fn select_style(values: &[f32], token_len: usize) -> Result<Vec<f32>, String> {
    if values.len() % 256 != 0 {
        return Err("voice embedding does not align to 256-width vectors".to_string());
    }
    let num_styles = values.len() / 256;
    let index = token_len.min(num_styles.saturating_sub(1));
    let start = index * 256;
    Ok(values[start..start + 256].to_vec())
}

fn parse_raw_voice_f32(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() % 4 != 0 {
        return Err("voice embedding length is not a multiple of 4".to_string());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn load_voice_data_from_zip(data: &[u8], voice_name: Option<&str>) -> Result<Vec<f32>, String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data))
        .map_err(|e| format!("failed reading voices zip: {e}"))?;
    let target = voice_name
        .map(|name| format!("{name}.npy"))
        .unwrap_or_else(|| "af_heart.npy".to_string());
    let mut npy_bytes = Vec::new();
    {
        let mut file = archive.by_name(&target)
            .map_err(|e| format!("voice '{target}' not found in pack: {e}"))?;
        file.read_to_end(&mut npy_bytes)
            .map_err(|e| format!("failed reading npy: {e}"))?;
    }
    parse_npy_f32(&npy_bytes)
}

fn parse_npy_f32(data: &[u8]) -> Result<Vec<f32>, String> {
    if data.len() < 10 || !data.starts_with(b"\x93NUMPY") {
        return Err("not a valid npy file".to_string());
    }
    let version = data[6];
    let data_start = if version == 1 {
        let header_len = u16::from_le_bytes([data[8], data[9]]) as usize;
        10 + header_len
    } else if version == 2 {
        let header_len = u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize;
        12 + header_len
    } else {
        return Err(format!("unsupported npy version: {version}"));
    };
    if data_start >= data.len() {
        return Err("npy data offset exceeds file size".to_string());
    }
    let raw = &data[data_start..];
    if raw.len() % 4 != 0 {
        return Err("npy payload length is not a multiple of 4".to_string());
    }
    let values: Vec<f32> = raw
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();
    Ok(values)
}

fn find_data_offset(_data: &[u8]) -> usize {
    10
}

pub fn list_voices_in_pack(path: &Path) -> Result<Vec<String>, String> {
    let bytes = fs::read(path)
        .map_err(|e| format!("failed reading voices pack: {e}"))?;
    if !bytes.starts_with(b"PK") {
        return Ok(vec![]);
    }
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&bytes))
        .map_err(|e| format!("failed reading voices zip: {e}"))?;
    let mut names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            let name = file.name();
            if name.ends_with(".npy") {
                let voice_name = name.trim_end_matches(".npy");
                names.push(voice_name.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn voice_path(name: &str) -> PathBuf {
        PathBuf::from(format!("resources/kokoro/{name}"))
    }

    #[test]
    fn loads_af_heart_voice() {
        let path = voice_path("af_heart.bin");
        if !path.exists() {
            eprintln!("skipping: voice file not found");
            return;
        }
        let style = load_voice_style(&path, 10).expect("should load voice");
        assert_eq!(style.len(), 256);
    }

    #[test]
    fn loads_voice_from_v1_pack() {
        let path = voice_path("voices-v1.0.bin");
        if !path.exists() {
            eprintln!("skipping: voices-v1.0.bin not found");
            return;
        }
        let style = load_voice_style_named(&path, Some("af_heart"), 10).expect("should load af_heart from pack");
        assert_eq!(style.len(), 256);

        let style2 = load_voice_style_named(&path, Some("am_adam"), 10).expect("should load am_adam from pack");
        assert_eq!(style2.len(), 256);
        assert_ne!(style, style2, "different voices should have different embeddings");
    }

    #[test]
    fn lists_voices_in_v1_pack() {
        let path = voice_path("voices-v1.0.bin");
        if !path.exists() {
            eprintln!("skipping: voices-v1.0.bin not found");
            return;
        }
        let voices = list_voices_in_pack(&path).expect("should list voices");
        assert!(voices.len() > 10, "v1.0 pack should have many voices, got {}", voices.len());
        assert!(voices.contains(&"af_heart".to_string()));
        assert!(voices.contains(&"am_adam".to_string()));
        eprintln!("v1.0 pack has {} voices", voices.len());
    }

    #[test]
    fn loads_all_bundled_voices() {
        for name in &["af.bin", "af_heart.bin", "af_bella.bin", "af_jessica.bin"] {
            let path = voice_path(name);
            if !path.exists() {
                continue;
            }
            let style = load_voice_style(&path, 5).expect("should load voice");
            assert_eq!(style.len(), 256, "voice {name} should return 256-wide style");
        }
    }

    #[test]
    fn clamp_at_last_style_index() {
        let path = voice_path("af_heart.bin");
        if !path.exists() {
            eprintln!("skipping: voice file not found");
            return;
        }
        let style_short = load_voice_style(&path, 5).expect("should load");
        let style_long = load_voice_style(&path, 100000).expect("should load");
        assert_eq!(style_short.len(), 256);
        assert_eq!(style_long.len(), 256);
    }

    #[test]
    fn missing_file_returns_error() {
        let result = load_voice_style(Path::new("/nonexistent/voice.bin"), 10);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("failed reading"));
    }

    #[test]
    fn invalid_alignment_returns_error() {
        let dir = std::env::temp_dir().join("kokoro_voice_test");
        fs::create_dir_all(&dir).ok();
        let bad_file = dir.join("bad_voice.bin");
        fs::write(&bad_file, [0u8; 100]).expect("write temp file");
        let result = load_voice_style(&bad_file, 10);
        assert!(result.is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
