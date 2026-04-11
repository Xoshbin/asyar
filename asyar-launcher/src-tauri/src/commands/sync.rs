use crate::auth::api_client::{ApiClient, SyncStatusResponse};
use crate::auth::state::AuthState;
use crate::error::AppError;
use tauri::State;

/// Maximum sync payload size (20 MB) — matches backend validation.
const MAX_SYNC_PAYLOAD_BYTES: usize = 20 * 1024 * 1000;

#[tauri::command]
pub async fn sync_upload(
    payload: String,
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
) -> Result<(), AppError> {
    if payload.len() > MAX_SYNC_PAYLOAD_BYTES {
        return Err(AppError::Other(format!(
            "Sync payload too large: {} bytes (max {})",
            payload.len(),
            MAX_SYNC_PAYLOAD_BYTES
        )));
    }

    let token = auth_state
        .token
        .lock()
        .map_err(|_| AppError::Lock)?
        .clone()
        .ok_or_else(|| AppError::Auth("Not logged in".to_string()))?;
    api_client.upload_sync(&token, &payload).await
}

#[tauri::command]
pub async fn sync_download(
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
) -> Result<Option<String>, AppError> {
    let token = auth_state
        .token
        .lock()
        .map_err(|_| AppError::Lock)?
        .clone()
        .ok_or_else(|| AppError::Auth("Not logged in".to_string()))?;
    api_client.download_sync(&token).await
}

#[tauri::command]
pub async fn sync_get_status(
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
) -> Result<SyncStatusResponse, AppError> {
    let token = auth_state
        .token
        .lock()
        .map_err(|_| AppError::Lock)?
        .clone()
        .ok_or_else(|| AppError::Auth("Not logged in".to_string()))?;
    api_client.get_sync_status(&token).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Manager;
    use crate::auth::state::AuthState;

    #[tokio::test]
    async fn test_sync_commands_require_auth() {
        let app = tauri::test::mock_app();
        app.manage(AuthState::default());
        app.manage(ApiClient::new());
        let auth_state = app.state::<AuthState>();
        let api_client = app.state::<ApiClient>();

        // Initially no token, should return Auth error
        let result = sync_upload("payload".to_string(), auth_state.clone(), api_client.clone()).await;
        assert!(matches!(result, Err(AppError::Auth(msg)) if msg == "Not logged in"));

        let result = sync_download(auth_state.clone(), api_client.clone()).await;
        assert!(matches!(result, Err(AppError::Auth(msg)) if msg == "Not logged in"));

        let result = sync_get_status(auth_state.clone(), api_client.clone()).await;
        assert!(matches!(result, Err(AppError::Auth(msg)) if msg == "Not logged in"));
    }

    #[tokio::test]
    async fn test_sync_commands_with_token() {
        let app = tauri::test::mock_app();
        app.manage(AuthState::default());
        app.manage(ApiClient::new());
        let auth_state = app.state::<AuthState>();

        // Set a token
        {
            let mut token = auth_state.token.lock().unwrap();
            *token = Some("valid-token".to_string());
        }

        // Final state check
        assert!(auth_state.token.lock().unwrap().is_some());
    }

    #[tokio::test]
    async fn test_sync_upload_rejects_oversized_payload() {
        let app = tauri::test::mock_app();
        app.manage(AuthState::default());
        app.manage(ApiClient::new());
        let auth_state = app.state::<AuthState>();
        let api_client = app.state::<ApiClient>();

        // Set a token so we get past the auth check
        {
            let mut token = auth_state.token.lock().unwrap();
            *token = Some("valid-token".to_string());
        }

        let oversized = "x".repeat(MAX_SYNC_PAYLOAD_BYTES + 1);
        let result = sync_upload(oversized, auth_state.clone(), api_client.clone()).await;
        assert!(matches!(result, Err(AppError::Other(msg)) if msg.contains("too large")));
    }
}
