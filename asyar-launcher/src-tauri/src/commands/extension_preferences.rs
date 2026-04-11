use crate::error::AppError;
use crate::storage::extension_preferences as prefs_store;
use crate::storage::DataStore;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// Event payload broadcast to all webview windows after a preference write.
/// Listeners invalidate their in-memory cache and re-read from the DB.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesChangedPayload {
    pub extension_id: String,
}

/// Fire `asyar:preferences-changed` so all webview windows (main launcher,
/// settings window, any future windows) can drop their cached bundle for
/// this extension. Event name is kept stable across TS consumers.
fn emit_changed(app_handle: &AppHandle, extension_id: &str) {
    let payload = PreferencesChangedPayload {
        extension_id: extension_id.to_string(),
    };
    if let Err(e) = app_handle.emit("asyar:preferences-changed", payload) {
        log::warn!(
            "Failed to emit asyar:preferences-changed for {}: {}",
            extension_id,
            e
        );
    }
}

#[tauri::command]
pub async fn extension_preferences_get_all(
    extension_id: String,
    data_store: State<'_, DataStore>,
) -> Result<Vec<prefs_store::PreferenceExportRow>, AppError> {
    let conn = data_store.conn()?;
    prefs_store::get_all_for_extension(&conn, &extension_id)
}

#[tauri::command]
pub async fn extension_preferences_set(
    extension_id: String,
    command_id: Option<String>,
    key: String,
    value: String,
    is_encrypted: bool,
    app_handle: AppHandle,
    data_store: State<'_, DataStore>,
) -> Result<(), AppError> {
    if extension_id.trim().is_empty() {
        return Err(AppError::Validation("extension_id cannot be empty".to_string()));
    }
    if key.trim().is_empty() {
        return Err(AppError::Validation("key cannot be empty".to_string()));
    }
    {
        let conn = data_store.conn()?;
        prefs_store::set(
            &conn,
            &extension_id,
            command_id.as_deref(),
            &key,
            &value,
            is_encrypted,
        )?;
    }
    emit_changed(&app_handle, &extension_id);
    Ok(())
}

#[tauri::command]
pub async fn extension_preferences_reset(
    extension_id: String,
    app_handle: AppHandle,
    data_store: State<'_, DataStore>,
) -> Result<(), AppError> {
    if extension_id.trim().is_empty() {
        return Err(AppError::Validation("extension_id cannot be empty".to_string()));
    }
    {
        let conn = data_store.conn()?;
        prefs_store::clear(&conn, &extension_id)?;
    }
    emit_changed(&app_handle, &extension_id);
    Ok(())
}

#[tauri::command]
pub async fn extension_preferences_export_all(
    data_store: State<'_, DataStore>,
) -> Result<prefs_store::PreferencesExport, AppError> {
    let conn = data_store.conn()?;
    prefs_store::export_all(&conn)
}

#[tauri::command]
pub async fn extension_preferences_import_all(
    payload: prefs_store::PreferencesExport,
    strategy: String,
    data_store: State<'_, DataStore>,
) -> Result<prefs_store::ImportResult, AppError> {
    let strat = match strategy.as_str() {
        "replace" => prefs_store::ImportStrategy::Replace,
        "merge" => prefs_store::ImportStrategy::Merge,
        other => return Err(AppError::Validation(format!("Unknown import strategy: {other}"))),
    };
    let conn = data_store.conn()?;
    prefs_store::import_all(&conn, payload, strat)
}
