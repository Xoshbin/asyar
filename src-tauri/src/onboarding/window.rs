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

    #[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
    let window = tauri::WebviewWindowBuilder::new(
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
    // Tauri's `transparent: true` is required so WebView2 composites onto the
    // DWM backdrop (Mica/Acrylic) painted below — otherwise the webview is
    // an opaque rectangle and Acrylic never shows. The CSS layout matches:
    // `.onboarding-frame` is transparent on Windows so the backdrop reads
    // through, while DWM rounds the visible window corners natively.
    .transparent(true)
    .shadow(true)
    .visible(true)
    .focused(true)
    .build()
    .map_err(|e| AppError::Other(format!("create onboarding: {e}")))?;

    #[cfg(target_os = "windows")]
    {
        // Native Windows polish: strip WS_EX_LAYERED so DWM owns the backdrop,
        // round the corners, then paint Acrylic (Win10 + Win11) with a Mica
        // fallback (Win11 only, in case Acrylic is disabled by the user).
        if let Ok(hwnd) = window.hwnd() {
            crate::platform::windows::apply_dwm_polish(hwnd);
        }
        use window_vibrancy::{apply_acrylic, apply_mica};
        if apply_acrylic(&window, Some((0, 0, 0, 0))).is_err() {
            let _ = apply_mica(&window, None);
        }
    }

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
