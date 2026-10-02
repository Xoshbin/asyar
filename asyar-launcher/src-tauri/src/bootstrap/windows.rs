//! Window management, presentation, and tray bootstrap module.
//!
//! Configures the main launcher window (NSPanel on macOS, frameless window on Windows/Linux),
//! initial geometry and appearance seeding from `settings.dat`, HUD window, window drag/snap handlers,
//! tray icon setup, and window event listeners (focus/blur, resign, and launch-view-change resize).

use std::sync::atomic::Ordering;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::AppState;
use crate::SPOTLIGHT_LABEL;

/// The user's explicit theme preference, read from `settings.dat` on startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemePreference {
    Light,
    Dark,
    System,
}

pub fn parse_theme_preference_str(s: &str) -> ThemePreference {
    match s {
        "light" => ThemePreference::Light,
        "dark" => ThemePreference::Dark,
        _ => ThemePreference::System,
    }
}

pub fn parse_appearance_theme(settings_root: Option<&serde_json::Value>) -> ThemePreference {
    match settings_root
        .and_then(|s| s.get("appearance"))
        .and_then(|a| a.get("theme"))
        .and_then(|v| v.as_str())
    {
        Some("light") => ThemePreference::Light,
        Some("dark") => ThemePreference::Dark,
        _ => ThemePreference::System,
    }
}

#[cfg(target_os = "macos")]
pub fn read_appearance_theme(app: &tauri::AppHandle) -> ThemePreference {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store("settings.dat") else {
        return ThemePreference::System;
    };
    parse_appearance_theme(store.get("settings").as_ref())
}

pub fn parse_show_tray_icon(settings_root: Option<&serde_json::Value>) -> bool {
    settings_root
        .and_then(|s| s.get("general"))
        .and_then(|g| g.get("showTrayIcon"))
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

pub fn read_show_tray_icon(app: &tauri::AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store("settings.dat") else {
        return true;
    };
    parse_show_tray_icon(store.get("settings").as_ref())
}

pub fn parse_show_dock_icon(settings_root: Option<&serde_json::Value>) -> bool {
    settings_root
        .and_then(|s| s.get("general"))
        .and_then(|g| g.get("showDockIcon"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

pub fn read_show_dock_icon(app: &tauri::AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store("settings.dat") else {
        return false;
    };
    parse_show_dock_icon(store.get("settings").as_ref())
}

pub fn parse_launch_view(settings_root: Option<&serde_json::Value>) -> &'static str {
    let is_compact = settings_root
        .and_then(|s| s.get("appearance"))
        .and_then(|a| a.get("launchView"))
        .and_then(|v| v.as_str())
        == Some("compact");
    if is_compact {
        "compact"
    } else {
        "default"
    }
}

pub fn read_launch_view(app: &tauri::AppHandle) -> &'static str {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store("settings.dat") else {
        return "default";
    };
    parse_launch_view(store.get("settings").as_ref())
}

#[cfg(target_os = "macos")]
pub fn should_collapse_on_resign(compact_mode: bool, keep_expanded: bool) -> bool {
    compact_mode && !keep_expanded
}

/// Initializes system tray menu.
pub fn init_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    crate::tray::setup_tray(app)?;
    Ok(())
}

/// Configures native windows, vibrancy, placement, and prewarms geometry.
pub fn init_windows(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.app_handle();
    let window = handle
        .get_webview_window(SPOTLIGHT_LABEL)
        .ok_or("Main launcher window not found")?;

    #[cfg(target_os = "macos")]
    let initial_theme_pref = read_appearance_theme(handle);

    #[cfg(target_os = "macos")]
    app.manage(Mutex::new(initial_theme_pref));

    #[cfg(target_os = "macos")]
    let panel =
        crate::platform::macos::setup_spotlight_window(&window, handle, initial_theme_pref)?;

    // Convert HUD window into NSPanel on macOS
    #[cfg(target_os = "macos")]
    if let Some(hud_window) =
        handle.get_webview_window(crate::hud_window::service::HUD_WINDOW_LABEL)
    {
        if let Err(e) = crate::platform::macos::setup_hud_window(&hud_window) {
            log::warn!("[hud] setup_hud_window failed: {e}");
        }
    }

    #[cfg(target_os = "macos")]
    crate::platform::macos::install_appearance_observer(handle);

    // Register window drag handlers
    {
        let handle_for_drop = handle.clone();
        crate::window_drag::register_drop_handler(SPOTLIGHT_LABEL, move || {
            crate::launcher_placement::service::persist_dragged(&handle_for_drop);
        });

        let handle_for_move = handle.clone();
        crate::window_drag::register_move_adjuster(SPOTLIGHT_LABEL, move |x, y| {
            crate::launcher_placement::service::adjust_for_snap(&handle_for_move, x, y)
        });
    }

    let compact = read_launch_view(handle) == "compact";

    #[cfg(target_os = "macos")]
    {
        use crate::platform::macos::{LAUNCHER_COMPACT_HEIGHT, LAUNCHER_MAX_HEIGHT};
        crate::platform::macos::pin_launcher_webview(&window);
        crate::platform::macos::configure_launcher_webkit_features(&window);
        let height = if compact {
            LAUNCHER_COMPACT_HEIGHT
        } else {
            LAUNCHER_MAX_HEIGHT
        };
        crate::platform::macos::set_launcher_window_height(
            &window,
            height,
            crate::platform::macos::ResizeMode::Immediate,
        );
        crate::platform::macos::prewarm_launcher_panel(&window, &panel);
    }

    #[cfg(not(target_os = "macos"))]
    if compact {
        use tauri::{LogicalSize, Size};
        if let Ok(size) = window.inner_size() {
            let scale = window.scale_factor().unwrap_or(1.0);
            let logical_width = size.width as f64 / scale;
            let _ = window.set_size(Size::Logical(LogicalSize {
                width: logical_width,
                height: 96.0,
            }));
        }
    }

    // Onboarding: open the window if needed
    if let Err(e) = crate::onboarding::window::open_if_needed(handle) {
        log::warn!("Onboarding window failed to open: {}", e);
    }

    #[cfg(target_os = "macos")]
    crate::platform::macos::register_cmdq_monitor(handle.clone());

    #[cfg(target_os = "windows")]
    let _ = crate::platform::windows::setup_spotlight_window(&window);

    #[cfg(target_os = "linux")]
    let _ = crate::platform::linux::setup_spotlight_window(&window);

    Ok(())
}

/// Sets up lifecycle event listeners (resign on macOS, blur on other OSs,
/// launchView change resize, Windows vibrancy, settings hide prevention,
/// and global shortcuts).
pub fn init_window_listeners(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app;
    #[allow(unused_variables)]
    let window = handle
        .get_webview_window(SPOTLIGHT_LABEL)
        .ok_or("Main launcher window not found")?;

    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;
        let panel = handle
            .get_webview_panel(SPOTLIGHT_LABEL)
            .map_err(|e| format!("Main launcher panel not found: {e:?}"))?;
        let handle_clone = handle.clone();
        use tauri::Listener;
        handle.listen(
            format!("{}_panel_did_resign_key", SPOTLIGHT_LABEL),
            move |_| {
                let state = handle_clone.state::<AppState>();
                if state.focus_locked.load(Ordering::Relaxed) {
                    return;
                }
                state.asyar_visible.store(false, Ordering::Relaxed);

                let compact_mode = read_launch_view(&handle_clone) == "compact";
                let keep_expanded = state.launcher_keep_expanded.load(Ordering::Relaxed);
                let handle_for_main = handle_clone.clone();
                let panel = panel.clone();
                let _ = handle_clone.run_on_main_thread(move || {
                    let Some(window) = handle_for_main.get_webview_window(SPOTLIGHT_LABEL) else {
                        panel.order_out(None);
                        return;
                    };
                    crate::platform::macos::park_launcher_panel(&window, &panel);
                    if should_collapse_on_resign(compact_mode, keep_expanded) {
                        crate::platform::macos::set_launcher_window_height(
                            &window,
                            crate::platform::macos::LAUNCHER_COMPACT_HEIGHT,
                            crate::platform::macos::ResizeMode::Immediate,
                        );
                    }
                });
            },
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        let handle_clone = handle.clone();
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                let state = handle_clone.state::<AppState>();
                if state.focus_locked.load(Ordering::Relaxed) {
                    return;
                }
                #[cfg(target_os = "linux")]
                {
                    let shown_at = state.launcher_shown_at.lock().ok().and_then(|g| *g);
                    if crate::blur_hide_is_spurious(shown_at) {
                        log::debug!("[launcher] ignoring blur within reveal grace window");
                        return;
                    }
                }
                state.asyar_visible.store(false, Ordering::Relaxed);
                let _ = window_clone.hide();
            }
        });
    }

    // Resize on launchView change
    {
        use tauri::Listener;
        let handle_for_listen = handle.clone();
        handle.listen("asyar:launch-view-changed", move |event| {
            let compact = serde_json::from_str::<serde_json::Value>(event.payload())
                .ok()
                .and_then(|v| {
                    v.get("launchView")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_owned())
                })
                .as_deref()
                == Some("compact");

            let handle_for_main = handle_for_listen.clone();
            let _ = handle_for_listen.run_on_main_thread(move || {
                let Some(window) = handle_for_main.get_webview_window(SPOTLIGHT_LABEL) else {
                    return;
                };

                #[cfg(target_os = "macos")]
                {
                    use crate::platform::macos::{
                        ResizeMode, LAUNCHER_COMPACT_HEIGHT, LAUNCHER_MAX_HEIGHT,
                    };
                    let height = if compact {
                        LAUNCHER_COMPACT_HEIGHT
                    } else {
                        LAUNCHER_MAX_HEIGHT
                    };
                    crate::platform::macos::set_launcher_window_height(
                        &window,
                        height,
                        ResizeMode::Immediate,
                    );
                }

                #[cfg(not(target_os = "macos"))]
                {
                    use tauri::{LogicalSize, Size};
                    let height = if compact {
                        96.0
                    } else {
                        crate::launcher_placement::LAUNCHER_MAX_HEIGHT
                    };
                    if let Ok(size) = window.inner_size() {
                        let scale = window.scale_factor().unwrap_or(1.0);
                        let logical_width = size.width as f64 / scale;
                        let _ = window.set_size(Size::Logical(LogicalSize {
                            width: logical_width,
                            height,
                        }));
                    }
                }
            });
        });
    }

    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica};
        if apply_acrylic(&window, Some((0, 0, 0, 0))).is_err() {
            let _ = apply_mica(&window, None);
        }
    }

    // Prevent settings window from being destroyed on close
    if let Some(settings_window) = handle.get_webview_window("settings") {
        let sw = settings_window.clone();
        settings_window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = sw.hide();
            }
        });
    }

    setup_global_shortcut(handle);

    Ok(())
}

/// Re-opens every pinned note's sticky window.
pub fn restore_stickies(app: &tauri::AppHandle) {
    if let Err(e) = crate::sticky_window::restore_all(app) {
        log::warn!("[sticky] restore_all failed: {e}");
    }
}

pub fn setup_global_shortcut(app_handle: &tauri::AppHandle) {
    let shortcut_config = crate::commands::ShortcutConfig::default();
    let shortcut_manager = app_handle.global_shortcut();

    let mod_key = match shortcut_config.modifier.as_str() {
        "Super" => Some(Modifiers::SUPER),
        "Shift" => Some(Modifiers::SHIFT),
        "Control" => Some(Modifiers::CONTROL),
        "Alt" => Some(Modifiers::ALT),
        "" | "None" | "none" => None,
        _ => Some(Modifiers::ALT),
    };

    let code = match crate::commands::get_code_from_string(&shortcut_config.key) {
        Ok(code) => code,
        Err(_) => Code::Space,
    };

    let shortcut = Shortcut::new(mod_key, code);
    if let Err(e) = shortcut_manager.register(shortcut) {
        log::error!("Failed to register shortcut: {}", e);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod resign_collapse_tests {
    use super::should_collapse_on_resign;

    #[test]
    fn collapses_when_compact_and_not_keep_expanded() {
        assert!(should_collapse_on_resign(true, false));
    }

    #[test]
    fn does_not_collapse_when_keep_expanded_is_set() {
        assert!(!should_collapse_on_resign(true, true));
    }

    #[test]
    fn does_not_collapse_when_launch_view_is_default() {
        assert!(!should_collapse_on_resign(false, false));
    }

    #[test]
    fn does_not_collapse_when_default_mode_and_keep_expanded() {
        assert!(!should_collapse_on_resign(false, true));
    }
}

#[cfg(test)]
mod launch_view_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn returns_compact_at_canonical_path() {
        let v = json!({ "appearance": { "launchView": "compact" } });
        assert_eq!(parse_launch_view(Some(&v)), "compact");
    }

    #[test]
    fn returns_default_when_value_is_default() {
        let v = json!({ "appearance": { "launchView": "default" } });
        assert_eq!(parse_launch_view(Some(&v)), "default");
    }

    #[test]
    fn returns_default_when_settings_root_is_none() {
        assert_eq!(parse_launch_view(None), "default");
    }

    #[test]
    fn returns_default_when_appearance_key_missing() {
        let v = json!({ "general": { "startAtLogin": false } });
        assert_eq!(parse_launch_view(Some(&v)), "default");
    }

    #[test]
    fn returns_default_when_launch_view_key_missing() {
        let v = json!({ "appearance": { "theme": "dark", "windowWidth": 800 } });
        assert_eq!(parse_launch_view(Some(&v)), "default");
    }

    #[test]
    fn returns_default_when_launch_view_is_not_string() {
        let v = json!({ "appearance": { "launchView": 42 } });
        assert_eq!(parse_launch_view(Some(&v)), "default");
    }

    #[test]
    fn returns_default_for_unrecognised_string_value() {
        let v = json!({ "appearance": { "launchView": "ultrawide" } });
        assert_eq!(parse_launch_view(Some(&v)), "default");
    }

    #[test]
    fn extracts_from_full_default_settings_shape() {
        let v = json!({
            "general": { "startAtLogin": false, "showDockIcon": true },
            "search": { "searchApplications": true },
            "shortcut": { "modifier": "Alt", "key": "Space" },
            "appearance": {
                "theme": "system",
                "launchView": "compact",
                "windowWidth": 800,
                "windowHeight": 600,
            },
            "extensions": { "enabled": {}, "autoUpdate": true },
            "updates": { "channel": "stable", "autoCheck": true },
            "ai": { "providers": {}, "temperature": 0.7, "maxTokens": 2048 },
        });
        assert_eq!(parse_launch_view(Some(&v)), "compact");
    }
}

#[cfg(test)]
mod appearance_theme_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn returns_light_when_theme_is_light() {
        let v = json!({ "appearance": { "theme": "light" } });
        assert_eq!(parse_appearance_theme(Some(&v)), ThemePreference::Light);
    }

    #[test]
    fn returns_dark_when_theme_is_dark() {
        let v = json!({ "appearance": { "theme": "dark" } });
        assert_eq!(parse_appearance_theme(Some(&v)), ThemePreference::Dark);
    }

    #[test]
    fn returns_system_when_theme_is_system() {
        let v = json!({ "appearance": { "theme": "system" } });
        assert_eq!(parse_appearance_theme(Some(&v)), ThemePreference::System);
    }

    #[test]
    fn returns_system_when_theme_key_missing() {
        let v = json!({ "appearance": { "launchView": "default" } });
        assert_eq!(parse_appearance_theme(Some(&v)), ThemePreference::System);
    }

    #[test]
    fn returns_system_when_appearance_key_missing() {
        let v = json!({ "general": { "startAtLogin": false } });
        assert_eq!(parse_appearance_theme(Some(&v)), ThemePreference::System);
    }

    #[test]
    fn returns_system_for_unknown_theme_value() {
        let v = json!({ "appearance": { "theme": "hot-pink" } });
        assert_eq!(parse_appearance_theme(Some(&v)), ThemePreference::System);
    }

    #[test]
    fn returns_system_when_json_is_empty_object() {
        let v = json!({});
        assert_eq!(parse_appearance_theme(Some(&v)), ThemePreference::System);
    }
}

#[cfg(test)]
mod tray_icon_preference_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn returns_true_by_default_when_settings_root_is_none() {
        assert!(parse_show_tray_icon(None));
    }

    #[test]
    fn returns_true_by_default_when_general_key_missing() {
        let v = json!({ "appearance": { "theme": "dark" } });
        assert!(parse_show_tray_icon(Some(&v)));
    }

    #[test]
    fn returns_true_by_default_when_show_tray_icon_key_missing() {
        let v = json!({ "general": { "startAtLogin": true } });
        assert!(parse_show_tray_icon(Some(&v)));
    }

    #[test]
    fn returns_false_when_explicitly_set_to_false() {
        let v = json!({ "general": { "showTrayIcon": false } });
        assert!(!parse_show_tray_icon(Some(&v)));
    }

    #[test]
    fn returns_true_when_explicitly_set_to_true() {
        let v = json!({ "general": { "showTrayIcon": true } });
        assert!(parse_show_tray_icon(Some(&v)));
    }
}

#[cfg(test)]
mod dock_icon_preference_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn returns_false_by_default_when_settings_root_is_none() {
        assert!(!parse_show_dock_icon(None));
    }

    #[test]
    fn returns_false_by_default_when_general_key_missing() {
        let v = json!({ "appearance": { "theme": "dark" } });
        assert!(!parse_show_dock_icon(Some(&v)));
    }

    #[test]
    fn returns_false_by_default_when_show_dock_icon_key_missing() {
        let v = json!({ "general": { "startAtLogin": true } });
        assert!(!parse_show_dock_icon(Some(&v)));
    }

    #[test]
    fn returns_true_when_explicitly_set_to_true() {
        let v = json!({ "general": { "showDockIcon": true } });
        assert!(parse_show_dock_icon(Some(&v)));
    }

    #[test]
    fn returns_false_when_explicitly_set_to_false() {
        let v = json!({ "general": { "showDockIcon": false } });
        assert!(!parse_show_dock_icon(Some(&v)));
    }
}

#[cfg(test)]
mod theme_preference_str_tests {
    use super::*;

    #[test]
    fn maps_light_string_to_light() {
        assert_eq!(parse_theme_preference_str("light"), ThemePreference::Light);
    }

    #[test]
    fn maps_dark_string_to_dark() {
        assert_eq!(parse_theme_preference_str("dark"), ThemePreference::Dark);
    }

    #[test]
    fn maps_system_string_to_system() {
        assert_eq!(
            parse_theme_preference_str("system"),
            ThemePreference::System
        );
    }

    #[test]
    fn unknown_string_falls_back_to_system() {
        assert_eq!(
            parse_theme_preference_str("hot-pink"),
            ThemePreference::System
        );
    }
}
