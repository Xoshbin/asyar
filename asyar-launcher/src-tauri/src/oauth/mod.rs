pub mod pkce;
pub mod service;
pub mod token_store;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

/// In-memory store for pending PKCE flows, keyed by the opaque `state` parameter.
/// Cleared when the deep-link callback arrives (success or error).
pub struct OAuthPendingFlowState {
    pub flows: Mutex<HashMap<String, PendingOAuthFlow>>,
}

/// Data held server-side while the user is authorizing in the browser.
pub struct PendingOAuthFlow {
    pub extension_id: String,
    pub flow_id: String,
    pub provider_id: String,
    /// PKCE code verifier — never leaves Rust memory.
    pub code_verifier: String,
    pub token_url: String,
    pub client_id: String,
}

/// An OAuth 2.0 token set returned to the extension after a successful flow.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: String,
    pub scopes: Vec<String>,
    /// Unix timestamp (seconds). `None` means the token has no expiry.
    pub expires_at: Option<i64>,
}

/// Returned from `oauth_start_flow` — the auth URL to open in the browser.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStartResponse {
    pub state: String,
    pub auth_url: String,
}

/// Returned from `oauth_exchange_code` — carries the resolved token back to TS
/// so it can route the result to the correct extension iframe.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthExchangeResponse {
    pub extension_id: String,
    pub flow_id: String,
    pub token: OAuthToken,
}

impl OAuthPendingFlowState {
    pub fn new() -> Self {
        Self {
            flows: Mutex::new(HashMap::new()),
        }
    }

    pub fn insert(&self, state: String, flow: PendingOAuthFlow) {
        if let Ok(mut guard) = self.flows.lock() {
            guard.insert(state, flow);
        }
    }

    /// Remove and return a pending flow by state. Returns `None` if not found.
    pub fn remove(&self, state: &str) -> Option<PendingOAuthFlow> {
        self.flows.lock().ok()?.remove(state)
    }
}
