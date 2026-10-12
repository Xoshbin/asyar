use crate::error::AppError;
use url::{Host, Url};

fn invalid() -> AppError {
    AppError::Validation("Invalid secret target".into())
}

pub fn parse_secret_host(input: &str) -> Result<(String, u16), AppError> {
    if input.is_empty()
        || input.contains(['/', '\\', '@', '*', '?', '#', '[', ']'])
        || input.chars().any(char::is_whitespace)
    {
        return Err(invalid());
    }
    let (host, port) = match input.split_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().map_err(|_| invalid())?),
        None => (input, 443),
    };
    if port == 0 {
        return Err(invalid());
    }
    let host = host.trim_end_matches('.');
    match Host::parse(host).map_err(|_| invalid())? {
        Host::Domain(h)
            if !h.is_empty()
                && h.split('.').all(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && !label.starts_with('-')
                        && !label.ends_with('-')
                        && label
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                }) =>
        {
            Ok((h.to_lowercase(), port))
        }
        _ => Err(invalid()),
    }
}

#[derive(Debug)]
pub struct SecretTarget {
    pub host: String,
    pub port: u16,
    pub path: String,
}
impl SecretTarget {
    pub fn parse(input: &str) -> Result<Self, AppError> {
        let url = Url::parse(input).map_err(|_| invalid())?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || input.split_once("://").is_some_and(|(_, rest)| {
                rest.split(['/', '?', '#'])
                    .next()
                    .is_some_and(|authority| authority.contains('@'))
            })
        {
            return Err(invalid());
        }
        let (host, _) = parse_secret_host(url.host_str().ok_or_else(invalid)?)?;
        Ok(Self {
            host,
            port: url.port_or_known_default().ok_or_else(invalid)?,
            path: url.path().into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_exact_host_and_port() {
        assert_eq!(
            parse_secret_host("api.example.com").unwrap(),
            ("api.example.com".into(), 443)
        );
        assert_eq!(
            parse_secret_host("api.example.com:8443").unwrap(),
            ("api.example.com".into(), 8443)
        );
    }
    #[test]
    fn rejects_wildcard_ip_scheme_path_userinfo() {
        for h in [
            "*.example.com",
            "127.0.0.1",
            "[::1]",
            "::ffff:127.0.0.1",
            "https://example.com",
            "example.com/a",
            "u@example.com",
            "example.com?x",
            "example.com#x",
            "2130706433",
        ] {
            assert!(parse_secret_host(h).is_err(), "{h}");
        }
    }
    #[test]
    fn normalizes_uppercase_trailing_dot_and_idna() {
        assert_eq!(
            parse_secret_host("API.Example.COM.").unwrap().0,
            "api.example.com"
        );
        assert_eq!(
            parse_secret_host("bücher.example").unwrap().0,
            "xn--bcher-kva.example"
        );
    }
    #[test]
    fn secret_target_rejects_http_userinfo_ip_ipv6_mapped() {
        for u in [
            "http://example.com",
            "https://u@example.com",
            "https://127.0.0.1",
            "https://[::ffff:127.0.0.1]",
        ] {
            assert!(SecretTarget::parse(u).is_err());
        }
    }
    #[test]
    fn fragment_and_query_cannot_change_host() {
        assert_eq!(
            SecretTarget::parse("https://evil.com#api.example.com")
                .unwrap()
                .host,
            "evil.com"
        );
        assert_eq!(
            SecretTarget::parse("https://evil.com?api.example.com")
                .unwrap()
                .host,
            "evil.com"
        );
        assert!(SecretTarget::parse("https://api.example.com@evil.com").is_err());
    }
    #[test]
    fn unicode_homograph_host_does_not_match_ascii() {
        assert_ne!(
            SecretTarget::parse("https://аpi.example.com").unwrap().host,
            "api.example.com"
        );
    }
}
