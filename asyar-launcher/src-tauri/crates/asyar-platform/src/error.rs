use thiserror::Error;

#[derive(Debug, Error)]
pub enum PlatformError {
    #[error("Platform window handle error: {0}")]
    WindowHandle(String),
    #[error("Unsupported platform operation: {0}")]
    Unsupported(String),
    #[error("OS API error: {0}")]
    OsError(String),
}
