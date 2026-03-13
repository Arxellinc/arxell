//! Tests for token counting, context budget math, and near/over-limit detection.
//!
//! Pure arithmetic tests (`test_context_budget_*`, `test_fits_*`, `test_near_*`,
//! `test_exceeds_*`) run without any feature flag and complete in milliseconds.
//!
//! GPU-gated tests in `gpu_counting` require `--features vulkan` and MODEL_PATH.
//!
//! Run pure tests:  cargo test --test context_management_tests
//! Run GPU tests:   cargo test --test context_management_tests --features vulkan

#[path = "common/mod.rs"]
mod common;

use arx_lib::model_manager::tokenizer::{check_fits_in_context, get_context_budget};
use arx_lib::model_manager::types::ContextFitResult;

// ── Pure math: get_context_budget ────────────────────────────────────────────

#[test]
fn test_context_budget_10pct_margin() {
    // 32768 * 0.90 = 29491.2 → truncated to 29491
    let budget = get_context_budget(32768, 0.10);
    assert_eq!(budget, 29491);
}

#[test]
fn test_context_budget_20pct_margin() {
    // 4096 * 0.80 = 3276.8 → truncated to 3276
    let budget = get_context_budget(4096, 0.20);
    assert_eq!(budget, 3276);
}

#[test]
fn test_context_budget_zero_margin_equals_full_length() {
    let budget = get_context_budget(8192, 0.0);
    assert_eq!(budget, 8192);
}

#[test]
fn test_context_budget_full_margin_is_zero() {
    let budget = get_context_budget(8192, 1.0);
    assert_eq!(budget, 0);
}

#[test]
fn test_context_budget_is_always_less_than_or_equal_to_context_length() {
    for ctx in [512_u32, 2048, 4096, 8192, 32768, 131072] {
        for pct in [0.0_f32, 0.05, 0.10, 0.15, 0.20] {
            let budget = get_context_budget(ctx, pct);
            assert!(
                budget <= ctx,
                "budget {} must not exceed context_length {} (margin={})",
                budget,
                ctx,
                pct
            );
        }
    }
}

// ── Pure math: check_fits_in_context ─────────────────────────────────────────

#[test]
fn test_fits_when_usage_is_under_80pct() {
    // 1000 / 8192 ≈ 12.2% — well under 80% → Fits
    // budget = floor(8192 * 0.9) = 7372; remaining = 7372 - 1000 = 6372
    let result = check_fits_in_context(1000, 8192);
    assert!(
        matches!(result, ContextFitResult::Fits { remaining: 6372 }),
        "expected Fits {{ remaining: 6372 }}, got {:?}",
        result
    );
}

#[test]
fn test_near_limit_when_usage_is_above_80pct() {
    // 7000 / 8192 ≈ 85.4% → NearLimit
    let result = check_fits_in_context(7000, 8192);
    assert!(
        matches!(result, ContextFitResult::NearLimit { .. }),
        "expected NearLimit at ~85%, got {:?}",
        result
    );
    if let ContextFitResult::NearLimit {
        remaining,
        percentage_used,
    } = result
    {
        assert_eq!(remaining, 8192 - 7000, "remaining = context - total");
        assert!(
            percentage_used > 84.0 && percentage_used < 86.0,
            "percentage_used out of range: {}",
            percentage_used
        );
    }
}

#[test]
fn test_near_limit_at_80pct_boundary() {
    // 6554 / 8192 = 80.01% → NearLimit (threshold is >= 80.0)
    let result = check_fits_in_context(6554, 8192);
    assert!(
        matches!(result, ContextFitResult::NearLimit { .. }),
        "expected NearLimit just above 80%, got {:?}",
        result
    );
}

#[test]
fn test_fits_just_below_80pct() {
    // 6553 / 8192 = 79.99% → Fits (below threshold)
    let result = check_fits_in_context(6553, 8192);
    assert!(
        matches!(result, ContextFitResult::Fits { .. }),
        "expected Fits just below 80%, got {:?}",
        result
    );
}

#[test]
fn test_exceeds_at_exactly_context_length() {
    // total == context_length → Exceeds with overflow_by = 0
    let result = check_fits_in_context(8192, 8192);
    assert!(
        matches!(result, ContextFitResult::Exceeds { overflow_by: 0 }),
        "expected Exceeds {{ overflow_by: 0 }} at 100%, got {:?}",
        result
    );
}

#[test]
fn test_exceeds_beyond_context_length() {
    // 9000 - 8192 = 808 overflow
    let result = check_fits_in_context(9000, 8192);
    assert!(
        matches!(result, ContextFitResult::Exceeds { overflow_by: 808 }),
        "expected Exceeds {{ overflow_by: 808 }}, got {:?}",
        result
    );
}

#[test]
fn test_near_limit_remaining_is_context_minus_total() {
    // At 97.6% usage: NearLimit with remaining = context - total (not budget - total)
    let result = check_fits_in_context(8000, 8192);
    assert!(
        matches!(result, ContextFitResult::NearLimit { remaining: 192, .. }),
        "expected NearLimit {{ remaining: 192 }}, got {:?}",
        result
    );
}

#[test]
fn test_fits_remaining_is_budget_minus_total() {
    // At 12.2%: Fits with remaining = budget - total = 7372 - 1000 = 6372
    // budget = floor(8192 * 0.9) = 7372
    let result = check_fits_in_context(1000, 8192);
    assert!(
        matches!(result, ContextFitResult::Fits { remaining: 6372 }),
        "expected Fits {{ remaining: 6372 }}, got {:?}",
        result
    );
}

#[test]
fn test_zero_tokens_fits_in_any_context() {
    for ctx in [512_u32, 4096, 131072] {
        let result = check_fits_in_context(0, ctx);
        assert!(
            matches!(result, ContextFitResult::Fits { .. }),
            "0 tokens must always Fit in context {}",
            ctx
        );
    }
}

// ── GPU-gated: real token counting ────────────────────────────────────────────

#[cfg(feature = "vulkan")]
mod gpu_counting {
    use super::*;
    use arx_lib::model_manager::metadata::peek_model_metadata;
    use std::path::Path;

    #[tokio::test]
    async fn test_token_count_single_word_is_positive() {
        let n = common::gpu::token_count("hello");
        assert!(n > 0, "tokenizing 'hello' returned 0 tokens");
        println!("'hello' = {} tokens", n);
    }

    #[tokio::test]
    async fn test_token_count_scales_with_text_length() {
        let short = common::gpu::token_count("Hi");
        let long = common::gpu::token_count(
            "This is a much longer sentence with many more words and tokens than the short one.",
        );
        assert!(
            long > short,
            "longer text ({} tokens) must tokenize to more than short text ({} tokens)",
            long,
            short
        );
    }

    #[tokio::test]
    async fn test_empty_string_has_zero_tokens() {
        // count_tokens uses AddBos::Never → empty string → 0 tokens
        let n = common::gpu::token_count("");
        assert!(
            n <= 1,
            "empty string produced {} tokens (expected 0 or 1)",
            n
        );
        println!("empty string = {} tokens", n);
    }

    #[tokio::test]
    async fn test_conversation_has_more_tokens_than_raw_text() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let raw = "Hello there.";
        let raw_count = common::gpu::token_count(raw);

        let messages = vec![common::user_msg(raw)];
        let conv_count = common::gpu::count_conversation_tokens(&messages, None, &info);

        assert!(
            conv_count > raw_count as u32,
            "conversation ({} tokens) must exceed raw text ({} tokens) \
             due to chat template overhead",
            conv_count,
            raw_count
        );
        println!("raw={raw_count}  conversation={conv_count}");
    }

    #[tokio::test]
    async fn test_system_prompt_increases_token_count() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let messages = vec![common::user_msg("What is 2+2?")];
        let without = common::gpu::count_conversation_tokens(&messages, None, &info);
        let with_sys =
            common::gpu::count_conversation_tokens(&messages, Some("You are a math tutor."), &info);

        assert!(
            with_sys > without,
            "adding a system prompt ({} tokens) must exceed without ({} tokens)",
            with_sys,
            without
        );
        println!(
            "without system={without}  with system={with_sys}  overhead={}",
            with_sys - without
        );
    }

    #[tokio::test]
    async fn test_multi_turn_conversation_has_more_tokens_than_single_turn() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let single = vec![common::user_msg("Hello")];
        let multi = common::sample_conversation();

        let single_count = common::gpu::count_conversation_tokens(&single, None, &info);
        let multi_count = common::gpu::count_conversation_tokens(&multi, None, &info);

        assert!(
            multi_count > single_count,
            "multi-turn ({} tokens) must exceed single-turn ({} tokens)",
            multi_count,
            single_count
        );
        println!("single={single_count}  multi={multi_count}");
    }

    #[tokio::test]
    async fn test_sample_conversation_token_count_is_realistic() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let count =
            common::gpu::count_conversation_tokens(&common::sample_conversation(), None, &info);

        // 4-turn conversation with a code snippet — should be a few hundred tokens
        assert!(
            count > 50,
            "sample_conversation must have > 50 tokens, got {}",
            count
        );
        assert!(
            count < 10_000,
            "sample_conversation must have < 10000 tokens, got {}",
            count
        );
        println!("sample_conversation = {} tokens", count);
    }

    #[tokio::test]
    async fn test_near_limit_detection_with_real_token_counts() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        // Count actual tokens for sample conversation
        let real_count =
            common::gpu::count_conversation_tokens(&common::sample_conversation(), None, &info);

        // Set a fake context_length such that real_count ≈ 85% → NearLimit
        let fake_context = (real_count as f32 / 0.85) as u32;
        let result = check_fits_in_context(real_count, fake_context);

        assert!(
            matches!(
                result,
                ContextFitResult::NearLimit { .. } | ContextFitResult::Exceeds { .. }
            ),
            "expected NearLimit or Exceeds at ~85% load, got {:?}",
            result
        );
        println!("real_count={real_count}  fake_context={fake_context}  result={result:?}");
    }

    #[tokio::test]
    async fn test_over_limit_detected_with_halved_context() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let count =
            common::gpu::count_conversation_tokens(&common::sample_conversation(), None, &info);
        // Half the context → definitely exceeds
        let tiny_context = count / 2;
        let result = check_fits_in_context(count, tiny_context);

        assert!(
            matches!(result, ContextFitResult::Exceeds { .. }),
            "expected Exceeds when count={count} > limit={tiny_context}, got {:?}",
            result
        );
    }

    /// The sample conversation must fit comfortably inside the model's actual context window.
    #[tokio::test]
    async fn test_sample_conversation_fits_in_model_context() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let count =
            common::gpu::count_conversation_tokens(&common::sample_conversation(), None, &info);
        let result = check_fits_in_context(count, info.context_length);

        assert!(
            matches!(result, ContextFitResult::Fits { .. }),
            "sample_conversation ({} tokens) should fit comfortably in context ({} tokens): {:?}",
            count,
            info.context_length,
            result
        );
        if let ContextFitResult::Fits { remaining } = result {
            println!(
                "sample_conversation: {count} / {} tokens used, {remaining} budget remaining",
                info.context_length
            );
        }
    }

    /// A conversation that is too large for a small fake context triggers NearLimit or Exceeds.
    ///
    /// The actual model may have a very large context (200k+), so we test the budget
    /// detection logic against an artificially small context limit rather than relying on
    /// a specific number of repetitions to overflow any particular model's window.
    #[tokio::test]
    async fn test_large_conversation_triggers_near_limit_or_exceeds() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let base = common::sample_conversation();
        // Repeat enough times to produce a clearly large token count (≥ 5× base)
        let large: Vec<_> = std::iter::repeat_with(|| base.clone())
            .take(5)
            .flatten()
            .collect();

        let count = common::gpu::count_conversation_tokens(&large, None, &info);

        // Use a fake context that is just larger than 'count / 2',
        // so the conversation is definitely over the limit for this fake context.
        let fake_context = count / 2;
        let result = check_fits_in_context(count, fake_context);

        assert!(
            matches!(result, ContextFitResult::Exceeds { .. }),
            "conversation ({count} tokens) must Exceed a fake context of {fake_context} tokens: {:?}",
            result
        );
        println!("5× conversation = {count} tokens > fake_context={fake_context} → {result:?}");
    }
}
