//! Tests for skill capability detection and context injection pipeline.
//!
//! These tests answer three concrete questions:
//!
//! 1. **Model card capabilities** — Does `ModelInfo` correctly report what the
//!    model supports?  Specifically: `supports_thinking` (GLM-4 / QwQ / etc.)
//!    and `supported_roles` (must include "system" for personality/tool injection
//!    to work at all).
//!
//! 2. **Skill content correctness** — Do the seeded default skills contain the
//!    content the UI expects? (personality traits, tool XML syntax, etc.)
//!
//! 3. **Injection pipeline** — Does skill content (personality traits, tool XML,
//!    mode prompt) actually survive being assembled into a system string and then
//!    rendered through the model's chat template?
//!
//! Pure tests (no GPU, no MODEL_PATH) run with:
//!   cargo test --test skill_injection_tests
//!
//! GPU tests require --features vulkan and MODEL_PATH:
//!   cargo test --test skill_injection_tests --features vulkan

#[path = "common/mod.rs"]
mod common;

// ── Pure: skill content correctness ───────────────────────────────────────────

#[test]
fn test_personality_skill_has_trait_keywords() {
    let lower = common::PERSONALITY_SKILL_CONTENT.to_lowercase();
    assert!(
        lower.contains("friendly"),
        "Personality skill must include 'friendly' trait"
    );
    assert!(
        lower.contains("curious"),
        "Personality skill must include 'curious' trait"
    );
    assert!(
        lower.contains("thoughtful") || lower.contains("empathetic") || lower.contains("clear"),
        "Personality skill must describe communication style"
    );
}

#[test]
fn test_directives_skill_references_write_to_file() {
    assert!(
        common::DIRECTIVES_SKILL_CONTENT.contains("write_to_file"),
        "Directives skill must mention the write_to_file tool"
    );
}

#[test]
fn test_browser_skill_has_browser_fetch_xml() {
    assert!(
        common::BROWSER_SKILL_CONTENT.contains("<browser_fetch>"),
        "Browser skill must contain <browser_fetch> XML opening tag"
    );
    assert!(
        common::BROWSER_SKILL_CONTENT.contains("<url>"),
        "Browser skill must show the <url> XML element"
    );
}

// ── Pure: system prompt assembly ──────────────────────────────────────────────

/// When a mode prompt and skill content are combined, both must appear in the
/// assembled system string (mirrors buildExtraContext in useChat.ts).
#[test]
fn test_assembled_context_contains_mode_prompt() {
    let combined = assemble_context(
        common::CODE_SYSTEM_PROMPT,
        common::PERSONALITY_SKILL_CONTENT,
    );
    assert!(
        combined.contains(common::CODE_SYSTEM_PROMPT),
        "Assembled context must contain the mode system prompt verbatim"
    );
}

#[test]
fn test_assembled_context_contains_skill_content() {
    let combined = assemble_context(
        common::CODE_SYSTEM_PROMPT,
        common::PERSONALITY_SKILL_CONTENT,
    );
    let lower = combined.to_lowercase();
    assert!(
        lower.contains("friendly"),
        "Assembled context must contain personality trait from skill"
    );
}

#[test]
fn test_assembled_context_contains_tool_xml() {
    let combined = assemble_context(common::AUTO_SYSTEM_PROMPT, common::TOOL_SKILL_PROMPT);
    assert!(
        combined.contains("<write_to_file>"),
        "Assembled context with tool skill must contain write_to_file XML"
    );
    assert!(
        combined.contains("<read_file>"),
        "Assembled context with tool skill must contain read_file XML"
    );
}

#[test]
fn test_assembled_context_with_multiple_skills() {
    let skills = format!(
        "{}\n\n{}",
        common::PERSONALITY_SKILL_CONTENT,
        common::TOOL_SKILL_PROMPT
    );
    let combined = assemble_context(common::CHAT_SYSTEM_PROMPT, &skills);
    let lower = combined.to_lowercase();
    assert!(
        lower.contains("friendly"),
        "personality must be in combined context"
    );
    assert!(
        combined.contains("<write_to_file>"),
        "tool XML must be in combined context"
    );
    assert!(
        combined.contains(common::CHAT_SYSTEM_PROMPT),
        "mode prompt must be in combined context"
    );
}

// ── Pure: supports_thinking detection ─────────────────────────────────────────

#[test]
fn test_thinking_detected_from_template_variable() {
    use arx_lib::model_manager::metadata::{
        detect_thinking_support, template_level_thinking_control,
    };

    // An active Jinja2 conditional must enable both flags.
    let active_tmpl = Some("{%- if enable_thinking %}<think>\n{%- endif %}...".to_string());
    assert!(
        detect_thinking_support("Some-Model", &active_tmpl),
        "detect_thinking_support must be true for template with active 'if enable_thinking'"
    );
    assert!(
        template_level_thinking_control(&active_tmpl),
        "template_level_thinking_control must be true for active conditional"
    );

    // A bare string mention in a comment must NOT trigger template-level control.
    let comment_tmpl = Some("{# supports enable_thinking parameter #}\n[gMASK]...".to_string());
    assert!(
        !template_level_thinking_control(&comment_tmpl),
        "template_level_thinking_control must be false for comment-only mention"
    );
}

#[test]
fn test_thinking_detected_from_model_name_glm() {
    use arx_lib::model_manager::metadata::detect_thinking_support;
    assert!(
        detect_thinking_support("GLM-4.7-Flash", &None),
        "GLM model name must be recognized as thinking-capable"
    );
    assert!(
        detect_thinking_support("glm-4-9b", &None),
        "glm- prefix (lowercase) must be recognized"
    );
}

#[test]
fn test_thinking_detected_from_model_name_qwq() {
    use arx_lib::model_manager::metadata::detect_thinking_support;
    assert!(
        detect_thinking_support("QwQ-32B", &None),
        "QwQ model name must be recognized as thinking-capable"
    );
}

#[test]
fn test_no_thinking_for_plain_llama() {
    use arx_lib::model_manager::metadata::detect_thinking_support;
    assert!(
        !detect_thinking_support("Llama-3.1-8B-Instruct", &None),
        "Plain LLaMA model must NOT be detected as thinking-capable"
    );
}

#[test]
fn test_no_thinking_for_mistral() {
    use arx_lib::model_manager::metadata::detect_thinking_support;
    assert!(
        !detect_thinking_support("Mistral-7B-Instruct", &None),
        "Mistral model must NOT be detected as thinking-capable"
    );
}

// ── GPU-gated: model capabilities from real GGUF ──────────────────────────────

#[cfg(feature = "vulkan")]
mod gpu_injection {
    use super::*;
    use arx_lib::model_manager::metadata::peek_model_metadata;
    use std::path::Path;

    /// GLM-4.7-Flash must report supports_thinking = true because its chat
    /// template contains the `enable_thinking` Jinja2 variable.
    #[tokio::test]
    async fn test_glm_model_supports_thinking() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        assert!(
            info.supports_thinking,
            "GLM-4.7-Flash model must have supports_thinking = true; \
             name='{}', arch='{}'",
            info.name, info.architecture
        );
        println!(
            "supports_thinking = {} (name={})",
            info.supports_thinking, info.name
        );
    }

    /// The model must include "system" in its supported roles so that personality
    /// and tool content can be injected at all.
    #[tokio::test]
    async fn test_model_supports_system_role() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        assert!(
            info.supported_roles.iter().any(|r| r == "system"),
            "Model must support the 'system' role for skill injection; \
             supported_roles = {:?}",
            info.supported_roles
        );
        println!("supported_roles = {:?}", info.supported_roles);
    }

    /// Personality trait content fed as the system prompt must survive the
    /// model's chat template rendering intact.
    #[tokio::test]
    async fn test_personality_content_survives_template_rendering() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let messages = vec![common::user_msg("Hello!")];
        let rendered =
            common::gpu::render_template(&messages, Some(common::PERSONALITY_SKILL_CONTENT), &info);

        let lower = rendered.to_lowercase();
        assert!(
            lower.contains("friendly") || lower.contains("curious"),
            "Personality traits must appear in the rendered chat template; \
             got rendered length = {} chars",
            rendered.len()
        );
        println!(
            "Rendered with personality (first 400 chars): {:.400}",
            rendered
        );
    }

    /// Tool XML (write_to_file / read_file) fed as the system prompt must survive
    /// the model's chat template rendering and appear verbatim in the output.
    #[tokio::test]
    async fn test_tool_xml_survives_template_rendering() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let messages = vec![common::user_msg("Write a Rust function.")];
        let rendered =
            common::gpu::render_template(&messages, Some(common::TOOL_SKILL_PROMPT), &info);

        assert!(
            rendered.contains("<write_to_file>"),
            "write_to_file XML tag must survive template rendering"
        );
        assert!(
            rendered.contains("<read_file>"),
            "read_file XML tag must survive template rendering"
        );
        println!(
            "Tool XML confirmed in rendered template ({} chars total)",
            rendered.len()
        );
    }

    /// The assembled context (mode prompt + personality skill) must survive
    /// template rendering with all content intact.
    #[tokio::test]
    async fn test_mode_plus_skill_content_survives_template_rendering() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let combined_system = assemble_context(
            common::CODE_SYSTEM_PROMPT,
            common::PERSONALITY_SKILL_CONTENT,
        );

        let messages = vec![common::user_msg("Explain your capabilities.")];
        let rendered = common::gpu::render_template(&messages, Some(&combined_system), &info);

        // Both mode and personality content must appear in the rendered output.
        assert!(
            rendered.contains("write_to_file"),
            "Code mode's write_to_file instruction must survive template rendering"
        );
        let lower = rendered.to_lowercase();
        assert!(
            lower.contains("friendly") || lower.contains("curious"),
            "Personality traits must survive alongside mode prompt in template rendering"
        );
        println!(
            "Mode+skill context rendered: {} chars total",
            rendered.len()
        );
    }

    /// When a model's chat template contains an `enable_thinking` Jinja2 variable
    /// (template-level thinking control), disabling it must produce a different
    /// rendered prompt than the default.
    ///
    /// Two kinds of thinking-capable models exist:
    ///
    /// 1. **Template-level** (`enable_thinking` in the Jinja2 source): the
    ///    rendered prompt itself changes — a `<think>` marker appears/disappears
    ///    in the generation prompt.  Our prepend override handles this case.
    ///
    /// 2. **Generation-level** (name-based detection only): the model emits
    ///    `<think>` as its first generated token.  The chat template is identical
    ///    regardless of the flag; the flag must be forwarded to the sampler or
    ///    handled at inference time.  This test skips that case.
    #[tokio::test]
    async fn test_thinking_disabled_differs_from_thinking_enabled() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        // Only template-level thinking (active Jinja2 conditional) produces a
        // different rendered string.  A bare "enable_thinking" comment does not.
        use arx_lib::model_manager::metadata::template_level_thinking_control;
        let template_controls_thinking = template_level_thinking_control(&info.chat_template);

        if !template_controls_thinking {
            println!(
                "Model '{}' uses generation-level thinking (template does not contain \
                 enable_thinking) — template-diff test skipped",
                info.name
            );
            return;
        }

        let messages = vec![common::user_msg("What is 2 + 2?")];

        let with_thinking =
            common::gpu::render_template_with_thinking(&messages, None, &info, Some(true));
        let without_thinking =
            common::gpu::render_template_with_thinking(&messages, None, &info, Some(false));

        assert_ne!(
            with_thinking, without_thinking,
            "Rendered template must differ between thinking=true and thinking=false \
             when the chat template uses the enable_thinking variable"
        );

        // With thinking disabled the generation prompt must not open a <think> block.
        assert!(
            !without_thinking.contains("<think>"),
            "Template with thinking=false must not contain <think> marker; got: {:.200}",
            without_thinking
        );

        println!(
            "With thinking: ...{:.200}",
            &with_thinking[with_thinking.len().saturating_sub(200)..]
        );
        println!(
            "Without thinking: ...{:.200}",
            &without_thinking[without_thinking.len().saturating_sub(200)..]
        );
    }

    /// Personality content injected via system role must add more tokens than
    /// the same conversation without a system prompt.
    #[tokio::test]
    async fn test_personality_injection_increases_token_count() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let messages = vec![common::user_msg("Hello!")];

        let without = common::gpu::count_conversation_tokens(&messages, None, &info);
        let with_personality = common::gpu::count_conversation_tokens(
            &messages,
            Some(common::PERSONALITY_SKILL_CONTENT),
            &info,
        );

        assert!(
            with_personality > without,
            "Injecting personality skill ({} tokens) must add tokens vs no system ({} tokens)",
            with_personality,
            without
        );
        println!(
            "Token overhead from personality injection = {} tokens",
            with_personality - without
        );
    }

    /// Tool skill injected as system prompt must add measurably more tokens than
    /// personality alone (tool XML is longer than the personality text).
    #[tokio::test]
    async fn test_tool_skill_injection_adds_more_tokens_than_personality() {
        let info = peek_model_metadata(Path::new(common::MODEL_PATH))
            .await
            .expect("peek failed");

        let messages = vec![common::user_msg("Hello!")];

        let with_personality = common::gpu::count_conversation_tokens(
            &messages,
            Some(common::PERSONALITY_SKILL_CONTENT),
            &info,
        );
        let with_tools = common::gpu::count_conversation_tokens(
            &messages,
            Some(common::TOOL_SKILL_PROMPT),
            &info,
        );

        assert!(
            with_tools > with_personality,
            "Tool skill injection ({} tokens) must add more tokens than personality ({} tokens) \
             because the XML definitions are longer",
            with_tools,
            with_personality
        );
        println!(
            "personality={} tokens  tools={} tokens",
            with_personality, with_tools
        );
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Mirrors `buildExtraContext` from `src/hooks/useChat.ts`:
/// mode prompt + separator + skill content block.
fn assemble_context(mode_prompt: &str, skill_content: &str) -> String {
    format!(
        "{}\n\n---\n## Active Skills\n\n{}",
        mode_prompt,
        skill_content.trim()
    )
}
