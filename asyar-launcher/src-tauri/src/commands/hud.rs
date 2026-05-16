//! HUD Tauri command wrappers — thin shells over `crate::hud_window::service`.

use tauri::AppHandle;

use crate::error::AppError;
use crate::hud_window::{service, HudContent};

/// Show the HUD with the given title.
///
/// `duration_ms` is ignored when `spinning=true` — spinning HUDs stay visible
/// until an explicit `hide_hud` or a follow-up non-spinning `show_hud` call.
#[tauri::command]
pub fn show_hud(
    app_handle: AppHandle,
    title: String,
    duration_ms: u32,
    spinning: bool,
) -> Result<(), AppError> {
    service::show(&app_handle, title, duration_ms, spinning)
}

/// Hide the HUD immediately.
#[tauri::command]
pub fn hide_hud(app_handle: AppHandle) -> Result<(), AppError> {
    service::hide(&app_handle)
}

/// Returns the most recently set HUD content (or `null` if none).
///
/// The HUD's Svelte route calls this on mount to recover the state that
/// was emitted before its event listener attached. Without this fallback,
/// the very first `show_hud` call would render an empty pill because the
/// `hud:show` event fires before the lazy-loaded webview mounts.
#[tauri::command]
pub fn get_hud_state(app_handle: AppHandle) -> Result<Option<HudContent>, AppError> {
    service::current_state(&app_handle)
}
