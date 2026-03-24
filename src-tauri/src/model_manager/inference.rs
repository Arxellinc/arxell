//! Local LLM streaming inference via llama-cpp-2
//!
//! `run_inference_stream` is the single public entry-point.  It:
//! 1. Renders the conversation through the model's chat template
//! 2. Tokenises the prompt
//! 3. Runs a token-by-token generation loop on a blocking thread
//! 4. Emits `local:token` events (String) for each decoded text fragment
//! 5. Emits `local:done` (unit) when generation finishes
//!
//! When no GPU backend feature flag is compiled in the function returns
//! an error immediately — no inference is possible without llama-cpp-2.

use std::sync::{atomic::AtomicBool, Arc};
use tauri::AppHandle;

use super::{
    config::GenerationConfig,
    types::{ChatMessage, ModelError, ModelInfo},
};

// The concrete model type differs between GPU and no-GPU builds.
#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
pub type ModelRef = Arc<llama_cpp_2::model::LlamaModel>;

#[cfg(not(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
)))]
pub type ModelRef = Arc<()>;

/// Run streaming token generation for a loaded model.
///
/// **Must be called from inside `tokio::task::spawn_blocking`** — llama-cpp-2
/// tokenisation and forward-pass are fully synchronous.
///
/// `enable_thinking` is forwarded to `render_chat_template`; pass `Some(false)`
/// to disable the reasoning block on thinking-capable models (e.g. GLM-4).
#[allow(clippy::too_many_arguments)]
pub fn run_inference_stream(
    model: ModelRef,
    model_info: &ModelInfo,
    gen_config: &GenerationConfig,
    messages: &[ChatMessage],
    system: Option<&str>,
    enable_thinking: Option<bool>,
    cancel: Arc<AtomicBool>,
    app: &AppHandle,
    assistant_msg_id: Option<&str>,
) -> Result<(), ModelError> {
    #[cfg(any(
        feature = "vulkan",
        feature = "cuda",
        feature = "metal",
        feature = "rocm"
    ))]
    return gpu::run(
        model,
        model_info,
        gen_config,
        messages,
        system,
        enable_thinking,
        cancel,
        app,
        assistant_msg_id,
    );

    #[cfg(not(any(
        feature = "vulkan",
        feature = "cuda",
        feature = "metal",
        feature = "rocm"
    )))]
    {
        let _ = (
            model,
            model_info,
            gen_config,
            messages,
            system,
            enable_thinking,
            cancel,
            app,
            assistant_msg_id,
        );
        Err(ModelError::LlamaCppError(
            "No inference backend compiled in. \
             Rebuild with --features cuda, metal, vulkan, or rocm."
                .to_string(),
        ))
    }
}

/// Expose the process-scoped `LlamaBackend` to `loader.rs` so both share the
/// same singleton and `llama_backend_init` / `llama_backend_free` run at most once.
#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
pub fn get_global_backend() -> Result<&'static llama_cpp_2::llama_backend::LlamaBackend, ModelError>
{
    gpu::get_global_backend_inner()
}

// ─── GPU-enabled implementation ──────────────────────────────────────────────

#[cfg(any(
    feature = "vulkan",
    feature = "cuda",
    feature = "metal",
    feature = "rocm"
))]
mod gpu {
    use std::num::NonZeroU32;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    };

    use log::warn;
    use tauri::{AppHandle, Emitter};

    use llama_cpp_2::{
        context::params::LlamaContextParams,
        llama_backend::LlamaBackend,
        llama_batch::LlamaBatch,
        model::{AddBos, LlamaModel},
    };

    use crate::model_manager::{
        config::GenerationConfig,
        tokenizer::render_chat_template,
        types::{ChatMessage, ModelError, ModelInfo},
    };

    /// Process-scoped llama.cpp backend.
    ///
    /// `LlamaBackend::init()` calls `llama_backend_init()` which (for GPU
    /// backends) initialises the Vulkan/CUDA/Metal instance.  The matching
    /// `llama_backend_free()` runs in `Drop`.  Creating and dropping the
    /// backend on every inference call repeatedly init/frees the GPU
    /// instance, leaking driver resources and eventually causing OOM or
    /// crashes.  A `OnceLock` guarantees init runs exactly once and the
    /// backend lives until the process exits.
    struct BackendHolder(LlamaBackend);
    // SAFETY: llama_backend_init/free are guarded by the OnceLock so they
    // run at most once each.  The backend itself holds no thread-local state.
    unsafe impl Send for BackendHolder {}
    unsafe impl Sync for BackendHolder {}

    static LLAMA_BACKEND: OnceLock<BackendHolder> = OnceLock::new();

    fn get_backend() -> Result<&'static LlamaBackend, ModelError> {
        LLAMA_BACKEND
            .get_or_try_init(|| {
                LlamaBackend::init()
                    .map(BackendHolder)
                    .map_err(|e| ModelError::LlamaCppError(format!("Backend init failed: {}", e)))
            })
            .map(|h| &h.0)
    }

    /// Public entry-point for `loader.rs` to reuse the same backend singleton.
    pub fn get_global_backend_inner() -> Result<&'static LlamaBackend, ModelError> {
        get_backend()
    }

    pub fn run(
        model: Arc<LlamaModel>,
        model_info: &ModelInfo,
        gen_config: &GenerationConfig,
        messages: &[ChatMessage],
        system: Option<&str>,
        enable_thinking: Option<bool>,
        cancel: Arc<AtomicBool>,
        app: &AppHandle,
        assistant_msg_id: Option<&str>,
    ) -> Result<(), ModelError> {
        let backend = get_backend()?;

        // ── Prompt ────────────────────────────────────────────────────────────

        let prompt = render_chat_template(messages, system, &model, model_info, enable_thinking)?;

        // ── Tokenise ──────────────────────────────────────────────────────────

        let input_tokens = model
            .str_to_token(&prompt, AddBos::Always)
            .map_err(|e| ModelError::LlamaCppError(format!("Tokenisation failed: {:?}", e)))?;

        if input_tokens.is_empty() {
            return Err(ModelError::LlamaCppError(
                "Empty prompt produced no tokens".to_string(),
            ));
        }

        // ── Context ───────────────────────────────────────────────────────────

        let ctx_size = NonZeroU32::new(model_info.context_length)
            .unwrap_or_else(|| NonZeroU32::new(4096).unwrap());

        let mut ctx = model
            .new_context(
                &backend,
                LlamaContextParams::default().with_n_ctx(Some(ctx_size)),
            )
            .map_err(|e| ModelError::LlamaCppError(format!("Context creation failed: {:?}", e)))?;

        // ── Sampler ───────────────────────────────────────────────────────────

        let mut sampler = gen_config.build_sampler(model_info.vocab_size as usize);

        // ── Initial batch (prefill) ───────────────────────────────────────────

        let mut batch = LlamaBatch::new(input_tokens.len(), 1);
        let last_idx = input_tokens.len() - 1;
        for (i, &token) in input_tokens.iter().enumerate() {
            batch
                .add(token, i as i32, &[0], i == last_idx)
                .map_err(|e| ModelError::LlamaCppError(format!("Batch fill failed: {:?}", e)))?;
        }

        ctx.decode(&mut batch)
            .map_err(|e| ModelError::LlamaCppError(format!("Prefill decode failed: {:?}", e)))?;

        // ── Generation loop ───────────────────────────────────────────────────

        let mut n_cur = batch.n_tokens();
        let max_new = gen_config.max_new_tokens as i32;
        let ctx_limit = ctx_size.get() as i32;
        let mut generated = String::new();
        let mut byte_buf: Vec<u8> = Vec::new(); // accumulate partial UTF-8

        loop {
            // External cancellation (user pressed Stop)
            if cancel.load(Ordering::Relaxed) {
                break;
            }

            // Guard: context length and max-new-tokens
            let new_token_count = n_cur - input_tokens.len() as i32;
            if n_cur >= ctx_limit || new_token_count >= max_new {
                break;
            }

            // Sample
            let new_token = sampler.sample(&ctx, -1);
            sampler.accept(new_token);

            if model.is_eog_token(new_token) {
                break;
            }

            // Decode bytes, accumulate to handle multi-byte UTF-8 correctly
            match model.token_to_piece_bytes(new_token, 8, true, None) {
                Ok(bytes) => {
                    byte_buf.extend_from_slice(&bytes);
                    match std::str::from_utf8(&byte_buf) {
                        Ok(text) => {
                            let text = text.to_string();
                            byte_buf.clear();

                            generated.push_str(&text);

                            // Stop-sequence check
                            let stop = gen_config
                                .stop_sequences
                                .iter()
                                .any(|seq| generated.ends_with(seq.as_str()));

                            if let Err(e) = app.emit("local:token", &text) {
                                warn!("Failed to emit local:token: {}", e);
                            }
                            if let Some(id) = assistant_msg_id {
                                let _ = app.emit(
                                    "chat:chunk",
                                    serde_json::json!({
                                        "id": id,
                                        "delta": text,
                                        "done": false,
                                    }),
                                );
                            }

                            if stop {
                                break;
                            }
                        }
                        Err(_) => { /* partial multi-byte — keep accumulating */ }
                    }
                }
                Err(e) => {
                    warn!("token_to_bytes failed for token {}: {:?}", new_token.0, e);
                }
            }

            // Advance batch
            batch.clear();
            batch
                .add(new_token, n_cur, &[0], true)
                .map_err(|e| ModelError::LlamaCppError(format!("Batch advance failed: {:?}", e)))?;

            ctx.decode(&mut batch)
                .map_err(|e| ModelError::LlamaCppError(format!("Decode step failed: {:?}", e)))?;

            n_cur += 1;
        }

        // Flush any remaining partial UTF-8 bytes
        if !byte_buf.is_empty() {
            let tail = String::from_utf8_lossy(&byte_buf).to_string();
            let _ = app.emit("local:token", tail.as_str());
            if let Some(id) = assistant_msg_id {
                let _ = app.emit(
                    "chat:chunk",
                    serde_json::json!({
                        "id": id,
                        "delta": tail,
                        "done": false,
                    }),
                );
            }
        }

        let _ = app.emit("local:done", ());
        if let Some(id) = assistant_msg_id {
            let was_cancelled = cancel.load(Ordering::Relaxed);
            if !was_cancelled {
                let _ = app.emit(
                    "chat:chunk",
                    serde_json::json!({
                        "id": id,
                        "delta": "",
                        "done": true,
                    }),
                );
            }
        }
        Ok(())
    }
}
