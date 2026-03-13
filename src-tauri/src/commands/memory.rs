use tauri::State;

use crate::memory::{self, MemoryEntry};
use crate::AppState;

#[tauri::command]
pub fn cmd_memory_upsert(
    state: State<'_, AppState>,
    namespace: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    memory::upsert(&db, &namespace, &key, &value).map_err(|e| e.to_string())?;
    memory::write_file(&db, &namespace, &state.memory_dir).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cmd_memory_list(
    state: State<'_, AppState>,
    namespace: String,
) -> Result<Vec<MemoryEntry>, String> {
    let db = state.db.lock().unwrap();
    memory::list(&db, &namespace).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cmd_memory_delete(
    state: State<'_, AppState>,
    namespace: String,
    key: String,
) -> Result<bool, String> {
    let db = state.db.lock().unwrap();
    let deleted = memory::delete(&db, &namespace, &key).map_err(|e| e.to_string())?;
    if deleted {
        memory::write_file(&db, &namespace, &state.memory_dir).map_err(|e| e.to_string())?;
    }
    Ok(deleted)
}

#[tauri::command]
pub fn cmd_memory_get_dir(state: State<'_, AppState>) -> String {
    state.memory_dir.to_string_lossy().to_string()
}
