use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Info,
    Success,
    Warning,
    Error,
    Fatal,
}

pub trait HasSeverity {
    fn kind(&self) -> &'static str;
    fn severity(&self) -> Severity;
    fn retryable(&self) -> bool;
    fn context(&self) -> HashMap<&'static str, String>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn severity_serializes_lowercase() {
        let json = serde_json::to_value(&Severity::Warning).unwrap();
        assert_eq!(json, serde_json::json!("warning"));
    }

    #[test]
    fn severity_fatal_serializes() {
        let json = serde_json::to_value(&Severity::Fatal).unwrap();
        assert_eq!(json, serde_json::json!("fatal"));
    }
}
