use tauri::AppHandle;
use crate::app_updater::{AppUpdaterState, PendingUpdate};

/// Read the update channel from settings.dat.
/// Falls back to "stable" when the store or key is unavailable.
fn read_channel_from_store(app: &AppHandle) -> String {
    use tauri_plugin_store::StoreExt;
    app.store("settings.dat").ok()
        .and_then(|s| s.get("settings"))
        .and_then(|v| v.get("updates").cloned())
        .and_then(|u| u.get("channel").cloned())
        .and_then(|c| c.as_str().map(|s| s.to_owned()))
        .unwrap_or_else(|| "stable".to_string())
}

/// Manual "Check for updates now" — called by the About tab button.
/// Delegates entirely to the service layer; no logic here.
#[tauri::command]
pub async fn app_updater_check_now(
    app: AppHandle,
) -> Result<Option<String>, String> {
    let channel = read_channel_from_store(&app);
    crate::app_updater::service::check_and_maybe_download(&app, &channel).await
}

/// Returns the pending update info if a download is ready.
/// Frontend calls this on mount to restore badge state across sessions.
#[tauri::command]
pub fn app_updater_get_pending(
    state: tauri::State<'_, AppUpdaterState>,
) -> Option<PendingUpdate> {
    state.pending.lock().ok()?.clone()
}

/// Restart the app so the sentinel-based updater can apply the pending update
/// on the next cold start.
#[tauri::command]
pub fn app_relaunch(app: AppHandle) {
    app.restart();
}

/// Returns true when the What's New panel should be shown after an app update.
///
/// Rules (mirrors the design from the approved plan):
/// - `None`          → fresh install; caller should record the version silently — do NOT show
/// - `Some("")`      → corrupted storage safe-fail; show the panel
/// - `Some(v) == current` → already seen this version; do NOT show
/// - `Some(v) != current` → updated since last launch; show the panel
#[tauri::command]
pub fn app_updater_should_show_whats_new(
    last_seen_version: Option<String>,
    current_version: String,
) -> bool {
    match last_seen_version {
        None => false,
        Some(v) if v.is_empty() => true,
        Some(v) => v != current_version,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_updater::scheduler::DEFAULT_CHANNEL;

    #[test]
    fn test_fallback_channel_matches_scheduler_default() {
        assert_eq!(DEFAULT_CHANNEL, "stable");
    }

    #[test]
    fn test_should_show_whats_new_fresh_install() {
        assert!(!app_updater_should_show_whats_new(None, "1.0.0".to_string()));
    }

    #[test]
    fn test_should_show_whats_new_same_version() {
        assert!(!app_updater_should_show_whats_new(
            Some("1.0.0".to_string()),
            "1.0.0".to_string()
        ));
    }

    #[test]
    fn test_should_show_whats_new_updated() {
        assert!(app_updater_should_show_whats_new(
            Some("1.0.0".to_string()),
            "1.1.0".to_string()
        ));
    }

    #[test]
    fn test_should_show_whats_new_empty_string_safe_fail() {
        assert!(app_updater_should_show_whats_new(
            Some("".to_string()),
            "1.0.0".to_string()
        ));
    }
}
