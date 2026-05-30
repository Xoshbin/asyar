//! Tauri command layer for the clipboard capture-time privacy filter.
//!
//! Thin wrappers delegating to pure `*_inner` functions so the logic is unit
//! testable without a running Tauri app. Mirrors the pattern in
//! [`crate::commands::power`] and [`crate::commands::timers`].

use crate::clipboard_privacy::{classify, ClipboardPrivacyState, SkipReason};
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationResult {
    pub skip: bool,
    pub reason: SkipReason,
}

/// Tauri-managed state holding the user-editable bundle-id denylist.
///
/// The list is persisted client-side via `tauri-plugin-store` and rehydrated
/// at startup; this struct holds the in-memory copy.
pub struct UserDenylist(pub Mutex<Vec<String>>);

impl UserDenylist {
    pub fn new() -> Self {
        Self(Mutex::new(Vec::new()))
    }
}

impl Default for UserDenylist {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn clipboard_privacy_classify(
    source_bundle_id: Option<String>,
    state: State<'_, ClipboardPrivacyState>,
    user_denylist: State<'_, UserDenylist>,
) -> Result<ClassificationResult, AppError> {
    let types = crate::clipboard_privacy::read_current_pasteboard_types();
    let user = user_denylist.0.lock().map_err(|_| AppError::Lock)?.clone();
    Ok(classify_inner(
        &types,
        source_bundle_id.as_deref(),
        &user,
        &state,
    ))
}

#[tauri::command]
pub async fn clipboard_privacy_get_session_stats(
    state: State<'_, ClipboardPrivacyState>,
) -> Result<HashMap<String, u32>, AppError> {
    Ok(state.get_session_stats())
}

#[tauri::command]
pub async fn clipboard_privacy_set_user_denylist(
    entries: Vec<String>,
    user_denylist: State<'_, UserDenylist>,
) -> Result<(), AppError> {
    set_user_denylist_inner(entries, &user_denylist)
}

#[tauri::command]
pub async fn clipboard_privacy_get_user_denylist(
    user_denylist: State<'_, UserDenylist>,
) -> Result<Vec<String>, AppError> {
    get_user_denylist_inner(&user_denylist)
}

#[tauri::command]
pub async fn clipboard_privacy_get_default_denylist() -> Result<Vec<String>, AppError> {
    Ok(crate::clipboard_privacy::default_denylist())
}

pub(crate) fn classify_inner(
    pasteboard_types: &[String],
    source_bundle_id: Option<&str>,
    user_denylist: &[String],
    state: &ClipboardPrivacyState,
) -> ClassificationResult {
    let reason = classify(pasteboard_types, source_bundle_id, user_denylist);
    state.record_skip(&reason);
    ClassificationResult {
        skip: !matches!(reason, SkipReason::None),
        reason,
    }
}

pub(crate) fn set_user_denylist_inner(
    entries: Vec<String>,
    user_denylist: &UserDenylist,
) -> Result<(), AppError> {
    let mut guard = user_denylist.0.lock().map_err(|_| AppError::Lock)?;
    let mut deduped: Vec<String> = Vec::new();
    for e in entries {
        let trimmed = e.trim().to_string();
        if !trimmed.is_empty() && !deduped.iter().any(|d| d.eq_ignore_ascii_case(&trimmed)) {
            deduped.push(trimmed);
        }
    }
    *guard = deduped;
    Ok(())
}

pub(crate) fn get_user_denylist_inner(
    user_denylist: &UserDenylist,
) -> Result<Vec<String>, AppError> {
    user_denylist
        .0
        .lock()
        .map(|g| g.clone())
        .map_err(|_| AppError::Lock)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_inner_records_skip_in_state() {
        let state = ClipboardPrivacyState::new();
        let r = classify_inner(
            &["org.nspasteboard.TransientType".into()],
            None,
            &[],
            &state,
        );
        assert!(r.skip);
        assert_eq!(r.reason, SkipReason::Transient);
        assert_eq!(state.get_session_stats().get("transient").copied(), Some(1));
    }

    #[test]
    fn classify_inner_does_not_record_for_none() {
        let state = ClipboardPrivacyState::new();
        let r = classify_inner(
            &["public.utf8-plain-text".into()],
            Some("com.apple.TextEdit"),
            &[],
            &state,
        );
        assert!(!r.skip);
        assert_eq!(r.reason, SkipReason::None);
        assert!(
            state.get_session_stats().is_empty()
                || state.get_session_stats().values().all(|v| *v == 0)
        );
    }

    #[test]
    fn classify_inner_returns_source_denylist_with_bundle_id() {
        let state = ClipboardPrivacyState::new();
        let r = classify_inner(
            &["public.utf8-plain-text".into()],
            Some("com.example.Vault"),
            &["com.example.Vault".to_string()],
            &state,
        );
        assert!(r.skip);
        assert_eq!(
            r.reason,
            SkipReason::SourceDenylist("com.example.Vault".into())
        );
    }

    #[test]
    fn set_user_denylist_dedupes_case_insensitively() {
        let user = UserDenylist::new();
        set_user_denylist_inner(
            vec![
                "com.example.Vault".into(),
                "COM.EXAMPLE.VAULT".into(),
                "  ".into(),
            ],
            &user,
        )
        .unwrap();
        let got = get_user_denylist_inner(&user).unwrap();
        assert_eq!(got, vec!["com.example.Vault".to_string()]);
    }

    #[test]
    fn set_user_denylist_replaces_previous_list() {
        let user = UserDenylist::new();
        set_user_denylist_inner(vec!["com.example.A".into()], &user).unwrap();
        set_user_denylist_inner(vec!["com.example.B".into()], &user).unwrap();
        let got = get_user_denylist_inner(&user).unwrap();
        assert_eq!(got, vec!["com.example.B".to_string()]);
    }
}
