//! Extension installation: download, verify, and extract extension packages.

use log::{info, warn};
use crate::error::AppError;
use crate::extensions::get_app_data_dir;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Emitter};
use futures_util::StreamExt;
use tempfile::NamedTempFile;
use async_zip::tokio::read::seek::ZipFileReader;
use tokio::fs::File as TokioFile;
use tokio::io::{BufReader, AsyncWriteExt};
use tokio_util::compat::FuturesAsyncReadCompatExt;

pub(crate) async fn download_to_temp_file(url: &str) -> Result<NamedTempFile, AppError> {
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

pub(crate) async fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), AppError> {
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

pub(crate) fn validate_download_url(url: &str) -> Result<(), AppError> {
    if !url.starts_with("https://") {
        return Err(AppError::Validation(format!(
            "Extension downloads require HTTPS. Insecure URL: {}",
            url
        )));
    }
    Ok(())
}

pub(crate) fn verify_checksum(file_path: &Path, expected_checksum: &str) -> Result<(), AppError> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut file = std::fs::File::open(file_path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 8192];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 { break; }
        hasher.update(&buffer[..count]);
    }
    let calculated = format!("sha256:{:x}", hasher.finalize());
    if calculated != expected_checksum {
        return Err(AppError::Validation(format!(
            "Checksum mismatch! Expected: {}, Calculated: {}",
            expected_checksum, calculated
        )));
    }
    info!("Checksum verified successfully.");
    Ok(())
}

pub(crate) async fn install_from_url(
    app_handle: &AppHandle,
    download_url: &str,
    extension_id: &str,
    extension_name: &str,
    version: &str,
    checksum: Option<&str>,
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
    validate_download_url(download_url)?;

    // --- 1. Determine Installation Directory ---
    let base_extensions_dir = get_app_data_dir(app_handle)?.join("extensions");

    // Create the base extensions directory if it doesn't exist
    if !base_extensions_dir.exists() {
        fs::create_dir_all(&base_extensions_dir).map_err(|e| AppError::Platform(format!(
            "Failed to create base extensions directory {:?}: {}",
            base_extensions_dir, e
        )))?;
        info!("Created base extensions directory: {:?}", base_extensions_dir);
    }

    let install_dir = base_extensions_dir.join(extension_id);

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
    let temp_file = download_to_temp_file(download_url).await?;
    info!(
        "Extension downloaded successfully to temporary file: {:?}",
        temp_file.path()
    );

    if let Some(expected_checksum) = checksum {
        verify_checksum(temp_file.path(), expected_checksum)?;
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

    // --- 3b. Platform compatibility check ---
    {
        use crate::extensions::discovery::{read_manifest, validate_compatibility};
        use crate::extensions::CompatibilityStatus;
        let manifest_path = install_dir.join("manifest.json");
        if manifest_path.exists() {
            match read_manifest(&manifest_path) {
                Ok(manifest) => {
                    if let CompatibilityStatus::PlatformNotSupported { platform, supported } =
                        validate_compatibility(&manifest)
                    {
                        let _ = fs::remove_dir_all(&install_dir);
                        return Err(AppError::Validation(format!(
                            "Extension '{}' does not support {} (supported platforms: {})",
                            extension_name,
                            platform,
                            if supported.is_empty() {
                                "none declared".to_string()
                            } else {
                                supported.join(", ")
                            }
                        )));
                    }
                }
                Err(e) => {
                    warn!("Could not read manifest for platform check: {}", e);
                    // Non-fatal — discovery will handle it at scan time
                }
            }
        }
    }

    // --- 4. Emit event to frontend ---
    if let Err(e) = app_handle.emit("extensions_updated", ()) {
        warn!("Failed to emit extensions_updated event: {}", e);
    }

    Ok(())
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

    #[tokio::test]
    async fn incompatible_platform_manifest_blocks_extraction_output() {
        // Build a zip with a manifest declaring only non-current platforms
        let incompatible_os = ["macos", "windows", "linux"]
            .iter()
            .find(|&&p| p != std::env::consts::OS)
            .copied()
            .unwrap_or("other");
        let manifest_json = format!(
            r#"{{"id":"test.ext","name":"T","version":"1.0.0","description":"d","platforms":["{}"]}}"#,
            incompatible_os
        );

        // Extract the zip to a temp dir, then run the platform check manually
        // (We can't call install_from_url without an AppHandle, so test the manifest check path directly)
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest_json.as_bytes()),
            ("index.html", b"<html/>"),
        ]).await.unwrap();

        use crate::extensions::discovery::{read_manifest, validate_compatibility};
        use crate::extensions::CompatibilityStatus;
        let manifest = read_manifest(&dest.path().join("manifest.json")).unwrap();
        assert!(matches!(
            validate_compatibility(&manifest),
            CompatibilityStatus::PlatformNotSupported { .. }
        ));
    }
}
