use log::{error, info};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const STARTUP_DELAY_SECS: u64 = 60;
const CHECK_INTERVAL_SECS: u64 = 6 * 3600; // 6 hours

pub const IDLE_RESTART_THRESHOLD_SECS: u64 = 2 * 3600; // 2 hours
pub const IDLE_RESTART_CHECK_INTERVAL_SECS: u64 = 15 * 60; // 15 minutes

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

/// Pure predicate determining whether conditions are safe to automatically restart for an update.
pub fn can_idle_restart(
    is_visible: bool,
    has_pending_update: bool,
    has_active_processes: bool,
    idle_duration: Duration,
    threshold: Duration,
) -> bool {
    !is_visible && has_pending_update && !has_active_processes && idle_duration >= threshold
}

/// Run one check for idle restart conditions. If the user has auto-updates enabled,
/// an update is pending, the launcher is closed/hidden, no processes are active,
/// and the app has been idle for >= 2 hours, triggers app.restart().
async fn run_idle_restart_check(app: &AppHandle) {
    let settings = read_update_settings(app);
    if !settings.auto_check {
        return;
    }

    let has_pending = crate::app_updater::sentinel::read_sentinel(app).is_some()
        || app
            .try_state::<crate::app_updater::AppUpdaterState>()
            .and_then(|s| s.pending.lock().ok().and_then(|p| p.as_ref().map(|_| ())))
            .is_some();

    if !has_pending {
        return;
    }

    let Some(app_state) = app.try_state::<crate::AppState>() else {
        return;
    };

    let is_visible = app_state
        .asyar_visible
        .load(std::sync::atomic::Ordering::Relaxed);
    let idle_duration = match app_state.last_interaction.lock() {
        Ok(t) => t.elapsed(),
        Err(_) => return,
    };

    let has_active_processes = app
        .try_state::<crate::shell::ShellProcessRegistry>()
        .map(|r| r.has_active_processes())
        .unwrap_or(false);

    if can_idle_restart(
        is_visible,
        has_pending,
        has_active_processes,
        idle_duration,
        Duration::from_secs(IDLE_RESTART_THRESHOLD_SECS),
    ) {
        info!(
            "app_updater: idle conditions met (launcher hidden, idle for {:?}), restarting to apply update...",
            idle_duration
        );
        app.restart();
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

/// Scheduler job: checks every 15m (starting 5m after launch) whether an update
/// is pending, the launcher is hidden, and the user has been idle for >= 2 hours.
pub fn idle_restart_job(app: AppHandle) -> crate::scheduler::Job {
    crate::scheduler::Job::fixed_interval(
        "app-update-idle-restart",
        Duration::from_secs(300),
        Duration::from_secs(IDLE_RESTART_CHECK_INTERVAL_SECS),
        move || {
            let app = app.clone();
            async move { run_idle_restart_check(&app).await }
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

    #[test]
    fn test_idle_restart_threshold_is_at_least_one_hour() {
        const { assert!(IDLE_RESTART_THRESHOLD_SECS >= 3600) };
    }

    #[test]
    fn test_can_idle_restart_when_all_conditions_met() {
        let threshold = Duration::from_secs(7200);
        let idle = Duration::from_secs(7201);
        assert!(can_idle_restart(false, true, false, idle, threshold));
    }

    #[test]
    fn test_can_idle_restart_blocked_when_visible() {
        let threshold = Duration::from_secs(7200);
        let idle = Duration::from_secs(10000);
        assert!(!can_idle_restart(true, true, false, idle, threshold));
    }

    #[test]
    fn test_can_idle_restart_blocked_without_pending_update() {
        let threshold = Duration::from_secs(7200);
        let idle = Duration::from_secs(10000);
        assert!(!can_idle_restart(false, false, false, idle, threshold));
    }

    #[test]
    fn test_can_idle_restart_blocked_with_active_processes() {
        let threshold = Duration::from_secs(7200);
        let idle = Duration::from_secs(10000);
        assert!(!can_idle_restart(false, true, true, idle, threshold));
    }

    #[test]
    fn test_can_idle_restart_blocked_when_idle_time_insufficient() {
        let threshold = Duration::from_secs(7200);
        let idle = Duration::from_secs(7199);
        assert!(!can_idle_restart(false, true, false, idle, threshold));
    }
}
