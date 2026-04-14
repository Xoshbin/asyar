use log::{error, info};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

const CHANNEL_HEADER: &str = "X-Update-Channel";

/// Check for an available update, download it if found, and persist the sentinel.
/// Emits events to the frontend during the flow:
///   - `asyar:app-update:checking`   — before the network check
///   - `asyar:app-update:idle`       — when no update is available
///   - `asyar:app-update:downloading`— when an update is found and download begins
///   - `asyar:app-update:ready`      — when download+install is complete
///
/// Returns `Ok(Some(version))` when an update was downloaded, `Ok(None)` when
/// no update was found, or `Err(message)` on failure.
pub async fn check_and_maybe_download(
    app: &AppHandle,
    channel: &str,
) -> Result<Option<String>, String> {
    // 1. Emit checking
    let _ = app.emit("asyar:app-update:checking", ());

    // 2. Build updater with channel header
    let updater = app
        .updater_builder()
        .header(CHANNEL_HEADER, channel)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;

    // 3. Check for an update
    let update = updater.check().await.map_err(|e| e.to_string())?;

    match update {
        None => {
            info!("app_updater: no update available");
            let _ = app.emit("asyar:app-update:idle", ());
            Ok(None)
        }
        Some(u) => {
            // `version` is the announced/new version; `current_version` is the running one.
            let version = u.version.clone();
            info!("app_updater: update found: {}", version);

            // Write to managed state so "Restart now" can read the pending version.
            if let Some(updater_state) = app.try_state::<crate::app_updater::AppUpdaterState>() {
                if let Ok(mut pending) = updater_state.pending.lock() {
                    *pending = Some(crate::app_updater::PendingUpdate { version: version.clone() });
                }
            }

            // Emit downloading
            let _ = app.emit(
                "asyar:app-update:downloading",
                serde_json::json!({ "version": version }),
            );

            // Write sentinel BEFORE downloading so that even if the download fails,
            // the next startup will re-check.
            crate::app_updater::sentinel::write_sentinel(app, &version).ok();

            // Download and install (passive — relies on sentinel for apply-on-next-launch flow).
            let install_result = u
                .download_and_install(|_chunk, _total| {}, || {})
                .await;

            if let Err(e) = install_result {
                error!("app_updater: download_and_install failed: {}", e);
                // Don't return error — sentinel is written; next start will retry.
            }

            // Emit ready
            let _ = app.emit(
                "asyar:app-update:ready",
                serde_json::json!({ "version": version }),
            );

            Ok(Some(version))
        }
    }
}

/// Called at cold start (before the main window shows). If a sentinel exists,
/// it means a previous run downloaded an update; re-check and apply it now.
pub async fn apply_on_start(app: &AppHandle) {
    let sentinel = crate::app_updater::sentinel::read_sentinel(app);
    if sentinel.is_none() {
        return;
    }

    info!("app_updater: pending update sentinel found, applying on start...");

    // Delete sentinel first so a crash here doesn't loop forever.
    crate::app_updater::sentinel::delete_sentinel(app);

    // Read channel from settings, default to stable
    let channel = {
        use tauri_plugin_store::StoreExt;
        app.store("settings.dat").ok()
            .and_then(|s| s.get("settings"))
            .and_then(|v| v.get("updates").cloned())
            .and_then(|u| u.get("channel").cloned())
            .and_then(|c| c.as_str().map(|s| s.to_owned()))
            .unwrap_or_else(|| "stable".to_string())
    };

    if let Err(e) = check_and_maybe_download(app, &channel).await {
        error!("app_updater: apply_on_start failed: {}", e);
    }

    // Clear pending state after apply attempt
    if let Some(updater_state) = app.try_state::<crate::app_updater::AppUpdaterState>() {
        if let Ok(mut pending) = updater_state.pending.lock() {
            *pending = None;
        }
    }
}

#[cfg(test)]
mod tests {
    // NOTE: `check_and_maybe_download` and `apply_on_start` both require a live
    // `AppHandle` with the updater plugin registered.  Constructing a fully wired
    // mock AppHandle in unit tests is not practical with Tauri 2's architecture
    // (the plugin graph and async runtime need to be real).
    //
    // What IS tested here:
    //   • The `CHANNEL_HEADER` constant has the expected value so callers can rely on it.
    //   • Sentinel interactions used inside the service are covered by `sentinel.rs` tests.
    //
    // Integration / smoke testing:
    //   • Run the app in dev mode, open the updater settings, and click "Check for updates".
    //   • Observe the `asyar:app-update:*` events in the browser DevTools console.

    use super::*;

    #[test]
    fn test_channel_header_constant() {
        assert_eq!(CHANNEL_HEADER, "X-Update-Channel");
    }
}
