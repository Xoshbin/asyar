use crate::AppState;
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
) -> Result<(), String> {
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
        Err(e) => Err(format!("Failed to register shortcut: {}", e)),
    }
}

pub(crate) fn parse_shortcut(shortcut_str: &str) -> Result<tauri_plugin_global_shortcut::Shortcut, String> {
    let parts: Vec<&str> = shortcut_str.split('+').collect();
    if parts.is_empty() {
        return Err("Invalid shortcut string".to_string());
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
            _ => return Err(format!("Invalid modifier: {}", parts[i])),
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
) -> Result<(), String> {
    let shortcut_str = format!("{}+{}", modifier, key);
    
    // Check conflict with launcher shortcut
    let launcher_shortcut = state.launcher_shortcut.lock().unwrap();
    if *launcher_shortcut == shortcut_str {
        return Err("Shortcut conflicts with launcher toggle".to_string());
    }
    drop(launcher_shortcut);

    let new_shortcut = parse_shortcut(&shortcut_str)?;
    
    // Insert into state, removing any existing for this shortcut
    let mut user_shortcuts = state.user_shortcuts.lock().unwrap();
    if user_shortcuts.contains_key(&shortcut_str) {
        return Err("Shortcut already in use by another item".to_string());
    }

    let shortcut_manager = app_handle.global_shortcut();
    match shortcut_manager.register(new_shortcut) {
        Ok(_) => {
            user_shortcuts.insert(shortcut_str, object_id);
            Ok(())
        },
        Err(e) => Err(format!("Failed to register shortcut: {}", e)),
    }
}

#[tauri::command]
pub fn unregister_item_shortcut(
    app_handle: AppHandle,
    modifier: String,
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
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
) -> Result<(), String> {
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
) -> Result<(), String> {
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
pub(crate) fn get_code_from_string(key: &str) -> Result<Code, String> {
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
        _ => Err(format!("Invalid key: {}", key)),
    }
}

/// Get the persisted shortcut from the frontend settings service
#[tauri::command]
pub async fn get_persisted_shortcut() -> Result<ShortcutConfig, String> {
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
) -> Result<(), String> {
    info!(
        "Initializing shortcut from settings: {} + {}",
        modifier, key
    );
    // Re-use the existing update function
    update_global_shortcut(app_handle, modifier, key, state).await
}
