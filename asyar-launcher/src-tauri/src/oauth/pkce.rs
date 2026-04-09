use base64::Engine;
use crate::error::AppError;
use rand::Rng;
use sha2::{Digest, Sha256};

/// Generate a random PKCE code verifier (43–128 URL-safe base64 chars, no padding).
pub fn generate_code_verifier() -> String {
    let bytes: Vec<u8> = (0..32).map(|_| rand::thread_rng().gen()).collect();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&bytes)
}

/// Derive the PKCE code challenge from a verifier using S256 method.
/// challenge = BASE64URL(SHA256(verifier))
pub fn generate_code_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hasher.finalize())
}

/// Generate a (verifier, challenge) pair in one step.
pub fn generate_pkce_pair() -> (String, String) {
    let verifier = generate_code_verifier();
    let challenge = generate_code_challenge(&verifier);
    (verifier, challenge)
}

/// Generate a random opaque state parameter for CSRF protection.
pub fn generate_state() -> String {
    let bytes: Vec<u8> = (0..16).map(|_| rand::thread_rng().gen()).collect();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&bytes)
}

/// Build the full authorization URL with PKCE + state query params.
///
/// Appends: client_id, response_type=code, redirect_uri, code_challenge,
/// code_challenge_method=S256, state, scope.
pub fn build_auth_url(
    authorization_url: &str,
    client_id: &str,
    code_challenge: &str,
    state: &str,
    scopes: &[String],
) -> Result<String, AppError> {
    let mut url = url::Url::parse(authorization_url)
        .map_err(|_| AppError::Validation("Invalid authorization URL".into()))?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", "asyar://oauth/callback")
        .append_pair("code_challenge", code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state)
        .append_pair("scope", &scopes.join(" "));
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifier_is_url_safe_base64_no_padding() {
        let v = generate_code_verifier();
        assert!(!v.contains('+'), "verifier must not contain '+'");
        assert!(!v.contains('/'), "verifier must not contain '/'");
        assert!(!v.contains('='), "verifier must not contain padding '='");
        assert!(!v.is_empty());
    }

    #[test]
    fn challenge_differs_from_verifier() {
        let v = generate_code_verifier();
        let c = generate_code_challenge(&v);
        assert_ne!(v, c);
        assert!(!c.is_empty());
    }

    #[test]
    fn challenge_is_deterministic() {
        let v = "test-verifier-value";
        let c1 = generate_code_challenge(v);
        let c2 = generate_code_challenge(v);
        assert_eq!(c1, c2);
    }

    #[test]
    fn two_verifiers_differ() {
        let v1 = generate_code_verifier();
        let v2 = generate_code_verifier();
        assert_ne!(v1, v2, "Random verifiers should differ");
    }

    #[test]
    fn two_states_differ() {
        let s1 = generate_state();
        let s2 = generate_state();
        assert_ne!(s1, s2, "Random states should differ");
    }

    #[test]
    fn pkce_pair_challenge_matches_verifier() {
        let (verifier, challenge) = generate_pkce_pair();
        let expected = generate_code_challenge(&verifier);
        assert_eq!(challenge, expected);
    }

    #[test]
    fn build_auth_url_contains_required_params() {
        let scopes = vec!["repo".to_string(), "read:user".to_string()];
        let url = build_auth_url(
            "https://github.com/login/oauth/authorize",
            "my-client-id",
            "abc123challenge",
            "xyz-state",
            &scopes,
        )
        .unwrap();

        assert!(url.contains("client_id=my-client-id"), "missing client_id");
        assert!(url.contains("response_type=code"), "missing response_type");
        assert!(
            url.contains("redirect_uri=asyar%3A%2F%2Foauth%2Fcallback"),
            "missing redirect_uri"
        );
        assert!(url.contains("code_challenge=abc123challenge"), "missing code_challenge");
        assert!(url.contains("code_challenge_method=S256"), "missing method");
        assert!(url.contains("state=xyz-state"), "missing state");
    }

    #[test]
    fn build_auth_url_invalid_base_url_returns_error() {
        let result = build_auth_url("not-a-url", "cid", "ch", "st", &[]);
        assert!(result.is_err());
    }
}
