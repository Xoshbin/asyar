//! Tauri command that deep-opens an OS settings pane for the
//! `system-settings` built-in feature.
//!
//! Host-only surface, like `system_action_run`: not mapped in the
//! `asyar:api:*` permission table, so extension workers cannot reach it.
//! Opening from Rust keeps the webview opener ACL web-only (see
//! `opener_scope.rs`); the pane id is checked against a fixed allowlist
//! before anything is spawned.

use crate::error::AppError;

/// macOS System Settings pane bundle ids (ExtensionKit extensions under
/// `/System/Library/ExtensionKit/Extensions`). Must stay in sync with
/// `SETTINGS_PANES` in `src/built-in-features/system-settings/panes.ts`;
/// a test below enforces that.
pub const MACOS_SETTINGS_PANE_IDS: &[&str] = &[
    "com.apple.wifi-settings-extension",
    "com.apple.BluetoothSettings",
    "com.apple.Network-Settings.extension",
    "com.apple.Notifications-Settings.extension",
    "com.apple.Sound-Settings.extension",
    "com.apple.Focus-Settings.extension",
    "com.apple.Screen-Time-Settings.extension",
    "com.apple.systempreferences.GeneralSettings",
    "com.apple.SystemProfiler.AboutExtension",
    "com.apple.Software-Update-Settings.extension",
    "com.apple.settings.Storage",
    "com.apple.Appearance-Settings.extension",
    "com.apple.Accessibility-Settings.extension",
    "com.apple.ControlCenter-Settings.extension",
    "com.apple.Siri-Settings.extension",
    "com.apple.Spotlight-Settings.extension",
    "com.apple.settings.PrivacySecurity.extension",
    "com.apple.Desktop-Settings.extension",
    "com.apple.Displays-Settings.extension",
    "com.apple.Wallpaper-Settings.extension",
    "com.apple.Battery-Settings.extension",
    "com.apple.Lock-Screen-Settings.extension",
    "com.apple.Touch-ID-Settings.extension",
    "com.apple.Users-Groups-Settings.extension",
    "com.apple.Internet-Accounts-Settings.extension",
    "com.apple.Keyboard-Settings.extension",
    "com.apple.Trackpad-Settings.extension",
    "com.apple.Mouse-Settings.extension",
    "com.apple.Print-Scan-Settings.extension",
    "com.apple.Date-Time-Settings.extension",
    "com.apple.Localization-Settings.extension",
    "com.apple.Sharing-Settings.extension",
    "com.apple.AirDrop-Handoff-Settings.extension",
    "com.apple.LoginItems-Settings.extension",
    "com.apple.Time-Machine-Settings.extension",
    "com.apple.Startup-Disk-Settings.extension",
];

pub fn is_allowed_pane(bundle_id: &str) -> bool {
    MACOS_SETTINGS_PANE_IDS.contains(&bundle_id)
}

/// Opens the settings pane identified by `bundle_id`. Returns `false` when
/// the id is not allowlisted, the platform has no pane support yet, or the
/// OS opener fails — the caller restores the launcher in that case.
#[tauri::command]
pub async fn open_settings_pane(bundle_id: String) -> Result<bool, AppError> {
    if !is_allowed_pane(&bundle_id) {
        log::warn!("[system-settings] rejected unknown settings pane: {bundle_id}");
        return Ok(false);
    }
    tauri::async_runtime::spawn_blocking(move || open_pane(&bundle_id))
        .await
        .map_err(|e| AppError::Other(format!("settings pane task failed: {e}")))
}

#[cfg(target_os = "macos")]
fn open_pane(bundle_id: &str) -> bool {
    std::process::Command::new("open")
        .arg(format!("x-apple.systempreferences:{bundle_id}"))
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn open_pane(_bundle_id: &str) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_accepts_known_panes() {
        assert!(is_allowed_pane("com.apple.Sound-Settings.extension"));
        assert!(is_allowed_pane("com.apple.wifi-settings-extension"));
    }

    #[test]
    fn allowlist_rejects_unknown_and_crafted_ids() {
        for id in [
            "",
            "com.apple.Unknown-Settings.extension",
            "com.apple.Sound-Settings.extension?Privacy",
            "com.apple.Sound-Settings.extension ",
            "com.apple.sound-settings.extension",
            "https://example.com",
            "-a Calculator",
        ] {
            assert!(!is_allowed_pane(id), "{id:?} must be rejected");
        }
    }

    #[test]
    fn allowlist_has_no_duplicates() {
        let mut ids = MACOS_SETTINGS_PANE_IDS.to_vec();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), MACOS_SETTINGS_PANE_IDS.len());
    }

    /// The frontend pane table and this allowlist must list the same ids,
    /// otherwise a pane shows in search but refuses to open.
    #[test]
    fn allowlist_matches_frontend_pane_table() {
        let panes_ts = include_str!("../../../src/built-in-features/system-settings/panes.ts");
        let mut frontend: Vec<&str> = panes_ts
            .split("bundleId: '")
            .skip(1)
            .filter_map(|rest| rest.split('\'').next())
            .collect();
        frontend.sort_unstable();
        let mut allowlist = MACOS_SETTINGS_PANE_IDS.to_vec();
        allowlist.sort_unstable();
        assert_eq!(frontend, allowlist);
    }
}
