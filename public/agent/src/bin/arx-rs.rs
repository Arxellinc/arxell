use arx_rs::events::Event;
use arx_rs::provider::mock::MockProvider;
use arx_rs::provider::openai_compatible::OpenAiCompatibleProvider;
use arx_rs::provider::{Provider, ProviderConfig};
use arx_rs::types::{ContentPart, Message};
use arx_rs::{Agent, AgentConfig, Session};

fn arg_value(args: &[String], key: &str) -> Option<String> {
    args.windows(2)
        .find_map(|w| (w[0] == key).then(|| w[1].clone()))
}

fn has_flag(args: &[String], key: &str) -> bool {
    args.iter().any(|a| a == key)
}

fn usage() {
    eprintln!(
        "Usage: arx-rs [--provider openai-compatible|mock] [--model MODEL] [--base-url URL] [--api-key KEY] [--max-turns N] [--events] [PROMPT]\n\
         Defaults:\n\
         - provider=openai-compatible\n\
         - base-url=http://127.0.0.1:8765\n\
         - model=gpt-4.1\n\
         - max-turns=8"
    );
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if has_flag(&args, "--help") || has_flag(&args, "-h") {
        usage();
        return;
    }

    let provider_name =
        arg_value(&args, "--provider").unwrap_or_else(|| "openai-compatible".to_string());

    let model = arg_value(&args, "--model").unwrap_or_else(|| "gpt-4.1".to_string());
    let base_url =
        arg_value(&args, "--base-url").or_else(|| Some("http://127.0.0.1:8765".to_string()));
    let api_key = arg_value(&args, "--api-key").or_else(|| std::env::var("OPENAI_API_KEY").ok());
    let max_turns = arg_value(&args, "--max-turns")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(8);

    let print_events = has_flag(&args, "--events");

    let mut prompt_parts = Vec::new();
    let mut i = 1usize;
    while i < args.len() {
        match args[i].as_str() {
            "--provider" | "--model" | "--base-url" | "--api-key" | "--max-turns" => {
                i += 2;
            }
            "--events" => {
                i += 1;
            }
            x if x.starts_with("--") => {
                i += 1;
            }
            _ => {
                prompt_parts.push(args[i].clone());
                i += 1;
            }
        }
    }
    let prompt = prompt_parts.join(" ");

    let prompt = if prompt.trim().is_empty() {
        "Describe this project and suggest next steps".to_string()
    } else {
        prompt
    };

    let provider: Box<dyn Provider> = match provider_name.as_str() {
        "mock" => Box::new(MockProvider::default()),
        "openai-compatible" | "openai" => Box::new(OpenAiCompatibleProvider::new(ProviderConfig {
            api_key,
            base_url,
            model: model.clone(),
            max_tokens: 8192,
            temperature: None,
            thinking_level: "medium".to_string(),
            provider: Some("openai-compatible".to_string()),
        })),
        other => {
            eprintln!(
                "Unknown provider '{}', supported: openai-compatible, mock. Using openai-compatible.",
                other
            );
            Box::new(OpenAiCompatibleProvider::new(ProviderConfig {
                api_key,
                base_url,
                model: model.clone(),
                max_tokens: 8192,
                temperature: None,
                thinking_level: "medium".to_string(),
                provider: Some("openai-compatible".to_string()),
            }))
        }
    };

    let session = Session::in_memory(".".to_string(), None, None, "medium".to_string());
    let mut agent = Agent::new(
        provider,
        arx_rs::tools::default_tools(),
        session,
        AgentConfig {
            max_turns: Some(max_turns),
            context_window: None,
            max_output_tokens: None,
        },
        None,
    )
    .expect("failed to create agent");

    let events = agent.run_collect(prompt, None, None).await;

    if print_events {
        for event in events {
            println!("{:?}", event);
        }
        return;
    }

    for event in events {
        match event {
            Event::TextDelta { delta } => print!("{}", delta),
            Event::ToolEnd {
                tool_name, display, ..
            } => {
                if !display.is_empty() {
                    eprintln!("\n[tool:{}] {}", tool_name, display);
                } else {
                    eprintln!("\n[tool:{}]", tool_name);
                }
            }
            Event::TurnEnd {
                assistant_message,
                tool_results,
                stop_reason,
                ..
            } => {
                if let Some(Message::Assistant { content, .. }) = assistant_message {
                    let has_text = content
                        .iter()
                        .any(|p| matches!(p, ContentPart::Text { .. }));
                    if !has_text {
                        println!();
                    }
                }

                for tr in tool_results {
                    if let Message::ToolResult {
                        tool_name,
                        content,
                        is_error,
                        ..
                    } = tr
                    {
                        let text = content
                            .into_iter()
                            .filter_map(|c| match c {
                                ContentPart::Text { text } => Some(text),
                                _ => None,
                            })
                            .collect::<Vec<_>>()
                            .join("\n");
                        if !text.trim().is_empty() {
                            eprintln!(
                                "\n[tool-result:{}:{}]\n{}",
                                tool_name,
                                if is_error { "error" } else { "ok" },
                                text
                            );
                        }
                    }
                }
                eprintln!("\n[stop_reason={:?}]", stop_reason);
            }
            Event::Error { error } => {
                eprintln!("\n[error]\n{}", error);
            }
            _ => {}
        }
    }
}
