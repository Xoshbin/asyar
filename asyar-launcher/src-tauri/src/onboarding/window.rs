//! Onboarding window lifecycle helpers.
//!
//! Creates, shows, and closes the dedicated `onboarding` webview window.
//! `open_if_needed` is called from `setup_app` (Task 7 owns that call site).

use crate::error::AppError;
use tauri::{AppHandle, Manager};

const WINDOW_LABEL: &str = "onboarding";
const WINDOW_URL: &str = "/onboarding";
// Match the launcher panel's footprint (tauri.conf.json `main` window).
const WINDOW_WIDTH: f64 = 750.0;
const WINDOW_HEIGHT: f64 = 480.0;

/// Open the onboarding window (creates if it doesn't exist; focuses if it does).
pub fn open(app: &AppHandle) -> Result<(), AppError> {
    if let Some(existing) = app.get_webview_window(WINDOW_LABEL) {
        existing
            .show()
            .map_err(|e| AppError::Other(format!("show onboarding: {e}")))?;
        existing
            .set_focus()
            .map_err(|e| AppError::Other(format!("focus onboarding: {e}")))?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        app,
        WINDOW_LABEL,
        tauri::WebviewUrl::App(WINDOW_URL.into()),
    )
    .title("Welcome to Asyar")
    .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
    .resizable(false)
    .center()
    .always_on_top(true)
    .decorations(false)
    // Window must be transparent so rounded-corner CSS isn't clipped by a
    // square OS-painted backing. The content background itself is opaque
    // (see +layout.svelte) — only the area outside the rounded corners
    // shows through.
    .transparent(true)
    .shadow(true)
    .visible(true)
    .focused(true)
    .build()
    .map_err(|e| AppError::Other(format!("create onboarding: {e}")))?;

    Ok(())
}

/// Open the onboarding window only if `settings.onboarding.completed != true`.
/// Called from `setup_app` (Task 7 owns the call site).
pub fn open_if_needed(app: &AppHandle) -> Result<(), AppError> {
    if crate::onboarding::persistence::read_onboarding_completed(app) {
        return Ok(());
    }
    open(app)
}

/// Close the onboarding window if open. No-op if not.
pub fn close(app: &AppHandle) -> Result<(), AppError> {
    if let Some(w) = app.get_webview_window(WINDOW_LABEL) {
        w.close()
            .map_err(|e| AppError::Other(format!("close onboarding: {e}")))?;
    }
    Ok(())
}

/// Show the launcher panel. Mirrors whatever code path the global hotkey uses.
pub fn show_launcher_panel(app: &AppHandle) -> Result<(), AppError> {
    crate::commands::app::show_launcher(app)
}
