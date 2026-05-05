#![cfg(feature = "tauri-runtime")]

use std::ffi::CString;
use std::os::raw::c_void;
use std::path::Path;
use std::ptr;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::tts::kokoro_frontend::KokoroTokenizer;
use crate::tts::kokoro_voice;

static ORT_LIB: OnceLock<libloading::Library> = OnceLock::new();
static ORT_SESSION_CACHE: OnceLock<Mutex<HashMap<String, CachedSession>>> = OnceLock::new();

#[derive(Clone)]
struct CachedSession {
    env: *mut ort_sys::OrtEnv,
    session: *mut ort_sys::OrtSession,
    input_names: Vec<String>,
    output_names: Vec<String>,
}

unsafe impl Send for CachedSession {}
unsafe impl Sync for CachedSession {}

pub fn init_onnxruntime(lib_path: &Path) -> Result<(), String> {
    if ORT_LIB.get().is_some() {
        return Ok(());
    }
    let library = unsafe { libloading::Library::new(lib_path) }
        .map_err(|e| format!("failed loading ONNX Runtime from {}: {e}", lib_path.display()))?;
    let _ = ORT_LIB.set(library);
    Ok(())
}

unsafe fn ort_api() -> Result<&'static ort_sys::OrtApi, String> {
    let base = if let Some(lib) = ORT_LIB.get() {
        let base_getter: libloading::Symbol<unsafe extern "C" fn() -> *const ort_sys::OrtApiBase> =
            unsafe { lib.get(b"OrtGetApiBase") }
                .map_err(|_| "expected `OrtGetApiBase` to be present in libonnxruntime".to_string())?;
        unsafe { base_getter() }
    } else {
        ort_sys::OrtGetApiBase()
    };
    if base.is_null() {
        return Err("ORT: OrtGetApiBase returned null (is onnxruntime shared library available?)".to_string());
    }
    let base_ref = &*base;
    let get_api = base_ref.GetApi.ok_or_else(|| "ORT: GetApi function missing from OrtApiBase".to_string())?;
    let api_ptr = get_api(19);
    if api_ptr.is_null() {
        return Err("ORT: GetApi(19) returned null (onnxruntime version mismatch, expected ORT API v19+)".to_string());
    }
    Ok(&*api_ptr)
}

unsafe fn check_status(status: *mut ort_sys::OrtStatus) -> Result<(), String> {
    if status.is_null() {
        return Ok(());
    }
    let api = ort_api()?;
    let msg_ptr = api.GetErrorMessage.ok_or_else(|| "ORT: GetErrorMessage missing".to_string())?(status);
    let msg = std::ffi::CStr::from_ptr(msg_ptr)
        .to_string_lossy()
        .into_owned();
    if let Some(release) = api.ReleaseStatus {
        release(status);
    }
    Err(msg)
}

unsafe fn create_memory_info() -> Result<*mut ort_sys::OrtMemoryInfo, String> {
    let api = ort_api()?;
    let create = api.CreateCpuMemoryInfo.ok_or_else(|| "ORT: CreateCpuMemoryInfo missing".to_string())?;
    let mut mem_info: *mut ort_sys::OrtMemoryInfo = ptr::null_mut();
    let status = create(
        ort_sys::OrtAllocatorType::OrtArenaAllocator,
        ort_sys::OrtMemType::OrtMemTypeDefault,
        &mut mem_info,
    );
    check_status(status)?;
    Ok(mem_info)
}

unsafe fn create_f32_tensor(
    data: &[f32],
    shape: &[usize],
    mem_info: *mut ort_sys::OrtMemoryInfo,
) -> Result<*mut ort_sys::OrtValue, String> {
    let api = ort_api()?;
    let create = api.CreateTensorWithDataAsOrtValue.ok_or_else(|| "ORT: CreateTensorWithDataAsOrtValue missing".to_string())?;
    let shape_i64: Vec<i64> = shape.iter().map(|&s| s as i64).collect();
    let mut ort_value: *mut ort_sys::OrtValue = ptr::null_mut();
    let status = create(
        mem_info,
        data.as_ptr() as *mut c_void,
        data.len() * std::mem::size_of::<f32>(),
        shape_i64.as_ptr(),
        shape_i64.len(),
        ort_sys::ONNXTensorElementDataType::ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT,
        &mut ort_value,
    );
    check_status(status)?;
    Ok(ort_value)
}

unsafe fn create_i64_tensor(
    data: &[i64],
    shape: &[usize],
    mem_info: *mut ort_sys::OrtMemoryInfo,
) -> Result<*mut ort_sys::OrtValue, String> {
    let api = ort_api()?;
    let create = api.CreateTensorWithDataAsOrtValue.ok_or_else(|| "ORT: CreateTensorWithDataAsOrtValue missing".to_string())?;
    let shape_i64: Vec<i64> = shape.iter().map(|&s| s as i64).collect();
    let mut ort_value: *mut ort_sys::OrtValue = ptr::null_mut();
    let status = create(
        mem_info,
        data.as_ptr() as *mut c_void,
        data.len() * std::mem::size_of::<i64>(),
        shape_i64.as_ptr(),
        shape_i64.len(),
        ort_sys::ONNXTensorElementDataType::ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64,
        &mut ort_value,
    );
    check_status(status)?;
    Ok(ort_value)
}

unsafe fn extract_f32_data(ort_value: *mut ort_sys::OrtValue) -> Result<Vec<f32>, String> {
    let api = ort_api()?;

    let mut data_ptr: *mut c_void = ptr::null_mut();
    let status = api.GetTensorMutableData.ok_or_else(|| "ORT: GetTensorMutableData missing".to_string())?(ort_value, &mut data_ptr);
    check_status(status)?;

    let mut tensor_info: *mut ort_sys::OrtTensorTypeAndShapeInfo = ptr::null_mut();
    let status = api.GetTensorTypeAndShape.ok_or_else(|| "ORT: GetTensorTypeAndShape missing".to_string())?(ort_value, &mut tensor_info);
    check_status(status)?;

    let mut dims_count: usize = 0;
    let status = api.GetDimensionsCount.ok_or_else(|| "ORT: GetDimensionsCount missing".to_string())?(tensor_info, &mut dims_count);
    check_status(status)?;

    let mut dims: Vec<i64> = vec![0; dims_count];
    let status = api.GetDimensions.ok_or_else(|| "ORT: GetDimensions missing".to_string())?(tensor_info, dims.as_mut_ptr(), dims_count);
    check_status(status)?;

    if let Some(release) = api.ReleaseTensorTypeAndShapeInfo {
        release(tensor_info);
    }

    let total: usize = dims.iter().map(|&d| d.max(0) as usize).product();
    let slice = std::slice::from_raw_parts(data_ptr as *const f32, total);
    Ok(slice.to_vec())
}

unsafe fn release_value(value: *mut ort_sys::OrtValue) {
    if let Ok(api) = ort_api() {
        if let Some(release) = api.ReleaseValue {
            release(value);
        }
    }
}

unsafe fn release_memory_info(info: *mut ort_sys::OrtMemoryInfo) {
    if let Ok(api) = ort_api() {
        if let Some(release) = api.ReleaseMemoryInfo {
            release(info);
        }
    }
}

unsafe fn release_session(session: *mut ort_sys::OrtSession) {
    if let Ok(api) = ort_api() {
        if let Some(release) = api.ReleaseSession {
            release(session);
        }
    }
}

unsafe fn release_session_options(opts: *mut ort_sys::OrtSessionOptions) {
    if let Ok(api) = ort_api() {
        if let Some(release) = api.ReleaseSessionOptions {
            release(opts);
        }
    }
}

unsafe fn release_env(env: *mut ort_sys::OrtEnv) {
    if let Ok(api) = ort_api() {
        if let Some(release) = api.ReleaseEnv {
            release(env);
        }
    }
}

fn session_cache() -> &'static Mutex<HashMap<String, CachedSession>> {
    ORT_SESSION_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

unsafe fn query_session_names(
    session: *mut ort_sys::OrtSession,
) -> Result<(Vec<String>, Vec<String>), String> {
    let api = ort_api()?;

    let get_input_count = api.SessionGetInputCount
        .ok_or_else(|| "ORT: SessionGetInputCount missing".to_string())?;
    let get_output_count = api.SessionGetOutputCount
        .ok_or_else(|| "ORT: SessionGetOutputCount missing".to_string())?;
    let get_input_name = api.SessionGetInputName
        .ok_or_else(|| "ORT: SessionGetInputName missing".to_string())?;
    let get_output_name = api.SessionGetOutputName
        .ok_or_else(|| "ORT: SessionGetOutputName missing".to_string())?;
    let get_allocator = api.GetAllocatorWithDefaultOptions
        .ok_or_else(|| "ORT: GetAllocatorWithDefaultOptions missing".to_string())?;
    let allocator_free = api.AllocatorFree
        .ok_or_else(|| "ORT: AllocatorFree missing".to_string())?;

    let mut allocator: *mut ort_sys::OrtAllocator = ptr::null_mut();
    check_status(get_allocator(&mut allocator))?;

    let mut input_count: usize = 0;
    check_status(get_input_count(session, &mut input_count))?;

    let mut output_count: usize = 0;
    check_status(get_output_count(session, &mut output_count))?;

    let mut input_names = Vec::with_capacity(input_count);
    for i in 0..input_count {
        let mut name_ptr: *mut std::os::raw::c_char = ptr::null_mut();
        check_status(get_input_name(session, i, allocator, &mut name_ptr))?;
        let name = std::ffi::CStr::from_ptr(name_ptr).to_string_lossy().into_owned();
        input_names.push(name);
        allocator_free(allocator, name_ptr as *mut c_void);
    }

    let mut output_names = Vec::with_capacity(output_count);
    for i in 0..output_count {
        let mut name_ptr: *mut std::os::raw::c_char = ptr::null_mut();
        check_status(get_output_name(session, i, allocator, &mut name_ptr))?;
        let name = std::ffi::CStr::from_ptr(name_ptr).to_string_lossy().into_owned();
        output_names.push(name);
        allocator_free(allocator, name_ptr as *mut c_void);
    }

    Ok((input_names, output_names))
}

unsafe fn get_or_create_session(model_path: &Path) -> Result<CachedSession, String> {
    let cache_key = model_path.to_string_lossy().into_owned();
    if let Ok(guard) = session_cache().lock() {
        if let Some(cached) = guard.get(&cache_key).cloned() {
            return Ok(cached);
        }
    }

    let api = ort_api()?;
    let env_name = CString::new("kokoro").map_err(|e| format!("{e}"))?;
    let create_env = api.CreateEnv.ok_or_else(|| "ORT: CreateEnv missing".to_string())?;
    let mut env: *mut ort_sys::OrtEnv = ptr::null_mut();
    let status = create_env(ort_sys::OrtLoggingLevel::ORT_LOGGING_LEVEL_WARNING, env_name.as_ptr(), &mut env);
    check_status(status)?;

    let create_opts = api.CreateSessionOptions.ok_or_else(|| "ORT: CreateSessionOptions missing".to_string())?;
    let mut opts: *mut ort_sys::OrtSessionOptions = ptr::null_mut();
    let status = create_opts(&mut opts);
    check_status(status)?;

    if let Some(set_threads) = api.SetIntraOpNumThreads {
        let status = set_threads(opts, 4);
        check_status(status).unwrap_or(());
    }

    let model_cstr = CString::new(cache_key.clone())
        .map_err(|e| format!("model path null: {e}"))?;
    let create_session = api.CreateSession.ok_or_else(|| "ORT: CreateSession missing".to_string())?;
    let mut session: *mut ort_sys::OrtSession = ptr::null_mut();
    let status = create_session(env, model_cstr.as_ptr() as *const _, opts, &mut session);
    release_session_options(opts);
    if let Err(error) = check_status(status) {
        release_env(env);
        return Err(error);
    }

    let (input_names, output_names) = query_session_names(session)?;

    let cached = CachedSession { env, session, input_names, output_names };
    let mut guard = session_cache()
        .lock()
        .map_err(|_| "ORT session cache lock poisoned".to_string())?;
    Ok(guard.entry(cache_key).or_insert(cached).clone())
}

pub fn synthesize_phonemes(
    model_path: &Path,
    config_path: &Path,
    voice_path: &Path,
    voice_name: Option<&str>,
    phonemes: &str,
    speed: f32,
) -> Result<(Vec<f32>, u32), String> {
    let tokenizer = KokoroTokenizer::from_config_path(config_path)?;
    let raw_tokens = tokenizer.tokenize_phonemes(phonemes);
    if raw_tokens.is_empty() {
        return Err("phonemizer produced no supported Kokoro tokens".to_string());
    }
    let tokens = tokenizer.pad_with_boundaries(&raw_tokens);
    if tokens.len() > 512 {
        return Err("kokoro token sequence exceeds 512".to_string());
    }

    let style = kokoro_voice::load_voice_style_named(voice_path, voice_name, tokens.len())?;

    let result = unsafe {
        let api = ort_api()?;
        let cached = get_or_create_session(model_path)?;
        let session = cached.session;

        let mem_info = create_memory_info()?;

        let input_ids_val = create_i64_tensor(&tokens, &[1, tokens.len()], mem_info)?;
        let style_val = create_f32_tensor(&style, &[1, 256], mem_info)?;
        let speed_val = create_f32_tensor(&[speed], &[1], mem_info)?;

        let tensor_by_name: HashMap<&str, *const ort_sys::OrtValue> = {
            let mut m = HashMap::new();
            for name in &cached.input_names {
                let lower = name.to_lowercase();
                if lower.contains("id") || lower.contains("token") {
                    m.insert(name.as_str(), input_ids_val as *const _);
                } else if lower.contains("style") || lower.contains("voice") || lower.contains("embedding") {
                    m.insert(name.as_str(), style_val as *const _);
                } else if lower.contains("speed") || lower.contains("rate") {
                    m.insert(name.as_str(), speed_val as *const _);
                }
            }
            m
        };

        let input_values: Vec<*const ort_sys::OrtValue> = cached.input_names.iter()
            .map(|n| *tensor_by_name.get(n.as_str()).unwrap_or(&(input_ids_val as *const _)))
            .collect();

        let input_c_names: Vec<CString> = cached.input_names.iter()
            .map(|n| CString::new(n.as_str()).map_err(|e| format!("ORT input name has null byte: {e}")))
            .collect::<Result<Vec<_>, String>>()?;
        let output_c_names: Vec<CString> = cached.output_names.iter()
            .map(|n| CString::new(n.as_str()).map_err(|e| format!("ORT output name has null byte: {e}")))
            .collect::<Result<Vec<_>, String>>()?;

        let input_name_ptrs: Vec<*const i8> = input_c_names.iter()
            .map(|n| n.as_ptr())
            .collect();
        let output_name_ptrs: Vec<*const i8> = output_c_names.iter()
            .map(|n| n.as_ptr())
            .collect();

        let mut output_tensor: *mut ort_sys::OrtValue = ptr::null_mut();

        let run = api.Run.ok_or_else(|| "ORT: Run missing".to_string())?;
        let status = run(
            session,
            ptr::null(),
            input_name_ptrs.as_ptr(),
            input_values.as_ptr(),
            input_name_ptrs.len(),
            output_name_ptrs.as_ptr(),
            output_name_ptrs.len(),
            &mut output_tensor,
        );
        check_status(status)?;

        let samples = extract_f32_data(output_tensor)?;

        release_value(output_tensor);
        release_value(input_ids_val);
        release_value(style_val);
        release_value(speed_val);
        release_memory_info(mem_info);

        Ok(samples)
    };

    result.map(|samples| (samples, 24_000))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tts::phonemizer::Phonemizer;
    use std::path::{Path, PathBuf};

    fn resources_dir() -> PathBuf {
        PathBuf::from("resources")
    }

    fn has_assets() -> bool {
        let r = resources_dir();
        let model = r.join("kokoro/model_quantized.onnx");
        let voice = r.join("kokoro/af_heart.bin");
        let config = r.join("kokoro/config.json");
        let espeak = r.join("espeak-ng/bin/espeak-ng");
        model.exists() && voice.exists() && config.exists() && espeak.exists()
    }

    fn init_test_ort() {
        let ort_path = Path::new("resources/onnxruntime/linux-x64/libonnxruntime.so");
        if ort_path.exists() {
            let _ = init_onnxruntime(ort_path);
        }
    }

    #[test]
    fn smoke_test_synthesize_phonemes() {
        init_test_ort();
        let model_path = Path::new("resources/kokoro/model_quantized.onnx");
        let config_path = Path::new("resources/kokoro/config.json");
        let voice_path = Path::new("resources/kokoro/af_heart.bin");
        if !model_path.exists() || !voice_path.exists() {
            eprintln!("skipping: model or voice files not found");
            return;
        }
        let phonemes = "həlˈoʊ wˈɜːld";
        let result = synthesize_phonemes(model_path, config_path, voice_path, None, phonemes, 1.0);
        match &result {
            Ok((samples, sample_rate)) => {
                assert_eq!(*sample_rate, 24_000);
                assert!(!samples.is_empty(), "should produce audio samples");
                eprintln!("smoke test OK: {} samples, {:.1}ms audio", samples.len(), samples.len() as f64 / *sample_rate as f64 * 1000.0);
            }
            Err(e) => {
                eprintln!("smoke test failed (ORT not available?): {e}");
            }
        }
    }

    #[test]
    fn e2e_phonemize_tokenize_synthesize() {
        if !has_assets() { eprintln!("skipping: no assets"); return; }
        init_test_ort();

        let phonemizer = crate::tts::phonemizer::EspeakPhonemizer::new(&resources_dir())
            .expect("EspeakPhonemizer::new");

        let text = "Hello world. This is a test of text to speech.";
        let phonemes = phonemizer.phonemize(text).expect("phonemize");
        assert!(!phonemes.is_empty(), "phonemes should not be empty");
        eprintln!("phonemes: {:?}", phonemes);

        let model_path = Path::new("resources/kokoro/model_quantized.onnx");
        let config_path = Path::new("resources/kokoro/config.json");
        let voice_path = Path::new("resources/kokoro/af_heart.bin");

        let result = synthesize_phonemes(model_path, config_path, voice_path, None, &phonemes, 1.0);
        match &result {
            Ok((samples, sample_rate)) => {
                assert_eq!(*sample_rate, 24_000);
                assert!(!samples.is_empty());
                let duration_ms = (samples.len() as f64 / *sample_rate as f64 * 1000.0) as u32;
                assert!(duration_ms > 100, "should produce at least 100ms of audio for this text, got {duration_ms}ms");
                eprintln!("e2e OK: {} samples, {}ms audio", samples.len(), duration_ms);
            }
            Err(e) => {
                panic!("e2e synthesis failed: {e}");
            }
        }
    }

    #[test]
    fn e2e_stream_chunked_synthesis() {
        if !has_assets() { eprintln!("skipping: no assets"); return; }
        init_test_ort();

        let phonemizer = crate::tts::phonemizer::EspeakPhonemizer::new(&resources_dir())
            .expect("EspeakPhonemizer::new");

        let text = "Hello. How are you? I am fine.";
        let phonemes = phonemizer.phonemize(text).expect("phonemize");

        let sentences = crate::tts::split_into_sentences(&phonemes);
        assert!(sentences.len() >= 2, "should split into at least 2 sentences, got {}", sentences.len());
        eprintln!("sentences: {:?}", sentences);

        let model_path = Path::new("resources/kokoro/model_quantized.onnx");
        let config_path = Path::new("resources/kokoro/config.json");
        let voice_path = Path::new("resources/kokoro/af_heart.bin");

        let mut total_samples: usize = 0;
        let mut chunk_count: u32 = 0;
        for sentence in &sentences {
            let result = synthesize_phonemes(model_path, config_path, voice_path, None, sentence, 1.0);
            match result {
                Ok((samples, sr)) => {
                    assert_eq!(sr, 24_000);
                    assert!(!samples.is_empty(), "chunk should produce samples");
                    total_samples += samples.len();
                    chunk_count += 1;
                    eprintln!("chunk {}: {} samples", chunk_count, samples.len());
                }
                Err(e) => {
                    panic!("chunk {} synthesis failed: {e}", chunk_count + 1);
                }
            }
        }

        assert_eq!(chunk_count, sentences.len() as u32, "all chunks should succeed");
        let total_ms = (total_samples as f64 / 24_000.0 * 1000.0) as u32;
        assert!(total_ms > 50, "total audio should be at least 50ms, got {total_ms}ms");
        eprintln!("stream e2e OK: {} chunks, {} total samples, {}ms audio", chunk_count, total_samples, total_ms);
    }

    #[test]
    fn e2e_wav_encoding() {
        if !has_assets() { eprintln!("skipping: no assets"); return; }
        init_test_ort();

        let phonemizer = crate::tts::phonemizer::EspeakPhonemizer::new(&resources_dir())
            .expect("EspeakPhonemizer::new");
        let phonemes = phonemizer.phonemize("Test.").expect("phonemize");

        let model_path = Path::new("resources/kokoro/model_quantized.onnx");
        let config_path = Path::new("resources/kokoro/config.json");
        let voice_path = Path::new("resources/kokoro/af_heart.bin");
        let (samples, sample_rate) = synthesize_phonemes(model_path, config_path, voice_path, None, &phonemes, 1.0)
            .expect("synthesize");

        let wav_bytes = crate::tts::wav_from_f32_samples(&samples, sample_rate);

        assert!(wav_bytes.starts_with(b"RIFF"), "should be a valid WAV file");
        assert!(wav_bytes.len() > 44, "WAV should have data beyond header");
        let expected_data_len = samples.len() * 2;
        assert!(wav_bytes.len() >= 44 + expected_data_len, "WAV data section should contain all PCM samples");
        eprintln!("WAV OK: {} bytes, {} samples at {}Hz", wav_bytes.len(), samples.len(), sample_rate);
    }
}
