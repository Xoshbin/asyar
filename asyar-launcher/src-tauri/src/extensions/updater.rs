//! Extension updater: check for updates and atomically apply them.

use crate::error::AppError;
use crate::extensions::discovery::{read_manifest, validate_compatibility};
use crate::extensions::installer;
use crate::extensions::CompatibilityStatus;
use crate::extensions::{get_app_data_dir, ExtensionRegistryState};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Shared by all update entry points through the managed extension registry.
/// Weak entries keep finished/uninstalled IDs from accumulating indefinitely.
#[derive(Default)]
pub(crate) struct UpdateLocks {
    by_id: std::sync::Mutex<
        std::collections::HashMap<String, std::sync::Weak<tokio::sync::Mutex<()>>>,
    >,
}

impl UpdateLocks {
    pub(crate) async fn lock(
        &self,
        id: &str,
    ) -> Result<tokio::sync::OwnedMutexGuard<()>, AppError> {
        let lock = {
            let mut by_id = self.by_id.lock().map_err(|_| AppError::Lock)?;
            by_id.retain(|_, lock| lock.strong_count() > 0);
            if let Some(lock) = by_id.get(id).and_then(std::sync::Weak::upgrade) {
                lock
            } else {
                let lock = std::sync::Arc::new(tokio::sync::Mutex::new(()));
                by_id.insert(id.to_owned(), std::sync::Arc::downgrade(&lock));
                lock
            }
        };
        Ok(lock.lock_owned().await)
    }
}

/// Progress events emitted to the frontend via Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum UpdateProgress {
    Checking,
    #[serde(rename_all = "camelCase")]
    Downloading {
        extension_id: String,
        extension_name: String,
    },
    #[serde(rename_all = "camelCase")]
    Verifying {
        extension_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Extracting {
        extension_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Swapping {
        extension_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Complete {
        extension_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        extension_id: String,
        error: String,
    },
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
    let url = format!(
        "{}/api/extensions/check-updates",
        store_api_base_url.trim_end_matches('/')
    );
    let body = CheckUpdatesRequest {
        extensions: local_versions,
    };

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(AppError::Network)?;

    if !response.status().is_success() {
        return Err(AppError::Network(response.error_for_status().unwrap_err()));
    }

    let parsed: CheckUpdatesResponse = response.json().await.map_err(AppError::Network)?;

    // Bind every offer to the inventory we actually sent. The server cannot
    // nominate another path or invent a current version to permit a downgrade.
    // Invalid or unrequested offers are ignored with a warning so one broken
    // offer does not block updates for the user's other extensions.
    let mut valid_updates = Vec::new();
    for update in parsed.updates {
        let Some(local) = body
            .extensions
            .iter()
            .find(|local| local.id == update.extension_id)
        else {
            warn!(
                "Update offered for unrequested extension '{}' — ignoring",
                update.extension_id
            );
            continue;
        };
        if let Err(e) = validate_update_offer(&update, &local.version) {
            warn!(
                "Invalid update offer for '{}': {} — ignoring",
                update.extension_id, e
            );
            continue;
        }
        valid_updates.push(update);
    }
    Ok(valid_updates)
}

fn validate_update_offer(
    update: &AvailableUpdate,
    installed_version: &str,
) -> Result<(), AppError> {
    installer::validate_extension_id(&update.extension_id)?;
    let current = semver::Version::parse(installed_version)
        .map_err(|e| AppError::Validation(format!("Invalid installed version: {e}")))?;
    let latest = semver::Version::parse(&update.latest_version)
        .map_err(|e| AppError::Validation(format!("Invalid update version: {e}")))?;
    if update.current_version != installed_version || latest <= current {
        return Err(AppError::Validation(
            "Update must upgrade the installed version".into(),
        ));
    }
    installer::validate_download_url(&update.download_url)?;
    let valid_checksum = update
        .checksum
        .strip_prefix("sha256:")
        .is_some_and(|hash| hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()));
    if !valid_checksum {
        return Err(AppError::Validation(
            "Update requires a SHA-256 checksum".into(),
        ));
    }
    Ok(())
}

/// Resolve a real installed directory before downloading or mutating anything.
/// Reparse points/junctions must not redirect the updater outside its root.
fn validate_update_target(base_dir: &Path, update: &AvailableUpdate) -> Result<PathBuf, AppError> {
    installer::validate_extension_id(&update.extension_id)?;
    let root = dunce::canonicalize(base_dir)?;
    let live = root.join(&update.extension_id);
    let metadata = fs::symlink_metadata(&live)?;
    #[cfg(windows)]
    let is_link = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 // FILE_ATTRIBUTE_REPARSE_POINT
    };
    #[cfg(not(windows))]
    let is_link = metadata.file_type().is_symlink();
    if is_link || !metadata.is_dir() || dunce::canonicalize(&live)?.parent() != Some(root.as_path())
    {
        return Err(AppError::Validation(
            "Update target must be a directory inside the extension root".into(),
        ));
    }
    let installed = read_manifest(&live.join("manifest.json"))?;
    if installed.id != update.extension_id {
        return Err(AppError::Validation(
            "Installed manifest does not match the update ID".into(),
        ));
    }
    validate_update_offer(update, &installed.version)?;
    Ok(live)
}

async fn prepare_update(
    registry: &ExtensionRegistryState,
    base_dir: &Path,
    update: &AvailableUpdate,
) -> Result<(tokio::sync::OwnedMutexGuard<()>, PathBuf), AppError> {
    installer::validate_extension_id(&update.extension_id)?;
    let guard = registry.update_locks.lock(&update.extension_id).await?;
    let live = validate_update_target(base_dir, update)?;
    Ok((guard, live))
}

fn validate_update_package(
    staging_dir: &Path,
    update: &AvailableUpdate,
) -> Result<crate::extensions::ExtensionManifest, AppError> {
    let manifest = read_manifest(&staging_dir.join("manifest.json"))?;
    if manifest.id != update.extension_id || manifest.version != update.latest_version {
        return Err(AppError::Validation(
            "Update package ID/version does not match the requested update".into(),
        ));
    }
    installer::validate_package_structure(staging_dir, &manifest)?;
    if let CompatibilityStatus::PlatformNotSupported {
        platform,
        supported,
    } = validate_compatibility(&manifest)
    {
        return Err(AppError::Validation(format!(
            "Updated extension does not support {platform} (supported: {})",
            supported.join(", ")
        )));
    }
    Ok(manifest)
}

fn promote_update(
    live_dir: &Path,
    staging_dir: &Path,
    backup_dir: &Path,
    workspace: tempfile::TempDir,
) -> Result<(), AppError> {
    // Step 1: Move live → backup
    if let Err(e) = fs::rename(live_dir, backup_dir) {
        let _ = fs::remove_dir_all(staging_dir);
        return Err(AppError::Platform(format!(
            "Failed to move current extension to backup: {}",
            e
        )));
    }

    // Step 2: Move staging → live
    if let Err(e) = fs::rename(staging_dir, live_dir) {
        // Rollback: restore backup → live
        error!("Failed to promote staging dir, rolling back: {}", e);
        if let Err(rb_err) = fs::rename(backup_dir, live_dir) {
            let recovery_dir = workspace.keep();
            error!(
                "Rollback failed: {}. Preserved extension backup at {:?}",
                rb_err, recovery_dir
            );
            return Err(AppError::Platform(format!(
                "Failed to promote update: {e}; rollback failed: {rb_err}. Backup preserved at {}",
                recovery_dir.display()
            )));
        }
        let _ = fs::remove_dir_all(staging_dir);
        return Err(AppError::Platform(format!(
            "Failed to promote updated extension: {}",
            e
        )));
    }

    // Step 3: Clean up backup (non-critical)
    if let Err(e) = fs::remove_dir_all(backup_dir) {
        warn!("Failed to remove backup directory: {}", e);
    }

    Ok(())
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
    let registry = app_handle.state::<ExtensionRegistryState>();
    // Keep the guard through download, revalidation, swap and rollback. A
    // queued offer must validate against the version its predecessor leaves.
    let (_update_guard, live_dir) = prepare_update(&registry, &base_dir, update).await?;
    // Never remove predictable sibling names: an ID ending in `_old` or
    // `_updating` may belong to a different, legitimately installed extension.
    let workspace = tempfile::Builder::new()
        .prefix(".update-")
        .tempdir_in(&base_dir)?;
    let staging_dir = workspace.path().join("package");
    let backup_dir = workspace.path().join("backup");

    // --- Download ---
    emit_progress(
        app_handle,
        UpdateProgress::Downloading {
            extension_id: update.extension_id.clone(),
            extension_name: update.name.clone(),
        },
    );
    installer::validate_download_url(&update.download_url)?;
    let temp_file = installer::download_to_temp_file(&update.download_url).await?;
    info!(
        "Downloaded update for '{}' to {:?}",
        update.extension_id,
        temp_file.path()
    );

    // --- Verify checksum ---
    emit_progress(
        app_handle,
        UpdateProgress::Verifying {
            extension_id: update.extension_id.clone(),
        },
    );
    installer::verify_checksum(temp_file.path(), &update.checksum)?;

    // --- Extract to staging ---
    emit_progress(
        app_handle,
        UpdateProgress::Extracting {
            extension_id: update.extension_id.clone(),
        },
    );
    installer::extract_zip(temp_file.path(), &staging_dir).await?;
    let manifest = validate_update_package(&staging_dir, update)?;
    manifest.write_icon_copies(&staging_dir);
    // The installed version may have changed while the download was running.
    validate_update_target(&base_dir, update)?;

    // --- Atomic swap ---
    emit_progress(
        app_handle,
        UpdateProgress::Swapping {
            extension_id: update.extension_id.clone(),
        },
    );

    promote_update(&live_dir, &staging_dir, &backup_dir, workspace)?;

    // --- Done ---
    emit_progress(
        app_handle,
        UpdateProgress::Complete {
            extension_id: update.extension_id.clone(),
        },
    );

    info!(
        "Extension '{}' updated successfully from v{} to v{}",
        update.extension_id, update.current_version, update.latest_version
    );

    crate::event_bridge::bridge_emit(app_handle, "extensions_updated", ());

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
            emit_progress(
                app_handle,
                UpdateProgress::Failed {
                    extension_id: update.extension_id.clone(),
                    error: e.to_string(),
                },
            );
        }
        results.push((update.extension_id.clone(), result));
    }
    results
}

fn emit_progress(app_handle: &AppHandle, progress: UpdateProgress) {
    crate::event_bridge::bridge_emit(app_handle, "extension_update_progress", &progress);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn offered_update() -> AvailableUpdate {
        AvailableUpdate {
            extension_id: "org.example.test".into(),
            name: "Test".into(),
            slug: "test".into(),
            current_version: "1.0.0".into(),
            latest_version: "2.0.0".into(),
            download_url: "https://example.com/update.zip".into(),
            checksum: format!("sha256:{}", "a".repeat(64)),
        }
    }

    async fn check_offer(update: AvailableUpdate) -> Result<Vec<AvailableUpdate>, AppError> {
        let registry = ExtensionRegistryState::new();
        let record = serde_json::from_value(serde_json::json!({
            "manifest": {"id": "org.example.test", "name": "Test", "version": "1.0.0"},
            "enabled": true,
            "isBuiltIn": false,
            "path": "unused-by-update-check"
        }))
        .unwrap();
        registry
            .extensions
            .lock()
            .unwrap()
            .insert("org.example.test".into(), record);
        let mut server = mockito::Server::new_async().await;
        let request = server
            .mock("POST", "/api/extensions/check-updates")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(serde_json::json!({"updates": [update]}).to_string())
            .create_async()
            .await;
        let result = check_for_updates(&registry, &server.url()).await;
        request.assert_async().await;
        result
    }

    #[tokio::test]
    async fn update_check_rejects_unrequested_ids_and_untrusted_versions() {
        for id in ["../outside", "C:/outside", "org.example.not-installed"] {
            let mut offer = offered_update();
            offer.extension_id = id.into();
            let result = check_offer(offer).await.unwrap();
            assert!(
                result.is_empty(),
                "expected {id} to be ignored, got {result:?}"
            );
        }
        for (current, latest) in [("0.1.0", "0.2.0"), ("1.0.0", "invalid"), ("1.0.0", "0.9.0")] {
            let mut offer = offered_update();
            offer.current_version = current.into();
            offer.latest_version = latest.into();
            let result = check_offer(offer).await.unwrap();
            assert!(
                result.is_empty(),
                "expected {current} -> {latest} to be ignored, got {result:?}"
            );
        }
    }

    #[test]
    fn validate_update_offer_rejects_invalid_inputs() {
        for id in ["", ".", "..", "../outside", "id.", "id/slash"] {
            let mut offer = offered_update();
            offer.extension_id = id.into();
            assert!(validate_update_offer(&offer, "1.0.0").is_err(), "{id}");
        }
        for (current, latest) in [
            ("0.1.0", "0.2.0"),
            ("1.0.0", "invalid"),
            ("1.0.0", "0.9.0"),
            ("1.0.0", "1.0.0"),
        ] {
            let mut offer = offered_update();
            offer.current_version = current.into();
            offer.latest_version = latest.into();
            assert!(
                validate_update_offer(&offer, "1.0.0").is_err(),
                "{current} -> {latest}"
            );
        }
    }

    #[tokio::test]
    async fn update_check_accepts_requested_extension_upgrade() {
        assert_eq!(check_offer(offered_update()).await.unwrap().len(), 1);
    }

    #[test]
    fn update_target_rejects_paths_before_touching_disk() {
        let tmp = TempDir::new().unwrap();
        let sentinel = tmp.path().join("sentinel");
        fs::write(&sentinel, "keep").unwrap();
        for id in [
            "",
            ".",
            "..",
            "../sentinel",
            "a/b",
            "a\\b",
            "C:relative",
            "C:/outside",
            "\\\\server\\share",
            "id.",
            "id ",
        ] {
            let mut update = offered_update();
            update.extension_id = id.into();
            assert!(
                matches!(
                    validate_update_target(tmp.path(), &update),
                    Err(AppError::Validation(_))
                ),
                "{id}"
            );
        }
        assert_eq!(fs::read_to_string(sentinel).unwrap(), "keep");
    }

    #[test]
    fn update_target_is_bound_to_installed_manifest() {
        let tmp = TempDir::new().unwrap();
        let mut update = offered_update();
        create_fake_extension(tmp.path(), &update.extension_id, "1.0.0");
        assert!(validate_update_target(tmp.path(), &update).is_ok());
        update.current_version = "0.1.0".into();
        assert!(validate_update_target(tmp.path(), &update).is_err());
        update = offered_update();
        let manifest = tmp.path().join(&update.extension_id).join("manifest.json");
        fs::write(
            &manifest,
            r#"{"id":"org.example.other","name":"Other","version":"1.0.0","searchable":true}"#,
        )
        .unwrap();
        assert!(validate_update_target(tmp.path(), &update).is_err());
        assert_eq!(
            fs::read_to_string(tmp.path().join(&update.extension_id).join("index.js")).unwrap(),
            "console.log('hello')"
        );
    }

    #[tokio::test]
    async fn concurrent_updates_recheck_the_version_after_the_previous_swap() {
        let root = TempDir::new().unwrap();
        let registry = ExtensionRegistryState::new();
        let mut first_offer = offered_update();
        first_offer.latest_version = "3.0.0".into();
        create_fake_extension(root.path(), &first_offer.extension_id, "1.0.0");
        let (first, _) = prepare_update(&registry, root.path(), &first_offer)
            .await
            .unwrap();
        let second_offer = offered_update();
        let second = prepare_update(&registry, root.path(), &second_offer);
        tokio::pin!(second);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(30), &mut second)
                .await
                .is_err(),
            "another update must wait until the first finishes"
        );

        // The first transaction has promoted v3. The queued v1 -> v2 offer
        // must read that new manifest under the same lock, not downgrade it.
        create_fake_extension(root.path(), &first_offer.extension_id, "3.0.0");
        drop(first);
        assert!(matches!(second.await, Err(AppError::Validation(_))));
        assert_eq!(
            read_manifest(
                &root
                    .path()
                    .join(&first_offer.extension_id)
                    .join("manifest.json")
            )
            .unwrap()
            .version,
            "3.0.0"
        );
    }

    #[tokio::test]
    async fn different_extension_updates_do_not_block_each_other() {
        let root = TempDir::new().unwrap();
        let registry = ExtensionRegistryState::new();
        let first_offer = offered_update();
        create_fake_extension(root.path(), &first_offer.extension_id, "1.0.0");
        let (_first, _) = prepare_update(&registry, root.path(), &first_offer)
            .await
            .unwrap();
        let mut other = offered_update();
        other.extension_id = "org.example.other".into();
        create_fake_extension(root.path(), &other.extension_id, "1.0.0");
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(100),
            prepare_update(&registry, root.path(), &other),
        )
        .await;
        assert!(result.unwrap().is_ok());
    }

    #[test]
    fn update_package_requires_matching_valid_manifest() {
        let tmp = TempDir::new().unwrap();
        let update = offered_update();
        create_fake_extension(tmp.path(), &update.extension_id, &update.latest_version);
        let package = tmp.path().join(&update.extension_id);
        assert!(validate_update_package(&package, &update).is_ok());
        for contents in [
            "not json",
            r#"{"id":"org.example.other","name":"Other","version":"2.0.0","searchable":true}"#,
            r#"{"id":"org.example.test","name":"Test","version":"3.0.0","searchable":true}"#,
            r#"{"id":"org.example.test","name":"Test","version":"2.0.0","background":{"main":"missing.js"}}"#,
        ] {
            fs::write(package.join("manifest.json"), contents).unwrap();
            assert!(
                validate_update_package(&package, &update).is_err(),
                "{contents}"
            );
        }
        fs::remove_file(package.join("manifest.json")).unwrap();
        assert!(validate_update_package(&package, &update).is_err());
    }

    #[test]
    fn update_offer_requires_secure_url_and_checksum() {
        let mut update = offered_update();
        update.download_url = "http://example.com/update.zip".into();
        assert!(validate_update_offer(&update, "1.0.0").is_err());
        update = offered_update();
        update.checksum = "sha256:short".into();
        assert!(validate_update_offer(&update, "1.0.0").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn update_target_rejects_symlinked_installation() {
        let base = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        let update = offered_update();
        create_fake_extension(outside.path(), &update.extension_id, "1.0.0");
        std::os::unix::fs::symlink(
            outside.path().join(&update.extension_id),
            base.path().join(&update.extension_id),
        )
        .unwrap();
        assert!(validate_update_target(base.path(), &update).is_err());
    }

    /// Helper: create a fake extension directory with a manifest.json
    fn create_fake_extension(dir: &Path, id: &str, version: &str) {
        let ext_dir = dir.join(id);
        fs::create_dir_all(&ext_dir).unwrap();
        let manifest = serde_json::json!({
            "id": id,
            "name": format!("Test {}", id),
            "version": version,
            "description": "test extension",
            "searchable": true,
            "commands": []
        });
        fs::write(ext_dir.join("manifest.json"), manifest.to_string()).unwrap();
        fs::write(ext_dir.join("index.js"), "console.log('hello')").unwrap();
    }

    #[test]
    fn promote_update_promotes_staging_and_cleans_workspace() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        create_fake_extension(base, "test-ext", "1.0.0");
        let live = base.join("test-ext");

        let workspace = tempfile::Builder::new()
            .prefix(".update-")
            .tempdir_in(base)
            .unwrap();
        let staging = workspace.path().join("package");
        create_fake_extension(workspace.path(), "package", "2.0.0");
        let backup = workspace.path().join("backup");

        assert!(promote_update(&live, &staging, &backup, workspace).is_ok());

        let content = fs::read_to_string(live.join("manifest.json")).unwrap();
        assert!(content.contains("2.0.0"));
    }

    #[test]
    fn promote_update_rolls_back_when_promotion_fails() {
        let tmp = TempDir::new().unwrap();
        let base = tmp.path();
        create_fake_extension(base, "test-ext", "1.0.0");
        let live = base.join("test-ext");

        let workspace = tempfile::Builder::new()
            .prefix(".update-")
            .tempdir_in(base)
            .unwrap();
        // staging does not exist, so Step 2 (staging -> live) will fail
        let staging = workspace.path().join("missing-staging");
        let backup = workspace.path().join("backup");

        let result = promote_update(&live, &staging, &backup, workspace);
        assert!(result.is_err());

        // Live must have been restored to 1.0.0
        let content = fs::read_to_string(live.join("manifest.json")).unwrap();
        assert!(content.contains("1.0.0"));
    }

    #[test]
    fn check_updates_request_serialization() {
        let req = CheckUpdatesRequest {
            extensions: vec![
                LocalExtensionVersion {
                    id: "com.test.a".into(),
                    version: "1.0.0".into(),
                },
                LocalExtensionVersion {
                    id: "com.test.b".into(),
                    version: "2.3.1".into(),
                },
            ],
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["extensions"][0]["id"], "com.test.a");
        assert_eq!(json["extensions"][0]["version"], "1.0.0");
        assert_eq!(json["extensions"][1]["id"], "com.test.b");
        assert_eq!(json["extensions"][1]["version"], "2.3.1");
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

        let complete = UpdateProgress::Complete {
            extension_id: "x".into(),
        };
        let json2 = serde_json::to_value(&complete).unwrap();
        assert_eq!(json2["status"], "complete");
    }
}
