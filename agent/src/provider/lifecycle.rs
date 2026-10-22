//! Shared provider-I/O deadlines. There is deliberately no total generation cap.
use std::fmt;
use std::future::{pending, Future};
use std::time::Duration;
use tokio::sync::watch;

#[derive(Debug, Clone, Copy)]
pub struct ProviderTimeouts {
    pub connect: Duration,
    pub first_response: Duration,
    pub stream_idle: Duration,
}

impl Default for ProviderTimeouts {
    fn default() -> Self {
        Self {
            connect: Duration::from_secs(10),
            first_response: Duration::from_secs(90),
            stream_idle: Duration::from_secs(45),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderWaitError {
    Cancelled,
    TimedOut,
}

impl fmt::Display for ProviderWaitError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Cancelled => "provider request cancelled",
            Self::TimedOut => "provider response timeout",
        })
    }
}

/// Cancellation wins ties, including a cancellation already set before polling
/// the I/O future. Dropping the losing future releases its pending HTTP work.
pub async fn wait_for<T>(
    io: impl Future<Output = T>,
    cancelled: impl Future<Output = ()>,
    idle_timeout: Duration,
) -> Result<T, ProviderWaitError> {
    tokio::select! {
        biased;
        _ = cancelled => Err(ProviderWaitError::Cancelled),
        result = tokio::time::timeout(idle_timeout, io) => {
            result.map_err(|_| ProviderWaitError::TimedOut)
        }
    }
}

/// A closed, false watch channel is not a user cancellation. Park rather than
/// spinning on changed() errors; a closed channel's last true value still stops.
pub async fn cancelled(cancel: &mut Option<watch::Receiver<bool>>) {
    if let Some(rx) = cancel {
        loop {
            if *rx.borrow_and_update() {
                return;
            }
            if rx.changed().await.is_err() {
                break;
            }
        }
    }
    pending::<()>().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn closed_false_watch_does_not_cancel_or_spin() {
        let (tx, rx) = watch::channel(false);
        drop(tx);
        let mut cancel = Some(rx);
        assert_eq!(
            wait_for(
                pending::<()>(),
                cancelled(&mut cancel),
                Duration::from_secs(3)
            )
            .await,
            Err(ProviderWaitError::TimedOut)
        );
    }

    #[tokio::test]
    async fn cancellation_wins_a_ready_io_future_and_a_closed_true_watch() {
        let (tx, rx) = watch::channel(true);
        drop(tx);
        let mut cancel = Some(rx);
        assert_eq!(
            wait_for(async { 42 }, cancelled(&mut cancel), Duration::from_secs(3)).await,
            Err(ProviderWaitError::Cancelled)
        );
    }
}
