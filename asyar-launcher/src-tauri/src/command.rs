use crate::{search_engine::models::Application, SPOTLIGHT_LABEL};
use enigo::{Enigo, KeyboardControllable};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use crate::AppState;
use std::sync::atomic::Ordering;
use std::path::PathBuf; // Added PathBuf
use tauri::{AppHandle, Manager, Emitter}; // Added Manager and Emitter
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use crate::tray::TRAY_ID;
use tauri_nspanel::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers};
use futures_util::StreamExt; // For stream handling
use tempfile::NamedTempFile; // For temporary files
use async_zip::tokio::read::seek::ZipFileReader; // Use the seek reader
use tokio::fs::File as TokioFile; // Use Tokio's File for async operations
use tokio::io::BufReader; // Import BufReader
use tokio::io::AsyncWriteExt; // Import AsyncWriteExt for copy
use tokio_util::compat::FuturesAsyncReadCompatExt;

use std::collections::HashMap;
use std::sync::Mutex;

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
                    if let Some(path_str) = entry.path().to_str() {
                        if is_app_bundle(&entry.path()) {
                            self.paths.push(path_str.to_string());
                        }
                    }
                }
                Ok(())
            }
            Err(err) => Err(format!("Error reading directory: {}", err)),
        }
    }

    fn scan_all(&mut self) -> Result<(), String> {
        let directories = get_app_scan_paths();

        for dir in directories.iter() {
            if let Err(e) = self.scan_directory(Path::new(dir)) {
                info!("Error scanning {:?}: {}", dir, e);
            }
        }

        Ok(())
    }
}

fn get_app_scan_paths() -> Vec<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    {
        vec![
            std::path::PathBuf::from("/Applications"),
            std::path::PathBuf::from("/System/Applications"),
        ]
    }
    #[cfg(target_os = "linux")]
    {
        let mut paths = vec![
            std::path::PathBuf::from("/usr/share/applications"),
        ];
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join(".local/share/applications"));
        }
        paths
    }
    #[cfg(target_os = "windows")]
    {
        let mut paths = vec![];
        if let Ok(pf) = std::env::var("PROGRAMFILES") {
            paths.push(std::path::PathBuf::from(pf));
        }
        if let Ok(pf86) = std::env::var("PROGRAMFILES(X86)") {
            paths.push(std::path::PathBuf::from(pf86));
        }
        paths
    }
}

fn is_app_bundle(path: &std::path::Path) -> bool {
    #[cfg(target_os = "macos")]
    { path.extension().map(|e| e == "app").unwrap_or(false) }

    #[cfg(target_os = "linux")]
    { path.extension().map(|e| e == "desktop").unwrap_or(false) }

    #[cfg(target_os = "windows")]
    { path.extension().map(|e| e == "exe").unwrap_or(false) }
}

fn extract_app_icon(app_path: &str, cache_dir: &std::path::Path) -> Option<String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    // Derive a safe cache filename from the path
    let cache_key = app_path
        .replace(['/', '\\', ':', ' '], "_")
        .replace(".app", "")
        .replace(".desktop", "")
        .replace(".exe", "");
    let cache_file = cache_dir.join(format!("{}.png", &cache_key[..cache_key.len().min(200)]));

    // Return cached icon if available
    if cache_file.exists() {
        if let Ok(bytes) = std::fs::read(&cache_file) {
            return Some(format!("data:image/png;base64,{}", STANDARD.encode(&bytes)));
        }
    }

    // Extract icon — platform-specific
    let png_bytes: Option<Vec<u8>> = extract_icon_bytes(app_path);

    // Save to cache and return
    if let Some(ref bytes) = png_bytes {
        let _ = std::fs::create_dir_all(cache_dir);
        let _ = std::fs::write(&cache_file, bytes);
        return Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)));
    }

    None
}

fn extract_icon_bytes(app_path: &str) -> Option<Vec<u8>> {
    #[cfg(target_os = "macos")]
    {
        extract_icon_macos(app_path)
    }
    #[cfg(target_os = "linux")]
    {
        extract_icon_linux(app_path)
    }
    #[cfg(target_os = "windows")]
    {
        extract_icon_windows(app_path)
    }
}

#[cfg(target_os = "macos")]
fn extract_icon_macos(app_path: &str) -> Option<Vec<u8>> {
    use std::path::Path;

    let app = Path::new(app_path);
    let plist_path = app.join("Contents/Info.plist");

    // Read CFBundleIconFile from Info.plist
    let icon_name: String = plist::from_file::<_, plist::Value>(&plist_path)
        .ok()
        .and_then(|v| v.into_dictionary())
        .and_then(|d| d.get("CFBundleIconFile").cloned())
        .and_then(|v| v.into_string())
        .unwrap_or_else(|| "AppIcon".to_string());

    // Add .icns extension if missing
    let icon_filename = if icon_name.ends_with(".icns") {
        icon_name
    } else {
        format!("{}.icns", icon_name)
    };

    let icns_path = app.join("Contents/Resources").join(&icon_filename);

    // Fall back to scanning Resources for any .icns file
    let icns_path = if icns_path.exists() {
        icns_path
    } else {
        let resources_dir = app.join("Contents/Resources");
        std::fs::read_dir(&resources_dir)
            .ok()?
            .filter_map(|e| e.ok())
            .find(|e| e.path().extension().map(|x| x == "icns").unwrap_or(false))
            .map(|e| e.path())?
    };

    // Parse .icns and extract a 32x32 (or best available) PNG image
    let file = std::fs::File::open(&icns_path).ok()?;
    let icon_family = icns::IconFamily::read(file).ok()?;

    // Preferred sizes in order: 32x32, 64x64, 128x128, 16x16
    let preferred = [
        icns::IconType::RGB24_32x32,
        icns::IconType::RGBA32_32x32,
        icns::IconType::RGBA32_64x64,
        icns::IconType::RGBA32_128x128,
        icns::IconType::RGB24_16x16,
    ];

    for icon_type in &preferred {
        if let Ok(image) = icon_family.get_icon_with_type(*icon_type) {
            let mut buf = std::io::Cursor::new(Vec::new());
            if image.write_png(&mut buf).is_ok() {
                return Some(buf.into_inner());
            }
        }
    }

    // If no preferred type found, try any available image in the family
    for icon_type in icon_family.available_icons() {
        if let Ok(image) = icon_family.get_icon_with_type(icon_type) {
            let mut buf = std::io::Cursor::new(Vec::new());
            if image.write_png(&mut buf).is_ok() {
                return Some(buf.into_inner());
            }
        }
    }

    None
}

#[cfg(target_os = "linux")]
fn extract_icon_linux(desktop_path: &str) -> Option<Vec<u8>> {
    use std::io::{BufRead, BufReader};

    // Parse .desktop file for Icon= entry
    let file = std::fs::File::open(desktop_path).ok()?;
    let reader = BufReader::new(file);
    let icon_value = reader
        .lines()
        .filter_map(|l| l.ok())
        .find(|l| l.starts_with("Icon="))
        .map(|l| l[5..].trim().to_string())?;

    // If it's an absolute path, read it directly
    if icon_value.starts_with('/') {
        return std::fs::read(&icon_value).ok();
    }

    // Otherwise resolve from common icon theme directories
    let sizes = ["48", "32", "256", "128", "64", "22", "16"];
    let extensions = ["png", "xpm"];

    let search_dirs = vec![
        "/usr/share/icons/hicolor",
        "/usr/share/icons/Adwaita",
        "/usr/share/icons",
        "/usr/share/pixmaps",
    ];

    for base in &search_dirs {
        for size in &sizes {
            for ext in &extensions {
                let path = format!("{}/{}/apps/{}.{}", base, size, icon_value, ext);
                if let Ok(bytes) = std::fs::read(&path) {
                    return Some(bytes);
                }
                // Also try without size subdirectory (pixmaps)
                let path2 = format!("{}/{}.{}", base, icon_value, ext);
                if let Ok(bytes) = std::fs::read(&path2) {
                    return Some(bytes);
                }
            }
        }
    }

    None
}

// Modified list_applications to take State and update the in-memory cache
#[tauri::command]
pub fn list_applications(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::search_engine::SearchState>,
) -> Result<Vec<Application>, String> {
    let mut scanner = AppScanner::new();
    scanner.scan_all().map_err(|e| e.to_string())?;

    let icon_cache_dir = app.path().app_data_dir()
        .map(|p| p.join("icon_cache"))
        .unwrap_or_else(|_| std::path::PathBuf::from("/tmp/asyar_icon_cache"));

    let mut applications = Vec::new();

    for path_str in &scanner.paths {
        let name = Path::new(path_str)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("Unknown_App")
            .to_string();

        // --- Generate Full ID from Name and Path ---
        let sanitized_name = name.replace(|c: char| c == ' ' || c == '/', "_");
        let sanitized_path = path_str.replace(|c: char| c == ' ' || c == '/', "_");

        // Create the FULL object ID directly
        let full_app_id = format!("app_{}_{}", sanitized_name, sanitized_path);
        // --- End ID Generation ---

        applications.push(Application {
            id: full_app_id, // Store the FULL ID (e.g., "app_Name__Path...")
            name,
            path: path_str.clone(),
            usage_count: 0,
            icon: extract_app_icon(&path_str, &icon_cache_dir),
        });
    }

    // Update the in-memory SearchState with the newly extracted icons
    if let Ok(mut items) = state.items.lock() {
        for item in items.iter_mut() {
            if let crate::search_engine::models::SearchableItem::Application(app) = item {
                if let Some(fresh_app) = applications.iter().find(|a| a.id == app.id) {
                    app.icon = fresh_app.icon.clone();
                }
            }
        }
    }

    log::info!("Found {} applications", applications.len());
    Ok(applications)
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

/// Data structure for a single extension tray menu item.
/// `id` is composite: "extensionId:itemId" — used to route click events to the right extension.
#[derive(Debug, Serialize, Deserialize)]
pub struct TrayMenuItemDef {
    pub id: String,      // e.g., "org.asyar.pomodoro:timer-status"
    pub label: String,   // display text, e.g., "🍅 18:32"
}

/// Rebuilds the tray menu with current extension status items plus static Quit/Settings.
/// Called from the frontend whenever statusBarItemsStore changes.
#[tauri::command]
pub fn update_tray_menu(
    app_handle: AppHandle,
    items: Vec<TrayMenuItemDef>,
) -> Result<(), String> {
    let menu = Menu::new(&app_handle).map_err(|e| e.to_string())?;

    // Add extension status items at the top
    for item_def in &items {
        let menu_item = MenuItem::with_id(
            &app_handle,
            &item_def.id,
            &item_def.label,
            true,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        menu.append(&menu_item).map_err(|e| e.to_string())?;
    }

    // Separator between extension items and static items (only if there are extension items)
    if !items.is_empty() {
        let sep = PredefinedMenuItem::separator(&app_handle).map_err(|e| e.to_string())?;
        menu.append(&sep).map_err(|e| e.to_string())?;
    }

    // Static items always at the bottom
    let settings_i = MenuItem::with_id(&app_handle, "settings", "Settings", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit_i = MenuItem::with_id(&app_handle, "quit", "Quit Asyar", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    menu.append(&settings_i).map_err(|e| e.to_string())?;
    menu.append(&quit_i).map_err(|e| e.to_string())?;

    // Apply to the tray icon
    let tray = app_handle
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Tray icon not found".to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;

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

#[tauri::command]
pub async fn initialize_autostart_from_settings(
    app_handle: AppHandle,
    enable: bool,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;

        let autostart_manager = app_handle.autolaunch();
        let current_status = autostart_manager.is_enabled().unwrap_or(false);

        info!(
            "Initializing autostart: should be {}, currently {}",
            enable, current_status
        );

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
            return Err(format!(
                "Failed to set autostart: expected {}, got {}",
                enable, new_status
            ));
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

#[tauri::command]
pub async fn delete_extension_directory(path: String) -> Result<(), String> {
    println!("Deleting extension directory: {}", path);

    match fs::remove_dir_all(&path) {
        Ok(_) => {
            println!("Successfully deleted directory: {}", path);
            Ok(())
        }
        Err(e) => {
            eprintln!("Failed to delete directory: {} - {:?}", path, e);
            Err(format!("Failed to delete directory: {:?}", e))
        }
    }
}

#[tauri::command]
pub async fn check_path_exists(path: String) -> bool {
    println!("Checking if path exists: {}", path);
    Path::new(&path).exists()
}

// --- New Command: uninstall_extension ---
#[tauri::command]
pub async fn uninstall_extension(app_handle: AppHandle, extension_id: String) -> Result<(), String> {
    if extension_id.trim().is_empty() {
        return Err("Extension ID cannot be empty".to_string());
    }
    let extensions_dir = get_app_data_dir(&app_handle)?.join("extensions");
    let install_dir = extensions_dir.join(&extension_id);
    if !install_dir.exists() {
        return Err(format!("Extension '{}' is not installed", extension_id));
    }
    info!("Uninstalling extension '{}' at {:?}", extension_id, install_dir);
    std::fs::remove_dir_all(&install_dir)
        .map_err(|e| format!("Failed to remove extension directory: {}", e))
}

// --- New Command: install_extension_from_url ---
    
    #[tauri::command]
    pub async fn install_extension_from_url(
        app_handle: AppHandle,
        download_url: String,
        extension_id: String,
        extension_name: String, // Keep for logging/notifications
        version: String,        // Keep for logging/potential future use
        checksum: Option<String>,
    ) -> Result<(), String> {
        info!(
            "Attempting to install extension '{}' (ID: {}, Version: {}) from URL: {}",
            extension_name, extension_id, version, download_url
        );
        
        // Guard against empty values before doing anything
        if download_url.trim().is_empty() {
            return Err("Download URL is required and cannot be empty".to_string());
        }
        if extension_id.trim().is_empty() {
            return Err("Extension ID is required and cannot be empty".to_string());
        }

        // Validate URL format
        if !download_url.starts_with("https://") && !download_url.starts_with("http://") {
            return Err(format!("Invalid download URL: {}", download_url));
        }
    
        // --- 1. Determine Installation Directory ---
        let base_extensions_dir = match app_handle.path().app_data_dir() {
            Ok(dir) => dir.join("extensions"), // Handle Ok result
            Err(e) => { // Handle Err result
                return Err(format!(
                    "Could not determine the application data directory for extensions: {}", e
                ))
            }
        };
    
        // Create the base extensions directory if it doesn't exist
        if !base_extensions_dir.exists() {
            if let Err(e) = std::fs::create_dir_all(&base_extensions_dir) {
                return Err(format!(
                    "Failed to create base extensions directory {:?}: {}",
                    base_extensions_dir, e
                ));
            }
            info!("Created base extensions directory: {:?}", base_extensions_dir);
        }
    
        let install_dir = base_extensions_dir.join(&extension_id);
    
        // Clean up existing directory if it exists
        if install_dir.exists() {
            warn!(
                "Existing installation directory found for {}. Removing it first: {:?}",
                extension_id, install_dir
            );
            if let Err(e) = std::fs::remove_dir_all(&install_dir) {
                return Err(format!(
                    "Failed to remove existing extension directory {:?}: {}",
                    install_dir, e
                ));
            }
        }
    
        // --- 2. Download the Extension ---
        info!("Downloading extension from: {}", download_url);
        let temp_file = match download_to_temp_file(&download_url).await {
            Ok(file) => file,
            Err(e) => return Err(format!("Failed to download extension: {}", e)),
        };
        info!(
            "Extension downloaded successfully to temporary file: {:?}",
            temp_file.path()
        );

        if let Some(expected_checksum) = checksum {
            use sha2::{Digest, Sha256};
            use std::io::Read;

            let mut file = std::fs::File::open(temp_file.path())
                .map_err(|e| format!("Failed to open temp file for checksum: {}", e))?;
            let mut hasher = Sha256::new();
            let mut buffer = [0; 8192];
            loop {
                let count = file.read(&mut buffer)
                    .map_err(|e| format!("Failed to read temp file: {}", e))?;
                if count == 0 {
                    break;
                }
                hasher.update(&buffer[..count]);
            }
            let result = hasher.finalize();
            let calculated_checksum = format!("sha256:{:x}", result);
            
            if calculated_checksum != expected_checksum {
                return Err(format!(
                    "Checksum mismatch! Expected: {}, Calculated: {}",
                    expected_checksum, calculated_checksum
                ));
            }
            info!("Checksum verified successfully.");
        }
    
        // --- 3. Extract the Extension ---
        info!("Extracting extension to: {:?}", install_dir);
        if let Err(e) = extract_zip(temp_file.path(), &install_dir).await {
            // Clean up partially extracted files on error
            let _ = fs::remove_dir_all(&install_dir);
            return Err(format!("Failed to extract extension: {}", e));
        }
        info!(
            "Extension '{}' installed successfully to {:?}",
            extension_name, install_dir
        );
    
        // --- 4. (Optional) Emit event to frontend ---
        // This tells the frontend that an extension was installed, so it can reload.
        if let Err(e) = app_handle.emit("extensions_updated", ()) {
            warn!("Failed to emit extensions_updated event: {}", e);
            // Don't fail the whole installation for this, but log it.
        }
    
    
        Ok(())
    }
    
    async fn download_to_temp_file(url: &str) -> Result<NamedTempFile, String> {
        // Create a temporary file (still uses std::fs internally, but that's okay for creation)
        let temp_file = NamedTempFile::new().map_err(|e| format!("Failed to create temp file: {}", e))?;
        // Open the temp file using Tokio for async writing
        let mut dest = TokioFile::create(temp_file.path())
            .await // Use await for async open
            .map_err(|e| format!("Failed to open temp file for async writing: {}", e))?;
    
        // Make the HTTP request
        let response = reqwest::get(url)
            .await
            .map_err(|e| format!("Request failed: {}", e))?;
    
        if !response.status().is_success() {
            return Err(format!("Download failed: Status {}", response.status()));
        }
    
        // Stream the response body to the file
        let mut stream = response.bytes_stream();
        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| format!("Error reading download stream: {}", e))?;
            // Use async write_all
            dest.write_all(&chunk)
                .await // Use await for async write
                .map_err(|e| format!("Error writing to temp file: {}", e))?;
        }
    
        Ok(temp_file)
    }
    
    async fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), String> {
        // Ensure destination directory exists
        fs::create_dir_all(dest_dir)
            .map_err(|e| format!("Failed to create destination directory {:?}: {}", dest_dir, e))?;
    
        // Open the file asynchronously
        let file = TokioFile::open(zip_path)
            .await
            .map_err(|e| format!("Failed to open zip file {:?}: {}", zip_path, e))?;
        // Wrap it in a BufReader for seeking
        let mut buf_reader = BufReader::new(file);
        // Create the seek::ZipFileReader
        let mut zip = ZipFileReader::with_tokio(&mut buf_reader)
            .await
            .map_err(|e| format!("Failed to read zip archive {:?}: {}", zip_path, e))?;
    
    
        // Iterate over entries and extract them
        // Get the number of entries (immutable borrow before loop)
        // Get entries directly from the seek reader
        let entries = zip.file().entries().to_vec(); // Get entries via .file()
    // Iterate using enumerate to get both index and entry reference
    for (index, entry) in entries.iter().enumerate() {
        // We now have 'entry' directly from the cloned vector
            let entry_filename = entry.filename(); // Use filename() directly on StoredZipEntry
    
            // Construct the full path for the extracted file/directory
            // Handle potential non-UTF8 filenames
            let entry_filename_str = entry_filename.as_str().map_err(|e| format!("Invalid filename encoding in zip: {}", e))?;
            let outpath = dest_dir.join(entry_filename_str);
    
            // Check if it's a directory using dir() directly on StoredZipEntry, mapping the error correctly
            let is_dir = entry.dir().map_err(|e| format!("Failed to check if entry is directory: {}", e.to_string()))?;
            if is_dir {
                // Create directory if it doesn't exist
                if !outpath.exists() {
                    fs::create_dir_all(&outpath).map_err(|e| {
                        format!(
                            "Failed to create directory {:?} from zip: {}",
                            outpath, e
                        )
                    })?;
                }
            } else {
                // Ensure parent directory exists for files
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(p).map_err(|e| {
                            format!(
                                "Failed to create parent directory {:?} for file {:?}: {}",
                                p, outpath, e
                            )
                        })?;
                    }
                }
    
                // Use the original mutable zip reader to get the entry reader by index
                let entry_reader_result = zip.reader_with_entry(index).await;
                let entry_reader = match entry_reader_result {
                     Ok(reader) => reader,
                     Err(e) => return Err(format!("Failed to get reader for zip entry index {}: {}", index, e)),
                };
                // Create the output file using TokioFile for async writing
                let mut outfile = TokioFile::create(&outpath).await.map_err(|e| {
                    format!("Failed to create output file {:?}: {}", outpath, e)
                })?;
    
                // Use tokio::io::copy with the async outfile
                // Use .compat() to bridge futures::AsyncRead -> tokio::AsyncRead for copy
                if let Err(e) = tokio::io::copy(&mut entry_reader.compat(), &mut outfile).await {
                     return Err(format!("Failed to copy content to {:?}: {}", outpath, e));
                }
    
                // On Unix systems, restore permissions if needed (optional)
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    // Access unix_permissions() directly on StoredZipEntry and cast to u32
                    if let Some(mode) = entry.unix_permissions() {
                        if let Err(e) = fs::set_permissions(&outpath, fs::Permissions::from_mode(mode as u32)) { // Ensure cast is u32
                             warn!("Failed to set permissions on {:?}: {}", outpath, e);
                        }
                    }
                }
            }
        }
    
        Ok(())
}

// Helper function to get the app's data directory
fn get_app_data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))
}

/// Returns the base path for user-installed extensions
#[tauri::command]
pub async fn get_extensions_dir(app_handle: AppHandle) -> Result<String, String> {
    let app_data_dir = get_app_data_dir(&app_handle)?;
    let extensions_dir = app_data_dir.join("extensions");
    
    // Create the directory if it doesn't exist
    if !extensions_dir.exists() {
        std::fs::create_dir_all(&extensions_dir)
            .map_err(|e| format!("Failed to create extensions directory: {}", e))?;
    }
    
    extensions_dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid UTF-8 in extensions directory path".to_string())
}

/// Returns a list of installed extension directories
#[tauri::command]
pub async fn list_installed_extensions(app_handle: AppHandle) -> Result<Vec<String>, String> {
    let extensions_dir = get_app_data_dir(&app_handle)?.join("extensions");
    
    if !extensions_dir.exists() {
        return Ok(Vec::new());
    }
    
    let entries = std::fs::read_dir(&extensions_dir)
        .map_err(|e| format!("Failed to read extensions directory: {}", e))?;
    
    let mut extension_dirs = Vec::new();
    
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        
        if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            if let Some(path_str) = entry.path().to_str() {
                extension_dirs.push(path_str.to_string());
            }
        }
    }
    
    Ok(extension_dirs)
}

// Remove duplicate imports below, they exist near the top of the file
// use std::path::Path;
// use std::fs;
// use std::io::Write; // Import Write trait - Keep this one if needed for the command

/// Creates parent directories if they don't exist and writes binary content to a file.
#[tauri::command]
pub async fn write_binary_file_recursive(path_str: String, content: Vec<u8>) -> Result<(), String> {
    let path = std::path::Path::new(&path_str);

    // Create parent directories if they don't exist
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories for {}: {}", path_str, e))?;
        }
    }

    // Write the file content
    // Use fs::write for simplicity, or File::create + write_all for more control
    fs::write(path, &content)
         .map_err(|e| format!("Failed to write file {}: {}", path_str, e))?;

    Ok(())
}

#[tauri::command]
pub async fn write_text_file_absolute(path_str: String, content: String) -> Result<(), String> {
    let path = std::path::Path::new(&path_str);

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories for {}: {}", path_str, e))?;
        }
    }

    fs::write(path, content)
         .map_err(|e| format!("Failed to write file {}: {}", path_str, e))?;

    Ok(())
}

#[tauri::command]
pub async fn read_text_file_absolute(path_str: String) -> Result<String, String> {
    let path = std::path::Path::new(&path_str);
    fs::read_to_string(path).map_err(|e| format!("Failed to read file {}: {}", path_str, e))
}

#[tauri::command]
pub async fn mkdir_absolute(path_str: String) -> Result<(), String> {
    let path = std::path::Path::new(&path_str);
    fs::create_dir_all(path)
        .map_err(|e| format!("Failed to create directory {}: {}", path_str, e))?;
    Ok(())
}


/// Returns the base path for built-in extensions within the application bundle
#[tauri::command]
pub async fn get_builtin_extensions_path(app_handle: AppHandle) -> Result<String, String> {
    // In development (debug), we want to discover extensions directly from the source directory
    // to support live updates and avoid issues with empty resource directories in the target folder.
    #[cfg(debug_assertions)]
    {
        let current_dir = std::env::current_dir().unwrap_or_default();
        let dev_dir = current_dir
            .join("src")
            .join("built-in-extensions");
        
        info!("[Rust] Current working directory: {:?}", current_dir);
        info!("[Rust] Constructing dev extensions path: {:?}", dev_dir);

        if dev_dir.exists() {
            info!("[Rust] Dev extensions path EXISTS.");
            return Ok(dev_dir.to_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Invalid UTF-8 in dev extensions path".to_string()));
        } else {
            warn!("[Rust] Dev extensions path DOES NOT EXIST at {:?}", dev_dir);
        }
    }

    // Get the resource directory path for production/bundled mode
    let resource_dir = app_handle.path().resource_dir()
        .map_err(|e| format!("Failed to access resource directory path resolver: {}", e))?;
        
    // Check if the resource directory exists
    if !resource_dir.exists() {
        return Err("Resource directory does not exist".to_string());
    }

    let builtin_dir = resource_dir.join("built-in-extensions");

    builtin_dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid UTF-8 in built-in extensions directory path".to_string())
}


// Registry to keep track of running headless extensions
pub struct ExtensionRegistry(pub Mutex<HashMap<String, std::process::Child>>);

#[tauri::command]
pub fn spawn_headless_extension(
    id: String,
    path: String,
    state: tauri::State<'_, ExtensionRegistry>,
) -> Result<bool, String> {
    let mut registry = state.0.lock().map_err(|e: std::sync::PoisonError<_>| e.to_string())?;

    // Terminate existing if already running
    if let Some(mut child) = registry.remove(&id) {
        let _ = child.kill();
        let _ = child.wait();
    }

    info!("Spawning headless extension {} from {}", id, path);

    // Assuming it's a Node.js background worker for now
    let child = std::process::Command::new("node")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to spawn headless process: {}", e))?;

    registry.insert(id, child);
    Ok(true)
}

#[tauri::command]
pub fn kill_extension(
    id: String,
    state: tauri::State<'_, ExtensionRegistry>,
) -> Result<bool, String> {
    let mut registry = state.0.lock().map_err(|e: std::sync::PoisonError<_>| e.to_string())?;

    if let Some(mut child) = registry.remove(&id) {
        info!("Terminating headless extension {}", id);
        child.kill().map_err(|e| format!("Failed to kill process: {}", e))?;
        child.wait().map_err(|e| format!("Failed to wait for process: {}", e))?;
        Ok(true)
    } else {
        warn!("Extension {} not found in registry", id);
        Ok(false) // Not found, but not an error
    }
}

#[tauri::command]
pub fn set_focus_lock(state: tauri::State<'_, AppState>, locked: bool) {
    state.focus_locked.store(locked, Ordering::Relaxed);
}

/// HTTP fetch that forces IPv4 to avoid the reqwest IPv6 Happy Eyeballs stall on macOS.
/// Returns the response body as a string alongside status metadata.
#[tauri::command]
pub async fn fetch_url(url: String, method: Option<String>, headers: Option<HashMap<String, String>>, timeout_ms: Option<u64>) -> Result<serde_json::Value, String> {
    use std::net::{IpAddr, Ipv4Addr};

    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(20000));

    let client = reqwest::Client::builder()
        .local_address(IpAddr::V4(Ipv4Addr::UNSPECIFIED)) // force IPv4
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(timeout)
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")
        .build()
        .map_err(|e| e.to_string())?;

    let req_method = match method.as_deref().unwrap_or("GET") {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        _ => reqwest::Method::GET,
    };

    let mut req = client.request(req_method, &url);
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req = req.header(&k, &v);
        }
    }

    let response = req.send().await.map_err(|e| e.to_string())?;

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();
    let ok = response.status().is_success();

    let mut resp_headers = serde_json::Map::new();
    for (key, value) in response.headers().iter() {
        if let Ok(v) = value.to_str() {
            resp_headers.insert(key.as_str().to_string(), serde_json::Value::String(v.to_string()));
        }
    }

    let body = response.text().await.map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "status": status,
        "statusText": status_text,
        "headers": resp_headers,
        "body": body,
        "ok": ok,
    }))
}

/// Send a system notification.
/// Dev builds (debug_assertions): use osascript — avoids UNUserNotificationCenter crash
/// which requires a signed .app bundle (not available in `pnpm tauri dev`).
/// Release builds: use tauri-plugin-notification Rust API, which works in signed builds.
#[tauri::command]
pub fn send_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let _ = app; // not needed in dev path
        let script = format!(
            "display notification \"{}\" with title \"{}\"",
            body.replace('"', "\\\""),
            title.replace('"', "\\\"")
        );
        std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .spawn()
            .map_err(|e| format!("osascript error: {}", e))?;
        return Ok(());
    }

    #[cfg(not(debug_assertions))]
    {
        use tauri_plugin_notification::NotificationExt;
        app.notification()
            .builder()
            .title(&title)
            .body(&body)
            .show()
            .map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "windows")]
fn extract_icon_windows(exe_path: &str) -> Option<Vec<u8>> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS,
    };
    use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

    // Convert path to null-terminated wide string
    let wide_path: Vec<u16> = OsStr::new(exe_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut file_info = SHFILEINFOW::default();

    // Ask Windows Shell for the large (32x32) icon associated with this exe
    let result = unsafe {
        SHGetFileInfoW(
            PCWSTR(wide_path.as_ptr()),
            0,
            Some(&mut file_info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };

    if result == 0 {
        return None;
    }

    let hicon = file_info.hIcon;
    if hicon.is_invalid() {
        return None;
    }

    // Retrieve the underlying bitmaps from the HICON
    let mut icon_info = ICONINFO::default();
    let got_info = unsafe { GetIconInfo(hicon, &mut icon_info) };

    if got_info.is_err() {
        unsafe { let _ = DestroyIcon(hicon); }
        return None;
    }

    let size: i32 = 32;

    // Set up a device context and BITMAPINFO for 32-bit top-down BGRA readback
    let dc = unsafe { CreateCompatibleDC(None) };

    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size,
            biHeight: -size, // negative = top-down row order
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0, // BI_RGB
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [Default::default()],
    };

    let mut pixels: Vec<u8> = vec![0u8; (size * size * 4) as usize];

    let old_obj = unsafe { SelectObject(dc, icon_info.hbmColor) };

    let rows = unsafe {
        GetDIBits(
            dc,
            icon_info.hbmColor,
            0,
            size as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        )
    };

    // Clean up GDI resources
    unsafe {
        SelectObject(dc, old_obj);
        DeleteDC(dc);
        if !icon_info.hbmColor.is_invalid() { let _ = DeleteObject(icon_info.hbmColor); }
        if !icon_info.hbmMask.is_invalid()  { let _ = DeleteObject(icon_info.hbmMask);  }
        let _ = DestroyIcon(hicon);
    }

    if rows == 0 {
        return None;
    }

    // Windows returns BGRA — swap B and R channels to produce RGBA
    for chunk in pixels.chunks_exact_mut(4) {
        chunk.swap(0, 2);
    }

    // If all alpha bytes are zero, the icon uses old-style mask transparency.
    // In that case, set every non-black pixel to fully opaque so it renders correctly.
    let all_transparent = pixels.chunks_exact(4).all(|c| c[3] == 0);
    if all_transparent {
        for chunk in pixels.chunks_exact_mut(4) {
            if chunk[0] != 0 || chunk[1] != 0 || chunk[2] != 0 {
                chunk[3] = 255;
            }
        }
    }

    // Encode raw RGBA buffer as PNG
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut buf), size as u32, size as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(&pixels).ok()?;
    }

    if buf.is_empty() {
        None
    } else {
        Some(buf)
    }
}
