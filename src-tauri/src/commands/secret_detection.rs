//! Tauri command layer for the secret-redaction filter.
//!
//! Thin wrappers over the pure functions in [`crate::secret_detection`].
//! Mirrors the `_inner` pattern used by [`crate::commands::clipboard_privacy`]
//! and [`crate::commands::power`].

use crate::error::AppError;
use crate::secret_detection::{redact, rules::RULES, RedactionResult, SecretDetectionState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectorRuleSummary {
    pub kind: String,
    pub description: String,
}

#[tauri::command]
pub async fn secret_detection_redact(
    input: String,
    state: State<'_, SecretDetectionState>,
) -> Result<RedactionResult, AppError> {
    Ok(redact_inner(&input, &state))
}

#[tauri::command]
pub async fn secret_detection_get_session_stats(
    state: State<'_, SecretDetectionState>,
) -> Result<HashMap<String, u32>, AppError> {
    Ok(state.get_session_stats())
}

#[tauri::command]
pub async fn secret_detection_get_catalog() -> Result<Vec<DetectorRuleSummary>, AppError> {
    Ok(RULES
        .iter()
        .map(|r| DetectorRuleSummary {
            kind: r.kind.to_string(),
            description: r.description.to_string(),
        })
        .collect())
}

pub(crate) fn redact_inner(input: &str, state: &SecretDetectionState) -> RedactionResult {
    let result = redact(input);
    state.record(&result.kinds);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_inner_records_kinds_in_state() {
        let state = SecretDetectionState::new();
        let r = redact_inner("key=AKIAIOSFODNN7EXAMPLE", &state);
        assert_eq!(r.kinds, vec!["aws_access_key".to_string()]);
        assert_eq!(state.get_session_stats().get("aws_access_key").copied(), Some(1));
    }

    #[test]
    fn redact_inner_does_not_record_for_no_match() {
        let state = SecretDetectionState::new();
        let r = redact_inner("plain text input here", &state);
        assert!(r.kinds.is_empty());
        assert!(state.get_session_stats().is_empty());
    }

    #[test]
    fn redact_inner_passes_oversized_flag_through() {
        let state = SecretDetectionState::new();
        let big = "x".repeat(crate::secret_detection::MAX_SCAN_BYTES + 1);
        let r = redact_inner(&big, &state);
        assert!(r.oversized_unscanned);
        assert!(r.kinds.is_empty());
        assert!(state.get_session_stats().is_empty());
    }
}
