//! Thin command wrappers for the usage module. All logic lives in
//! `crate::usage`; these only adapt managed state to Tauri commands.

use std::sync::Arc;

use crate::usage::{self, UsageError, UsageState};

#[tauri::command]
pub async fn record_active_day(state: tauri::State<'_, Arc<UsageState>>) -> Result<(), UsageError> {
    state.record_active_day(&usage::local_day())
}

#[tauri::command]
pub async fn get_usage_stats(
    state: tauri::State<'_, Arc<UsageState>>,
    search: tauri::State<'_, Arc<crate::search_engine::SearchState>>,
) -> Result<usage::UsageStats, UsageError> {
    let mut stats = state.stats()?;
    // Enrich raw ids with friendly titles from the search index (rust-first).
    for item in stats.top.iter_mut() {
        item.label = search.display_title(&item.id);
    }
    Ok(stats)
}

#[tauri::command]
pub async fn get_usage_anon_id(
    state: tauri::State<'_, Arc<UsageState>>,
) -> Result<String, UsageError> {
    state.anon_id()
}

#[tauri::command]
pub async fn reset_usage_anon_id(
    state: tauri::State<'_, Arc<UsageState>>,
) -> Result<String, UsageError> {
    state.reset_anon_id()
}

/// Ask-mode confirm: build the payload for `day`, send it, mark sent.
#[tauri::command]
pub async fn send_pending_usage(
    day: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<UsageState>>,
) -> Result<(), UsageError> {
    // Reuse the exact platform string the feedback flow already builds (rust-first DRY).
    let platform = crate::feedback::platform_string();
    let version = app_handle.package_info().version.to_string();
    let payload = usage::sender::build_payload(&state, &day, &version, &platform)?;
    let client = crate::auth::api_client::ApiClient::new();
    client
        .submit_usage_ping(&payload)
        .await
        .map_err(|e| UsageError::Db(e.to_string()))?;
    usage::sender::mark_day_sent(&state, &day)
}

/// Explicit user action: send today's usage snapshot immediately.
/// Always sends regardless of share mode (the click is consent). Does NOT mark sent.
/// Returns the number of distinct launch entries sent (for UI feedback).
#[tauri::command]
pub async fn send_usage_now(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Arc<UsageState>>,
) -> Result<u32, UsageError> {
    let day = usage::local_day();
    let platform = crate::feedback::platform_string();
    let version = app_handle.package_info().version.to_string();
    let payload = usage::sender::build_payload(&state, &day, &version, &platform)?;
    let count = payload.launches.len() as u32;
    let client = crate::auth::api_client::ApiClient::new();
    client
        .submit_usage_ping(&payload)
        .await
        .map_err(|e| UsageError::Db(e.to_string()))?;
    Ok(count)
}
