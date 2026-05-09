use std::sync::{Mutex, OnceLock};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Emitter, Manager,
};

use crate::error::AppError;

pub const TRAY_ID: &str = "asyar-tray";

/// Holds a reference to the "Show Runs" menu item so `set_running_count` can
/// update its label without rebuilding the entire menu.
static RUNS_ITEM: OnceLock<Mutex<Option<MenuItem<tauri::Wry>>>> = OnceLock::new();

pub(crate) fn format_running_label(count: usize) -> String {
    if count == 0 {
        "Show Runs".to_string()
    } else {
        format!("Show Runs ({count} running)")
    }
}

/// Update the "Show Runs" tray menu item label to reflect the current active
/// run count. Called by the `tray_set_running_count` Tauri command whenever
/// the frontend's `runService.activeCount` changes.
pub fn set_running_count(app: &AppHandle, n: usize) -> Result<(), AppError> {
    let cell = RUNS_ITEM.get_or_init(|| Mutex::new(None));
    let guard = cell.lock().map_err(|_| AppError::Lock)?;
    if let Some(item) = guard.as_ref() {
        item.set_text(format_running_label(n))
            .map_err(|e| AppError::Other(e.to_string()))?;
    }
    let _ = app; // AppHandle held for future extensibility
    Ok(())
}

/// Sets up Asyar's own menu-bar tray.
///
/// This tray is **never** touched by extensions — each top-level
/// `IStatusBarItem` an extension registers gets its own independent
/// `TrayIcon` via `crate::extension_tray`. Keeping the two flows separate
/// means core Asyar controls (Settings / Check for Updates / Quit) remain
/// visible and stable regardless of which extensions are installed.
pub fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let quit_i = MenuItem::with_id(app, "quit", "Quit Asyar", true, None::<&str>)?;
    let check_updates_i = MenuItem::with_id(app, "check-updates", "Check for Updates", true, None::<&str>)?;
    let settings_i = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let runs_i = MenuItem::with_id(app, "show-runs", "Show Runs", true, None::<&str>)?;

    // Store a clone for later label mutation via `set_running_count`.
    let cell = RUNS_ITEM.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = cell.lock() {
        *guard = Some(runs_i.clone());
    }

    let menu = Menu::with_items(app, &[&runs_i, &settings_i, &check_updates_i, &quit_i])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().ok_or("Default window icon not configured")?.clone())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => {
                app.exit(0);
            }
            "settings" => {
                if let Some(settings_window) = app.get_webview_window("settings") {
                    let _ = settings_window.show();
                    let _ = settings_window.set_focus();
                }
            }
            "check-updates" => {
                if let Some(settings_window) = app.get_webview_window("settings") {
                    let _ = settings_window.show();
                    let _ = settings_window.set_focus();
                }
                let _ = app.emit("check-for-updates", ());
            }
            "show-runs" => {
                let _ = app.emit("tray:open-runs", ());
            }
            // No catch-all: extension items live on their own trays and are
            // handled by `crate::extension_tray::backend`. Unknown ids here
            // would indicate a bug and are silently ignored.
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_running_label_zero_returns_plain_show_runs() {
        assert_eq!(format_running_label(0), "Show Runs");
    }

    #[test]
    fn format_running_label_one_returns_one_running() {
        assert_eq!(format_running_label(1), "Show Runs (1 running)");
    }

    #[test]
    fn format_running_label_multiple_returns_count() {
        assert_eq!(format_running_label(5), "Show Runs (5 running)");
    }
}
