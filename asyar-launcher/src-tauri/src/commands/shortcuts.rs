//! Global and per-item keyboard shortcut commands.
//!
//! Handles registering, unregistering, pausing, and persisting shortcuts.

use crate::AppState;
use crate::error::AppError;
use log::info;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState};
use std::sync::atomic::Ordering;
use crate::SPOTLIGHT_LABEL;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShortcutConfig {
    pub modifier: String,
    pub key: String,
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            modifier: "Alt".to_string(),
            key: "Space".to_string(),
        }
    }
}

/// Replaces the global launcher shortcut with a new modifier+key combination.
#[tauri::command]
pub async fn update_global_shortcut(
    app_handle: AppHandle,
    modifier: String,
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    // Get the global shortcut manager
    let shortcut_manager = app_handle.global_shortcut();

    let new_shortcut_str = format!("{}+{}", modifier, key);
    let new_shortcut = parse_shortcut(&new_shortcut_str)?;

    let mut launcher_shortcut = state.launcher_shortcut.lock().map_err(|_| AppError::Lock)?;

    // Try to unregister whatever the user previously configured, ignoring errors since it might not be registered
    if let Ok(old_shortcut) = parse_shortcut(&launcher_shortcut) {
        let _ = shortcut_manager.unregister(old_shortcut);
    }

    // Register the new shortcut
    match shortcut_manager.register(new_shortcut) {
        Ok(_) => {
            *launcher_shortcut = new_shortcut_str;
            Ok(())
        },
        Err(e) => Err(AppError::Shortcut(format!("Failed to register shortcut: {}", e))),
    }
}

pub(crate) fn parse_shortcut(shortcut_str: &str) -> Result<tauri_plugin_global_shortcut::Shortcut, AppError> {
    let parts: Vec<&str> = shortcut_str.split('+').collect();
    if parts.is_empty() {
        return Err(AppError::Shortcut("Invalid shortcut string".to_string()));
    }

    let key_str = parts.last().unwrap();
    let code = get_code_from_string(key_str)?;

    let mut modifier = Modifiers::empty();
    for part in parts.iter().take(parts.len() - 1) {
        match *part {
            "Super" => modifier |= Modifiers::SUPER,
            "Shift" => modifier |= Modifiers::SHIFT,
            "Control" => modifier |= Modifiers::CONTROL,
            "Alt" => modifier |= Modifiers::ALT,
            _ => return Err(AppError::Shortcut(format!("Invalid modifier: {}", part))),
        }
    }

    if modifier.is_empty() {
        Ok(tauri_plugin_global_shortcut::Shortcut::new(None, code))
    } else {
        Ok(tauri_plugin_global_shortcut::Shortcut::new(Some(modifier), code))
    }
}

/// Registers a global shortcut that activates a specific search result item.
#[tauri::command]
pub fn register_item_shortcut(
    app_handle: AppHandle,
    modifier: String,
    key: String,
    object_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let shortcut_str = format!("{}+{}", modifier, key);
    
    // Check conflict with launcher shortcut
    let launcher_shortcut = state.launcher_shortcut.lock().map_err(|_| AppError::Lock)?;
    if *launcher_shortcut == shortcut_str {
        return Err(AppError::Shortcut("Shortcut conflicts with launcher toggle".to_string()));
    }
    drop(launcher_shortcut);

    let new_shortcut = parse_shortcut(&shortcut_str)?;
    
    // Insert into state, removing any existing for this shortcut
    let mut user_shortcuts = state.user_shortcuts.lock().map_err(|_| AppError::Lock)?;
    if user_shortcuts.contains_key(&shortcut_str) {
        return Err(AppError::Shortcut("Shortcut already in use by another item".to_string()));
    }

    let shortcut_manager = app_handle.global_shortcut();
    match shortcut_manager.register(new_shortcut) {
        Ok(_) => {
            user_shortcuts.insert(shortcut_str, object_id);
            Ok(())
        },
        Err(e) => Err(AppError::Shortcut(format!("Failed to register shortcut: {}", e))),
    }
}

/// Unregisters a previously registered item shortcut.
#[tauri::command]
pub fn unregister_item_shortcut(
    app_handle: AppHandle,
    modifier: String,
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let shortcut_str = format!("{}+{}", modifier, key);
    
    if let Ok(shortcut) = parse_shortcut(&shortcut_str) {
        let shortcut_manager = app_handle.global_shortcut();
        let _ = shortcut_manager.unregister(shortcut);
    }
    
    let mut user_shortcuts = state.user_shortcuts.lock().map_err(|_| AppError::Lock)?;
    user_shortcuts.remove(&shortcut_str);
    
    Ok(())
}

/// Temporarily pauses all user-defined item shortcuts (e.g. while recording a new one).
#[tauri::command]
pub fn pause_user_shortcuts(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let user_shortcuts = state.user_shortcuts.lock().map_err(|_| AppError::Lock)?;
    let shortcut_manager = app_handle.global_shortcut();
    for shortcut_str in user_shortcuts.keys() {
        if let Ok(shortcut) = parse_shortcut(shortcut_str) {
            // Ignore errors — shortcut may already be unregistered
            let _ = shortcut_manager.unregister(shortcut);
        }
    }
    Ok(())
}

/// Resumes all user-defined item shortcuts after a pause.
#[tauri::command]
pub fn resume_user_shortcuts(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let user_shortcuts = state.user_shortcuts.lock().map_err(|_| AppError::Lock)?;
    let shortcut_manager = app_handle.global_shortcut();
    for (shortcut_str, _object_id) in user_shortcuts.iter() {
        if let Ok(shortcut) = parse_shortcut(shortcut_str) {
            // Ignore errors — shortcut may already be registered
            let _ = shortcut_manager.register(shortcut);
        }
    }
    Ok(())
}

/// Helper function to convert string to Code enum
pub(crate) fn get_code_from_string(key: &str) -> Result<Code, AppError> {
    match key {
        "A" => Ok(Code::KeyA),
        "B" => Ok(Code::KeyB),
        "C" => Ok(Code::KeyC),
        "D" => Ok(Code::KeyD),
        "E" => Ok(Code::KeyE),
        "F" => Ok(Code::KeyF),
        "G" => Ok(Code::KeyG),
        "H" => Ok(Code::KeyH),
        "I" => Ok(Code::KeyI),
        "J" => Ok(Code::KeyJ),
        "K" => Ok(Code::KeyK),
        "L" => Ok(Code::KeyL),
        "M" => Ok(Code::KeyM),
        "N" => Ok(Code::KeyN),
        "O" => Ok(Code::KeyO),
        "P" => Ok(Code::KeyP),
        "Q" => Ok(Code::KeyQ),
        "R" => Ok(Code::KeyR),
        "S" => Ok(Code::KeyS),
        "T" => Ok(Code::KeyT),
        "U" => Ok(Code::KeyU),
        "V" => Ok(Code::KeyV),
        "W" => Ok(Code::KeyW),
        "X" => Ok(Code::KeyX),
        "Y" => Ok(Code::KeyY),
        "Z" => Ok(Code::KeyZ),
        "0" => Ok(Code::Digit0),
        "1" => Ok(Code::Digit1),
        "2" => Ok(Code::Digit2),
        "3" => Ok(Code::Digit3),
        "4" => Ok(Code::Digit4),
        "5" => Ok(Code::Digit5),
        "6" => Ok(Code::Digit6),
        "7" => Ok(Code::Digit7),
        "8" => Ok(Code::Digit8),
        "9" => Ok(Code::Digit9),
        "F1" => Ok(Code::F1),
        "F2" => Ok(Code::F2),
        "F3" => Ok(Code::F3),
        "F4" => Ok(Code::F4),
        "F5" => Ok(Code::F5),
        "F6" => Ok(Code::F6),
        "F7" => Ok(Code::F7),
        "F8" => Ok(Code::F8),
        "F9" => Ok(Code::F9),
        "F10" => Ok(Code::F10),
        "F11" => Ok(Code::F11),
        "F12" => Ok(Code::F12),
        "Space" => Ok(Code::Space),
        _ => Err(AppError::Shortcut(format!("Invalid key: {}", key))),
    }
}

/// Convert a keyboard `Code` to its canonical string representation.
/// Inverse of `get_code_from_string`.
pub(crate) fn code_to_str(code: Code) -> &'static str {
    match code {
        Code::KeyA => "A",
        Code::KeyB => "B",
        Code::KeyC => "C",
        Code::KeyD => "D",
        Code::KeyE => "E",
        Code::KeyF => "F",
        Code::KeyG => "G",
        Code::KeyH => "H",
        Code::KeyI => "I",
        Code::KeyJ => "J",
        Code::KeyK => "K",
        Code::KeyL => "L",
        Code::KeyM => "M",
        Code::KeyN => "N",
        Code::KeyO => "O",
        Code::KeyP => "P",
        Code::KeyQ => "Q",
        Code::KeyR => "R",
        Code::KeyS => "S",
        Code::KeyT => "T",
        Code::KeyU => "U",
        Code::KeyV => "V",
        Code::KeyW => "W",
        Code::KeyX => "X",
        Code::KeyY => "Y",
        Code::KeyZ => "Z",
        Code::Digit0 => "0",
        Code::Digit1 => "1",
        Code::Digit2 => "2",
        Code::Digit3 => "3",
        Code::Digit4 => "4",
        Code::Digit5 => "5",
        Code::Digit6 => "6",
        Code::Digit7 => "7",
        Code::Digit8 => "8",
        Code::Digit9 => "9",
        Code::F1 => "F1",
        Code::F2 => "F2",
        Code::F3 => "F3",
        Code::F4 => "F4",
        Code::F5 => "F5",
        Code::F6 => "F6",
        Code::F7 => "F7",
        Code::F8 => "F8",
        Code::F9 => "F9",
        Code::F10 => "F10",
        Code::F11 => "F11",
        Code::F12 => "F12",
        Code::Space => "Space",
        _ => "",
    }
}

/// Handle a global shortcut event. Called from the global shortcut plugin in lib.rs.
/// - If the shortcut matches a user-registered item shortcut, emits `user-shortcut-fired`.
/// - Otherwise, toggles the launcher window visibility.
pub fn handle_shortcut(app: &tauri::AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state() != ShortcutState::Pressed {
        return;
    }

    let key_str = code_to_str(shortcut.key);
    if key_str.is_empty() {
        return;
    }

    let state = app.state::<AppState>();
    
    // Build canonical string: "Modifier+Key" (e.g., "Super+K", "Ctrl+Shift+A")
    let mut canonical_parts = Vec::new();
    let mods = shortcut.mods;
    if mods.contains(Modifiers::SUPER) { canonical_parts.push("Super"); }
    if mods.contains(Modifiers::CONTROL) { canonical_parts.push("Control"); }
    if mods.contains(Modifiers::ALT) { canonical_parts.push("Alt"); }
    if mods.contains(Modifiers::SHIFT) { canonical_parts.push("Shift"); }
    canonical_parts.push(key_str);
    let canonical = canonical_parts.join("+");

    // Check user item shortcuts
    if let Ok(user_shortcuts) = state.user_shortcuts.lock() {
        if let Some(object_id) = user_shortcuts.get(&canonical) {
            let _ = app.emit("user-shortcut-fired", object_id.clone());
            return;
        }
    }

    let Some(window) = app.get_webview_window(SPOTLIGHT_LABEL) else { return; };

    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;
        let Ok(panel) = app.get_webview_panel(SPOTLIGHT_LABEL) else { return; };
        if panel.is_visible() {
            state.asyar_visible.store(false, Ordering::Relaxed);
            panel.order_out(None);
        } else {
            state.asyar_visible.store(true, Ordering::Relaxed);
            let _ = crate::platform::macos::center_at_cursor_monitor(&window);
            panel.show();
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        if window.is_visible().unwrap_or(false) {
            state.asyar_visible.store(false, Ordering::Relaxed);
            let _ = window.hide();
            #[cfg(target_os = "windows")]
            if let Ok(hwnd) = state.previous_hwnd.lock() {
                crate::platform::windows::restore_foreground_window(*hwnd);
            }
        } else {
            #[cfg(target_os = "windows")]
            if let Ok(mut hwnd) = state.previous_hwnd.lock() {
                *hwnd = crate::platform::windows::capture_foreground_window();
            }
            state.asyar_visible.store(true, Ordering::Relaxed);
            #[cfg(target_os = "windows")]
            let _ = crate::platform::windows::setup_spotlight_window(&window);
            #[cfg(target_os = "linux")]
            let _ = crate::platform::linux::setup_spotlight_window(&window);
            
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

/// Returns the currently persisted global shortcut configuration from disk.
#[tauri::command]
pub async fn get_persisted_shortcut() -> Result<ShortcutConfig, AppError> {
    // This will be called by the frontend to provide the persisted shortcut
    Ok(ShortcutConfig::default()) // Default for type compatibility
}

/// Registers the global shortcut from saved settings on app startup.
#[tauri::command]
pub async fn initialize_shortcut_from_settings(
    app_handle: AppHandle,
    modifier: String,
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    info!(
        "Initializing shortcut from settings: {} + {}",
        modifier, key
    );
    // Re-use the existing update function
    update_global_shortcut(app_handle, modifier, key, state).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::Code;

    // --- get_code_from_string ---

    #[test]
    fn test_code_letter_a() {
        assert!(matches!(get_code_from_string("A"), Ok(Code::KeyA)));
    }

    #[test]
    fn test_code_letter_z() {
        assert!(matches!(get_code_from_string("Z"), Ok(Code::KeyZ)));
    }

    #[test]
    fn test_code_digit_0() {
        assert!(matches!(get_code_from_string("0"), Ok(Code::Digit0)));
    }

    #[test]
    fn test_code_digit_9() {
        assert!(matches!(get_code_from_string("9"), Ok(Code::Digit9)));
    }

    #[test]
    fn test_code_space() {
        assert!(matches!(get_code_from_string("Space"), Ok(Code::Space)));
    }

    #[test]
    fn test_code_f1() {
        assert!(matches!(get_code_from_string("F1"), Ok(Code::F1)));
    }

    #[test]
    fn test_code_f12() {
        assert!(matches!(get_code_from_string("F12"), Ok(Code::F12)));
    }

    #[test]
    fn test_code_invalid_key_returns_err() {
        let result = get_code_from_string("InvalidKey");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Shortcut(_)));
    }

    #[test]
    fn test_code_empty_string_returns_err() {
        let result = get_code_from_string("");
        assert!(result.is_err());
    }

    // --- parse_shortcut ---

    #[test]
    fn test_parse_alt_space() {
        assert!(parse_shortcut("Alt+Space").is_ok());
    }

    #[test]
    fn test_parse_shift_a() {
        assert!(parse_shortcut("Shift+A").is_ok());
    }

    #[test]
    fn test_parse_control_space() {
        assert!(parse_shortcut("Control+Space").is_ok());
    }

    #[test]
    fn test_parse_alt_f4() {
        assert!(parse_shortcut("Alt+F4").is_ok());
    }

    #[test]
    fn test_parse_multiple_modifiers() {
        assert!(parse_shortcut("Shift+Control+A").is_ok());
    }

    #[test]
    fn test_parse_invalid_modifier_returns_err() {
        let result = parse_shortcut("Windows+K");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Shortcut(_)));
    }

    #[test]
    fn test_parse_invalid_key_returns_err() {
        let result = parse_shortcut("Super+InvalidKey");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_key_only_no_modifier() {
        // A single key with no modifier — parse_shortcut should still produce a valid Shortcut
        // (modifier = None). It is up to the OS to reject or accept it; parse alone should succeed.
        assert!(parse_shortcut("A").is_ok());
    }

    #[test]
    fn test_code_to_str_letters() {
        assert_eq!(code_to_str(Code::KeyA), "A");
        assert_eq!(code_to_str(Code::KeyZ), "Z");
        assert_eq!(code_to_str(Code::KeyM), "M");
    }

    #[test]
    fn test_code_to_str_digits() {
        assert_eq!(code_to_str(Code::Digit0), "0");
        assert_eq!(code_to_str(Code::Digit9), "9");
    }

    #[test]
    fn test_code_to_str_function_keys() {
        assert_eq!(code_to_str(Code::F1), "F1");
        assert_eq!(code_to_str(Code::F12), "F12");
    }

    #[test]
    fn test_code_to_str_space() {
        assert_eq!(code_to_str(Code::Space), "Space");
    }

    #[test]
    fn test_code_to_str_unknown() {
        assert_eq!(code_to_str(Code::Escape), "");
    }

    #[test]
    fn test_code_roundtrip() {
        // Every string that get_code_from_string accepts should round-trip through code_to_str
        let keys = vec![
            "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
            "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
            "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
            "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
            "Space",
        ];
        for key in keys {
            let code = get_code_from_string(key).unwrap();
            assert_eq!(code_to_str(code), key, "Round-trip failed for key: {}", key);
        }
    }
}

