//! Extension installation: download, verify, and extract extension packages.

use log::{info, warn};
use crate::error::AppError;
use crate::extensions::{get_app_data_dir, read_theme_definition, ExtensionManifest};
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

/// Validate a theme.json file within an extracted extension directory.
pub(crate) fn validate_theme_json(extension_dir: &Path) -> Result<(), AppError> {
    let definition = read_theme_definition(extension_dir)?;

    let allowed_font_extensions = ["woff2", "ttf", "otf"];
    let forbidden_family_patterns = [";", "{", "}", "url(", "@"];

    for font in &definition.fonts {
        // Check font family name for CSS injection
        if forbidden_family_patterns.iter().any(|p| font.family.contains(p)) {
            return Err(AppError::Validation(format!(
                "Invalid font family name '{}': contains forbidden characters",
                font.family
            )));
        }
        if !font.family.chars().all(|c| c.is_alphanumeric() || c == ' ' || c == '-') {
            return Err(AppError::Validation(format!(
                "Invalid font family name '{}': only alphanumeric, spaces, and hyphens allowed",
                font.family
            )));
        }

        // Check font src path for traversal
        if font.src.contains("..") {
            return Err(AppError::Validation(format!(
                "Font src '{}' contains path traversal", font.src
            )));
        }

        // Check font file extension
        let ext = Path::new(&font.src)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if !allowed_font_extensions.contains(&ext) {
            return Err(AppError::Validation(format!(
                "Invalid font extension '.{}' in '{}' — allowed: .woff2, .ttf, .otf",
                ext, font.src
            )));
        }

        // Check font file exists in package
        let font_path = extension_dir.join(&font.src);
        if !font_path.exists() {
            return Err(AppError::Validation(format!(
                "Font file not found: {:?}", font_path
            )));
        }
    }

    Ok(())
}

/// Validates the structural correctness of an extracted extension package.
pub(crate) fn validate_package_structure(
    extracted_dir: &Path,
    manifest: &ExtensionManifest,
) -> Result<(), AppError> {
    if manifest.id.trim().is_empty() {
        return Err(AppError::Validation("Extension manifest missing 'id'".to_string()));
    }
    if manifest.name.trim().is_empty() {
        return Err(AppError::Validation("Extension manifest missing 'name'".to_string()));
    }
    if manifest.version.trim().is_empty() {
        return Err(AppError::Validation("Extension manifest missing 'version'".to_string()));
    }

    // ID format: alphanumeric, hyphens, dots, underscores. No ".."
    if manifest.id.contains("..") {
        return Err(AppError::Validation(format!(
            "Extension ID '{}' contains '..' path traversal", manifest.id
        )));
    }
    if !manifest.id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '.' || c == '_') {
        return Err(AppError::Validation(format!(
            "Extension ID '{}' contains invalid characters", manifest.id
        )));
    }

    // `type` defaults to `"extension"` when absent. The new schema rejects
    // legacy `"view"` and `"result"` values at manifest parse time via
    // `validate_manifest`, so by the time we reach this function the only
    // surviving values are `"extension"` and `"theme"`.
    let ext_type = manifest.extension_type.as_deref().unwrap_or("extension");
    match ext_type {
        "theme" => {
            validate_theme_json(extracted_dir)?;
        }
        "extension" => {
            // view.html is required when the extension exposes at least one
            // view command (mode == "view" or mode absent, which defaults to
            // "view"). worker.html is required when background.main is
            // declared. Either file may live at the extraction root OR under
            // `dist/` — per-extension Vite configs emit into `dist/`, and the
            // `asyar-extension://` scheme handler already resolves both paths,
            // so the installer validator mirrors that contract.
            let has_view_commands = manifest.commands.iter().any(|c| {
                c.mode.as_deref().unwrap_or("view") == "view"
            });
            if has_view_commands
                && !extracted_dir.join("view.html").exists()
                && !extracted_dir.join("dist/view.html").exists()
            {
                return Err(AppError::Validation(
                    "Extension package must include view.html at the root or dist/ directory".to_string()
                ));
            }
            if manifest.background.is_some()
                && !extracted_dir.join("worker.html").exists()
                && !extracted_dir.join("dist/worker.html").exists()
            {
                return Err(AppError::Validation(
                    "Extension package with background.main must include worker.html at the root or dist/ directory"
                        .to_string()
                ));
            }
        }
        other => {
            // validate_manifest rejects this set, so reaching here is a bug.
            return Err(AppError::Validation(format!(
                "Unknown extension type '{}' (expected: theme or extension)", other
            )));
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

#[derive(Debug, PartialEq)]
pub(crate) enum VersionAction {
    FreshInstall,
    Upgrade,
    AlreadyInstalled,
}

/// Determine what to do given existing vs incoming version.
pub(crate) fn check_version_conflict(
    existing_version: Option<&str>,
    incoming_version: &str,
) -> VersionAction {
    match existing_version {
        None => VersionAction::FreshInstall,
        Some(existing) => {
            match (semver::Version::parse(existing), semver::Version::parse(incoming_version)) {
                (Ok(ex), Ok(inc)) if inc > ex => VersionAction::Upgrade,
                _ => VersionAction::AlreadyInstalled,
            }
        }
    }
}

/// Validate that a file path exists and has .asyar extension.
pub(crate) fn validate_file_path(path: &Path) -> Result<(), AppError> {
    if !path.exists() {
        return Err(AppError::NotFound(format!("File not found: {:?}", path)));
    }
    match path.extension().and_then(|e| e.to_str()) {
        Some("asyar") => Ok(()),
        _ => Err(AppError::Validation("File must have .asyar extension".to_string())),
    }
}

/// Install an extension from a local .asyar file.
pub(crate) async fn install_from_file(
    app_handle: &AppHandle,
    file_path: &str,
    _registry: &crate::extensions::ExtensionRegistryState,
) -> Result<(), AppError> {
    let path = Path::new(file_path);
    validate_file_path(path)?;

    let temp_dir = tempfile::TempDir::new().map_err(AppError::Io)?;
    extract_zip(path, temp_dir.path()).await?;

    let manifest_path = temp_dir.path().join("manifest.json");
    let manifest = crate::extensions::discovery::read_manifest(&manifest_path)?;
    validate_package_structure(temp_dir.path(), &manifest)?;

    let compat = crate::extensions::discovery::validate_compatibility(&manifest);
    if let crate::extensions::CompatibilityStatus::PlatformNotSupported { platform, supported } = &compat {
        return Err(AppError::Validation(format!(
            "Extension '{}' does not support {} (supported: {})",
            manifest.name, platform,
            if supported.is_empty() { "none".to_string() } else { supported.join(", ") }
        )));
    }

    let extensions_dir = crate::extensions::get_app_data_dir(app_handle)?.join("extensions");
    fs::create_dir_all(&extensions_dir)?;
    let install_dir = extensions_dir.join(&manifest.id);

    let existing_version = if install_dir.exists() {
        crate::extensions::discovery::read_manifest(&install_dir.join("manifest.json"))
            .ok().map(|m| m.version)
    } else {
        None
    };

    match check_version_conflict(existing_version.as_deref(), &manifest.version) {
        VersionAction::FreshInstall => {}
        VersionAction::Upgrade => {
            info!("Upgrading extension '{}' to v{}", manifest.id, manifest.version);
            fs::remove_dir_all(&install_dir)?;
        }
        VersionAction::AlreadyInstalled => {
            return Err(AppError::Validation(format!(
                "Extension '{}' v{} is already installed (same or newer version)",
                manifest.id, existing_version.unwrap_or_default()
            )));
        }
    }

    // Move or copy from temp to install dir
    if fs::rename(temp_dir.path(), &install_dir).is_err() {
        copy_dir_recursive(temp_dir.path(), &install_dir)?;
    }

    if let Err(e) = app_handle.emit("extensions_updated", ()) {
        warn!("Failed to emit extensions_updated event: {}", e);
    }

    info!("Extension '{}' v{} installed from file", manifest.name, manifest.version);
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), AppError> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            fs::copy(entry.path(), &dest_path)?;
        }
    }
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
    async fn validate_theme_json_valid_theme() {
        let dest = make_zip_and_extract(&[
            ("theme.json", br#"{"variables":{"--bg-primary":"red"},"fonts":[]}"#),
        ]).await.unwrap();
        let result = validate_theme_json(dest.path());
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn validate_theme_json_missing_file_errors() {
        let dest = make_zip_and_extract(&[
            ("manifest.json", b"{}"),
        ]).await.unwrap();
        let result = validate_theme_json(dest.path());
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn validate_theme_json_invalid_font_extension() {
        let dest = make_zip_and_extract(&[
            ("theme.json", br#"{"variables":{},"fonts":[{"family":"Bad","src":"fonts/bad.exe"}]}"#),
            ("fonts/bad.exe", b"data"),
        ]).await.unwrap();
        let result = validate_theme_json(dest.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("font extension"));
    }

    #[tokio::test]
    async fn validate_theme_json_font_file_not_found() {
        let dest = make_zip_and_extract(&[
            ("theme.json", br#"{"variables":{},"fonts":[{"family":"Missing","src":"fonts/missing.woff2"}]}"#),
        ]).await.unwrap();
        let result = validate_theme_json(dest.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[tokio::test]
    async fn validate_theme_json_css_injection_in_family() {
        let dest = make_zip_and_extract(&[
            ("theme.json", br#"{"variables":{},"fonts":[{"family":"Evil;{}url(","src":"fonts/f.woff2"}]}"#),
            ("fonts/f.woff2", b"data"),
        ]).await.unwrap();
        let result = validate_theme_json(dest.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("font family"));
    }

    #[tokio::test]
    async fn validate_theme_json_valid_font() {
        let dest = make_zip_and_extract(&[
            ("theme.json", br#"{"variables":{"--bg-primary":"blue"},"fonts":[{"family":"Inter","weight":"400","style":"normal","src":"fonts/Inter.woff2"}]}"#),
            ("fonts/Inter.woff2", b"woff2data"),
        ]).await.unwrap();
        let result = validate_theme_json(dest.path());
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn validate_theme_json_path_traversal_in_font_src() {
        let dest = make_zip_and_extract(&[
            ("theme.json", br#"{"variables":{},"fonts":[{"family":"Evil","src":"../../../etc/passwd"}]}"#),
        ]).await.unwrap();
        let result = validate_theme_json(dest.path());
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn validate_package_structure_theme_valid() {
        let manifest = r#"{"id":"my-theme","name":"My Theme","version":"1.0.0","type":"theme"}"#;
        let theme = r#"{"variables":{"--bg-primary":"red"},"fonts":[]}"#;
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest.as_bytes()),
            ("theme.json", theme.as_bytes()),
        ]).await.unwrap();
        let m = crate::extensions::discovery::read_manifest(&dest.path().join("manifest.json")).unwrap();
        assert!(validate_package_structure(dest.path(), &m).is_ok());
    }

    #[tokio::test]
    async fn validate_package_structure_theme_missing_theme_json() {
        let manifest = r#"{"id":"my-theme","name":"My Theme","version":"1.0.0","type":"theme"}"#;
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest.as_bytes()),
        ]).await.unwrap();
        let m = crate::extensions::discovery::read_manifest(&dest.path().join("manifest.json")).unwrap();
        let result = validate_package_structure(dest.path(), &m);
        assert!(result.is_err());
    }

    /// view.html replaces index.html as the required artefact.
    #[tokio::test]
    async fn validate_package_structure_extension_with_view_html_valid() {
        let manifest = r#"{
            "id":"my-ext","name":"My Ext","version":"1.0.0","type":"extension",
            "commands":[{"id":"open","name":"Open","mode":"view","component":"MainView"}]
        }"#;
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest.as_bytes()),
            ("view.html", b"<html/>"),
        ]).await.unwrap();
        let m = crate::extensions::discovery::read_manifest(&dest.path().join("manifest.json")).unwrap();
        assert!(validate_package_structure(dest.path(), &m).is_ok());
    }

    #[tokio::test]
    async fn validate_package_structure_extension_missing_view_html() {
        let manifest = r#"{
            "id":"my-ext","name":"My Ext","version":"1.0.0","type":"extension",
            "commands":[{"id":"open","name":"Open","mode":"view","component":"MainView"}]
        }"#;
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest.as_bytes()),
        ]).await.unwrap();
        let m = crate::extensions::discovery::read_manifest(&dest.path().join("manifest.json")).unwrap();
        let result = validate_package_structure(dest.path(), &m);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("view.html"));
    }

    /// extensions declaring `background.main` must include `worker.html`.
    #[tokio::test]
    async fn validate_package_structure_with_background_main_requires_worker_html() {
        let manifest = r#"{
            "id":"my-ext","name":"My Ext","version":"1.0.0","type":"extension",
            "background": {"main": "dist/worker.js"},
            "commands":[{"id":"tick","name":"Tick","mode":"background"}]
        }"#;
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest.as_bytes()),
            // worker.html deliberately absent.
        ]).await.unwrap();
        let m = crate::extensions::discovery::read_manifest(&dest.path().join("manifest.json")).unwrap();
        let result = validate_package_structure(dest.path(), &m);
        assert!(
            result.is_err(),
            " installer must require worker.html when background.main is declared"
        );
        assert!(result.unwrap_err().to_string().contains("worker.html"));
    }

    /// both view.html (for any extension) and worker.html (when
    /// background.main is set) present → passes validation.
    #[tokio::test]
    async fn validate_package_structure_with_background_main_and_worker_html_valid() {
        let manifest = r#"{
            "id":"my-ext","name":"My Ext","version":"1.0.0","type":"extension",
            "background": {"main": "dist/worker.js"},
            "commands":[
                {"id":"open","name":"Open","mode":"view","component":"MainView"},
                {"id":"tick","name":"Tick","mode":"background"}
            ]
        }"#;
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest.as_bytes()),
            ("view.html", b"<html/>"),
            ("worker.html", b"<html/>"),
        ]).await.unwrap();
        let m = crate::extensions::discovery::read_manifest(&dest.path().join("manifest.json")).unwrap();
        assert!(validate_package_structure(dest.path(), &m).is_ok());
    }

    /// hotfix: `view.html` nested under `dist/` (the shape emitted by
    /// per-extension Vite configs that build into `dist/`) must satisfy the
    /// validator with no presence at the extraction root. Mirrors the dual-path
    /// resolution the `asyar-extension://` URI scheme handler already performs.
    #[tokio::test]
    async fn validate_package_structure_extension_with_view_html_in_dist_valid() {
        let manifest = r#"{
            "id":"my-ext","name":"My Ext","version":"1.0.0","type":"extension",
            "commands":[{"id":"open","name":"Open","mode":"view","component":"MainView"}]
        }"#;
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest.as_bytes()),
            ("dist/view.html", b"<html/>"),
        ]).await.unwrap();
        let m = crate::extensions::discovery::read_manifest(&dest.path().join("manifest.json")).unwrap();
        assert!(
            validate_package_structure(dest.path(), &m).is_ok(),
            "view.html at dist/view.html must satisfy the validator"
        );
    }

    /// hotfix: `worker.html` nested under `dist/` must satisfy the
    /// validator when `background.main` is declared, with no presence at the
    /// extraction root.
    #[tokio::test]
    async fn validate_package_structure_with_worker_html_in_dist_valid() {
        let manifest = r#"{
            "id":"my-ext","name":"My Ext","version":"1.0.0","type":"extension",
            "background": {"main": "dist/worker.js"},
            "commands":[
                {"id":"open","name":"Open","mode":"view","component":"MainView"},
                {"id":"tick","name":"Tick","mode":"background"}
            ]
        }"#;
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest.as_bytes()),
            ("dist/view.html", b"<html/>"),
            ("dist/worker.html", b"<html/>"),
        ]).await.unwrap();
        let m = crate::extensions::discovery::read_manifest(&dest.path().join("manifest.json")).unwrap();
        assert!(
            validate_package_structure(dest.path(), &m).is_ok(),
            "worker.html at dist/worker.html must satisfy the validator"
        );
    }

    #[tokio::test]
    async fn validate_package_structure_invalid_id_dotdot() {
        // Sneak the bad id past `read_manifest` (validator rejects the
        // mode/component-less extension otherwise) with a full valid body.
        let manifest = r#"{
            "id":"../evil","name":"Evil","version":"1.0.0","type":"extension",
            "commands":[{"id":"open","name":"Open","mode":"view","component":"MainView"}]
        }"#;
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest.as_bytes()),
            ("view.html", b"<html/>"),
        ]).await.unwrap();
        let m = crate::extensions::discovery::read_manifest(&dest.path().join("manifest.json")).unwrap();
        let result = validate_package_structure(dest.path(), &m);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("ID"));
    }

    /// The new parser's `type` field defaults to `"extension"`, so a manifest
    /// with no `type` field but a valid view command is legal.
    #[tokio::test]
    async fn validate_package_structure_absent_type_defaults_to_extension() {
        let manifest = r#"{
            "id":"no-type","name":"NoType","version":"1.0.0",
            "commands":[{"id":"open","name":"Open","mode":"view","component":"MainView"}]
        }"#;
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest.as_bytes()),
            ("view.html", b"<html/>"),
        ]).await.unwrap();
        let m = crate::extensions::discovery::read_manifest(&dest.path().join("manifest.json")).unwrap();
        assert!(validate_package_structure(dest.path(), &m).is_ok());
    }

    /// Legacy `type: "view"` must be rejected at `read_manifest` time, before
    /// the package-structure validator ever runs.
    #[tokio::test]
    async fn read_manifest_rejects_legacy_type_view_at_install_time() {
        let manifest = r#"{
            "id":"legacy","name":"Legacy","version":"1.0.0","type":"view",
            "commands":[{"id":"open","name":"Open","mode":"view","component":"MainView"}]
        }"#;
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest.as_bytes()),
            ("view.html", b"<html/>"),
        ]).await.unwrap();
        let result = crate::extensions::discovery::read_manifest(&dest.path().join("manifest.json"));
        let err = result.expect_err("legacy type=view must be rejected at install time");
        assert!(format!("{err}").contains("unsupported type"), "got: {err}");
    }

    /// Legacy `type: "result"` likewise rejected before install-time
    /// structural checks.
    #[tokio::test]
    async fn read_manifest_rejects_legacy_type_result_at_install_time() {
        let manifest = r#"{
            "id":"legacy","name":"Legacy","version":"1.0.0","type":"result"
        }"#;
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest.as_bytes()),
        ]).await.unwrap();
        let result = crate::extensions::discovery::read_manifest(&dest.path().join("manifest.json"));
        let err = result.expect_err("legacy type=result must be rejected at install time");
        assert!(format!("{err}").contains("unsupported type"), "got: {err}");
    }

    #[test]
    fn version_conflict_new_id_is_fresh_install() {
        assert_eq!(check_version_conflict(None, "1.0.0"), VersionAction::FreshInstall);
    }

    #[test]
    fn version_conflict_higher_version_upgrades() {
        assert_eq!(check_version_conflict(Some("1.0.0"), "2.0.0"), VersionAction::Upgrade);
    }

    #[test]
    fn version_conflict_same_version_errors() {
        assert_eq!(check_version_conflict(Some("1.0.0"), "1.0.0"), VersionAction::AlreadyInstalled);
    }

    #[test]
    fn version_conflict_lower_version_errors() {
        assert_eq!(check_version_conflict(Some("2.0.0"), "1.0.0"), VersionAction::AlreadyInstalled);
    }

    #[tokio::test]
    async fn validate_file_path_rejects_non_asyar() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let bad_path = tmp.path().with_extension("zip");
        // Copy instead of rename to avoid cross-device issues with tempfiles
        std::fs::copy(tmp.path(), &bad_path).unwrap();
        let result = validate_file_path(&bad_path);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains(".asyar"));
        let _ = std::fs::remove_file(&bad_path);
    }

    #[tokio::test]
    async fn validate_file_path_rejects_nonexistent() {
        let result = validate_file_path(Path::new("/nonexistent/file.asyar"));
        assert!(result.is_err());
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
            r#"{{
                "id":"test.ext","name":"T","version":"1.0.0","description":"d",
                "type":"extension","platforms":["{}"],
                "commands":[{{"id":"open","name":"Open","mode":"view","component":"MainView"}}]
            }}"#,
            incompatible_os
        );

        // Extract the zip to a temp dir, then run the platform check manually
        // (We can't call install_from_url without an AppHandle, so test the manifest check path directly)
        let dest = make_zip_and_extract(&[
            ("manifest.json", manifest_json.as_bytes()),
            ("view.html", b"<html/>"),
        ]).await.unwrap();

        use crate::extensions::discovery::{read_manifest, validate_compatibility};
        use crate::extensions::CompatibilityStatus;
        let manifest = read_manifest(&dest.path().join("manifest.json")).unwrap();
        assert!(matches!(
            validate_compatibility(&manifest),
            CompatibilityStatus::PlatformNotSupported { .. }
        ));
    }

    /// End-to-end: the synthetic  fixture at
    /// `tests/fixtures/worker_view_fixture/` must pass `validate_package_structure`
    /// with the  installer rules (view.html + worker.html both present).
    #[test]
    fn worker_view_fixture_passes_validation() {
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/worker_view_fixture");
        let manifest_path = fixture.join("manifest.json");
        let m = crate::extensions::discovery::read_manifest(&manifest_path)
            .expect("fixture manifest must parse");
        let result = validate_package_structure(&fixture, &m);
        assert!(result.is_ok(), "fixture must pass  validation: {:?}", result.err());
        // Confirm both artefacts are present in the fixture directory.
        assert!(fixture.join("view.html").exists(), "fixture must include view.html");
        assert!(fixture.join("worker.html").exists(), "fixture must include worker.html");
        // Confirm first_view_component is correctly derived.
        assert_eq!(m.first_view_component(), Some("MainView"));
    }
}
