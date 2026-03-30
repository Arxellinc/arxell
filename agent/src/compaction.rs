use crate::provider::Provider;
use crate::types::{ContentPart, Message, ToolDefinition, Usage};

pub fn is_overflow(
    usage: &Usage,
    context_window: i64,
    max_output_tokens: i64,
    buffer_tokens: i64,
) -> bool {
    let total = usage.input_tokens
        + usage.output_tokens
        + usage.cache_read_tokens
        + usage.cache_write_tokens;
    let reserved = std::cmp::min(max_output_tokens, buffer_tokens);
    total >= (context_window - reserved)
}

pub async fn generate_summary(
    messages: Vec<Message>,
    provider: &dyn Provider,
    system_prompt: String,
) -> Result<String, String> {
    let prompt = Message::User {
        content: crate::types::UserContent::Text(
            "Summarize this conversation preserving key decisions, files, and pending work."
                .to_string(),
        ),
    };
    let mut msgs = messages;
    msgs.push(prompt);

    let mut stream = provider
        .stream(
            msgs,
            Some(system_prompt),
            Some(Vec::<ToolDefinition>::new()),
            None,
            Some(1024),
        )
        .await?;

    let mut summary = String::new();
    use futures_util::StreamExt;
    while let Some(part) = stream.stream.next().await {
        match part? {
            crate::types::StreamPart::Text { text } => summary.push_str(&text),
            crate::types::StreamPart::Think { think, .. } => summary.push_str(&think),
            _ => {}
        }
    }

    if summary.trim().is_empty() {
        summary = "Conversation summary unavailable; continue from recent context.".to_string();
    }

    Ok(summary)
}

pub fn synthetic_summary_message(summary: String) -> Message {
    Message::Assistant {
        content: vec![ContentPart::Text { text: summary }],
        usage: None,
        stop_reason: Some(crate::types::StopReason::Stop),
    }
}
