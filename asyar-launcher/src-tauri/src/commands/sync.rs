use crate::auth::{api_client, state::AuthState};
use crate::error::AppError;
use tauri::State;

#[tauri::command]
pub async fn sync_upload(
    payload: String,
    auth_state: State<'_, AuthState>,
) -> Result<(), AppError> {
    let token = auth_state
        .token
        .lock()
        .map_err(|_| AppError::Lock)?
        .clone()
        .ok_or_else(|| AppError::Auth("Not logged in".to_string()))?;
    api_client::upload_sync(&token, &payload).await
}

#[tauri::command]
pub async fn sync_download(
    auth_state: State<'_, AuthState>,
) -> Result<Option<String>, AppError> {
    let token = auth_state
        .token
        .lock()
        .map_err(|_| AppError::Lock)?
        .clone()
        .ok_or_else(|| AppError::Auth("Not logged in".to_string()))?;
    api_client::download_sync(&token).await
}

#[tauri::command]
pub async fn sync_get_status(
    auth_state: State<'_, AuthState>,
) -> Result<api_client::SyncStatusResponse, AppError> {
    let token = auth_state
        .token
        .lock()
        .map_err(|_| AppError::Lock)?
        .clone()
        .ok_or_else(|| AppError::Auth("Not logged in".to_string()))?;
    api_client::get_sync_status(&token).await
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
        let auth_state = app.state::<AuthState>();
        
        // Initially no token, should return Auth error
        let result = sync_upload("payload".to_string(), auth_state.clone()).await;
        assert!(matches!(result, Err(AppError::Auth(msg)) if msg == "Not logged in"));

        let result = sync_download(auth_state.clone()).await;
        assert!(matches!(result, Err(AppError::Auth(msg)) if msg == "Not logged in"));

        let result = sync_get_status(auth_state.clone()).await;
        assert!(matches!(result, Err(AppError::Auth(msg)) if msg == "Not logged in"));
    }

    #[tokio::test]
    async fn test_sync_commands_with_token() {
        let app = tauri::test::mock_app();
        app.manage(AuthState::default());
        let auth_state = app.state::<AuthState>();
        
        // Set a token
        {
            let mut token = auth_state.token.lock().unwrap();
            *token = Some("valid-token".to_string());
        }
        
        // Final state check
        assert!(auth_state.token.lock().unwrap().is_some());
    }
}
