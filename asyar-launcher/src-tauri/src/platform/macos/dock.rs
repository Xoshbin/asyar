use tauri::{AppHandle, Manager};

/// Windows that behave like a normal app window: while one is visible, Asyar
/// shows in the Dock and Cmd+Tab switcher even when "Show in Dock" is off
const APP_WINDOW_LABELS: [&str; 2] = ["settings", "onboarding"];

/// Re-derives the activation policy from the persisted "Show in Dock" setting
/// and the visibility of app-style windows.
pub fn sync_activation_policy(app: &AppHandle) {
    apply_activation_policy(app, crate::bootstrap::windows::read_show_dock_icon(app));
}

/// Like [`sync_activation_policy`], with the "Show in Dock" value supplied by
/// the caller (used when the setting is toggled before it is persisted).
pub fn apply_activation_policy(app: &AppHandle, show_dock: bool) {
    let app_window_visible = APP_WINDOW_LABELS.iter().any(|label| {
        app.get_webview_window(label)
            .is_some_and(|w| w.is_visible().unwrap_or(false))
    });
    let regular = show_dock || app_window_visible;
    let _ = app.set_activation_policy(if regular {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    });
    if regular {
        super::set_dock_icon_image();
    }
}

/// Re-syncs the activation policy from the window's own events, so callers
/// that show or close it don't each have to remember to.
pub fn track_app_window(window: &tauri::WebviewWindow) {
    let app = window.app_handle().clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Focused(true) | tauri::WindowEvent::Destroyed => {
            sync_activation_policy(&app)
        }
        _ => {}
    });
}
