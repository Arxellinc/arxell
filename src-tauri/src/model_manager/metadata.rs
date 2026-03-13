//! GGUF model metadata inspection
//!
//! This module provides lightweight GGUF file header reading without loading model weights.
//! It uses streaming file reads and bounded parsing to avoid large allocations
//! from giant metadata arrays.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use super::types::{ModelError, ModelInfo};

/// Read GGUF file metadata without loading model weights.
///
/// Uses bounded streaming I/O against GGUF metadata entries (no weight loading).
/// Blocking I/O is run on a dedicated thread pool thread via `spawn_blocking`
/// so the async executor is not stalled.
///
/// # Errors
/// - `ModelError::FileNotFound` — path does not exist
/// - `ModelError::UnsupportedFormat` — file is not a valid GGUF
/// - `ModelError::GgufError` — GGUF parsing error
pub async fn peek_model_metadata(path: &Path) -> Result<ModelInfo, ModelError> {
    if !path.exists() {
        return Err(ModelError::FileNotFound(path.display().to_string()));
    }

    let path_buf = path.to_path_buf();

    tokio::task::spawn_blocking(move || peek_metadata_sync(&path_buf))
        .await
        .map_err(|e| ModelError::IoError(format!("Blocking task error: {}", e)))?
}

/// Synchronous implementation — called from spawn_blocking.
fn peek_metadata_sync(path: &Path) -> Result<ModelInfo, ModelError> {
    // File size for display
    let file_metadata = std::fs::metadata(path)?;
    let file_size_mb = Some(file_metadata.len() / (1024 * 1024));

    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let metadata = parse_gguf_metadata_scalars(&mut reader)?;

    // ── architecture ─────────────────────────────────────────────────────────

    let architecture = metadata
        .strings
        .get("general.architecture")
        .cloned()
        .unwrap_or_else(|| "unknown".to_string());

    // ── context length ───────────────────────────────────────────────────────

    let context_length = metadata
        .u64s
        .get(&format!("{}.context_length", architecture))
        .copied()
        .or_else(|| metadata.u64s.get("general.context_length").copied())
        .unwrap_or(4096) as u32;

    // ── vocab size ───────────────────────────────────────────────────────────
    // Do NOT fall back to tensor_count — that's the number of weight tensors
    // (e.g. 300–500), not the vocabulary size (e.g. 32 000–128 000).

    let vocab_size = metadata
        .u64s
        .get(&format!("{}.vocab_size", architecture))
        .copied()
        .or_else(|| metadata.u64s.get("tokenizer.vocab_size").copied())
        .unwrap_or(0) as u32;

    // ── model name ───────────────────────────────────────────────────────────

    let name = metadata
        .strings
        .get("general.name")
        .cloned()
        .or_else(|| metadata.strings.get("general.basename").cloned())
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string()
        });

    // ── chat template ────────────────────────────────────────────────────────

    let chat_template = metadata.strings.get("tokenizer.chat_template").cloned();

    // ── BOS / EOS tokens ─────────────────────────────────────────────────────
    // Use direct string keys when present. We intentionally do not resolve IDs
    // through tokenizer.ggml.tokens to avoid parsing large tokenizer arrays.
    let bos_token = metadata
        .strings
        .get("tokenizer.ggml.bos_token")
        .cloned()
        .or_else(|| metadata.strings.get("tokenizer.bos_token").cloned());
    let eos_token = metadata
        .strings
        .get("tokenizer.ggml.eos_token")
        .cloned()
        .or_else(|| metadata.strings.get("tokenizer.eos_token").cloned());

    // ── supported roles ──────────────────────────────────────────────────────

    let supported_roles = infer_roles_from_template(&chat_template);

    // ── quantization ─────────────────────────────────────────────────────────

    let quantization = detect_quantization(path);

    // ── parameter count ──────────────────────────────────────────────────────

    let parameter_count = metadata.u64s.get("general.parameter_count").copied();

    // ── thinking / reasoning mode support ────────────────────────────────────
    // Detected from model name and chat template content.
    // GLM-4 family models expose an `enable_thinking` Jinja2 variable in their
    // chat template that gates the reasoning block.

    let supports_thinking = detect_thinking_support(&name, &chat_template);

    Ok(ModelInfo {
        name,
        architecture,
        context_length,
        vocab_size,
        chat_template,
        bos_token,
        eos_token,
        supported_roles,
        quantization,
        parameter_count,
        file_size_mb,
        supports_thinking,
    })
}

#[derive(Default)]
struct ParsedMetadata {
    strings: HashMap<String, String>,
    u64s: HashMap<String, u64>,
}

const GGUF_VALUE_TYPE_UINT8: u32 = 0;
const GGUF_VALUE_TYPE_INT8: u32 = 1;
const GGUF_VALUE_TYPE_UINT16: u32 = 2;
const GGUF_VALUE_TYPE_INT16: u32 = 3;
const GGUF_VALUE_TYPE_UINT32: u32 = 4;
const GGUF_VALUE_TYPE_INT32: u32 = 5;
const GGUF_VALUE_TYPE_FLOAT32: u32 = 6;
const GGUF_VALUE_TYPE_BOOL: u32 = 7;
const GGUF_VALUE_TYPE_STRING: u32 = 8;
const GGUF_VALUE_TYPE_ARRAY: u32 = 9;
const GGUF_VALUE_TYPE_UINT64: u32 = 10;
const GGUF_VALUE_TYPE_INT64: u32 = 11;
const GGUF_VALUE_TYPE_FLOAT64: u32 = 12;

fn parse_gguf_metadata_scalars<R: Read + Seek>(r: &mut R) -> Result<ParsedMetadata, ModelError> {
    let mut magic = [0u8; 4];
    r.read_exact(&mut magic)?;
    if &magic != b"GGUF" {
        return Err(ModelError::UnsupportedFormat(
            "Not a GGUF file (missing GGUF magic)".to_string(),
        ));
    }

    let _version = read_u32(r)?;
    let _tensor_count = read_u64(r)?;
    let metadata_count = read_u64(r)?;
    let mut out = ParsedMetadata::default();

    for _ in 0..metadata_count {
        let key = read_gguf_string(r)?;
        let value_type = read_u32(r)?;

        if should_capture_metadata_key(&key) {
            match value_type {
                GGUF_VALUE_TYPE_STRING => {
                    let value = read_gguf_string(r)?;
                    out.strings.insert(key, value);
                }
                _ if is_numeric_type(value_type) => {
                    if let Some(v) = read_numeric_as_u64(r, value_type)? {
                        out.u64s.insert(key, v);
                    }
                }
                _ => {
                    skip_value_by_type(r, value_type)?;
                }
            }
        } else {
            skip_value_by_type(r, value_type)?;
        }
    }

    Ok(out)
}

fn should_capture_metadata_key(key: &str) -> bool {
    matches!(
        key,
        "general.architecture"
            | "general.context_length"
            | "tokenizer.vocab_size"
            | "general.name"
            | "general.basename"
            | "tokenizer.chat_template"
            | "general.parameter_count"
            | "tokenizer.ggml.bos_token"
            | "tokenizer.bos_token"
            | "tokenizer.ggml.eos_token"
            | "tokenizer.eos_token"
            | "tokenizer.ggml.bos_token_id"
            | "tokenizer.bos_token_id"
            | "tokenizer.ggml.eos_token_id"
            | "tokenizer.eos_token_id"
    ) || key.ends_with(".context_length")
        || key.ends_with(".vocab_size")
}

fn is_numeric_type(value_type: u32) -> bool {
    matches!(
        value_type,
        GGUF_VALUE_TYPE_UINT8
            | GGUF_VALUE_TYPE_INT8
            | GGUF_VALUE_TYPE_UINT16
            | GGUF_VALUE_TYPE_INT16
            | GGUF_VALUE_TYPE_UINT32
            | GGUF_VALUE_TYPE_INT32
            | GGUF_VALUE_TYPE_UINT64
            | GGUF_VALUE_TYPE_INT64
    )
}

fn read_numeric_as_u64<R: Read>(r: &mut R, value_type: u32) -> Result<Option<u64>, ModelError> {
    let val = match value_type {
        GGUF_VALUE_TYPE_UINT8 => Some(read_u8(r)? as u64),
        GGUF_VALUE_TYPE_INT8 => {
            let v = read_i8(r)?;
            if v >= 0 {
                Some(v as u64)
            } else {
                None
            }
        }
        GGUF_VALUE_TYPE_UINT16 => Some(read_u16(r)? as u64),
        GGUF_VALUE_TYPE_INT16 => {
            let v = read_i16(r)?;
            if v >= 0 {
                Some(v as u64)
            } else {
                None
            }
        }
        GGUF_VALUE_TYPE_UINT32 => Some(read_u32(r)? as u64),
        GGUF_VALUE_TYPE_INT32 => {
            let v = read_i32(r)?;
            if v >= 0 {
                Some(v as u64)
            } else {
                None
            }
        }
        GGUF_VALUE_TYPE_UINT64 => Some(read_u64(r)?),
        GGUF_VALUE_TYPE_INT64 => {
            let v = read_i64(r)?;
            if v >= 0 {
                Some(v as u64)
            } else {
                None
            }
        }
        other => {
            return Err(ModelError::GgufError(format!(
                "Unexpected numeric metadata type: {}",
                other
            )));
        }
    };
    Ok(val)
}

fn skip_value_by_type<R: Read + Seek>(r: &mut R, value_type: u32) -> Result<(), ModelError> {
    match value_type {
        GGUF_VALUE_TYPE_UINT8 | GGUF_VALUE_TYPE_INT8 | GGUF_VALUE_TYPE_BOOL => skip_bytes(r, 1),
        GGUF_VALUE_TYPE_UINT16 | GGUF_VALUE_TYPE_INT16 => skip_bytes(r, 2),
        GGUF_VALUE_TYPE_UINT32 | GGUF_VALUE_TYPE_INT32 | GGUF_VALUE_TYPE_FLOAT32 => {
            skip_bytes(r, 4)
        }
        GGUF_VALUE_TYPE_UINT64 | GGUF_VALUE_TYPE_INT64 | GGUF_VALUE_TYPE_FLOAT64 => {
            skip_bytes(r, 8)
        }
        GGUF_VALUE_TYPE_STRING => {
            let len = read_u64(r)?;
            skip_bytes(r, len)
        }
        GGUF_VALUE_TYPE_ARRAY => {
            let elem_type = read_u32(r)?;
            let len = read_u64(r)?;
            skip_array_values(r, elem_type, len)
        }
        other => Err(ModelError::GgufError(format!(
            "Invalid GGUF metadata value type {}",
            other
        ))),
    }
}

fn skip_array_values<R: Read + Seek>(
    r: &mut R,
    elem_type: u32,
    len: u64,
) -> Result<(), ModelError> {
    match elem_type {
        GGUF_VALUE_TYPE_UINT8 | GGUF_VALUE_TYPE_INT8 | GGUF_VALUE_TYPE_BOOL => skip_bytes(r, len),
        GGUF_VALUE_TYPE_UINT16 | GGUF_VALUE_TYPE_INT16 => skip_bytes(r, len.saturating_mul(2)),
        GGUF_VALUE_TYPE_UINT32 | GGUF_VALUE_TYPE_INT32 | GGUF_VALUE_TYPE_FLOAT32 => {
            skip_bytes(r, len.saturating_mul(4))
        }
        GGUF_VALUE_TYPE_UINT64 | GGUF_VALUE_TYPE_INT64 | GGUF_VALUE_TYPE_FLOAT64 => {
            skip_bytes(r, len.saturating_mul(8))
        }
        GGUF_VALUE_TYPE_STRING => {
            for _ in 0..len {
                let item_len = read_u64(r)?;
                skip_bytes(r, item_len)?;
            }
            Ok(())
        }
        GGUF_VALUE_TYPE_ARRAY => {
            // Nested arrays encode each child as a full GGUF value, so recurse.
            for _ in 0..len {
                let nested_type = read_u32(r)?;
                skip_value_by_type(r, nested_type)?;
            }
            Ok(())
        }
        other => Err(ModelError::GgufError(format!(
            "Invalid GGUF array element type {}",
            other
        ))),
    }
}

fn skip_bytes<R: Seek>(r: &mut R, mut n: u64) -> Result<(), ModelError> {
    while n > 0 {
        let step = n.min(i64::MAX as u64);
        r.seek(SeekFrom::Current(step as i64))?;
        n -= step;
    }
    Ok(())
}

fn read_u8<R: Read>(r: &mut R) -> Result<u8, ModelError> {
    let mut b = [0u8; 1];
    r.read_exact(&mut b)?;
    Ok(b[0])
}

fn read_i8<R: Read>(r: &mut R) -> Result<i8, ModelError> {
    Ok(read_u8(r)? as i8)
}

fn read_u16<R: Read>(r: &mut R) -> Result<u16, ModelError> {
    let mut b = [0u8; 2];
    r.read_exact(&mut b)?;
    Ok(u16::from_le_bytes(b))
}

fn read_i16<R: Read>(r: &mut R) -> Result<i16, ModelError> {
    let mut b = [0u8; 2];
    r.read_exact(&mut b)?;
    Ok(i16::from_le_bytes(b))
}

fn read_u32<R: Read>(r: &mut R) -> Result<u32, ModelError> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}

fn read_i32<R: Read>(r: &mut R) -> Result<i32, ModelError> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b)?;
    Ok(i32::from_le_bytes(b))
}

fn read_u64<R: Read>(r: &mut R) -> Result<u64, ModelError> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b)?;
    Ok(u64::from_le_bytes(b))
}

fn read_i64<R: Read>(r: &mut R) -> Result<i64, ModelError> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b)?;
    Ok(i64::from_le_bytes(b))
}

fn read_gguf_string<R: Read + Seek>(r: &mut R) -> Result<String, ModelError> {
    let len = read_u64(r)?;
    if len > (32 * 1024 * 1024) {
        return Err(ModelError::GgufError(format!(
            "GGUF string length too large: {}",
            len
        )));
    }
    let mut buf = vec![0u8; len as usize];
    r.read_exact(&mut buf)?;
    String::from_utf8(buf)
        .map_err(|e| ModelError::GgufError(format!("Invalid UTF-8 in GGUF string: {}", e)))
}

/// Infer supported roles from a model's chat template.
fn infer_roles_from_template(template: &Option<String>) -> Vec<String> {
    match template {
        Some(t) => {
            let mut roles = Vec::new();
            let lower = t.to_lowercase();
            if lower.contains("system") {
                roles.push("system".to_string());
            }
            if lower.contains("user") {
                roles.push("user".to_string());
            }
            if lower.contains("assistant") {
                roles.push("assistant".to_string());
            }

            if roles.is_empty() {
                vec![
                    "system".to_string(),
                    "user".to_string(),
                    "assistant".to_string(),
                ]
            } else {
                roles
            }
        }
        None => vec![
            "system".to_string(),
            "user".to_string(),
            "assistant".to_string(),
        ],
    }
}

/// Detect whether a model supports thinking/reasoning mode.
///
/// Returns true when either condition holds:
///
/// 1. **Template-level**: the chat template contains an active Jinja2
///    conditional on `enable_thinking` (`if enable_thinking` / `enable_thinking ==`).
///    In this case `render_chat_template` can suppress the reasoning block by
///    prepending `{%- set enable_thinking = false -%}` to the template.
///
/// 2. **Generation-level**: the model name matches a well-known thinking-capable
///    family (GLM-4, QwQ, Qwen3-thinking, …).  The model emits `<think>` as its
///    first generated token; the template rendering is unaffected by the flag,
///    but callers can still suppress thinking via sampler tricks or system-prompt
///    instructions.
///
/// The `template_level_thinking_control` helper (below) tests condition 1 alone
/// when you need to know whether template-level override will work.
pub fn detect_thinking_support(name: &str, chat_template: &Option<String>) -> bool {
    if template_level_thinking_control(chat_template) {
        return true;
    }

    let name_lower = name.to_lowercase();
    name_lower.starts_with("glm")
        || name_lower.starts_with("qwq")
        || name_lower.starts_with("qwen3")
        || name_lower.contains("thinking")
}

/// Returns true when the chat template has an **active** Jinja2 conditional on
/// `enable_thinking` — meaning a `{%- set enable_thinking = false -%}` prepend
/// will suppress the reasoning block at template-render time.
///
/// A bare occurrence of the string "enable_thinking" in a comment does NOT count.
pub fn template_level_thinking_control(chat_template: &Option<String>) -> bool {
    match chat_template {
        Some(tmpl) => {
            tmpl.contains("if enable_thinking")
                || tmpl.contains("enable_thinking ==")
                || tmpl.contains("enable_thinking!=")
                || tmpl.contains("enable_thinking !=")
        }
        None => false,
    }
}

/// Detect quantization level from the filename.
fn detect_quantization(path: &Path) -> Option<String> {
    let filename = path.file_name()?.to_str()?;
    let upper = filename.to_uppercase();

    // Ordered longest-first so "Q4_K_M" matches before "Q4_K"
    let patterns = [
        "IQ4_XS", "IQ4_NL", "IQ3_M", "IQ3_S", "IQ2_XXS", "Q4_K_M", "Q4_K_S", "Q4_K_L", "Q5_K_M",
        "Q5_K_S", "Q6_K_M", "Q6_K", "Q2_K_S", "Q2_K", "Q3_K_M", "Q3_K_S", "Q3_K", "Q4_0", "Q4_1",
        "Q4_2", "Q4_3", "Q5_0", "Q5_1", "Q8_0", "Q8_1", "BF16", "F16", "F32",
    ];

    for pattern in patterns {
        if upper.contains(pattern) {
            return Some(pattern.to_string());
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_file_not_found() {
        let result = peek_model_metadata(Path::new("/nonexistent/model.gguf")).await;
        assert!(matches!(result, Err(ModelError::FileNotFound(_))));
    }
}
