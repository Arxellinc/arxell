use cpal::traits::DeviceTrait;
use cpal::Device;

pub struct AudioLog;

impl AudioLog {
    pub fn native_devices(devices: &[Device]) {
        let names: Vec<String> = devices
            .iter()
            .map(|d| d.name().unwrap_or_else(|_| "<unknown>".into()))
            .collect();
        log::debug!("[audio] native input devices: {:?}", names);
    }

    pub fn match_result(strategy: &str, resolved_name: &str, confidence: f32) {
        log::info!(
            "[audio] reconciliation strategy={} resolved='{}' confidence={:.2}",
            strategy,
            resolved_name,
            confidence
        );
    }

    pub fn reconcile_error(context: &str, error: &str) {
        log::error!("[audio] reconcile error: {} ({})", context, error);
    }

    pub fn stream_open_error(device_name: &str, error: &str) {
        log::error!("[audio] stream open failed: '{}' ({})", device_name, error);
    }

    pub fn stream_lost(device_name: &str, reason: &str) {
        log::warn!("[audio] stream lost: '{}' ({})", device_name, reason);
    }
}
