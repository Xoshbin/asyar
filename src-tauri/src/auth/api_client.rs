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

// `SyncStatusResponse` from the pre-Layer-4a snapshot scheme is gone —
// status is now a client-side aggregation of `GET /api/sync/categories`
// (see [`crate::sync::orchestrator::aggregate_status`]).

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

    /// POST /api/sync/category/{category_id} — upload one category.
    pub async fn upload_category(
        &self,
        token: &str,
        category_id: &str,
        body: &crate::sync::types::UploadRequest,
    ) -> Result<crate::sync::types::UploadResponse, AppError> {
        let response = self
            .client
            .post(format!(
                "{}/api/sync/category/{category_id}",
                self.base_url
            ))
            .bearer_auth(token)
            .json(body)
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::Auth(
                "sync entitlement required".to_string(),
            ));
        }
        if response.status() == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
            return Err(AppError::Validation(format!(
                "Server rejected category {category_id}: 422"
            )));
        }
        if !response.status().is_success() {
            return Err(AppError::Auth(format!(
                "Category upload failed for {category_id}: {}",
                response.status()
            )));
        }

        Ok(response
            .json::<crate::sync::types::UploadResponse>()
            .await?)
    }

    /// GET /api/sync/categories — list every category the server has,
    /// with its hash + last-synced timestamp.
    pub async fn list_categories(
        &self,
        token: &str,
    ) -> Result<Vec<crate::sync::types::CategoryListEntry>, AppError> {
        #[derive(serde::Deserialize)]
        struct ListResponse {
            categories: Vec<crate::sync::types::CategoryListEntry>,
        }

        let response = self
            .client
            .get(format!("{}/api/sync/categories", self.base_url))
            .bearer_auth(token)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::Auth(format!(
                "List categories failed: {}",
                response.status()
            )));
        }

        Ok(response.json::<ListResponse>().await?.categories)
    }

    /// GET /api/sync/category/{category_id} — fetch one category.
    /// Returns `None` on 404 so the caller can treat "server-side
    /// deleted" as a clear-journal signal.
    pub async fn download_category(
        &self,
        token: &str,
        category_id: &str,
    ) -> Result<Option<crate::sync::types::CategoryPayload>, AppError> {
        let response = self
            .client
            .get(format!(
                "{}/api/sync/category/{category_id}",
                self.base_url
            ))
            .bearer_auth(token)
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(AppError::Auth(format!(
                "Category download failed for {category_id}: {}",
                response.status()
            )));
        }

        Ok(Some(
            response
                .json::<crate::sync::types::CategoryPayload>()
                .await?,
        ))
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::types::{CategoryListEntry, CategoryPayload, UploadRequest};
    use mockito::Server;

    #[tokio::test]
    async fn test_upload_category_success_returns_synced_at() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/category/snippets")
            .match_header("Authorization", "Bearer my-token")
            .match_body(mockito::Matcher::Json(serde_json::json!({
                "contentHashHex": "ab".repeat(32),
                "payload": "{}"
            })))
            .with_status(200)
            .with_body(r#"{"syncedAtIso": "2026-05-04T12:00:00Z"}"#)
            .create_async()
            .await;

        let body = UploadRequest {
            content_hash_hex: "ab".repeat(32),
            payload: "{}".to_string(),
        };
        let result = client
            .upload_category("my-token", "snippets", &body)
            .await
            .unwrap();
        assert_eq!(result.synced_at_iso, "2026-05-04T12:00:00Z");
    }

    #[tokio::test]
    async fn test_upload_category_forbidden_maps_to_auth_error() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/category/snippets")
            .with_status(403)
            .create_async()
            .await;

        let body = UploadRequest {
            content_hash_hex: "00".repeat(32),
            payload: "{}".to_string(),
        };
        let result = client.upload_category("my-token", "snippets", &body).await;
        assert!(matches!(result, Err(AppError::Auth(_))));
    }

    #[tokio::test]
    async fn test_upload_category_422_maps_to_validation_error() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/category/clipboard")
            .with_status(422)
            .create_async()
            .await;

        let body = UploadRequest {
            content_hash_hex: "00".repeat(32),
            payload: "{}".to_string(),
        };
        let result = client.upload_category("my-token", "clipboard", &body).await;
        assert!(matches!(result, Err(AppError::Validation(_))));
    }

    #[tokio::test]
    async fn test_list_categories_parses_array() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("GET", "/api/sync/categories")
            .with_status(200)
            .with_body(
                r#"{"categories":[
                    {"categoryId":"settings","contentHashHex":"abcd","syncedAtIso":"2026-05-04T01:00:00Z"},
                    {"categoryId":"snippets","contentHashHex":"efgh","syncedAtIso":"2026-05-04T02:00:00Z"}
                ]}"#,
            )
            .create_async()
            .await;

        let entries = client.list_categories("my-token").await.unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].category_id, "settings");
        assert_eq!(entries[1].category_id, "snippets");
    }

    #[tokio::test]
    async fn test_list_categories_handles_empty_response() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("GET", "/api/sync/categories")
            .with_status(200)
            .with_body(r#"{"categories":[]}"#)
            .create_async()
            .await;

        let entries = client.list_categories("my-token").await.unwrap();
        assert!(entries.is_empty());
    }

    #[tokio::test]
    async fn test_download_category_returns_payload() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("GET", "/api/sync/category/snippets")
            .with_status(200)
            .with_body(
                r#"{"contentHashHex":"abcd","payload":"{\"version\":1}","syncedAtIso":"2026-05-04T03:00:00Z"}"#,
            )
            .create_async()
            .await;

        let result: Option<CategoryPayload> =
            client.download_category("my-token", "snippets").await.unwrap();
        let payload = result.unwrap();
        assert_eq!(payload.content_hash_hex, "abcd");
        assert_eq!(payload.payload, r#"{"version":1}"#);
    }

    #[tokio::test]
    async fn test_download_category_returns_none_on_404() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("GET", "/api/sync/category/snippets")
            .with_status(404)
            .create_async()
            .await;

        let result = client.download_category("my-token", "snippets").await.unwrap();
        assert!(result.is_none());
    }

    /// Sanity: only categories matching the route regex (`[a-z0-9-]+`)
    /// are valid; the client doesn't enforce the regex but the server
    /// will 404 unmatched paths. Test confirms 404 round-trips cleanly.
    #[tokio::test]
    async fn test_download_category_with_invalid_id_404s() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("GET", "/api/sync/category/Bad-Name")
            .with_status(404)
            .create_async()
            .await;

        let result = client.download_category("my-token", "Bad-Name").await.unwrap();
        assert!(result.is_none());
    }

    /// Listing categories is idempotent and safe to call repeatedly.
    #[tokio::test]
    async fn test_list_categories_can_be_called_repeatedly() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("GET", "/api/sync/categories")
            .with_status(200)
            .with_body(r#"{"categories":[]}"#)
            .expect_at_least(2)
            .create_async()
            .await;

        let _ = client.list_categories("token").await.unwrap();
        let _ = client.list_categories("token").await.unwrap();
        let _ = CategoryListEntry {
            category_id: String::new(),
            content_hash_hex: String::new(),
            synced_at_iso: String::new(),
        };
    }
}
