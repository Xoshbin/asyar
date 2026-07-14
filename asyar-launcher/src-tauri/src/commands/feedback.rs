use crate::auth::api_client::ApiClient;
use crate::auth::state::AuthState;
use crate::error::AppError;
use crate::feedback::channel::{
    FeedbackChannelState, FeedbackDraft, FeedbackItem, FeedbackProgress, FeedbackSeverity,
};
use crate::feedback::{build_report, CrashPayload, FeedbackInput, PendingCrash};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn emit_current(app: &AppHandle, state: &FeedbackChannelState) -> Result<(), AppError> {
    let current = state.current().map_err(|_| AppError::Lock)?;
    app.emit("feedback:changed", current)
        .map_err(|error| AppError::Other(error.to_string()))
}

fn schedule_expiry(app: AppHandle, id: String, severity: FeedbackSeverity) {
    let Some(ttl_ms) = severity.ttl_ms() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(ttl_ms)).await;
        let state = app.state::<FeedbackChannelState>();
        if state
            .current()
            .ok()
            .flatten()
            .is_some_and(|current| current.id == id)
        {
            let _ = state.dismiss(&id);
            let _ = emit_current(&app, &state);
            if let Ok(Some(next)) = state.current() {
                schedule_expiry(app.clone(), next.id, next.severity);
            }
        }
    });
}

#[tauri::command]
pub fn feedback_publish(
    app: AppHandle,
    state: State<'_, FeedbackChannelState>,
    draft: FeedbackDraft,
) -> Result<String, AppError> {
    let severity = draft.severity;
    let id = state.publish(draft, now_ms()).map_err(|_| AppError::Lock)?;
    if severity == FeedbackSeverity::Fatal {
        if let Some(window) = app.get_webview_window(crate::SPOTLIGHT_LABEL) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    emit_current(&app, &state)?;
    if state
        .current()
        .ok()
        .flatten()
        .is_some_and(|current| current.id == id)
    {
        schedule_expiry(app, id.clone(), severity);
    }
    Ok(id)
}

#[tauri::command]
pub fn feedback_get_current(
    state: State<'_, FeedbackChannelState>,
) -> Result<Option<FeedbackItem>, AppError> {
    state.current().map_err(|_| AppError::Lock)
}

#[tauri::command]
pub fn feedback_update_progress(
    app: AppHandle,
    state: State<'_, FeedbackChannelState>,
    feedback_id: String,
    expected_extension_id: Option<String>,
    progress: FeedbackProgress,
) -> Result<(), AppError> {
    state
        .update_progress(&feedback_id, expected_extension_id.as_deref(), progress)
        .map_err(|_| AppError::Lock)?;
    emit_current(&app, &state)
}

#[tauri::command]
pub fn feedback_finish_progress(
    app: AppHandle,
    state: State<'_, FeedbackChannelState>,
    feedback_id: String,
    expected_extension_id: Option<String>,
    severity: FeedbackSeverity,
    title: String,
    developer_detail: Option<String>,
) -> Result<(), AppError> {
    state
        .finish_progress(
            &feedback_id,
            expected_extension_id.as_deref(),
            severity,
            title,
            developer_detail,
        )
        .map_err(|_| AppError::Lock)?;
    emit_current(&app, &state)?;
    schedule_expiry(app, feedback_id, severity);
    Ok(())
}

#[tauri::command]
pub fn feedback_dismiss(
    app: AppHandle,
    state: State<'_, FeedbackChannelState>,
    feedback_id: String,
    expected_extension_id: Option<String>,
) -> Result<Option<FeedbackItem>, AppError> {
    let was_current = state
        .current()
        .ok()
        .flatten()
        .is_some_and(|current| current.id == feedback_id);
    state
        .dismiss_owned(&feedback_id, expected_extension_id.as_deref())
        .map_err(|_| AppError::Lock)?;
    let current = state.current().map_err(|_| AppError::Lock)?;
    app.emit("feedback:changed", current.clone())
        .map_err(|error| AppError::Other(error.to_string()))?;
    if was_current {
        if let Some(next) = current.as_ref() {
            schedule_expiry(app, next.id.clone(), next.severity);
        }
    }
    Ok(current)
}

#[tauri::command]
pub fn feedback_accept_announcement(
    app: AppHandle,
    state: State<'_, FeedbackChannelState>,
    extension_id: String,
    announcement_id: String,
) -> Result<bool, AppError> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store("feedback-announcements.dat")
        .map_err(|error| AppError::Other(format!("announcement store: {error}")))?;
    let key = format!("{extension_id}:{announcement_id}");
    if store.get(&key).and_then(|value| value.as_bool()) == Some(true) {
        return Ok(false);
    }
    let accepted = state
        .accept_announcement(&extension_id, &announcement_id)
        .map_err(|_| AppError::Lock)?;
    if !accepted {
        return Ok(false);
    }
    store.set(key, serde_json::json!(true));
    store
        .save()
        .map_err(|error| AppError::Other(format!("announcement store save: {error}")))?;
    Ok(true)
}

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
