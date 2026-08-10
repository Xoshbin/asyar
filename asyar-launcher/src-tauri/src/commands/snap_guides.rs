//! Snap-guides Tauri command wrappers — thin shells over
//! `crate::snap_guides::service`, mirroring `commands/hud.rs`.

use tauri::AppHandle;

use crate::snap_guides::{service, SnapGuideState};

/// Returns the most recently set guide state (or `null` if none) — the
/// guide route calls this on mount to recover state emitted before its
/// event listener attached, same reason `get_hud_state` exists.
#[tauri::command]
pub fn get_snap_guide_state(app_handle: AppHandle) -> Option<SnapGuideState> {
    service::current_state(&app_handle)
}
