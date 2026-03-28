//! Extension lifecycle management commands.
//!
//! Covers installing, uninstalling, listing, registering dev extensions,
//! and managing headless extension processes.

use log::{info, warn};
use crate::error::AppError;
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

/// Returns `true` if the given path exists on the file system.
#[tauri::command]
pub async fn check_path_exists(path: String) -> bool {
    info!("Checking if path exists: {}", path);
    Path::new(&path).exists()
}

/// Removes an installed extension by ID, deleting its directory.
#[tauri::command]
pub async fn uninstall_extension(app_handle: AppHandle, extension_id: String) -> Result<(), AppError> {
    if extension_id.trim().is_empty() {
        return Err(AppError::Validation("Extension ID cannot be empty".to_string()));
    }
    let extensions_dir = get_app_data_dir(&app_handle)?.join("extensions");
    let install_dir = extensions_dir.join(&extension_id);
    if !install_dir.exists() {
        return Err(AppError::NotFound(format!("Extension '{}' is not installed", extension_id)));
    }
    info!("Uninstalling extension '{}' at {:?}", extension_id, install_dir);
    Ok(fs::remove_dir_all(&install_dir)?)
}

/// Downloads and installs an extension from a URL, verifying its checksum.
#[tauri::command]
pub async fn install_extension_from_url(
    app_handle: AppHandle,
    download_url: String,
    extension_id: String,
    extension_name: String, // Keep for logging/notifications
    version: String,        // Keep for logging/potential future use
    checksum: Option<String>,
) -> Result<(), AppError> {
    info!(
        "Attempting to install extension '{}' (ID: {}, Version: {}) from URL: {}",
        extension_name, extension_id, version, download_url
    );
    
    // Guard against empty values before doing anything
    if download_url.trim().is_empty() {
        return Err(AppError::Validation("Download URL is required and cannot be empty".to_string()));
    }
    if extension_id.trim().is_empty() {
        return Err(AppError::Validation("Extension ID is required and cannot be empty".to_string()));
    }

    // Validate URL format
    validate_download_url(&download_url)?;

    // --- 1. Determine Installation Directory ---
    let base_extensions_dir = get_app_data_dir(&app_handle)?.join("extensions");

    // Create the base extensions directory if it doesn't exist
    if !base_extensions_dir.exists() {
        fs::create_dir_all(&base_extensions_dir).map_err(|e| AppError::Platform(format!(
            "Failed to create base extensions directory {:?}: {}",
            base_extensions_dir, e
        )))?;
        info!("Created base extensions directory: {:?}", base_extensions_dir);
    }

    let install_dir = base_extensions_dir.join(&extension_id);

    // Clean up existing directory if it exists
    if install_dir.exists() {
        warn!(
            "Existing installation directory found for {}. Removing it first: {:?}",
            extension_id, install_dir
        );
        fs::remove_dir_all(&install_dir).map_err(|e| AppError::Platform(format!(
            "Failed to remove existing extension directory {:?}: {}",
            install_dir, e
        )))?;
    }

    // --- 2. Download the Extension ---
    info!("Downloading extension from: {}", download_url);
    let temp_file = download_to_temp_file(&download_url).await?;
    info!(
        "Extension downloaded successfully to temporary file: {:?}",
        temp_file.path()
    );

    if let Some(expected_checksum) = checksum {
        use sha2::{Digest, Sha256};
        use std::io::Read;

        let mut file = std::fs::File::open(temp_file.path())?;
        let mut hasher = Sha256::new();
        let mut buffer = [0; 8192];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        let result = hasher.finalize();
        let calculated_checksum = format!("sha256:{:x}", result);
        
        if calculated_checksum != expected_checksum {
            return Err(AppError::Validation(format!(
                "Checksum mismatch! Expected: {}, Calculated: {}",
                expected_checksum, calculated_checksum
            )));
        }
        info!("Checksum verified successfully.");
    }

    // --- 3. Extract the Extension ---
    info!("Extracting extension to: {:?}", install_dir);
    if let Err(e) = extract_zip(temp_file.path(), &install_dir).await {
        // Clean up partially extracted files on error
        let _ = fs::remove_dir_all(&install_dir);
        return Err(e);
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

async fn download_to_temp_file(url: &str) -> Result<NamedTempFile, AppError> {
    // Create a temporary file (still uses std::fs internally, but that's okay for creation)
    let temp_file = NamedTempFile::new().map_err(AppError::Io)?;
    // Open the temp file using Tokio for async writing
    let mut dest = TokioFile::create(temp_file.path()).await?;

    // Make the HTTP request
    let response = reqwest::get(url)
        .await?;

    if !response.status().is_success() {
        return Err(AppError::Network(response.error_for_status().unwrap_err()));
    }

    // Stream the response body to the file
    let mut stream = response.bytes_stream();
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result?;
        // Use async write_all
        dest.write_all(&chunk)
            .await // Use await for async write
            .map_err(AppError::Io)?;
    }

    Ok(temp_file)
}

async fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), AppError> {
    // Ensure destination directory exists
    fs::create_dir_all(dest_dir)?;

    // Open the file asynchronously
    let file = TokioFile::open(zip_path).await?;
    // Wrap it in a BufReader for seeking
    let mut buf_reader = BufReader::new(file);
    // Create the seek::ZipFileReader
    let mut zip = ZipFileReader::with_tokio(&mut buf_reader).await
        .map_err(|e| AppError::Extension(format!("Failed to read zip archive {:?}: {}", zip_path, e)))?;


    // Iterate over entries and extract them
    let entries = zip.file().entries().to_vec();
    for (index, entry) in entries.iter().enumerate() {
        let entry_filename = entry.filename();

        // Construct the full path for the extracted file/directory
        let entry_filename_str = entry_filename.as_str().map_err(|e| AppError::Extension(format!("Invalid filename encoding in zip: {}", e)))?;
        // Normalize path separators: convert \ to / before joining on Unix paths
        let normalized_filename = entry_filename_str.replace("\\", "/");
        let safe_filename = normalized_filename.trim_start_matches('/');

        // [SECURITY] Zip-slip guard: reject any entry whose path components include `..`.
        // Without this check, a malicious zip could write files outside `dest_dir` by
        // including entries like `../../other-extension/evil.js`.
        if safe_filename.split('/').any(|component| component == "..") {
            return Err(AppError::Validation(format!(
                "Zip entry '{}' contains a path traversal sequence and was rejected",
                entry_filename_str
            )));
        }

        let outpath = dest_dir.join(safe_filename);
        
        log::debug!("Extracting entry: Original='{}', Safe='{}', Dest='{:?}'", entry_filename_str, safe_filename, outpath);

        // Check if it's a directory using ends_with to overcome entry.dir() failing on backslashes
        let is_dir = safe_filename.ends_with("/");
        if is_dir {
            // Create directory if it doesn't exist
            if !outpath.exists() {
                fs::create_dir_all(&outpath)?;
            }
        } else {
            // Ensure parent directory exists for files
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)?;
                }
            }

            // Use the original mutable zip reader to get the entry reader by index
            let entry_reader_result = zip.reader_with_entry(index).await;
            let entry_reader = match entry_reader_result {
                 Ok(reader) => reader,
                 Err(e) => return Err(AppError::Extension(format!("Failed to get reader for zip entry index {}: {}", index, e))),
            };
            // Create the output file using TokioFile for async writing
            let mut outfile = TokioFile::create(&outpath).await?;

            // Use tokio::io::copy with the async outfile
            tokio::io::copy(&mut entry_reader.compat(), &mut outfile).await
                 .map_err(|e| AppError::Extension(format!("Failed to copy content to {:?}: {}", outpath, e)))?;

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

/// Validates that an extension download URL uses HTTPS.
fn validate_download_url(url: &str) -> Result<(), AppError> {
    if !url.starts_with("https://") {
        return Err(AppError::Validation(format!(
            "Extension downloads require HTTPS. Insecure URL: {}",
            url
        )));
    }
    Ok(())
}

// Helper function to get the app's data directory
pub(crate) fn get_app_data_dir(app_handle: &AppHandle) -> Result<PathBuf, AppError> {
    app_handle.path().app_data_dir().map_err(|e| AppError::Other(e.to_string()))
}

/// Returns the absolute path to the user extensions directory.
#[tauri::command]
pub async fn get_extensions_dir(app_handle: AppHandle) -> Result<String, AppError> {
    let app_data_dir = get_app_data_dir(&app_handle)?;
    let extensions_dir = app_data_dir.join("extensions");
    
    // Create the directory if it doesn't exist
    if !extensions_dir.exists() {
        fs::create_dir_all(&extensions_dir)?;
    }
    
    extensions_dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Other("Invalid UTF-8 in extensions directory path".to_string()))
}

/// Registers a local development extension by ID and directory path.
#[tauri::command]
pub async fn register_dev_extension(
    app_handle: AppHandle,
    extension_id: String,
    path: String,
) -> Result<(), AppError> {
    let dev_extensions_file = get_app_data_dir(&app_handle)?.join("dev_extensions.json");
    
    let mut dev_extensions: HashMap<String, String> =
        if dev_extensions_file.exists() {
            let content = fs::read_to_string(&dev_extensions_file)?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            HashMap::new()
        };

    dev_extensions.insert(extension_id, path);

    let new_content = serde_json::to_string_pretty(&dev_extensions)?;
    
    fs::write(&dev_extensions_file, new_content)?;

    Ok(())
}

/// Returns a map of dev-extension IDs to their local directory paths.
#[tauri::command]
pub async fn get_dev_extension_paths(app_handle: AppHandle) -> Result<HashMap<String, String>, AppError> {
    let dev_extensions_file = get_app_data_dir(&app_handle)?.join("dev_extensions.json");
    if !dev_extensions_file.exists() {
        return Ok(HashMap::new());
    }
    
    let content = fs::read_to_string(&dev_extensions_file)?;
        
    let dev_extensions: HashMap<String, String> = serde_json::from_str(&content).unwrap_or_default();
    Ok(dev_extensions)
}

/// Returns the IDs of all currently installed user extensions.
#[tauri::command]
pub async fn list_installed_extensions(app_handle: AppHandle) -> Result<Vec<String>, AppError> {
    let extensions_dir = get_app_data_dir(&app_handle)?.join("extensions");
    
    if !extensions_dir.exists() {
        return Ok(Vec::new());
    }
    
    let entries = fs::read_dir(&extensions_dir)?;
    
    let mut extension_dirs = Vec::new();
    
    for entry in entries {
        let entry = entry?;
        
        if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
            if let Some(path_str) = entry.path().to_str() {
                extension_dirs.push(path_str.to_string());
            }
        }
    }
    
    Ok(extension_dirs)
}

/// Returns the absolute path to the built-in extensions directory.
#[tauri::command]
pub async fn get_builtin_extensions_path(app_handle: AppHandle) -> Result<String, AppError> {
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
        .map_err(|e| AppError::Other(format!("Failed to access resource directory path resolver: {}", e)))?;
        
    if !resource_dir.exists() {
        return Err(AppError::NotFound("Resource directory does not exist".to_string()));
    }

    let builtin_dir = resource_dir.join("built-in-extensions");

    builtin_dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Other("Invalid UTF-8 in built-in extensions directory path".to_string()))
}

// Registry to keep track of running headless extensions
pub struct ExtensionRegistry(pub Mutex<HashMap<String, std::process::Child>>);

/// Spawns a headless (background) extension process and tracks it in the registry.
#[tauri::command]
pub fn spawn_headless_extension(
    id: String,
    path: String,
    state: tauri::State<'_, ExtensionRegistry>,
) -> Result<bool, AppError> {
    let mut registry = state.0.lock().map_err(|_| AppError::Lock)?;

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
        .map_err(|e| AppError::Extension(format!("Failed to spawn headless process: {}", e)))?;

    registry.insert(id, child);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use async_zip::tokio::write::ZipFileWriter;
    use async_zip::{Compression, ZipEntryBuilder};

    /// Helper: build an in-memory zip and write it to a temp file, then extract.
    async fn make_zip_and_extract(entries: &[(&str, &[u8])]) -> Result<TempDir, AppError> {
        let dest = TempDir::new().map_err(AppError::Io)?;
        let zip_tmp = NamedTempFile::new().map_err(AppError::Io)?;
        {
            let zip_file = tokio::fs::File::create(zip_tmp.path()).await?;
            let mut writer = ZipFileWriter::with_tokio(zip_file);
            for (name, content) in entries {
                let entry = ZipEntryBuilder::new((*name).into(), Compression::Deflate);
                writer.write_entry_whole(entry, content).await
                    .map_err(|e| AppError::Extension(e.to_string()))?;
            }
            writer.close().await.map_err(|e| AppError::Extension(e.to_string()))?;
        }
        extract_zip(zip_tmp.path(), dest.path()).await?;
        Ok(dest)
    }

    #[tokio::test]
    async fn normal_zip_extracts_correctly() {
        let dest = make_zip_and_extract(&[
            ("index.js", b"console.log('hi')"),
            ("dist/main.css", b"body { margin: 0; }"),
        ]).await.unwrap();
        assert!(dest.path().join("index.js").exists());
        assert!(dest.path().join("dist/main.css").exists());
        let content = std::fs::read_to_string(dest.path().join("index.js")).unwrap();
        assert_eq!(content, "console.log('hi')");
    }

    #[tokio::test]
    async fn zip_slip_with_dotdot_is_rejected() {
        let result = make_zip_and_extract(&[
            ("../../evil.js", b"evil"),
        ]).await;
        assert!(result.is_err());
        let msg = format!("{:?}", result.unwrap_err());
        assert!(msg.contains("path traversal"));
    }

    #[tokio::test]
    async fn zip_slip_nested_dotdot_is_rejected() {
        let result = make_zip_and_extract(&[
            ("subdir/../../outside.txt", b"evil"),
        ]).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn absolute_path_stripped_and_extracted_safely() {
        // Leading / is stripped — must land inside dest_dir
        let dest = make_zip_and_extract(&[
            ("/index.html", b"<html/>"),
        ]).await.unwrap();
        assert!(dest.path().join("index.html").exists());
    }

    #[tokio::test]
    async fn windows_backslash_separator_is_normalised() {
        let dest = make_zip_and_extract(&[
            ("dist\\bundle.js", b"var x=1;"),
        ]).await.unwrap();
        // After normalisation the file lives at dist/bundle.js
        assert!(dest.path().join("dist/bundle.js").exists());
    }

    #[test]
    fn http_url_is_rejected() {
        let url = "http://example.com/extension.zip";
        let result = validate_download_url(url);
        assert!(result.is_err());
        match result.unwrap_err() {
            AppError::Validation(msg) => {
                assert!(msg.contains("Extension downloads require HTTPS"));
                assert!(msg.contains(url));
            }
            e => panic!("Expected Validation error, got {:?}", e),
        }
    }

    #[test]
    fn https_url_passes_scheme_check() {
        let url = "https://example.com/extension.zip";
        let result = validate_download_url(url);
        assert!(result.is_ok());
    }
}

/// Kills a running headless extension process by ID.
#[tauri::command]
pub fn kill_extension(
    id: String,
    state: tauri::State<'_, ExtensionRegistry>,
) -> Result<bool, AppError> {
    let mut registry = state.0.lock().map_err(|_| AppError::Lock)?;

    if let Some(mut child) = registry.remove(&id) {
        info!("Terminating headless extension {}", id);
        child.kill().map_err(|e| AppError::Extension(format!("Failed to kill process: {}", e)))?;
        child.wait().map_err(|e| AppError::Extension(format!("Failed to wait for process: {}", e)))?;
        Ok(true)
    } else {
        warn!("Extension {} not found in registry", id);
        Ok(false) // Not found, but not an error
    }
}
