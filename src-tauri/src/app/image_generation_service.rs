use crate::contracts::{
    EventSeverity, EventStage, ImageGenerationGenerateRequest, ImageGenerationGenerateResponse,
    ImageGenerationInstallResponse, ImageGenerationInstallState, ImageGenerationRuntimeState,
    ImageGenerationSetDisabledResponse, ImageGenerationStatusResponse, ImagePackageMetadata,
    Subsystem,
};
use crate::observability::EventHub;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const CURATED_REPO_ID: &str = "amd/FLUX.1-schnell-onnx";
const PACKAGE_ID: &str = "flux-1-schnell-onnx-amd";
const PACKAGE_DIR_NAME: &str = "flux-1-schnell-onnx-amd";
const DOWNLOAD_PROGRESS_INTERVAL_BYTES: u64 = 2 * 1024 * 1024;
const REQUIRED_PACKAGE_PATHS: &[&str] = &[
    "scheduler",
    "text_encoder",
    "text_encoder_2",
    "tokenizer",
    "tokenizer_2",
    "unet",
    "vae_decoder",
    "model_index.json",
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ImageGenerationSettings {
    disabled: bool,
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
        let message = validation.err();
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
            runtime_state: if installed {
                ImageGenerationRuntimeState::ProbeOnly
            } else {
                ImageGenerationRuntimeState::NotReady
            },
            disabled: settings.disabled,
            installed_path: installed.then(|| package_dir.to_string_lossy().to_string()),
            message: message.or_else(|| {
                installed.then(|| {
                    "Package is installed and validated. FLUX ONNX inference remains behind the runtime probe gate.".to_string()
                })
            }),
            required_paths_present: installed,
            generation_ready: false,
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
                "packageId": PACKAGE_ID,
                "phase": "preflight"
            }),
        );

        let image_root = image_packages_dir(app_data_dir)?;
        let staging_root = app_data_dir.join("image-packages-staging");
        std::fs::create_dir_all(&staging_root)
            .map_err(|e| format!("failed to create image package staging directory: {e}"))?;
        let staging_dir = staging_root.join(format!("{}.part", PACKAGE_DIR_NAME));
        if staging_dir.exists() {
            std::fs::remove_dir_all(&staging_dir)
                .map_err(|e| format!("failed to clean previous image package staging directory: {e}"))?;
        }
        std::fs::create_dir_all(&staging_dir)
            .map_err(|e| format!("failed to create image package staging directory: {e}"))?;

        let client = reqwest::blocking::Client::builder()
            .user_agent("arxell-image-generation/0.1")
            .build()
            .map_err(|e| format!("failed to create HTTP client: {e}"))?;
        let detail: HfModelDetail = client
            .get(format!("https://huggingface.co/api/models/{CURATED_REPO_ID}"))
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("preflight failed contacting Hugging Face: {e}"))?
            .json()
            .map_err(|e| format!("failed to parse model package metadata: {e}"))?;
        let mut siblings = detail.siblings.unwrap_or_default();
        siblings.retain(|item| should_download_sibling(item.rfilename.as_str()));
        if siblings.is_empty() {
            return Err("model package metadata did not include downloadable ONNX package files".to_string());
        }
        let total_bytes: Option<u64> = siblings
            .iter()
            .map(|item| item.size)
            .try_fold(0_u64, |acc, item| item.map(|size| acc.saturating_add(size)));

        self.emit(
            correlation_id,
            "image.generation.install",
            EventStage::Progress,
            EventSeverity::Info,
            json!({
                "repoId": CURATED_REPO_ID,
                "packageId": PACKAGE_ID,
                "phase": "download",
                "fileCount": siblings.len(),
                "totalBytes": total_bytes
            }),
        );

        let mut received_total = 0_u64;
        let mut next_emit_at = DOWNLOAD_PROGRESS_INTERVAL_BYTES;
        for sibling in siblings {
            if self.is_install_cancelled(correlation_id) {
                let _ = std::fs::remove_dir_all(&staging_dir);
                self.clear_install_cancel(correlation_id);
                return Err("image package install cancelled by user".to_string());
            }
            let relative = sanitize_relative_path(sibling.rfilename.as_str())?;
            let target = staging_dir.join(&relative);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("failed to create model package directory: {e}"))?;
            }
            let encoded_path = sibling
                .rfilename
                .split('/')
                .map(url_encode_path_segment)
                .collect::<Vec<_>>()
                .join("/");
            let url = format!(
                "https://huggingface.co/{CURATED_REPO_ID}/resolve/main/{encoded_path}?download=true"
            );
            let mut response = client
                .get(url.as_str())
                .send()
                .and_then(|r| r.error_for_status())
                .map_err(|e| format!("failed downloading {}: {e}", sibling.rfilename))?;
            let mut file =
                File::create(&target).map_err(|e| format!("failed creating package file: {e}"))?;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                if self.is_install_cancelled(correlation_id) {
                    let _ = std::fs::remove_dir_all(&staging_dir);
                    self.clear_install_cancel(correlation_id);
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
                            "packageId": PACKAGE_ID,
                            "phase": "download",
                            "fileName": sibling.rfilename,
                            "receivedBytes": received_total,
                            "totalBytes": total_bytes,
                            "percent": total_bytes
                                .filter(|total| *total > 0)
                                .map(|total| (received_total as f64 / total as f64 * 100.0).min(100.0))
                        }),
                    );
                    next_emit_at = received_total.saturating_add(DOWNLOAD_PROGRESS_INTERVAL_BYTES);
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
            json!({ "repoId": CURATED_REPO_ID, "packageId": PACKAGE_ID, "phase": "validate" }),
        );
        validate_package_dir(&staging_dir)?;

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
        self.clear_install_cancel(correlation_id);
        self.emit(
            correlation_id,
            "image.generation.install",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "repoId": CURATED_REPO_ID,
                "packageId": PACKAGE_ID,
                "phase": "complete",
                "installedPath": final_dir.to_string_lossy()
            }),
        );
        Ok(ImageGenerationInstallResponse {
            correlation_id: correlation_id.to_string(),
            installed_path: final_dir.to_string_lossy().to_string(),
            enabled: true,
        })
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

    pub fn remove_packages(&self, correlation_id: &str, app_data_dir: &Path) -> Result<bool, String> {
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
        Err("FLUX ONNX generation is not enabled yet: package validation is implemented, but the full tokenizer/scheduler/UNet/VAE runtime probe has not produced a verified image.".to_string())
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
        name: "FLUX.1 Schnell ONNX".to_string(),
        repo_id: CURATED_REPO_ID.to_string(),
        license: "Apache-2.0".to_string(),
        source_url: format!("https://huggingface.co/{CURATED_REPO_ID}"),
        approximate_size_gb: 36.0,
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
    std::fs::write(&path, raw)
        .map_err(|e| format!("failed writing image generation settings: {e}"))
}

fn validate_package_dir(path: &Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err("image package directory is missing".to_string());
    }
    let mut missing = Vec::new();
    for relative in REQUIRED_PACKAGE_PATHS {
        if !path.join(relative).exists() {
            missing.push(*relative);
        }
    }
    if !missing.is_empty() {
        return Err(format!("image package is missing required paths: {}", missing.join(", ")));
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

fn should_download_sibling(path: &str) -> bool {
    let p = path.trim();
    if p.is_empty() {
        return false;
    }
    if p.starts_with(".git") || p.ends_with(".md") || p.ends_with(".gitattributes") {
        return false;
    }
    REQUIRED_PACKAGE_PATHS
        .iter()
        .any(|required| p == *required || p.starts_with(&format!("{required}/")))
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
