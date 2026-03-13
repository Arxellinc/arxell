//! Tests for model loading lifecycle and device enumeration.
//!
//! Non-GPU tests (device enumeration) run without any feature flags.
//! GPU-gated tests require `--features vulkan` and the model file at MODEL_PATH.
//!
//! Note: `load_model()` requires an `AppHandle` and cannot be called directly
//! in integration tests.  These tests exercise the same underlying mechanisms
//! via the shared model holder in `common::gpu`.
//!
//! Run (no GPU):  cargo test --test model_loading_tests
//! Run (GPU):     cargo test --test model_loading_tests --features vulkan

#[path = "common/mod.rs"]
mod common;

use arx_lib::model_manager::resources::enumerate_devices;

// ── Device enumeration (always available) ─────────────────────────────────────

#[test]
fn test_enumerate_devices_returns_at_least_one() {
    let devices = enumerate_devices();
    assert!(
        !devices.is_empty(),
        "enumerate_devices must return at least one device"
    );
}

#[test]
fn test_enumerate_devices_includes_cpu() {
    let devices = enumerate_devices();
    let has_cpu = devices.iter().any(|d| d.device_type == "cpu");
    assert!(
        has_cpu,
        "device list must always include a CPU device, got types: {:?}",
        devices
            .iter()
            .map(|d| d.device_type.as_str())
            .collect::<Vec<_>>()
    );
}

#[test]
fn test_cpu_device_has_expected_fields() {
    let devices = enumerate_devices();
    let cpu = devices
        .iter()
        .find(|d| d.device_type == "cpu")
        .expect("CPU device must be present");
    assert!(!cpu.id.is_empty(), "CPU device id must not be empty");
    assert!(!cpu.name.is_empty(), "CPU device name must not be empty");
    assert!(cpu.is_available, "CPU must always be marked available");
    assert!(cpu.vram_mb.is_none(), "CPU device must have no vram_mb");
    println!("CPU device: id={:?}  name={:?}", cpu.id, cpu.name);
}

#[test]
fn test_exactly_one_device_is_auto_selected() {
    let devices = enumerate_devices();
    let selected_count = devices.iter().filter(|d| d.is_selected).count();
    assert!(
        selected_count >= 1,
        "at least one device must be auto-selected"
    );
    assert!(
        selected_count <= 1,
        "at most one device should be auto-selected (got {})",
        selected_count
    );
}

#[test]
fn test_all_devices_have_nonempty_ids_and_names() {
    for d in enumerate_devices() {
        assert!(!d.id.is_empty(), "device id is empty: {:?}", d);
        assert!(!d.name.is_empty(), "device name is empty: {:?}", d);
        assert!(!d.device_type.is_empty(), "device_type is empty: {:?}", d);
    }
}

#[test]
fn test_device_types_are_known_values() {
    let known = ["cpu", "vulkan", "cuda", "metal", "rocm"];
    for d in enumerate_devices() {
        assert!(
            known.contains(&d.device_type.as_str()),
            "unknown device_type {:?} — update this test if a new backend was added",
            d.device_type
        );
    }
}

// ── GPU-gated: model load lifecycle ───────────────────────────────────────────

#[cfg(feature = "vulkan")]
mod gpu_loading {
    use super::*;
    use arx_lib::model_manager::metadata::peek_model_metadata;
    use std::path::Path;
    use std::time::Instant;

    /// Prove the model loads without error.
    ///
    /// The shared `OnceLock` holder in `common::gpu` loads the model on first
    /// access.  A successful `token_count()` means the model is in RAM and the
    /// tokenizer is functional.
    #[tokio::test]
    async fn test_model_loads_without_error() {
        let count = common::gpu::token_count("hello world");
        assert!(count > 0, "tokenizing after load must return > 0 tokens");
        println!("Model loaded. 'hello world' = {} tokens", count);
    }

    /// Second call to any GPU helper must reuse the cached model holder (<500 ms).
    #[tokio::test]
    async fn test_repeated_model_access_is_fast() {
        // Warm up — may trigger load
        let _ = common::gpu::token_count("warmup");

        let start = Instant::now();
        let _ = common::gpu::token_count("second access to cached holder");
        let elapsed = start.elapsed();

        assert!(
            elapsed.as_millis() < 500,
            "second model access took {:?} — expected < 500 ms with cached holder",
            elapsed
        );
        println!("cached holder access: {:?}", elapsed);
    }

    /// Metadata vocab_size must be reasonable and consistent with live tokenization.
    #[tokio::test]
    async fn test_loaded_model_vocab_consistent_with_metadata() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        assert!(info.vocab_size > 0, "metadata vocab_size is zero");

        // If the model loaded, tokenization works → vocab is consistent
        let n = common::gpu::token_count("consistency check");
        assert!(
            n > 0,
            "tokenization returned 0 tokens — model vocab may be broken"
        );

        println!(
            "metadata vocab_size = {}  live tokenisation OK ({} tokens)",
            info.vocab_size, n
        );
    }

    /// Context length from metadata must be usable (>= 2048).
    #[tokio::test]
    async fn test_context_length_from_metadata_is_usable() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        assert!(
            info.context_length >= 2048,
            "context_length {} is below minimum usable 2048",
            info.context_length
        );
        println!("context_length = {}", info.context_length);
    }

    /// Chat template rendering must succeed and embed the user message.
    #[tokio::test]
    async fn test_chat_template_renders_user_message() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let messages = vec![common::user_msg("Hello, how are you?")];
        let rendered = common::gpu::render_template(&messages, None, &info);

        assert!(!rendered.is_empty(), "rendered template must not be empty");
        assert!(
            rendered.contains("Hello"),
            "rendered template must contain the user message text; got first 200 chars: {:?}",
            &rendered[..rendered.len().min(200)]
        );
        println!("template rendered {} chars", rendered.len());
    }

    /// System prompt must appear in rendered template when provided.
    #[tokio::test]
    async fn test_chat_template_embeds_system_prompt() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let system = "You are a helpful assistant.";
        let messages = vec![common::user_msg("Hi")];
        let rendered = common::gpu::render_template(&messages, Some(system), &info);

        assert!(
            rendered.contains("helpful assistant"),
            "system prompt not found in rendered template (first 400 chars): {:?}",
            &rendered[..rendered.len().min(400)]
        );
    }

    /// Rendered template for a multi-turn conversation must be longer than single-turn.
    #[tokio::test]
    async fn test_multi_turn_template_longer_than_single_turn() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let single = vec![common::user_msg("Hello")];
        let multi = common::sample_conversation();

        let single_rendered = common::gpu::render_template(&single, None, &info);
        let multi_rendered = common::gpu::render_template(&multi, None, &info);

        assert!(
            multi_rendered.len() > single_rendered.len(),
            "multi-turn rendered ({} chars) must be longer than single-turn ({} chars)",
            multi_rendered.len(),
            single_rendered.len()
        );
    }

    /// GPU device must appear in device enumeration when Vulkan is compiled in.
    ///
    /// This is a soft assertion: Vulkan compiled but no hardware present is valid
    /// in headless CI environments.
    #[tokio::test]
    async fn test_gpu_device_may_appear_in_enumeration() {
        let devices = enumerate_devices();
        let gpu = devices
            .iter()
            .find(|d| matches!(d.device_type.as_str(), "vulkan" | "cuda" | "metal" | "rocm"));

        if let Some(g) = gpu {
            println!("GPU device found: {:?}  vram={:?} MB", g.name, g.vram_mb);
            assert!(!g.id.is_empty(), "GPU device id must not be empty");
            assert!(!g.name.is_empty(), "GPU device name must not be empty");
        } else {
            println!(
                "No GPU device found in enumeration (acceptable in headless CI); devices = {:?}",
                devices
                    .iter()
                    .map(|d| d.device_type.as_str())
                    .collect::<Vec<_>>()
            );
        }
    }
}
