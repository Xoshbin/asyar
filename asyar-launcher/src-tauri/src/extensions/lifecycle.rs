//! Extension lifecycle: install/uninstall orchestration, discovery, enable/disable.

use log::{info, warn};
use crate::error::AppError;
use crate::extensions::{
    discovery, ExtensionRegistryState, ExtensionRecord,
    get_app_data_dir, get_extensions_dir, get_builtin_features_path, get_dev_extension_paths,
};
use crate::storage::DataStore;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager};

pub(crate) fn uninstall(
    app_handle: &AppHandle,
    extension_id: &str,
    registry: &ExtensionRegistryState,
) -> Result<(), AppError> {
    // Validate
    if extension_id.trim().is_empty() {
        return Err(AppError::Validation("Extension ID cannot be empty".to_string()));
    }
    if extension_id.contains("..") {
        return Err(AppError::Validation("Extension ID contains invalid characters".to_string()));
    }

    // Check not built-in
    {
        let reg = registry.extensions.lock().map_err(|_| AppError::Lock)?;
        if let Some(record) = reg.get(extension_id) {
            if record.is_built_in {
                return Err(AppError::Validation("Cannot uninstall built-in features".to_string()));
            }
        }
    }

    // Remove directory
    let install_dir = get_app_data_dir(app_handle)?.join("extensions").join(extension_id);
    if install_dir.exists() {
        info!("Uninstalling extension '{}' at {:?}", extension_id, install_dir);
        fs::remove_dir_all(&install_dir)?;
    } else {
        warn!("Extension directory not found for '{}', cleaning up settings only", extension_id);
    }

    // Clean up settings atomically
    {
        use tauri_plugin_store::StoreExt;
        let store = app_handle.store("settings.dat")
            .map_err(|e| AppError::Other(format!("Failed to open settings store: {}", e)))?;

        if let Some(mut settings) = store.get("settings") {
            let mut modified = false;
            if let Some(extensions) = settings.get_mut("extensions") {
                if let Some(enabled) = extensions.get_mut("enabled") {
                    if let Some(obj) = enabled.as_object_mut() {
                        if obj.remove(extension_id).is_some() {
                            modified = true;
                        }
                    }
                }
            }
            if modified {
                store.set("settings", settings);
                store.save()
                    .map_err(|e| AppError::Other(format!("Failed to save settings: {}", e)))?;
            }
        }
    }

    // Remove from in-memory registry
    {
        let mut reg = registry.extensions.lock().map_err(|_| AppError::Lock)?;
        reg.remove(extension_id);
    }

    // Clean up extension key-value storage from SQLite
    if let Some(data_store) = app_handle.try_state::<DataStore>() {
        match data_store.conn() {
            Ok(conn) => {
                match crate::storage::extension_kv::clear(&conn, extension_id) {
                    Ok(count) => {
                        if count > 0 {
                            info!("Cleared {} storage entries for extension '{}'", count, extension_id);
                        }
                    }
                    Err(e) => warn!("Failed to clear storage for '{}': {}", extension_id, e),
                }

                match crate::storage::extension_preferences::clear(&conn, extension_id) {
                    Ok(count) => {
                        if count > 0 {
                            info!("Cleared {} preference entries for extension '{}'", count, extension_id);
                        }
                    }
                    Err(e) => warn!("Failed to clear preferences for '{}': {}", extension_id, e),
                }

                match crate::storage::extension_cache::clear(&conn, extension_id) {
                    Ok(count) => {
                        if count > 0 {
                            info!("Cleared {} cache entries for extension '{}'", count, extension_id);
                        }
                    }
                    Err(e) => warn!("Failed to clear cache for '{}': {}", extension_id, e),
                }
            }
            Err(e) => warn!("Failed to acquire DB lock for storage cleanup: {}", e),
        }
    }

    // Clean up OAuth tokens from SQLite
    if let Some(data_store) = app_handle.try_state::<DataStore>() {
        match data_store.conn() {
            Ok(conn) => {
                match crate::oauth::token_store::delete_all_for_extension(&conn, extension_id) {
                    Ok(count) => {
                        if count > 0 {
                            info!("Cleared {} OAuth tokens for extension '{}'", count, extension_id);
                        }
                    }
                    Err(e) => warn!("Failed to clear OAuth tokens for '{}': {}", extension_id, e),
                }
            }
            Err(e) => warn!("Failed to acquire DB lock for OAuth cleanup: {}", e),
        }
    }

    // Clean up shell trusted binaries from SQLite
    if let Some(data_store) = app_handle.try_state::<DataStore>() {
        match data_store.conn() {
            Ok(conn) => {
                match crate::storage::shell::cleanup_extension(&conn, extension_id) {
                    Ok(_) => info!("Cleared shell trusted binaries for extension '{}'", extension_id),
                    Err(e) => warn!("Failed to clear shell trust for '{}': {}", extension_id, e),
                }
            }
            Err(e) => warn!("Failed to acquire DB lock for shell cleanup: {}", e),
        }
    }

    // Release any active power inhibitors held by this extension.
    if let Some(power_registry) = app_handle.try_state::<crate::power::PowerRegistry>() {
        match power_registry.release_all_for_extension(extension_id) {
            Ok(n) if n > 0 => {
                info!("Released {} power inhibitors for extension '{}'", n, extension_id)
            }
            Ok(_) => {}
            Err(e) => warn!(
                "Failed to release power inhibitors for '{}': {}",
                extension_id, e
            ),
        }
    }

    // Remove all system-event subscriptions held by this extension.
    if let Some(hub) = app_handle.try_state::<std::sync::Arc<crate::system_events::SystemEventsHub>>() {
        match hub.remove_all_for_extension(extension_id) {
            Ok(n) if n > 0 => {
                info!("Removed {} system-event subscriptions for extension '{}'", n, extension_id)
            }
            Ok(_) => {}
            Err(e) => warn!(
                "Failed to remove system-event subscriptions for '{}': {}",
                extension_id, e
            ),
        }
    }

    // Remove all app-event subscriptions held by this extension.
    if let Some(hub) = app_handle.try_state::<std::sync::Arc<crate::app_events::AppEventsHub>>() {
        match hub.remove_all_for_extension(extension_id) {
            Ok(n) if n > 0 => {
                info!("Removed {} app-event subscriptions for extension '{}'", n, extension_id)
            }
            Ok(_) => {}
            Err(e) => warn!(
                "Failed to remove app-event subscriptions for '{}': {}",
                extension_id, e
            ),
        }
    }

    // Destroy every tray icon owned by this extension. Each registered
    // top-level `IStatusBarItem` lives as an independent menu-bar tray, so
    // uninstall sweeps them so the icons vanish the moment the extension
    // is gone.
    if let Some(tray_mgr) = app_handle.try_state::<crate::extension_tray::ExtensionTrayManager>() {
        match tray_mgr.remove_all_for_extension(extension_id) {
            Ok(removed) if !removed.is_empty() => {
                info!(
                    "Removed {} tray icon(s) for extension '{}'",
                    removed.len(),
                    extension_id
                );
            }
            Ok(_) => {}
            Err(e) => warn!("Failed to remove tray icons for '{}': {}", extension_id, e),
        }
    }

    // Notify frontend
    if let Err(e) = app_handle.emit("extensions_updated", ()) {
        warn!("Failed to emit extensions_updated event: {}", e);
    }

    info!("Extension '{}' uninstalled successfully (directory + settings + registry + storage)", extension_id);
    Ok(())
}

pub(crate) fn list_installed(app_handle: &AppHandle) -> Result<Vec<String>, AppError> {
    let extensions_dir = get_app_data_dir(app_handle)?.join("extensions");
    
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

pub(crate) fn discover_all(
    app_handle: &AppHandle,
    registry: &ExtensionRegistryState,
) -> Result<Vec<ExtensionRecord>, AppError> {
    let mut all_records: Vec<ExtensionRecord> = Vec::new();

    // 1. Scan built-in features
    let builtin_path = get_builtin_features_path(app_handle)?;
    let builtin_records = discovery::scan_extensions_dir(Path::new(&builtin_path), true);
    all_records.extend(builtin_records);

    // 2. Scan installed extensions
    let extensions_dir = get_extensions_dir(app_handle)?;
    let installed_records = discovery::scan_extensions_dir(Path::new(&extensions_dir), false);
    all_records.extend(installed_records);

    // 3. Scan dev extensions
    let dev_paths = get_dev_extension_paths(app_handle)?;
    for (id, path) in &dev_paths {
        let manifest_path = Path::new(path).join("manifest.json");
        // Also check dist/ subfolder
        let alt_manifest_path = Path::new(path).join("dist").join("manifest.json");
        let actual_path = if manifest_path.exists() {
            manifest_path
        } else if alt_manifest_path.exists() {
            alt_manifest_path
        } else {
            warn!("Dev extension {} has no manifest.json at {:?}", id, path);
            continue;
        };
        
        match discovery::read_manifest(&actual_path) {
            Ok(manifest) => {
                let compatibility = discovery::validate_compatibility(&manifest);
                all_records.push(ExtensionRecord {
                    manifest,
                    enabled: true,
                    is_built_in: false,
                    path: path.clone(),
                    compatibility,
                });
            }
            Err(e) => warn!("Failed to load dev extension {}: {}", id, e),
        }
    }

    // 4. Apply enabled/disabled state from store
    apply_extension_states(app_handle, &mut all_records)?;

    // 5. Update registry
    let mut reg = registry.extensions.lock().map_err(|_| AppError::Lock)?;
    reg.clear();
    for record in &all_records {
        reg.insert(record.manifest.id.clone(), record.clone());
    }

    info!("Discovered {} extensions ({} built-in, {} installed/dev)",
        all_records.len(),
        all_records.iter().filter(|r| r.is_built_in).count(),
        all_records.iter().filter(|r| !r.is_built_in).count(),
    );

    Ok(all_records)
}

pub(crate) fn apply_extension_states(
    app_handle: &AppHandle,
    records: &mut [ExtensionRecord],
) -> Result<(), AppError> {
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.dat")
        .map_err(|e| AppError::Other(format!("Failed to open settings store: {}", e)))?;
    
    if let Some(settings_value) = store.get("settings") {
        if let Some(extensions) = settings_value.get("extensions") {
            if let Some(enabled_map) = extensions.get("enabled") {
                for record in records.iter_mut() {
                    if record.is_built_in {
                        record.enabled = true;
                    } else if let Some(enabled) = enabled_map.get(&record.manifest.id) {
                        record.enabled = enabled.as_bool().unwrap_or(true);
                    }
                }
            }
        }
    }
    
    Ok(())
}

pub(crate) fn set_enabled(
    app_handle: &AppHandle,
    registry: &ExtensionRegistryState,
    extension_id: &str,
    enabled: bool,
) -> Result<(), AppError> {
    // Update registry
    {
        let mut reg = registry.extensions.lock().map_err(|_| AppError::Lock)?;
        if let Some(record) = reg.get_mut(extension_id) {
            if record.is_built_in {
                return Err(AppError::Validation("Cannot disable built-in extensions".into()));
            }
            record.enabled = enabled;
        } else {
            return Err(AppError::NotFound(format!("Extension not found: {}", extension_id)));
        }
    }

    // Persist to store
    use tauri_plugin_store::StoreExt;
    let store = app_handle.store("settings.dat")
        .map_err(|e| AppError::Other(format!("Failed to open settings store: {}", e)))?;
    
    let mut settings = store.get("settings")
        .unwrap_or(serde_json::json!({}));
    
    if settings.get("extensions").is_none() {
        settings["extensions"] = serde_json::json!({"enabled": {}});
    }
    
    let extensions = settings.get_mut("extensions").unwrap();
    if extensions.get("enabled").is_none() {
        extensions["enabled"] = serde_json::json!({});
    }
    extensions["enabled"][extension_id] = serde_json::json!(enabled);
    
    store.set("settings", settings);
    store.save()
        .map_err(|e| AppError::Other(format!("Failed to save settings: {}", e)))?;

    // Disabling an extension tears down its menu-bar tray icons; they'll be
    // recreated the next time the extension registers them after re-enable.
    if !enabled {
        if let Some(tray_mgr) = app_handle.try_state::<crate::extension_tray::ExtensionTrayManager>() {
            match tray_mgr.remove_all_for_extension(extension_id) {
                Ok(removed) if !removed.is_empty() => {
                    info!(
                        "Removed {} tray icon(s) for disabled extension '{}'",
                        removed.len(),
                        extension_id
                    );
                }
                Ok(_) => {}
                Err(e) => warn!(
                    "Failed to remove tray icons for disabled '{}': {}",
                    extension_id, e
                ),
            }
        }
    }

    info!("Extension {} set to enabled={}", extension_id, enabled);
    Ok(())
}
