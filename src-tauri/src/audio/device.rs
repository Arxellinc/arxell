use cpal::traits::{DeviceTrait, HostTrait};
use cpal::Device;
use serde::{Deserialize, Serialize};

use super::observe::AudioLog;

const MIN_CONFIDENCE: f32 = 0.4;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub webview_id: String,
    pub label: String,
    #[serde(default)]
    pub normalized_label: String,
    pub group_id: String,
    pub is_default: bool,
    pub availability: DeviceAvailability,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DeviceAvailability {
    Available,
    InUse,
    NotFound,
    PermissionDenied,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFingerprint {
    pub normalized_label: String,
    pub group_id: String,
    pub webview_id_hint: String,
    pub last_seen_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSelection {
    pub fingerprint_preferred: Option<DeviceFingerprint>,
    pub fallback_to_default: bool,
    pub all_devices: Vec<AudioDeviceInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationResult {
    pub resolved_native_name: Option<String>,
    pub match_strategy: MatchStrategy,
    pub confidence: f32,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MatchStrategy {
    ExactLabel,
    NormalizedLabel,
    Substring,
    Fuzzy,
    DefaultFallback,
    None,
}

pub fn normalize_label(raw: &str) -> String {
    let mut s = raw.to_ascii_lowercase();
    s = s.trim().to_string();
    for prefix in [
        "default - ",
        "communications - ",
        "pipewire",
        "pulse",
        "alsa",
    ] {
        if s.starts_with(prefix) {
            s = s[prefix.len()..].trim().to_string();
        }
    }
    s
}

pub fn reconcile_device(selection: &DeviceSelection) -> (Option<Device>, ReconciliationResult) {
    let host = cpal::default_host();
    let native_devices: Vec<Device> = match host.input_devices() {
        Ok(d) => d.collect(),
        Err(e) => {
            AudioLog::reconcile_error("host.input_devices failed", &e.to_string());
            return (
                None,
                ReconciliationResult {
                    resolved_native_name: None,
                    match_strategy: MatchStrategy::None,
                    confidence: 0.0,
                    warning: Some(format!("Failed to enumerate native devices: {e}")),
                },
            );
        }
    };

    AudioLog::native_devices(&native_devices);

    if let Some(fp) = &selection.fingerprint_preferred {
        if let Some((device, name)) = find_exact(&native_devices, &fp.last_seen_label) {
            AudioLog::match_result("exact_label", &name, 1.0);
            return (
                Some(device),
                ReconciliationResult {
                    resolved_native_name: Some(name),
                    match_strategy: MatchStrategy::ExactLabel,
                    confidence: 1.0,
                    warning: None,
                },
            );
        }

        if let Some((device, name)) = find_normalized(&native_devices, &fp.normalized_label) {
            AudioLog::match_result("normalized_label", &name, 0.85);
            return (
                Some(device),
                ReconciliationResult {
                    resolved_native_name: Some(name),
                    match_strategy: MatchStrategy::NormalizedLabel,
                    confidence: 0.85,
                    warning: None,
                },
            );
        }

        if let Some((device, name)) = find_substring(&native_devices, &fp.normalized_label) {
            AudioLog::match_result("substring", &name, 0.6);
            let warn_name = name.clone();
            return (
                Some(device),
                ReconciliationResult {
                    resolved_native_name: Some(name),
                    match_strategy: MatchStrategy::Substring,
                    confidence: 0.6,
                    warning: Some(format!(
                        "Matched '{}' via substring — device label may have changed",
                        warn_name
                    )),
                },
            );
        }

        if let Some((device, name, score)) = find_fuzzy(&native_devices, &fp.normalized_label) {
            if score >= MIN_CONFIDENCE {
                AudioLog::match_result("fuzzy", &name, score);
                return (
                    Some(device),
                    ReconciliationResult {
                        resolved_native_name: Some(name),
                        match_strategy: MatchStrategy::Fuzzy,
                        confidence: score,
                        warning: Some(format!(
                            "Fuzzy match only (confidence {:.0}%) — verify device is correct",
                            score * 100.0
                        )),
                    },
                );
            }
        }
    }

    if selection.fallback_to_default {
        if let Some(device) = host.default_input_device() {
            let name = device.name().unwrap_or_else(|_| "default".into());
            AudioLog::match_result("default_fallback", &name, 0.0);
            return (
                Some(device),
                ReconciliationResult {
                    resolved_native_name: Some(name),
                    match_strategy: MatchStrategy::DefaultFallback,
                    confidence: 0.0,
                    warning: Some("Preferred device not found — using system default".into()),
                },
            );
        }
    }

    (
        None,
        ReconciliationResult {
            resolved_native_name: None,
            match_strategy: MatchStrategy::None,
            confidence: 0.0,
            warning: Some("No suitable input device found".into()),
        },
    )
}

fn find_exact(devices: &[Device], label: &str) -> Option<(Device, String)> {
    devices.iter().find_map(|d| {
        let name = d.name().ok()?;
        (name == label).then(|| (d.clone(), name))
    })
}

fn find_normalized(devices: &[Device], normalized: &str) -> Option<(Device, String)> {
    devices.iter().find_map(|d| {
        let name = d.name().ok()?;
        (normalize_label(&name) == normalized).then(|| (d.clone(), name))
    })
}

fn find_substring(devices: &[Device], normalized: &str) -> Option<(Device, String)> {
    devices.iter().find_map(|d| {
        let name = d.name().ok()?;
        let norm = normalize_label(&name);
        (norm.contains(normalized) || normalized.contains(&norm))
            .then(|| (d.clone(), name))
    })
}

fn find_fuzzy(devices: &[Device], normalized: &str) -> Option<(Device, String, f32)> {
    let query_tokens: Vec<&str> = normalized.split_whitespace().collect();
    devices
        .iter()
        .filter_map(|d| {
            let name = d.name().ok()?;
            let norm = normalize_label(&name);
            let candidate_tokens: Vec<&str> = norm.split_whitespace().collect();
            let shared = query_tokens
                .iter()
                .filter(|t| candidate_tokens.contains(t))
                .count();
            let max = query_tokens.len().max(candidate_tokens.len());
            if max == 0 {
                return None;
            }
            let score = shared as f32 / max as f32;
            Some((d.clone(), name, score))
        })
        .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap())
}
