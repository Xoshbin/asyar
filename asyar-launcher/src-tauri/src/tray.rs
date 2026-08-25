use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, Emitter, Manager,
};

pub const TRAY_ID: &str = "asyar-tray";

/// Watchdog for the macOS flash-free settings reveal. The webview is warm
/// (predeclared window, close hides it), so this matches the HUD's bound.
#[cfg(target_os = "macos")]
const SETTINGS_REVEAL_FALLBACK_MS: u64 = 250;

/// Show + focus the settings window. On macOS a hidden window's webview is
/// throttled, so its last composite predates the hidden spell; a plain
/// `show()` paints that stale frame before WebKit catches up. Reveal on the
/// next presented frame instead (same treatment as onboarding; see
/// `reveal_window_after_first_paint`). Already-visible windows just refocus.
fn show_settings_window(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    if !window.is_visible().unwrap_or(false) {
        crate::platform::macos::reveal_window_after_first_paint(
            window,
            SETTINGS_REVEAL_FALLBACK_MS,
        );
        return;
    }
    let _ = window.show();
    let _ = window.set_focus();
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
    let check_updates_i = MenuItem::with_id(
        app,
        "check-updates",
        "Check for Updates",
        true,
        None::<&str>,
    )?;
    let settings_i = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&settings_i, &check_updates_i, &quit_i])?;

    let show_tray = crate::read_show_tray_icon(app.app_handle());
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(
            app.default_window_icon()
                .ok_or("Default window icon not configured")?
                .clone(),
        )
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => {
                app.exit(0);
            }
            "settings" => {
                if let Some(settings_window) = app.get_webview_window("settings") {
                    show_settings_window(&settings_window);
                }
            }
            "check-updates" => {
                if let Some(settings_window) = app.get_webview_window("settings") {
                    show_settings_window(&settings_window);
                }
                let _ = app.emit("check-for-updates", ());
            }
            // No catch-all: extension items live on their own trays and are
            // handled by `crate::extension_tray::backend`. Unknown ids here
            // would indicate a bug and are silently ignored.
            _ => {}
        })
        .build(app)?;

    let _ = tray.set_visible(show_tray);

    Ok(())
}
