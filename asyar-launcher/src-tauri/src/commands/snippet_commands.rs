//! Text snippet expansion commands.
//!
//! Syncs snippet definitions to the Rust listener, enables/disables
//! expansion, and checks macOS Accessibility permissions.

use crate::error::AppError;
use crate::AppState;
use std::sync::atomic::Ordering;
use tauri::AppHandle;

/// Syncs the active snippet definitions from the frontend into the Rust listener.
#[tauri::command]
pub fn sync_snippets_to_rust(
    snippets: Vec<(String, String)>,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let mut map = state.active_snippets.lock().map_err(|_| AppError::Lock)?;
    map.clear();
    for (keyword, expansion) in snippets {
        map.insert(keyword, expansion);
    }
    Ok(())
}

/// Enables or disables the snippet expansion listener.
#[tauri::command]
pub fn set_snippets_enabled(
    enabled: bool,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), AppError> {
    if enabled {
        if !check_snippet_permission() {
            return Err(AppError::Platform(
                "Background expansion requires Accessibility permission. Open System Settings → Privacy & Security → Accessibility and add Asyar, then try again.".to_string(),
            ));
        }
        // Start the listener thread exactly once (rdev::listen is not restartable)
        if !state.listener_started.swap(true, Ordering::Relaxed) {
            crate::snippets::start_listener(app_handle);
        }
    }
    state.snippets_enabled.store(enabled, Ordering::Relaxed);
    Ok(())
}

/// Returns `true` if the Accessibility permission required for snippets is granted (macOS only).
#[tauri::command]
pub fn check_snippet_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::is_accessibility_trusted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Opens the macOS Accessibility preferences pane so the user can grant permission.
#[tauri::command]
pub fn open_accessibility_preferences() {
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::open_accessibility_prefs();
    }
}

/// Registers or replaces an extension's shortcode → expansion map.
///
/// All keys are validated before any mutation; the call is atomic — either
/// every key is stored or none are.
#[tauri::command]
pub fn contribute_shortcodes(
    extension_id: String,
    map: crate::snippets::ShortcodeMap,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    contribute_shortcodes_inner(extension_id, map, &state)
}

pub(crate) fn contribute_shortcodes_inner(
    extension_id: String,
    map: crate::snippets::ShortcodeMap,
    state: &AppState,
) -> Result<(), AppError> {
    for k in map.keys() {
        if !crate::snippets::is_valid_shortcode_key(k, ":") {
            return Err(AppError::Platform(format!(
                "Invalid shortcode key \"{}\" (must match :[a-z0-9_+-]{{1,32}}:)",
                k
            )));
        }
    }
    let mut contributed = state
        .contributed_snippets
        .lock()
        .map_err(|_| AppError::Lock)?;
    contributed.insert(extension_id, map);
    Ok(())
}

/// Removes all shortcodes previously contributed by the given extension.
#[tauri::command]
pub fn revoke_shortcodes(
    extension_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    revoke_shortcodes_inner(extension_id, &state)
}

pub(crate) fn revoke_shortcodes_inner(
    extension_id: String,
    state: &AppState,
) -> Result<(), AppError> {
    let mut contributed = state
        .contributed_snippets
        .lock()
        .map_err(|_| AppError::Lock)?;
    contributed.remove(&extension_id);
    Ok(())
}

#[cfg(test)]
mod contribute_tests {
    use super::*;
    use crate::AppState;
    use std::collections::HashMap;
    use std::sync::atomic::AtomicBool;
    use std::sync::Mutex;

    fn fresh_state() -> AppState {
        AppState {
            focus_locked: AtomicBool::new(false),
            user_shortcuts: Mutex::new(HashMap::new()),
            launcher_shortcut: Mutex::new(String::from("Alt+Space")),
            snippets_enabled: AtomicBool::new(false),
            asyar_visible: AtomicBool::new(false),
            launcher_keep_expanded: AtomicBool::new(false),
            active_snippets: Mutex::new(HashMap::new()),
            contributed_snippets: Mutex::new(HashMap::new()),
            shortcode_triggers: Mutex::new(vec![]),
            listener_started: AtomicBool::new(false),
            #[cfg(target_os = "windows")]
            previous_hwnd: Mutex::new(0),
            #[cfg(target_os = "linux")]
            linux_prev_window_id: Mutex::new(0),
            is_expanding: AtomicBool::new(false),
            #[cfg(target_os = "linux")]
            launcher_shown_at: Mutex::new(None),
        }
    }

    #[test]
    fn contribute_stores_under_namespace() {
        let state = fresh_state();
        let mut map = HashMap::new();
        map.insert(":party:".to_string(), "🎉".to_string());

        contribute_shortcodes_inner("org.asyar.emoji".to_string(), map.clone(), &state).unwrap();

        let contributed = state.contributed_snippets.lock().unwrap();
        assert_eq!(
            contributed
                .get("org.asyar.emoji")
                .map(|m| m.get(":party:").cloned()),
            Some(Some("🎉".to_string())),
        );
    }

    #[test]
    fn revoke_drops_only_the_callers_contribution() {
        let state = fresh_state();
        let mut a = HashMap::new();
        a.insert(":hi:".to_string(), "HI".to_string());
        let mut b = HashMap::new();
        b.insert(":bye:".to_string(), "BYE".to_string());

        contribute_shortcodes_inner("ext.a".into(), a, &state).unwrap();
        contribute_shortcodes_inner("ext.b".into(), b, &state).unwrap();

        revoke_shortcodes_inner("ext.a".into(), &state).unwrap();

        let contributed = state.contributed_snippets.lock().unwrap();
        assert!(contributed.get("ext.a").is_none());
        assert!(contributed.get("ext.b").is_some());
    }

    #[test]
    fn contribute_rejects_malformed_keys_atomically() {
        let state = fresh_state();
        let mut map = HashMap::new();
        map.insert(":good:".into(), "ok".into());
        map.insert(":BAD KEY:".into(), "no".into());

        let res = contribute_shortcodes_inner("ext.x".into(), map, &state);
        assert!(res.is_err());
        let contributed = state.contributed_snippets.lock().unwrap();
        assert!(contributed.get("ext.x").is_none());
    }
}
