//! Local-only HTTP fixture shared by agent and desktop transport tests.
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

pub const STREAM_HEADERS: &str = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n";

pub struct Server {
    pub url: String,
    peer: Option<oneshot::Receiver<TcpStream>>,
    task: tokio::task::JoinHandle<()>,
}

impl Server {
    pub async fn start(headers: Option<&'static str>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = oneshot::channel();
        let task = tokio::spawn(async move {
            let (mut peer, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buf = [0; 4096];
            loop {
                let n = peer.read(&mut buf).await.unwrap();
                if n == 0 {
                    return;
                }
                request.extend_from_slice(&buf[..n]);
                assert!(request.len() < 64 * 1024, "fixture requests must be small");
                if let Some(end) = request.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&request[..end]).to_ascii_lowercase();
                    let length = header
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .and_then(|value| value.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            if let Some(headers) = headers {
                peer.write_all(headers.as_bytes()).await.unwrap();
            }
            // The receiving test owns the socket and controls every body chunk.
            let _ = tx.send(peer);
        });
        Self {
            url,
            peer: Some(rx),
            task,
        }
    }

    pub async fn peer(&mut self) -> TcpStream {
        self.peer.take().unwrap().await.unwrap()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub async fn chunk(peer: &mut TcpStream, data: &[u8]) {
    peer.write_all(format!("{:x}\r\n", data.len()).as_bytes())
        .await
        .unwrap();
    peer.write_all(data).await.unwrap();
    peer.write_all(b"\r\n").await.unwrap();
}

pub async fn finish(peer: &mut TcpStream) {
    peer.write_all(b"0\r\n\r\n").await.unwrap();
}
