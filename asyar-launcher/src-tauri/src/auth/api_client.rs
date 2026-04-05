use crate::auth::state::AuthUser;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

const DEFAULT_API_BASE: &str = "https://asyar.org";

fn api_base() -> String {
    std::env::var("ASYAR_API_BASE").unwrap_or_else(|_| DEFAULT_API_BASE.to_string())
}

// ── Request/Response types ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthInitResponse {
    pub session_code: String,
    pub auth_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollResponse {
    pub status: String, // "pending" | "complete" | "expired"
    pub token: Option<String>,
    pub user: Option<AuthUser>,
    pub entitlements: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementResponse {
    pub entitlements: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenRefreshResponse {
    pub token: String,
    pub expires_at: String,
}

// ── API functions ─────────────────────────────────────────────────────────────

/// POST /api/desktop/auth/initiate — get session_code and auth URL.
pub async fn initiate_auth(provider: &str) -> Result<AuthInitResponse, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/api/desktop/auth/initiate", api_base()))
        .json(&serde_json::json!({ "provider": provider }))
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(AppError::Auth(format!(
            "Auth initiate failed: {}",
            response.status()
        )));
    }

    Ok(response.json::<AuthInitResponse>().await?)
}

/// GET /api/desktop/auth/poll/{session_code} — check if OAuth completed.
pub async fn poll_auth(session_code: &str) -> Result<PollResponse, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/api/desktop/auth/poll/{}", api_base(), session_code))
        .send()
        .await?;

    if response.status() == reqwest::StatusCode::GONE {
        return Ok(PollResponse {
            status: "expired".to_string(),
            token: None,
            user: None,
            entitlements: None,
        });
    }

    if !response.status().is_success() {
        return Err(AppError::Auth(format!(
            "Auth poll failed: {}",
            response.status()
        )));
    }

    Ok(response.json::<PollResponse>().await?)
}

/// GET /api/entitlements — fetch current user's entitlements.
pub async fn fetch_entitlements(token: &str) -> Result<Vec<String>, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/api/entitlements", api_base()))
        .bearer_auth(token)
        .send()
        .await?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::Auth("Token expired or invalid".to_string()));
    }

    if !response.status().is_success() {
        return Err(AppError::Auth(format!(
            "Entitlements fetch failed: {}",
            response.status()
        )));
    }

    let data = response.json::<EntitlementResponse>().await?;
    Ok(data.entitlements)
}

/// POST /api/desktop/auth/refresh — rotate token.
pub async fn refresh_token(old_token: &str) -> Result<TokenRefreshResponse, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/api/desktop/auth/refresh", api_base()))
        .bearer_auth(old_token)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(AppError::Auth(format!(
            "Token refresh failed: {}",
            response.status()
        )));
    }

    Ok(response.json::<TokenRefreshResponse>().await?)
}

/// POST /api/desktop/auth/logout — revoke token.
pub async fn revoke_token(token: &str) -> Result<(), AppError> {
    let client = reqwest::Client::new();
    // Best-effort: ignore errors since we're clearing local state anyway
    let _ = client
        .post(format!("{}/api/desktop/auth/logout", api_base()))
        .bearer_auth(token)
        .send()
        .await;
    Ok(())
}
