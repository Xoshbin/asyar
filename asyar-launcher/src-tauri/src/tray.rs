use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, Emitter, Manager,
};

pub const TRAY_ID: &str = "asyar-tray";

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
                // Open settings window and emit event so frontend navigates to About tab and checks
                if let Some(settings_window) = app.get_webview_window("settings") {
                    let _ = settings_window.show();
                    let _ = settings_window.set_focus();
                }
                let _ = app.emit("check-for-updates", ());
            }
            other => {
                // Extension status item clicked — notify frontend with composite ID
                // Format: "extensionId:itemId"  e.g. "org.asyar.pomodoro:timer-status"
                let _ = app.emit("tray-item-clicked", other.to_string());
            }
        })
        .build(app)?;

    Ok(())
}
