use crate::auth::state::AuthUser;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

// Trade-off: Hardcoded production URL. Should be compile-time env via env!("ASYAR_API_BASE")
// with .cargo/config.toml for dev and GitHub secret for CI. The runtime env var fallback
// works for development but not in packaged apps. Tracked as known tech debt.
const DEFAULT_API_BASE: &str = "https://asyar.org";

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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusResponse {
    pub last_synced_at: Option<String>,
    pub snapshot_size: u64,
}

// ── ApiClient ─────────────────────────────────────────────────────────────────

/// HTTP client for the Asyar backend API.
///
/// Holds the base URL and a shared reqwest::Client (which is Arc-backed
/// internally and safe to clone/share across threads). Register one instance
/// as Tauri managed state so every command handler receives the same client.
pub struct ApiClient {
    base_url: String,
    client: reqwest::Client,
}

impl Default for ApiClient {
    fn default() -> Self {
        Self::new()
    }
}

impl ApiClient {
    pub fn new() -> Self {
        let base_url = std::env::var("ASYAR_API_BASE")
            .unwrap_or_else(|_| DEFAULT_API_BASE.to_string());
        Self {
            base_url,
            client: reqwest::Client::new(),
        }
    }

    #[cfg(test)]
    pub fn with_base(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            client: reqwest::Client::new(),
        }
    }
}

// ── API methods ───────────────────────────────────────────────────────────────

impl ApiClient {
    /// POST /api/desktop/auth/initiate — get session_code and auth URL.
    pub async fn initiate_auth(&self, provider: &str) -> Result<AuthInitResponse, AppError> {
        let response = self.client
            .post(format!("{}/api/desktop/auth/initiate", self.base_url))
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
    pub async fn poll_auth(&self, session_code: &str) -> Result<PollResponse, AppError> {
        let response = self.client
            .get(format!("{}/api/desktop/auth/poll/{}", self.base_url, session_code))
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
    pub async fn fetch_entitlements(&self, token: &str) -> Result<Vec<String>, AppError> {
        let response = self.client
            .get(format!("{}/api/entitlements", self.base_url))
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
    pub async fn refresh_token(&self, old_token: &str) -> Result<TokenRefreshResponse, AppError> {
        let response = self.client
            .post(format!("{}/api/desktop/auth/refresh", self.base_url))
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

    /// POST /api/desktop/auth/logout — revoke token (best-effort).
    pub async fn revoke_token(&self, token: &str) -> Result<(), AppError> {
        // Best-effort: ignore errors since we're clearing local state anyway
        let _ = self.client
            .post(format!("{}/api/desktop/auth/logout", self.base_url))
            .bearer_auth(token)
            .send()
            .await;
        Ok(())
    }

    /// POST /api/sync/upload — upload snapshot to cloud.
    pub async fn upload_sync(&self, token: &str, payload: &str) -> Result<(), AppError> {
        let response = self.client
            .post(format!("{}/api/sync/upload", self.base_url))
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
    pub async fn download_sync(&self, token: &str) -> Result<Option<String>, AppError> {
        #[derive(Deserialize)]
        struct DownloadResponse { snapshot: String }

        let response = self.client
            .get(format!("{}/api/sync/latest", self.base_url))
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
    pub async fn get_sync_status(&self, token: &str) -> Result<SyncStatusResponse, AppError> {
        let response = self.client
            .get(format!("{}/api/sync/status", self.base_url))
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
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    #[tokio::test]
    async fn test_upload_sync_success() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server.mock("POST", "/api/sync/upload")
            .match_header("Authorization", "Bearer my-token")
            .match_body(mockito::Matcher::Json(serde_json::json!({ "snapshot": "data" })))
            .with_status(200)
            .create_async()
            .await;

        let result = client.upload_sync("my-token", "data").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_upload_sync_forbidden() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server.mock("POST", "/api/sync/upload")
            .with_status(403)
            .create_async()
            .await;

        let result = client.upload_sync("my-token", "data").await;
        match result {
            Err(AppError::Auth(msg)) => assert_eq!(msg, "sync:settings entitlement required"),
            _ => panic!("Expected Auth error"),
        }
    }

    #[tokio::test]
    async fn test_download_sync_success() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server.mock("GET", "/api/sync/latest")
            .with_status(200)
            .with_body(r#"{"snapshot": "my-snapshot"}"#)
            .create_async()
            .await;

        let result = client.download_sync("my-token").await.unwrap();
        assert_eq!(result, Some("my-snapshot".to_string()));
    }

    #[tokio::test]
    async fn test_download_sync_not_found() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server.mock("GET", "/api/sync/latest")
            .with_status(404)
            .create_async()
            .await;

        let result = client.download_sync("my-token").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_get_sync_status() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server.mock("GET", "/api/sync/status")
            .with_status(200)
            .with_body(r#"{"lastSyncedAt": "2024-01-01", "snapshotSize": 1024}"#)
            .create_async()
            .await;

        let result = client.get_sync_status("my-token").await.unwrap();
        assert_eq!(result.last_synced_at, Some("2024-01-01".to_string()));
        assert_eq!(result.snapshot_size, 1024);
    }
}
