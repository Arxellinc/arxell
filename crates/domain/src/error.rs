use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DomainError {
    Validation { field: &'static str, reason: String },
    NotFound { entity: &'static str, id: String },
    Conflict { reason: String },
    Unsupported { capability: &'static str },
    Internal { reason: String },
}

impl DomainError {
    pub fn validation(field: &'static str, reason: impl Into<String>) -> Self {
        Self::Validation {
            field,
            reason: reason.into(),
        }
    }
}

impl Display for DomainError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            DomainError::Validation { field, reason } => {
                write!(f, "validation failed for {field}: {reason}")
            }
            DomainError::NotFound { entity, id } => write!(f, "{entity} not found: {id}"),
            DomainError::Conflict { reason } => write!(f, "conflict: {reason}"),
            DomainError::Unsupported { capability } => {
                write!(f, "unsupported capability: {capability}")
            }
            DomainError::Internal { reason } => write!(f, "internal error: {reason}"),
        }
    }
}

impl std::error::Error for DomainError {}
