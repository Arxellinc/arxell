use thiserror::Error;

#[derive(Debug, Error)]
pub enum KonError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("toml error: {0}")]
    Toml(#[from] toml::de::Error),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("invalid argument: {0}")]
    InvalidArgument(String),
    #[error("provider error: {0}")]
    Provider(String),
    #[error("tool error: {0}")]
    Tool(String),
}

pub type KonResult<T> = Result<T, KonError>;
