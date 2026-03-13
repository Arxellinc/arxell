pub mod capture;
pub mod device;
pub mod observe;
pub mod state;
pub mod stream;
pub mod stt;
pub mod tts;
pub mod vad;

use cpal::traits::DeviceTrait;
use tauri::{AppHandle, Emitter, State};

use device::{reconcile_device, DeviceSelection, ReconciliationResult};
use observe::AudioLog;
use state::SharedAudioState;
use stream::open_input_stream;

#[tauri::command]
pub async fn set_audio_device(
    selection: DeviceSelection,
    state: State<'_, SharedAudioState>,
    app: AppHandle,
) -> Result<ReconciliationResult, String> {
    let (device, reconciliation) = reconcile_device(&selection);

    if let Some(warning) = &reconciliation.warning {
        let _ = app.emit("audio_device_warning", warning);
    }

    match device {
        None => {
            let _ = app.emit("audio_device_error", "No suitable input device found");
            let mut guard = state.lock().unwrap();
            guard.selected_device_name = None;
            guard.last_selection = Some(selection);
            guard.last_reconciliation = Some(reconciliation.clone());
            return Ok(reconciliation);
        }
        Some(device) => {
            if let Err(e) = open_input_stream(&device) {
                let msg = e.to_string();
                AudioLog::stream_open_error(&device.name().unwrap_or_default(), &msg);
                let _ = app.emit("audio_device_error", &msg);
                return Err(msg);
            }
            let name = device.name().unwrap_or_else(|_| "default".into());
            let mut guard = state.lock().unwrap();
            guard.selected_device_name = Some(name);
            guard.last_selection = Some(selection);
            guard.last_reconciliation = Some(reconciliation.clone());
        }
    }

    Ok(reconciliation)
}

#[tauri::command]
pub fn get_stream_status(state: State<'_, SharedAudioState>) -> Option<ReconciliationResult> {
    state.lock().unwrap().last_reconciliation.clone()
}
