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
#[derive(Clone)]
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
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(60))
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
    /// - `401` → [`AppError::Auth`] with `"Token expired or invalid"`.
    /// - `403` → [`AppError::SyncEntitlementRequired`].
    /// - `413` → [`AppError::SyncQuotaExceeded`].
    /// - `429` → [`AppError::SyncRateLimited`].
    /// - `422` → [`AppError::Validation`].
    /// - 5xx → [`AppError::SyncServerUnavailable`].
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

        if !response.status().is_success() {
            return Err(map_sync_http_error("push batch", response).await);
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
    /// - `403` → [`AppError::SyncEntitlementRequired`].
    /// - `413` → [`AppError::SyncQuotaExceeded`].
    /// - `429` → [`AppError::SyncRateLimited`].
    /// - `422` → [`AppError::Validation`].
    /// - 5xx → [`AppError::SyncServerUnavailable`].
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

        if !response.status().is_success() {
            return Err(map_sync_http_error("pull items", response).await);
        }

        Ok(response.json::<crate::sync::types::ItemPullPage>().await?)
    }
}

/// Map HTTP error responses from `/api/sync/items` into typed `AppError` variants.
pub(crate) async fn map_sync_http_error(op: &'static str, response: reqwest::Response) -> AppError {
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return AppError::Auth("Token expired or invalid".to_string());
    }

    if status == reqwest::StatusCode::FORBIDDEN {
        let code = match response.json::<serde_json::Value>().await {
            Ok(val) => val
                .get("code")
                .and_then(|c| c.as_str())
                .unwrap_or("sync.entitlement-required")
                .to_string(),
            Err(_) => "sync.entitlement-required".to_string(),
        };
        return AppError::SyncEntitlementRequired { code };
    }

    if status == reqwest::StatusCode::PAYLOAD_TOO_LARGE {
        let (used_bytes, limit_bytes) = match response.json::<serde_json::Value>().await {
            Ok(val) => {
                let used = val
                    .get("usedBytes")
                    .and_then(|v| {
                        v.as_u64()
                            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                    })
                    .unwrap_or(0);
                let limit = val
                    .get("limitBytes")
                    .and_then(|v| {
                        v.as_u64()
                            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                    })
                    .unwrap_or(0);
                (used, limit)
            }
            Err(_) => (0, 0),
        };
        return AppError::SyncQuotaExceeded {
            used_bytes,
            limit_bytes,
        };
    }

    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let retry_after_secs = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|val| val.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(60);
        return AppError::SyncRateLimited { retry_after_secs };
    }

    if status == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
        let detail = response.text().await.unwrap_or_default();
        let message = if detail.is_empty() {
            format!("Server rejected {op}: 422")
        } else {
            format!("Server rejected {op} (422): {detail}")
        };
        return AppError::Validation(message);
    }

    if status.is_server_error() {
        let detail = response.text().await.unwrap_or_default();
        let message = if detail.is_empty() {
            format!("{op} server unavailable ({status})")
        } else {
            format!("{op} server unavailable ({status}): {detail}")
        };
        return AppError::SyncServerUnavailable(message);
    }

    AppError::Other(format!("{op} failed: {status}"))
}

impl ApiClient {
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
        if status == reqwest::StatusCode::CONFLICT {
            return Err(AppError::SyncE2eeAlreadyEnrolled);
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
        if status == reqwest::StatusCode::CONFLICT {
            return Err(AppError::SyncE2eeWrongMode(
                "PUT /api/sync/e2ee/state is only allowed for passphrase mode".to_string(),
            ));
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

    /// POST /api/feedback — submit user feedback or a crash report.
    ///
    /// The bearer token is attached only when the user is signed in (`token`
    /// is `Some`); anonymous submissions are accepted by the server too.
    ///
    /// # Errors
    /// - Network / serde failures propagate via `?` as `AppError::Network`.
    /// - Non-2xx responses return `AppError::Other` with the status code.
    pub async fn submit_feedback(
        &self,
        report: &crate::feedback::FeedbackReport,
        token: Option<&str>,
    ) -> Result<(), AppError> {
        let mut req = self
            .client
            .post(format!("{}/api/feedback", self.base_url))
            .json(report);
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        let response = req.send().await?;
        if !response.status().is_success() {
            return Err(AppError::Other(format!(
                "feedback submit failed: {}",
                response.status()
            )));
        }
        Ok(())
    }

    /// POST /api/usage — anonymous aggregate usage ping. No bearer token.
    ///
    /// # Errors
    /// - Network / serde failures propagate via `?` as `AppError::Network`.
    /// - Non-2xx responses return `AppError::Other` with the status code.
    pub async fn submit_usage_ping(
        &self,
        payload: &crate::usage::sender::UsagePingPayload,
    ) -> Result<(), AppError> {
        let response = self
            .client
            .post(format!("{}/api/usage", self.base_url))
            .json(payload)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(AppError::Other(format!(
                "usage ping failed: {}",
                response.status()
            )));
        }
        Ok(())
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
        if status == reqwest::StatusCode::CONFLICT {
            return Err(AppError::SyncE2eeWrongMode(
                "disable-not-allowed: device-key E2EE cannot be disabled".to_string(),
            ));
        }
        if !matches!(status.as_u16(), 200 | 204) {
            return Err(AppError::Other(format!(
                "DELETE /api/sync/e2ee/state status {status}"
            )));
        }
        Ok(())
    }

    /// POST /api/sync/e2ee/state — enrol in device-key mode.
    pub async fn post_e2ee_device_key(
        &self,
        token: &str,
        kcv: &str,
    ) -> Result<crate::sync::types::E2eeStateResponse, AppError> {
        let url = format!("{}/api/sync/e2ee/state", self.base_url);
        let payload = crate::sync::types::E2eeStatePayload::device_key(kcv.to_string());
        let response = self
            .client
            .post(&url)
            .bearer_auth(token)
            .json(&payload)
            .send()
            .await?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("Token expired or invalid".to_string()));
        }
        if status == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::SyncEntitlementRequired {
                code: "sync.entitlement-required".into(),
            });
        }
        if status == reqwest::StatusCode::CONFLICT {
            return Err(AppError::SyncE2eeAlreadyEnrolled);
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

    /// POST /api/sync/e2ee/finalize — drop pre-enrolment plaintext rows.
    pub async fn finalize_e2ee(
        &self,
        token: &str,
        pulled_through_version: i64,
    ) -> Result<crate::sync::types::FinalizeResponse, AppError> {
        let url = format!("{}/api/sync/e2ee/finalize", self.base_url);
        let req = crate::sync::types::FinalizeRequest {
            pulled_through_version,
        };
        let response = self
            .client
            .post(&url)
            .bearer_auth(token)
            .json(&req)
            .send()
            .await?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("Token expired or invalid".to_string()));
        }
        if status == reqwest::StatusCode::FORBIDDEN {
            return Err(AppError::SyncEntitlementRequired {
                code: "sync.entitlement-required".into(),
            });
        }
        if status == reqwest::StatusCode::CONFLICT {
            #[derive(serde::Deserialize)]
            struct ConflictBody {
                #[serde(rename = "plaintextMaxVersion", default)]
                plaintext_max_version: i64,
            }
            let body = response.json::<ConflictBody>().await.ok();
            let pt_max = body.map(|b| b.plaintext_max_version).unwrap_or(0);
            return Err(AppError::SyncFinalizeBehind {
                plaintext_max_version: pt_max,
            });
        }
        if !status.is_success() {
            return Err(AppError::Other(format!(
                "POST /api/sync/e2ee/finalize status {status}"
            )));
        }
        Ok(response
            .json::<crate::sync::types::FinalizeResponse>()
            .await?)
    }

    /// POST /api/sync/reset — wipe items, sync state, e2ee state, and pairings on server.
    pub async fn reset_sync(
        &self,
        token: &str,
    ) -> Result<crate::sync::types::ResetResponse, AppError> {
        let url = format!("{}/api/sync/reset", self.base_url);
        let response = self.client.post(&url).bearer_auth(token).send().await?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("Token expired or invalid".to_string()));
        }
        if !status.is_success() {
            return Err(AppError::Other(format!(
                "POST /api/sync/reset status {status}"
            )));
        }
        Ok(response.json::<crate::sync::types::ResetResponse>().await?)
    }

    /// POST /api/sync/e2ee/pairings — initiate device pairing request.
    pub async fn create_pairing(
        &self,
        token: &str,
        device_name: &str,
        device_public_key: &str,
    ) -> Result<crate::sync::types::PairingCreateResponse, AppError> {
        let url = format!("{}/api/sync/e2ee/pairings", self.base_url);
        let req = crate::sync::types::PairingCreateRequest {
            device_name: device_name.to_string(),
            device_public_key: device_public_key.to_string(),
        };
        let response = self
            .client
            .post(&url)
            .bearer_auth(token)
            .json(&req)
            .send()
            .await?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("Token expired or invalid".to_string()));
        }
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::SyncE2eeNotEnrolled);
        }
        if status == reqwest::StatusCode::CONFLICT {
            #[derive(serde::Deserialize)]
            struct ErrBody {
                #[serde(default)]
                code: String,
            }
            let code = response
                .json::<ErrBody>()
                .await
                .map(|b| b.code)
                .unwrap_or_default();
            if code == "sync.pairing.too-many" {
                return Err(AppError::SyncPairingTooMany);
            }
            if code == "sync.e2ee.wrong-mode" {
                return Err(AppError::SyncE2eeWrongMode(
                    "account is not in device-key mode".into(),
                ));
            }
            return Err(AppError::Other(format!("create pairing conflict: {code}")));
        }
        if !status.is_success() {
            return Err(AppError::Other(format!(
                "POST /api/sync/e2ee/pairings status {status}"
            )));
        }
        Ok(response
            .json::<crate::sync::types::PairingCreateResponse>()
            .await?)
    }

    /// GET /api/sync/e2ee/pairings — list pending pairing requests.
    pub async fn list_pairings(
        &self,
        token: &str,
    ) -> Result<Vec<crate::sync::types::PairingPendingItem>, AppError> {
        let url = format!("{}/api/sync/e2ee/pairings", self.base_url);
        let response = self.client.get(&url).bearer_auth(token).send().await?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("Token expired or invalid".to_string()));
        }
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::SyncE2eeNotEnrolled);
        }
        if status == reqwest::StatusCode::CONFLICT {
            return Err(AppError::SyncE2eeWrongMode(
                "account is not in device-key mode".into(),
            ));
        }
        if !status.is_success() {
            return Err(AppError::Other(format!(
                "GET /api/sync/e2ee/pairings status {status}"
            )));
        }
        Ok(response
            .json::<Vec<crate::sync::types::PairingPendingItem>>()
            .await?)
    }

    /// GET /api/sync/e2ee/pairings/{id} — poll pairing status.
    pub async fn poll_pairing(
        &self,
        token: &str,
        id: &str,
    ) -> Result<crate::sync::types::PairingPollResponse, AppError> {
        let url = format!("{}/api/sync/e2ee/pairings/{}", self.base_url, id);
        let response = self.client.get(&url).bearer_auth(token).send().await?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("Token expired or invalid".to_string()));
        }
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::SyncPairingNotFound);
        }
        if status == reqwest::StatusCode::CONFLICT {
            return Err(AppError::SyncE2eeWrongMode(
                "account is not in device-key mode".into(),
            ));
        }
        if !status.is_success() {
            return Err(AppError::Other(format!(
                "GET /api/sync/e2ee/pairings/{} status {status}",
                id
            )));
        }
        Ok(response
            .json::<crate::sync::types::PairingPollResponse>()
            .await?)
    }

    /// POST /api/sync/e2ee/pairings/{id}/approve — approve pairing request.
    pub async fn approve_pairing(
        &self,
        token: &str,
        id: &str,
        sealed_seed: &str,
        approver_public_key: &str,
    ) -> Result<(), AppError> {
        let url = format!("{}/api/sync/e2ee/pairings/{}/approve", self.base_url, id);
        let req = crate::sync::types::PairingApproveRequest {
            sealed_seed: sealed_seed.to_string(),
            approver_public_key: approver_public_key.to_string(),
        };
        let response = self
            .client
            .post(&url)
            .bearer_auth(token)
            .json(&req)
            .send()
            .await?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("Token expired or invalid".to_string()));
        }
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::SyncPairingNotFound);
        }
        if status == reqwest::StatusCode::CONFLICT {
            #[derive(serde::Deserialize)]
            struct ErrBody {
                #[serde(default)]
                code: String,
                #[serde(default)]
                status: Option<String>,
            }
            let body = response.json::<ErrBody>().await.ok();
            let code = body.as_ref().map(|b| b.code.as_str()).unwrap_or("");
            if code == "sync.pairing.not-pending" {
                let st = body
                    .and_then(|b| b.status)
                    .unwrap_or_else(|| "unknown".into());
                return Err(AppError::SyncPairingNotPending { status: st });
            }
            if code == "sync.e2ee.wrong-mode" {
                return Err(AppError::SyncE2eeWrongMode(
                    "account is not in device-key mode".into(),
                ));
            }
            return Err(AppError::Other(format!("approve pairing conflict: {code}")));
        }
        if !status.is_success() {
            return Err(AppError::Other(format!(
                "POST /api/sync/e2ee/pairings/{}/approve status {status}",
                id
            )));
        }
        Ok(())
    }

    /// DELETE /api/sync/e2ee/pairings/{id} — cancel pairing request.
    pub async fn cancel_pairing(&self, token: &str, id: &str) -> Result<(), AppError> {
        let url = format!("{}/api/sync/e2ee/pairings/{}", self.base_url, id);
        let response = self.client.delete(&url).bearer_auth(token).send().await?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AppError::Auth("Token expired or invalid".to_string()));
        }
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::SyncPairingNotFound);
        }
        if !matches!(status.as_u16(), 200 | 204) {
            return Err(AppError::Other(format!(
                "DELETE /api/sync/e2ee/pairings/{} status {status}",
                id
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
        assert!(matches!(result, Err(AppError::SyncServerUnavailable(_))));
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
    async fn push_items_batch_handles_403_with_entitlement_required_code() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/items")
            .with_status(403)
            .with_header("Content-Type", "application/json")
            .with_body(r#"{"code":"sync.entitlement-required"}"#)
            .create_async()
            .await;

        let request = ItemPushBatchRequest {
            device_id: "device-1".to_string(),
            key_version: None,
            items: vec![],
        };

        let result = client.push_items_batch("my-token", &request).await;
        match result {
            Err(AppError::SyncEntitlementRequired { code }) => {
                assert_eq!(code, "sync.entitlement-required");
            }
            other => panic!("expected AppError::SyncEntitlementRequired, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn push_items_batch_handles_403_with_ai_entitlement_required_code() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/items")
            .with_status(403)
            .with_header("Content-Type", "application/json")
            .with_body(r#"{"code":"sync.ai-entitlement-required"}"#)
            .create_async()
            .await;

        let request = ItemPushBatchRequest {
            device_id: "device-1".to_string(),
            key_version: None,
            items: vec![],
        };

        let result = client.push_items_batch("my-token", &request).await;
        match result {
            Err(AppError::SyncEntitlementRequired { code }) => {
                assert_eq!(code, "sync.ai-entitlement-required");
            }
            other => panic!("expected AppError::SyncEntitlementRequired, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn push_items_batch_handles_403_older_server_without_code() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/items")
            .with_status(403)
            .with_body("Forbidden")
            .create_async()
            .await;

        let request = ItemPushBatchRequest {
            device_id: "device-1".to_string(),
            key_version: None,
            items: vec![],
        };

        let result = client.push_items_batch("my-token", &request).await;
        match result {
            Err(AppError::SyncEntitlementRequired { code }) => {
                assert_eq!(code, "sync.entitlement-required");
            }
            other => panic!("expected AppError::SyncEntitlementRequired fallback, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn push_items_batch_handles_413_quota_exceeded() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/items")
            .with_status(413)
            .with_header("Content-Type", "application/json")
            .with_body(
                r#"{"code":"sync.quota-exceeded","usedBytes":10485760,"limitBytes":5242880}"#,
            )
            .create_async()
            .await;

        let request = ItemPushBatchRequest {
            device_id: "device-1".to_string(),
            key_version: None,
            items: vec![],
        };

        let result = client.push_items_batch("my-token", &request).await;
        match result {
            Err(AppError::SyncQuotaExceeded {
                used_bytes,
                limit_bytes,
            }) => {
                assert_eq!(used_bytes, 10485760);
                assert_eq!(limit_bytes, 5242880);
            }
            other => panic!("expected AppError::SyncQuotaExceeded, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn push_items_batch_handles_413_without_numbers() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/items")
            .with_status(413)
            .create_async()
            .await;

        let request = ItemPushBatchRequest {
            device_id: "device-1".to_string(),
            key_version: None,
            items: vec![],
        };

        let result = client.push_items_batch("my-token", &request).await;
        match result {
            Err(AppError::SyncQuotaExceeded {
                used_bytes,
                limit_bytes,
            }) => {
                assert_eq!(used_bytes, 0);
                assert_eq!(limit_bytes, 0);
            }
            other => panic!("expected AppError::SyncQuotaExceeded, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn push_items_batch_handles_429_with_retry_after() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/items")
            .with_status(429)
            .with_header("Retry-After", "120")
            .create_async()
            .await;

        let request = ItemPushBatchRequest {
            device_id: "device-1".to_string(),
            key_version: None,
            items: vec![],
        };

        let result = client.push_items_batch("my-token", &request).await;
        match result {
            Err(AppError::SyncRateLimited { retry_after_secs }) => {
                assert_eq!(retry_after_secs, 120);
            }
            other => panic!("expected AppError::SyncRateLimited(120), got {other:?}"),
        }
    }

    #[tokio::test]
    async fn push_items_batch_handles_429_without_retry_after_defaults_to_60() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/items")
            .with_status(429)
            .create_async()
            .await;

        let request = ItemPushBatchRequest {
            device_id: "device-1".to_string(),
            key_version: None,
            items: vec![],
        };

        let result = client.push_items_batch("my-token", &request).await;
        match result {
            Err(AppError::SyncRateLimited { retry_after_secs }) => {
                assert_eq!(retry_after_secs, 60);
            }
            other => panic!("expected AppError::SyncRateLimited(60), got {other:?}"),
        }
    }

    #[tokio::test]
    async fn push_items_batch_handles_429_with_invalid_retry_after_defaults_to_60() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/sync/items")
            .with_status(429)
            .with_header("Retry-After", "not-a-number")
            .create_async()
            .await;

        let request = ItemPushBatchRequest {
            device_id: "device-1".to_string(),
            key_version: None,
            items: vec![],
        };

        let result = client.push_items_batch("my-token", &request).await;
        match result {
            Err(AppError::SyncRateLimited { retry_after_secs }) => {
                assert_eq!(retry_after_secs, 60);
            }
            other => panic!("expected AppError::SyncRateLimited(60), got {other:?}"),
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

    // ── submit_feedback ──────────────────────────────────────────────────────

    fn sample_report() -> crate::feedback::FeedbackReport {
        crate::feedback::FeedbackReport {
            kind: "feedback".to_string(),
            category: Some("idea".to_string()),
            message: Some("great app".to_string()),
            email: Some("me@example.com".to_string()),
            payload: None,
            app_version: "1.2.3".to_string(),
            platform: "macos-aarch64".to_string(),
        }
    }

    #[tokio::test]
    async fn submit_feedback_attaches_bearer_token_when_present() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/feedback")
            .match_header("Authorization", "Bearer tok")
            .with_status(200)
            .create_async()
            .await;

        let report = sample_report();
        let result = client.submit_feedback(&report, Some("tok")).await;
        assert!(result.is_ok(), "expected Ok, got {result:?}");
    }

    #[tokio::test]
    async fn submit_feedback_sends_no_auth_header_when_token_absent() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/feedback")
            .match_header("Authorization", mockito::Matcher::Missing)
            .with_status(200)
            .create_async()
            .await;

        let report = sample_report();
        let result = client.submit_feedback(&report, None).await;
        assert!(result.is_ok(), "expected Ok, got {result:?}");
    }

    #[tokio::test]
    async fn submit_feedback_rejects_500_response_as_other_error() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/feedback")
            .with_status(500)
            .create_async()
            .await;

        let report = sample_report();
        let result = client.submit_feedback(&report, Some("tok")).await;
        assert!(matches!(result, Err(AppError::Other(_))));
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
            .with_header("Content-Type", "application/json")
            .with_body(r#"{"code":"sync.entitlement-required"}"#)
            .create_async()
            .await;

        let result = client.pull_items_since("my-token", 0, 100).await;
        match result {
            Err(AppError::SyncEntitlementRequired { code }) => {
                assert_eq!(code, "sync.entitlement-required");
            }
            other => panic!("expected AppError::SyncEntitlementRequired, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn pull_items_since_handles_429_by_returning_rate_limited() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("GET", "/api/sync/items")
            .match_query(mockito::Matcher::Any)
            .with_status(429)
            .with_header("Retry-After", "90")
            .create_async()
            .await;

        let result = client.pull_items_since("my-token", 0, 100).await;
        match result {
            Err(AppError::SyncRateLimited { retry_after_secs }) => {
                assert_eq!(retry_after_secs, 90);
            }
            other => panic!("expected AppError::SyncRateLimited, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn pull_items_since_handles_503_by_returning_server_unavailable() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("GET", "/api/sync/items")
            .match_query(mockito::Matcher::Any)
            .with_status(503)
            .create_async()
            .await;

        let result = client.pull_items_since("my-token", 0, 100).await;
        assert!(matches!(result, Err(AppError::SyncServerUnavailable(_))));
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
            let payload = E2eeStatePayload::passphrase(
                "enc:v1:abc".into(),
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".into(),
                "argon2id".into(),
                65536,
                3,
                1,
            );
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
            let payload = E2eeStatePayload::passphrase(
                "enc:v1:rotated".into(),
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".into(),
                "argon2id".into(),
                65536,
                3,
                1,
            );
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

    // ── submit_usage_ping ────────────────────────────────────────────────────

    fn sample_usage_payload() -> crate::usage::sender::UsagePingPayload {
        let mut launches = std::collections::HashMap::new();
        launches.insert("org.asyar.calculator".to_string(), 12u32);
        crate::usage::sender::UsagePingPayload {
            anon_id: "anon-abc".into(),
            period: "2026-06-15".into(),
            app_version: "0.1.0".into(),
            platform: "macos-aarch64".into(),
            active: true,
            launches,
        }
    }

    #[tokio::test]
    async fn submit_usage_ping_posts_expected_json() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/usage")
            .match_header("Content-Type", "application/json")
            .match_body(mockito::Matcher::Json(serde_json::json!({
                "anon_id": "anon-abc",
                "period": "2026-06-15",
                "app_version": "0.1.0",
                "platform": "macos-aarch64",
                "active": true,
                "launches": { "org.asyar.calculator": 12 }
            })))
            .with_status(201)
            .create_async()
            .await;

        let result = client.submit_usage_ping(&sample_usage_payload()).await;
        assert!(result.is_ok(), "expected Ok, got {result:?}");
    }

    #[tokio::test]
    async fn submit_usage_ping_rejects_500_response() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        let _m = server
            .mock("POST", "/api/usage")
            .with_status(500)
            .create_async()
            .await;

        let result = client.submit_usage_ping(&sample_usage_payload()).await;
        assert!(matches!(result, Err(AppError::Other(_))));
    }

    #[test]
    fn usage_ping_payload_serializes_expected_shape() {
        let mut launches = std::collections::HashMap::new();
        launches.insert("org.asyar.calculator".to_string(), 12u32);
        let p = crate::usage::sender::UsagePingPayload {
            anon_id: "abc".into(),
            period: "2026-06-15".into(),
            app_version: "0.1.0".into(),
            platform: "macos-aarch64".into(),
            active: true,
            launches,
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["anon_id"], "abc");
        assert_eq!(json["period"], "2026-06-15");
        assert_eq!(json["active"], true);
        assert_eq!(json["launches"]["org.asyar.calculator"], 12);
    }

    // ── E2EE device-key, pairing, finalize, and reset API tests ──────────

    #[tokio::test]
    async fn post_e2ee_device_key_201_success() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/api/sync/e2ee/state")
            .match_header("authorization", "Bearer tok")
            .match_header("content-type", "application/json")
            .match_body(mockito::Matcher::Json(serde_json::json!({
                "mode": "device-key",
                "kcv": "AAAA"
            })))
            .with_status(201)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "mode": "device-key",
                    "kcv": "AAAA",
                    "keyVersion": 1,
                    "enrolledAt": "2026-11-01T12:00:00Z",
                    "plaintextRows": 0
                })
                .to_string(),
            )
            .create_async()
            .await;

        let client = ApiClient::with_base(server.url());
        let resp = client.post_e2ee_device_key("tok", "AAAA").await.unwrap();
        assert_eq!(resp.mode.as_deref(), Some("device-key"));
        assert_eq!(resp.key_version, 1);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn post_e2ee_device_key_409_already_enrolled() {
        let mut server = Server::new_async().await;
        let _m = server
            .mock("POST", "/api/sync/e2ee/state")
            .with_status(409)
            .with_body(r#"{"code":"sync.e2ee.already-enrolled"}"#)
            .create_async()
            .await;

        let client = ApiClient::with_base(server.url());
        let err = client
            .post_e2ee_device_key("tok", "AAAA")
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::SyncE2eeAlreadyEnrolled));
    }

    #[tokio::test]
    async fn finalize_e2ee_200_and_409() {
        let mut server = Server::new_async().await;
        let mock_200 = server
            .mock("POST", "/api/sync/e2ee/finalize")
            .match_header("authorization", "Bearer tok")
            .match_body(mockito::Matcher::Json(serde_json::json!({
                "pulledThroughVersion": 42
            })))
            .with_status(200)
            .with_body(r#"{"deletedRows": 15}"#)
            .create_async()
            .await;

        let client = ApiClient::with_base(server.url());
        let resp = client.finalize_e2ee("tok", 42).await.unwrap();
        assert_eq!(resp.deleted_rows, 15);
        mock_200.assert_async().await;

        let _m_409 = server
            .mock("POST", "/api/sync/e2ee/finalize")
            .with_status(409)
            .with_body(r#"{"code":"sync.e2ee.finalize-behind","plaintextMaxVersion":99}"#)
            .create_async()
            .await;

        let err = client.finalize_e2ee("tok", 10).await.unwrap_err();
        match err {
            AppError::SyncFinalizeBehind {
                plaintext_max_version,
            } => {
                assert_eq!(plaintext_max_version, 99);
            }
            other => panic!("expected SyncFinalizeBehind, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn reset_sync_200_success() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/api/sync/reset")
            .match_header("authorization", "Bearer tok")
            .with_status(200)
            .with_body(r#"{"deleted":{"items":42}}"#)
            .create_async()
            .await;

        let client = ApiClient::with_base(server.url());
        let resp = client.reset_sync("tok").await.unwrap();
        assert_eq!(resp.deleted.items, 42);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn pairings_api_lifecycle() {
        let mut server = Server::new_async().await;
        let client = ApiClient::with_base(server.url());

        // 1. Create pairing
        let mock_create = server
            .mock("POST", "/api/sync/e2ee/pairings")
            .match_header("authorization", "Bearer tok")
            .match_body(mockito::Matcher::Json(serde_json::json!({
                "deviceName": "MacBook Air",
                "devicePublicKey": "pubkey-b64"
            })))
            .with_status(201)
            .with_body(r#"{"id":"pair-123","expiresAt":"2026-11-01T13:00:00Z"}"#)
            .create_async()
            .await;

        let create_resp = client
            .create_pairing("tok", "MacBook Air", "pubkey-b64")
            .await
            .unwrap();
        assert_eq!(create_resp.id, "pair-123");
        assert_eq!(create_resp.expires_at, "2026-11-01T13:00:00Z");
        mock_create.assert_async().await;

        // 2. List pairings
        let mock_list = server
            .mock("GET", "/api/sync/e2ee/pairings")
            .match_header("authorization", "Bearer tok")
            .with_status(200)
            .with_body(r#"[{"id":"pair-123","deviceName":"MacBook Air","devicePublicKey":"pubkey-b64","createdAt":"2026-11-01T12:00:00Z","expiresAt":"2026-11-01T13:00:00Z"}]"#)
            .create_async()
            .await;

        let list_resp = client.list_pairings("tok").await.unwrap();
        assert_eq!(list_resp.len(), 1);
        assert_eq!(list_resp[0].id, "pair-123");
        mock_list.assert_async().await;

        // 3. Poll pairing (pending, then approved)
        let mock_poll_pending = server
            .mock("GET", "/api/sync/e2ee/pairings/pair-123")
            .with_status(200)
            .with_body(r#"{"status":"pending"}"#)
            .create_async()
            .await;

        let poll_pending = client.poll_pairing("tok", "pair-123").await.unwrap();
        assert_eq!(poll_pending.status, "pending");
        mock_poll_pending.assert_async().await;

        let mock_poll_approved = server
            .mock("GET", "/api/sync/e2ee/pairings/pair-123")
            .with_status(200)
            .with_body(r#"{"status":"approved","sealedSeed":"sealed-b64","approverPublicKey":"approver-pub-b64"}"#)
            .create_async()
            .await;

        let poll_approved = client.poll_pairing("tok", "pair-123").await.unwrap();
        assert_eq!(poll_approved.status, "approved");
        assert_eq!(poll_approved.sealed_seed.as_deref(), Some("sealed-b64"));
        assert_eq!(
            poll_approved.approver_public_key.as_deref(),
            Some("approver-pub-b64")
        );
        mock_poll_approved.assert_async().await;

        // 4. Approve pairing
        let mock_approve = server
            .mock("POST", "/api/sync/e2ee/pairings/pair-123/approve")
            .match_header("authorization", "Bearer tok")
            .match_body(mockito::Matcher::Json(serde_json::json!({
                "sealedSeed": "sealed-b64",
                "approverPublicKey": "approver-pub-b64"
            })))
            .with_status(200)
            .create_async()
            .await;

        let approve_res = client
            .approve_pairing("tok", "pair-123", "sealed-b64", "approver-pub-b64")
            .await;
        assert!(approve_res.is_ok());
        mock_approve.assert_async().await;

        // 5. Cancel pairing
        let mock_cancel = server
            .mock("DELETE", "/api/sync/e2ee/pairings/pair-123")
            .match_header("authorization", "Bearer tok")
            .with_status(204)
            .create_async()
            .await;

        let cancel_res = client.cancel_pairing("tok", "pair-123").await;
        assert!(cancel_res.is_ok());
        mock_cancel.assert_async().await;
    }

    #[tokio::test]
    async fn delete_e2ee_state_409_device_key_disable_not_allowed() {
        let mut server = Server::new_async().await;
        let _m = server
            .mock("DELETE", "/api/sync/e2ee/state")
            .with_status(409)
            .with_body(r#"{"code":"sync.e2ee.disable-not-allowed"}"#)
            .create_async()
            .await;

        let client = ApiClient::with_base(server.url());
        let err = client.delete_e2ee_state("tok").await.unwrap_err();
        assert!(matches!(err, AppError::SyncE2eeWrongMode(_)));
    }
}
