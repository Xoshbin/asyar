use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use futures_util::StreamExt;
use tempfile::NamedTempFile;
use async_zip::tokio::read::seek::ZipFileReader;
use tokio::fs::File as TokioFile;
use tokio::io::{BufReader, AsyncWriteExt};
use tokio_util::compat::FuturesAsyncReadCompatExt;

#[tauri::command]
pub async fn delete_extension_directory(path: String) -> Result<(), String> {
    info!("Deleting extension directory: {}", path);

    match fs::remove_dir_all(&path) {
        Ok(_) => {
            info!("Successfully deleted directory: {}", path);
            Ok(())
        }
        Err(e) => {
            warn!("Failed to delete directory: {} - {:?}", path, e);
            Err(format!("Failed to delete directory: {:?}", e))
        }
    }
}

#[tauri::command]
pub async fn check_path_exists(path: String) -> bool {
    info!("Checking if path exists: {}", path);
    Path::new(&path).exists()
}

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
    fs::remove_dir_all(&install_dir)
        .map_err(|e| format!("Failed to remove extension directory: {}", e))
}

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
    let base_extensions_dir = get_app_data_dir(&app_handle)?.join("extensions");

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
    let entries = zip.file().entries().to_vec();
    for (index, entry) in entries.iter().enumerate() {
        let entry_filename = entry.filename();

        // Construct the full path for the extracted file/directory
        let entry_filename_str = entry_filename.as_str().map_err(|e| format!("Invalid filename encoding in zip: {}", e))?;
        // Normalize path separators: convert \ to / before joining on Unix paths
        let normalized_filename = entry_filename_str.replace("\\", "/");
        let safe_filename = normalized_filename.trim_start_matches('/');
        let outpath = dest_dir.join(safe_filename);
        
        log::debug!("Extracting entry: Original='{}', Safe='{}', Dest='{:?}'", entry_filename_str, safe_filename, outpath);

        // Check if it's a directory using ends_with to overcome entry.dir() failing on backslashes
        let is_dir = safe_filename.ends_with("/");
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
            if let Err(e) = tokio::io::copy(&mut entry_reader.compat(), &mut outfile).await {
                 return Err(format!("Failed to copy content to {:?}: {}", outpath, e));
            }

            // On Unix systems, restore permissions if needed
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mut mode) = entry.unix_permissions() {
                    mode &= 0o777;
                    if mode > 0 {
                        if let Err(e) = fs::set_permissions(&outpath, fs::Permissions::from_mode(mode as u32)) {
                             warn!("Failed to set permissions on {:?}: {}", outpath, e);
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

// Helper function to get the app's data directory
pub(crate) fn get_app_data_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
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
        fs::create_dir_all(&extensions_dir)
            .map_err(|e| format!("Failed to create extensions directory: {}", e))?;
    }
    
    extensions_dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Invalid UTF-8 in extensions directory path".to_string())
}

/// Registers a development extension path centrally so the launcher can load it directly
#[tauri::command]
pub async fn register_dev_extension(
    app_handle: AppHandle,
    extension_id: String,
    path: String,
) -> Result<(), String> {
    let dev_extensions_file = get_app_data_dir(&app_handle)?.join("dev_extensions.json");
    
    let mut dev_extensions: HashMap<String, String> =
        if dev_extensions_file.exists() {
            let content = fs::read_to_string(&dev_extensions_file)
                .map_err(|e| format!("Failed to read dev_extensions.json: {}", e))?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            HashMap::new()
        };

    dev_extensions.insert(extension_id, path);

    let new_content = serde_json::to_string_pretty(&dev_extensions)
        .map_err(|e| format!("Failed to serialize dev extensions: {}", e))?;
    
    fs::write(&dev_extensions_file, new_content)
        .map_err(|e| format!("Failed to write dev_extensions.json: {}", e))?;

    Ok(())
}

/// Returns the map of registered development extension paths
#[tauri::command]
pub async fn get_dev_extension_paths(app_handle: AppHandle) -> Result<HashMap<String, String>, String> {
    let dev_extensions_file = get_app_data_dir(&app_handle)?.join("dev_extensions.json");
    if !dev_extensions_file.exists() {
        return Ok(HashMap::new());
    }
    
    let content = fs::read_to_string(&dev_extensions_file)
        .map_err(|e| format!("Failed to read dev_extensions.json: {}", e))?;
        
    let dev_extensions: HashMap<String, String> = serde_json::from_str(&content).unwrap_or_default();
    Ok(dev_extensions)
}

/// Returns a list of installed extension directories
#[tauri::command]
pub async fn list_installed_extensions(app_handle: AppHandle) -> Result<Vec<String>, String> {
    let extensions_dir = get_app_data_dir(&app_handle)?.join("extensions");
    
    if !extensions_dir.exists() {
        return Ok(Vec::new());
    }
    
    let entries = fs::read_dir(&extensions_dir)
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

/// Returns the base path for built-in extensions within the application bundle
#[tauri::command]
pub async fn get_builtin_extensions_path(app_handle: AppHandle) -> Result<String, String> {
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

    let resource_dir = app_handle.path().resource_dir()
        .map_err(|e| format!("Failed to access resource directory path resolver: {}", e))?;
        
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
