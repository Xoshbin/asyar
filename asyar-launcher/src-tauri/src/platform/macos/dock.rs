use tauri::{AppHandle, Manager};

/// Windows that behave like a normal app window: while one is visible, Asyar
/// shows in the Dock and Cmd+Tab switcher even when "Show in Dock" is off
const APP_WINDOW_LABELS: [&str; 2] = [
    crate::SETTINGS_LABEL,
    crate::onboarding::window::WINDOW_LABEL,
];

/// Re-derives the activation policy from the persisted "Show in Dock" setting
/// and the visibility of app-style windows.
pub fn sync_activation_policy(app: &AppHandle) {
    apply_activation_policy(app, crate::bootstrap::windows::read_show_dock_icon(app));
}

/// Whether Asyar should present as a regular (Dock + Cmd+Tab) application.
///
/// `Regular` whenever the user opted into the Dock icon, and also — regardless
/// of that setting — while an app-style window is on screen, so the window can
/// be reached from the Cmd+Tab switcher like any other app's.
pub fn should_be_regular(show_dock: bool, app_window_visible: bool) -> bool {
    show_dock || app_window_visible
}

/// Like [`sync_activation_policy`], with the "Show in Dock" value supplied by
/// the caller (used when the setting is toggled before it is persisted).
pub fn apply_activation_policy(app: &AppHandle, show_dock: bool) {
    let visible_app_window = APP_WINDOW_LABELS.iter().find_map(|label| {
        app.get_webview_window(label)
            .filter(|w| w.is_visible().unwrap_or(false))
    });
    let regular = should_be_regular(show_dock, visible_app_window.is_some());

    let _ = app.set_activation_policy(if regular {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    });

    if !regular {
        return;
    }
    super::set_dock_icon_image();

    // `setActivationPolicy:Regular` does not bring the process to the
    // foreground, and the window was made key by `orderFront` — which does not
    // activate either (only tao's `set_focus` passes
    // `activateIgnoringOtherApps:`). Without re-activating here the window can
    // stay behind the previously-frontmost app and the application menu bar
    // never installs. This is what the pre-refactor `set_dock_icon_visible`
    // did, and why.
    if let Some(window) = visible_app_window {
        // Already key when we are inside its own `Focused(true)` handler;
        // re-focusing would re-enter the window-event dispatch for no gain.
        if !window.is_focused().unwrap_or(false) {
            let _ = window.set_focus();
        }
        super::activate_app();
    }
}

/// Keeps the activation policy in sync with a window's own lifecycle, so the
/// code that shows it doesn't have to.
///
/// Covers two edges:
/// - `Focused(true)` — the show path. `show()` makes the window key
///   (`orderFront`), so this fires even on the alpha-0 first-paint reveal used
///   by `reveal_window_after_first_paint`.
/// - `Destroyed` — the teardown path. Tauri removes the window from the
///   manager *before* per-window handlers run, so the visibility scan here
///   correctly no longer sees it.
///
/// **It does not cover hide-based closes.** A window that intercepts
/// `CloseRequested` with `prevent_close()` + `hide()` never emits `Destroyed`,
/// so its owner must call [`sync_activation_policy`] itself after hiding.
/// `settings` is such a window; both of its hide paths do this explicitly
/// (`bootstrap::windows::init_window_listeners` and the Cmd+Q monitor in
/// `platform::macos::input`). `onboarding` is destroyed on close and needs
/// nothing extra.
///
/// Registering this is additive — Tauri appends window-event handlers rather
/// than replacing them, so it composes with a window's existing
/// `on_window_event` listener.
pub fn track_app_window(window: &tauri::WebviewWindow) {
    let app = window.app_handle().clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Focused(true) | tauri::WindowEvent::Destroyed => {
            sync_activation_policy(&app)
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accessory_when_dock_icon_off_and_no_app_window() {
        assert!(!should_be_regular(false, false));
    }

    #[test]
    fn regular_when_dock_icon_enabled() {
        assert!(should_be_regular(true, false));
    }

    // Issue #862: an open Settings/Onboarding window must be Cmd+Tab-reachable
    // even for users who keep the Dock icon hidden.
    #[test]
    fn regular_while_app_window_visible_despite_dock_icon_off() {
        assert!(should_be_regular(false, true));
    }

    #[test]
    fn stays_regular_when_both_hold() {
        assert!(should_be_regular(true, true));
    }

    #[test]
    fn tracks_both_app_style_windows() {
        assert_eq!(APP_WINDOW_LABELS.len(), 2);
        assert!(APP_WINDOW_LABELS.contains(&"settings"));
        assert!(APP_WINDOW_LABELS.contains(&"onboarding"));
    }
}
