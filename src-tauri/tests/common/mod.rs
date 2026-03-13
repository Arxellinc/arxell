//! Shared constants, helpers, and fixtures for all model-manager integration tests.
//!
//! Every test file begins with:
//!   #[path = "common/mod.rs"] mod common;

#![allow(dead_code)] // Items are used selectively across multiple test binaries

// ── Test fixture paths ────────────────────────────────────────────────────────

/// Real GGUF model file used by all GPU-gated tests.
pub const MODEL_PATH: &str = "/home/user/models/GLM-4.7-Flash-Q4_1.gguf";

// ── Default skill content (mirrors seed_default_skills in commands/skills.rs) ─

/// Content of the seeded `personality.md` skill.
pub const PERSONALITY_SKILL_CONTENT: &str = "\
# Personality

You are friendly, curious, and thoughtful. You communicate clearly and adapt your tone to match the user's needs.

- Be direct when discussing technical topics
- Use examples and analogies to explain complex concepts
- Acknowledge uncertainty when appropriate
- Ask clarifying questions when the request is ambiguous
";

/// Content of the seeded `directives.md` always-active skill.
pub const DIRECTIVES_SKILL_CONTENT: &str = "\
# Directives

You are a helpful AI assistant with access to tools for reading and writing files in the user's workspace. Be concise, accurate, and helpful.

When writing code or creating files, always use the write_to_file tool rather than pasting content into chat. Write complete, working code without placeholders.
";

/// Content of the seeded `browser.md` skill.
pub const BROWSER_SKILL_CONTENT: &str = "\
# Browser

You can browse the web to research topics, look up documentation, verify facts, and read articles using the browser_fetch tool.

## Tool: browser_fetch

Fetch and read any web page:

<browser_fetch>
<url>https://example.com/page</url>
<mode>markdown</mode>
</browser_fetch>
";

// ── Mode system prompts (mirrors src/lib/modes.ts) ───────────────────────────
//
// These are the exact prompts injected into every conversation by each chat
// mode.  Keeping them here lets us measure — in actual model tokens — how much
// of the context window each mode consumes before any user message is added.

pub const CHAT_SYSTEM_PROMPT: &str =
    "You are Arxell, a helpful AI assistant. Be concise and clear.";

pub const CODE_SYSTEM_PROMPT: &str = "\
You are Arxell in Code mode — an expert software engineer.

Rules:
- Write complete, runnable code. Never truncate with comments like \"// rest of code here\".
- Always use write_to_file for any code, scripts, or config output — never paste code into chat.
- Use the correct file extension and language for every file.
- Add comments only where the logic is non-obvious; prefer self-documenting names.
- When fixing a bug, identify the root cause before writing the fix.
- For multi-file changes, write all files before summarising what was done.";

pub const ARCHITECT_SYSTEM_PROMPT: &str = "\
You are Arxell in Architect mode — a senior systems architect.

Behaviour:
- Think at the system level: components, interfaces, data flows, and tradeoffs.
- Produce concrete artifacts via write_to_file: ADRs, Mermaid diagrams, API contracts, \
data models, and specs.
- Always reason about scalability, reliability, security, maintainability, and cost.
- Ask clarifying questions about constraints and non-functional requirements before \
proposing solutions.
- Prefer the simplest design that meets the requirements; justify every added component.
- When reviewing existing architecture, identify risks and improvement areas explicitly.";

pub const AUTO_SYSTEM_PROMPT: &str = "\
You are Arxell in Autonomous mode — an autonomous AI agent.

Operating procedure:
1. Decompose the task into a clear, ordered list of steps and state them upfront.
2. Execute each step in sequence using write_to_file and read_file tools.
3. After writing code, read it back to verify correctness before moving on.
4. If a step produces an unexpected result, diagnose the cause and self-correct.
5. Work to completion without waiting for user feedback unless a decision genuinely requires it.
6. Briefly report what was accomplished after each major step.
7. Prefer small, verifiable increments over large one-shot changes.

Guardrails:
- Never delete or overwrite files without stating the intention in your response first.
- If the task is ambiguous, state your assumptions explicitly before proceeding.";

/// The always-active directives skill (seeded by skills.rs)
pub const TOOL_SKILL_PROMPT: &str = "\
You have access to two file-system tools you can call at any time.

write_to_file — create or overwrite a file:
<write_to_file>
<path>relative/path/to/file.ext</path>
<content>
file contents here
</content>
</write_to_file>

read_file — read a file back:
<read_file>
<path>relative/path/to/file.ext</path>
</read_file>

Rules:
- Always use write_to_file for code; never paste code blocks directly into chat.
- File paths are relative to the active workspace root.
- After writing a file you may read it back to verify the contents.";

// ── Message factories ─────────────────────────────────────────────────────────

use arx_lib::model_manager::types::ChatMessage;

pub fn user_msg(content: &str) -> ChatMessage {
    ChatMessage {
        role: "user".into(),
        content: content.into(),
    }
}

pub fn assistant_msg(content: &str) -> ChatMessage {
    ChatMessage {
        role: "assistant".into(),
        content: content.into(),
    }
}

/// A realistic multi-turn conversation for context-budget tests.
pub fn sample_conversation() -> Vec<ChatMessage> {
    vec![
        user_msg("What is the difference between a stack and a queue?"),
        assistant_msg(
            "A stack is LIFO (Last In, First Out) — the last element pushed is the \
             first popped. A queue is FIFO (First In, First Out) — the first element \
             enqueued is the first dequeued. Stacks are used for function call frames \
             and undo history; queues for task scheduling and BFS traversal.",
        ),
        user_msg("Can you show a Rust implementation of a stack?"),
        assistant_msg(
            "<write_to_file>\n<path>stack.rs</path>\n<content>\n\
             pub struct Stack<T> {\n    data: Vec<T>,\n}\nimpl<T> Stack<T> {\n    \
             pub fn new() -> Self { Self { data: Vec::new() } }\n    \
             pub fn push(&mut self, v: T) { self.data.push(v); }\n    \
             pub fn pop(&mut self) -> Option<T> { self.data.pop() }\n    \
             pub fn peek(&self) -> Option<&T> { self.data.last() }\n    \
             pub fn is_empty(&self) -> bool { self.data.is_empty() }\n}\
             \n</content>\n</write_to_file>",
        ),
        user_msg("Now add a size() method and update the implementation."),
    ]
}

// ── GPU-gated test model loading ──────────────────────────────────────────────

#[cfg(feature = "vulkan")]
pub mod gpu {
    use std::num::NonZeroU32;
    use std::path::Path;
    use std::sync::{Mutex, OnceLock};

    use llama_cpp_2::{
        context::params::LlamaContextParams,
        llama_backend::LlamaBackend,
        model::params::LlamaModelParams,
        model::{AddBos, LlamaModel},
    };

    use arx_lib::model_manager::config::GenerationConfig;
    use arx_lib::model_manager::tokenizer::render_chat_template;
    use arx_lib::model_manager::types::{ChatMessage, ModelInfo};

    use super::MODEL_PATH;

    // ── Shared model (loaded once, reused across all tests in a binary) ───────

    struct Holder {
        backend: LlamaBackend,
        model: LlamaModel,
    }
    // SAFETY: llama_model weights are read-only after loading; multiple contexts
    // can be created concurrently from the same model handle.
    unsafe impl Send for Holder {}
    unsafe impl Sync for Holder {}

    static HOLDER: OnceLock<Mutex<Holder>> = OnceLock::new();

    fn get_holder() -> std::sync::MutexGuard<'static, Holder> {
        HOLDER
            .get_or_init(|| {
                let backend = LlamaBackend::init().expect("llama backend init");
                let params = LlamaModelParams::default().with_n_gpu_layers(999); // offload all layers; falls back to CPU if no GPU
                let model = LlamaModel::load_from_file(&backend, Path::new(MODEL_PATH), &params)
                    .expect("model load failed — is MODEL_PATH correct?");
                Mutex::new(Holder { backend, model })
            })
            .lock()
            .unwrap()
    }

    /// Tokenise `text` with the shared model, returning the token count.
    pub fn token_count(text: &str) -> usize {
        let h = get_holder();
        h.model
            .str_to_token(text, AddBos::Never)
            .expect("tokenisation failed")
            .len()
    }

    /// Render a chat template and return the resulting string.
    ///
    /// Uses `enable_thinking = None` (model default).
    pub fn render_template(
        messages: &[ChatMessage],
        system: Option<&str>,
        model_info: &ModelInfo,
    ) -> String {
        render_template_with_thinking(messages, system, model_info, None)
    }

    /// Render a chat template with an explicit `enable_thinking` override.
    ///
    /// Pass `Some(false)` to disable the reasoning block on GLM-4 and similar
    /// thinking-capable models.
    pub fn render_template_with_thinking(
        messages: &[ChatMessage],
        system: Option<&str>,
        model_info: &ModelInfo,
        enable_thinking: Option<bool>,
    ) -> String {
        let h = get_holder();
        render_chat_template(messages, system, &h.model, model_info, enable_thinking)
            .expect("template render failed")
    }

    /// Generate up to `max_tokens` new tokens from `prompt`.
    /// Returns the decoded text as a String.
    /// CPU inference on an 18GB model is slow — keep max_tokens tiny (<= 30).
    pub fn generate(prompt: &str, max_tokens: i32, stop_sequences: &[&str]) -> String {
        let h = get_holder();
        let backend = &h.backend;
        let model = &h.model;

        let input = model
            .str_to_token(prompt, AddBos::Always)
            .expect("tokenise prompt");

        let ctx_params =
            LlamaContextParams::default().with_n_ctx(Some(NonZeroU32::new(4096).unwrap()));
        let mut ctx = model
            .new_context(backend, ctx_params)
            .expect("create context");

        let mut batch = llama_cpp_2::llama_batch::LlamaBatch::new(input.len(), 1);
        for (i, &tok) in input.iter().enumerate() {
            batch
                .add(tok, i as i32, &[0], i == input.len() - 1)
                .unwrap();
        }
        ctx.decode(&mut batch).expect("prefill decode");

        let gen_config = GenerationConfig {
            temperature: 0.0, // greedy for determinism
            max_new_tokens: max_tokens as u32,
            seed: Some(42),
            ..GenerationConfig::default()
        };
        let mut sampler = gen_config.build_sampler(model.n_vocab() as usize);

        let mut output = String::new();
        let mut n_cur = batch.n_tokens();
        let mut byte_buf: Vec<u8> = Vec::new();

        loop {
            if (n_cur - input.len() as i32) >= max_tokens {
                break;
            }
            let token = sampler.sample(&ctx, -1);
            sampler.accept(token);

            if model.is_eog_token(token) {
                break;
            }

            if let Ok(bytes) = model.token_to_piece_bytes(token, 8, true, None) {
                byte_buf.extend_from_slice(&bytes);
                if let Ok(s) = std::str::from_utf8(&byte_buf) {
                    output.push_str(s);
                    byte_buf.clear();
                }
            }

            // Stop sequence check
            if stop_sequences.iter().any(|s| output.contains(s)) {
                break;
            }

            batch.clear();
            batch.add(token, n_cur, &[0], true).unwrap();
            ctx.decode(&mut batch).expect("decode step");
            n_cur += 1;
        }

        if !byte_buf.is_empty() {
            output.push_str(&String::from_utf8_lossy(&byte_buf));
        }

        output
    }

    /// Returns the number of tokens in the fully-rendered conversation.
    pub fn count_conversation_tokens(
        messages: &[ChatMessage],
        system: Option<&str>,
        model_info: &ModelInfo,
    ) -> u32 {
        let rendered = render_template(messages, system, model_info);
        token_count(&rendered) as u32
    }

    /// Returns the number of tokens with an explicit thinking-mode flag.
    pub fn count_conversation_tokens_with_thinking(
        messages: &[ChatMessage],
        system: Option<&str>,
        model_info: &ModelInfo,
        enable_thinking: Option<bool>,
    ) -> u32 {
        let rendered = render_template_with_thinking(messages, system, model_info, enable_thinking);
        token_count(&rendered) as u32
    }
}
