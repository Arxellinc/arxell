use chrono::Local;

use crate::compaction::{generate_summary, is_overflow};
use crate::context::agents::format_agents_files_for_prompt;
use crate::context::skills::format_skills_for_prompt;
use crate::context::Context;
use crate::events::Event;
use crate::provider::Provider;
use crate::session::{Session, SessionEntry};
use crate::tools::Tool;
use crate::turn::run_single_turn;
use crate::types::{ContentPart, Message, StopReason, Usage, UserContent};
use crate::{Config, KonResult};

#[derive(Debug, Clone)]
pub struct AgentConfig {
    pub max_turns: Option<i64>,
    pub context_window: Option<i64>,
    pub max_output_tokens: Option<i64>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            max_turns: None,
            context_window: None,
            max_output_tokens: None,
        }
    }
}

pub struct Agent {
    pub provider: Box<dyn Provider>,
    pub tools: Vec<Box<dyn Tool>>,
    pub session: Session,
    pub config: AgentConfig,
    pub cwd: String,
    pub context: Context,
    pub system_prompt: String,
    run_usage: Usage,
    app_config: Config,
}

impl Agent {
    fn push_event<F: FnMut(&Event) + Send>(events: &mut Vec<Event>, on_event: &mut F, event: Event) {
        events.push(event);
        if let Some(last) = events.last() {
            on_event(last);
        }
    }

    pub fn new(
        provider: Box<dyn Provider>,
        tools: Vec<Box<dyn Tool>>,
        session: Session,
        config: AgentConfig,
        cwd: Option<String>,
    ) -> KonResult<Self> {
        let cwd = cwd.unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .display()
                .to_string()
        });
        let context = Context::load(cwd.clone());
        let app_config = Config::load().unwrap_or_default();
        let system_prompt = build_system_prompt(&cwd, &context, &app_config);
        Ok(Self {
            provider,
            tools,
            session,
            config,
            cwd,
            context,
            system_prompt,
            run_usage: Usage::default(),
            app_config,
        })
    }

    pub fn reload_context(&mut self) {
        self.context = Context::load(self.cwd.clone());
        self.system_prompt = build_system_prompt(&self.cwd, &self.context, &self.app_config);
    }

    fn add_usage(&mut self, usage: Option<Usage>) {
        if let Some(u) = usage {
            self.run_usage.input_tokens += u.input_tokens;
            self.run_usage.output_tokens += u.output_tokens;
            self.run_usage.cache_read_tokens += u.cache_read_tokens;
            self.run_usage.cache_write_tokens += u.cache_write_tokens;
        }
    }

    pub async fn run_collect(
        &mut self,
        query: String,
        images: Option<Vec<(String, String)>>,
        cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> Vec<Event> {
        self.run_collect_inner(query, images, cancel, |_| {}).await
    }

    pub async fn run_collect_with_callback<F>(
        &mut self,
        query: String,
        images: Option<Vec<(String, String)>>,
        cancel: Option<tokio::sync::watch::Receiver<bool>>,
        mut on_event: F,
    ) -> Vec<Event>
    where
        F: FnMut(&Event) + Send,
    {
        self.run_collect_inner(query, images, cancel, &mut on_event)
            .await
    }

    async fn run_collect_inner<F: FnMut(&Event) + Send>(
        &mut self,
        query: String,
        images: Option<Vec<(String, String)>>,
        cancel: Option<tokio::sync::watch::Receiver<bool>>,
        mut on_event: F,
    ) -> Vec<Event> {
        self.run_usage = Usage::default();

        let user_message = if let Some(images) = images {
            let mut parts = vec![ContentPart::Text { text: query }];
            for (data, mime_type) in images {
                parts.push(ContentPart::Image { data, mime_type });
            }
            Message::User {
                content: UserContent::Parts(parts),
            }
        } else {
            Message::User {
                content: UserContent::Text(query),
            }
        };

        let mut events = Vec::new();
        Self::push_event(&mut events, &mut on_event, Event::AgentStart);
        let _ = self.session.append_message(user_message);

        let mut turn = 0i64;
        let mut stop_reason = StopReason::Stop;
        let max_turns = self
            .config
            .max_turns
            .unwrap_or(self.app_config.agent.max_turns);

        let mut hit_max_turns = false;
        while turn < max_turns {
            if let Some(c) = &cancel {
                if *c.borrow() {
                    stop_reason = StopReason::Interrupted;
                    Self::push_event(
                        &mut events,
                        &mut on_event,
                        Event::Interrupted {
                            message: "Interrupted by user".to_string(),
                        },
                    );
                    break;
                }
            }

            turn += 1;
            Self::push_event(&mut events, &mut on_event, Event::TurnStart { turn });

            let messages = self.session.messages();
            let outcome = run_single_turn(
                self.provider.as_ref(),
                messages,
                &self.tools,
                Some(self.system_prompt.clone()),
                turn,
                cancel.clone(),
                None,
                &mut on_event,
            )
            .await;

            for e in &outcome.events {
                events.push(e.clone());
            }

            if let Some(Message::Assistant { usage, .. }) = &outcome.assistant_message {
                self.add_usage(usage.clone());
            }

            if let Some(assistant) = outcome.assistant_message {
                let _ = self.session.append_message(assistant);
            }
            for tr in outcome.tool_results {
                let _ = self.session.append_message(tr);
            }

            stop_reason = outcome.stop_reason;
            if outcome.interrupted || stop_reason == StopReason::Interrupted {
                stop_reason = StopReason::Interrupted;
                break;
            }

            let did_compact = self
                .check_compaction(&mut events, stop_reason, cancel.clone())
                .await;
            if did_compact {
                if self.app_config.compaction.on_overflow == "pause" {
                    break;
                }
                continue;
            }

            if stop_reason != StopReason::ToolUse {
                break;
            }
        }

        if turn >= max_turns && stop_reason == StopReason::ToolUse {
            hit_max_turns = true;
        }

        if hit_max_turns && stop_reason != StopReason::Interrupted {
            stop_reason = StopReason::Length;
        }

        Self::push_event(
            &mut events,
            &mut on_event,
            Event::AgentEnd {
                stop_reason,
                total_turns: turn,
                total_usage: self.run_usage.clone(),
            },
        );
        events
    }

    async fn check_compaction(
        &mut self,
        events: &mut Vec<Event>,
        stop_reason: StopReason,
        cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> bool {
        if stop_reason == StopReason::Error {
            return false;
        }

        let mut last_usage = None;
        for entry in self.session.entries.iter().rev() {
            if let SessionEntry::Message {
                message: Message::Assistant { usage, .. },
                ..
            } = entry
            {
                last_usage = usage.clone();
                break;
            }
        }

        let Some(last_usage) = last_usage else {
            return false;
        };

        let context_window = self
            .config
            .context_window
            .unwrap_or(self.app_config.agent.default_context_window);
        let max_output = self
            .config
            .max_output_tokens
            .unwrap_or(self.provider.config().max_tokens);

        if !is_overflow(
            &last_usage,
            context_window,
            max_output,
            self.app_config.compaction.buffer_tokens,
        ) {
            return false;
        }

        if let Some(c) = &cancel {
            if *c.borrow() {
                return false;
            }
        }

        let tokens_before = last_usage.input_tokens
            + last_usage.output_tokens
            + last_usage.cache_read_tokens
            + last_usage.cache_write_tokens;

        events.push(Event::CompactionStart);

        match generate_summary(
            self.session.all_messages(),
            self.provider.as_ref(),
            self.system_prompt.clone(),
        )
        .await
        {
            Ok(summary) => {
                let first_kept = self.session.leaf_id.clone().unwrap_or_default();
                let _ = self
                    .session
                    .append_compaction(summary, first_kept, tokens_before, None);
                if self.app_config.compaction.on_overflow == "continue" {
                    let _ = self.session.append_message(Message::User {
                        content: UserContent::Text("Continue from previous summary".to_string()),
                    });
                }
                events.push(Event::CompactionEnd {
                    tokens_before,
                    aborted: false,
                });
                true
            }
            Err(_) => {
                events.push(Event::CompactionEnd {
                    tokens_before,
                    aborted: true,
                });
                false
            }
        }
    }
}

pub fn build_system_prompt(cwd: &str, context: &Context, config: &Config) -> String {
    let mut prompt = config.llm.system_prompt.clone();
    if !context.agents_files.is_empty() {
        prompt.push_str("\n\n");
        prompt.push_str(&format_agents_files_for_prompt(&context.agents_files));
    }
    if !context.skills.is_empty() {
        prompt.push_str("\n\n");
        prompt.push_str(&format_skills_for_prompt(&context.skills));
    }

    prompt.push_str(&format!(
        "\n\nCurrent date and time: {}",
        Local::now().format("%A, %B %d, %Y at %I:%M %p %Z")
    ));
    prompt.push_str(&format!("\nCurrent working directory: {}", cwd));
    prompt
}
