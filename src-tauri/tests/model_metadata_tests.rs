//! Tests for GGUF metadata inspection (peek_model_metadata).
//!
//! These tests use memory-mapped I/O and require no GPU backend.
//! They complete in < 5 seconds regardless of model file size.
//!
//! Run:  cargo test --test model_metadata_tests
//! Run with output: cargo test --test model_metadata_tests -- --nocapture

#[path = "common/mod.rs"]
mod common;

use std::path::Path;
use std::time::Instant;

use arx_lib::model_manager::metadata::peek_model_metadata;
use arx_lib::model_manager::types::{ModelError, ModelInfo};

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn peek(path: &str) -> Result<ModelInfo, ModelError> {
    peek_model_metadata(Path::new(path)).await
}

// ── File validation ───────────────────────────────────────────────────────────

#[tokio::test]
async fn test_model_file_exists() {
    assert!(
        Path::new(common::MODEL_PATH).exists(),
        "Model file not found at {}",
        common::MODEL_PATH
    );
}

#[tokio::test]
async fn test_model_file_is_nonzero() {
    let size = std::fs::metadata(common::MODEL_PATH)
        .expect("cannot stat model file")
        .len();
    assert!(
        size > 1_000_000_000,
        "Model file suspiciously small: {} bytes",
        size
    );
}

#[tokio::test]
async fn test_peek_missing_file_returns_file_not_found() {
    let result = peek("/nonexistent/path/model.gguf").await;
    assert!(
        matches!(result, Err(ModelError::FileNotFound(_))),
        "Expected FileNotFound, got {:?}",
        result
    );
}

#[tokio::test]
async fn test_peek_non_gguf_file_returns_error() {
    // Write a temp file with garbage content (not a GGUF)
    let tmp = tempfile_path();
    std::fs::write(&tmp, b"not a gguf file, just garbage bytes 1234567890").unwrap();
    let result = peek(&tmp).await;
    // Should be GgufError or UnsupportedFormat — anything but Ok
    assert!(
        result.is_err(),
        "Expected an error for non-GGUF data, got Ok({:?})",
        result.unwrap()
    );
    let _ = std::fs::remove_file(&tmp);
}

// ── Core metadata fields ──────────────────────────────────────────────────────

#[tokio::test]
async fn test_architecture_is_populated() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    assert!(
        !info.architecture.is_empty(),
        "architecture field must not be empty"
    );
    println!("architecture = {:?}", info.architecture);
}

#[tokio::test]
async fn test_architecture_is_known_string() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    // GLM-4.7-Flash uses deepseek2 in GGUF; accept all common architectures
    let known = [
        "chatglm", "glm4", "glm", "llama", "mistral", "gemma", "qwen", "deepseek",
    ];
    assert!(
        known
            .iter()
            .any(|k| info.architecture.to_lowercase().contains(k)),
        "Unexpected architecture {:?} — update this test if intentional",
        info.architecture
    );
}

#[tokio::test]
async fn test_context_length_is_reasonable() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    assert!(
        info.context_length >= 2048,
        "context_length {} is suspiciously small (< 2048)",
        info.context_length
    );
    assert!(
        info.context_length <= 1_048_576,
        "context_length {} is unrealistically large",
        info.context_length
    );
    println!("context_length = {}", info.context_length);
}

#[tokio::test]
async fn test_vocab_size_is_not_tensor_count() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    // Tensor count is typically 200–600 for a 4.7B model.
    // Vocabulary size is always > 30 000.
    assert!(
        info.vocab_size > 1000,
        "vocab_size {} looks like it was set to tensor_count (bug fixed earlier)",
        info.vocab_size
    );
    println!("vocab_size = {}", info.vocab_size);
}

#[tokio::test]
async fn test_vocab_size_is_in_realistic_range() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    // GLM-4 uses a large vocabulary (≈ 150 000 tokens)
    assert!(
        info.vocab_size >= 32_000,
        "vocab_size {} is too small for a modern LLM",
        info.vocab_size
    );
}

#[tokio::test]
async fn test_model_name_is_non_empty() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    assert!(!info.name.is_empty(), "name must not be empty");
    println!("model name = {:?}", info.name);
}

#[tokio::test]
async fn test_file_size_mb_is_accurate() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    let actual_mb = std::fs::metadata(common::MODEL_PATH).unwrap().len() / (1024 * 1024);
    let reported = info.file_size_mb.expect("file_size_mb must be Some");
    // Allow ±1 MB rounding
    assert!(
        reported.abs_diff(actual_mb) <= 1,
        "file_size_mb {} differs from actual {} MB",
        reported,
        actual_mb
    );
    println!("file_size_mb = {}", reported);
}

#[tokio::test]
async fn test_quantization_detected_as_q4_1() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    let quant = info.quantization.as_deref().unwrap_or("None");
    assert!(
        quant.to_uppercase().contains("Q4_1"),
        "Expected quantization to contain Q4_1, got {:?}",
        quant
    );
    println!("quantization = {:?}", quant);
}

// ── Token fields ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_bos_token_is_a_non_empty_string_or_none() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    if let Some(bos) = &info.bos_token {
        assert!(!bos.is_empty(), "bos_token must be non-empty when Some");
        // Must NOT be a Llama-3-specific hardcoded token (old bug)
        assert!(
            !bos.contains("<|begin_of_text|>") || info.architecture.to_lowercase() == "llama",
            "bos_token looks hardcoded — check metadata.rs fix"
        );
    }
    println!("bos_token = {:?}", info.bos_token);
}

#[tokio::test]
async fn test_eos_token_is_a_non_empty_string_or_none() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    if let Some(eos) = &info.eos_token {
        assert!(!eos.is_empty(), "eos_token must be non-empty when Some");
        assert!(
            !eos.contains("<|end_of_text|>") || info.architecture.to_lowercase() == "llama",
            "eos_token looks hardcoded — check metadata.rs fix"
        );
    }
    println!("eos_token = {:?}", info.eos_token);
}

#[tokio::test]
async fn test_bos_eos_tokens_differ() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    if let (Some(bos), Some(eos)) = (&info.bos_token, &info.eos_token) {
        assert_ne!(bos, eos, "BOS and EOS tokens should differ");
    }
}

// ── Chat template & roles ─────────────────────────────────────────────────────

#[tokio::test]
async fn test_supported_roles_includes_user_and_assistant() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    assert!(
        info.supported_roles.iter().any(|r| r == "user"),
        "supported_roles must include 'user', got {:?}",
        info.supported_roles
    );
    assert!(
        info.supported_roles.iter().any(|r| r == "assistant"),
        "supported_roles must include 'assistant', got {:?}",
        info.supported_roles
    );
}

#[tokio::test]
async fn test_chat_template_is_present_for_instruction_model() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    // GLM-4-Flash is an instruction-tuned model — should embed its template
    assert!(
        info.chat_template.is_some(),
        "Expected chat_template to be present in an instruct model"
    );
    println!(
        "chat_template length = {} chars",
        info.chat_template.as_deref().unwrap_or("").len()
    );
}

#[tokio::test]
async fn test_chat_template_contains_role_markers() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    if let Some(tmpl) = &info.chat_template {
        let lower = tmpl.to_lowercase();
        assert!(
            lower.contains("user") || lower.contains("human") || lower.contains("<|"),
            "chat_template looks malformed — no role markers found"
        );
    }
}

// ── Performance ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_metadata_peek_completes_in_under_10_seconds() {
    // Memory-mapped I/O means we only page in the header, not the full 18 GB.
    let start = Instant::now();
    let _ = peek(common::MODEL_PATH).await.expect("peek failed");
    let elapsed = start.elapsed();
    assert!(
        elapsed.as_secs() < 10,
        "peek took {:?}, expected < 10 seconds (check mmap implementation)",
        elapsed
    );
    println!("peek completed in {:?}", elapsed);
}

#[tokio::test]
async fn test_repeated_peeks_stay_fast() {
    // Second peek should be faster due to OS page cache
    let _ = peek(common::MODEL_PATH).await.expect("first peek failed");
    let start = Instant::now();
    let _ = peek(common::MODEL_PATH).await.expect("second peek failed");
    let elapsed = start.elapsed();
    assert!(
        elapsed.as_secs() < 5,
        "Second peek took {:?} — expected < 5 s with page cache warm",
        elapsed
    );
    println!("second peek completed in {:?}", elapsed);
}

// ── Parameter count ───────────────────────────────────────────────────────────

#[tokio::test]
async fn test_parameter_count_if_present() {
    let info = peek(common::MODEL_PATH).await.expect("peek failed");
    if let Some(params) = info.parameter_count {
        // GLM-4.7 should be roughly 4–10 billion parameters
        assert!(
            params > 1_000_000_000,
            "parameter_count {} is suspiciously small",
            params
        );
        println!("parameter_count = {:.1}B", params as f64 / 1e9);
    } else {
        println!("parameter_count not present in metadata (optional field)");
    }
}

// ── Helper ────────────────────────────────────────────────────────────────────

fn tempfile_path() -> String {
    format!("/tmp/arx_test_{}.bin", std::process::id())
}
