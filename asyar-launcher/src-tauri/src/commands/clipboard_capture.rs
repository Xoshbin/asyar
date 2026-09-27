//! Tauri commands for managing clipboard capture subscriptions.

use crate::clipboard_capture::{
    CaptureSubscriptionResult, CaptureTransition, ClipboardCaptureManager,
};
use crate::error::AppError;
use crate::extensions::ExtensionRegistryState;
use crate::permissions::ExtensionPermissionRegistry;
use tauri::{AppHandle, Emitter, State};

pub const CAPTURE_STATE_CHANGED_EVENT: &str = "asyar:clipboard:capture-state-changed";

#[tauri::command]
pub fn clipboard_capture_subscribe(
    app: AppHandle,
    manager: State<'_, ClipboardCaptureManager>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extensions: State<'_, ExtensionRegistryState>,
    caller_id: String,
) -> Result<CaptureSubscriptionResult, AppError> {
    let is_enabled = {
        let reg = extensions.extensions.lock().map_err(|_| AppError::Lock)?;
        reg.get(&caller_id).map(|r| r.enabled).unwrap_or(true)
    };

    let result = manager.subscribe(&caller_id, &permissions, is_enabled)?;
    if result.transition != CaptureTransition::NoChange {
        let _ = app.emit(CAPTURE_STATE_CHANGED_EVENT, &result);
    }
    Ok(result)
}

#[tauri::command]
pub fn clipboard_capture_unsubscribe(
    app: AppHandle,
    manager: State<'_, ClipboardCaptureManager>,
    caller_id: String,
) -> Result<CaptureSubscriptionResult, AppError> {
    let result = manager.unsubscribe(&caller_id)?;
    if result.transition != CaptureTransition::NoChange {
        let _ = app.emit(CAPTURE_STATE_CHANGED_EVENT, &result);
    }
    Ok(result)
}

#[tauri::command]
pub fn clipboard_capture_force_remove(
    app: AppHandle,
    manager: State<'_, ClipboardCaptureManager>,
    extension_id: String,
) -> Result<CaptureSubscriptionResult, AppError> {
    let result = manager.force_remove(&extension_id)?;
    if result.transition != CaptureTransition::NoChange {
        let _ = app.emit(CAPTURE_STATE_CHANGED_EVENT, &result);
    }
    Ok(result)
}

#[tauri::command]
pub fn clipboard_capture_get_consumers(
    manager: State<'_, ClipboardCaptureManager>,
) -> Result<Vec<String>, AppError> {
    manager.get_consumers()
}
