#![cfg(feature = "tauri-runtime")]

use crate::contracts::{FilesListDirectoryRequest, FilesReadFileRequest, FilesWriteFileRequest};
use crate::ipc::tauri_bridge::TauriBridgeState;
use crate::tools::invoke::registry::{decode_payload, InvokeRegistry, ToolInvokeFuture};
use serde_json::Value;

pub fn register(registry: &mut InvokeRegistry) {
    registry.register("files", &["list-directory", "listDirectory"], invoke_list_directory);
    registry.register("files", &["read-file", "readFile"], invoke_read_file);
    registry.register("files", &["write-file", "writeFile"], invoke_write_file);
}

fn invoke_list_directory(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let files = state.files.clone();
    Box::pin(async move {
        let req: FilesListDirectoryRequest = decode_payload(payload)?;
        let result = files.list_directory(req.path.as_deref(), req.correlation_id)?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing files list-directory response: {e}"))
    })
}

fn invoke_read_file(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let files = state.files.clone();
    Box::pin(async move {
        let req: FilesReadFileRequest = decode_payload(payload)?;
        let result = files.read_file(req.path.as_str(), req.correlation_id)?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing files read-file response: {e}"))
    })
}

fn invoke_write_file(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture {
    let files = state.files.clone();
    Box::pin(async move {
        let req: FilesWriteFileRequest = decode_payload(payload)?;
        let result = files.write_file(req.path.as_str(), req.content.as_str(), req.correlation_id)?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing files write-file response: {e}"))
    })
}
