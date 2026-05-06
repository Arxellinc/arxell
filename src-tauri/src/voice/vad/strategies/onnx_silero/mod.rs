use crate::app_paths;
use crate::voice::audio_bus::AudioFrame;
use crate::voice::vad::contracts::{
    SegmentCloseReason, VadCapabilities, VadConfig, VadError, VadEvent, VadManifest, VadStatus,
    VadStrategy,
};
use crate::voice::vad::settings::{default_config_for, OnnxSileroConfig, ONNX_SILERO_ID};
use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::os::raw::c_void;
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::OnceLock;

static ORT_LIB: OnceLock<libloading::Library> = OnceLock::new();

#[derive(Default)]
pub struct OnnxSileroStrategy {
    config: OnnxSileroConfig,
    runner: Option<DirectSileroRunner>,
    runner_error: Option<String>,
    in_speech: bool,
    speech_frames: u32,
    silence_frames: u32,
    noise_floor: f32,
    segment_counter: u64,
    active_segment_id: Option<String>,
}

impl OnnxSileroStrategy {
    pub fn manifest_static() -> VadManifest {
        VadManifest {
            id: ONNX_SILERO_ID.to_string(),
            display_name: "ONNX Silero".to_string(),
            status: VadStatus::Stable,
            description: "Direct ONNX Runtime Silero VAD with the same endpointing contract as the production voice path.".to_string(),
            capabilities: Self::capabilities_static(),
            default_config: default_config_for(ONNX_SILERO_ID),
        }
    }

    fn capabilities_static() -> VadCapabilities {
        VadCapabilities {
            supports_endpointing: true,
            supports_interruption_signals: true,
            supports_speech_probability: true,
            supports_partial_segmentation: true,
            supports_live_handoff: true,
            ..VadCapabilities::default()
        }
    }

    fn next_segment_id(&mut self) -> String {
        self.segment_counter += 1;
        format!("onnx-silero-{}", self.segment_counter)
    }

    fn resolve_model_path(configured: Option<&str>) -> Option<PathBuf> {
        if let Some(path) = configured.map(str::trim).filter(|path| !path.is_empty()) {
            let candidate = PathBuf::from(path);
            if candidate.is_file() {
                return Some(candidate);
            }
        }

        let app_data_dir = app_paths::app_data_dir();
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
        let candidates = [
            app_data_dir.join("voice").join("silero_vad.onnx"),
            app_data_dir
                .join("voice")
                .join("vad")
                .join("silero_vad.onnx"),
            app_data_dir.join("STT").join("vad").join("silero_vad.onnx"),
            app_data_dir.join("stt").join("vad").join("silero_vad.onnx"),
            PathBuf::from(&manifest_dir)
                .join("resources")
                .join("voice")
                .join("silero_vad.onnx"),
            PathBuf::from(&manifest_dir)
                .join("resources")
                .join("vad")
                .join("silero_vad.onnx"),
            PathBuf::from(&manifest_dir)
                .join("resources")
                .join("silero_vad.onnx"),
        ];
        candidates.into_iter().find(|path| path.is_file())
    }

    fn energy_probability(&mut self, rms: f32) -> f32 {
        if !self.in_speech {
            self.noise_floor = if self.noise_floor == 0.0 {
                rms
            } else {
                self.noise_floor * (1.0 - self.config.noise_adaptation_alpha)
                    + rms * self.config.noise_adaptation_alpha
            };
        }
        let threshold = self
            .config
            .base_threshold
            .max(self.noise_floor * self.config.dynamic_multiplier);
        (rms / threshold.max(0.000001)).clamp(0.0, 1.0)
    }
}

impl VadStrategy for OnnxSileroStrategy {
    fn id(&self) -> &'static str {
        ONNX_SILERO_ID
    }

    fn display_name(&self) -> &'static str {
        "ONNX Silero"
    }

    fn manifest(&self) -> VadManifest {
        Self::manifest_static()
    }

    fn capability_flags(&self) -> VadCapabilities {
        Self::capabilities_static()
    }

    fn start_session(&mut self, config: VadConfig) -> Result<(), VadError> {
        self.config = serde_json::from_value(config.settings)
            .map_err(|err| VadError::InvalidConfig(format!("invalid onnx-silero config: {err}")))?;
        self.runner = None;
        self.runner_error = None;
        if let Some(model_path) = Self::resolve_model_path(self.config.model_path.as_deref()) {
            match DirectSileroRunner::new(&model_path) {
                Ok(runner) => self.runner = Some(runner),
                Err(error) => self.runner_error = Some(error),
            }
        }
        self.reset()
    }

    fn process_frame(&mut self, frame: AudioFrame) -> Result<Vec<VadEvent>, VadError> {
        let rms = frame.rms();
        let probability = if let Some(runner) = self.runner.as_mut() {
            match runner.probability(&frame.samples, frame.sample_rate_hz) {
                Ok(value) => value.clamp(0.0, 1.0),
                Err(error) => {
                    self.runner_error = Some(error);
                    self.energy_probability(rms)
                }
            }
        } else {
            self.energy_probability(rms)
        };
        let voice_like = probability >= self.config.probability_threshold;
        let mut events = vec![VadEvent::SpeechProbability { value: probability }];
        if self.runner.is_none() {
            if let Some(error) = self.runner_error.take() {
                events.push(VadEvent::DebugMarker {
                    label: format!("onnx-silero fallback: {error}"),
                });
            }
        }

        if voice_like {
            self.speech_frames = self.speech_frames.saturating_add(1);
            self.silence_frames = 0;
            if !self.in_speech && self.speech_frames >= self.config.start_frames {
                self.in_speech = true;
                let segment_id = self.next_segment_id();
                self.active_segment_id = Some(segment_id.clone());
                events.push(VadEvent::SpeechStart);
                events.push(VadEvent::InterruptionDetected {
                    confidence: probability,
                });
                events.push(VadEvent::SegmentOpened { segment_id });
            } else if let Some(segment_id) = self.active_segment_id.clone() {
                events.push(VadEvent::SegmentExtended { segment_id });
            }
            return Ok(events);
        }

        self.silence_frames = self.silence_frames.saturating_add(1);
        self.speech_frames = 0;
        if self.in_speech && self.silence_frames >= self.config.end_frames {
            self.in_speech = false;
            events.push(VadEvent::SpeechEnd);
            if let Some(segment_id) = self.active_segment_id.take() {
                events.push(VadEvent::SegmentClosed {
                    segment_id,
                    reason: SegmentCloseReason::Silence,
                });
            }
        }
        Ok(events)
    }

    fn flush(&mut self) -> Result<Vec<VadEvent>, VadError> {
        if !self.in_speech {
            return Ok(Vec::new());
        }
        self.in_speech = false;
        let mut events = vec![VadEvent::SpeechEnd];
        if let Some(segment_id) = self.active_segment_id.take() {
            events.push(VadEvent::SegmentClosed {
                segment_id,
                reason: SegmentCloseReason::Flush,
            });
        }
        Ok(events)
    }

    fn reset(&mut self) -> Result<(), VadError> {
        self.in_speech = false;
        self.speech_frames = 0;
        self.silence_frames = 0;
        self.noise_floor = 0.0;
        self.active_segment_id = None;
        if let Some(runner) = self.runner.as_mut() {
            runner.reset_state();
        }
        Ok(())
    }
}

struct DirectSileroRunner {
    env: *mut ort_sys::OrtEnv,
    session: *mut ort_sys::OrtSession,
    input_names: Vec<String>,
    output_names: Vec<String>,
    state: Vec<f32>,
}

unsafe impl Send for DirectSileroRunner {}

impl DirectSileroRunner {
    fn new(model_path: &Path) -> Result<Self, String> {
        if !model_path.is_file() {
            return Err(format!("model not found: {}", model_path.display()));
        }
        if let Some(lib_path) = resolve_onnxruntime_library() {
            init_onnxruntime(&lib_path)?;
        }
        unsafe { Self::create(model_path) }
    }

    unsafe fn create(model_path: &Path) -> Result<Self, String> {
        let api = ort_api()?;
        let env_name = CString::new("silero-vad").map_err(|e| format!("{e}"))?;
        let create_env = api
            .CreateEnv
            .ok_or_else(|| "ORT: CreateEnv missing".to_string())?;
        let mut env: *mut ort_sys::OrtEnv = ptr::null_mut();
        check_status(create_env(
            ort_sys::OrtLoggingLevel::ORT_LOGGING_LEVEL_WARNING,
            env_name.as_ptr(),
            &mut env,
        ))?;

        let create_opts = api
            .CreateSessionOptions
            .ok_or_else(|| "ORT: CreateSessionOptions missing".to_string())?;
        let mut opts: *mut ort_sys::OrtSessionOptions = ptr::null_mut();
        check_status(create_opts(&mut opts))?;
        if let Some(set_threads) = api.SetIntraOpNumThreads {
            let _ = check_status(set_threads(opts, 1));
        }

        let model_cstr = CString::new(model_path.to_string_lossy().as_bytes())
            .map_err(|e| format!("model path null: {e}"))?;
        let create_session = api
            .CreateSession
            .ok_or_else(|| "ORT: CreateSession missing".to_string())?;
        let mut session: *mut ort_sys::OrtSession = ptr::null_mut();
        let status = create_session(env, model_cstr.as_ptr() as *const _, opts, &mut session);
        release_session_options(opts);
        if let Err(error) = check_status(status) {
            release_env(env);
            return Err(error);
        }

        let (input_names, output_names) = query_session_names(session)?;
        if input_names.is_empty() || output_names.is_empty() {
            release_session(session);
            release_env(env);
            return Err("ORT Silero model exposes no inputs or outputs".to_string());
        }
        Ok(Self {
            env,
            session,
            input_names,
            output_names,
            state: vec![0.0; 2 * 128],
        })
    }

    fn probability(&mut self, samples: &[f32], sample_rate_hz: u32) -> Result<f32, String> {
        if sample_rate_hz != 16_000 {
            return Err(format!(
                "onnx-silero expects 16000Hz frames, got {sample_rate_hz}Hz"
            ));
        }
        if samples.is_empty() {
            return Ok(0.0);
        }

        let mut max_probability = 0.0f32;
        for chunk in samples.chunks(512) {
            let mut window = [0.0f32; 512];
            window[..chunk.len()].copy_from_slice(chunk);
            let probability = unsafe { self.run_window(&window)? };
            max_probability = max_probability.max(probability);
        }
        Ok(max_probability)
    }

    unsafe fn run_window(&mut self, window: &[f32; 512]) -> Result<f32, String> {
        let api = ort_api()?;
        let mem_info = create_memory_info()?;
        let input_val = create_f32_tensor(window, &[1, 512], mem_info)?;
        let state_val = create_f32_tensor(&self.state, &[2, 1, 128], mem_info)?;
        let sr = [16_000i64];
        let sr_val = create_i64_tensor(&sr, &[1], mem_info)?;

        let mut tensor_by_name: HashMap<&str, *const ort_sys::OrtValue> = HashMap::new();
        for name in &self.input_names {
            let lower = name.to_lowercase();
            if lower.contains("state") || lower == "h" || lower == "c" {
                tensor_by_name.insert(name.as_str(), state_val as *const _);
            } else if lower == "sr" || lower.contains("sample") {
                tensor_by_name.insert(name.as_str(), sr_val as *const _);
            } else {
                tensor_by_name.insert(name.as_str(), input_val as *const _);
            }
        }

        let input_values: Vec<*const ort_sys::OrtValue> = self
            .input_names
            .iter()
            .map(|name| {
                *tensor_by_name
                    .get(name.as_str())
                    .unwrap_or(&(input_val as *const _))
            })
            .collect();
        let input_c_names = self
            .input_names
            .iter()
            .map(|name| {
                CString::new(name.as_str()).map_err(|e| format!("ORT input name null: {e}"))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let output_c_names = self
            .output_names
            .iter()
            .map(|name| {
                CString::new(name.as_str()).map_err(|e| format!("ORT output name null: {e}"))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let input_name_ptrs: Vec<*const i8> =
            input_c_names.iter().map(|name| name.as_ptr()).collect();
        let output_name_ptrs: Vec<*const i8> =
            output_c_names.iter().map(|name| name.as_ptr()).collect();
        let mut output_values: Vec<*mut ort_sys::OrtValue> =
            vec![ptr::null_mut(); output_name_ptrs.len()];

        let run = api.Run.ok_or_else(|| "ORT: Run missing".to_string())?;
        let status = run(
            self.session,
            ptr::null(),
            input_name_ptrs.as_ptr(),
            input_values.as_ptr(),
            input_name_ptrs.len(),
            output_name_ptrs.as_ptr(),
            output_name_ptrs.len(),
            output_values.as_mut_ptr(),
        );
        let run_result = check_status(status).and_then(|_| {
            let mut probability = 0.0f32;
            for (index, value) in output_values.iter().copied().enumerate() {
                if value.is_null() {
                    continue;
                }
                let data = extract_f32_data(value)?;
                let name = self
                    .output_names
                    .get(index)
                    .map(|name| name.to_lowercase())
                    .unwrap_or_default();
                if name.contains("state") || data.len() == self.state.len() {
                    if data.len() == self.state.len() {
                        self.state = data;
                    }
                } else if let Some(first) = data.first() {
                    probability = probability.max(*first);
                }
            }
            Ok(probability)
        });

        for value in output_values {
            release_value(value);
        }
        release_value(input_val);
        release_value(state_val);
        release_value(sr_val);
        release_memory_info(mem_info);
        run_result
    }

    fn reset_state(&mut self) {
        self.state.fill(0.0);
    }
}

impl Drop for DirectSileroRunner {
    fn drop(&mut self) {
        unsafe {
            release_session(self.session);
            release_env(self.env);
        }
    }
}

fn resolve_onnxruntime_library() -> Option<PathBuf> {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
    let roots = [
        PathBuf::from(&manifest_dir)
            .join("resources")
            .join("onnxruntime"),
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("resources")
            .join("onnxruntime"),
    ];

    #[cfg(target_os = "linux")]
    let names: &[&str] = &[
        "linux-x64/libonnxruntime.so",
        "linux-x64/libonnxruntime.so.1",
        "linux-x64/libonnxruntime.so.1.20.1",
    ];
    #[cfg(target_os = "macos")]
    let names: &[&str] = &["macos/libonnxruntime.dylib"];
    #[cfg(target_os = "windows")]
    let names: &[&str] = &["win-x64/onnxruntime.dll"];

    for root in roots {
        for name in names {
            let candidate = root.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn init_onnxruntime(lib_path: &Path) -> Result<(), String> {
    if ORT_LIB.get().is_some() {
        return Ok(());
    }
    let library = unsafe { libloading::Library::new(lib_path) }.map_err(|e| {
        format!(
            "failed loading ONNX Runtime from {}: {e}",
            lib_path.display()
        )
    })?;
    let _ = ORT_LIB.set(library);
    Ok(())
}

unsafe fn ort_api() -> Result<&'static ort_sys::OrtApi, String> {
    let lib = ORT_LIB
        .get()
        .ok_or_else(|| "ORT: ONNX Runtime library has not been loaded".to_string())?;
    let base_getter: libloading::Symbol<unsafe extern "C" fn() -> *const ort_sys::OrtApiBase> = lib
        .get(b"OrtGetApiBase")
        .map_err(|_| "expected `OrtGetApiBase` in libonnxruntime".to_string())?;
    let base = base_getter();
    if base.is_null() {
        return Err("ORT: OrtGetApiBase returned null".to_string());
    }
    let base_ref = &*base;
    let get_api = base_ref
        .GetApi
        .ok_or_else(|| "ORT: GetApi missing from OrtApiBase".to_string())?;
    let api_ptr = get_api(19);
    if api_ptr.is_null() {
        return Err("ORT: GetApi(19) returned null".to_string());
    }
    Ok(&*api_ptr)
}

unsafe fn check_status(status: *mut ort_sys::OrtStatus) -> Result<(), String> {
    if status.is_null() {
        return Ok(());
    }
    let api = ort_api()?;
    let msg_ptr = api
        .GetErrorMessage
        .ok_or_else(|| "ORT: GetErrorMessage missing".to_string())?(status);
    let msg = CStr::from_ptr(msg_ptr).to_string_lossy().into_owned();
    if let Some(release) = api.ReleaseStatus {
        release(status);
    }
    Err(msg)
}

unsafe fn create_memory_info() -> Result<*mut ort_sys::OrtMemoryInfo, String> {
    let api = ort_api()?;
    let create = api
        .CreateCpuMemoryInfo
        .ok_or_else(|| "ORT: CreateCpuMemoryInfo missing".to_string())?;
    let mut mem_info: *mut ort_sys::OrtMemoryInfo = ptr::null_mut();
    check_status(create(
        ort_sys::OrtAllocatorType::OrtArenaAllocator,
        ort_sys::OrtMemType::OrtMemTypeDefault,
        &mut mem_info,
    ))?;
    Ok(mem_info)
}

unsafe fn create_f32_tensor(
    data: &[f32],
    shape: &[usize],
    mem_info: *mut ort_sys::OrtMemoryInfo,
) -> Result<*mut ort_sys::OrtValue, String> {
    let api = ort_api()?;
    let create = api
        .CreateTensorWithDataAsOrtValue
        .ok_or_else(|| "ORT: CreateTensorWithDataAsOrtValue missing".to_string())?;
    let shape_i64: Vec<i64> = shape.iter().map(|&s| s as i64).collect();
    let mut ort_value: *mut ort_sys::OrtValue = ptr::null_mut();
    check_status(create(
        mem_info,
        data.as_ptr() as *mut c_void,
        std::mem::size_of_val(data),
        shape_i64.as_ptr(),
        shape_i64.len(),
        ort_sys::ONNXTensorElementDataType::ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT,
        &mut ort_value,
    ))?;
    Ok(ort_value)
}

unsafe fn create_i64_tensor(
    data: &[i64],
    shape: &[usize],
    mem_info: *mut ort_sys::OrtMemoryInfo,
) -> Result<*mut ort_sys::OrtValue, String> {
    let api = ort_api()?;
    let create = api
        .CreateTensorWithDataAsOrtValue
        .ok_or_else(|| "ORT: CreateTensorWithDataAsOrtValue missing".to_string())?;
    let shape_i64: Vec<i64> = shape.iter().map(|&s| s as i64).collect();
    let mut ort_value: *mut ort_sys::OrtValue = ptr::null_mut();
    check_status(create(
        mem_info,
        data.as_ptr() as *mut c_void,
        std::mem::size_of_val(data),
        shape_i64.as_ptr(),
        shape_i64.len(),
        ort_sys::ONNXTensorElementDataType::ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64,
        &mut ort_value,
    ))?;
    Ok(ort_value)
}

unsafe fn extract_f32_data(ort_value: *mut ort_sys::OrtValue) -> Result<Vec<f32>, String> {
    let api = ort_api()?;
    let mut data_ptr: *mut c_void = ptr::null_mut();
    check_status(api
        .GetTensorMutableData
        .ok_or_else(|| "ORT: GetTensorMutableData missing".to_string())?(
        ort_value,
        &mut data_ptr,
    ))?;

    let mut tensor_info: *mut ort_sys::OrtTensorTypeAndShapeInfo = ptr::null_mut();
    check_status(api
        .GetTensorTypeAndShape
        .ok_or_else(|| "ORT: GetTensorTypeAndShape missing".to_string())?(
        ort_value,
        &mut tensor_info,
    ))?;
    let mut dims_count: usize = 0;
    check_status(api
        .GetDimensionsCount
        .ok_or_else(|| "ORT: GetDimensionsCount missing".to_string())?(
        tensor_info,
        &mut dims_count,
    ))?;
    let mut dims = vec![0i64; dims_count];
    check_status(api
        .GetDimensions
        .ok_or_else(|| "ORT: GetDimensions missing".to_string())?(
        tensor_info,
        dims.as_mut_ptr(),
        dims_count,
    ))?;
    if let Some(release) = api.ReleaseTensorTypeAndShapeInfo {
        release(tensor_info);
    }
    let total = dims
        .iter()
        .map(|dim| (*dim).max(0) as usize)
        .product::<usize>();
    let slice = std::slice::from_raw_parts(data_ptr as *const f32, total);
    Ok(slice.to_vec())
}

unsafe fn query_session_names(
    session: *mut ort_sys::OrtSession,
) -> Result<(Vec<String>, Vec<String>), String> {
    let api = ort_api()?;
    let get_input_count = api
        .SessionGetInputCount
        .ok_or_else(|| "ORT: SessionGetInputCount missing".to_string())?;
    let get_output_count = api
        .SessionGetOutputCount
        .ok_or_else(|| "ORT: SessionGetOutputCount missing".to_string())?;
    let get_input_name = api
        .SessionGetInputName
        .ok_or_else(|| "ORT: SessionGetInputName missing".to_string())?;
    let get_output_name = api
        .SessionGetOutputName
        .ok_or_else(|| "ORT: SessionGetOutputName missing".to_string())?;
    let get_allocator = api
        .GetAllocatorWithDefaultOptions
        .ok_or_else(|| "ORT: GetAllocatorWithDefaultOptions missing".to_string())?;
    let allocator_free = api
        .AllocatorFree
        .ok_or_else(|| "ORT: AllocatorFree missing".to_string())?;

    let mut allocator: *mut ort_sys::OrtAllocator = ptr::null_mut();
    check_status(get_allocator(&mut allocator))?;
    let mut input_count = 0usize;
    check_status(get_input_count(session, &mut input_count))?;
    let mut output_count = 0usize;
    check_status(get_output_count(session, &mut output_count))?;

    let mut input_names = Vec::with_capacity(input_count);
    for index in 0..input_count {
        let mut name_ptr: *mut std::os::raw::c_char = ptr::null_mut();
        check_status(get_input_name(session, index, allocator, &mut name_ptr))?;
        input_names.push(CStr::from_ptr(name_ptr).to_string_lossy().into_owned());
        allocator_free(allocator, name_ptr as *mut c_void);
    }

    let mut output_names = Vec::with_capacity(output_count);
    for index in 0..output_count {
        let mut name_ptr: *mut std::os::raw::c_char = ptr::null_mut();
        check_status(get_output_name(session, index, allocator, &mut name_ptr))?;
        output_names.push(CStr::from_ptr(name_ptr).to_string_lossy().into_owned());
        allocator_free(allocator, name_ptr as *mut c_void);
    }

    Ok((input_names, output_names))
}

unsafe fn release_value(value: *mut ort_sys::OrtValue) {
    if value.is_null() {
        return;
    }
    if let Ok(api) = ort_api() {
        if let Some(release) = api.ReleaseValue {
            release(value);
        }
    }
}

unsafe fn release_memory_info(info: *mut ort_sys::OrtMemoryInfo) {
    if info.is_null() {
        return;
    }
    if let Ok(api) = ort_api() {
        if let Some(release) = api.ReleaseMemoryInfo {
            release(info);
        }
    }
}

unsafe fn release_session(session: *mut ort_sys::OrtSession) {
    if session.is_null() {
        return;
    }
    if let Ok(api) = ort_api() {
        if let Some(release) = api.ReleaseSession {
            release(session);
        }
    }
}

unsafe fn release_session_options(opts: *mut ort_sys::OrtSessionOptions) {
    if opts.is_null() {
        return;
    }
    if let Ok(api) = ort_api() {
        if let Some(release) = api.ReleaseSessionOptions {
            release(opts);
        }
    }
}

unsafe fn release_env(env: *mut ort_sys::OrtEnv) {
    if env.is_null() {
        return;
    }
    if let Ok(api) = ort_api() {
        if let Some(release) = api.ReleaseEnv {
            release(env);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn frame(value: f32, timestamp_ms: u64) -> AudioFrame {
        AudioFrame {
            samples: vec![value; 1600],
            sample_rate_hz: 16_000,
            timestamp_ms,
        }
    }

    #[test]
    fn fallback_detects_speech_start_and_end() {
        let mut strategy = OnnxSileroStrategy::default();
        strategy
            .start_session(VadConfig {
                method_id: ONNX_SILERO_ID.to_string(),
                version: 2,
                settings: json!({
                    "modelPath": null,
                    "probabilityThreshold": 0.35,
                    "baseThreshold": 0.01,
                    "startFrames": 1,
                    "endFrames": 1,
                    "dynamicMultiplier": 2.4,
                    "noiseAdaptationAlpha": 0.03,
                    "minUtteranceMs": 100,
                    "maxUtteranceS": 30
                }),
            })
            .unwrap();

        let events = strategy.process_frame(frame(0.02, 100)).unwrap();
        assert!(events
            .iter()
            .any(|event| matches!(event, VadEvent::SpeechStart)));
        let events = strategy.process_frame(frame(0.0, 200)).unwrap();
        assert!(events
            .iter()
            .any(|event| matches!(event, VadEvent::SpeechEnd)));
    }
}
