use crate::error::AppError;
use crate::oauth::{
    service, token_store, OAuthExchangeResponse, OAuthPendingFlowState, OAuthStartResponse,
    OAuthToken, PendingOAuthFlow,
};
use crate::storage::DataStore;
use tauri::{AppHandle, State};

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Start a new OAuth PKCE flow for an extension.
///
/// Generates a PKCE pair + opaque state, stores the pending flow in-memory,
/// and returns the full authorization URL to open in the system browser.
#[tauri::command]
pub async fn oauth_start_flow(
    extension_id: String,
    provider_id: String,
    client_id: String,
    authorization_url: String,
    token_url: String,
    scopes: Vec<String>,
    flow_id: String,
    pending_flows: State<'_, OAuthPendingFlowState>,
) -> Result<OAuthStartResponse, AppError> {
    let (code_verifier, code_challenge) = crate::oauth::pkce::generate_pkce_pair();
    let state = crate::oauth::pkce::generate_state();

    let auth_url = crate::oauth::pkce::build_auth_url(
        &authorization_url,
        &client_id,
        &code_challenge,
        &state,
        &scopes,
    )?;

    pending_flows.insert(
        state.clone(),
        PendingOAuthFlow {
            extension_id,
            flow_id,
            provider_id,
            code_verifier,
            token_url,
            client_id,
        },
    );

    Ok(OAuthStartResponse { state, auth_url })
}

/// Exchange an authorization code for tokens (called after the deep-link fires).
///
/// Looks up the pending flow by `state_param`, performs the HTTP token exchange
/// using the stored PKCE `code_verifier`, persists the token, and returns the
/// result so the TS host can route it to the correct extension iframe.
#[tauri::command]
pub async fn oauth_exchange_code(
    app: AppHandle,
    state_param: String,
    code: String,
    pending_flows: State<'_, OAuthPendingFlowState>,
    data_store: State<'_, DataStore>,
) -> Result<OAuthExchangeResponse, AppError> {
    let flow = pending_flows
        .remove(&state_param)
        .ok_or_else(|| AppError::NotFound("OAuth flow not found or expired".into()))?;

    let token = service::exchange_code_for_token(&flow, &code).await?;

    let conn = data_store.conn()?;
    token_store::store_token(&app, &conn, &flow.extension_id, &flow.provider_id, &token)?;

    Ok(OAuthExchangeResponse {
        extension_id: flow.extension_id,
        flow_id: flow.flow_id,
        token,
    })
}

/// Return a stored, non-expired token for the given extension + provider.
/// Returns `null` (None) if no token exists or if the existing token is expired.
#[tauri::command]
pub fn oauth_get_stored_token(
    app: AppHandle,
    extension_id: String,
    provider_id: String,
    data_store: State<'_, DataStore>,
) -> Result<Option<OAuthToken>, AppError> {
    let conn = data_store.conn()?;
    let token = token_store::get_token(&app, &conn, &extension_id, &provider_id)?;
    Ok(filter_valid_token(token))
}

/// Discard expired tokens so callers always receive a usable token or `None`.
/// Extracted for unit testability — `oauth_get_stored_token` is the only caller.
fn filter_valid_token(token: Option<OAuthToken>) -> Option<OAuthToken> {
    token.filter(|t| !service::is_token_expired(t))
}

/// Delete the stored token for the given extension + provider.
#[tauri::command]
pub fn oauth_revoke_extension_token(
    extension_id: String,
    provider_id: String,
    data_store: State<'_, DataStore>,
) -> Result<(), AppError> {
    let conn = data_store.conn()?;
    token_store::delete_token(&conn, &extension_id, &provider_id)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::filter_valid_token;
    use crate::oauth::{service, OAuthToken};

    fn make_token(expires_at: Option<i64>) -> OAuthToken {
        OAuthToken {
            access_token: "tok".into(),
            refresh_token: None,
            token_type: "Bearer".into(),
            scopes: vec![],
            expires_at,
        }
    }

    /// `filter_valid_token(None)` → `None` (no token stored).
    #[test]
    fn filter_valid_token_passes_through_none() {
        assert!(filter_valid_token(None).is_none());
    }

    /// `filter_valid_token(Some(valid))` → `Some` (token returned to caller).
    #[test]
    fn filter_valid_token_returns_some_for_non_expired_token() {
        let token = make_token(Some(i64::MAX)); // far future
        assert!(filter_valid_token(Some(token)).is_some());
    }

    /// `filter_valid_token(Some(expired))` → `None` (caller restarts the flow).
    #[test]
    fn filter_valid_token_returns_none_for_expired_token() {
        let token = make_token(Some(0)); // epoch 0 = clearly expired
        assert!(filter_valid_token(Some(token)).is_none());
    }

    /// Token expiring within 60-second buffer is treated as expired.
    #[test]
    fn filter_valid_token_returns_none_within_60s_buffer() {
        let token = make_token(Some(service::now_secs() + 30)); // 30s left
        assert!(filter_valid_token(Some(token)).is_none());
    }

    /// Token with no `expires_at` is never discarded.
    #[test]
    fn filter_valid_token_keeps_non_expiring_token() {
        let token = make_token(None);
        assert!(filter_valid_token(Some(token)).is_some());
    }
}
