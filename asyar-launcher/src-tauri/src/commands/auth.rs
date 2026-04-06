use crate::auth::api_client::{self, ApiClient};
use crate::auth::state::{AuthState, AuthStateResponse};
use crate::auth::token_store;
use crate::error::AppError;
use tauri::{AppHandle, State};

/// Open the browser for OAuth login. Returns session_code and the URL to open.
#[tauri::command]
pub async fn auth_initiate(
    provider: String,
    api_client: State<'_, ApiClient>,
) -> Result<api_client::AuthInitResponse, AppError> {
    api_client.initiate_auth(&provider).await
}

/// Poll for OAuth completion. On success, persists auth to auth.dat and
/// populates AuthState.
#[tauri::command]
pub async fn auth_poll(
    app: AppHandle,
    session_code: String,
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
) -> Result<api_client::PollResponse, AppError> {
    let response = api_client.poll_auth(&session_code).await?;

    if response.status == "complete" {
        if let (Some(token), Some(user), Some(entitlements)) = (
            &response.token,
            &response.user,
            &response.entitlements,
        ) {
            // Persist to disk
            token_store::save_auth(&app, token, user, entitlements)?;

            // Populate in-memory state
            *auth_state.token.lock().map_err(|_| AppError::Lock)? = Some(token.clone());
            *auth_state.user.lock().map_err(|_| AppError::Lock)? = Some(user.clone());
            *auth_state.entitlements.lock().map_err(|_| AppError::Lock)? = entitlements.clone();

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            *auth_state.entitlements_cached_at.lock().map_err(|_| AppError::Lock)? = Some(now);
        }
    }

    Ok(response)
}

/// Load cached auth from auth.dat and populate AuthState. Called on startup.
#[tauri::command]
pub fn auth_load_cached(
    app: AppHandle,
    auth_state: State<'_, AuthState>,
) -> Result<Option<AuthStateResponse>, AppError> {
    let stored = token_store::load_auth(&app)?;

    match stored {
        None => Ok(None),
        Some(data) => {
            *auth_state.token.lock().map_err(|_| AppError::Lock)? = Some(data.token);
            *auth_state.user.lock().map_err(|_| AppError::Lock)? = Some(data.user.clone());
            *auth_state.entitlements.lock().map_err(|_| AppError::Lock)? =
                data.entitlements.clone();
            *auth_state.entitlements_cached_at.lock().map_err(|_| AppError::Lock)? =
                Some(data.cached_at);

            Ok(Some(AuthStateResponse {
                is_logged_in: true,
                user: Some(data.user),
                entitlements: data.entitlements,
                entitlements_cached_at: Some(data.cached_at),
            }))
        }
    }
}

/// Get current in-memory auth state snapshot.
#[tauri::command]
pub fn auth_get_state(auth_state: State<'_, AuthState>) -> Result<AuthStateResponse, AppError> {
    let token = auth_state.token.lock().map_err(|_| AppError::Lock)?;
    let user = auth_state.user.lock().map_err(|_| AppError::Lock)?;
    let entitlements = auth_state.entitlements.lock().map_err(|_| AppError::Lock)?;
    let cached_at = auth_state.entitlements_cached_at.lock().map_err(|_| AppError::Lock)?;

    Ok(AuthStateResponse {
        is_logged_in: token.is_some(),
        user: user.clone(),
        entitlements: entitlements.clone(),
        entitlements_cached_at: *cached_at,
    })
}

/// Fetch fresh entitlements from backend and update state + disk cache.
#[tauri::command]
pub async fn auth_refresh_entitlements(
    app: AppHandle,
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
) -> Result<Vec<String>, AppError> {
    let token = auth_state
        .token
        .lock()
        .map_err(|_| AppError::Lock)?
        .clone()
        .ok_or_else(|| AppError::Auth("Not logged in".to_string()))?;

    let entitlements = api_client.fetch_entitlements(&token).await?;

    // Update in-memory state
    *auth_state.entitlements.lock().map_err(|_| AppError::Lock)? = entitlements.clone();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    *auth_state.entitlements_cached_at.lock().map_err(|_| AppError::Lock)? = Some(now);

    // Update disk cache
    token_store::update_entitlements(&app, &entitlements)?;

    Ok(entitlements)
}

/// Check if the current user has a specific entitlement (synchronous).
#[tauri::command]
pub fn auth_check_entitlement(
    entitlement: String,
    auth_state: State<'_, AuthState>,
) -> Result<bool, AppError> {
    let entitlements = auth_state.entitlements.lock().map_err(|_| AppError::Lock)?;
    Ok(entitlements.contains(&entitlement))
}

/// Revoke token on backend and clear all local auth state.
#[tauri::command]
pub async fn auth_logout(
    app: AppHandle,
    auth_state: State<'_, AuthState>,
    api_client: State<'_, ApiClient>,
) -> Result<(), AppError> {
    // Best-effort revoke on backend
    let token = auth_state
        .token
        .lock()
        .map_err(|_| AppError::Lock)?
        .clone();

    if let Some(t) = token {
        api_client.revoke_token(&t).await?;
    }

    // Clear in-memory state
    *auth_state.token.lock().map_err(|_| AppError::Lock)? = None;
    *auth_state.user.lock().map_err(|_| AppError::Lock)? = None;
    *auth_state.entitlements.lock().map_err(|_| AppError::Lock)? = vec![];
    *auth_state.entitlements_cached_at.lock().map_err(|_| AppError::Lock)? = None;

    // Clear disk
    token_store::clear_auth(&app)?;

    Ok(())
}
