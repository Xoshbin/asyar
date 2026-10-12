use super::SecretError;
use reqwest::header::HeaderValue;
use std::collections::HashMap;
use zeroize::Zeroizing;

pub const FORBIDDEN_REQUEST_HEADERS: &[&str] = &[
    "host",
    "connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "proxy-*",
    "forwarded",
    "x-forwarded-*",
    "via",
];
pub fn forbidden_header(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    FORBIDDEN_REQUEST_HEADERS.iter().any(|h| {
        h.strip_suffix('*')
            .map_or(name == *h, |prefix| name.starts_with(prefix))
    })
}
pub fn check_extension_headers(
    headers: &HashMap<String, String>,
    injected: &[&str],
) -> Result<(), SecretError> {
    for name in headers.keys() {
        if forbidden_header(name) || injected.iter().any(|h| name.eq_ignore_ascii_case(h)) {
            return Err(SecretError::HeaderDenied);
        }
    }
    Ok(())
}
pub fn validate_template(template: &str) -> Result<(), SecretError> {
    if template.matches("{secret}").count() != 1
        || !template.bytes().all(|b| (32..=126).contains(&b))
    {
        return Err(SecretError::InvalidDeclaration);
    }
    Ok(())
}
pub fn render_header(template: &str, secret: &str) -> Result<Zeroizing<String>, SecretError> {
    validate_template(template)?;
    if secret.len() < 8 || !secret.bytes().all(|b| (33..=126).contains(&b)) {
        return Err(SecretError::InvalidSecret);
    }
    Ok(Zeroizing::new(template.replace("{secret}", secret)))
}
pub fn sensitive_header(value: &str) -> Result<HeaderValue, SecretError> {
    let mut header = HeaderValue::from_str(value).map_err(|_| SecretError::InvalidSecret)?;
    header.set_sensitive(true);
    Ok(header)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_extension_header_colliding_with_injected_name_case_insensitive() {
        assert!(check_extension_headers(
            &std::collections::HashMap::from([("aUtHoRiZaTiOn".into(), "x".into())]),
            &["Authorization"]
        )
        .is_err());
    }
    #[test]
    fn rejects_host_and_hop_by_hop_and_forwarded_headers() {
        for h in [
            "Host",
            "connection",
            "te",
            "trailer",
            "transfer-encoding",
            "upgrade",
            "content-length",
            "proxy-authorization",
            "forwarded",
            "x-forwarded-host",
            "via",
        ] {
            assert!(check_extension_headers(
                &std::collections::HashMap::from([(h.into(), "x".into())]),
                &[]
            )
            .is_err());
        }
    }
    #[test]
    fn template_requires_exactly_one_placeholder() {
        for t in ["Bearer", "{secret}{secret}", "Bearer {secret}\r\n"] {
            assert!(render_header(t, "abcdefgh").is_err());
        }
        assert_eq!(
            &*render_header("Bearer {secret}", "abcdefgh").unwrap(),
            "Bearer abcdefgh"
        );
    }
    #[test]
    fn rejects_secret_with_crlf_or_too_short() {
        for s in ["short", "abcdef\r\ngh", "abcdefghé", "abcd efgh"] {
            assert!(render_header("{secret}", s).is_err());
        }
    }
    #[test]
    fn injected_header_value_is_marked_sensitive() {
        assert!(sensitive_header("Bearer abcdefgh").unwrap().is_sensitive());
    }
}
