//! Persistence for [`LauncherPlacement`].
//!
//! Lives in `settings.dat` under its **own top-level key**, deliberately not
//! inside the `settings` blob that the frontend owns: `settingsService`
//! rewrites that blob wholesale (`store.set('settings', snapshot)`), so a
//! Rust read-modify-write of the same key during a drag could drop a
//! concurrent edit made in the settings window. `auth::token_store` owns its
//! keys in the same store for the same reason.
//!
//! Reads are fail-soft in the style of `lib::parse_launch_view`: a missing
//! file, an unreadable store, or a value written by a future version all
//! resolve to the default rather than failing a reveal.
//!
//! ## Deliberately not backed up or synced
//!
//! `SettingsSyncProvider` exports `settingsService.getSettings()` — the
//! frontend's `settings` blob — so this sibling key is *not* carried by
//! profile backup, restore, or sync. That is intended, not an oversight:
//! where the launcher sits is a per-machine choice, tied to the displays in
//! front of you, and restoring a 27"-derived position onto a laptop is not a
//! favour. Do not add a sync provider for it without asking first.

use super::types::LauncherPlacement;
use crate::error::AppError;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

/// Top-level key inside `settings.dat`.
pub const PLACEMENT_KEY: &str = "launcherPlacement";

const STORE_FILE: &str = "settings.dat";

/// Reads the persisted placement, falling back to the default on any problem.
pub fn load<R: Runtime>(app: &AppHandle<R>) -> LauncherPlacement {
    let Ok(store) = app.store(STORE_FILE) else {
        return LauncherPlacement::default();
    };
    parse_placement(store.get(PLACEMENT_KEY).as_ref())
}

/// Writes the placement, sanitising first so nothing out-of-range reaches
/// disk. `save` is explicit: the plugin's autosave would otherwise leave a
/// drag unpersisted across a crash.
pub fn save<R: Runtime>(app: &AppHandle<R>, placement: LauncherPlacement) -> Result<(), AppError> {
    let store = app
        .store(STORE_FILE)
        .map_err(|e| AppError::Other(format!("Failed to open {STORE_FILE}: {e}")))?;
    let value = serde_json::to_value(placement.sanitized())
        .map_err(|e| AppError::Other(format!("Failed to serialize launcher placement: {e}")))?;
    store.set(PLACEMENT_KEY, value);
    store
        .save()
        .map_err(|e| AppError::Other(format!("Failed to save {STORE_FILE}: {e}")))?;
    Ok(())
}

/// Pure JSON-navigation half of [`load`], extracted so the fallback behaviour
/// is testable without a Tauri app.
pub fn parse_placement(raw: Option<&serde_json::Value>) -> LauncherPlacement {
    raw.and_then(|v| serde_json::from_value::<LauncherPlacement>(v.clone()).ok())
        .unwrap_or_default()
        .sanitized()
}

#[cfg(test)]
mod tests {
    use super::super::types::{LauncherAnchor, LauncherMonitorChoice, DEFAULT_TOP_BIAS};
    use super::*;
    use serde_json::json;

    #[test]
    fn absent_key_yields_the_default() {
        assert_eq!(parse_placement(None), LauncherPlacement::default());
    }

    #[test]
    fn malformed_value_yields_the_default() {
        let v = json!("top-left, please");
        assert_eq!(parse_placement(Some(&v)), LauncherPlacement::default());
    }

    #[test]
    fn unknown_anchor_kind_yields_the_default() {
        // What a downgrade from a future version would see.
        let v = json!({ "monitor": "cursor", "anchor": { "kind": "magnetic" } });
        assert_eq!(parse_placement(Some(&v)), LauncherPlacement::default());
    }

    #[test]
    fn reads_a_free_anchor() {
        let v = json!({
            "monitor": "primary",
            "anchor": { "kind": "free", "x": 0.2, "y": 0.7 },
        });
        assert_eq!(
            parse_placement(Some(&v)),
            LauncherPlacement {
                monitor: LauncherMonitorChoice::Primary,
                anchor: LauncherAnchor::Free { x: 0.2, y: 0.7 },
                snap_enabled: true,
            }
        );
    }

    #[test]
    fn out_of_range_values_are_normalised_on_read() {
        let v = json!({
            "monitor": "cursor",
            "anchor": { "kind": "topWeighted", "bias": 9.0 },
        });
        assert_eq!(
            parse_placement(Some(&v)).anchor,
            LauncherAnchor::TopWeighted { bias: 1.0 }
        );
    }

    #[test]
    fn a_null_bias_yields_the_default() {
        let v = json!({
            "monitor": "cursor",
            "anchor": { "kind": "topWeighted", "bias": null },
        });
        assert_eq!(
            parse_placement(Some(&v)).anchor,
            LauncherAnchor::TopWeighted {
                bias: DEFAULT_TOP_BIAS
            }
        );
    }

    #[test]
    fn round_trips_what_save_would_write() {
        let p = LauncherPlacement {
            monitor: LauncherMonitorChoice::Primary,
            anchor: LauncherAnchor::Centered,
            snap_enabled: true,
        };
        let v = serde_json::to_value(p).unwrap();
        assert_eq!(parse_placement(Some(&v)), p);
    }
}
