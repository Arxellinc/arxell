#![cfg(feature = "tauri-runtime")]

use crate::contracts::{
    FilesCreateDirectoryRequest, FilesDeletePathRequest, FilesListDirectoryRequest,
    FilesReadFileRequest, FilesWriteFileRequest,
};
use crate::ipc::tauri_bridge::TauriBridgeState;
use crate::tools::invoke::registry::{decode_payload, InvokeRegistry, ToolInvokeFuture};
use serde_json::Value;

pub fn register(registry: &mut InvokeRegistry) {
    registry.register(
        "files",
        &["list-directory", "listDirectory"],
        invoke_list_directory,
    );
    registry.register("files", &["read-file", "readFile"], invoke_read_file);
    registry.register("files", &["read-image"], invoke_read_image);
    registry.register("files", &["write-file", "writeFile"], invoke_write_file);
    registry.register(
        "files",
        &["create-directory", "createDirectory"],
        invoke_create_directory,
    );
    registry.register("files", &["delete-path", "deletePath"], invoke_delete_path);
}

fn invoke_list_directory(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    let files = state.files.clone();
    Box::pin(async move {
        let req: FilesListDirectoryRequest = decode_payload(payload)?;
        let result = files.list_directory(req.path.as_deref(), req.correlation_id)?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing files list-directory response: {e}"))
    })
}

fn invoke_read_file(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    let files = state.files.clone();
    Box::pin(async move {
        let req: FilesReadFileRequest = decode_payload(payload)?;
        let result = files.read_file(req.path.as_str(), req.correlation_id)?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing files read-file response: {e}"))
    })
}

fn invoke_read_image(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    let files = state.files.clone();
    Box::pin(async move {
        let req: FilesReadFileRequest = decode_payload(payload)?;
        let result = files.read_image(req.path.as_str(), req.correlation_id)?;
        serde_json::to_value(result)
            .map_err(|_| "failed serializing image preview response".to_string())
    })
}

fn invoke_write_file(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    let files = state.files.clone();
    Box::pin(async move {
        let req: FilesWriteFileRequest = decode_payload(payload)?;
        let result =
            files.write_file(req.path.as_str(), req.content.as_str(), req.correlation_id)?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing files write-file response: {e}"))
    })
}

fn invoke_delete_path(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    let files = state.files.clone();
    Box::pin(async move {
        let req: FilesDeletePathRequest = decode_payload(payload)?;
        let result = files.delete_path(
            req.path.as_str(),
            req.recursive.unwrap_or(false),
            req.correlation_id,
        )?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing files delete-path response: {e}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_preview_action_is_registered_and_requires_a_path() {
        let mut registry = InvokeRegistry::new();
        register(&mut registry);
        assert!(registry.get("files", "read-image").is_some());
        assert!(decode_payload::<FilesReadFileRequest>(
            serde_json::json!({"correlationId": "test"})
        )
        .is_err());
    }
}

fn invoke_create_directory(state: &TauriBridgeState, payload: Value) -> ToolInvokeFuture<'_> {
    let files = state.files.clone();
    Box::pin(async move {
        let req: FilesCreateDirectoryRequest = decode_payload(payload)?;
        let result = files.create_directory(
            req.path.as_str(),
            req.recursive.unwrap_or(true),
            req.correlation_id,
        )?;
        serde_json::to_value(result)
            .map_err(|e| format!("failed serializing files create-directory response: {e}"))
    })
}
