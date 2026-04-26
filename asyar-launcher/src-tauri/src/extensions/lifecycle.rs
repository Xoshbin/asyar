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

                match crate::storage::command_arg_defaults::clear_for_extension(
                    &conn,
                    extension_id,
                ) {
                    Ok(count) => {
                        if count > 0 {
                            info!(
                                "Cleared {} command argument defaults for extension '{}'",
                                count, extension_id
                            );
                        }
                    }
                    Err(e) => warn!(
                        "Failed to clear command argument defaults for '{}': {}",
                        extension_id, e
                    ),
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

    // Drop any scheduled one-shot timers owned by this extension. The
    // iframe is about to disappear — firing into it would be silent.
    if let Some(timer_registry) = app_handle.try_state::<crate::timers::TimerRegistry>() {
        match timer_registry.clear_all_for_extension(extension_id) {
            Ok(n) if n > 0 => {
                info!("Cleared {} timer(s) for extension '{}'", n, extension_id)
            }
            Ok(_) => {}
            Err(e) => warn!(
                "Failed to clear timers for '{}': {}",
                extension_id, e
            ),
        }
    }

    // Kill any shell processes this extension left running. Mirrors the
    // power-inhibitor sweep above so uninstall doesn't orphan child
    // processes whose parent extension is gone.
    if let Some(shell_registry) =
        app_handle.try_state::<crate::shell::ShellProcessRegistry>()
    {
        match shell_registry.kill_all_for_extension(extension_id) {
            Ok(n) if n > 0 => {
                info!("Killed {} shell process(es) for extension '{}'", n, extension_id)
            }
            Ok(_) => {}
            Err(e) => warn!(
                "Failed to kill shell processes for '{}': {}",
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

    // Remove all application-index subscriptions held by this extension.
    if let Some(hub) =
        app_handle.try_state::<std::sync::Arc<crate::index_events::IndexEventsHub>>()
    {
        match hub.remove_all_for_extension(extension_id) {
            Ok(n) if n > 0 => info!(
                "Removed {} application-index subscriptions for extension '{}'",
                n, extension_id
            ),
            Ok(_) => {}
            Err(e) => warn!(
                "Failed to remove application-index subscriptions for '{}': {}",
                extension_id, e
            ),
        }
    }

    // Close every filesystem watcher owned by this extension. Mirrors
    // the application-index sweep above — debouncer threads die when
    // their owning `WatcherEntry` drops out of the registry's HashMap.
    if let Some(registry) =
        app_handle.try_state::<std::sync::Arc<crate::fs_watcher::FsWatcherRegistry>>()
    {
        match registry.remove_all_for_extension(extension_id) {
            Ok(n) if n > 0 => info!(
                "Closed {} filesystem watchers for extension '{}'",
                n, extension_id
            ),
            Ok(_) => {}
            Err(e) => warn!(
                "Failed to close filesystem watchers for '{}': {}",
                extension_id, e
            ),
        }
    }

    // Drop pending notification actions owned by this extension so the OS
    // can't fire a "Extend 30m" button into an extension that no longer
    // exists. Mirrors PowerRegistry / AppEventsHub above — uninstall-only,
    // since disable leaves the extension's manifest intact and the
    // NotificationActionBridge already filters clicks on disabled ones.
    if let Some(notif_registry) =
        app_handle.try_state::<std::sync::Arc<crate::notifications::NotificationActionRegistry>>()
    {
        let n = notif_registry.remove_all_for_extension(extension_id);
        if n > 0 {
            info!("Dropped {n} pending notification actions for extension '{extension_id}'");
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

    // Tear down both worker and view context machines so a subsequent
    // reinstall doesn't collide with stale mailbox/strike entries.
    if let Some(mgr) = app_handle.try_state::<std::sync::Arc<crate::extensions::extension_runtime::ExtensionRuntimeManager>>() {
        crate::commands::extension_runtime::notify_extension_removed(
            &mgr,
            app_handle,
            extension_id.to_string(),
        );
    }

    // Drop launcher-brokered extension state AFTER both context machines
    // are torn down. `tear_down_both` above is synchronous,
    // so by the time we reach here no new dispatch can route to the old
    // mailbox; a late `state:set` from a dying iframe is rejected upstream
    // by the IpcRouter (the registry no longer knows the extension), so
    // this clear cannot race a repopulating write.
    if let Some(state_svc) = app_handle.try_state::<std::sync::Arc<crate::extensions::extension_state::ExtensionStateService>>() {
        match state_svc.clear(extension_id) {
            Ok(n) if n > 0 => {
                info!("Cleared {n} extension_state row(s) for extension '{extension_id}'")
            }
            Ok(_) => {}
            Err(e) => warn!("Failed to clear extension_state for '{extension_id}': {e}"),
        }
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
                    first_view_component: manifest.first_view_component().map(String::from),
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

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;
    use crate::notifications::{NotificationActionRegistry, PendingAction};
    use std::sync::Arc;

    fn pending(ext: &str, cmd: &str) -> PendingAction {
        PendingAction {
            extension_id: ext.to_string(),
            command_id: cmd.to_string(),
            args_json: None,
        }
    }

    /// Mirrors the block wired into `uninstall` — the unit under test is
    /// "given a live AppHandle with a managed registry, the lifecycle hook
    /// drops pending actions only for the uninstalled extension".
    ///
    /// Generic over `Runtime` so `tauri::test::mock_app()` (which returns a
    /// `MockRuntime`-bound handle) can drive it.
    fn run_notification_cleanup<R: tauri::Runtime>(
        app_handle: &tauri::AppHandle<R>,
        extension_id: &str,
    ) {
        if let Some(reg) =
            app_handle.try_state::<Arc<NotificationActionRegistry>>()
        {
            let n = reg.remove_all_for_extension(extension_id);
            if n > 0 {
                info!("Dropped {n} pending notification actions for extension '{extension_id}'");
            }
        }
    }

    #[test]
    fn uninstall_hook_drops_only_the_uninstalled_extensions_entries() {
        let app = tauri::test::mock_app();
        let registry = Arc::new(NotificationActionRegistry::new());
        registry.insert_many(
            "notif-alpha",
            vec![("extend".to_string(), pending("alpha", "cmd"))],
        );
        registry.insert_many(
            "notif-beta",
            vec![("stop".to_string(), pending("beta", "cmd"))],
        );
        app.manage(Arc::clone(&registry));

        run_notification_cleanup(app.handle(), "alpha");

        assert!(registry.lookup("notif-alpha", "extend").is_none());
        assert!(registry.lookup("notif-beta", "stop").is_some());
    }

    #[test]
    fn uninstall_hook_is_noop_without_managed_registry() {
        let app = tauri::test::mock_app();
        // No registry managed — verifies the try_state guard protects the
        // uninstall path from crashing on fresh profiles or test harnesses
        // that skip the notifications module.
        run_notification_cleanup(app.handle(), "alpha");
    }

    #[test]
    fn uninstall_hook_is_noop_when_extension_has_no_pending_actions() {
        let app = tauri::test::mock_app();
        let registry = Arc::new(NotificationActionRegistry::new());
        registry.insert_many(
            "notif-beta",
            vec![("stop".to_string(), pending("beta", "cmd"))],
        );
        app.manage(Arc::clone(&registry));

        run_notification_cleanup(app.handle(), "alpha");

        // beta entries intact, nothing removed.
        assert!(registry.lookup("notif-beta", "stop").is_some());
    }

    /// Exercises only the drop half of the uninstall hook — never calls
    /// `kill_all_for_extension`. `libc::kill(pid as i32, SIGKILL)` with any
    /// pid whose i32 cast is negative (including u32::MAX → -1) fans the
    /// signal out to every process the tester owns on POSIX, so the test
    /// path stays off `libc::kill` entirely and asserts the registry state
    /// via `remove_all_for_extension` instead.
    fn run_shell_cleanup_drop_only<R: tauri::Runtime>(
        app_handle: &tauri::AppHandle<R>,
        extension_id: &str,
    ) -> usize {
        app_handle
            .try_state::<crate::shell::ShellProcessRegistry>()
            .map(|reg| reg.remove_all_for_extension(extension_id).unwrap_or_default().len())
            .unwrap_or(0)
    }

    #[test]
    fn uninstall_hook_drops_only_the_uninstalled_extensions_spawns() {
        let app = tauri::test::mock_app();
        let registry = crate::shell::ShellProcessRegistry::new();
        // Safe fake pids — never signalled because the test uses the drop-
        // only helper.
        registry
            .register_spawn("s1", "alpha", "/bin/echo", &[], 1001)
            .unwrap();
        registry
            .register_spawn("s2", "beta", "/bin/echo", &[], 1002)
            .unwrap();
        registry
            .register_spawn("s3", "alpha", "/bin/echo", &[], 1003)
            .unwrap();
        app.manage(registry);

        let removed = run_shell_cleanup_drop_only(app.handle(), "alpha");
        assert_eq!(removed, 2);

        let reg: tauri::State<'_, crate::shell::ShellProcessRegistry> = app.state();
        assert!(!reg.contains("s1").unwrap());
        assert!(!reg.contains("s3").unwrap());
        assert!(reg.contains("s2").unwrap(), "other extensions untouched");
    }

    #[test]
    fn uninstall_hook_shell_cleanup_is_noop_without_managed_registry() {
        let app = tauri::test::mock_app();
        let removed = run_shell_cleanup_drop_only(app.handle(), "alpha");
        assert_eq!(removed, 0);
    }

    #[test]
    fn disable_hook_drops_only_the_disabled_extensions_spawns() {
        let app = tauri::test::mock_app();
        let registry = crate::shell::ShellProcessRegistry::new();
        registry
            .register_spawn("alpha-live", "alpha", "/bin/echo", &[], 1101)
            .unwrap();
        registry
            .register_spawn("beta-live", "beta", "/bin/echo", &[], 1102)
            .unwrap();
        app.manage(registry);

        run_shell_cleanup_drop_only(app.handle(), "alpha");

        let reg: tauri::State<'_, crate::shell::ShellProcessRegistry> = app.state();
        assert!(!reg.contains("alpha-live").unwrap());
        assert!(reg.contains("beta-live").unwrap());
    }

    /// Mirror of the cleanup block wired into `uninstall` and the disable
    /// path of `set_enabled` — the unit under test is "given a live
    /// AppHandle with a managed TimerRegistry, dropping the extension
    /// clears only its pending + fired timers".
    fn run_timer_cleanup<R: tauri::Runtime>(
        app_handle: &tauri::AppHandle<R>,
        extension_id: &str,
    ) -> usize {
        app_handle
            .try_state::<crate::timers::TimerRegistry>()
            .map(|reg| reg.clear_all_for_extension(extension_id).unwrap_or(0))
            .unwrap_or(0)
    }

    fn seeded_timer_registry() -> crate::timers::TimerRegistry {
        let reg = crate::timers::TimerRegistry::in_memory();
        // alpha has two pending + one fired; beta has one pending — verify
        // nothing of beta's survives-or-disappears accidentally.
        let a1 = reg.schedule("alpha", "bell", "{}", 2_000, 1_000).unwrap();
        let _a2 = reg.schedule("alpha", "bell", "{}", 3_000, 1_000).unwrap();
        reg.mark_fired("alpha", &a1, 2_500).unwrap();
        let _b1 = reg.schedule("beta", "bell", "{}", 4_000, 1_000).unwrap();
        reg
    }

    #[test]
    fn uninstall_hook_drops_only_the_uninstalled_extensions_timers() {
        let app = tauri::test::mock_app();
        let reg = seeded_timer_registry();
        app.manage(reg);

        let removed = run_timer_cleanup(app.handle(), "alpha");
        assert_eq!(removed, 2, "alpha had 1 fired + 1 pending (a1 was fired)");

        let reg: tauri::State<'_, crate::timers::TimerRegistry> = app.state();
        assert!(reg.list_pending("alpha").unwrap().is_empty());
        assert_eq!(reg.list_pending("beta").unwrap().len(), 1);
    }

    #[test]
    fn uninstall_hook_timer_cleanup_is_noop_without_managed_registry() {
        let app = tauri::test::mock_app();
        let removed = run_timer_cleanup(app.handle(), "alpha");
        assert_eq!(removed, 0);
    }

    #[test]
    fn disable_hook_drops_only_the_disabled_extensions_timers() {
        // A disabled extension's iframe won't exist, so silent misfires
        // would be worse than a user having to re-schedule on re-enable.
        let app = tauri::test::mock_app();
        let reg = seeded_timer_registry();
        app.manage(reg);

        let removed = run_timer_cleanup(app.handle(), "alpha");
        assert_eq!(removed, 2);

        let reg: tauri::State<'_, crate::timers::TimerRegistry> = app.state();
        assert!(reg.list_pending("alpha").unwrap().is_empty());
        assert_eq!(reg.list_pending("beta").unwrap().len(), 1);
    }
}

pub(crate) fn set_enabled(
    app_handle: &AppHandle,
    registry: &ExtensionRegistryState,
    extension_id: &str,
    enabled: bool,
) -> Result<(), AppError> {
    // Update registry and capture whether this extension declares a worker.
    let has_background_main: bool;
    {
        let mut reg = registry.extensions.lock().map_err(|_| AppError::Lock)?;
        if let Some(record) = reg.get_mut(extension_id) {
            if record.is_built_in {
                return Err(AppError::Validation("Cannot disable built-in extensions".into()));
            }
            record.enabled = enabled;
            has_background_main = record
                .manifest
                .background
                .as_ref()
                .map(|b| !b.main.trim().is_empty())
                .unwrap_or(false);
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

        // Kill any shell processes this extension left running. On re-enable
        // the extension boots fresh; leaving orphaned children around would
        // leak both PIDs and the outer iframe's stream handles.
        if let Some(shell_registry) =
            app_handle.try_state::<crate::shell::ShellProcessRegistry>()
        {
            match shell_registry.kill_all_for_extension(extension_id) {
                Ok(n) if n > 0 => {
                    info!(
                        "Killed {} shell process(es) for disabled extension '{}'",
                        n, extension_id
                    );
                }
                Ok(_) => {}
                Err(e) => warn!(
                    "Failed to kill shell processes for disabled '{}': {}",
                    extension_id, e
                ),
            }
        }

        // Drop any scheduled one-shot timers. A disabled extension's iframe
        // won't exist, so leaving timers in place would produce silent
        // misfires; user can reschedule on re-enable if they want.
        if let Some(timer_registry) = app_handle.try_state::<crate::timers::TimerRegistry>() {
            match timer_registry.clear_all_for_extension(extension_id) {
                Ok(n) if n > 0 => {
                    info!(
                        "Cleared {} timer(s) for disabled extension '{}'",
                        n, extension_id
                    );
                }
                Ok(_) => {}
                Err(e) => warn!(
                    "Failed to clear timers for disabled '{}': {}",
                    extension_id, e
                ),
            }
        }

        // Close filesystem watchers. Disabled extensions have no iframe, so
        // any push events would be dropped by createPushBridge anyway —
        // better to release the watcher thread + kernel FS-watch slots.
        if let Some(fs_registry) =
            app_handle.try_state::<std::sync::Arc<crate::fs_watcher::FsWatcherRegistry>>()
        {
            match fs_registry.remove_all_for_extension(extension_id) {
                Ok(n) if n > 0 => info!(
                    "Closed {} filesystem watcher(s) for disabled extension '{}'",
                    n, extension_id
                ),
                Ok(_) => {}
                Err(e) => warn!(
                    "Failed to close filesystem watchers for disabled '{}': {}",
                    extension_id, e
                ),
            }
        }

        // Tear down both worker and view context machines so the disabled
        // extension releases its mailbox/strike entries; re-enable starts fresh.
        if let Some(mgr) = app_handle.try_state::<std::sync::Arc<crate::extensions::extension_runtime::ExtensionRuntimeManager>>() {
            crate::commands::extension_runtime::notify_extension_removed(
                &mgr,
                app_handle,
                extension_id.to_string(),
            );
        }
    } else if has_background_main {
        // Always-on worker: enabling an extension with background.main must
        // materialise its worker iframe immediately. Drives the worker context
        // Dormant → Mounting and emits EVENT_MOUNT with role: worker; the
        // frontend's WorkerIframes component then spawns the iframe.
        if let Some(mgr) = app_handle.try_state::<std::sync::Arc<crate::extensions::extension_runtime::ExtensionRuntimeManager>>() {
            crate::commands::extension_runtime::auto_mount_worker(
                &mgr,
                app_handle,
                true,
                extension_id.to_string(),
            );
        }
    }

    info!("Extension {} set to enabled={}", extension_id, enabled);
    Ok(())
}
