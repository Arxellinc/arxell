#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TtsSpeechKind {
    Speculative,
    Canonical,
}

pub trait TtsPlaybackController: Send + Sync {
    fn speak_prefix(
        &self,
        _correlation_id: &str,
        _text: &str,
        _kind: TtsSpeechKind,
    ) -> Result<(), String> {
        Ok(())
    }

    fn cancel_speculative(&self, _correlation_id: &str, _reason: &str) -> Result<(), String> {
        Ok(())
    }
}

pub trait AssistantSpeechStateProvider: Send + Sync {
    fn is_assistant_speaking(&self) -> bool {
        false
    }
}

#[derive(Default)]
pub struct NoopTtsPlaybackController;

impl TtsPlaybackController for NoopTtsPlaybackController {}
impl AssistantSpeechStateProvider for NoopTtsPlaybackController {}
