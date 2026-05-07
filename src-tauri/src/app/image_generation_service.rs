use crate::contracts::{
    EventSeverity, EventStage, ImageGenerationGenerateRequest, ImageGenerationGenerateResponse,
    ImageGenerationInstallResponse, ImageGenerationInstallState, ImageGenerationRuntimeState,
    ImageGenerationSetDisabledResponse, ImageGenerationStatusResponse, ImagePackageMetadata,
    Subsystem,
};
use crate::observability::EventHub;
use libloading::Library;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const CURATED_REPO_ID: &str = "Futuremark/FLUX.1-schnell-onnx";
const CURATED_SUPPLEMENTAL_REPO_ID: &str = "amd/FLUX.1-schnell-onnx";
const CURATED_UPSTREAM_URL: &str = "https://huggingface.co/black-forest-labs/FLUX.1-schnell-onnx";
const PACKAGE_ID: &str = "flux-1-schnell-onnx-fp4-curated";
const PACKAGE_DIR_NAME: &str = "flux-1-schnell-onnx-fp4-curated";
const DOWNLOAD_PROGRESS_INTERVAL_BYTES: u64 = 2 * 1024 * 1024;
const CURATED_CORE_MODEL_BYTES: u64 = 6_777_600_000;
const CURATED_AUXILIARY_BYTES: u64 = 9_865_749_000;
struct CuratedAsset {
    repo_id: &'static str,
    source_path: &'static str,
    install_path: &'static str,
}

const CURATED_ASSETS: &[CuratedAsset] = &[
    CuratedAsset {
        repo_id: CURATED_REPO_ID,
        source_path: "clip.opt/model.onnx",
        install_path: "clip.opt/model.onnx",
    },
    CuratedAsset {
        repo_id: CURATED_REPO_ID,
        source_path: "t5.opt/model.onnx",
        install_path: "t5.opt/model.onnx",
    },
    CuratedAsset {
        repo_id: CURATED_REPO_ID,
        source_path: "t5.opt/backbone.onnx_data",
        install_path: "t5.opt/backbone.onnx_data",
    },
    CuratedAsset {
        repo_id: CURATED_REPO_ID,
        source_path: "transformer.opt/fp4/model.onnx",
        install_path: "transformer.opt/fp4/model.onnx",
    },
    CuratedAsset {
        repo_id: CURATED_REPO_ID,
        source_path: "transformer.opt/fp4/backbone.onnx_data",
        install_path: "transformer.opt/fp4/backbone.onnx_data",
    },
    CuratedAsset {
        repo_id: CURATED_REPO_ID,
        source_path: "vae.opt/model.onnx",
        install_path: "vae.opt/model.onnx",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "model_index.json",
        install_path: "model_index.json",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "scheduler/scheduler_config.json",
        install_path: "scheduler/scheduler_config.json",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "text_encoder/config.json",
        install_path: "text_encoder/config.json",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "text_encoder_2/config.json",
        install_path: "text_encoder_2/config.json",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "tokenizer/merges.txt",
        install_path: "tokenizer/merges.txt",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "tokenizer/special_tokens_map.json",
        install_path: "tokenizer/special_tokens_map.json",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "tokenizer/tokenizer_config.json",
        install_path: "tokenizer/tokenizer_config.json",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "tokenizer/vocab.json",
        install_path: "tokenizer/vocab.json",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "tokenizer_2/special_tokens_map.json",
        install_path: "tokenizer_2/special_tokens_map.json",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "tokenizer_2/spiece.model",
        install_path: "tokenizer_2/spiece.model",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "tokenizer_2/tokenizer.json",
        install_path: "tokenizer_2/tokenizer.json",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "tokenizer_2/tokenizer_config.json",
        install_path: "tokenizer_2/tokenizer_config.json",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "unet/config.json",
        install_path: "unet/config.json",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "vae_decoder/config.json",
        install_path: "vae_decoder/config.json",
    },
    CuratedAsset {
        repo_id: CURATED_SUPPLEMENTAL_REPO_ID,
        source_path: "vae_encoder/config.json",
        install_path: "vae_encoder/config.json",
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

#[derive(Debug, Clone)]
struct ResolvedCuratedAsset {
    repo_id: &'static str,
    source_path: String,
    install_path: String,
    size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ImageGenerationSettings {
    disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageGenerationProbeState {
    package_signature: String,
    runtime_state: ImageGenerationRuntimeState,
    message: String,
}

#[derive(Clone)]
pub struct ImageGenerationService {
    hub: EventHub,
    cancelled_installs: Arc<Mutex<HashSet<String>>>,
}

impl ImageGenerationService {
    pub fn new(hub: EventHub) -> Self {
        Self {
            hub,
            cancelled_installs: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub fn status(
        &self,
        correlation_id: &str,
        app_data_dir: &Path,
    ) -> Result<ImageGenerationStatusResponse, String> {
        let package_dir = package_dir(app_data_dir);
        let settings = read_settings(app_data_dir);
        let validation = validate_package_dir(&package_dir);
        let installed = package_dir.exists() && validation.is_ok();
        let validation_error = validation.err();
        let probe_state = if installed {
            read_probe_state(app_data_dir)
        } else {
            None
        };
        let package_signature = installed
            .then(|| compute_package_signature(&package_dir))
            .transpose()?;
        let probe_matches = probe_state
            .as_ref()
            .zip(package_signature.as_ref())
            .map(|(probe, sig)| probe.package_signature == *sig)
            .unwrap_or(false);
        let runtime_state = if installed {
            match probe_state
                .as_ref()
                .filter(|_| probe_matches)
                .map(|probe| probe.runtime_state.clone())
            {
                Some(ImageGenerationRuntimeState::Error) => ImageGenerationRuntimeState::Error,
                Some(ImageGenerationRuntimeState::Ready) => ImageGenerationRuntimeState::Ready,
                Some(_) => ImageGenerationRuntimeState::ProbeOnly,
                None => ImageGenerationRuntimeState::NotReady,
            }
        } else {
            ImageGenerationRuntimeState::NotReady
        };
        let message = if let Some(err) = validation_error {
            Some(err)
        } else if installed {
            probe_state
                .as_ref()
                .filter(|_| probe_matches)
                .map(|probe| probe.message.clone())
                .or_else(|| {
                    Some("Curated FLUX ONNX FP4 package is installed, but the runtime probe has not been recorded yet.".to_string())
                })
        } else {
            None
        };
        let generation_ready = matches!(runtime_state, ImageGenerationRuntimeState::Ready);
        Ok(ImageGenerationStatusResponse {
            correlation_id: correlation_id.to_string(),
            package: curated_package_metadata(),
            install_state: if installed {
                ImageGenerationInstallState::Installed
            } else if package_dir.exists() {
                ImageGenerationInstallState::Error
            } else {
                ImageGenerationInstallState::NotInstalled
            },
            runtime_state,
            disabled: settings.disabled,
            installed_path: installed.then(|| package_dir.to_string_lossy().to_string()),
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
        self.emit(
            correlation_id,
            "image.generation.install",
            EventStage::Start,
            EventSeverity::Info,
            json!({
                "repoId": CURATED_REPO_ID,
                "supplementalRepoId": CURATED_SUPPLEMENTAL_REPO_ID,
                "packageId": PACKAGE_ID,
                "phase": "preflight"
            }),
        );

        let image_root = image_packages_dir(app_data_dir)?;
        let staging_root = app_data_dir.join("image-packages-staging");
        std::fs::create_dir_all(&staging_root)
            .map_err(|e| format!("failed to create image package staging directory: {e}"))?;
        let staging_dir = staging_root.join(format!("{}.part", PACKAGE_DIR_NAME));
        let mut phase = "preflight";
        let result = (|| -> Result<ImageGenerationInstallResponse, String> {
            if staging_dir.exists() {
                std::fs::remove_dir_all(&staging_dir).map_err(|e| {
                    format!("failed to clean previous image package staging directory: {e}")
                })?;
            }
            std::fs::create_dir_all(&staging_dir)
                .map_err(|e| format!("failed to create image package staging directory: {e}"))?;

            verify_runtime_architecture()?;
            verify_write_access(&staging_root)?;
            let ort_path = resolve_onnxruntime_library().ok_or_else(|| {
                "bundled ONNX Runtime library was not found in resources/onnxruntime".to_string()
            })?;
            verify_onnxruntime_library_loadable(&ort_path)?;

            let client = reqwest::blocking::Client::builder()
                .user_agent("arxell-image-generation/0.1")
                .build()
                .map_err(|e| format!("failed to create HTTP client: {e}"))?;
            let assets = resolve_curated_assets(&client)?;
            if assets.is_empty() {
                return Err(
                    "curated image package metadata did not include downloadable files".to_string(),
                );
            }
            let total_bytes = total_bytes_for_assets(&assets);
            ensure_free_space(&staging_root, required_free_space_bytes(total_bytes))?;

            phase = "download";
            self.emit(
                correlation_id,
                "image.generation.install",
                EventStage::Progress,
                EventSeverity::Info,
                json!({
                    "repoId": CURATED_REPO_ID,
                    "supplementalRepoId": CURATED_SUPPLEMENTAL_REPO_ID,
                    "packageId": PACKAGE_ID,
                    "phase": phase,
                    "fileCount": assets.len(),
                    "totalBytes": total_bytes
                }),
            );

            let mut received_total = 0_u64;
            let mut next_emit_at = DOWNLOAD_PROGRESS_INTERVAL_BYTES;
            for asset in assets {
                if self.is_install_cancelled(correlation_id) {
                    return Err("image package install cancelled by user".to_string());
                }
                let relative = sanitize_relative_path(asset.install_path.as_str())?;
                let target = staging_dir.join(&relative);
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("failed to create model package directory: {e}"))?;
                }
                let encoded_path = asset
                    .source_path
                    .split('/')
                    .map(url_encode_path_segment)
                    .collect::<Vec<_>>()
                    .join("/");
                let url = format!(
                    "https://huggingface.co/{}/resolve/main/{encoded_path}?download=true",
                    asset.repo_id
                );
                let mut response = client
                    .get(url.as_str())
                    .send()
                    .and_then(|r| r.error_for_status())
                    .map_err(|e| {
                        format!(
                            "failed downloading {} from {}: {e}",
                            asset.source_path, asset.repo_id
                        )
                    })?;
                let mut file = File::create(&target)
                    .map_err(|e| format!("failed creating package file: {e}"))?;
                let mut buffer = [0_u8; 64 * 1024];
                loop {
                    if self.is_install_cancelled(correlation_id) {
                        return Err("image package install cancelled by user".to_string());
                    }
                    let read = response
                        .read(&mut buffer)
                        .map_err(|e| format!("failed reading package response: {e}"))?;
                    if read == 0 {
                        break;
                    }
                    file.write_all(&buffer[..read])
                        .map_err(|e| format!("failed writing package file: {e}"))?;
                    received_total = received_total.saturating_add(read as u64);
                    if received_total >= next_emit_at {
                        self.emit(
                            correlation_id,
                            "image.generation.install",
                            EventStage::Progress,
                            EventSeverity::Info,
                            json!({
                                "repoId": CURATED_REPO_ID,
                                "supplementalRepoId": CURATED_SUPPLEMENTAL_REPO_ID,
                                "packageId": PACKAGE_ID,
                                "phase": phase,
                                "fileName": asset.install_path,
                                "receivedBytes": received_total,
                                "totalBytes": total_bytes,
                                "percent": (received_total as f64 / total_bytes as f64 * 100.0).min(100.0)
                            }),
                        );
                        next_emit_at =
                            received_total.saturating_add(DOWNLOAD_PROGRESS_INTERVAL_BYTES);
                    }
                }
                file.flush()
                    .map_err(|e| format!("failed flushing package file: {e}"))?;
            }
            self.emit(
                correlation_id,
                "image.generation.install",
                EventStage::Progress,
                EventSeverity::Info,
                json!({
                    "repoId": CURATED_REPO_ID,
                    "supplementalRepoId": CURATED_SUPPLEMENTAL_REPO_ID,
                    "packageId": PACKAGE_ID,
                    "phase": phase,
                    "receivedBytes": received_total,
                    "totalBytes": total_bytes,
                    "percent": (received_total as f64 / total_bytes as f64 * 100.0).min(100.0)
                }),
            );

            phase = "validate";
            self.emit(
                correlation_id,
                "image.generation.install",
                EventStage::Progress,
                EventSeverity::Info,
                json!({
                    "repoId": CURATED_REPO_ID,
                    "supplementalRepoId": CURATED_SUPPLEMENTAL_REPO_ID,
                    "packageId": PACKAGE_ID,
                    "phase": phase
                }),
            );
            validate_package_dir(&staging_dir)?;

            phase = "activating";
            self.emit(
                correlation_id,
                "image.generation.install",
                EventStage::Progress,
                EventSeverity::Info,
                json!({
                    "repoId": CURATED_REPO_ID,
                    "supplementalRepoId": CURATED_SUPPLEMENTAL_REPO_ID,
                    "packageId": PACKAGE_ID,
                    "phase": phase,
                    "receivedBytes": total_bytes,
                    "totalBytes": total_bytes,
                    "percent": 100.0_f64
                }),
            );

            let final_dir = image_root.join(PACKAGE_DIR_NAME);
            let previous_dir = image_root.join(format!("{}.previous", PACKAGE_DIR_NAME));
            if previous_dir.exists() {
                let _ = std::fs::remove_dir_all(&previous_dir);
            }
            if final_dir.exists() {
                std::fs::rename(&final_dir, &previous_dir)
                    .map_err(|e| format!("failed staging previous image package: {e}"))?;
            }
            match std::fs::rename(&staging_dir, &final_dir) {
                Ok(()) => {
                    if previous_dir.exists() {
                        let _ = std::fs::remove_dir_all(&previous_dir);
                    }
                }
                Err(err) => {
                    if previous_dir.exists() {
                        let _ = std::fs::rename(&previous_dir, &final_dir);
                    }
                    return Err(format!("failed activating image package: {err}"));
                }
            }

            let mut settings = read_settings(app_data_dir);
            settings.disabled = false;
            write_settings(app_data_dir, &settings)?;
            let probe_state = match run_runtime_probe(&final_dir) {
                Ok(message) => ImageGenerationProbeState {
                    package_signature: compute_package_signature(&final_dir)?,
                    runtime_state: ImageGenerationRuntimeState::ProbeOnly,
                    message,
                },
                Err(message) => ImageGenerationProbeState {
                    package_signature: compute_package_signature(&final_dir)?,
                    runtime_state: ImageGenerationRuntimeState::Error,
                    message,
                },
            };
            write_probe_state(app_data_dir, &probe_state)?;
            self.clear_install_cancel(correlation_id);
            self.emit(
                correlation_id,
                "image.generation.install",
                EventStage::Complete,
                EventSeverity::Info,
                json!({
                    "repoId": CURATED_REPO_ID,
                    "supplementalRepoId": CURATED_SUPPLEMENTAL_REPO_ID,
                    "packageId": PACKAGE_ID,
                    "phase": "complete",
                    "installedPath": final_dir.to_string_lossy(),
                    "runtimeState": probe_state.runtime_state,
                    "runtimeMessage": probe_state.message
                }),
            );
            Ok(ImageGenerationInstallResponse {
                correlation_id: correlation_id.to_string(),
                installed_path: final_dir.to_string_lossy().to_string(),
                enabled: true,
            })
        })();
        match result {
            Ok(response) => Ok(response),
            Err(message) => {
                let _ = std::fs::remove_dir_all(&staging_dir);
                self.clear_install_cancel(correlation_id);
                self.emit(
                    correlation_id,
                    "image.generation.install",
                    EventStage::Error,
                    EventSeverity::Error,
                    json!({
                        "repoId": CURATED_REPO_ID,
                        "supplementalRepoId": CURATED_SUPPLEMENTAL_REPO_ID,
                        "packageId": PACKAGE_ID,
                        "phase": phase,
                        "message": message
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

    pub fn remove_packages(
        &self,
        correlation_id: &str,
        app_data_dir: &Path,
    ) -> Result<bool, String> {
        let root = app_data_dir.join("image-packages");
        let removed = if root.exists() {
            std::fs::remove_dir_all(&root)
                .map_err(|e| format!("failed removing image packages: {e}"))?;
            true
        } else {
            false
        };
        let staging = app_data_dir.join("image-packages-staging");
        if staging.exists() {
            let _ = std::fs::remove_dir_all(&staging);
        }
        let probe = probe_state_path(app_data_dir);
        if probe.exists() {
            let _ = std::fs::remove_file(&probe);
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
            return Err("image package is not installed or failed validation".to_string());
        }
        if status.runtime_state == ImageGenerationRuntimeState::Error {
            return Err(status
                .message
                .unwrap_or_else(|| "image runtime probe failed".to_string()));
        }
        Err("The curated FLUX package is installed and validated, but the full text-to-image pipeline is not implemented yet.".to_string())
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
        name: "FLUX.1 Schnell ONNX FP4".to_string(),
        repo_id: CURATED_REPO_ID.to_string(),
        license: "Apache-2.0".to_string(),
        source_url: format!("https://huggingface.co/{CURATED_REPO_ID}"),
        upstream_url: Some(CURATED_UPSTREAM_URL.to_string()),
        precision_label: "FP4 transformer".to_string(),
        core_model_bytes: CURATED_CORE_MODEL_BYTES,
        auxiliary_bytes: CURATED_AUXILIARY_BYTES,
        total_install_bytes: CURATED_CORE_MODEL_BYTES.saturating_add(CURATED_AUXILIARY_BYTES),
        recommended_steps: 4,
        recommended_guidance: 1.0,
    }
}

fn image_packages_dir(app_data_dir: &Path) -> Result<PathBuf, String> {
    let path = app_data_dir.join("image-packages");
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("failed to create image packages directory: {e}"))?;
    Ok(path)
}

fn package_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("image-packages").join(PACKAGE_DIR_NAME)
}

fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("image-generation").join("settings.json")
}

fn probe_state_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join("image-generation")
        .join("probe-state.json")
}

fn read_settings(app_data_dir: &Path) -> ImageGenerationSettings {
    let path = settings_path(app_data_dir);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return ImageGenerationSettings::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_settings(app_data_dir: &Path, settings: &ImageGenerationSettings) -> Result<(), String> {
    let path = settings_path(app_data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed creating image generation settings directory: {e}"))?;
    }
    let raw = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("failed serializing image generation settings: {e}"))?;
    std::fs::write(&path, raw).map_err(|e| format!("failed writing image generation settings: {e}"))
}

fn read_probe_state(app_data_dir: &Path) -> Option<ImageGenerationProbeState> {
    let path = probe_state_path(app_data_dir);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return None;
    };
    serde_json::from_str(&raw).ok()
}

fn write_probe_state(app_data_dir: &Path, probe: &ImageGenerationProbeState) -> Result<(), String> {
    let path = probe_state_path(app_data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed creating image generation probe directory: {e}"))?;
    }
    let raw = serde_json::to_string_pretty(probe)
        .map_err(|e| format!("failed serializing image generation probe state: {e}"))?;
    std::fs::write(&path, raw)
        .map_err(|e| format!("failed writing image generation probe state: {e}"))
}

fn validate_package_dir(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err("image package directory is missing".to_string());
    }
    let mut missing = Vec::new();
    for asset in CURATED_ASSETS {
        if !path.join(asset.install_path).exists() {
            missing.push(asset.install_path);
        }
    }
    if !missing.is_empty() {
        return Err(format!(
            "image package is missing required paths: {}",
            missing.join(", ")
        ));
    }
    let has_onnx = contains_extension(path, "onnx")?;
    if !has_onnx {
        return Err("image package does not contain any .onnx model files".to_string());
    }
    Ok(())
}

fn contains_extension(path: &Path, extension: &str) -> Result<bool, String> {
    let entries = std::fs::read_dir(path)
        .map_err(|e| format!("failed reading image package directory: {e}"))?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if contains_extension(&p, extension)? {
                return Ok(true);
            }
        } else if p
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case(extension))
            .unwrap_or(false)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn resolve_curated_assets(
    client: &reqwest::blocking::Client,
) -> Result<Vec<ResolvedCuratedAsset>, String> {
    let primary_detail: HfModelDetail = client
        .get(format!(
            "https://huggingface.co/api/models/{CURATED_REPO_ID}"
        ))
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("failed contacting Hugging Face for {CURATED_REPO_ID}: {e}"))?
        .json()
        .map_err(|e| {
            format!("failed to parse curated package metadata for {CURATED_REPO_ID}: {e}")
        })?;
    let supplemental_detail: HfModelDetail = client
        .get(format!(
            "https://huggingface.co/api/models/{CURATED_SUPPLEMENTAL_REPO_ID}"
        ))
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| {
            format!("failed contacting Hugging Face for {CURATED_SUPPLEMENTAL_REPO_ID}: {e}")
        })?
        .json()
        .map_err(|e| {
            format!(
                "failed to parse curated package metadata for {CURATED_SUPPLEMENTAL_REPO_ID}: {e}"
            )
        })?;
    let mut resolved = Vec::with_capacity(CURATED_ASSETS.len());
    resolved.extend(select_repo_assets(
        primary_detail.siblings.unwrap_or_default(),
        CURATED_ASSETS
            .iter()
            .filter(|asset| asset.repo_id == CURATED_REPO_ID),
        CURATED_REPO_ID,
    )?);
    resolved.extend(select_repo_assets(
        supplemental_detail.siblings.unwrap_or_default(),
        CURATED_ASSETS
            .iter()
            .filter(|asset| asset.repo_id == CURATED_SUPPLEMENTAL_REPO_ID),
        CURATED_SUPPLEMENTAL_REPO_ID,
    )?);
    resolved.sort_by(|a, b| a.install_path.cmp(&b.install_path));
    Ok(resolved)
}

fn select_repo_assets<'a>(
    siblings: Vec<HfSibling>,
    expected_assets: impl Iterator<Item = &'a CuratedAsset>,
    repo_id: &str,
) -> Result<Vec<ResolvedCuratedAsset>, String> {
    let sibling_map = siblings
        .into_iter()
        .map(|item| (item.rfilename, item.size))
        .collect::<std::collections::HashMap<_, _>>();
    let expected_assets = expected_assets.collect::<Vec<_>>();
    let missing: Vec<&str> = expected_assets
        .iter()
        .filter(|asset| !sibling_map.contains_key(asset.source_path))
        .map(|asset| asset.source_path)
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "curated image package is missing required files from {repo_id}: {}",
            missing.join(", ")
        ));
    }
    expected_assets
        .into_iter()
        .map(|asset| {
            let size = sibling_map
                .get(asset.source_path)
                .copied()
                .flatten()
                .ok_or_else(|| {
                    format!(
                        "curated image package is missing size metadata for {} in {}",
                        asset.source_path, repo_id
                    )
                })?;
            Ok(ResolvedCuratedAsset {
                repo_id: asset.repo_id,
                source_path: asset.source_path.to_string(),
                install_path: asset.install_path.to_string(),
                size,
            })
        })
        .collect()
}

fn sanitize_relative_path(path: &str) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains('\\') {
            return Err(format!("unsafe model package path: {path}"));
        }
        out.push(part);
    }
    Ok(out)
}

fn total_bytes_for_assets(assets: &[ResolvedCuratedAsset]) -> u64 {
    assets
        .iter()
        .fold(0_u64, |acc, item| acc.saturating_add(item.size))
}

fn required_free_space_bytes(download_bytes: u64) -> u64 {
    let headroom = (download_bytes / 10).max(512 * 1024 * 1024);
    download_bytes.saturating_add(headroom)
}

fn verify_write_access(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path)
        .map_err(|e| format!("failed creating image package staging directory: {e}"))?;
    let probe = path.join(".write-probe");
    std::fs::write(&probe, b"ok")
        .map_err(|e| format!("image package staging directory is not writable: {e}"))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

fn verify_runtime_architecture() -> Result<(), String> {
    #[cfg(not(target_arch = "x86_64"))]
    {
        return Err(format!(
            "the curated ONNX image package is only supported on x64 right now (current arch: {})",
            std::env::consts::ARCH
        ));
    }
    Ok(())
}

fn ensure_free_space(path: &Path, required_bytes: u64) -> Result<(), String> {
    let available = available_space_bytes(path)?;
    if available < required_bytes {
        return Err(format!(
            "not enough free disk space for image package install: need {}, available {}",
            human_bytes(required_bytes),
            human_bytes(available)
        ));
    }
    Ok(())
}

#[cfg(target_family = "unix")]
fn available_space_bytes(path: &Path) -> Result<u64, String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let c_path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| format!("invalid install path: {}", path.display()))?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) };
    if rc != 0 {
        return Err(format!(
            "failed to read free disk space for {}",
            path.display()
        ));
    }
    Ok((stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64))
}

#[cfg(not(target_family = "unix"))]
fn available_space_bytes(_path: &Path) -> Result<u64, String> {
    Ok(u64::MAX)
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

fn verify_onnxruntime_library_loadable(path: &Path) -> Result<(), String> {
    let lib = unsafe { Library::new(path) }
        .map_err(|e| format!("failed loading ONNX Runtime from {}: {e}", path.display()))?;
    let _: libloading::Symbol<'_, unsafe extern "C" fn() -> *const ort_sys::OrtApiBase> =
        unsafe { lib.get(b"OrtGetApiBase") }
            .map_err(|_| format!("ONNX Runtime is missing OrtGetApiBase: {}", path.display()))?;
    Ok(())
}

fn run_runtime_probe(package_dir: &Path) -> Result<String, String> {
    let ort_path = resolve_onnxruntime_library().ok_or_else(|| {
        "bundled ONNX Runtime library was not found in resources/onnxruntime".to_string()
    })?;
    let lib = unsafe { Library::new(&ort_path) }.map_err(|e| {
        format!(
            "failed loading ONNX Runtime from {}: {e}",
            ort_path.display()
        )
    })?;
    let api = unsafe { load_ort_api(&lib)? };
    for asset in CURATED_ASSETS {
        if !asset.install_path.ends_with(".onnx") {
            continue;
        }
        let model_path = package_dir.join(asset.install_path);
        unsafe { probe_onnx_session(api, &model_path)? };
    }
    Ok("Package validated, ONNX sessions load successfully, and the supplemental tokenizer/scheduler/config assets are present. Full image generation is still disabled until the FLUX pipeline is implemented.".to_string())
}

fn compute_package_signature(package_dir: &Path) -> Result<String, String> {
    let mut parts = Vec::new();
    for asset in CURATED_ASSETS {
        let path = package_dir.join(asset.install_path);
        let metadata = std::fs::metadata(&path).map_err(|e| {
            format!(
                "failed reading package metadata for {}: {e}",
                path.display()
            )
        })?;
        parts.push(format!(
            "{}:{}:{}",
            asset.install_path,
            metadata.len(),
            metadata
                .modified()
                .ok()
                .and_then(|ts| ts.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|dur| dur.as_secs())
                .unwrap_or(0)
        ));
    }
    Ok(parts.join("|"))
}

unsafe fn load_ort_api(lib: &Library) -> Result<&ort_sys::OrtApi, String> {
    let base_getter: libloading::Symbol<'_, unsafe extern "C" fn() -> *const ort_sys::OrtApiBase> =
        unsafe { lib.get(b"OrtGetApiBase") }
            .map_err(|_| "expected OrtGetApiBase to be present in libonnxruntime".to_string())?;
    let base = unsafe { base_getter() };
    if base.is_null() {
        return Err("ORT: OrtGetApiBase returned null".to_string());
    }
    let base_ref = unsafe { &*base };
    let get_api = base_ref
        .GetApi
        .ok_or_else(|| "ORT: GetApi missing from OrtApiBase".to_string())?;
    let api_ptr = get_api(19);
    if api_ptr.is_null() {
        return Err("ORT: GetApi(19) returned null".to_string());
    }
    Ok(unsafe { &*api_ptr })
}

unsafe fn ort_check_status(
    api: &ort_sys::OrtApi,
    status: *mut ort_sys::OrtStatus,
) -> Result<(), String> {
    if status.is_null() {
        return Ok(());
    }
    let msg_ptr = api
        .GetErrorMessage
        .ok_or_else(|| "ORT: GetErrorMessage missing".to_string())?(status);
    let msg = unsafe { std::ffi::CStr::from_ptr(msg_ptr) }
        .to_string_lossy()
        .into_owned();
    if let Some(release) = api.ReleaseStatus {
        release(status);
    }
    Err(msg)
}

unsafe fn probe_onnx_session(api: &ort_sys::OrtApi, model_path: &Path) -> Result<(), String> {
    let env_name = std::ffi::CString::new("image_probe").map_err(|e| format!("{e}"))?;
    let model_cstr = std::ffi::CString::new(model_path.to_string_lossy().as_bytes())
        .map_err(|e| format!("invalid model path {}: {e}", model_path.display()))?;
    let create_env = api
        .CreateEnv
        .ok_or_else(|| "ORT: CreateEnv missing".to_string())?;
    let create_opts = api
        .CreateSessionOptions
        .ok_or_else(|| "ORT: CreateSessionOptions missing".to_string())?;
    let create_session = api
        .CreateSession
        .ok_or_else(|| "ORT: CreateSession missing".to_string())?;
    let mut env: *mut ort_sys::OrtEnv = std::ptr::null_mut();
    let mut opts: *mut ort_sys::OrtSessionOptions = std::ptr::null_mut();
    let mut session: *mut ort_sys::OrtSession = std::ptr::null_mut();
    unsafe {
        ort_check_status(
            api,
            create_env(
                ort_sys::OrtLoggingLevel::ORT_LOGGING_LEVEL_WARNING,
                env_name.as_ptr(),
                &mut env,
            ),
        )
        .map_err(|e| format!("failed creating ORT env for {}: {e}", model_path.display()))?;
        ort_check_status(api, create_opts(&mut opts)).map_err(|e| {
            format!(
                "failed creating ORT session options for {}: {e}",
                model_path.display()
            )
        })?;
        if let Some(set_threads) = api.SetIntraOpNumThreads {
            let _ = ort_check_status(api, set_threads(opts, 2));
        }
        let status = create_session(env, model_cstr.as_ptr() as *const _, opts, &mut session);
        let session_result = ort_check_status(api, status)
            .map_err(|e| format!("failed loading ONNX session {}: {e}", model_path.display()));
        if let Some(release) = api.ReleaseSessionOptions {
            release(opts);
        }
        if !session.is_null() {
            if let Some(release) = api.ReleaseSession {
                release(session);
            }
        }
        if !env.is_null() {
            if let Some(release) = api.ReleaseEnv {
                release(env);
            }
        }
        session_result
    }
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
