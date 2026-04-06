use serde::Serialize;
use std::sync::Mutex;

#[derive(Debug, Default)]
pub struct AuthState {
    pub token: Mutex<Option<String>>,
    pub user: Mutex<Option<AuthUser>>,
    pub entitlements: Mutex<Vec<String>>,
    /// Unix timestamp (seconds) when entitlements were last fetched from backend.
    pub entitlements_cached_at: Mutex<Option<i64>>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    pub id: u64,
    pub name: String,
    pub email: String,
    pub avatar_url: Option<String>,
}

/// Serializable snapshot of auth state for the Tauri command response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStateResponse {
    pub is_logged_in: bool,
    pub user: Option<AuthUser>,
    pub entitlements: Vec<String>,
    pub entitlements_cached_at: Option<i64>,
}
