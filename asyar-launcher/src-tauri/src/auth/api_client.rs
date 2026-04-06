use crate::auth::state::AuthUser;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

// Trade-off: Hardcoded production URL. Should be compile-time env via env!("ASYAR_API_BASE")
// with .cargo/config.toml for dev and GitHub secret for CI. The runtime env var fallback
// works for development but not in packaged apps. Tracked as known tech debt.
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
// Trade-off: Creates a new reqwest::Client per call. Low-frequency auth calls
// don't justify a shared client. If sync calls become frequent, refactor to
// a shared client stored in Tauri managed state.
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusResponse {
    pub last_synced_at: Option<String>,
    pub snapshot_size: u64,
}

/// POST /api/sync/upload — upload snapshot to cloud.
pub async fn upload_sync(token: &str, payload: &str) -> Result<(), AppError> {
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/api/sync/upload", api_base()))
        .bearer_auth(token)
        .json(&serde_json::json!({ "snapshot": payload }))
        .send()
        .await?;

    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Err(AppError::Auth("sync:settings entitlement required".to_string()));
    }

    if !response.status().is_success() {
        return Err(AppError::Auth(format!(
            "Upload failed: {}",
            response.status()
        )));
    }

    Ok(())
}

/// GET /api/sync/latest — download snapshot from cloud.
/// Returns None if no snapshot exists (404).
pub async fn download_sync(token: &str) -> Result<Option<String>, AppError> {
    #[derive(Deserialize)]
    struct DownloadResponse { snapshot: String }

    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/api/sync/latest", api_base()))
        .bearer_auth(token)
        .send()
        .await?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if !response.status().is_success() {
        return Err(AppError::Auth(format!(
            "Download failed: {}",
            response.status()
        )));
    }

    let data = response.json::<DownloadResponse>().await?;
    Ok(Some(data.snapshot))
}

/// GET /api/sync/status — check last sync timestamp and size.
pub async fn get_sync_status(token: &str) -> Result<SyncStatusResponse, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/api/sync/status", api_base()))
        .bearer_auth(token)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(AppError::Auth(format!(
            "Status check failed: {}",
            response.status()
        )));
    }

    Ok(response.json::<SyncStatusResponse>().await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    #[tokio::test]
    async fn test_upload_sync_success() {
        let mut server = Server::new_async().await;
        std::env::set_var("ASYAR_API_BASE", server.url());

        let _m = server.mock("POST", "/api/sync/upload")
            .match_header("Authorization", "Bearer my-token")
            .match_body(mockito::Matcher::Json(serde_json::json!({ "snapshot": "data" })))
            .with_status(200)
            .create_async()
            .await;

        let result = upload_sync("my-token", "data").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_upload_sync_forbidden() {
        let mut server = Server::new_async().await;
        std::env::set_var("ASYAR_API_BASE", server.url());

        let _m = server.mock("POST", "/api/sync/upload")
            .with_status(403)
            .create_async()
            .await;

        let result = upload_sync("my-token", "data").await;
        match result {
            Err(AppError::Auth(msg)) => assert_eq!(msg, "sync:settings entitlement required"),
            _ => panic!("Expected Auth error"),
        }
    }

    #[tokio::test]
    async fn test_download_sync_success() {
        let mut server = Server::new_async().await;
        std::env::set_var("ASYAR_API_BASE", server.url());

        let _m = server.mock("GET", "/api/sync/latest")
            .with_status(200)
            .with_body(r#"{"snapshot": "my-snapshot"}"#)
            .create_async()
            .await;

        let result = download_sync("my-token").await.unwrap();
        assert_eq!(result, Some("my-snapshot".to_string()));
    }

    #[tokio::test]
    async fn test_download_sync_not_found() {
        let mut server = Server::new_async().await;
        std::env::set_var("ASYAR_API_BASE", server.url());

        let _m = server.mock("GET", "/api/sync/latest")
            .with_status(404)
            .create_async()
            .await;

        let result = download_sync("my-token").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_get_sync_status() {
        let mut server = Server::new_async().await;
        std::env::set_var("ASYAR_API_BASE", server.url());

        let _m = server.mock("GET", "/api/sync/status")
            .with_status(200)
            .with_body(r#"{"lastSyncedAt": "2024-01-01", "snapshotSize": 1024}"#)
            .create_async()
            .await;

        let result = get_sync_status("my-token").await.unwrap();
        assert_eq!(result.last_synced_at, Some("2024-01-01".to_string()));
        assert_eq!(result.snapshot_size, 1024);
    }
}
