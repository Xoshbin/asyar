#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Pool error: {0}")]
    Pool(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Lock poisoned")]
    Lock,

    #[error("Encryption error: {0}")]
    Encryption(String),

    #[error("Rusqlite error: {0}")]
    Rusqlite(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub type AppError = StorageError;
pub type Result<T> = std::result::Result<T, StorageError>;
