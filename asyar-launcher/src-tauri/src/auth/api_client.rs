use crate::auth::state::AuthUser;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

// Trade-off: Hardcoded production URL. Should be compile-time env via env!("ASYAR_API_BASE")
// with .cargo/config.toml for dev and GitHub secret for CI. The runtime env var fallback
// works for development but not in packaged apps. Tracked as known tech debt.
//
// Override at runtime by setting ASYAR_API_BASE in the launcher's environment when doing
// local end-to-end testing (e.g. ASYAR_API_BASE=http://asyar-website.test to point at a
// local Valet host, or ASYAR_API_BASE=http://localhost:8000 for `php artisan serve`).
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
// status is now a client-side aggregation of the per-item sync journal
// (see [`crate::sync::orchestrator::build_sync_status`]).

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
        let base_url =
            std::env::var("ASYAR_API_BASE").unwrap_or_else(|_| DEFAULT_API_BASE.to_string());
        Self {
            base_url,
            client: build_http_client(),
        }
    }

    #[cfg(test)]
    pub fn with_base(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            client: build_http_client(),
        }
    }
}

/// Build the shared reqwest client with `Accept: application/json` set as a
/// default header. This is load-bearing: without it, Laravel's `auth:sanctum`
/// middleware returns a 302 redirect to `/login` (HTML) for token failures
/// instead of `401 {"message":"Unauthenticated."}` JSON. reqwest follows the
/// redirect by default and ends up trying to deserialize the login page as
/// our typed response, producing a confusing "decode failed" error in place
/// of a clean 401. Setting the header makes the server always speak JSON to
/// us regardless of whether auth succeeds or fails.
fn build_http_client() -> reqwest::Client {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static("application/json"),
    );
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .expect("reqwest client construction must not fail")
}

// ── API methods ───────────────────────────────────────────────────────────────

impl ApiClient {
    /// POST /api/desktop/auth/initiate — get session_code and auth URL.
    pub async fn initiate_auth(&self, provider: &str) -> Result<AuthInitResponse, AppError> {
        let response = self
            .client
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
        let response = self
            .client
            .get(format!(
                "{}/api/desktop/auth/poll/{}",
                self.base_url, session_code
            ))
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
        let response = self
            .client
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
        let response = self
            .client
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
        let _ = self
            .client
            .post(format!("{}/api/desktop/auth/logout", self.base_url))
            .bearer_auth(token)
            .send()
            .await;
        Ok(())
    }

    /// POST /api/sync/items — batch upload of changed items.
    ///
    /// Server assigns monotonic per-user version numbers and returns them paired
    /// with each item's id, plus the new max `serverVersion` for this user.
    ///
    /// # Errors
    /// - `401` → [`AppError::Auth`] with `"Token expired or invalid"` (matches
    ///   the convention used by [`Self::fetch_entitlements`]).
    /// - `403` → [`AppError::Auth`] with `"sync entitlement required"` — likely
    ///   the user lacks `sync:ai-conversations` for an ai-conversations item.
    /// - `422` → [`AppError::Validation`] (oversize batch, malformed item).
    /// - Other non-2xx → [`AppError::Auth`] with the status code in the message.
    /// - Network / serde failures propagate via `?`.
    pub async fn push_items_batch(
        &self,
        token: &str,
        request: &crate::sync::types::ItemPushBatchRequest,
    ) -> Result<crate::sync::types::ItemPushBatchResponse, AppError> {
        let response = self
            .client
            .post(format!("{}/api/sync/items", self.base_url))
            .bearer_auth(token)
            .json(request)
            .send()
            .await?;

        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("Token expired or invalid".to_string()));
        }
        if status == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::Auth("sync entitlement required".to_string()));
        }
        if status == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
            let detail = response.text().await.unwrap_or_default();
            let message = if detail.is_empty() {
                "Server rejected push batch: 422".to_string()
            } else {
                format!("Server rejected push batch (422): {detail}")
            };
            return Err(AppError::Validation(message));
        }
        if !status.is_success() {
            return Err(AppError::Auth(format!("Push items batch failed: {status}")));
        }

        Ok(response
            .json::<crate::sync::types::ItemPushBatchResponse>()
            .await?)
    }

    /// GET /api/sync/items?since={since}&limit={limit} — pull items the device
    /// hasn't seen yet.
    ///
    /// Use [`crate::sync::types::ItemPullPage::has_more`] to know when to
    /// continue paginating with `since=<last item's version>`. The server caps
    /// `limit` at 1000 regardless of what we ask for; passing very high values
    /// is safe.
    ///
    /// # Errors
    /// - `401` → [`AppError::Auth`] with `"Token expired or invalid"`.
    /// - `403` → [`AppError::Auth`] with `"sync entitlement required"`.
    /// - `422` → [`AppError::Validation`].
    /// - Other non-2xx → [`AppError::Auth`] with the status code in the message.
    /// - Network / serde failures propagate via `?`.
    pub async fn pull_items_since(
        &self,
        token: &str,
        since: i64,
        limit: u32,
    ) -> Result<crate::sync::types::ItemPullPage, AppError> {
        let response = self
            .client
            .get(format!("{}/api/sync/items", self.base_url))
            .bearer_auth(token)
            .query(&[("since", since.to_string()), ("limit", limit.to_string())])
            .send()
            .await?;

        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("Token expired or invalid".to_string()));
        }
        if status == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::Auth("sync entitlement required".to_string()));
        }
        if status == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
            let detail = response.text().await.unwrap_or_default();
            let message = if detail.is_empty() {
                "Server rejected pull request: 422".to_string()
            } else {
                format!("Server rejected pull request (422): {detail}")
            };
            return Err(AppError::Validation(message));
        }
        if !status.is_success() {
            return Err(AppError::Auth(format!("Pull items failed: {status}")));
        }

        Ok(response.json::<crate::sync::types::ItemPullPage>().await?)
    }

    // ── E2EE state endpoints ─────────────────────────────────────────────────────
    //
    // 401 / 403 map to `AppError::Auth(_)` so the re-auth and entitlement-required
    // UI surfaces fire correctly (same convention as `push_items_batch` /
    // `pull_items_since` above). Other non-2xx statuses (5xx and any unexpected
    // 4xx) use `AppError::Other(_)` (kind: "unknown") rather than the older
    // methods' fallback to `AppError::Auth(_)` for everything — the "auth_failure"
    // kind would surface as a misleading re-authentication prompt for what is
    // usually a transient server problem on an E2EE endpoint.

    /// GET /api/sync/e2ee/state — returns Some(state) if user is enrolled in E2EE,
    /// None if 404 (not enrolled).
    pub async fn get_e2ee_state(
        &self,
        token: &str,
    ) -> Result<Option<crate::sync::types::E2eeStateResponse>, AppError> {
        let url = format!("{}/api/sync/e2ee/state", self.base_url);
        let response = self.client.get(&url).bearer_auth(token).send().await?;
        match response.status().as_u16() {
            200 => Ok(Some(
                response
                    .json::<crate::sync::types::E2eeStateResponse>()
                    .await?,
            )),
            404 => Ok(None),
            401 => Err(AppError::Auth("Token expired or invalid".to_string())),
            403 => Err(AppError::Auth("sync entitlement required".to_string())),
            other => Err(AppError::Other(format!(
                "GET /api/sync/e2ee/state unexpected status {other}"
            ))),
        }
    }

    /// POST /api/sync/e2ee/state — enrol. Returns the server's stored state.
    pub async fn post_e2ee_state(
        &self,
        token: &str,
        payload: &crate::sync::types::E2eeStatePayload,
    ) -> Result<crate::sync::types::E2eeStateResponse, AppError> {
        let url = format!("{}/api/sync/e2ee/state", self.base_url);
        let response = self
            .client
            .post(&url)
            .bearer_auth(token)
            .json(payload)
            .send()
            .await?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("Token expired or invalid".to_string()));
        }
        if status == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::Auth("sync entitlement required".to_string()));
        }
        if !status.is_success() {
            return Err(AppError::Other(format!(
                "POST /api/sync/e2ee/state status {status}"
            )));
        }
        Ok(response
            .json::<crate::sync::types::E2eeStateResponse>()
            .await?)
    }

    /// PUT /api/sync/e2ee/state — replace wrapped seed (rotation, recovery).
    pub async fn put_e2ee_state(
        &self,
        token: &str,
        payload: &crate::sync::types::E2eeStatePayload,
    ) -> Result<crate::sync::types::E2eeStateResponse, AppError> {
        let url = format!("{}/api/sync/e2ee/state", self.base_url);
        let response = self
            .client
            .put(&url)
            .bearer_auth(token)
            .json(payload)
            .send()
            .await?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("Token expired or invalid".to_string()));
        }
        if status == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::Auth("sync entitlement required".to_string()));
        }
        if !status.is_success() {
            return Err(AppError::Other(format!(
                "PUT /api/sync/e2ee/state status {status}"
            )));
        }
        Ok(response
            .json::<crate::sync::types::E2eeStateResponse>()
            .await?)
    }

    /// DELETE /api/sync/e2ee/state — disable E2EE on the server. Idempotent.
    pub async fn delete_e2ee_state(&self, token: &str) -> Result<(), AppError> {
        let url = format!("{}/api/sync/e2ee/state", self.base_url);
        let response = self.client.delete(&url).bearer_auth(token).send().await?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("Token expired or invalid".to_string()));
        }
        if status == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::Auth("sync entitlement required".to_string()));
        }
        if !matches!(status.as_u16(), 200 | 204) {
            return Err(AppError::Other(format!(
                "DELETE /api/sync/e2ee/state status {status}"
            )));
        }
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::types::{ItemPushBatchRequest, ItemPushItem};
    use mockito::Server;

    // ── push_items_batch ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn push_items_batch_sends_correct_json() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/items")
            .match_header("Authorization", "Bearer my-token")
            .match_header("Content-Type", "application/json")
            .match_body(mockito::Matcher::Json(serde_json::json!({
                "deviceId": "device-abc",
                "items": [
                    {
                        "id": "item-1",
                        "categoryId": "snippets",
                        "contentHashHex": "ab",
                        "payload": "hello"
                    }
                ]
            })))
            .with_status(200)
            .with_body(r#"{"items":[{"id":"item-1","version":7}],"serverVersion":7}"#)
            .create_async()
            .await;

        let request = ItemPushBatchRequest {
            device_id: "device-abc".to_string(),
            key_version: None,
            items: vec![ItemPushItem {
                id: "item-1".to_string(),
                category_id: "snippets".to_string(),
                content_hash_hex: Some("ab".to_string()),
                payload: Some("hello".to_string()),
                deleted: None,
            }],
        };

        let result = client
            .push_items_batch("my-token", &request)
            .await
            .expect("push_items_batch should succeed");

        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].id, "item-1");
        assert_eq!(result.items[0].version, 7);
        assert_eq!(result.server_version, 7);
    }

    #[tokio::test]
    async fn push_items_batch_rejects_500_response() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/items")
            .with_status(500)
            .create_async()
            .await;

        let request = ItemPushBatchRequest {
            device_id: "device-abc".to_string(),
            key_version: None,
            items: vec![],
        };

        let result = client.push_items_batch("my-token", &request).await;
        assert!(matches!(result, Err(AppError::Auth(_))));
    }

    #[tokio::test]
    async fn push_items_batch_returns_assigned_versions() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/items")
            .with_status(200)
            .with_body(r#"{"items":[{"id":"x","version":42}],"serverVersion":42}"#)
            .create_async()
            .await;

        let request = ItemPushBatchRequest {
            device_id: "device-1".to_string(),
            key_version: None,
            items: vec![ItemPushItem {
                id: "x".to_string(),
                category_id: "snippets".to_string(),
                content_hash_hex: Some("00".to_string()),
                payload: Some("{}".to_string()),
                deleted: None,
            }],
        };

        let result = client
            .push_items_batch("my-token", &request)
            .await
            .expect("push_items_batch should succeed");

        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].id, "x");
        assert_eq!(result.items[0].version, 42);
        assert_eq!(result.server_version, 42);
    }

    #[tokio::test]
    async fn push_items_batch_handles_403_by_returning_typed_error() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/items")
            .with_status(403)
            .create_async()
            .await;

        let request = ItemPushBatchRequest {
            device_id: "device-1".to_string(),
            key_version: None,
            items: vec![],
        };

        let result = client.push_items_batch("my-token", &request).await;
        match result {
            Err(AppError::Auth(message)) => {
                assert!(
                    message.contains("sync entitlement required"),
                    "expected 'sync entitlement required' in {message}"
                );
            }
            other => panic!("expected AppError::Auth, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn push_items_batch_handles_422_by_returning_validation_error() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/items")
            .with_status(422)
            .with_body(r#"{"message":"items.0.payload exceeds 256 KiB"}"#)
            .create_async()
            .await;

        let request = ItemPushBatchRequest {
            device_id: "device-1".to_string(),
            key_version: None,
            items: vec![],
        };

        let result = client.push_items_batch("my-token", &request).await;
        assert!(matches!(result, Err(AppError::Validation(_))));
    }

    // ── pull_items_since ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn pull_items_since_paginates_with_has_more() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("GET", "/api/sync/items")
            .match_header("Authorization", "Bearer my-token")
            .match_query(mockito::Matcher::AllOf(vec![
                mockito::Matcher::UrlEncoded("since".to_string(), "0".to_string()),
                mockito::Matcher::UrlEncoded("limit".to_string(), "500".to_string()),
            ]))
            .with_status(200)
            .with_body(
                r#"{
                    "items": [
                        {
                            "id": "a",
                            "categoryId": "snippets",
                            "payload": "p",
                            "contentHashHex": "ab",
                            "version": 1,
                            "deleted": false,
                            "deletedAtIso": null,
                            "updatedAtIso": "2026-05-04T10:00:00Z"
                        }
                    ],
                    "serverVersion": 1,
                    "hasMore": true
                }"#,
            )
            .create_async()
            .await;

        let page = client
            .pull_items_since("my-token", 0, 500)
            .await
            .expect("pull_items_since should succeed");

        assert!(page.has_more, "hasMore should round-trip as true");
        assert_eq!(page.server_version, 1);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].id, "a");
        assert_eq!(page.items[0].version, 1);
        assert!(!page.items[0].deleted);
    }

    #[tokio::test]
    async fn pull_items_since_returns_tombstones() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("GET", "/api/sync/items")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_body(
                r#"{
                    "items": [
                        {
                            "id": "ghost",
                            "categoryId": "snippets",
                            "payload": null,
                            "contentHashHex": null,
                            "version": 9,
                            "deleted": true,
                            "deletedAtIso": "2026-05-04T11:00:00Z",
                            "updatedAtIso": null
                        }
                    ],
                    "serverVersion": 9,
                    "hasMore": false
                }"#,
            )
            .create_async()
            .await;

        let page = client
            .pull_items_since("my-token", 0, 100)
            .await
            .expect("pull_items_since should succeed");

        assert_eq!(page.items.len(), 1);
        let item = &page.items[0];
        assert_eq!(item.id, "ghost");
        assert!(item.deleted);
        assert!(item.payload.is_none(), "tombstone payload must be None");
        assert!(
            item.content_hash_hex.is_none(),
            "tombstone contentHashHex must be None"
        );
        assert_eq!(
            item.deleted_at_iso.as_deref(),
            Some("2026-05-04T11:00:00Z"),
            "deletedAtIso should round-trip"
        );
        assert!(
            item.updated_at_iso.is_none(),
            "tombstone updatedAtIso must be None"
        );
        assert!(!page.has_more);
    }

    #[tokio::test]
    async fn pull_items_since_handles_403_by_returning_typed_error() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("GET", "/api/sync/items")
            .match_query(mockito::Matcher::Any)
            .with_status(403)
            .create_async()
            .await;

        let result = client.pull_items_since("my-token", 0, 100).await;
        match result {
            Err(AppError::Auth(message)) => {
                assert!(
                    message.contains("sync entitlement required"),
                    "expected 'sync entitlement required' in {message}"
                );
            }
            other => panic!("expected AppError::Auth, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn pull_items_since_handles_422() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("GET", "/api/sync/items")
            .match_query(mockito::Matcher::Any)
            .with_status(422)
            .with_body(r#"{"message":"limit must be a positive integer"}"#)
            .create_async()
            .await;

        let result = client.pull_items_since("my-token", -1, 0).await;
        assert!(matches!(result, Err(AppError::Validation(_))));
    }

    // ── e2ee_tests ───────────────────────────────────────────────────────────

    mod e2ee_tests {
        use super::*;
        use crate::sync::types::E2eeStatePayload;

        #[tokio::test]
        async fn get_e2ee_state_returns_response_when_200() {
            let mut server = Server::new_async().await;
            let mock = server
                .mock("GET", "/api/sync/e2ee/state")
                .match_header("authorization", "Bearer test-token")
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(
                    serde_json::json!({
                        "wrappedMasterSeed": "enc:v1:abc",
                        "kdfSalt": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                        "kdfAlgorithm": "argon2id",
                        "kdfMCost": 65536,
                        "kdfTCost": 3,
                        "kdfPCost": 1,
                        "keyVersion": 1,
                        "enrolledAt": "2026-05-04T12:00:00Z"
                    })
                    .to_string(),
                )
                .create_async()
                .await;

            let client = ApiClient::with_base(server.url());
            let resp = client.get_e2ee_state("test-token").await.unwrap();
            assert!(resp.is_some());
            assert_eq!(resp.unwrap().key_version, 1);
            mock.assert_async().await;
        }

        #[tokio::test]
        async fn get_e2ee_state_returns_none_on_404() {
            let mut server = Server::new_async().await;
            let mock = server
                .mock("GET", "/api/sync/e2ee/state")
                .match_header("authorization", "Bearer test-token")
                .with_status(404)
                .create_async()
                .await;

            let client = ApiClient::with_base(server.url());
            let resp = client.get_e2ee_state("test-token").await.unwrap();
            assert!(resp.is_none());
            mock.assert_async().await;
        }

        #[tokio::test]
        async fn post_e2ee_state_201_returns_response() {
            let mut server = Server::new_async().await;
            let mock = server
                .mock("POST", "/api/sync/e2ee/state")
                .match_header("authorization", "Bearer test-token")
                .match_body(mockito::Matcher::Json(serde_json::json!({
                    "wrappedMasterSeed": "enc:v1:abc",
                    "kdfSalt": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                    "kdfAlgorithm": "argon2id",
                    "kdfMCost": 65536,
                    "kdfTCost": 3,
                    "kdfPCost": 1,
                })))
                .with_status(201)
                .with_header("content-type", "application/json")
                .with_body(
                    serde_json::json!({
                        "wrappedMasterSeed": "enc:v1:abc",
                        "kdfSalt": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                        "kdfAlgorithm": "argon2id",
                        "kdfMCost": 65536,
                        "kdfTCost": 3,
                        "kdfPCost": 1,
                        "keyVersion": 1,
                        "enrolledAt": "2026-05-04T12:00:00Z"
                    })
                    .to_string(),
                )
                .create_async()
                .await;

            let client = ApiClient::with_base(server.url());
            let payload = E2eeStatePayload {
                wrapped_master_seed: "enc:v1:abc".into(),
                kdf_salt: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".into(),
                kdf_algorithm: "argon2id".into(),
                kdf_m_cost: 65536,
                kdf_t_cost: 3,
                kdf_p_cost: 1,
            };
            let resp = client
                .post_e2ee_state("test-token", &payload)
                .await
                .unwrap();
            assert_eq!(resp.key_version, 1);
            mock.assert_async().await;
        }

        #[tokio::test]
        async fn put_e2ee_state_200_returns_response() {
            let mut server = Server::new_async().await;
            let mock = server
                .mock("PUT", "/api/sync/e2ee/state")
                .match_header("authorization", "Bearer test-token")
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(
                    serde_json::json!({
                        "wrappedMasterSeed": "enc:v1:rotated",
                        "kdfSalt": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
                        "kdfAlgorithm": "argon2id",
                        "kdfMCost": 65536,
                        "kdfTCost": 3,
                        "kdfPCost": 1,
                        "keyVersion": 2,
                        "enrolledAt": "2026-05-04T12:00:00Z"
                    })
                    .to_string(),
                )
                .create_async()
                .await;

            let client = ApiClient::with_base(server.url());
            let payload = E2eeStatePayload {
                wrapped_master_seed: "enc:v1:rotated".into(),
                kdf_salt: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".into(),
                kdf_algorithm: "argon2id".into(),
                kdf_m_cost: 65536,
                kdf_t_cost: 3,
                kdf_p_cost: 1,
            };
            let resp = client.put_e2ee_state("test-token", &payload).await.unwrap();
            assert_eq!(resp.key_version, 2);
            mock.assert_async().await;
        }

        #[tokio::test]
        async fn delete_e2ee_state_204() {
            let mut server = Server::new_async().await;
            let mock = server
                .mock("DELETE", "/api/sync/e2ee/state")
                .match_header("authorization", "Bearer test-token")
                .with_status(204)
                .create_async()
                .await;

            let client = ApiClient::with_base(server.url());
            client.delete_e2ee_state("test-token").await.unwrap();
            mock.assert_async().await;
        }

        #[tokio::test]
        async fn get_e2ee_state_propagates_5xx_as_error() {
            let mut server = Server::new_async().await;
            let _mock = server
                .mock("GET", "/api/sync/e2ee/state")
                .with_status(500)
                .create_async()
                .await;

            let client = ApiClient::with_base(server.url());
            let result = client.get_e2ee_state("test-token").await;
            assert!(matches!(result, Err(AppError::Other(_))));
        }

        #[tokio::test]
        async fn get_e2ee_state_handles_401_as_auth_error() {
            let mut server = Server::new_async().await;
            let mock = server
                .mock("GET", "/api/sync/e2ee/state")
                .match_header("authorization", "Bearer test-token")
                .with_status(401)
                .create_async()
                .await;

            let client = ApiClient::with_base(server.url());
            let result = client.get_e2ee_state("test-token").await;
            assert!(matches!(result, Err(AppError::Auth(_))));
            mock.assert_async().await;
        }

        #[tokio::test]
        async fn get_e2ee_state_handles_403_as_auth_error() {
            let mut server = Server::new_async().await;
            let mock = server
                .mock("GET", "/api/sync/e2ee/state")
                .match_header("authorization", "Bearer test-token")
                .with_status(403)
                .create_async()
                .await;

            let client = ApiClient::with_base(server.url());
            let result = client.get_e2ee_state("test-token").await;
            assert!(matches!(result, Err(AppError::Auth(_))));
            mock.assert_async().await;
        }
    }
}
