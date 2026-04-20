pub trait SttSessionController: Send + Sync {
    fn start_stream(&self, _correlation_id: &str) -> Result<(), String> {
        Ok(())
    }

    fn feed_partial_segment(&self, _correlation_id: &str, _segment_id: &str) -> Result<(), String> {
        Ok(())
    }

    fn finalize_segment(&self, _correlation_id: &str, _segment_id: &str) -> Result<(), String> {
        Ok(())
    }
}

#[derive(Default)]
pub struct NoopSttSessionController;

impl SttSessionController for NoopSttSessionController {}
