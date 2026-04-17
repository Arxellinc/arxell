use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKittenModelConfig,
    OfflineTtsKokoroModelConfig, OfflineTtsMatchaModelConfig, OfflineTtsModelConfig,
    OfflineTtsVitsModelConfig,
};
use std::path::{Path, PathBuf};

fn voice_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("voice")
}

fn assert_exists(path: &Path) {
    assert!(
        path.exists(),
        "missing expected test asset: {}",
        path.display()
    );
}

fn find_first_file_with_ext(root: &Path, ext: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case(ext))
                .unwrap_or(false)
        {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_first_file_with_ext(&path, ext) {
                return Some(found);
            }
        }
    }
    None
}

fn find_first_file_named(root: &Path, file_name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case(file_name))
                .unwrap_or(false)
        {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_first_file_named(&path, file_name) {
                return Some(found);
            }
        }
    }
    None
}

fn find_first_dir_named(root: &Path, dir_name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case(dir_name))
                .unwrap_or(false)
            {
                return Some(path);
            }
            if let Some(found) = find_first_dir_named(&path, dir_name) {
                return Some(found);
            }
        }
    }
    None
}

fn synthesize_and_assert(tts: OfflineTts, text: &str) {
    let mut cfg = GenerationConfig::default();
    cfg.speed = 1.0;
    cfg.sid = 0;
    let generated = tts
        .generate_with_config::<fn(&[f32], f32) -> bool>(text, &cfg, None)
        .expect("engine returned no audio");
    assert!(generated.sample_rate() > 0, "sample rate must be > 0");
    assert!(
        !generated.samples().is_empty(),
        "generated audio must contain samples"
    );
}

fn build_kokoro() -> OfflineTts {
    let root = voice_root();
    let espeak = root.join("espeak-ng-data");
    let model = root.join("kokoro").join("kokoro-v1.0.int8.onnx");
    let voices = root.join("kokoro").join("voices-v1.0.bin");
    let tokens = root.join("kokoro").join("tokens.txt");
    assert_exists(&espeak);
    assert_exists(&model);
    assert_exists(&voices);
    assert_exists(&tokens);
    OfflineTts::create(&OfflineTtsConfig {
        model: OfflineTtsModelConfig {
            kokoro: OfflineTtsKokoroModelConfig {
                model: Some(model.to_string_lossy().to_string()),
                voices: Some(voices.to_string_lossy().to_string()),
                tokens: Some(tokens.to_string_lossy().to_string()),
                data_dir: Some(espeak.to_string_lossy().to_string()),
                lang: Some("en-us".to_string()),
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("failed to create Kokoro TTS")
}

fn build_piper() -> OfflineTts {
    let root = voice_root();
    let piper_root = root.join("piper");
    let model = find_first_file_with_ext(&piper_root, "onnx")
        .expect("missing expected Piper ONNX model under resources/voice/piper");
    let tokens = find_first_file_named(&piper_root, "tokens.txt")
        .expect("missing expected Piper tokens.txt under resources/voice/piper");
    let espeak = find_first_dir_named(&piper_root, "espeak-ng-data")
        .unwrap_or_else(|| root.join("espeak-ng-data"));
    assert_exists(&espeak);
    assert_exists(&model);
    assert_exists(&tokens);
    OfflineTts::create(&OfflineTtsConfig {
        model: OfflineTtsModelConfig {
            vits: OfflineTtsVitsModelConfig {
                model: Some(model.to_string_lossy().to_string()),
                tokens: Some(tokens.to_string_lossy().to_string()),
                data_dir: Some(espeak.to_string_lossy().to_string()),
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("failed to create Piper TTS")
}

fn build_matcha() -> OfflineTts {
    let root = voice_root();
    let espeak = root.join("espeak-ng-data");
    let acoustic_model = root.join("matcha").join("model.onnx");
    let vocoder = root.join("matcha").join("vocoder.onnx");
    let tokens = root.join("matcha").join("tokens.txt");
    assert_exists(&espeak);
    assert_exists(&acoustic_model);
    assert_exists(&vocoder);
    assert_exists(&tokens);
    OfflineTts::create(&OfflineTtsConfig {
        model: OfflineTtsModelConfig {
            matcha: OfflineTtsMatchaModelConfig {
                acoustic_model: Some(acoustic_model.to_string_lossy().to_string()),
                vocoder: Some(vocoder.to_string_lossy().to_string()),
                tokens: Some(tokens.to_string_lossy().to_string()),
                data_dir: Some(espeak.to_string_lossy().to_string()),
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("failed to create Matcha TTS")
}

fn build_kitten() -> OfflineTts {
    let root = voice_root();
    let espeak = root.join("espeak-ng-data");
    let model = root.join("kitten").join("model.fp16.onnx");
    let voices = root.join("kitten").join("voices.bin");
    let tokens = root.join("kitten").join("tokens.txt");
    assert_exists(&espeak);
    assert_exists(&model);
    assert_exists(&voices);
    assert_exists(&tokens);
    OfflineTts::create(&OfflineTtsConfig {
        model: OfflineTtsModelConfig {
            kitten: OfflineTtsKittenModelConfig {
                model: Some(model.to_string_lossy().to_string()),
                voices: Some(voices.to_string_lossy().to_string()),
                tokens: Some(tokens.to_string_lossy().to_string()),
                data_dir: Some(espeak.to_string_lossy().to_string()),
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    })
    .expect("failed to create Kitten TTS")
}

#[test]
#[ignore = "runtime smoke test for local bundled Kokoro engine"]
fn kokoro_generates_audio() {
    let tts = build_kokoro();
    synthesize_and_assert(tts, "Kokoro engine runtime smoke test from Arxell Lite.");
}

#[test]
#[ignore = "runtime smoke test for local bundled Piper engine"]
fn piper_generates_audio() {
    let tts = build_piper();
    synthesize_and_assert(tts, "Piper engine runtime smoke test from Arxell Lite.");
}

#[test]
#[ignore = "runtime smoke test for local bundled Matcha engine"]
fn matcha_generates_audio() {
    let tts = build_matcha();
    synthesize_and_assert(tts, "Matcha engine runtime smoke test from Arxell Lite.");
}

#[test]
#[ignore = "runtime smoke test for local bundled Kitten engine"]
fn kitten_generates_audio() {
    let tts = build_kitten();
    synthesize_and_assert(tts, "Kitten engine runtime smoke test from Arxell Lite.");
}
