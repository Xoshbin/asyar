use crate::auth::api_client::ApiClient;
use crate::auth::state::AuthState;
use crate::error::AppError;
use crate::feedback::{build_report, CrashPayload, FeedbackInput, PendingCrash};
use tauri::State;

#[tauri::command]
pub async fn submit_feedback(
    input: FeedbackInput,
    api_client: State<'_, ApiClient>,
    auth_state: State<'_, AuthState>,
) -> Result<(), AppError> {
    let token = auth_state.token.lock().map_err(|_| AppError::Lock)?.clone();
    let report = build_report(input, None);
    api_client.submit_feedback(&report, token.as_deref()).await
}

/// Return the pending Ask-mode crash payload without consuming it.
#[tauri::command]
pub fn get_pending_crash(
    pending: State<'_, PendingCrash>,
) -> Result<Option<CrashPayload>, AppError> {
    let guard = pending.0.lock().map_err(|_| AppError::Lock)?;
    Ok(guard.clone())
}

/// Take the pending crash payload, build a crash report with the supplied email,
/// and POST it. The payload is removed from state so it cannot be double-sent.
#[tauri::command]
pub async fn send_pending_crash(
    email: String,
    api_client: State<'_, ApiClient>,
    auth_state: State<'_, AuthState>,
    pending: State<'_, PendingCrash>,
) -> Result<(), AppError> {
    let payload = {
        let mut guard = pending.0.lock().map_err(|_| AppError::Lock)?;
        guard.take()
    };

    if let Some(crash) = payload {
        let token = auth_state.token.lock().map_err(|_| AppError::Lock)?.clone();
        let input = FeedbackInput {
            kind: "crash".to_string(),
            category: None,
            message: None,
            email: if email.is_empty() { None } else { Some(email) },
        };
        let report = build_report(input, Some(crash));
        api_client
            .submit_feedback(&report, token.as_deref())
            .await?;
    }

    Ok(())
}

/// Discard the pending crash payload without sending.
#[tauri::command]
pub fn dismiss_pending_crash(pending: State<'_, PendingCrash>) -> Result<(), AppError> {
    let mut guard = pending.0.lock().map_err(|_| AppError::Lock)?;
    *guard = None;
    Ok(())
}
