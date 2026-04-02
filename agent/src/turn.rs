use serde_json::{Map, Value};

use crate::events::Event;
use crate::provider::Provider;
use crate::tools::{tool_by_name, tool_definitions, Tool};
use crate::types::{ContentPart, Message, StopReason, ToolResult, UserContent};

const TOOL_ARGS_TOKEN_DISPLAY_THRESHOLD: i64 = 20;
const TOOL_ARGS_TOKEN_CHUNK_UPDATE_INTERVAL: i64 = 4;

#[derive(Debug)]
struct PendingToolCall {
    id: String,
    name: String,
    arguments: Value,
}

#[derive(Debug)]
pub struct TurnOutcome {
    pub events: Vec<Event>,
    pub assistant_message: Option<Message>,
    pub tool_results: Vec<Message>,
    pub stop_reason: StopReason,
    pub interrupted: bool,
}

fn push_event<F: FnMut(&Event) + Send>(events: &mut Vec<Event>, on_event: &mut F, event: Event) {
    events.push(event);
    if let Some(last) = events.last() {
        on_event(last);
    }
}

fn count_tokens(text: &str) -> i64 {
    (text.len() / 4) as i64
}

pub async fn run_single_turn<F: FnMut(&Event) + Send>(
    provider: &dyn Provider,
    messages: Vec<Message>,
    tools: &[Box<dyn Tool>],
    system_prompt: Option<String>,
    turn: i64,
    cancel: Option<tokio::sync::watch::Receiver<bool>>,
    retry_delays: Option<Vec<i64>>,
    on_event: &mut F,
) -> TurnOutcome {
    let mut events = Vec::new();
    let mut content: Vec<ContentPart> = Vec::new();
    let mut tool_results: Vec<Message> = Vec::new();

    if let Some(c) = &cancel {
        if *c.borrow() {
            push_event(
                &mut events,
                on_event,
                Event::Interrupted {
                    message: "Interrupted by user".to_string(),
                },
            );
            push_event(
                &mut events,
                on_event,
                Event::TurnEnd {
                    turn,
                    assistant_message: None,
                    tool_results: vec![],
                    stop_reason: StopReason::Interrupted,
                },
            );
            return TurnOutcome {
                events,
                assistant_message: None,
                tool_results: vec![],
                stop_reason: StopReason::Interrupted,
                interrupted: true,
            };
        }
    }

    let tool_defs = tool_definitions(tools);
    let provider_tools = if tool_defs.is_empty() {
        None
    } else {
        Some(tool_defs.clone())
    };

    let delays = retry_delays.unwrap_or_else(|| vec![2, 4, 8]);
    let mut stream = None;

    for (attempt, delay_opt) in delays
        .iter()
        .copied()
        .map(Some)
        .chain(std::iter::once(None))
        .enumerate()
    {
        match provider
            .stream(
                messages.clone(),
                system_prompt.clone(),
                provider_tools.clone(),
                None,
                None,
            )
            .await
        {
            Ok(s) => {
                stream = Some(s);
                break;
            }
            Err(e) => {
                if provider.should_retry_for_error(&e) {
                    if let Some(delay) = delay_opt {
                        push_event(
                            &mut events,
                            on_event,
                            Event::Retry {
                                attempt: attempt as i64 + 1,
                                total_attempts: delays.len() as i64,
                                delay: delay as f64,
                                error: e,
                            },
                        );
                        tokio::time::sleep(std::time::Duration::from_secs(delay as u64)).await;
                        continue;
                    }
                }
                push_event(&mut events, on_event, Event::Error { error: e });
                push_event(
                    &mut events,
                    on_event,
                    Event::TurnEnd {
                        turn,
                        assistant_message: None,
                        tool_results: vec![],
                        stop_reason: StopReason::Error,
                    },
                );
                return TurnOutcome {
                    events,
                    assistant_message: None,
                    tool_results: vec![],
                    stop_reason: StopReason::Error,
                    interrupted: false,
                };
            }
        }
    }

    let mut stream = match stream {
        Some(s) => s,
        None => {
            push_event(
                &mut events,
                on_event,
                Event::Error {
                    error: "provider stream unavailable".to_string(),
                },
            );
            push_event(
                &mut events,
                on_event,
                Event::TurnEnd {
                    turn,
                    assistant_message: None,
                    tool_results: vec![],
                    stop_reason: StopReason::Error,
                },
            );
            return TurnOutcome {
                events,
                assistant_message: None,
                tool_results: vec![],
                stop_reason: StopReason::Error,
                interrupted: false,
            };
        }
    };

    let mut pending_raw: Vec<(String, String, String)> = Vec::new();
    let mut current_tool: Option<(String, String, String)> = None; // id, name, args string

    let mut think_open = false;
    let mut text_open = false;
    let mut think_buf = String::new();
    let mut text_buf = String::new();

    let mut stop_reason = StopReason::Stop;
    let mut interrupted = false;
    let mut tool_arg_chunk_counter = 0i64;
    let mut tool_arg_token_count = 0i64;

    use futures_util::StreamExt;
    while let Some(part) = stream.stream.next().await {
        if let Some(c) = &cancel {
            if *c.borrow() {
                interrupted = true;
                stop_reason = StopReason::Interrupted;
                break;
            }
        }

        let part = match part {
            Ok(p) => p,
            Err(e) => {
                push_event(&mut events, on_event, Event::Error { error: e });
                stop_reason = StopReason::Error;
                break;
            }
        };

        match part {
            crate::types::StreamPart::Think { think, signature } => {
                if text_open {
                    push_event(
                        &mut events,
                        on_event,
                        Event::TextEnd {
                            text: text_buf.clone(),
                        },
                    );
                    content.push(ContentPart::Text {
                        text: text_buf.clone(),
                    });
                    text_open = false;
                    text_buf.clear();
                }
                if current_tool.is_some() {
                    pending_raw.push(current_tool.take().expect("checked"));
                }
                if !think_open {
                    push_event(&mut events, on_event, Event::ThinkingStart);
                }
                think_open = true;
                think_buf.push_str(&think);
                push_event(
                    &mut events,
                    on_event,
                    Event::ThinkingDelta {
                        delta: think.clone(),
                    },
                );
                if let Some(sig) = signature {
                    let _ = sig;
                }
            }
            crate::types::StreamPart::Text { text } => {
                if think_open {
                    push_event(
                        &mut events,
                        on_event,
                        Event::ThinkingEnd {
                            thinking: think_buf.clone(),
                            signature: None,
                        },
                    );
                    content.push(ContentPart::Thinking {
                        thinking: think_buf.clone(),
                        signature: None,
                    });
                    think_open = false;
                    think_buf.clear();
                }
                if current_tool.is_some() {
                    pending_raw.push(current_tool.take().expect("checked"));
                }
                if !text_open {
                    push_event(&mut events, on_event, Event::TextStart);
                }
                text_open = true;
                text_buf.push_str(&text);
                push_event(&mut events, on_event, Event::TextDelta { delta: text });
            }
            crate::types::StreamPart::ToolCallStart { id, name, .. } => {
                if think_open {
                    push_event(
                        &mut events,
                        on_event,
                        Event::ThinkingEnd {
                            thinking: think_buf.clone(),
                            signature: None,
                        },
                    );
                    content.push(ContentPart::Thinking {
                        thinking: think_buf.clone(),
                        signature: None,
                    });
                    think_open = false;
                    think_buf.clear();
                }
                if text_open {
                    push_event(
                        &mut events,
                        on_event,
                        Event::TextEnd {
                            text: text_buf.clone(),
                        },
                    );
                    content.push(ContentPart::Text {
                        text: text_buf.clone(),
                    });
                    text_open = false;
                    text_buf.clear();
                }
                if let Some(prev) = current_tool.take() {
                    pending_raw.push(prev);
                }

                tool_arg_chunk_counter = 0;
                tool_arg_token_count = 0;
                current_tool = Some((id.clone(), name.clone(), String::new()));
                push_event(
                    &mut events,
                    on_event,
                    Event::ToolStart {
                        tool_call_id: id,
                        tool_name: name,
                    },
                );
            }
            crate::types::StreamPart::ToolCallDelta {
                arguments_delta, ..
            } => {
                if let Some((id, name, args)) = &mut current_tool {
                    args.push_str(&arguments_delta);
                    push_event(
                        &mut events,
                        on_event,
                        Event::ToolArgsDelta {
                            tool_call_id: id.clone(),
                            delta: arguments_delta.clone(),
                        },
                    );
                    tool_arg_chunk_counter += 1;
                    tool_arg_token_count += count_tokens(&arguments_delta);
                    if tool_arg_token_count > TOOL_ARGS_TOKEN_DISPLAY_THRESHOLD
                        && tool_arg_chunk_counter % TOOL_ARGS_TOKEN_CHUNK_UPDATE_INTERVAL == 0
                    {
                        push_event(
                            &mut events,
                            on_event,
                            Event::ToolArgsTokenUpdate {
                                tool_call_id: id.clone(),
                                tool_name: name.clone(),
                                token_count: tool_arg_token_count,
                            },
                        );
                    }
                }
            }
            crate::types::StreamPart::Done { stop_reason: r } => {
                stop_reason = r;
                break;
            }
            crate::types::StreamPart::Error { error } => {
                push_event(&mut events, on_event, Event::Error { error });
                stop_reason = StopReason::Error;
                break;
            }
        }
    }

    if think_open {
        push_event(
            &mut events,
            on_event,
            Event::ThinkingEnd {
                thinking: think_buf.clone(),
                signature: None,
            },
        );
        content.push(ContentPart::Thinking {
            thinking: think_buf,
            signature: None,
        });
    }
    if text_open {
        push_event(
            &mut events,
            on_event,
            Event::TextEnd {
                text: text_buf.clone(),
            },
        );
        content.push(ContentPart::Text { text: text_buf });
    }
    if let Some(t) = current_tool.take() {
        pending_raw.push(t);
    }

    let mut pending: Vec<PendingToolCall> = Vec::new();
    for (id, name, args) in pending_raw {
        let arguments = serde_json::from_str::<Value>(&args)
            .ok()
            .filter(|v| v.is_object())
            .unwrap_or_else(|| Value::Object(Map::new()));

        let display = tool_by_name(tools, &name)
            .map(|t| t.format_call(&arguments))
            .unwrap_or_default();

        push_event(
            &mut events,
            on_event,
            Event::ToolEnd {
                tool_call_id: id.clone(),
                tool_name: name.clone(),
                arguments: arguments.clone(),
                display: display.clone(),
            },
        );

        pending.push(PendingToolCall {
            id,
            name,
            arguments,
        });
    }

    for p in &pending {
        let mut args_map = std::collections::HashMap::new();
        if let Value::Object(obj) = &p.arguments {
            for (k, v) in obj {
                args_map.insert(k.clone(), v.clone());
            }
        }
        content.push(ContentPart::ToolCall {
            id: p.id.clone(),
            name: p.name.clone(),
            arguments: args_map,
        });
    }

    for p in pending {
        let res = if interrupted {
            ToolResult {
                success: false,
                result: Some("Interrupted by user".to_string()),
                images: None,
                display: Some("Interrupted by user".to_string()),
            }
        } else if let Some(tool) = tool_by_name(tools, &p.name) {
            tool.execute(p.arguments.clone(), cancel.clone()).await
        } else {
            ToolResult {
                success: false,
                result: Some(format!("Unknown tool: {}", p.name)),
                images: None,
                display: Some(format!("Unknown tool: {}", p.name)),
            }
        };

        push_event(
            &mut events,
            on_event,
            Event::ToolResult {
                tool_call_id: p.id.clone(),
                tool_name: p.name.clone(),
                result: Some(res.clone()),
            },
        );

        let text = res
            .result
            .clone()
            .unwrap_or_else(|| "(no output)".to_string());
        tool_results.push(Message::ToolResult {
            tool_call_id: p.id,
            tool_name: p.name,
            content: vec![ContentPart::Text { text }],
            display: res.display,
            is_error: !res.success,
        });
    }

    if interrupted {
        push_event(
            &mut events,
            on_event,
            Event::Interrupted {
                message: "Interrupted by user".to_string(),
            },
        );
    }

    let assistant_message = Message::Assistant {
        content,
        usage: Some(stream.usage.clone()),
        stop_reason: Some(stop_reason),
    };

    push_event(
        &mut events,
        on_event,
        Event::TurnEnd {
            turn,
            assistant_message: Some(assistant_message.clone()),
            tool_results: tool_results.clone(),
            stop_reason,
        },
    );

    TurnOutcome {
        events,
        assistant_message: Some(assistant_message),
        tool_results,
        stop_reason,
        interrupted,
    }
}

pub fn text_message(s: impl Into<String>) -> Message {
    Message::User {
        content: UserContent::Text(s.into()),
    }
}
