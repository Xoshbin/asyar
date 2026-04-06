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

    #[error("Encryption error: {0}")]
    Encryption(String),

    #[error("Permission denied: {0}")]
    Permission(String),

    #[error("Authentication error: {0}")]
    Auth(String),

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_io_error_display_prefix() {
        let err = AppError::Io(std::io::Error::new(std::io::ErrorKind::NotFound, "file missing"));
        assert!(err.to_string().starts_with("IO error:"));
    }

    #[test]
    fn test_lock_display() {
        assert_eq!(AppError::Lock.to_string(), "Lock poisoned");
    }

    #[test]
    fn test_shortcut_display() {
        let err = AppError::Shortcut("bad key".to_string());
        assert_eq!(err.to_string(), "Shortcut error: bad key");
    }

    #[test]
    fn test_not_found_display_contains_id() {
        let err = AppError::NotFound("item_abc".to_string());
        assert!(err.to_string().contains("item_abc"));
    }

    #[test]
    fn test_extension_display() {
        let err = AppError::Extension("load failed".to_string());
        assert_eq!(err.to_string(), "Extension error: load failed");
    }

    #[test]
    fn test_serialize_produces_json_string() {
        let err = AppError::Extension("load failed".to_string());
        let value = serde_json::to_value(&err).unwrap();
        assert!(value.is_string());
        assert!(value.as_str().unwrap().contains("load failed"));
    }

    #[test]
    fn test_encryption_display() {
        let err = AppError::Encryption("bad key".to_string());
        assert_eq!(err.to_string(), "Encryption error: bad key");
    }

    #[test]
    fn test_all_string_variants_serialize() {
        let variants: Vec<AppError> = vec![
            AppError::Lock,
            AppError::NotFound("x".to_string()),
            AppError::Extension("x".to_string()),
            AppError::Shortcut("x".to_string()),
            AppError::Platform("x".to_string()),
            AppError::Validation("x".to_string()),
            AppError::Encryption("x".to_string()),
            AppError::Permission("x".to_string()),
            AppError::Auth("x".to_string()),
            AppError::Other("x".to_string()),
        ];
        for variant in &variants {
            let result = serde_json::to_value(variant);
            assert!(result.is_ok());
            assert!(result.unwrap().is_string());
        }
    }
}
