//! Legacy chat transport: the same provider deadlines, with process-local Stop
//! checks. No total response-duration timeout and no detached cancellation task.
use arx_rs::provider::lifecycle::{wait_for, ProviderTimeouts, ProviderWaitError};
use serde::Serialize;
use std::future::Future;
use std::time::Duration;

pub(super) struct ChatProviderHttp {
    client: reqwest::Client,
    timeouts: ProviderTimeouts,
}

impl ChatProviderHttp {
    pub fn new() -> Result<Self, String> {
        Self::with_timeouts(ProviderTimeouts::default())
    }

    fn with_timeouts(timeouts: ProviderTimeouts) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .connect_timeout(timeouts.connect)
            .build()
            .map_err(|_| "failed creating provider HTTP client")?;
        Ok(Self { client, timeouts })
    }

    async fn io<T, C: Fn() -> bool + Sync>(
        &self,
        future: impl Future<Output = Result<T, reqwest::Error>>,
        is_cancelled: &C,
        idle: Duration,
        stage: &'static str,
    ) -> Result<T, String> {
        let cancellation = async {
            loop {
                if is_cancelled() {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(120)).await;
            }
        };
        wait_for(future, cancellation, idle)
            .await
            .map_err(|error| match error {
                ProviderWaitError::Cancelled => "Chat request was cancelled.".to_string(),
                ProviderWaitError::TimedOut => format!("local provider {stage} timeout"),
            })?
            .map_err(|error| {
                if error.is_timeout() {
                    "local provider connection timeout".to_string()
                } else {
                    format!("local provider {stage} failed: {}", error.without_url())
                }
            })
    }

    pub async fn send<T: Serialize + Sync, C: Fn() -> bool + Sync>(
        &self,
        endpoint: &str,
        payload: &T,
        is_cancelled: &C,
    ) -> Result<reqwest::Response, String> {
        self.io(
            self.client.post(endpoint).json(payload).send(),
            is_cancelled,
            self.timeouts.first_response,
            "response headers",
        )
        .await
    }

    pub async fn next_chunk<C: Fn() -> bool + Sync>(
        &self,
        response: &mut reqwest::Response,
        is_cancelled: &C,
        first: &mut bool,
    ) -> Result<Option<Vec<u8>>, String> {
        let idle = if *first {
            self.timeouts.first_response
        } else {
            self.timeouts.stream_idle
        };
        let chunk = self
            .io(response.chunk(), is_cancelled, idle, "stream idle")
            .await?;
        *first = false;
        Ok(chunk.map(|bytes| bytes.to_vec()))
    }

    pub async fn bytes<C: Fn() -> bool + Sync>(
        &self,
        mut response: reqwest::Response,
        is_cancelled: &C,
    ) -> Result<Vec<u8>, String> {
        let mut body = Vec::new();
        let mut first = true;
        while let Some(chunk) = self
            .next_chunk(&mut response, is_cancelled, &mut first)
            .await?
        {
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }

    pub async fn text<C: Fn() -> bool + Sync>(
        &self,
        response: reqwest::Response,
        is_cancelled: &C,
    ) -> Result<String, String> {
        Ok(String::from_utf8_lossy(&self.bytes(response, is_cancelled).await?).into_owned())
    }
}

#[cfg(test)]
#[path = "../../../agent/tests/support/http.rs"]
mod http;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    #[tokio::test]
    async fn cancellation_before_dispatch_never_polls_the_request() {
        let http = ChatProviderHttp::new().unwrap();
        let result: Result<(), String> = http
            .io(
                async { panic!("cancelled I/O must not be polled") },
                &|| true,
                Duration::from_secs(90),
                "response headers",
            )
            .await;
        assert!(result.unwrap_err().contains("cancelled"));
    }

    #[tokio::test]
    async fn legacy_headers_are_cancellable_without_waiting_for_the_server() {
        let mut server = http::Server::start(None).await;
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let endpoint = server.url.clone();
        let task = tokio::spawn(async move {
            ChatProviderHttp::new()
                .unwrap()
                .send(&endpoint, &serde_json::json!({}), &|| {
                    worker_stop.load(Ordering::SeqCst)
                })
                .await
        });
        let _peer = server.peer().await;
        stop.store(true, Ordering::SeqCst);
        let error = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert!(error.contains("cancelled"));
    }

    #[tokio::test]
    async fn legacy_tls_connect_timeout_is_shorter_than_the_header_budget() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("https://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            ChatProviderHttp::new()
                .unwrap()
                .send(&endpoint, &serde_json::json!({}), &|| false)
                .await
        });
        let (_peer, _) = listener.accept().await.unwrap();
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(11)).await;
        assert!(task
            .await
            .unwrap()
            .unwrap_err()
            .contains("connection timeout"));
    }

    #[tokio::test]
    async fn legacy_header_timeout_is_bounded_without_stop() {
        let mut server = http::Server::start(None).await;
        let endpoint = server.url.clone();
        let task = tokio::spawn(async move {
            ChatProviderHttp::new()
                .unwrap()
                .send(&endpoint, &serde_json::json!({}), &|| false)
                .await
        });
        let _peer = server.peer().await;
        tokio::time::pause();
        tokio::time::advance(Duration::from_secs(91)).await;
        let error = task.await.unwrap().unwrap_err();
        assert!(error.contains("headers timeout"));
    }

    #[tokio::test]
    async fn legacy_first_body_timeout_is_distinct_from_headers() {
        let mut server = http::Server::start(Some(http::STREAM_HEADERS)).await;
        let http = ChatProviderHttp::new().unwrap();
        let mut response = http
            .send(&server.url, &serde_json::json!({}), &|| false)
            .await
            .unwrap();
        let _peer = server.peer().await;
        tokio::time::pause();
        let started = tokio::time::Instant::now();
        let error = http
            .next_chunk(&mut response, &|| false, &mut true)
            .await
            .unwrap_err();
        assert!(error.contains("idle timeout"));
        assert!(
            (Duration::from_secs(90)..=Duration::from_millis(90_020)).contains(&started.elapsed())
        );
    }

    #[tokio::test]
    async fn legacy_body_wait_is_cancellable_even_without_any_chunk() {
        let mut server = http::Server::start(Some(http::STREAM_HEADERS)).await;
        let http = ChatProviderHttp::new().unwrap();
        let response = http
            .send(&server.url, &serde_json::json!({}), &|| false)
            .await
            .unwrap();
        let _peer = server.peer().await;
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let waiting = Arc::new(tokio::sync::Notify::new());
        let worker_waiting = waiting.clone();
        let task = tokio::spawn(async move {
            http.text(response, &|| {
                worker_waiting.notify_one();
                worker_stop.load(Ordering::SeqCst)
            })
            .await
        });
        waiting.notified().await;
        stop.store(true, Ordering::SeqCst);
        let error = tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert!(error.contains("cancelled"));
    }

    #[tokio::test]
    async fn legacy_healthy_stream_survives_120_seconds_but_stalled_chunks_time_out() {
        let mut server = http::Server::start(Some(http::STREAM_HEADERS)).await;
        let http = ChatProviderHttp::new().unwrap();
        let mut response = http
            .send(&server.url, &serde_json::json!({}), &|| false)
            .await
            .unwrap();
        let mut peer = server.peer().await;
        tokio::time::pause();
        let mut first = true;
        for _ in 0..4 {
            tokio::time::advance(Duration::from_secs(30)).await;
            http::chunk(&mut peer, b"healthy").await;
            assert_eq!(
                http.next_chunk(&mut response, &|| false, &mut first)
                    .await
                    .unwrap()
                    .unwrap(),
                b"healthy"
            );
        }
        let started = tokio::time::Instant::now();
        assert!(http
            .next_chunk(&mut response, &|| false, &mut first)
            .await
            .unwrap_err()
            .contains("idle timeout"));
        assert!(
            (Duration::from_secs(45)..=Duration::from_millis(45_020)).contains(&started.elapsed())
        );
    }

    #[tokio::test]
    async fn legacy_json_body_reads_preserve_bytes_for_strict_utf8_validation() {
        let mut server = http::Server::start(Some(http::STREAM_HEADERS)).await;
        let http = ChatProviderHttp::new().unwrap();
        let response = http
            .send(&server.url, &serde_json::json!({}), &|| false)
            .await
            .unwrap();
        let mut peer = server.peer().await;
        let invalid = b"{\"content\":\"\xff\"}";
        http::chunk(&mut peer, invalid).await;
        http::finish(&mut peer).await;
        let bytes = http.bytes(response, &|| false).await.unwrap();
        assert_eq!(bytes, invalid);
        assert!(serde_json::from_slice::<serde_json::Value>(&bytes).is_err());
    }

    #[tokio::test]
    async fn legacy_nonstream_and_error_body_reads_flush_to_eof() {
        let mut server = http::Server::start(Some(http::STREAM_HEADERS)).await;
        let http = ChatProviderHttp::new().unwrap();
        let response = http
            .send(&server.url, &serde_json::json!({}), &|| false)
            .await
            .unwrap();
        let mut peer = server.peer().await;
        http::chunk(&mut peer, b"{\"choices\":[]}").await;
        http::finish(&mut peer).await;
        assert_eq!(
            http.text(response, &|| false).await.unwrap(),
            "{\"choices\":[]}"
        );
    }
}
