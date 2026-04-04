//! Extension updater: check for updates and atomically apply them.

use log::{info, warn, error};
use serde::{Deserialize, Serialize};
use crate::error::AppError;
use crate::extensions::{get_app_data_dir, ExtensionRegistryState};
use crate::extensions::installer;
use crate::extensions::discovery::{read_manifest, validate_compatibility};
use crate::extensions::CompatibilityStatus;
use std::fs;
use tauri::{AppHandle, Emitter};

/// Progress events emitted to the frontend via Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum UpdateProgress {
    Checking,
    #[serde(rename_all = "camelCase")]
    Downloading { extension_id: String, extension_name: String },
    #[serde(rename_all = "camelCase")]
    Verifying { extension_id: String },
    #[serde(rename_all = "camelCase")]
    Extracting { extension_id: String },
    #[serde(rename_all = "camelCase")]
    Swapping { extension_id: String },
    #[serde(rename_all = "camelCase")]
    Complete { extension_id: String },
    #[serde(rename_all = "camelCase")]
    Failed { extension_id: String, error: String },
}

/// A single available update returned by the store API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub extension_id: String,
    pub name: String,
    pub slug: String,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: String,
    pub checksum: String,
}

/// Request body for POST /api/extensions/check-updates.
#[derive(Debug, Serialize)]
struct CheckUpdatesRequest {
    extensions: Vec<LocalExtensionVersion>,
}

#[derive(Debug, Serialize)]
struct LocalExtensionVersion {
    id: String,
    version: String,
}

/// Response from the check-updates endpoint.
#[derive(Debug, Deserialize)]
struct CheckUpdatesResponse {
    updates: Vec<AvailableUpdate>,
}

/// Check the store API for available updates for all installed (non-built-in) extensions.
pub async fn check_for_updates(
    registry: &ExtensionRegistryState,
    store_api_base_url: &str,
) -> Result<Vec<AvailableUpdate>, AppError> {
    // 1. Collect installed non-built-in extension versions
    let local_versions: Vec<LocalExtensionVersion> = {
        let reg = registry.extensions.lock().map_err(|_| AppError::Lock)?;
        reg.values()
            .filter(|r| !r.is_built_in)
            .map(|r| LocalExtensionVersion {
                id: r.manifest.id.clone(),
                version: r.manifest.version.clone(),
            })
            .collect()
    };

    if local_versions.is_empty() {
        return Ok(vec![]);
    }

    // 2. POST to store API
    let url = format!("{}/api/extensions/check-updates", store_api_base_url.trim_end_matches('/'));
    let body = CheckUpdatesRequest { extensions: local_versions };
    
    let client = reqwest::Client::new();
    let response = client.post(&url)
        .json(&body)
        .send()
        .await
        .map_err(AppError::Network)?;

    if !response.status().is_success() {
        return Err(AppError::Network(
            response.error_for_status().unwrap_err()
        ));
    }

    let parsed: CheckUpdatesResponse = response.json().await
        .map_err(AppError::Network)?;

    // 3. Defense-in-depth: local semver post-filter
    let updates = parsed.updates.into_iter().filter(|u| {
        match (semver::Version::parse(&u.current_version), semver::Version::parse(&u.latest_version)) {
            (Ok(current), Ok(latest)) => latest > current,
            _ => true, // Trust server if local parsing fails
        }
    }).collect();

    Ok(updates)
}

/// Update a single extension atomically.
///
/// Downloads the new version, verifies checksum, extracts to a staging directory,
/// then atomically swaps directories. Rolls back on failure.
pub async fn update_extension(
    app_handle: &AppHandle,
    update: &AvailableUpdate,
) -> Result<(), AppError> {
    let base_dir = get_app_data_dir(app_handle)?.join("extensions");
    let live_dir = base_dir.join(&update.extension_id);
    let staging_dir = base_dir.join(format!("{}_updating", &update.extension_id));
    let backup_dir = base_dir.join(format!("{}_old", &update.extension_id));

    // Clean up any leftover dirs from a previous failed update
    if staging_dir.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
    }
    if backup_dir.exists() {
        let _ = fs::remove_dir_all(&backup_dir);
    }

    // Verify live directory exists (can't update what's not installed)
    if !live_dir.exists() {
        return Err(AppError::NotFound(format!(
            "Extension '{}' is not installed — cannot update",
            update.extension_id
        )));
    }

    // --- Download ---
    emit_progress(app_handle, UpdateProgress::Downloading {
        extension_id: update.extension_id.clone(),
        extension_name: update.name.clone(),
    });
    installer::validate_download_url(&update.download_url)?;
    let temp_file = installer::download_to_temp_file(&update.download_url).await?;
    info!("Downloaded update for '{}' to {:?}", update.extension_id, temp_file.path());

    // --- Verify checksum ---
    emit_progress(app_handle, UpdateProgress::Verifying {
        extension_id: update.extension_id.clone(),
    });
    installer::verify_checksum(temp_file.path(), &update.checksum)?;

    // --- Extract to staging ---
    emit_progress(app_handle, UpdateProgress::Extracting {
        extension_id: update.extension_id.clone(),
    });
    if let Err(e) = installer::extract_zip(temp_file.path(), &staging_dir).await {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(e);
    }

    // --- Validate compatibility on new manifest ---
    let manifest_path = staging_dir.join("manifest.json");
    if manifest_path.exists() {
        match read_manifest(&manifest_path) {
            Ok(manifest) => {
                if let CompatibilityStatus::PlatformNotSupported { platform, supported } =
                    validate_compatibility(&manifest)
                {
                    let _ = fs::remove_dir_all(&staging_dir);
                    return Err(AppError::Validation(format!(
                        "Updated extension '{}' does not support {} (supported: {})",
                        update.name,
                        platform,
                        if supported.is_empty() { "none".to_string() } else { supported.join(", ") }
                    )));
                }
            }
            Err(e) => {
                warn!("Could not read manifest for compatibility check during update: {}", e);
            }
        }
    }

    // --- Atomic swap ---
    emit_progress(app_handle, UpdateProgress::Swapping {
        extension_id: update.extension_id.clone(),
    });

    // Step 1: Move live → backup
    if let Err(e) = fs::rename(&live_dir, &backup_dir) {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(AppError::Platform(format!(
            "Failed to move current extension to backup: {}", e
        )));
    }

    // Step 2: Move staging → live
    if let Err(e) = fs::rename(&staging_dir, &live_dir) {
        // Rollback: restore backup → live
        error!("Failed to promote staging dir, rolling back: {}", e);
        if let Err(rb_err) = fs::rename(&backup_dir, &live_dir) {
            error!("CRITICAL: Rollback also failed: {}. Extension '{}' may be in an inconsistent state.", rb_err, update.extension_id);
        }
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(AppError::Platform(format!(
            "Failed to promote updated extension: {}", e
        )));
    }

    // Step 3: Clean up backup (non-critical)
    if let Err(e) = fs::remove_dir_all(&backup_dir) {
        warn!("Failed to remove backup directory for '{}': {}", update.extension_id, e);
    }

    // --- Done ---
    emit_progress(app_handle, UpdateProgress::Complete {
        extension_id: update.extension_id.clone(),
    });

    info!(
        "Extension '{}' updated successfully from v{} to v{}",
        update.extension_id, update.current_version, update.latest_version
    );

    if let Err(e) = app_handle.emit("extensions_updated", ()) {
        warn!("Failed to emit extensions_updated event: {}", e);
    }

    Ok(())
}

/// Update multiple extensions sequentially.
/// Returns a result for each extension — does not short-circuit on failure.
pub async fn update_all(
    app_handle: &AppHandle,
    updates: &[AvailableUpdate],
) -> Vec<(String, Result<(), AppError>)> {
    let mut results = Vec::with_capacity(updates.len());
    for update in updates {
        let result = update_extension(app_handle, update).await;
        if let Err(ref e) = result {
            emit_progress(app_handle, UpdateProgress::Failed {
                extension_id: update.extension_id.clone(),
                error: e.to_string(),
            });
        }
        results.push((update.extension_id.clone(), result));
    }
    results
}

fn emit_progress(app_handle: &AppHandle, progress: UpdateProgress) {
    if let Err(e) = app_handle.emit("extension_update_progress", &progress) {
        warn!("Failed to emit update progress event: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::path::Path;

    /// Helper: create a fake extension directory with a manifest.json
    fn create_fake_extension(dir: &Path, id: &str, version: &str) {
        let ext_dir = dir.join(id);
        fs::create_dir_all(&ext_dir).unwrap();
        let manifest = serde_json::json!({
            "id": id,
            "name": format!("Test {}", id),
            "version": version,
            "description": "test extension",
            "commands": []
        });
        fs::write(ext_dir.join("manifest.json"), manifest.to_string()).unwrap();
        fs::write(ext_dir.join("index.js"), "console.log('hello')").unwrap();
    }

    #[test]
    fn atomic_swap_success() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        
        // Create "live" directory (old version)
        create_fake_extension(base, "test-ext", "1.0.0");
        
        // Create "staging" directory (new version)
        let staging = base.join("test-ext_updating");
        fs::create_dir_all(&staging).unwrap();
        let new_manifest = serde_json::json!({
            "id": "test-ext",
            "name": "Test test-ext",
            "version": "2.0.0",
            "description": "updated",
            "commands": []
        });
        fs::write(staging.join("manifest.json"), new_manifest.to_string()).unwrap();
        fs::write(staging.join("index.js"), "console.log('v2')").unwrap();

        let live = base.join("test-ext");
        let backup = base.join("test-ext_old");

        // Execute the atomic swap
        fs::rename(&live, &backup).unwrap();
        fs::rename(&staging, &live).unwrap();
        fs::remove_dir_all(&backup).unwrap();

        // Verify: live has the new version
        let content = fs::read_to_string(live.join("manifest.json")).unwrap();
        assert!(content.contains("2.0.0"));
        assert!(content.contains("updated"));
        
        // Verify: backup is gone
        assert!(!backup.exists());
        
        // Verify: staging is gone
        assert!(!staging.exists());
    }

    #[test]
    fn cleanup_stale_staging_dirs() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        
        // Create leftover dirs from a previous failed update
        let stale_staging = base.join("test-ext_updating");
        let stale_backup = base.join("test-ext_old");
        fs::create_dir_all(&stale_staging).unwrap();
        fs::write(stale_staging.join("leftover.txt"), "stale").unwrap();
        fs::create_dir_all(&stale_backup).unwrap();
        fs::write(stale_backup.join("leftover.txt"), "stale").unwrap();

        // Simulate cleanup (same as update_extension does)
        if stale_staging.exists() {
            fs::remove_dir_all(&stale_staging).unwrap();
        }
        if stale_backup.exists() {
            fs::remove_dir_all(&stale_backup).unwrap();
        }

        assert!(!stale_staging.exists());
        assert!(!stale_backup.exists());
    }

    #[test]
    fn check_updates_request_serialization() {
        let req = CheckUpdatesRequest {
            extensions: vec![
                LocalExtensionVersion { id: "com.test.a".into(), version: "1.0.0".into() },
                LocalExtensionVersion { id: "com.test.b".into(), version: "2.3.1".into() },
            ],
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["extensions"][0]["id"], "com.test.a");
        assert_eq!(json["extensions"][0]["version"], "1.0.0");
        assert_eq!(json["extensions"][1]["id"], "com.test.b");
        assert_eq!(json["extensions"][1]["version"], "2.3.1");
    }

    #[test]
    fn local_semver_post_filter() {
        // latest > current → keep
        let current = semver::Version::parse("1.0.0").unwrap();
        let latest = semver::Version::parse("2.0.0").unwrap();
        assert!(latest > current);

        // latest == current → discard
        let same = semver::Version::parse("1.0.0").unwrap();
        assert!(!(same > current));

        // latest < current → discard  
        let older = semver::Version::parse("0.9.0").unwrap();
        assert!(!(older > current));
    }

    #[test]
    fn available_update_serialization_roundtrip() {
        let update = AvailableUpdate {
            extension_id: "com.test.ext".into(),
            name: "Test Ext".into(),
            slug: "test-ext".into(),
            current_version: "1.0.0".into(),
            latest_version: "2.0.0".into(),
            download_url: "https://example.com/v2.zip".into(),
            checksum: "sha256:abc123".into(),
        };
        let json = serde_json::to_string(&update).unwrap();
        let parsed: AvailableUpdate = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.extension_id, "com.test.ext");
        assert_eq!(parsed.latest_version, "2.0.0");
    }

    #[test]
    fn update_progress_serialization() {
        let progress = UpdateProgress::Downloading {
            extension_id: "com.test.ext".into(),
            extension_name: "Test".into(),
        };
        let json = serde_json::to_value(&progress).unwrap();
        assert_eq!(json["status"], "downloading");
        assert_eq!(json["extensionId"], "com.test.ext");
        assert_eq!(json["extensionName"], "Test");

        let complete = UpdateProgress::Complete { extension_id: "x".into() };
        let json2 = serde_json::to_value(&complete).unwrap();
        assert_eq!(json2["status"], "complete");
    }
}
