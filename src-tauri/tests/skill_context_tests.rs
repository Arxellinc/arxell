//! Tests for mode system prompts and skill context budget management.
//!
//! "Skills" in Arxell are Markdown snippets injected as system prompts.  Each chat
//! mode (Chat / Code / Architect / Auto) has its own system prompt string, and
//! the always-active "tool skill" (write_to_file / read_file XML syntax) is
//! prepended in Autonomous mode.
//!
//! Pure tests (prompt content + character-length ordering) run with no features.
//! GPU tests in `gpu_skill_tests` require `--features vulkan` and MODEL_PATH.
//!
//! Run pure:  cargo test --test skill_context_tests
//! Run all:   cargo test --test skill_context_tests --features vulkan

#[path = "common/mod.rs"]
mod common;

// ── Pure: prompt content validation ───────────────────────────────────────────

#[test]
fn test_all_mode_prompts_are_nonempty() {
    assert!(
        !common::CHAT_SYSTEM_PROMPT.is_empty(),
        "CHAT_SYSTEM_PROMPT is empty"
    );
    assert!(
        !common::CODE_SYSTEM_PROMPT.is_empty(),
        "CODE_SYSTEM_PROMPT is empty"
    );
    assert!(
        !common::ARCHITECT_SYSTEM_PROMPT.is_empty(),
        "ARCHITECT_SYSTEM_PROMPT is empty"
    );
    assert!(
        !common::AUTO_SYSTEM_PROMPT.is_empty(),
        "AUTO_SYSTEM_PROMPT is empty"
    );
    assert!(
        !common::TOOL_SKILL_PROMPT.is_empty(),
        "TOOL_SKILL_PROMPT is empty"
    );
}

#[test]
fn test_chat_prompt_identifies_assistant_as_arxell() {
    assert!(
        common::CHAT_SYSTEM_PROMPT.contains("Arxell"),
        "Chat system prompt must identify the assistant as 'Arxell'"
    );
}

#[test]
fn test_code_prompt_references_write_to_file() {
    assert!(
        common::CODE_SYSTEM_PROMPT.contains("write_to_file"),
        "Code mode prompt must reference the write_to_file tool"
    );
}

#[test]
fn test_code_prompt_longer_than_chat_prompt() {
    assert!(
        common::CODE_SYSTEM_PROMPT.len() > common::CHAT_SYSTEM_PROMPT.len(),
        "Code mode prompt ({} chars) must be longer than Chat prompt ({} chars)",
        common::CODE_SYSTEM_PROMPT.len(),
        common::CHAT_SYSTEM_PROMPT.len()
    );
}

#[test]
fn test_architect_prompt_longer_than_chat_prompt() {
    assert!(
        common::ARCHITECT_SYSTEM_PROMPT.len() > common::CHAT_SYSTEM_PROMPT.len(),
        "Architect mode prompt ({} chars) must be longer than Chat prompt ({} chars)",
        common::ARCHITECT_SYSTEM_PROMPT.len(),
        common::CHAT_SYSTEM_PROMPT.len()
    );
}

#[test]
fn test_auto_prompt_longer_than_chat_prompt() {
    assert!(
        common::AUTO_SYSTEM_PROMPT.len() > common::CHAT_SYSTEM_PROMPT.len(),
        "Auto mode prompt ({} chars) must be longer than Chat prompt ({} chars)",
        common::AUTO_SYSTEM_PROMPT.len(),
        common::CHAT_SYSTEM_PROMPT.len()
    );
}

#[test]
fn test_auto_prompt_has_numbered_operating_steps() {
    // Auto mode must enumerate an explicit operating procedure
    assert!(
        common::AUTO_SYSTEM_PROMPT.contains("1."),
        "Auto mode prompt must list numbered operating steps"
    );
}

#[test]
fn test_auto_prompt_has_guardrails() {
    assert!(
        common::AUTO_SYSTEM_PROMPT
            .to_lowercase()
            .contains("guardrail"),
        "Auto mode prompt must include a guardrails section"
    );
}

#[test]
fn test_architect_prompt_mentions_scalability_or_tradeoffs() {
    let lower = common::ARCHITECT_SYSTEM_PROMPT.to_lowercase();
    assert!(
        lower.contains("scalab") || lower.contains("tradeoff") || lower.contains("trade-off"),
        "Architect mode prompt must address scalability or trade-offs"
    );
}

// ── Pure: tool skill prompt structure ─────────────────────────────────────────

#[test]
fn test_tool_skill_describes_both_tools() {
    assert!(
        common::TOOL_SKILL_PROMPT.contains("write_to_file"),
        "TOOL_SKILL_PROMPT must describe the write_to_file tool"
    );
    assert!(
        common::TOOL_SKILL_PROMPT.contains("read_file"),
        "TOOL_SKILL_PROMPT must describe the read_file tool"
    );
}

#[test]
fn test_tool_skill_shows_xml_path_and_content_tags() {
    assert!(
        common::TOOL_SKILL_PROMPT.contains("<path>"),
        "TOOL_SKILL_PROMPT must show the <path> XML element"
    );
    assert!(
        common::TOOL_SKILL_PROMPT.contains("<content>"),
        "TOOL_SKILL_PROMPT must show the <content> XML element"
    );
}

#[test]
fn test_tool_skill_instructs_to_never_paste_code_in_chat() {
    let lower = common::TOOL_SKILL_PROMPT.to_lowercase();
    assert!(
        lower.contains("never") || lower.contains("always use write_to_file"),
        "TOOL_SKILL_PROMPT must instruct the model to use write_to_file instead of pasting code"
    );
}

// ── Pure: combined skill ordering ─────────────────────────────────────────────

#[test]
fn test_auto_plus_tool_skill_longer_than_either_alone() {
    let combined = format!(
        "{}\n\n{}",
        common::AUTO_SYSTEM_PROMPT,
        common::TOOL_SKILL_PROMPT
    );
    assert!(
        combined.len() > common::AUTO_SYSTEM_PROMPT.len(),
        "combined prompt must be longer than Auto alone"
    );
    assert!(
        combined.len() > common::TOOL_SKILL_PROMPT.len(),
        "combined prompt must be longer than Tool skill alone"
    );
}

// GPU-gated skill tests (token costs, capability detection, injection pipeline)
// live in skill_injection_tests.rs.

#[cfg(feature = "vulkan")]
mod gpu_skill_tests {
    use super::*;
    use arx_lib::model_manager::metadata::peek_model_metadata;
    use arx_lib::model_manager::tokenizer::{check_fits_in_context, get_context_budget};
    use arx_lib::model_manager::types::ContextFitResult;
    use std::path::Path;

    /// Print and validate token costs for every mode system prompt.
    ///
    /// Invariants:
    /// - All prompts tokenize to > 0 tokens
    /// - Code/Architect/Auto cost more tokens than the minimal Chat prompt
    #[tokio::test]
    async fn test_all_mode_prompt_token_costs() {
        let prompts = [
            ("Chat", common::CHAT_SYSTEM_PROMPT),
            ("Code", common::CODE_SYSTEM_PROMPT),
            ("Architect", common::ARCHITECT_SYSTEM_PROMPT),
            ("Auto", common::AUTO_SYSTEM_PROMPT),
            ("Tool skill", common::TOOL_SKILL_PROMPT),
        ];

        let mut costs: Vec<(&str, usize)> = Vec::new();
        for (name, prompt) in &prompts {
            let n = common::gpu::token_count(prompt);
            assert!(n > 0, "{name} system prompt tokenized to 0 tokens");
            costs.push((name, n));
        }

        // Print summary
        for (name, n) in &costs {
            println!("{name:12} system prompt = {n} tokens");
        }

        // Richer prompts must cost more than minimal Chat
        let chat_cost = costs.iter().find(|(n, _)| *n == "Chat").unwrap().1;
        for (name, cost) in &costs {
            if *name != "Chat" && *name != "Tool skill" {
                assert!(
                    *cost > chat_cost,
                    "{name} prompt ({cost} tokens) must cost more than Chat ({chat_cost} tokens)"
                );
            }
        }
    }

    /// System prompt tokens must be > 0 when injected, and zero contribution
    /// means it's missing from the render (sanity check for double-render logic).
    #[tokio::test]
    async fn test_system_tokens_increase_count() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let messages = vec![common::user_msg("Hello!")];

        let without = common::gpu::count_conversation_tokens(&messages, None, &info);
        let with_sys = common::gpu::count_conversation_tokens(
            &messages,
            Some(common::CHAT_SYSTEM_PROMPT),
            &info,
        );

        assert!(
            with_sys > without,
            "with Chat system prompt ({with_sys} tokens) must exceed without ({without} tokens)"
        );
        println!("Chat system overhead = {} tokens", with_sys - without);
    }

    /// Each mode's system prompt must fit within 10% of the model's context window.
    ///
    /// If any prompt exceeds this, it would crowd out the actual conversation.
    #[tokio::test]
    async fn test_all_system_prompts_under_10pct_of_context() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let ten_pct = info.context_length / 10;

        for (name, prompt) in [
            ("Chat", common::CHAT_SYSTEM_PROMPT),
            ("Code", common::CODE_SYSTEM_PROMPT),
            ("Architect", common::ARCHITECT_SYSTEM_PROMPT),
            ("Auto", common::AUTO_SYSTEM_PROMPT),
        ] {
            let n = common::gpu::token_count(prompt);
            assert!(
                n < ten_pct as usize,
                "{name} system prompt ({n} tokens) exceeds 10% of context ({ten_pct} tokens)"
            );
            println!(
                "{name:12} = {n:5} / {} tokens  ({:.1}%)",
                info.context_length,
                n as f32 / info.context_length as f32 * 100.0
            );
        }
    }

    /// Tool skill prompt must not consume more than 5% of the usable context budget.
    #[tokio::test]
    async fn test_tool_skill_token_budget_is_acceptable() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let tool_tokens = common::gpu::token_count(common::TOOL_SKILL_PROMPT);
        let budget = get_context_budget(info.context_length, 0.10);
        let five_pct = budget / 20;

        assert!(
            tool_tokens < five_pct as usize,
            "Tool skill ({tool_tokens} tokens) exceeds 5% of usable budget ({five_pct} tokens)"
        );
        println!(
            "Tool skill = {tool_tokens} / {budget} usable tokens ({:.1}%)",
            tool_tokens as f32 / budget as f32 * 100.0
        );
    }

    /// Code mode + sample conversation must fit comfortably in the model's context.
    #[tokio::test]
    async fn test_code_mode_with_sample_conversation_fits_in_context() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let total = common::gpu::count_conversation_tokens(
            &common::sample_conversation(),
            Some(common::CODE_SYSTEM_PROMPT),
            &info,
        );
        let result = check_fits_in_context(total, info.context_length);

        assert!(
            matches!(result, ContextFitResult::Fits { .. }),
            "Code mode + sample_conversation ({total} tokens) must fit in {} token context: {:?}",
            info.context_length,
            result
        );
        if let ContextFitResult::Fits { remaining } = result {
            println!("Code+conversation: {total} tokens used, {remaining} budget remaining");
        }
    }

    /// Auto mode + Tool skill (the heaviest possible system prompt) + sample conversation
    /// must still fit in the model's context window.
    #[tokio::test]
    async fn test_auto_plus_tool_skill_plus_conversation_fits_in_context() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let combined_system = format!(
            "{}\n\n{}",
            common::AUTO_SYSTEM_PROMPT,
            common::TOOL_SKILL_PROMPT
        );
        let total = common::gpu::count_conversation_tokens(
            &common::sample_conversation(),
            Some(&combined_system),
            &info,
        );
        let result = check_fits_in_context(total, info.context_length);

        assert!(
            matches!(result, ContextFitResult::Fits { .. }),
            "Auto+Tool+sample_conversation ({total} tokens) must fit in {} token context: {:?}",
            info.context_length,
            result
        );
        println!(
            "Auto+Tool+conversation: {total} / {} tokens ({:.1}%)",
            info.context_length,
            total as f32 / info.context_length as f32 * 100.0
        );
    }

    /// A 20× repeated conversation must trigger NearLimit or Exceeds — proving the
    /// context budget detection works with real token counts.
    #[tokio::test]
    async fn test_large_conversation_triggers_context_warning() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        // Build a very large conversation (20× sample)
        let base = common::sample_conversation();
        let large: Vec<_> = std::iter::repeat_with(|| base.clone())
            .take(20)
            .flatten()
            .collect();

        let count = common::gpu::count_conversation_tokens(&large, None, &info);

        // Use a fake context that is half the conversation size so the detection
        // logic is exercised regardless of the model's actual context window size.
        let fake_context = count / 2;
        let result = check_fits_in_context(count, fake_context);

        assert!(
            matches!(result, ContextFitResult::Exceeds { .. }),
            "20× sample_conversation ({count} tokens) must Exceed a fake context of \
             {fake_context} tokens, got {:?}",
            result
        );
        println!("20× conversation = {count} tokens > fake_context={fake_context} → {result:?}");
    }

    /// Adding a system prompt to an already-near-limit conversation must be detectable.
    #[tokio::test]
    async fn test_system_prompt_overhead_is_measurable() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let messages = common::sample_conversation();

        // Measure token overhead for each mode
        let base = common::gpu::count_conversation_tokens(&messages, None, &info);
        for (name, prompt) in [
            ("Chat", common::CHAT_SYSTEM_PROMPT),
            ("Code", common::CODE_SYSTEM_PROMPT),
            ("Architect", common::ARCHITECT_SYSTEM_PROMPT),
            ("Auto", common::AUTO_SYSTEM_PROMPT),
        ] {
            let with_sys = common::gpu::count_conversation_tokens(&messages, Some(prompt), &info);
            let overhead = with_sys.saturating_sub(base);
            assert!(
                overhead > 0,
                "{name} system prompt must add > 0 tokens to conversation count"
            );
            println!("{name:12} system overhead = {overhead} tokens  (total={with_sys})");
        }
    }
}
