use crate::{search_engine::models::Application, SPOTLIGHT_LABEL};
use enigo::{Enigo, KeyboardControllable};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::path::PathBuf; // Added PathBuf
use tauri::{AppHandle, Manager, Emitter}; // Added Manager and Emitter
use tauri_nspanel::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers};
use futures_util::StreamExt; // For stream handling
use tempfile::NamedTempFile; // For temporary files
use async_zip::tokio::read::seek::ZipFileReader; // Use the seek reader
use tokio::fs::File as TokioFile; // Use Tokio's File for async operations
use tokio::io::BufReader; // Import BufReader
use tokio::io::{AsyncWriteExt, AsyncRead}; // Import AsyncRead trait for copy
use tokio_util::compat::FuturesAsyncReadCompatExt; // Import compat extension trait

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
pub fn list_applications() -> Result<Vec<Application>, String> {
    let mut scanner = AppScanner::new();
    scanner.scan_all().map_err(|e| e.to_string())?;

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
        });
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
    match shortcut_manager.register(tauri_plugin_global_shortcut::Shortcut::new(
        Some(mod_key),
        code,
    )) {
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
pub async fn initialize_shortcut_from_settings(
    app_handle: AppHandle,
    modifier: String,
    key: String,
) -> Result<(), String> {
    info!(
        "Initializing shortcut from settings: {} + {}",
        modifier, key
    );
    // Re-use the existing update function
    update_global_shortcut(app_handle, modifier, key).await
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
    
    // --- New Command: install_extension_from_url ---
    
    #[tauri::command]
    pub async fn install_extension_from_url(
        app_handle: AppHandle,
        download_url: String,
        extension_id: String,
        extension_name: String, // Keep for logging/notifications
        version: String,        // Keep for logging/potential future use
    ) -> Result<(), String> {
        info!(
            "Attempting to install extension '{}' (ID: {}, Version: {}) from URL: {}",
            extension_name, extension_id, version, download_url
        );
    
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
            if let Err(e) = fs::create_dir_all(&base_extensions_dir) {
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
            if let Err(e) = fs::remove_dir_all(&install_dir) {
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
                let mut entry_reader = match entry_reader_result {
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
    let path = Path::new(&path_str);

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


/// Returns the base path for built-in extensions within the application bundle
#[tauri::command]
pub async fn get_builtin_extensions_path(app_handle: AppHandle) -> Result<String, String> {
    // Get the resource directory path
    let resource_dir = app_handle.path().resource_dir()
        .map_err(|e| format!("Failed to access resource directory path resolver: {}", e))?;
        
    // Check if the resource directory exists
    if !resource_dir.exists() {
        return Err("Resource directory does not exist".to_string());
    }

    // IMPORTANT: This relative path depends on your Tauri build configuration and how
    // resources are packaged. You might need to adjust "built-in-extensions".
    // Inspect your final application bundle (`target/release/bundle/...`) to confirm the correct path.
    // Common paths might include "_up_/_app/built-in-extensions" or just "built-in-extensions".
    let builtin_dir = resource_dir.join("built-in-extensions"); // Adjust this path as needed

    builtin_dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid UTF-8 in built-in extensions directory path".to_string())
}
