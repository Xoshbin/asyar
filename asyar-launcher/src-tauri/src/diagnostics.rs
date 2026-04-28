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

#[cfg(test)]
mod kinds_contract {
    /// The TS file is the rendered output of scripts/generate-diagnostic-kinds.mjs.
    /// Every kind a Rust HasSeverity impl can produce must appear in the TS union.
    #[test]
    fn diagnostic_kinds_match_typescript_source() {
        let ts = include_str!("../../src/services/diagnostics/kinds.ts");
        let expected = &[
            "permission_denied",
            "network_failure",
            "lock_poisoned",
            "database_failure",
            "not_found",
            "extension_failure",
            "shortcut_failure",
            "platform_failure",
            "validation_failure",
            "encryption_failure",
            "auth_failure",
            "oauth_failure",
            "power_failure",
            "io_failure",
            "json_failure",
            "unknown",
            "search_lock_poisoned",
            "search_json_failure",
            "search_io_failure",
            "search_not_found",
            "search_other",
        ];
        for kind in expected {
            assert!(
                ts.contains(&format!("\"{kind}\"")),
                "TS kinds.ts is missing kind: {kind}. Run `pnpm gen:diagnostic-kinds`."
            );
        }
    }
}
