use arx_rs::events::Event;
use arx_rs::provider::lifecycle::ProviderTimeouts;
use arx_rs::provider::openai_compatible::OpenAiCompatibleProvider;
use arx_rs::provider::{Provider, ProviderConfig, ProviderStream};
use arx_rs::tools::Tool;
use arx_rs::turn::{run_single_turn, TurnOutcome};
use arx_rs::types::{Message, StopReason, StreamPart, ToolDefinition, ToolResult};
use async_trait::async_trait;
use futures_util::StreamExt;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;

#[path = "support/http.rs"]
mod http;

#[derive(Clone, Copy)]
enum Scenario {
    Headers,
    FirstPart,
    TextThenStall,
    Retry,
    Slow,
    ToolThenStall,
    ToolDone,
}
struct Scripted {
    config: ProviderConfig,
    scenario: Scenario,
    calls: Arc<AtomicUsize>,
}
impl Scripted {
    fn new(scenario: Scenario) -> Self {
        Self {
            config: ProviderConfig::default(),
            scenario,
            calls: Arc::default(),
        }
    }
}
#[async_trait]
impl Provider for Scripted {
    fn name(&self) -> &'static str {
        "fixture"
    }
    fn config(&self) -> &ProviderConfig {
        &self.config
    }
    fn config_mut(&mut self) -> &mut ProviderConfig {
        &mut self.config
    }
    fn should_retry_for_error(&self, _: &str) -> bool {
        true
    }
    async fn stream(
        &self,
        _: Vec<Message>,
        _: Option<String>,
        _: Option<Vec<ToolDefinition>>,
        _: Option<f64>,
        _: Option<i64>,
    ) -> Result<ProviderStream, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        match self.scenario {
            Scenario::Headers => return std::future::pending().await,
            Scenario::Retry => return Err("fixture timeout".into()),
            _ => {}
        }
        let scenario = self.scenario;
        let stream = async_stream::stream! {
            match scenario {
                Scenario::TextThenStall => yield Ok(StreamPart::Text { text: "partial".into() }),
                Scenario::ToolThenStall | Scenario::ToolDone => {
                    yield Ok(StreamPart::ToolCallStart { id: "fixture".into(), name: "spy".into(), index: 0 });
                    yield Ok(StreamPart::ToolCallDelta { index: 0, arguments_delta: "{}".into() });
                    if matches!(scenario, Scenario::ToolDone) {
                        yield Ok(StreamPart::Done { stop_reason: StopReason::ToolUse });
                        return;
                    }
                },
                Scenario::Slow => {
                    for _ in 0..5 {
                        tokio::time::sleep(Duration::from_secs(30)).await;
                        yield Ok(StreamPart::Text { text: "token".into() });
                    }
                    yield Ok(StreamPart::Done { stop_reason: StopReason::Stop });
                    return;
                },
                _ => {},
            }
            std::future::pending::<()>().await;
        };
        Ok(ProviderStream {
            stream: Box::pin(stream),
            usage: Default::default(),
            id: None,
        })
    }
}

async fn run(provider: &dyn Provider, cancel: Option<watch::Receiver<bool>>) -> TurnOutcome {
    run_single_turn(
        provider,
        vec![],
        &[],
        None,
        1,
        cancel,
        Some(vec![]),
        &mut |_| {},
    )
    .await
}

#[tokio::test(start_paused = true)]
async fn first_headers_and_first_part_have_bounded_waits() {
    for scenario in [Scenario::Headers, Scenario::FirstPart] {
        let provider = Scripted::new(scenario);
        let started = tokio::time::Instant::now();
        let outcome = run(&provider, None).await;
        assert_eq!(outcome.stop_reason, StopReason::Error);
        assert!(!outcome.interrupted);
        assert_eq!(started.elapsed(), Duration::from_secs(90));
        assert!(outcome
            .events
            .iter()
            .any(|event| matches!(event, Event::Error { error } if error.contains("timeout"))));
    }
}

#[tokio::test(start_paused = true)]
async fn stalled_stream_errors_after_idle_without_retrying_partial_output() {
    let provider = Scripted::new(Scenario::TextThenStall);
    let started = tokio::time::Instant::now();
    let outcome = run(&provider, None).await;
    assert_eq!(outcome.stop_reason, StopReason::Error);
    assert_eq!(started.elapsed(), Duration::from_secs(45));
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
    assert!(outcome
        .events
        .iter()
        .any(|event| matches!(event, Event::TextDelta { delta } if delta == "partial")));
}

#[tokio::test(start_paused = true)]
async fn cancellation_interrupts_header_first_part_and_stalled_chunk_waits() {
    for scenario in [
        Scenario::Headers,
        Scenario::FirstPart,
        Scenario::TextThenStall,
    ] {
        let provider = Scripted::new(scenario);
        let (tx, rx) = watch::channel(false);
        let started = tokio::time::Instant::now();
        let (outcome, _) = tokio::join!(run(&provider, Some(rx)), async {
            tokio::time::sleep(Duration::from_secs(1)).await;
            tx.send(true).unwrap();
        });
        assert!(outcome.interrupted);
        assert_eq!(outcome.stop_reason, StopReason::Interrupted);
        assert_eq!(started.elapsed(), Duration::from_secs(1));
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
        assert!(!outcome
            .events
            .iter()
            .any(|event| matches!(event, Event::Error { .. })));
    }
}

#[tokio::test(start_paused = true)]
async fn cancellation_during_retry_backoff_prevents_the_next_attempt() {
    let provider = Scripted::new(Scenario::Retry);
    let (tx, rx) = watch::channel(false);
    let outcome = run_single_turn(
        &provider,
        vec![],
        &[],
        None,
        1,
        Some(rx),
        Some(vec![8]),
        &mut |event| {
            if matches!(event, Event::Retry { .. }) {
                tx.send(true).unwrap();
            }
        },
    )
    .await;
    assert!(outcome.interrupted);
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn header_timeouts_keep_the_existing_bounded_retry_count() {
    let provider = Scripted::new(Scenario::Headers);
    let started = tokio::time::Instant::now();
    let outcome = run_single_turn(&provider, vec![], &[], None, 1, None, None, &mut |_| {}).await;
    assert_eq!(outcome.stop_reason, StopReason::Error);
    assert_eq!(provider.calls.load(Ordering::SeqCst), 4);
    assert_eq!(started.elapsed(), Duration::from_secs(4 * 90 + 2 + 4 + 8));
}

#[tokio::test(start_paused = true)]
async fn healthy_turn_can_stream_for_longer_than_a_minute_or_the_first_response_budget() {
    let provider = Scripted::new(Scenario::Slow);
    let started = tokio::time::Instant::now();
    let outcome = run(&provider, None).await;
    assert_eq!(outcome.stop_reason, StopReason::Stop);
    assert!(!outcome.interrupted);
    assert_eq!(started.elapsed(), Duration::from_secs(150));
}

struct Spy(Arc<AtomicUsize>);
#[async_trait]
impl Tool for Spy {
    fn name(&self) -> &'static str {
        "spy"
    }
    fn description(&self) -> &'static str {
        "fixture"
    }
    fn schema(&self) -> serde_json::Value {
        serde_json::json!({"type": "object"})
    }
    fn format_call(&self, _: &serde_json::Value) -> String {
        String::new()
    }
    async fn execute(&self, _: serde_json::Value, _: Option<watch::Receiver<bool>>) -> ToolResult {
        self.0.fetch_add(1, Ordering::SeqCst);
        ToolResult {
            success: true,
            result: None,
            images: None,
            display: None,
        }
    }
}

#[tokio::test(start_paused = true)]
async fn timed_out_partial_tool_calls_are_never_executed() {
    let provider = Scripted::new(Scenario::ToolThenStall);
    let executed = Arc::new(AtomicUsize::new(0));
    let tools: Vec<Box<dyn Tool>> = vec![Box::new(Spy(executed.clone()))];
    let outcome = run_single_turn(
        &provider,
        vec![],
        &tools,
        None,
        1,
        None,
        Some(vec![]),
        &mut |_| {},
    )
    .await;
    assert_eq!(outcome.stop_reason, StopReason::Error);
    assert_eq!(executed.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn stop_between_stream_completion_and_tool_dispatch_prevents_execution() {
    let provider = Scripted::new(Scenario::ToolDone);
    let executed = Arc::new(AtomicUsize::new(0));
    let tools: Vec<Box<dyn Tool>> = vec![Box::new(Spy(executed.clone()))];
    let (tx, rx) = watch::channel(false);
    let outcome = run_single_turn(
        &provider,
        vec![],
        &tools,
        None,
        1,
        Some(rx),
        Some(vec![]),
        &mut |event| {
            if matches!(event, Event::ToolEnd { .. }) {
                tx.send(true).unwrap();
            }
        },
    )
    .await;
    assert!(outcome.interrupted);
    assert_eq!(executed.load(Ordering::SeqCst), 0);
}

#[test]
fn provider_deadlines_have_separate_connect_first_response_and_idle_budgets() {
    let timeouts = ProviderTimeouts::default();
    assert_eq!(timeouts.connect, Duration::from_secs(10));
    assert_eq!(timeouts.first_response, Duration::from_secs(90));
    assert_eq!(timeouts.stream_idle, Duration::from_secs(45));
}

fn openai(url: &str) -> OpenAiCompatibleProvider {
    OpenAiCompatibleProvider::new(ProviderConfig {
        api_key: Some("fixture-only".into()),
        base_url: Some(url.into()),
        ..Default::default()
    })
}

#[tokio::test]
async fn real_http_request_can_be_cancelled_before_headers_arrive() {
    let mut server = http::Server::start(None).await;
    let provider = openai(&server.url);
    let (tx, rx) = watch::channel(false);
    let task = tokio::spawn(async move { run(&provider, Some(rx)).await });
    let _peer = server.peer().await;
    tx.send(true).unwrap();
    let outcome = tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    assert!(outcome.interrupted);
}

#[tokio::test]
async fn tls_handshake_stall_obeys_the_connect_timeout_not_the_header_timeout() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let provider = openai(&format!("https://{}", listener.local_addr().unwrap()));
    let task = tokio::spawn(async move { provider.stream(vec![], None, None, None, None).await });
    // TCP is accepted, but the fixture never answers the TLS ClientHello.
    let (_peer, _) = listener.accept().await.unwrap();
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(11)).await;
    assert!(task
        .await
        .unwrap()
        .err()
        .unwrap()
        .contains("connection timeout"));
}

#[tokio::test]
async fn real_http_headers_have_a_deadline_without_a_cancellation_signal() {
    let mut server = http::Server::start(None).await;
    let provider = OpenAiCompatibleProvider::with_timeouts(
        ProviderConfig {
            api_key: Some("fixture-only".into()),
            base_url: Some(server.url.clone()),
            ..Default::default()
        },
        ProviderTimeouts {
            first_response: Duration::from_secs(10),
            ..Default::default()
        },
    );
    let task = tokio::spawn(async move { provider.stream(vec![], None, None, None, None).await });
    let _peer = server.peer().await;
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(11)).await;
    let error = task.await.unwrap().err().expect("headers must time out");
    assert!(error.contains("headers timeout"));
}

#[tokio::test]
async fn real_http_stream_is_cancellable_after_a_text_chunk() {
    let mut server = http::Server::start(Some(http::STREAM_HEADERS)).await;
    let provider = openai(&server.url);
    let (tx, rx) = watch::channel(false);
    let (text, seen) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let mut text = Some(text);
        run_single_turn(
            &provider,
            vec![],
            &[],
            None,
            1,
            Some(rx),
            Some(vec![]),
            &mut |event| {
                if matches!(event, Event::TextDelta { .. }) {
                    if let Some(tx) = text.take() {
                        let _ = tx.send(());
                    }
                }
            },
        )
        .await
    });
    let mut peer = server.peer().await;
    http::chunk(
        &mut peer,
        b"data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
    )
    .await;
    seen.await.unwrap();
    tx.send(true).unwrap();
    assert!(
        tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap()
            .interrupted
    );
}

#[tokio::test]
async fn role_only_frames_do_not_shorten_the_first_output_budget() {
    let mut server = http::Server::start(Some(http::STREAM_HEADERS)).await;
    let provider = openai(&server.url);
    let mut stream = provider
        .stream(vec![], None, None, None, None)
        .await
        .unwrap();
    let mut peer = server.peer().await;
    http::chunk(
        &mut peer,
        b"data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n: heartbeat\n\n",
    )
    .await;
    tokio::time::pause();
    let started = tokio::time::Instant::now();
    assert!(stream
        .stream
        .next()
        .await
        .unwrap()
        .unwrap_err()
        .contains("idle timeout"));
    assert!((Duration::from_secs(90)..=Duration::from_millis(90_020)).contains(&started.elapsed()));
}

#[tokio::test]
async fn completed_http_stream_ends_without_an_idle_error() {
    let mut server = http::Server::start(Some(http::STREAM_HEADERS)).await;
    let provider = openai(&server.url);
    let mut stream = provider
        .stream(vec![], None, None, None, None)
        .await
        .unwrap();
    let mut peer = server.peer().await;
    http::chunk(&mut peer, b"data: [DONE]\n\n").await;
    http::finish(&mut peer).await;
    assert!(matches!(
        stream.stream.next().await.unwrap().unwrap(),
        StreamPart::Done { .. }
    ));
    assert!(stream.stream.next().await.is_none());
}

#[tokio::test]
async fn openai_transport_has_no_total_body_timeout_and_enforces_idle_after_progress() {
    let mut server = http::Server::start(Some(http::STREAM_HEADERS)).await;
    let provider = openai(&server.url);
    let mut stream = provider
        .stream(vec![], None, None, None, None)
        .await
        .unwrap();
    let mut peer = server.peer().await;
    for _ in 0..4 {
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(30)).await;
        // Real sockets are not driven by Tokio's virtual clock. Keep time
        // running until the client observes the chunk, otherwise an idle
        // runtime can auto-advance to the timeout before the OS delivers it.
        tokio::time::resume();
        http::chunk(
            &mut peer,
            b"data: {\"choices\":[{\"delta\":{\"content\":\"token\"}}]}\n\n",
        )
        .await;
        assert!(matches!(
            stream.stream.next().await.unwrap().unwrap(),
            StreamPart::Text { .. }
        ));
    }
    // 120 seconds have elapsed, but each healthy body chunk still arrived.
    // No more socket data is expected, so virtual time is safe for the stall.
    tokio::time::pause();
    let started = tokio::time::Instant::now();
    let error = stream.stream.next().await.unwrap().unwrap_err();
    assert!(error.contains("idle timeout"));
    assert!((Duration::from_secs(45)..=Duration::from_millis(45_020)).contains(&started.elapsed()));
}
