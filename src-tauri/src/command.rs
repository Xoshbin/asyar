use enigo::{Enigo, KeyboardControllable};
use log::info;
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, Modifiers, GlobalShortcutExt};
use tauri_nspanel::ManagerExt;
use serde::{Deserialize, Serialize};

use crate::SPOTLIGHT_LABEL;

#[tauri::command]
pub fn show(app_handle: AppHandle) {
    let panel = app_handle.get_webview_panel(SPOTLIGHT_LABEL).unwrap();
    panel.show();
}

#[tauri::command]
pub fn hide(app_handle: AppHandle) {
    let panel = app_handle.get_webview_panel(SPOTLIGHT_LABEL).unwrap();
    if panel.is_visible() {
        panel.order_out(None);
    }
}

#[tauri::command]
pub fn simulate_paste() {
    let mut enigo = Enigo::new();
    // Simulate CMD+V (⌘+V) on macOS
    enigo.key_down(enigo::Key::Meta);
    enigo.key_click(enigo::Key::Layout('v'));
    enigo.key_up(enigo::Key::Meta);
}

#[derive(Debug)]
struct AppScanner {
    paths: Vec<String>,
}

impl AppScanner {
    fn new() -> Self {
        Self { paths: Vec::new() }
    }

    fn scan_directory(&mut self, dir_path: &Path) -> Result<(), String> {
        if !dir_path.exists() {
            return Ok(());
        }

        match fs::read_dir(dir_path) {
            Ok(entries) => {
                for entry in entries.filter_map(Result::ok) {
                    if let Ok(file_type) = entry.file_type() {
                        if file_type.is_dir() {
                            if let Some(path_str) = entry.path().to_str() {
                                if path_str.ends_with(".app") {
                                    self.paths.push(path_str.to_string());
                                }
                            }
                        }
                    }
                }
                Ok(())
            }
            Err(err) => Err(format!("Error reading directory: {}", err)),
        }
    }

    fn scan_all(&mut self) -> Result<(), String> {
        let directories = ["/Applications", "/System/Applications"];

        for dir in directories.iter() {
            if let Err(e) = self.scan_directory(Path::new(dir)) {
                info!("Error scanning {}: {}", dir, e);
            }
        }

        Ok(())
    }
}

#[tauri::command]
pub fn list_applications() -> Result<Vec<String>, String> {
    let mut scanner = AppScanner::new();
    scanner.scan_all()?;
    Ok(scanner.paths)
}

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
) -> Result<(), String> {
    // Convert the modifier string to Modifiers enum
    let mod_key = match modifier.as_str() {
        "Super" => Modifiers::SUPER,
        "Shift" => Modifiers::SHIFT,
        "Control" => Modifiers::CONTROL,
        "Alt" => Modifiers::ALT,
        _ => return Err(format!("Invalid modifier: {}", modifier)),
    };

    // Convert the key string to Code enum
    let code = get_code_from_string(&key)?;

    // Get the global shortcut manager
    let shortcut_manager = app_handle.global_shortcut();

    // Unregister all current shortcuts
    if let Err(e) = shortcut_manager.unregister_all() {
        return Err(format!("Failed to unregister shortcuts: {}", e));
    }

    // Register the new shortcut
    match shortcut_manager.register(tauri_plugin_global_shortcut::Shortcut::new(Some(mod_key), code)) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to register shortcut: {}", e)),
    }
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
pub async fn initialize_shortcut_from_settings(app_handle: AppHandle, modifier: String, key: String) -> Result<(), String> {
    info!("Initializing shortcut from settings: {} + {}", modifier, key);
    // Re-use the existing update function
    update_global_shortcut(app_handle, modifier, key).await
}

#[tauri::command]
pub async fn initialize_autostart_from_settings(app_handle: AppHandle, enable: bool) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        
        let autostart_manager = app_handle.autolaunch();
        let current_status = autostart_manager.is_enabled().unwrap_or(false);
        
        info!("Initializing autostart: should be {}, currently {}", enable, current_status);
        
        if enable && !current_status {
            if let Err(e) = autostart_manager.enable() {
                return Err(format!("Failed to enable autostart: {}", e));
            }
        } else if !enable && current_status {
            if let Err(e) = autostart_manager.disable() {
                return Err(format!("Failed to disable autostart: {}", e));
            }
        }
        
        // Verify the change was successful
        let new_status = autostart_manager.is_enabled().unwrap_or(false);
        if new_status != enable {
            return Err(format!("Failed to set autostart: expected {}, got {}", enable, new_status));
        }
    }
    
    Ok(())
}

#[tauri::command]
pub async fn get_autostart_status(app_handle: AppHandle) -> Result<bool, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        
        let autostart_manager = app_handle.autolaunch();
        match autostart_manager.is_enabled() {
            Ok(enabled) => return Ok(enabled),
            Err(e) => return Err(format!("Failed to get autostart status: {}", e)),
        }
    }
    
    #[cfg(not(desktop))]
    {
        return Ok(false);
    }
}
