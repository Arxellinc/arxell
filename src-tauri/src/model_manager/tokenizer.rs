//! Tokenization and chat template rendering
//!
//! This module provides functionality for:
//! - Counting tokens in text and conversations
//! - Rendering chat templates for various model architectures
//! - Context budget management

#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
use log::warn;

use super::types::{ChatMessage, ContextFitResult, ModelError, ModelInfo, TokenCount};

/// Calculate the usable context budget after applying safety margin.
///
/// # Arguments
/// * `context_length` - Total context length from model
/// * `safety_margin` - Fraction to reserve (e.g., 0.10 for 10%)
///
/// # Returns
/// Usable token budget
pub fn get_context_budget(context_length: u32, safety_margin: f32) -> u32 {
    ((context_length as f32) * (1.0 - safety_margin)) as u32
}

/// Check if a token count fits within the context budget.
///
/// # Arguments
/// * `total_tokens` - Total tokens to check
/// * `context_length` - Model's context length
///
/// # Returns
/// ContextFitResult indicating fit status
pub fn check_fits_in_context(total_tokens: u32, context_length: u32) -> ContextFitResult {
    let budget = get_context_budget(context_length, 0.10);
    let percentage_used = (total_tokens as f32 / context_length as f32) * 100.0;

    if total_tokens >= context_length {
        let overflow = total_tokens.saturating_sub(context_length);
        ContextFitResult::Exceeds {
            overflow_by: overflow,
        }
    } else if percentage_used >= 80.0 {
        let remaining = context_length.saturating_sub(total_tokens);
        ContextFitResult::NearLimit {
            remaining,
            percentage_used,
        }
    } else {
        let remaining = budget.saturating_sub(total_tokens);
        ContextFitResult::Fits { remaining }
    }
}

/// Count tokens in a raw string using the loaded model.
///
/// This is the primitive function that all other token counting uses.
///
/// # Arguments
/// * `text` - Text to tokenize
/// * `model` - Loaded LlamaModel
///
/// # Returns
/// Number of tokens in the text
#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
pub fn count_tokens(text: &str, model: &llama_cpp_2::model::LlamaModel) -> Result<u32, ModelError> {
    use llama_cpp_2::model::AddBos;

    let tokens = model
        .str_to_token(text, AddBos::Never)
        .map_err(|e| ModelError::LlamaCppError(format!("Tokenization failed: {:?}", e)))?;

    Ok(tokens.len() as u32)
}

#[cfg(not(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
)))]
pub fn count_tokens(_text: &str, _model: &()) -> Result<u32, ModelError> {
    Err(ModelError::ModelNotLoaded)
}

/// Render chat messages using the model's chat template or a fallback.
///
/// # Priority
/// 1. Use llama-cpp-2's built-in `apply_chat_template` if available
/// 2. Fall back to architecture-specific format
///
/// # Arguments
/// * `messages` - Chat messages to render
/// * `system` - Optional system prompt override
/// * `model` - Loaded model for template access
/// * `model_info` - Model metadata including architecture
/// * `enable_thinking` - For models that support thinking mode (e.g. GLM-4),
///   `Some(false)` disables the reasoning block by injecting a Jinja2 variable
///   override at the top of the template before rendering.  `None` or `Some(true)`
///   leave the template's default behaviour (thinking enabled).
///
/// # Returns
/// Rendered prompt string
#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
pub fn render_chat_template(
    messages: &[ChatMessage],
    system: Option<&str>,
    model: &llama_cpp_2::model::LlamaModel,
    model_info: &ModelInfo,
    enable_thinking: Option<bool>,
) -> Result<String, ModelError> {
    use llama_cpp_2::model::LlamaChatMessage;

    // Build the message list, prepending a system message when provided.
    let mut llama_messages: Vec<LlamaChatMessage> = Vec::with_capacity(messages.len() + 1);

    if let Some(sys_content) = system {
        let msg =
            LlamaChatMessage::new("system".to_string(), sys_content.to_string()).map_err(|e| {
                ModelError::LlamaCppError(format!("Failed to create system message: {:?}", e))
            })?;
        llama_messages.push(msg);
    }

    for msg in messages {
        let llama_msg = LlamaChatMessage::new(msg.role.clone(), msg.content.clone())
            .map_err(|e| ModelError::LlamaCppError(format!("Failed to create message: {:?}", e)))?;
        llama_messages.push(llama_msg);
    }

    use llama_cpp_2::model::LlamaChatTemplate;

    use crate::model_manager::metadata::template_level_thinking_control;

    // When thinking must be explicitly disabled AND the chat template has an
    // active `if enable_thinking` conditional, prepend the Jinja2 override.
    // For generation-level thinking (name-based only) the template is identical
    // regardless of the flag, so we skip the override path entirely.
    if template_level_thinking_control(&model_info.chat_template) && enable_thinking == Some(false)
    {
        if let Some(tmpl_str) = &model_info.chat_template {
            let modified = format!("{{%- set enable_thinking = false -%}}\n{}", tmpl_str);
            let tmpl = LlamaChatTemplate::new(&modified)
                .map_err(|e| ModelError::LlamaCppError(format!("Template NUL error: {}", e)))?;
            return model
                .apply_chat_template(&tmpl, &llama_messages, true)
                .map_err(|e| {
                    ModelError::LlamaCppError(format!("Template rendering failed: {:?}", e))
                });
        }
    }

    // Default path: use the model's built-in LlamaChatTemplate (thinking enabled).
    match model.chat_template(None) {
        Ok(template) => model
            .apply_chat_template(&template, &llama_messages, true)
            .map_err(|e| ModelError::LlamaCppError(format!("Template rendering failed: {:?}", e))),
        Err(_) => {
            warn!(
                "No chat template in model, using fallback for architecture: {}",
                model_info.architecture
            );
            Ok(render_fallback_template(messages, system, model_info))
        }
    }
}

#[cfg(not(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
)))]
pub fn render_chat_template(
    _messages: &[ChatMessage],
    _system: Option<&str>,
    _model: &(),
    _model_info: &ModelInfo,
    _enable_thinking: Option<bool>,
) -> Result<String, ModelError> {
    Err(ModelError::ModelNotLoaded)
}

#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
/// Render a fallback chat template based on model architecture.
///
/// Supports common formats:
/// - Llama/Mistral: [INST] ... [/INST]
/// - ChatML/Qwen: <|im_start|> ... <|im_end|>
/// - Gemma: <start_of_turn> ... <end_of_turn>
/// - Phi-3: <|user|> ... <|end|>
fn render_fallback_template(
    messages: &[ChatMessage],
    system: Option<&str>,
    model_info: &ModelInfo,
) -> String {
    let arch_lower = model_info.architecture.to_lowercase();

    // Check for BOS/EOS tokens from model info
    let bos = model_info.bos_token.as_deref().unwrap_or("");
    let eos = model_info.eos_token.as_deref().unwrap_or("");

    let mut output = String::new();

    // Add BOS token at start if available
    if !bos.is_empty() {
        output.push_str(bos);
        output.push('\n');
    }

    match arch_lower.as_str() {
        "llama" | "mistral" | "llama3" => {
            // Llama-2/Mistral style: [INST] ... [/INST]
            if let Some(sys) = system {
                output.push_str(&format!("<<SYS>>\n{}\n<</SYS>>\n\n", sys));
            }
            for msg in messages {
                match msg.role.as_str() {
                    "user" => {
                        output.push_str(&format!("[INST] {} [/INST]", msg.content));
                    }
                    "assistant" => {
                        output.push_str(&format!(" {}", msg.content));
                        if !eos.is_empty() {
                            output.push_str(eos);
                        }
                        output.push('\n');
                    }
                    _ => {
                        output.push_str(&format!("{}: {}", msg.role, msg.content));
                    }
                }
            }
        }
        "chatml" | "qwen" => {
            // ChatML style: <|im_start|>role\ncontent<|im_end|>\n
            if let Some(sys) = system {
                output.push_str(&format!("<|im_start|>system\n{}<|im_end|>\n", sys));
            }
            for msg in messages {
                output.push_str(&format!(
                    "<|im_start|>{}\n{}<|im_end|>\n",
                    msg.role, msg.content
                ));
            }
            output.push_str("<|im_start|>assistant\n");
        }
        "gemma" | "gemma2" => {
            // Gemma style: <start_of_turn>role\ncontent<end_of_turn>\n
            if let Some(sys) = system {
                output.push_str(&format!("<start_of_turn>system\n{}<end_of_turn>\n", sys));
            }
            for msg in messages {
                output.push_str(&format!(
                    "<start_of_turn>{}\n{}<end_of_turn>\n",
                    msg.role, msg.content
                ));
            }
            output.push_str("<start_of_turn>assistant\n");
        }
        "phi3" => {
            // Phi-3 style: <|user|>\ncontent<|end|>\n<|assistant|...\n
            if let Some(sys) = system {
                output.push_str(&format!("<|system|>\n{}<|end|>\n", sys));
            }
            for msg in messages {
                match msg.role.as_str() {
                    "user" => {
                        output.push_str(&format!("<|user|>\n{}<|end|>\n", msg.content));
                    }
                    "assistant" => {
                        output.push_str(&format!("<|assistant|/>\n{}<|end|>\n", msg.content));
                    }
                    _ => {
                        output.push_str(&format!("<|{}|>\n{}<|end|>\n", msg.role, msg.content));
                    }
                }
            }
            output.push_str("<|assistant|/>\n");
        }
        _ => {
            // Generic fallback: Role: Content
            warn!(
                "Unknown architecture '{}', using generic format",
                model_info.architecture
            );
            if let Some(sys) = system {
                output.push_str(&format!("System: {}\n\n", sys));
            }
            for msg in messages {
                output.push_str(&format!(
                    "{}: {}\n",
                    msg.role.chars().next().unwrap_or('?').to_uppercase(),
                    msg.content
                ));
            }
            output.push_str("Assistant: ");
        }
    }

    output
}

/// Count tokens in a conversation with detailed breakdown.
///
/// # Arguments
/// * `messages` - Chat messages to count
/// * `system` - Optional system prompt
/// * `model` - Loaded model for tokenization
/// * `model_info` - Model metadata for context length
///
/// # Returns
/// TokenCount with detailed breakdown
///
/// Note: This function is synchronous because llama-cpp-2 tokenization is synchronous.
/// Callers should wrap in spawn_blocking if needed from async context.
#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
pub fn count_message_tokens(
    messages: &[ChatMessage],
    system: Option<&str>,
    model: &llama_cpp_2::model::LlamaModel,
    model_info: &ModelInfo,
) -> Result<TokenCount, ModelError> {
    // Render with system prompt → total token count.
    // Token counting is independent of thinking mode, so pass None.
    let rendered_with_system = render_chat_template(messages, system, model, model_info, None)?;
    let total = count_tokens(&rendered_with_system, model)?;

    // Isolate system tokens by comparing render with/without system prompt.
    // This captures both the raw system text AND the template formatting overhead
    // (e.g. <<SYS>> markers, role tags, etc.), unlike counting raw text alone.
    let system_tokens = if system.is_some() {
        let rendered_without_system =
            render_chat_template(messages, None, model, model_info, None)?;
        let without_system = count_tokens(&rendered_without_system, model)?;
        total.saturating_sub(without_system)
    } else {
        0
    };

    // Message tokens = everything that isn't the system prompt
    let message_tokens = total.saturating_sub(system_tokens);

    // Calculate budget and usage
    let budget = get_context_budget(model_info.context_length, 0.10);
    let remaining_budget = budget.saturating_sub(total);
    let percentage_used = (total as f32 / model_info.context_length as f32) * 100.0;

    Ok(TokenCount {
        total,
        system_tokens,
        message_tokens,
        remaining_budget,
        percentage_used,
        is_near_limit: percentage_used > 80.0,
        is_over_limit: percentage_used >= 100.0,
    })
}

#[cfg(not(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
)))]
pub fn count_message_tokens(
    _messages: &[ChatMessage],
    _system: Option<&str>,
    _model: &(),
    _model_info: &ModelInfo,
) -> Result<TokenCount, ModelError> {
    Err(ModelError::ModelNotLoaded)
}
