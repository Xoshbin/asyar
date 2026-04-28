use log::info;
use tauri::{AppHandle, Emitter, async_runtime};

const STARTUP_DELAY_SECS: u64 = 60;
const CHECK_INTERVAL_SECS: u64 = 3600; // 1 hour

pub const DEFAULT_AUTO_UPDATE: bool = true;

/// Read `settings.extensions.autoUpdate` from `settings.dat`.
/// Returns `DEFAULT_AUTO_UPDATE` if the store or key is unavailable.
fn read_auto_update_setting(app: &AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;
    let store = match app.store("settings.dat") {
        Ok(s) => s,
        Err(_) => return DEFAULT_AUTO_UPDATE,
    };

    store
        .get("settings")
        .and_then(|s| s.get("extensions").cloned())
        .and_then(|e| e.get("autoUpdate").cloned())
        .and_then(|v| v.as_bool())
        .unwrap_or(DEFAULT_AUTO_UPDATE)
}

/// Spawn a background tokio task that periodically emits `asyar:extension-update:tick`
/// so the frontend's `ExtensionUpdateService` can run `checkAndAutoApply`.
///
/// Fires once after `STARTUP_DELAY_SECS`, then every `CHECK_INTERVAL_SECS`,
/// but only when `settings.extensions.autoUpdate` is enabled.
pub fn start(app: AppHandle) {
    async_runtime::spawn(async move {
        // Wait a bit after launch before the first tick, so startup isn't slowed down.
        tokio::time::sleep(tokio::time::Duration::from_secs(STARTUP_DELAY_SECS)).await;

        loop {
            if read_auto_update_setting(&app) {
                info!("extension_updater: scheduled check running...");
                let _ = app.emit("asyar:extension-update:tick", serde_json::json!({}));
            } else {
                info!("extension_updater: auto-update is disabled, skipping scheduled tick");
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(CHECK_INTERVAL_SECS)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // NOTE: `read_auto_update_setting` takes a live `&AppHandle` and uses StoreExt,
    // so it cannot be called in isolation without a full Tauri test harness.
    // The fallback path (store unavailable) IS the default path in unit tests —
    // tested via the DEFAULT_AUTO_UPDATE constant below.
    //
    // For integration testing: start the app, wait 60s, and verify the Rust log
    // prints "extension_updater: scheduled check running..." and the frontend
    // receives the `asyar:extension-update:tick` event.

    #[test]
    fn test_default_auto_update_is_true() {
        const { assert!(DEFAULT_AUTO_UPDATE) };
    }

    #[test]
    fn test_startup_delay_is_positive() {
        const { assert!(STARTUP_DELAY_SECS > 0) };
    }

    #[test]
    fn test_check_interval_is_one_hour() {
        assert_eq!(CHECK_INTERVAL_SECS, 3600);
    }

    #[test]
    fn test_check_interval_is_reasonable() {
        // Sanity-check it's in [60, 86400]
        const { assert!(CHECK_INTERVAL_SECS >= 60) };
        const { assert!(CHECK_INTERVAL_SECS <= 86400) };
    }
}
