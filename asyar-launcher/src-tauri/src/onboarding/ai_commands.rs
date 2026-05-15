use crate::error::AppError;
use crate::onboarding::ai_persistence::{read_ai_onboarding_completed, write_ai_onboarding_completed};
use tauri::AppHandle;

#[tauri::command]
pub async fn complete_ai_onboarding(app: AppHandle) -> Result<(), AppError> {
    write_ai_onboarding_completed(&app, true)
}

#[tauri::command]
pub async fn is_ai_onboarding_completed(app: AppHandle) -> Result<bool, AppError> {
    read_ai_onboarding_completed(&app)
}
