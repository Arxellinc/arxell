use super::*;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::net::TcpListener;
use std::thread;
use std::time::Duration;

struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("arxell-kokoro-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn assert_only(&self, name: &str) {
        let files: Vec<_> = fs::read_dir(&self.0)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(files, vec![std::ffi::OsString::from(name)]);
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn serve_once(body: Vec<u8>, extra_length: usize) -> (String, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/asset", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let handle = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "download never reached fixture");
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("fixture accept failed: {error}"),
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            assert_eq!(stream.read(&mut byte).unwrap(), 1);
            request.push(byte[0]);
            assert!(request.len() < 16 * 1024);
        }
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len() + extra_length
        )
        .unwrap();
        stream.write_all(&body).unwrap();
    });
    (url, handle)
}

fn resources() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("resources")
}

#[test]
fn published_kokoro_assets_install_without_sherpa_metadata() {
    let model = resources().join("kokoro/model_quantized.onnx");
    let voices = resources().join("kokoro/voices-v1.0.bin");
    assert!(!file_contains_bytes(&model, b"sample_rate"));
    verify_kokoro_asset(&model, KOKORO_MODEL_SIZE_BYTES, KOKORO_MODEL_SHA256, true)
        .expect("the published direct-ORT model must not need Sherpa sample_rate metadata");
    verify_kokoro_asset(
        &voices,
        KOKORO_VOICES_SIZE_BYTES,
        KOKORO_VOICES_SHA256,
        false,
    )
    .expect("the matching voice pack must validate");
}

#[test]
fn kokoro_asset_validation_rejects_empty_truncated_and_same_size_corruption() {
    let dir = TestDir::new();
    let path = dir.0.join("model.onnx");
    let expected = b"fixture";
    for (body, error) in [
        (b"".as_slice(), "empty"),
        (b"short".as_slice(), "size mismatch"),
        (b"corrupt".as_slice(), "checksum mismatch"),
    ] {
        fs::write(&path, body).unwrap();
        assert!(
            verify_kokoro_asset(&path, expected.len() as u64, &digest(expected), true)
                .unwrap_err()
                .contains(error)
        );
    }
}

#[test]
fn kokoro_voice_validation_still_requires_a_real_voice_pack() {
    let dir = TestDir::new();
    let path = dir.0.join("voices.bin");
    let invalid = b"not a voice pack";
    fs::write(&path, invalid).unwrap();
    assert!(
        verify_kokoro_asset(&path, invalid.len() as u64, &digest(invalid), false)
            .unwrap_err()
            .contains("no voices")
    );
}

#[test]
fn kokoro_download_installs_repairs_and_reuses_only_verified_assets() {
    let dir = TestDir::new();
    let destination = dir.0.join("model.onnx");
    let body = b"model fixture";
    let hash = digest(body);
    for corrupt_cache in [false, true] {
        if corrupt_cache {
            fs::write(&destination, b"wrong fixture").unwrap();
        }
        let (url, server) = serve_once(body.to_vec(), 0);
        assert_eq!(
            download_verified_kokoro_asset(&url, &destination, body.len() as u64, &hash, true)
                .unwrap(),
            destination
        );
        server.join().unwrap();
        assert_eq!(fs::read(&destination).unwrap(), body);
        dir.assert_only("model.onnx");
    }
    let modified = fs::metadata(&destination).unwrap().modified().unwrap();
    // A verified cached asset must not attempt any network access.
    download_verified_kokoro_asset("invalid-url", &destination, body.len() as u64, &hash, true)
        .unwrap();
    assert_eq!(
        fs::metadata(&destination).unwrap().modified().unwrap(),
        modified
    );
}

#[test]
fn kokoro_bad_or_interrupted_download_preserves_existing_file_and_cleans_temporary() {
    for extra_length in [0, 64] {
        let dir = TestDir::new();
        let destination = dir.0.join("model.onnx");
        fs::write(&destination, b"previous asset").unwrap();
        let (url, server) = serve_once(b"corrupt".to_vec(), extra_length);
        assert!(
            download_verified_kokoro_asset(&url, &destination, 7, &digest(b"fixture"), true)
                .is_err()
        );
        server.join().unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"previous asset");
        dir.assert_only("model.onnx");
    }
}

#[test]
#[ignore = "requires the platform ONNX Runtime and espeak-ng resources; performs real CPU synthesis"]
fn kokoro_fresh_install_synthesizes_real_audio() {
    let resources = std::env::var_os("ARXELL_TEST_VOICE_RESOURCES")
        .map(PathBuf::from)
        .unwrap_or_else(resources);
    let dir = TestDir::new();
    for (name, size, hash, is_model) in [
        (
            "model_quantized.onnx",
            KOKORO_MODEL_SIZE_BYTES,
            KOKORO_MODEL_SHA256,
            true,
        ),
        (
            "voices-v1.0.bin",
            KOKORO_VOICES_SIZE_BYTES,
            KOKORO_VOICES_SHA256,
            false,
        ),
    ] {
        let source = resources.join("kokoro").join(name);
        let (url, server) = serve_once(fs::read(source).unwrap(), 0);
        download_verified_kokoro_asset(&url, &dir.0.join(name), size, hash, is_model).unwrap();
        server.join().unwrap();
    }
    let ort = bundled_ort_library_path(&resources).expect("platform ONNX Runtime is required");
    init_onnxruntime(&ort).unwrap();
    let phonemizer = EspeakPhonemizer::new(&resources).unwrap();
    let phonemes = phonemizer
        .phonemize("Hello. This is a fresh Arxell voice installation.")
        .unwrap();
    let (samples, sample_rate) = synthesize_phonemes(
        &dir.0.join("model_quantized.onnx"),
        &resources.join("kokoro/config.json"),
        &dir.0.join("voices-v1.0.bin"),
        Some("af_heart"),
        &phonemes,
        1.0,
    )
    .expect("downloaded artifacts must produce actual speech, not merely pass installation");
    assert_eq!(sample_rate, 24_000);
    assert!(samples.len() > 2_400);
    assert!(samples.iter().all(|value| value.is_finite()));
    assert!(samples.iter().any(|value| value.abs() > 0.001));
    let wav = wav_from_f32_samples(&samples, sample_rate);
    assert!(wav.starts_with(b"RIFF"));
    assert!(wav.len() > 44);
    eprintln!(
        "Fresh Kokoro installation produced {} samples at {sample_rate} Hz",
        samples.len()
    );
}
