//! Thin wrappers over [`super::store`]. All the logic lives in the service
//! and resolver modules; these convert wire types and delegate.

use super::store;
use super::types::LauncherPlacement;
use crate::error::AppError;
use tauri::AppHandle;

/// The user's current placement preference, or the default if none has been
/// saved. Backs the Settings → Appearance → Launcher Position section.
#[tauri::command]
pub fn get_launcher_placement(app: AppHandle) -> LauncherPlacement {
    store::load(&app)
}

/// Persists a placement chosen in Settings. It takes effect on the next
/// summon — the reveal path re-reads the store every time, so there is
/// nothing to push at a hidden window.
#[tauri::command]
pub fn set_launcher_placement(
    app: AppHandle,
    placement: LauncherPlacement,
) -> Result<(), AppError> {
    store::save(&app, placement)
}
