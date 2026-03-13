use std::sync::{Arc, Mutex};

use super::device::{DeviceSelection, ReconciliationResult};

pub struct AudioState {
    pub selected_device_name: Option<String>,
    pub last_selection: Option<DeviceSelection>,
    pub last_reconciliation: Option<ReconciliationResult>,
}

pub type SharedAudioState = Arc<Mutex<AudioState>>;

impl AudioState {
    pub fn new() -> SharedAudioState {
        Arc::new(Mutex::new(AudioState {
            selected_device_name: None,
            last_selection: None,
            last_reconciliation: None,
        }))
    }
}
