use log::{error, info};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const STARTUP_DELAY_SECS: u64 = 60;
const CHECK_INTERVAL_SECS: u64 = 6 * 3600; // 6 hours

pub const DEFAULT_AUTO_CHECK: bool = true;
pub const DEFAULT_CHANNEL: &str = "stable";

struct UpdateSettings {
    auto_check: bool,
    channel: String,
}

/// Read both `autoCheck` and `channel` from `settings.dat` in a single store open.
/// Returns defaults if the store or keys are unavailable.
fn read_update_settings(app: &AppHandle) -> UpdateSettings {
    use tauri_plugin_store::StoreExt;
    let store = match app.store("settings.dat") {
        Ok(s) => s,
        Err(_) => {
            return UpdateSettings {
                auto_check: DEFAULT_AUTO_CHECK,
                channel: DEFAULT_CHANNEL.to_string(),
            }
        }
    };
    let updates_val = store
        .get("settings")
        .and_then(|s| s.get("updates").cloned());

    let auto_check = updates_val
        .as_ref()
        .and_then(|u| u.get("autoCheck"))
        .and_then(|v| v.as_bool())
        .unwrap_or(DEFAULT_AUTO_CHECK);

    let channel = updates_val
        .as_ref()
        .and_then(|u| u.get("channel"))
        .and_then(|v| v.as_str().map(|s| s.to_owned()))
        .unwrap_or_else(|| DEFAULT_CHANNEL.to_string());

    UpdateSettings {
        auto_check,
        channel,
    }
}

/// Run one scheduled update check, respecting the user's `autoCheck` and
/// `channel` settings from `settings.dat`.
async fn run_check(app: &AppHandle) {
    let settings = read_update_settings(app);

    if settings.auto_check {
        info!("app_updater: scheduled check running...");
        if let Err(e) =
            crate::app_updater::service::check_and_maybe_download(app, &settings.channel).await
        {
            error!("app_updater: scheduled check failed: {}", e);
            let _ = app.emit(
                "asyar:app-update:error",
                serde_json::json!({ "message": e }),
            );
        }
    } else {
        info!("app_updater: auto-check is disabled, skipping scheduled check");
    }
}

/// Scheduler job: check for app updates 60s after launch, then every 6h.
pub fn job(app: AppHandle) -> crate::scheduler::Job {
    crate::scheduler::Job::fixed_interval(
        "app-update-check",
        Duration::from_secs(STARTUP_DELAY_SECS),
        Duration::from_secs(CHECK_INTERVAL_SECS),
        move || {
            let app = app.clone();
            async move { run_check(&app).await }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // NOTE: `read_update_settings` takes a live `&AppHandle` and uses StoreExt,
    // so it cannot be called in isolation without a full Tauri test harness.
    // The fallback path (store unavailable) IS the default path in unit tests —
    // tested via the DEFAULT_* constants below.
    //
    // For integration testing: start the app with a freshly cleared settings.dat
    // and verify auto-check fires after the startup delay.

    #[test]
    fn test_default_auto_check_is_true() {
        const { assert!(DEFAULT_AUTO_CHECK) };
    }

    #[test]
    fn test_default_channel_is_stable() {
        assert_eq!(DEFAULT_CHANNEL, "stable");
    }

    #[test]
    fn test_startup_delay_is_positive() {
        const { assert!(STARTUP_DELAY_SECS > 0) };
    }

    #[test]
    fn test_check_interval_is_reasonable() {
        // 6 hours = 21600 seconds; sanity-check it's in [3600, 86400]
        const { assert!(CHECK_INTERVAL_SECS >= 3600) };
        const { assert!(CHECK_INTERVAL_SECS <= 86400) };
    }
}
