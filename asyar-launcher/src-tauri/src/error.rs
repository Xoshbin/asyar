use serde::Serialize;

/// Unified error type for all Tauri command handlers.
///
/// Implements `thiserror::Error` for Display/From and `serde::Serialize`
/// for Tauri IPC compatibility.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Lock poisoned")]
    Lock,

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Extension error: {0}")]
    Extension(String),

    #[error("Shortcut error: {0}")]
    Shortcut(String),

    #[error("Platform error: {0}")]
    Platform(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
