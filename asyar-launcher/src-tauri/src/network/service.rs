//! Outbound HTTP fetch with SSRF guard. The Tauri command layer
//! (`commands::system::fetch_url`) is a thin wrapper that does
//! permission gating and delegates here for the actual request.

use crate::error::AppError;
use std::collections::HashMap;
use std::net::IpAddr;

/// Inputs for [`fetch`]. Mirrors the Tauri command parameters minus
/// the `tauri::State` registry handle, so this is callable from any
/// Rust caller (CLI, tests, future schedulers).
pub struct FetchRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
}

/// Evaluates whether an IP address belongs to loopback, private, link-local,
/// CGNAT, documentation, IPv4-mapped IPv6, or unspecified restricted network ranges.
pub fn is_restricted_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_unspecified()
                // Carrier-grade NAT (100.64.0.0/10)
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64)
                // Benchmarking (198.18.0.0/15)
                || (v4.octets()[0] == 198 && (v4.octets()[1] & 0xfe) == 18)
        }
        IpAddr::V6(v6) => {
            if let Some(ipv4) = v6.to_ipv4_mapped() {
                return is_restricted_ip(&IpAddr::V4(ipv4));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                // Link-local fe80::/10
                || (v6.segments()[0] & 0xffc0) == 0xfe80
                // Unique local fc00::/7
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                // Documentation 2001:db8::/32
                || (v6.segments()[0] == 0x2001 && v6.segments()[1] == 0x0db8)
        }
    }
}

/// Validates an HTTP/HTTPS URL to prevent SSRF attacks.
/// Blocks non-http(s) schemes, localhost, loopback, and private IP ranges.
pub fn validate_url_for_ssrf(url: &str) -> Result<(), AppError> {
    use url::Url;

    let parsed = Url::parse(url).map_err(|_| AppError::Other(format!("Invalid URL: {}", url)))?;

    match parsed.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(AppError::Other(format!(
                "URL scheme '{}' is not allowed. Only http and https are permitted.",
                scheme
            )));
        }
    }

    // Strip an optional trailing dot — DNS resolvers treat `localhost.`
    // and `localhost` as the same FQDN, so the SSRF check has to too.
    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::Other("URL has no host".to_string()))?
        .trim_end_matches('.');

    if host.eq_ignore_ascii_case("localhost") {
        return Err(AppError::Other(
            "Requests to localhost are not allowed".to_string(),
        ));
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_restricted_ip(&ip) {
            return Err(AppError::Other(format!(
                "Requests to private or loopback address '{}' are not allowed",
                ip
            )));
        }
    }

    Ok(())
}

/// Performs an outbound HTTP request and returns a JSON envelope
/// `{ status, statusText, headers, body, ok }`. Does NOT enforce SSRF
/// rules — the trust boundary (the Tauri command) calls
/// [`validate_url_for_ssrf`] before delegating here.
pub async fn fetch(req: FetchRequest) -> Result<serde_json::Value, AppError> {
    use std::net::Ipv4Addr;

    let timeout = std::time::Duration::from_millis(req.timeout_ms.unwrap_or(20000));

    let client = reqwest::Client::builder()
        .local_address(IpAddr::V4(Ipv4Addr::UNSPECIFIED)) // force IPv4
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(timeout)
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")
        .build()?;

    let req_method = match req.method.as_deref().unwrap_or("GET") {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        _ => reqwest::Method::GET,
    };

    let mut http_req = client.request(req_method, &req.url);
    if let Some(hdrs) = req.headers {
        for (k, v) in hdrs {
            http_req = http_req.header(&k, &v);
        }
    }
    if let Some(b) = req.body {
        http_req = http_req.body(b);
    }

    let response = http_req.send().await?;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();
    let ok = response.status().is_success();

    let mut resp_headers = serde_json::Map::new();
    for (key, value) in response.headers().iter() {
        if let Ok(v) = value.to_str() {
            resp_headers.insert(
                key.as_str().to_string(),
                serde_json::Value::String(v.to_string()),
            );
        }
    }

    let body = response.text().await?;

    Ok(serde_json::json!({
        "status": status,
        "statusText": status_text,
        "headers": resp_headers,
        "body": body,
        "ok": ok,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    fn req(url: &str) -> FetchRequest {
        FetchRequest {
            url: url.to_string(),
            method: None,
            headers: None,
            body: None,
            timeout_ms: Some(5000),
        }
    }

    #[tokio::test]
    async fn forwards_request_body_to_server() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/items")
            .match_body(r#"{"name":"thing"}"#)
            .with_status(201)
            .with_body("created")
            .create_async()
            .await;

        let res = fetch(FetchRequest {
            url: format!("{}/items", server.url()),
            method: Some("POST".into()),
            headers: None,
            body: Some(r#"{"name":"thing"}"#.into()),
            timeout_ms: Some(5000),
        })
        .await
        .expect("fetch should succeed");

        mock.assert_async().await;
        assert_eq!(res["status"], 201);
        assert_eq!(res["body"], "created");
        assert_eq!(res["ok"], true);
    }

    #[tokio::test]
    async fn returns_response_envelope_on_get() {
        let mut server = Server::new_async().await;
        let _m = server
            .mock("GET", "/ping")
            .with_status(200)
            .with_header("content-type", "text/plain")
            .with_body("pong")
            .create_async()
            .await;

        let res = fetch(req(&format!("{}/ping", server.url())))
            .await
            .expect("fetch should succeed");

        assert_eq!(res["status"], 200);
        assert_eq!(res["body"], "pong");
        assert_eq!(res["ok"], true);
        assert_eq!(res["statusText"], "OK");
    }

    #[test]
    fn pure_is_restricted_ip_checks_all_address_classes() {
        // Loopback IPv4
        assert!(is_restricted_ip(&"127.0.0.1".parse().unwrap()));
        assert!(is_restricted_ip(&"127.0.0.2".parse().unwrap()));

        // Loopback IPv6
        assert!(is_restricted_ip(&"::1".parse().unwrap()));

        // Private IPv4
        assert!(is_restricted_ip(&"10.0.0.1".parse().unwrap()));
        assert!(is_restricted_ip(&"172.16.0.1".parse().unwrap()));
        assert!(is_restricted_ip(&"192.168.1.1".parse().unwrap()));

        // Link-local
        assert!(is_restricted_ip(&"169.254.169.254".parse().unwrap()));
        assert!(is_restricted_ip(&"fe80::1".parse().unwrap()));

        // CGNAT (100.64.0.0/10)
        assert!(is_restricted_ip(&"100.64.0.1".parse().unwrap()));

        // Documentation
        assert!(is_restricted_ip(&"192.0.2.1".parse().unwrap()));
        assert!(is_restricted_ip(&"2001:db8::1".parse().unwrap()));

        // IPv4-mapped IPv6 loopback and private
        assert!(is_restricted_ip(&"::ffff:127.0.0.1".parse().unwrap()));
        assert!(is_restricted_ip(&"::ffff:10.0.0.1".parse().unwrap()));
        assert!(is_restricted_ip(&"::ffff:192.168.1.1".parse().unwrap()));

        // Public addresses — allowed
        assert!(!is_restricted_ip(&"93.184.216.34".parse().unwrap()));
        assert!(!is_restricted_ip(
            &"2606:2800:220:1:248:1893:25c8:1946".parse().unwrap()
        ));
    }

    #[test]
    fn ssrf_blocks_localhost_by_name() {
        assert!(validate_url_for_ssrf("http://localhost/x").is_err());
    }

    #[test]
    fn ssrf_blocks_localhost_with_trailing_dot() {
        assert!(validate_url_for_ssrf("http://localhost./x").is_err());
    }

    #[test]
    fn ssrf_blocks_loopback_ipv4() {
        assert!(validate_url_for_ssrf("http://127.0.0.1/x").is_err());
    }

    #[test]
    fn ssrf_blocks_loopback_ipv4_with_trailing_dot() {
        assert!(validate_url_for_ssrf("http://127.0.0.1./x").is_err());
    }

    #[test]
    fn ssrf_blocks_private_ranges() {
        assert!(validate_url_for_ssrf("http://192.168.1.1/x").is_err());
        assert!(validate_url_for_ssrf("http://10.0.0.1/x").is_err());
    }

    #[test]
    fn ssrf_blocks_non_http_scheme() {
        assert!(validate_url_for_ssrf("file:///etc/passwd").is_err());
        assert!(validate_url_for_ssrf("ftp://example.com").is_err());
        assert!(validate_url_for_ssrf("ws://echo.websocket.org").is_err());
        assert!(validate_url_for_ssrf("wss://echo.websocket.org").is_err());
    }

    #[test]
    fn ssrf_allows_public_https() {
        assert!(validate_url_for_ssrf("https://example.com/api").is_ok());
    }
}
