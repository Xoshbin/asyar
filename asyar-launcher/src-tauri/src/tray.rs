use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, Emitter, Manager,
};

pub const TRAY_ID: &str = "asyar-tray";

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
    let menu = Menu::with_items(app, &[&settings_i, &check_updates_i, &quit_i])?;

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
            // No catch-all: extension items live on their own trays and are
            // handled by `crate::extension_tray::backend`. Unknown ids here
            // would indicate a bug and are silently ignored.
            _ => {}
        })
        .build(app)?;

    Ok(())
}
