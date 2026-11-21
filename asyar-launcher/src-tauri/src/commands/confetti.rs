use tauri::AppHandle;

use crate::error::AppError;

/// Fires a full-screen confetti burst on the monitor under the cursor.
#[tauri::command]
pub fn show_confetti(app_handle: AppHandle) -> Result<(), AppError> {
    crate::confetti::show(&app_handle)
}
