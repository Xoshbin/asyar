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

    #[error("Database error: {0}")]
    Database(String),

    #[error("OAuth error: {0}")]
    OAuth(String),

    #[error("Power error: {0}")]
    Power(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("Diagnostic", 6)?;
        state.serialize_field("source", "rust")?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("severity", &self.severity())?;
        state.serialize_field("retryable", &self.retryable())?;
        state.serialize_field("context", &self.context())?;
        state.serialize_field("developerDetail", &self.to_string())?;
        state.end()
    }
}

use crate::diagnostics::{HasSeverity, Severity};
use std::collections::HashMap;

impl HasSeverity for AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::Io(_) => "io_failure",
            AppError::Json(_) => "json_failure",
            AppError::Network(_) => "network_failure",
            AppError::Lock => "lock_poisoned",
            AppError::NotFound(_) => "not_found",
            AppError::Extension(_) => "extension_failure",
            AppError::Shortcut(_) => "shortcut_failure",
            AppError::Platform(_) => "platform_failure",
            AppError::Validation(_) => "validation_failure",
            AppError::Encryption(_) => "encryption_failure",
            AppError::Permission(_) => "permission_denied",
            AppError::Auth(_) => "auth_failure",
            AppError::Database(_) => "database_failure",
            AppError::OAuth(_) => "oauth_failure",
            AppError::Power(_) => "power_failure",
            AppError::Other(_) => "unknown",
        }
    }

    fn severity(&self) -> Severity {
        match self {
            AppError::Lock | AppError::Database(_) | AppError::Encryption(_) => Severity::Fatal,
            AppError::Permission(_) | AppError::Validation(_) | AppError::NotFound(_) => Severity::Warning,
            _ => Severity::Error,
        }
    }

    fn retryable(&self) -> bool {
        matches!(
            self,
            AppError::Network(_) | AppError::Io(_) | AppError::Auth(_) | AppError::OAuth(_)
        )
    }

    fn context(&self) -> HashMap<&'static str, String> {
        let mut ctx = HashMap::new();
        match self {
            AppError::Permission(s) => { ctx.insert("permission", s.clone()); }
            AppError::NotFound(s) => { ctx.insert("target", s.clone()); }
            AppError::Extension(s) => { ctx.insert("extension", s.clone()); }
            AppError::Shortcut(s) => { ctx.insert("shortcut", s.clone()); }
            AppError::Platform(s) => { ctx.insert("platform", s.clone()); }
            AppError::Validation(s) => { ctx.insert("field", s.clone()); }
            AppError::Auth(s) | AppError::OAuth(s) => { ctx.insert("provider", s.clone()); }
            _ => {}
        }
        ctx
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
    fn test_encryption_display() {
        let err = AppError::Encryption("bad key".to_string());
        assert_eq!(err.to_string(), "Encryption error: bad key");
    }

    #[test]
    fn serialize_emits_diagnostic_struct_shape() {
        let err = AppError::Permission("clipboard:read".into());
        let v: serde_json::Value = serde_json::to_value(&err).unwrap();
        assert!(v.is_object(), "expected object, got {v}");
        assert_eq!(v["source"], "rust");
        assert_eq!(v["kind"], "permission_denied");
        assert_eq!(v["severity"], "warning");
        assert_eq!(v["retryable"], false);
        assert_eq!(v["context"]["permission"], "clipboard:read");
        assert!(v["developerDetail"].as_str().unwrap().contains("clipboard:read"));
    }

    #[test]
    fn serialize_lock_shape() {
        let v: serde_json::Value = serde_json::to_value(&AppError::Lock).unwrap();
        assert_eq!(v["kind"], "lock_poisoned");
        assert_eq!(v["severity"], "fatal");
        assert!(v["context"].as_object().unwrap().is_empty());
    }
}

#[cfg(test)]
mod severity_tests {
    use super::*;
    use crate::diagnostics::{HasSeverity, Severity};

    #[test]
    fn permission_is_warning() {
        let err = AppError::Permission("clipboard:read".into());
        assert_eq!(err.severity(), Severity::Warning);
        assert_eq!(err.kind(), "permission_denied");
        assert!(!err.retryable());
        assert_eq!(err.context().get("permission"), Some(&"clipboard:read".to_string()));
    }

    #[test]
    fn lock_is_fatal() {
        assert_eq!(AppError::Lock.severity(), Severity::Fatal);
        assert_eq!(AppError::Lock.kind(), "lock_poisoned");
    }

    #[test]
    fn database_is_fatal() {
        let err = AppError::Database("disk full".into());
        assert_eq!(err.severity(), Severity::Fatal);
        assert_eq!(err.kind(), "database_failure");
    }

    #[test]
    fn other_is_error_default() {
        let err = AppError::Other("x".into());
        assert_eq!(err.severity(), Severity::Error);
        assert!(!err.retryable());
        assert_eq!(err.kind(), "unknown");
    }

    #[test]
    fn not_found_kind() {
        let err = AppError::NotFound("item".into());
        assert_eq!(err.kind(), "not_found");
        assert_eq!(err.context().get("target"), Some(&"item".to_string()));
    }

    #[test]
    fn validation_is_warning() {
        let err = AppError::Validation("bad input".into());
        assert_eq!(err.severity(), Severity::Warning);
    }
}
