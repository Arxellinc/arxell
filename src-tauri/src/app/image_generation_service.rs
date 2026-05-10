use crate::app_paths;
use crate::contracts::{
    EventSeverity, EventStage, ImageGenerationGenerateRequest, ImageGenerationGenerateResponse,
    ImageGenerationInstallResponse, ImageGenerationInstallState, ImageGenerationRuntimeState,
    ImageGenerationSetDisabledResponse, ImageGenerationStatusResponse, ImagePackageMetadata,
    MediaAssetRecord, Subsystem,
};
use crate::observability::EventHub;
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::ffi::OsString;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const ENGINE_REPO: &str = "leejet/stable-diffusion.cpp";
const TRANSFORMER_REPO: &str = "leejet/FLUX.1-schnell-gguf";
const VAE_REPO: &str = "Kijai/flux-fp8";
const TEXT_ENCODER_REPO: &str = "comfyanonymous/flux_text_encoders";
const PACKAGE_ID: &str = "flux-1-schnell-gguf-q4";
const DOWNLOAD_PROGRESS_INTERVAL_BYTES: u64 = 2 * 1024 * 1024;

struct ModelAsset {
    repo_id: &'static str,
    filename: &'static str,
    install_name: &'static str,
}

const MODEL_ASSETS: &[ModelAsset] = &[
    ModelAsset {
        repo_id: TRANSFORMER_REPO,
        filename: "flux1-schnell-q4_0.gguf",
        install_name: "flux1-schnell-q4_0.gguf",
    },
    ModelAsset {
        repo_id: VAE_REPO,
        filename: "flux-vae-bf16.safetensors",
        install_name: "ae.safetensors",
    },
    ModelAsset {
        repo_id: TEXT_ENCODER_REPO,
        filename: "clip_l.safetensors",
        install_name: "clip_l.safetensors",
    },
    ModelAsset {
        repo_id: TEXT_ENCODER_REPO,
        filename: "t5xxl_fp8_e4m3fn.safetensors",
        install_name: "t5xxl_fp8_e4m3fn.safetensors",
    },
];

#[derive(Debug, Deserialize)]
struct HfModelDetail {
    siblings: Option<Vec<HfSibling>>,
}

#[derive(Debug, Deserialize)]
struct HfSibling {
    rfilename: String,
    size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ResolvedModelAsset {
    repo_id: String,
    filename: String,
    install_name: String,
    size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ImageGenerationSettings {
    disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
struct EngineInstallSnapshot {
    engine_installed: bool,
    model_files_present: bool,
}

#[derive(Clone)]
pub struct ImageGenerationService {
    hub: EventHub,
    cancelled_installs: Arc<Mutex<HashSet<String>>>,
    active_pid: Arc<Mutex<Option<u32>>>,
}

impl ImageGenerationService {
    pub fn new(hub: EventHub) -> Self {
        Self {
            hub,
            cancelled_installs: Arc::new(Mutex::new(HashSet::new())),
            active_pid: Arc::new(Mutex::new(None)),
        }
    }

    pub fn status(
        &self,
        correlation_id: &str,
        app_data_dir: &Path,
    ) -> Result<ImageGenerationStatusResponse, String> {
        let settings = read_settings(app_data_dir);
        let engine_path = engine_binary_path(app_data_dir);
        let model_dir = model_dir(app_data_dir);
        let engine_installed = engine_path.exists();
        let model_files_present = validate_model_dir(&model_dir).is_ok();
        let installed = engine_installed && model_files_present;
        let generation_ready = installed && !settings.disabled;

        let runtime_state = if !installed {
            ImageGenerationRuntimeState::NotReady
        } else if settings.disabled {
            ImageGenerationRuntimeState::ProbeOnly
        } else {
            ImageGenerationRuntimeState::Ready
        };

        let message = if !engine_installed && !model_files_present {
            None
        } else if !engine_installed {
            Some("Model files are installed but the engine binary is missing.".to_string())
        } else if !model_files_present {
            Some("Engine is installed but model files are missing.".to_string())
        } else {
            Some("FLUX.1 Schnell GGUF Q4_0 ready for image generation.".to_string())
        };

        Ok(ImageGenerationStatusResponse {
            correlation_id: correlation_id.to_string(),
            package: curated_package_metadata(),
            install_state: if installed {
                ImageGenerationInstallState::Installed
            } else if engine_path.exists() || model_dir.exists() {
                ImageGenerationInstallState::Error
            } else {
                ImageGenerationInstallState::NotInstalled
            },
            runtime_state,
            disabled: settings.disabled,
            installed_path: installed.then(|| model_dir.to_string_lossy().to_string()),
            message,
            required_paths_present: installed,
            generation_ready,
        })
    }

    pub fn set_disabled(
        &self,
        correlation_id: &str,
        app_data_dir: &Path,
        disabled: bool,
    ) -> Result<ImageGenerationSetDisabledResponse, String> {
        let mut settings = read_settings(app_data_dir);
        settings.disabled = disabled;
        write_settings(app_data_dir, &settings)?;
        self.emit(
            correlation_id,
            "image.generation.settings",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "disabled": disabled }),
        );
        Ok(ImageGenerationSetDisabledResponse {
            correlation_id: correlation_id.to_string(),
            disabled,
        })
    }

    pub fn install_curated_package(
        &self,
        correlation_id: &str,
        app_data_dir: &Path,
    ) -> Result<ImageGenerationInstallResponse, String> {
        self.clear_install_cancel(correlation_id);
        let mut phase = "preflight";

        self.emit(
            correlation_id,
            "image.generation.install",
            EventStage::Start,
            EventSeverity::Info,
            json!({
                "packageId": PACKAGE_ID,
                "phase": phase,
            }),
        );

        let engine_dir = engine_dir(app_data_dir);
        let model_root = model_dir(app_data_dir);

        let result = (|| -> Result<ImageGenerationInstallResponse, String> {
            fs::create_dir_all(&engine_dir)
                .map_err(|e| format!("failed to create engine directory: {e}"))?;
            fs::create_dir_all(&model_root)
                .map_err(|e| format!("failed to create model directory: {e}"))?;

            verify_write_access(&engine_dir)?;

            if !engine_binary_path(app_data_dir).exists() {
                phase = "engine";
                self.emit(
                    correlation_id,
                    "image.generation.install",
                    EventStage::Progress,
                    EventSeverity::Info,
                    json!({
                        "packageId": PACKAGE_ID,
                        "phase": phase,
                        "message": "Downloading stable-diffusion.cpp engine",
                    }),
                );
                let engine_binary = download_engine_binary().map_err(|e| {
                    format!("engine download failed (correlation={}): {e}", correlation_id)
                })?;
                let target = engine_binary_path(app_data_dir);
                install_engine_binary(&engine_binary, &target)?;
                let _ = fs::remove_dir_all(&engine_binary.parent().unwrap_or(Path::new(".")));
            }

            if validate_model_dir(&model_root).is_err() {
                phase = "download";
                let client = reqwest::blocking::Client::builder()
                    .user_agent(format!("{}/image-install", app_paths::APP_USER_AGENT))
                    .build()
                    .map_err(|e| format!("failed to create HTTP client: {e}"))?;

                let resolved = resolve_model_assets(&client)?;
                let total_bytes: u64 = resolved.iter().map(|a| a.size).sum();
                let file_count = resolved.len();

                ensure_free_space(&model_root, required_free_space_bytes(total_bytes))?;

                self.emit(
                    correlation_id,
                    "image.generation.install",
                    EventStage::Progress,
                    EventSeverity::Info,
                    json!({
                        "packageId": PACKAGE_ID,
                        "phase": phase,
                        "fileCount": file_count,
                        "totalBytes": total_bytes,
                    }),
                );

                let mut received_total = 0_u64;
                let mut next_emit_at = DOWNLOAD_PROGRESS_INTERVAL_BYTES;

                for asset in &resolved {
                    if self.is_install_cancelled(correlation_id) {
                        return Err("image package install cancelled by user".to_string());
                    }
                    let target = model_root.join(&asset.install_name);
                    if target.exists() {
                        if let Ok(meta) = fs::metadata(&target) {
                            received_total = received_total.saturating_add(meta.len());
                            continue;
                        }
                    }
                    let encoded_filename = url_encode_path_segment(&asset.filename);
                    let url = format!(
                        "https://huggingface.co/{}/resolve/main/{}?download=true",
                        asset.repo_id, encoded_filename,
                    );
                    let mut response = client
                        .get(&url)
                        .send()
                        .and_then(|r| r.error_for_status())
                        .map_err(|e| {
                            format!("failed downloading {} from {}: {e}", asset.filename, asset.repo_id)
                        })?;
                    let mut file =
                        fs::File::create(&target).map_err(|e| format!("failed creating file: {e}"))?;
                    let mut buffer = [0u8; 64 * 1024];
                    loop {
                        if self.is_install_cancelled(correlation_id) {
                            let _ = fs::remove_file(&target);
                            return Err("image package install cancelled by user".to_string());
                        }
                        let read = response
                            .read(&mut buffer)
                            .map_err(|e| format!("failed reading response: {e}"))?;
                        if read == 0 {
                            break;
                        }
                        file.write_all(&buffer[..read])
                            .map_err(|e| format!("failed writing file: {e}"))?;
                        received_total = received_total.saturating_add(read as u64);
                        if received_total >= next_emit_at {
                            self.emit(
                                correlation_id,
                                "image.generation.install",
                                EventStage::Progress,
                                EventSeverity::Info,
                                json!({
                                    "packageId": PACKAGE_ID,
                                    "phase": phase,
                                    "fileName": asset.install_name,
                                    "receivedBytes": received_total,
                                    "totalBytes": total_bytes,
                                    "percent": (received_total as f64 / total_bytes as f64 * 100.0).min(100.0),
                                }),
                            );
                            next_emit_at = received_total.saturating_add(DOWNLOAD_PROGRESS_INTERVAL_BYTES);
                        }
                    }
                    file.flush().map_err(|e| format!("failed flushing file: {e}"))?;
                }

                self.emit(
                    correlation_id,
                    "image.generation.install",
                    EventStage::Progress,
                    EventSeverity::Info,
                    json!({
                        "packageId": PACKAGE_ID,
                        "phase": "validate",
                        "receivedBytes": received_total,
                        "totalBytes": total_bytes,
                        "percent": 100.0_f64,
                    }),
                );

                validate_model_dir(&model_root)?;
            }

            let mut settings = read_settings(app_data_dir);
            settings.disabled = false;
            write_settings(app_data_dir, &settings)?;

            self.clear_install_cancel(correlation_id);
            self.emit(
                correlation_id,
                "image.generation.install",
                EventStage::Complete,
                EventSeverity::Info,
                json!({
                    "packageId": PACKAGE_ID,
                    "phase": "complete",
                    "enginePath": engine_binary_path(app_data_dir).to_string_lossy(),
                    "modelPath": model_root.to_string_lossy(),
                }),
            );

            Ok(ImageGenerationInstallResponse {
                correlation_id: correlation_id.to_string(),
                installed_path: model_root.to_string_lossy().to_string(),
                enabled: true,
            })
        })();

        match result {
            Ok(response) => Ok(response),
            Err(message) => {
                self.clear_install_cancel(correlation_id);
                self.emit(
                    correlation_id,
                    "image.generation.install",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({
                        "packageId": PACKAGE_ID,
                        "phase": phase,
                        "message": message,
                    }),
                );
                Err(format!("install {phase} failed: {message}"))
            }
        }
    }

    pub fn cancel_install(&self, target_correlation_id: &str) -> bool {
        let trimmed = target_correlation_id.trim();
        if trimmed.is_empty() {
            return false;
        }
        if let Ok(mut guard) = self.cancelled_installs.lock() {
            guard.insert(trimmed.to_string());
            return true;
        }
        false
    }

    pub fn cancel_generate(&self) -> bool {
        if let Ok(mut guard) = self.active_pid.lock() {
            if let Some(pid) = guard.take() {
                return kill_process(pid);
            }
        }
        false
    }

    pub fn remove_packages(
        &self,
        correlation_id: &str,
        app_data_dir: &Path,
    ) -> Result<bool, String> {
        let engine_root = engine_dir(app_data_dir);
        let model_root = model_dir(app_data_dir);
        let staging = model_root.with_extension("staging");
        let mut removed = false;
        if engine_root.exists() {
            fs::remove_dir_all(&engine_root)
                .map_err(|e| format!("failed removing engine: {e}"))?;
            removed = true;
        }
        if model_root.exists() {
            fs::remove_dir_all(&model_root)
                .map_err(|e| format!("failed removing models: {e}"))?;
            removed = true;
        }
        if staging.exists() {
            let _ = fs::remove_dir_all(&staging);
        }
        let mut settings = read_settings(app_data_dir);
        settings.disabled = true;
        write_settings(app_data_dir, &settings)?;
        self.emit(
            correlation_id,
            "image.generation.remove",
            EventStage::Complete,
            EventSeverity::Info,
            json!({ "removed": removed }),
        );
        Ok(removed)
    }

    pub fn generate(
        &self,
        request: &ImageGenerationGenerateRequest,
        app_data_dir: &Path,
    ) -> Result<ImageGenerationGenerateResponse, String> {
        let status = self.status(request.correlation_id.as_str(), app_data_dir)?;
        if status.disabled {
            return Err("image generation is disabled".to_string());
        }
        if !status.required_paths_present {
            return Err("image generation engine and/or models are not installed".to_string());
        }
        if !status.generation_ready {
            return Err("image generation is not ready".to_string());
        }

        let binary = engine_binary_path(app_data_dir);
        let models = model_dir(app_data_dir);
        let output_dir = app_data_dir.join("outputs").join("images");
        fs::create_dir_all(&output_dir)
            .map_err(|e| format!("failed creating output directory: {e}"))?;

        let output_id = uuid::Uuid::new_v4().to_string();
        let output_filename = format!("{output_id}.png");
        let output_path = output_dir.join(&output_filename);

        self.emit(
            &request.correlation_id,
            "image.generation.generate",
            EventStage::Start,
            EventSeverity::Info,
            json!({
                "prompt": request.prompt,
                "width": request.width,
                "height": request.height,
                "steps": request.steps,
                "guidance": request.guidance,
            }),
        );

        let diffusion_model = models.join("flux1-schnell-q4_0.gguf");
        let vae = models.join("ae.safetensors");
        let clip_l = models.join("clip_l.safetensors");
        let t5xxl = models.join("t5xxl_fp8_e4m3fn.safetensors");

        let mut cmd = Command::new(&binary);
        cmd.arg("--diffusion-model")
            .arg(&diffusion_model)
            .arg("--vae")
            .arg(&vae)
            .arg("--clip_l")
            .arg(&clip_l)
            .arg("--t5xxl")
            .arg(&t5xxl)
            .arg("-p")
            .arg(&request.prompt)
            .arg("-o")
            .arg(&output_path)
            .arg("--cfg-scale")
            .arg(request.guidance.to_string())
            .arg("--sampling-method")
            .arg("euler")
            .arg("--steps")
            .arg(request.steps.to_string())
            .arg("-W")
            .arg(request.width.to_string())
            .arg("-H")
            .arg(request.height.to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(seed) = request.seed {
            cmd.arg("--seed").arg(seed.to_string());
        }

        let engine_parent = binary.parent().unwrap_or(app_data_dir);
        prepend_engine_lib_path(&mut cmd, engine_parent);

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("failed to spawn sd-cli: {e}"))?;

        {
            let mut guard = self.active_pid.lock().map_err(|e| format!("lock error: {e}"))?;
            *guard = Some(child.id());
        }

        let result = child.wait().map_err(|e| format!("failed to wait for sd-cli: {e}"))?;

        {
            let mut guard = self.active_pid.lock().map_err(|e| format!("lock error: {e}"))?;
            *guard = None;
        }

        if !result.success() {
            return Err(format!("sd-cli failed (exit {:?})", result.code()));
        }

        if !output_path.exists() {
            return Err("sd-cli completed but output file was not created".to_string());
        }

        let file_bytes = fs::read(&output_path)
            .map_err(|e| format!("failed reading generated image: {e}"))?;
        let file_size = file_bytes.len() as u64;
        let data_base64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &file_bytes);

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let asset = MediaAssetRecord {
            id: output_id,
            kind: "generated".to_string(),
            mime: "image/png".to_string(),
            filename: output_filename,
            path: output_path.to_string_lossy().to_string(),
            width: Some(request.width),
            height: Some(request.height),
            size_bytes: file_size,
            created_at: now_ms,
            data_base64: Some(data_base64),
        };

        self.emit(
            &request.correlation_id,
            "image.generation.generate",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "assetId": asset.id,
                "sizeBytes": asset.size_bytes,
            }),
        );

        Ok(ImageGenerationGenerateResponse {
            correlation_id: request.correlation_id.clone(),
            asset,
        })
    }

    fn is_install_cancelled(&self, correlation_id: &str) -> bool {
        self.cancelled_installs
            .lock()
            .map(|guard| guard.contains(correlation_id))
            .unwrap_or(false)
    }

    fn clear_install_cancel(&self, correlation_id: &str) {
        if let Ok(mut guard) = self.cancelled_installs.lock() {
            guard.remove(correlation_id);
        }
    }

    fn emit(
        &self,
        correlation_id: &str,
        action: &str,
        stage: EventStage,
        severity: EventSeverity,
        payload: serde_json::Value,
    ) {
        let event = self.hub.make_event(
            correlation_id,
            Subsystem::Service,
            action,
            stage,
            severity,
            payload,
        );
        self.hub.emit(event);
    }
}

pub fn curated_package_metadata() -> ImagePackageMetadata {
    ImagePackageMetadata {
        id: PACKAGE_ID.to_string(),
        name: "FLUX.1 Schnell GGUF Q4_0".to_string(),
        repo_id: TRANSFORMER_REPO.to_string(),
        license: "Apache-2.0".to_string(),
        source_url: format!("https://huggingface.co/{TRANSFORMER_REPO}"),
        upstream_url: Some("https://huggingface.co/black-forest-labs/FLUX.1-schnell".to_string()),
        precision_label: "GGUF Q4_0".to_string(),
        core_model_bytes: 6_400_000_000,
        auxiliary_bytes: 5_100_000_000,
        total_install_bytes: 11_500_000_000,
        recommended_steps: 4,
        recommended_guidance: 1.0,
    }
}

fn engine_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("engines").join("sd-cpp")
}

fn engine_binary_path(app_data_dir: &Path) -> PathBuf {
    engine_dir(app_data_dir).join(engine_binary_filename())
}

fn engine_binary_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "sd-cli.exe"
    } else {
        "sd-cli"
    }
}

fn model_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join("models")
        .join("flux")
        .join("schnell")
        .join("q4_0")
}

fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("image-generation").join("settings.json")
}

fn read_settings(app_data_dir: &Path) -> ImageGenerationSettings {
    let path = settings_path(app_data_dir);
    let Ok(raw) = fs::read_to_string(&path) else {
        return ImageGenerationSettings::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_settings(app_data_dir: &Path, settings: &ImageGenerationSettings) -> Result<(), String> {
    let path = settings_path(app_data_dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed creating settings directory: {e}"))?;
    }
    let raw = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("failed serializing settings: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("failed writing settings: {e}"))
}

fn validate_model_dir(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err("model directory is missing".to_string());
    }
    let mut missing = Vec::new();
    for asset in MODEL_ASSETS {
        if !path.join(asset.install_name).exists() {
            missing.push(asset.install_name);
        }
    }
    if !missing.is_empty() {
        return Err(format!("model files missing: {}", missing.join(", ")));
    }
    Ok(())
}

fn verify_write_access(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|e| format!("directory not writable: {e}"))?;
    let probe = path.join(".write-probe");
    fs::write(&probe, b"ok").map_err(|e| format!("directory not writable: {e}"))?;
    let _ = fs::remove_file(&probe);
    Ok(())
}

fn resolve_model_assets(
    client: &reqwest::blocking::Client,
) -> Result<Vec<ResolvedModelAsset>, String> {
    let repo_ids: Vec<&str> = MODEL_ASSETS.iter().map(|a| a.repo_id).collect();
    let mut repo_details: std::collections::HashMap<&str, HfModelDetail> =
        std::collections::HashMap::new();
    for repo_id in repo_ids {
        if repo_details.contains_key(repo_id) {
            continue;
        }
        let detail: HfModelDetail = client
            .get(format!("https://huggingface.co/api/models/{repo_id}"))
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("failed contacting HuggingFace for {repo_id}: {e}"))?
            .json()
            .map_err(|e| format!("failed parsing metadata for {repo_id}: {e}"))?;
        repo_details.insert(repo_id, detail);
    }

    let mut resolved = Vec::with_capacity(MODEL_ASSETS.len());
    for asset in MODEL_ASSETS {
        let detail = repo_details.get(asset.repo_id).ok_or_else(|| {
            format!("missing HuggingFace metadata for {}", asset.repo_id)
        })?;
        let siblings = detail.siblings.as_deref().unwrap_or(&[]);
        let size = siblings
            .iter()
            .find(|s| s.rfilename == asset.filename)
            .and_then(|s| s.size)
            .ok_or_else(|| {
                format!(
                    "file {} not found in {} repository",
                    asset.filename, asset.repo_id
                )
            })?;
        resolved.push(ResolvedModelAsset {
            repo_id: asset.repo_id.to_string(),
            filename: asset.filename.to_string(),
            install_name: asset.install_name.to_string(),
            size,
        });
    }
    Ok(resolved)
}

fn download_engine_binary() -> Result<PathBuf, String> {
    let release: GithubRelease = http_client(30)?
        .get(format!(
            "https://api.github.com/repos/{ENGINE_REPO}/releases/latest"
        ))
        .header("User-Agent", app_paths::APP_USER_AGENT)
        .send()
        .map_err(|e| format!("failed fetching sd.cpp releases: {e}"))?
        .error_for_status()
        .map_err(|e| format!("failed fetching sd.cpp release metadata: {e}"))?
        .json()
        .map_err(|e| format!("failed parsing sd.cpp release metadata: {e}"))?;

    let asset = select_engine_asset(
        std::env::consts::OS,
        std::env::consts::ARCH,
        release.assets.as_slice(),
    )
    .ok_or_else(|| {
        format!(
            "No compatible sd.cpp release asset found for {}-{} (release {})",
            std::env::consts::OS,
            std::env::consts::ARCH,
            release.tag_name
        )
    })?;

    let download_dir = std::env::temp_dir()
        .join("arxell")
        .join("sd-cpp-engine-download")
        .join(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis().to_string())
                .unwrap_or_else(|_| "now".to_string()),
        );
    fs::create_dir_all(&download_dir)
        .map_err(|e| format!("failed creating download directory: {e}"))?;

    let archive_path = download_dir.join(&asset.name);
    let mut response = http_client(300)?
        .get(&asset.browser_download_url)
        .header("User-Agent", app_paths::APP_USER_AGENT)
        .send()
        .map_err(|e| format!("failed downloading {}: {e}", asset.name))?
        .error_for_status()
        .map_err(|e| format!("failed downloading {}: {e}", asset.name))?;

    let mut out =
        fs::File::create(&archive_path).map_err(|e| format!("failed creating archive: {e}"))?;
    std::io::copy(&mut response, &mut out)
        .map_err(|e| format!("failed writing archive: {e}"))?;

    let extract_dir = download_dir.join("extract");
    fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("failed creating extraction directory: {e}"))?;
    extract_archive(&archive_path, &extract_dir)?;

    let binary_name = engine_binary_filename();
    find_binary_recursive(&extract_dir, binary_name).ok_or_else(|| {
        format!(
            "Downloaded asset {} did not contain {}",
            asset.name, binary_name
        )
    })
}

fn select_engine_asset(
    os: &str,
    arch: &str,
    assets: &[GithubAsset],
) -> Option<GithubAsset> {
    let arch_keywords: Vec<&str> = match arch {
        "x86_64" => vec!["x64", "x86_64"],
        "aarch64" => vec!["arm64", "aarch64"],
        other => vec![other],
    };

    let mut candidates: Vec<GithubAsset> = Vec::new();

    match os {
        "macos" => {
            for asset in assets {
                let name = asset.name.to_ascii_lowercase();
                if !name.contains("darwin") && !name.contains("macos") {
                    continue;
                }
                if !arch_keywords.iter().any(|k| name.contains(k)) {
                    continue;
                }
                candidates.push(asset.clone());
            }
        }
        "linux" => {
            let preferred_order = ["vulkan", "ubuntu"];
            for keyword in &preferred_order {
                for asset in assets {
                    let name = asset.name.to_ascii_lowercase();
                    if !name.contains("linux") {
                        continue;
                    }
                    if !name.contains(keyword) {
                        continue;
                    }
                    if name.contains("rocm") || name.contains("cuda") {
                        continue;
                    }
                    if !arch_keywords.iter().any(|k| name.contains(k)) {
                        continue;
                    }
                    candidates.push(asset.clone());
                }
                if !candidates.is_empty() {
                    break;
                }
            }
            if candidates.is_empty() {
                for asset in assets {
                    let name = asset.name.to_ascii_lowercase();
                    if !name.contains("linux") {
                        continue;
                    }
                    if name.contains("rocm") || name.contains("cuda") {
                        continue;
                    }
                    if !arch_keywords.iter().any(|k| name.contains(k)) {
                        continue;
                    }
                    candidates.push(asset.clone());
                }
            }
        }
        "windows" => {
            let preferred_order = ["vulkan", "avx2", "avx"];
            for keyword in &preferred_order {
                for asset in assets {
                    let name = asset.name.to_ascii_lowercase();
                    if !name.contains("win") {
                        continue;
                    }
                    if name.contains("cuda") || name.contains("rocm") || name.contains("cudart") {
                        continue;
                    }
                    if keyword != &"vulkan" && !name.contains(keyword) {
                        continue;
                    }
                    if keyword == &"vulkan" && !name.contains("vulkan") {
                        continue;
                    }
                    if !arch_keywords.iter().any(|k| name.contains(k)) {
                        continue;
                    }
                    candidates.push(asset.clone());
                }
                if !candidates.is_empty() {
                    break;
                }
            }
            if candidates.is_empty() {
                for asset in assets {
                    let name = asset.name.to_ascii_lowercase();
                    if !name.contains("win") {
                        continue;
                    }
                    if name.contains("cuda") || name.contains("rocm") || name.contains("cudart") {
                        continue;
                    }
                    if !arch_keywords.iter().any(|k| name.contains(k)) {
                        continue;
                    }
                    candidates.push(asset.clone());
                }
            }
        }
        _ => {}
    }

    candidates.sort_by_key(|a| a.name.len());
    candidates.into_iter().next()
}

fn install_engine_binary(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed creating engine directory: {e}"))?;
    }
    fs::copy(source, target)
        .map_err(|e| format!("failed copying engine binary: {e}"))?;
    set_executable(target)?;
    let support_count = copy_runtime_support_files(source, target)?;
    if support_count > 0 {
        eprintln!("copied {support_count} engine support files");
    }
    Ok(())
}

fn set_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path)
            .map_err(|e| format!("failed reading engine metadata: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms)
            .map_err(|e| format!("failed setting engine executable bit: {e}"))?;
    }
    Ok(())
}

fn copy_runtime_support_files(source: &Path, target: &Path) -> Result<usize, String> {
    let Some(source_dir) = source.parent() else {
        return Ok(0);
    };
    let Some(target_dir) = target.parent() else {
        return Ok(0);
    };
    let mut copied = 0;
    let entries = fs::read_dir(source_dir)
        .map_err(|e| format!("failed listing engine support files: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path == source {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !is_runtime_support_file(name) {
            continue;
        }
        let dest = target_dir.join(name);
        fs::copy(&path, &dest).map_err(|e| {
            format!(
                "failed copying support file {} -> {}: {e}",
                path.display(),
                dest.display()
            )
        })?;
        copied += 1;
    }
    Ok(copied)
}

fn is_runtime_support_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    #[cfg(target_os = "windows")]
    {
        return lower.ends_with(".dll");
    }
    #[cfg(target_os = "macos")]
    {
        return lower.ends_with(".dylib");
    }
    #[cfg(target_os = "linux")]
    {
        return lower.ends_with(".so") || lower.contains(".so.") || lower.ends_with(".bin");
    }
    #[allow(unreachable_code)]
    false
}

fn prepend_engine_lib_path(cmd: &mut Command, engine_dir: &Path) {
    #[cfg(target_os = "linux")]
    {
        cmd.env(
            "LD_LIBRARY_PATH",
            prepend_env_path("LD_LIBRARY_PATH", engine_dir),
        );
    }
    #[cfg(target_os = "macos")]
    {
        cmd.env(
            "DYLD_LIBRARY_PATH",
            prepend_env_path("DYLD_LIBRARY_PATH", engine_dir),
        );
    }
    #[cfg(target_os = "windows")]
    {
        cmd.env("PATH", prepend_env_path("PATH", engine_dir));
    }
}

fn prepend_env_path(var: &str, first: &Path) -> OsString {
    let mut parts = vec![first.to_path_buf()];
    if let Some(existing) = std::env::var_os(var) {
        parts.extend(std::env::split_paths(&existing));
    }
    std::env::join_paths(parts).unwrap_or_else(|_| first.as_os_str().to_os_string())
}

fn http_client(timeout_secs: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("failed creating HTTP client: {e}"))
}

fn extract_archive(archive_path: &Path, out_dir: &Path) -> Result<(), String> {
    let name = archive_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if name.ends_with(".zip") {
        let file =
            fs::File::open(archive_path).map_err(|e| format!("failed opening zip: {e}"))?;
        let mut zip =
            zip::ZipArchive::new(file).map_err(|e| format!("failed reading zip: {e}"))?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
            let Some(rel) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
                continue;
            };
            let target = out_dir.join(rel);
            if entry.is_dir() {
                fs::create_dir_all(&target)
                    .map_err(|e| format!("failed creating directory: {e}"))?;
                continue;
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("failed creating parent directory: {e}"))?;
            }
            let mut out =
                fs::File::create(&target).map_err(|e| format!("failed creating file: {e}"))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("failed extracting file: {e}"))?;
        }
        return Ok(());
    }
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        let file =
            fs::File::open(archive_path).map_err(|e| format!("failed opening tar: {e}"))?;
        let gz = GzDecoder::new(file);
        let mut archive = tar::Archive::new(gz);
        archive
            .unpack(out_dir)
            .map_err(|e| format!("failed extracting tar: {e}"))?;
        return Ok(());
    }
    Err(format!(
        "unsupported archive format: {}",
        archive_path.display()
    ))
}

fn find_binary_recursive(root: &Path, binary_name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_binary_recursive(&path, binary_name) {
                return Some(found);
            }
            continue;
        }
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.eq_ignore_ascii_case(binary_name))
            .unwrap_or(false)
        {
            return Some(path);
        }
    }
    None
}

fn ensure_free_space(path: &Path, required_bytes: u64) -> Result<(), String> {
    let available = available_space_bytes(path)?;
    if available < required_bytes {
        return Err(format!(
            "not enough free disk space: need {}, available {}",
            human_bytes(required_bytes),
            human_bytes(available)
        ));
    }
    Ok(())
}

fn required_free_space_bytes(download_bytes: u64) -> u64 {
    let headroom = (download_bytes / 10).max(512 * 1024 * 1024);
    download_bytes.saturating_add(headroom)
}

#[cfg(target_family = "unix")]
fn available_space_bytes(path: &Path) -> Result<u64, String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let c_path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| format!("invalid path: {}", path.display()))?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };
    if rc != 0 {
        return Err(format!("failed to read free disk space for {}", path.display()));
    }
    Ok((stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64))
}

#[cfg(not(target_family = "unix"))]
fn available_space_bytes(_path: &Path) -> Result<u64, String> {
    Ok(u64::MAX)
}

fn human_bytes(bytes: u64) -> String {
    let units = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut idx = 0_usize;
    while value >= 1000.0 && idx < units.len() - 1 {
        value /= 1000.0;
        idx += 1;
    }
    if value >= 100.0 {
        format!("{value:.0} {}", units[idx])
    } else if value >= 10.0 {
        format!("{value:.1} {}", units[idx])
    } else {
        format!("{value:.2} {}", units[idx])
    }
}

fn url_encode_path_segment(segment: &str) -> String {
    let mut out = String::new();
    for byte in segment.bytes() {
        let ch = byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~') {
            out.push(ch);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(target_family = "unix")]
fn kill_process(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, libc::SIGTERM) == 0 }
}

#[cfg(target_os = "windows")]
fn kill_process(pid: u32) -> bool {
    use std::process::Command as StdCommand;
    StdCommand::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(any(target_family = "unix", target_os = "windows")))]
fn kill_process(_pid: u32) -> bool {
    false
}
