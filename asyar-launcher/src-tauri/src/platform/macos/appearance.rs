#![allow(deprecated)]
pub use asyar_platform::macos::appearance::*;

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// Sets the NSWindow's NSAppearance and the NSVisualEffectView material to match `pref`.
pub fn apply_panel_appearance<R: Runtime>(window: &WebviewWindow<R>, pref: crate::ThemePreference) {
    if let Ok(ptr) = window.ns_window() {
        // SAFETY: ns_window() returns a valid NSWindow pointer on success.
        unsafe { asyar_platform::macos::appearance::apply_panel_appearance(ptr as *mut _, pref) };
    } else {
        log::warn!("[apply_panel_appearance] ns_window() failed");
    }
}

/// Adds or removes the launcher's NSVisualEffectView. Clearing first keeps a
/// repeated enable from stacking a second view.
pub fn set_panel_vibrancy<R: Runtime>(
    window: &WebviewWindow<R>,
    enabled: bool,
    pref: crate::ThemePreference,
) {
    let _ = window_vibrancy::clear_vibrancy(window);
    if enabled {
        let resolved = asyar_platform::macos::resolve_theme_preference(pref);
        let material = asyar_platform::macos::material_for_resolved_theme(resolved);
        let _ = window_vibrancy::apply_vibrancy(window, material, None, None);
    }
}

/// Registers an observer for `AppleInterfaceThemeChangedNotification`.
/// When the OS appearance changes, re-applies the appearance if the preference is `System`.
pub fn install_appearance_observer<R: Runtime + 'static>(app: &AppHandle<R>) {
    let app_handle = app.clone();

    asyar_platform::macos::appearance::install_appearance_observer(move || {
        let pref = {
            let state = app_handle.try_state::<std::sync::Mutex<crate::ThemePreference>>();
            match state {
                Some(s) => *s.lock().unwrap_or_else(|p| p.into_inner()),
                None => crate::ThemePreference::System,
            }
        };

        if pref == crate::ThemePreference::System {
            if let Some(window) = app_handle.get_webview_window(crate::SPOTLIGHT_LABEL) {
                apply_panel_appearance(&window, pref);
            }
        }
    });
}
