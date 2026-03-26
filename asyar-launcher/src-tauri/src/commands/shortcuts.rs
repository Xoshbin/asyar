use crate::AppState;
use crate::error::AppError;
use log::info;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShortcutConfig {
    pub modifier: String,
    pub key: String,
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            modifier: "Super".to_string(),
            key: "K".to_string(),
        }
    }
}

/// Updates the global shortcut configuration
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

    let mut launcher_shortcut = state.launcher_shortcut.lock().unwrap();

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
    for i in 0..parts.len()-1 {
        match parts[i] {
            "Super" => modifier |= Modifiers::SUPER,
            "Shift" => modifier |= Modifiers::SHIFT,
            "Control" => modifier |= Modifiers::CONTROL,
            "Alt" => modifier |= Modifiers::ALT,
            _ => return Err(AppError::Shortcut(format!("Invalid modifier: {}", parts[i]))),
        }
    }

    if modifier.is_empty() {
        Ok(tauri_plugin_global_shortcut::Shortcut::new(None, code))
    } else {
        Ok(tauri_plugin_global_shortcut::Shortcut::new(Some(modifier), code))
    }
}

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
    let launcher_shortcut = state.launcher_shortcut.lock().unwrap();
    if *launcher_shortcut == shortcut_str {
        return Err(AppError::Shortcut("Shortcut conflicts with launcher toggle".to_string()));
    }
    drop(launcher_shortcut);

    let new_shortcut = parse_shortcut(&shortcut_str)?;
    
    // Insert into state, removing any existing for this shortcut
    let mut user_shortcuts = state.user_shortcuts.lock().unwrap();
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
    
    let mut user_shortcuts = state.user_shortcuts.lock().unwrap();
    user_shortcuts.remove(&shortcut_str);
    
    Ok(())
}

/// Temporarily unregisters all user shortcuts from the OS so key events flow to the browser.
/// Call this when the ShortcutCapture UI is open.
#[tauri::command]
pub fn pause_user_shortcuts(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let user_shortcuts = state.user_shortcuts.lock().unwrap();
    let shortcut_manager = app_handle.global_shortcut();
    for shortcut_str in user_shortcuts.keys() {
        if let Ok(shortcut) = parse_shortcut(shortcut_str) {
            // Ignore errors — shortcut may already be unregistered
            let _ = shortcut_manager.unregister(shortcut);
        }
    }
    Ok(())
}

/// Re-registers all user shortcuts with the OS after ShortcutCapture is closed.
#[tauri::command]
pub fn resume_user_shortcuts(
    app_handle: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
    let user_shortcuts = state.user_shortcuts.lock().unwrap();
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

/// Get the persisted shortcut from the frontend settings service
#[tauri::command]
pub async fn get_persisted_shortcut() -> Result<ShortcutConfig, AppError> {
    // This will be called by the frontend to provide the persisted shortcut
    Ok(ShortcutConfig::default()) // Default for type compatibility
}

/// Initialize the shortcut based on the persisted settings
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
    fn test_parse_super_k() {
        assert!(parse_shortcut("Super+K").is_ok());
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
}

