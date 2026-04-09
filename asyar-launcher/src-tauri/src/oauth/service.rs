use crate::error::AppError;
use crate::oauth::{OAuthToken, PendingOAuthFlow};
use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};

// ── Token exchange types ──────────────────────────────────────────────────────

#[derive(Deserialize)]
pub(crate) struct TokenExchangeResponse {
    pub access_token: String,
    pub token_type: Option<String>,
    pub expires_in: Option<i64>,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub(crate) fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// Returns `true` when a token is expired or within the 60-second safety buffer.
/// Tokens with no `expires_at` never expire.
pub(crate) fn is_token_expired(token: &OAuthToken) -> bool {
    match token.expires_at {
        None => false,
        Some(exp) => now_secs() > exp - 60,
    }
}

/// Build an `OAuthToken` from a raw token-endpoint response.
/// `now` is the current Unix timestamp in seconds (injected for testability).
pub(crate) fn build_token_from_response(resp: TokenExchangeResponse, now: i64) -> OAuthToken {
    let expires_at = resp.expires_in.map(|secs| now + secs);
    let scopes = resp
        .scope
        .map(|s| s.split(' ').filter(|p| !p.is_empty()).map(String::from).collect())
        .unwrap_or_default();

    OAuthToken {
        access_token: resp.access_token,
        refresh_token: resp.refresh_token,
        token_type: resp.token_type.unwrap_or_else(|| "Bearer".to_string()),
        scopes,
        expires_at,
    }
}

// ── HTTP token exchange ───────────────────────────────────────────────────────

/// Perform the PKCE token exchange: POST the authorization code to the provider's
/// token endpoint and return the resulting `OAuthToken`.
pub(crate) async fn exchange_code_for_token(
    flow: &PendingOAuthFlow,
    code: &str,
) -> Result<OAuthToken, AppError> {
    let client = reqwest::Client::new();

    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", "asyar://oauth/callback"),
        ("client_id", &flow.client_id),
        ("code_verifier", &flow.code_verifier),
    ];

    let response = client
        .post(&flow.token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::OAuth(format!(
            "Token exchange failed ({}): {}",
            status, body
        )));
    }

    let resp: TokenExchangeResponse = response
        .json()
        .await
        .map_err(|e| AppError::OAuth(format!("Failed to parse token response: {e}")))?;

    Ok(build_token_from_response(resp, now_secs()))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_token(expires_at: Option<i64>) -> OAuthToken {
        OAuthToken {
            access_token: "tok".into(),
            refresh_token: None,
            token_type: "Bearer".into(),
            scopes: vec![],
            expires_at,
        }
    }

    // ── build_token_from_response ─────────────────────────────────────────────

    #[test]
    fn build_token_sets_expires_at_from_expires_in() {
        let resp = TokenExchangeResponse {
            access_token: "gho_abc".into(),
            token_type: Some("Bearer".into()),
            expires_in: Some(3600),
            refresh_token: None,
            scope: Some("repo read:user".into()),
        };
        let token = build_token_from_response(resp, 1_000_000);
        assert_eq!(token.expires_at, Some(1_003_600));
        assert_eq!(token.scopes, vec!["repo", "read:user"]);
        assert_eq!(token.token_type, "Bearer");
    }

    #[test]
    fn build_token_defaults_token_type_to_bearer_when_absent() {
        let resp = TokenExchangeResponse {
            access_token: "tok".into(),
            token_type: None,
            expires_in: None,
            refresh_token: None,
            scope: None,
        };
        let token = build_token_from_response(resp, 0);
        assert_eq!(token.token_type, "Bearer");
        assert_eq!(token.expires_at, None);
        assert!(token.scopes.is_empty());
    }

    #[test]
    fn build_token_filters_empty_scope_parts() {
        let resp = TokenExchangeResponse {
            access_token: "tok".into(),
            token_type: None,
            expires_in: None,
            refresh_token: None,
            scope: Some("repo  read:user".into()), // double space produces empty part
        };
        let token = build_token_from_response(resp, 0);
        assert!(token.scopes.iter().all(|s| !s.is_empty()));
        assert_eq!(token.scopes.len(), 2);
    }

    #[test]
    fn build_token_preserves_refresh_token() {
        let resp = TokenExchangeResponse {
            access_token: "acc".into(),
            token_type: None,
            expires_in: None,
            refresh_token: Some("ref".into()),
            scope: None,
        };
        let token = build_token_from_response(resp, 0);
        assert_eq!(token.refresh_token, Some("ref".into()));
    }

    // ── is_token_expired ──────────────────────────────────────────────────────

    #[test]
    fn is_token_expired_returns_false_when_no_expires_at() {
        assert!(!is_token_expired(&make_token(None)));
    }

    #[test]
    fn is_token_expired_returns_true_when_within_60s_buffer() {
        // Expires in 30 seconds — inside the 60s buffer
        let exp = now_secs() + 30;
        assert!(is_token_expired(&make_token(Some(exp))));
    }

    #[test]
    fn is_token_expired_returns_true_for_past_expiry() {
        let exp = now_secs() - 100;
        assert!(is_token_expired(&make_token(Some(exp))));
    }

    #[test]
    fn is_token_expired_returns_false_when_valid_outside_buffer() {
        // Expires in 2 minutes — comfortably outside the 60s buffer
        let exp = now_secs() + 120;
        assert!(!is_token_expired(&make_token(Some(exp))));
    }
}
