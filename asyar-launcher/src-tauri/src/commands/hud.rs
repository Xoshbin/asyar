//! HUD Tauri command wrappers — thin shells over `crate::hud_window::service`.

use tauri::AppHandle;

use crate::error::AppError;
use crate::hud_window::service;

/// Show the HUD with the given title for `duration_ms` milliseconds.
#[tauri::command]
pub fn show_hud(
    app_handle: AppHandle,
    title: String,
    duration_ms: u32,
) -> Result<(), AppError> {
    service::show(&app_handle, title, duration_ms)
}

/// Hide the HUD immediately.
#[tauri::command]
pub fn hide_hud(app_handle: AppHandle) -> Result<(), AppError> {
    service::hide(&app_handle)
}

/// Returns the most recently set HUD title (or `null` if none).
///
/// The HUD's Svelte route calls this on mount to recover the title that
/// was emitted before its event listener attached. Without this fallback,
/// the very first `show_hud` call would render an empty pill because the
/// `hud:show` event fires before the lazy-loaded webview mounts.
#[tauri::command]
pub fn get_hud_title(app_handle: AppHandle) -> Result<Option<String>, AppError> {
    service::current_title(&app_handle)
}
