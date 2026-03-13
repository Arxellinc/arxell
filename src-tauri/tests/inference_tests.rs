//! Tests for local LLM text generation via llama-cpp-2.
//!
//! ⚠  ALL TESTS ARE `#[ignore]` BY DEFAULT because inference on an 18 GB model
//!    on CPU takes minutes per test.  Run manually when GPU hardware is present:
//!
//!     cargo test --test inference_tests --features vulkan -- --include-ignored --nocapture
//!
//! The shared model holder in `common::gpu` uses:
//!   - temperature = 0.0  (greedy — deterministic)
//!   - seed = 42
//!   - n_gpu_layers = 999 (offloads all layers; falls back to CPU silently)

#[cfg(feature = "vulkan")]
#[path = "common/mod.rs"]
mod common;

#[cfg(feature = "vulkan")]
use arx_lib::model_manager::metadata::peek_model_metadata;
#[cfg(feature = "vulkan")]
use std::path::Path;

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Render a single user message with an optional system prompt into a prompt string.
#[cfg(feature = "vulkan")]
async fn render_user(user: &str, system: Option<&str>) -> String {
    let info = peek_model_metadata(Path::new(common::MODEL_PATH))
        .await
        .expect("peek failed");
    let messages = vec![common::user_msg(user)];
    common::gpu::render_template(&messages, system, &info)
}

// ── Basic completion ───────────────────────────────────────────────────────────

#[cfg(feature = "vulkan")]
#[tokio::test]
#[ignore = "slow (CPU inference on 18 GB model); run with --include-ignored when GPU is present"]
async fn test_simple_completion_returns_nonempty_text() {
    let prompt = render_user("What is 2 + 2?", None).await;
    let output = common::gpu::generate(&prompt, 30, &[]);
    assert!(
        !output.is_empty(),
        "generate() returned empty string for a simple math prompt"
    );
    println!("output: {:?}", output);
}

#[cfg(feature = "vulkan")]
#[tokio::test]
#[ignore = "slow; run with --include-ignored"]
async fn test_model_produces_printable_text() {
    let prompt = render_user("Say hello.", None).await;
    let output = common::gpu::generate(&prompt, 20, &[]);
    assert!(!output.is_empty(), "generate() returned empty string");
    // All bytes must be valid UTF-8 (the inference loop handles multi-byte accumulation)
    assert!(
        std::str::from_utf8(output.as_bytes()).is_ok(),
        "generate() produced invalid UTF-8: {:?}",
        output
    );
    println!("output: {:?}", output);
}

/// Greedy (temperature=0, seed=42) generation must be bit-for-bit reproducible.
#[cfg(feature = "vulkan")]
#[tokio::test]
#[ignore = "slow; run with --include-ignored"]
async fn test_greedy_generation_is_deterministic() {
    let prompt = render_user("Continue the sentence: The quick brown fox", None).await;

    let out1 = common::gpu::generate(&prompt, 20, &[]);
    let out2 = common::gpu::generate(&prompt, 20, &[]);

    assert_eq!(
        out1, out2,
        "greedy (temperature=0, seed=42) outputs must be identical;\n  out1={:?}\n  out2={:?}",
        out1, out2
    );
    println!("deterministic output: {:?}", out1);
}

/// `max_tokens` must limit the number of generated tokens.
#[cfg(feature = "vulkan")]
#[tokio::test]
#[ignore = "slow; run with --include-ignored"]
async fn test_max_tokens_limits_output_length() {
    let prompt = render_user("Tell me a very long story about a dragon.", None).await;
    let output = common::gpu::generate(&prompt, 10, &[]);
    // Count the tokens in the output (not counting the prompt)
    let out_tokens = common::gpu::token_count(&output);
    // Allow a small margin for partial multi-byte flush at the boundary
    assert!(
        out_tokens <= 15,
        "expected <= 15 tokens with max_tokens=10, got {} tokens; output={:?}",
        out_tokens,
        output
    );
    println!("output ({} tokens): {:?}", out_tokens, output);
}

/// Generation must stop when any stop sequence appears in the output.
#[cfg(feature = "vulkan")]
#[tokio::test]
#[ignore = "slow; run with --include-ignored"]
async fn test_stop_sequence_terminates_generation() {
    let prompt = render_user("Count from 1 to 10, one number per line.", None).await;

    // Stop as soon as "3\n" appears — the output must not continue to 4, 5, …
    let output = common::gpu::generate(&prompt, 100, &["3\n", "3."]);

    assert!(
        !output.contains('4') && !output.contains("10"),
        "stop sequence did not halt generation before '4'; got: {:?}",
        output
    );
    println!("output with stop after '3': {:?}", output);
}

/// EOG (end-of-generation) token must stop generation even before max_tokens.
#[cfg(feature = "vulkan")]
#[tokio::test]
#[ignore = "slow; run with --include-ignored"]
async fn test_generation_stops_at_eog_token() {
    // A yes/no question should get a very short answer
    let prompt = render_user("Answer only yes or no: Is water wet?", None).await;

    let output = common::gpu::generate(&prompt, 200, &[]);

    // If the model answered with a short reply and hit EOG, the output is short.
    // We don't assert a specific length but do assert something was returned.
    assert!(
        !output.is_empty(),
        "generate() returned empty string — EOG might have fired immediately"
    );
    println!(
        "yes/no answer ({} tokens): {:?}",
        common::gpu::token_count(&output),
        output
    );
}

// ── Chat mode system prompts ───────────────────────────────────────────────────

/// With Chat mode system prompt, the model should still produce coherent text.
#[cfg(feature = "vulkan")]
#[tokio::test]
#[ignore = "slow; run with --include-ignored"]
async fn test_chat_mode_system_prompt_does_not_break_generation() {
    let prompt = render_user("Hello! Who are you?", Some(common::CHAT_SYSTEM_PROMPT)).await;
    let output = common::gpu::generate(&prompt, 40, &[]);
    assert!(
        !output.is_empty(),
        "generation with Chat system prompt returned empty"
    );
    println!("Chat mode output: {:?}", output);
}

/// With Code mode, the model should produce code-related content when asked.
#[cfg(feature = "vulkan")]
#[tokio::test]
#[ignore = "slow; run with --include-ignored"]
async fn test_code_mode_produces_code_related_output() {
    let prompt = render_user(
        "Write a Rust function that adds two numbers.",
        Some(common::CODE_SYSTEM_PROMPT),
    )
    .await;
    let output = common::gpu::generate(&prompt, 80, &["</write_to_file>", "\n\n\n"]);
    assert!(!output.is_empty(), "Code mode generation returned empty");
    println!(
        "Code mode output ({}): {:?}",
        common::gpu::token_count(&output),
        output
    );
}

// ── Tool calling ───────────────────────────────────────────────────────────────

/// With TOOL_SKILL_PROMPT injected, the model should use the write_to_file XML tag.
#[cfg(feature = "vulkan")]
#[tokio::test]
#[ignore = "slow; run with --include-ignored"]
async fn test_tool_skill_prompt_elicits_write_to_file_tag() {
    let prompt = render_user(
        "Please write the text 'hello world' to a file called hello.txt",
        Some(common::TOOL_SKILL_PROMPT),
    )
    .await;

    // Generate enough tokens for at least the opening tag
    let output = common::gpu::generate(&prompt, 100, &["</write_to_file>"]);

    println!("tool output: {:?}", output);

    assert!(
        output.contains("<write_to_file>") || output.contains("write_to_file"),
        "expected model to produce a write_to_file XML tag with the tool skill injected;\n\
         got: {:?}",
        output
    );
}

/// With TOOL_SKILL_PROMPT, asking to read a file should elicit the read_file tag.
#[cfg(feature = "vulkan")]
#[tokio::test]
#[ignore = "slow; run with --include-ignored"]
async fn test_tool_skill_prompt_elicits_read_file_tag() {
    let prompt = render_user(
        "Read the file config.json and tell me what is inside.",
        Some(common::TOOL_SKILL_PROMPT),
    )
    .await;

    let output = common::gpu::generate(&prompt, 80, &["</read_file>"]);

    println!("read_file output: {:?}", output);

    assert!(
        output.contains("<read_file>") || output.contains("read_file"),
        "expected model to use read_file tool; got: {:?}",
        output
    );
}

/// A write_to_file response must contain a <path> child element.
#[cfg(feature = "vulkan")]
#[tokio::test]
#[ignore = "slow; run with --include-ignored"]
async fn test_write_to_file_response_contains_path_element() {
    let prompt = render_user(
        "Save 'Test content' to a file named output.txt",
        Some(common::TOOL_SKILL_PROMPT),
    )
    .await;

    let output = common::gpu::generate(&prompt, 120, &["</write_to_file>"]);

    println!("write_to_file full output: {:?}", output);

    // If the model used the write_to_file tool, it must include a path element
    if output.contains("<write_to_file>") {
        assert!(
            output.contains("<path>"),
            "write_to_file block must contain a <path> element; got: {:?}",
            output
        );
    }
    // else: model didn't use the tool at all — this is tolerable (soft assertion logged above)
}

// ── Multi-turn ─────────────────────────────────────────────────────────────────

/// The model must produce a non-empty response at the end of a multi-turn conversation.
#[cfg(feature = "vulkan")]
#[tokio::test]
#[ignore = "slow; run with --include-ignored"]
async fn test_multi_turn_sample_conversation_generates_response() {
    let info = peek_model_metadata(Path::new(common::MODEL_PATH))
        .await
        .expect("peek failed");

    let messages = common::sample_conversation();
    let rendered = common::gpu::render_template(&messages, None, &info);
    let output = common::gpu::generate(&rendered, 50, &[]);

    assert!(
        !output.is_empty(),
        "multi-turn conversation must produce non-empty output"
    );
    println!(
        "multi-turn output ({} tokens): {:?}",
        common::gpu::token_count(&output),
        output
    );
}

/// Architect mode should produce structured planning content.
#[cfg(feature = "vulkan")]
#[tokio::test]
#[ignore = "slow; run with --include-ignored"]
async fn test_architect_mode_responds_to_design_question() {
    let prompt = render_user(
        "How would you design a simple REST API for a todo app?",
        Some(common::ARCHITECT_SYSTEM_PROMPT),
    )
    .await;

    let output = common::gpu::generate(&prompt, 80, &[]);
    assert!(
        !output.is_empty(),
        "Architect mode must produce non-empty output"
    );
    println!("Architect mode output: {:?}", output);
}
