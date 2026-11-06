//! Outbound HTTP fetch with SSRF guard. The Tauri command layer
//! (`commands::system::fetch_url`) is a thin wrapper that does
//! permission gating and delegates here for the actual request.

use crate::error::AppError;
use crate::network::client_pool::{ClientScope, Route, ScopedHttpClientPool};
use base64::Engine;
use std::collections::HashMap;
use std::net::IpAddr;
use url::Url;

/// Longest body `network.fetch` hands back to an extension. Binary bodies
/// travel base64-encoded inside a JSON envelope, so this also bounds the IPC
/// payload an extension can force the host to serialize.
pub const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;

/// Inputs for [`fetch`]. Mirrors the Tauri command parameters minus
/// the `tauri::State` registry handle, so this is callable from any
/// Rust caller (CLI, tests, future schedulers).
#[derive(Clone, Debug)]
pub struct FetchRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
}

fn plain_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if let Err(error) = validate_url_for_ssrf(attempt.url().as_str()) {
            attempt.error(error)
        } else if attempt.previous().len() >= 10 {
            attempt.error("Too many redirects")
        } else {
            attempt.follow()
        }
    })
}

/// Evaluates whether an IP address belongs to loopback, private, link-local,
/// multicast, CGNAT, documentation, IPv4-mapped IPv6, or unspecified restricted ranges.
pub fn is_restricted_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_multicast()
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
                || v6.is_multicast()
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
        .redirect(plain_redirect_policy())
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")
        .build()?;

    let req_method = match req.method.as_deref().unwrap_or("GET") {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
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

/// A binary response body, read through the same scoped path as extension
/// requests. `url` is the final URL after redirects.
#[derive(Debug)]
pub struct FetchedBytes {
    pub status: u16,
    pub content_type: Option<String>,
    pub bytes: Vec<u8>,
    pub url: String,
}

/// Fetches for an extension after resolving and pinning every destination.
/// Public destinations retain the existing `network` behavior. Restricted LAN
/// destinations additionally require a matching `network:lan` endpoint.
pub async fn fetch_scoped(
    req: FetchRequest,
    lan_policy: Option<&crate::network::lan_policy::LanPolicy>,
    caller_extension_id: Option<&str>,
    client_pool: &ScopedHttpClientPool,
) -> Result<serde_json::Value, AppError> {
    let response = send_scoped(req, false, lan_policy, caller_extension_id, client_pool).await?;
    response_envelope(response).await
}

/// Like [`fetch_scoped`], but returns the body as bytes and refuses anything
/// larger than `max_bytes`. Used for remote icons, which must never be handed
/// to an `<img>` as a live URL. When `require_https` is set, every hop
/// (including redirects) must stay on HTTPS, so a downgrade is rejected before
/// any plain-HTTP request is made.
pub async fn fetch_scoped_bytes(
    req: FetchRequest,
    max_bytes: usize,
    require_https: bool,
    lan_policy: Option<&crate::network::lan_policy::LanPolicy>,
    caller_extension_id: Option<&str>,
    client_pool: &ScopedHttpClientPool,
) -> Result<FetchedBytes, AppError> {
    let response = send_scoped(
        req,
        require_https,
        lan_policy,
        caller_extension_id,
        client_pool,
    )
    .await?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let url = response.url().to_string();
    let bytes = read_body_capped(response, max_bytes).await?;
    Ok(FetchedBytes {
        status,
        content_type,
        bytes,
        url,
    })
}

/// Performs the request, following redirects only after re-authorizing every
/// destination. Returns the final non-redirect response.
async fn send_scoped(
    req: FetchRequest,
    require_https: bool,
    lan_policy: Option<&crate::network::lan_policy::LanPolicy>,
    caller_extension_id: Option<&str>,
    client_pool: &ScopedHttpClientPool,
) -> Result<reqwest::Response, AppError> {
    let mut url =
        Url::parse(&req.url).map_err(|_| AppError::Other(format!("Invalid URL: {}", req.url)))?;
    let mut method = request_method(req.method.as_deref());
    let mut headers = req.headers.unwrap_or_default();
    let mut send_body = true;
    let scope = ClientScope::from_caller(caller_extension_id);

    for redirect_count in 0..=10 {
        url = canonicalize_request_url(url)?;
        validate_url_for_ssrf_scheme_and_host(&url)?;
        if require_https && url.scheme() != "https" {
            return Err(AppError::Validation(
                "This request must stay on https://".into(),
            ));
        }
        let host = url
            .host_str()
            .ok_or_else(|| AppError::Other("URL has no host".to_string()))?
            .trim_end_matches('.')
            .to_string();
        let port = url
            .port_or_known_default()
            .ok_or_else(|| AppError::Other("URL has no port".to_string()))?;
        let addresses = resolve_target(&host, port).await?;
        authorize_fetch_target(&host, port, &addresses, lan_policy, caller_extension_id)?;

        // Only public destinations may go through a configured proxy: a proxy
        // dials the target itself, so a LAN destination must stay pinned.
        let route = if addresses.iter().any(|addr| is_restricted_ip(&addr.ip())) {
            Route::Pinned
        } else {
            Route::ProxyAllowed
        };
        let timeout = std::time::Duration::from_millis(req.timeout_ms.unwrap_or(20000));
        let client =
            client_pool.acquire(scope.clone(), route, url.scheme(), &host, port, &addresses)?;
        let mut request = client.request(method.clone(), url.clone()).timeout(timeout);
        for (key, value) in &headers {
            request = request.header(key, value);
        }
        if send_body {
            if let Some(body) = &req.body {
                request = request.body(body.clone());
            }
        }
        let response = request.send().await?;

        if response.status().is_redirection() {
            if redirect_count == 10 {
                return Err(AppError::Other("Too many redirects".into()));
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .ok_or_else(|| AppError::Other("Redirect response has no Location header".into()))?
                .to_str()
                .map_err(|_| AppError::Other("Redirect Location is not valid UTF-8".into()))?;
            let next_url = url
                .join(location)
                .map_err(|_| AppError::Other("Redirect Location is invalid".into()))?;
            strip_sensitive_redirect_headers(&url, &next_url, &mut headers);
            url = next_url;
            if matches!(response.status().as_u16(), 301..=303)
                && method != reqwest::Method::GET
                && method != reqwest::Method::HEAD
            {
                method = reqwest::Method::GET;
                send_body = false;
            }
            continue;
        }

        return Ok(response);
    }
    unreachable!("redirect loop returns at its configured limit")
}

async fn read_body_capped(
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Result<Vec<u8>, AppError> {
    if let Some(length) = response.content_length() {
        if length > max_bytes as u64 {
            return Err(too_large(max_bytes));
        }
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return Err(too_large(max_bytes));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn too_large(max_bytes: usize) -> AppError {
    AppError::Validation(format!("Response body exceeds the {max_bytes} byte limit"))
}

fn strip_sensitive_redirect_headers(
    current: &Url,
    next: &Url,
    headers: &mut HashMap<String, String>,
) {
    if current.origin() != next.origin() {
        headers.retain(|key, _| {
            !matches!(
                key.to_ascii_lowercase().as_str(),
                "authorization" | "cookie" | "proxy-authorization"
            )
        });
    }
}

fn canonicalize_request_url(mut url: Url) -> Result<Url, AppError> {
    let host = url
        .host_str()
        .ok_or_else(|| AppError::Other("URL has no host".to_string()))?;
    let canonical = host.trim_end_matches('.').to_ascii_lowercase();
    if canonical != host {
        url.set_host(Some(&canonical))
            .map_err(|_| AppError::Other("URL host is invalid".into()))?;
    }
    Ok(url)
}

fn request_method(method: Option<&str>) -> reqwest::Method {
    match method.unwrap_or("GET") {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    }
}

fn validate_url_for_ssrf_scheme_and_host(url: &Url) -> Result<(), AppError> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::Other(format!(
            "URL scheme '{}' is not allowed. Only http and https are permitted.",
            url.scheme()
        )));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::Other("URL has no host".to_string()))?
        .trim_end_matches('.');
    if host.eq_ignore_ascii_case("localhost") {
        return Err(AppError::Other(
            "Requests to localhost are not allowed".to_string(),
        ));
    }
    Ok(())
}

async fn resolve_target(host: &str, port: u16) -> Result<Vec<std::net::SocketAddr>, AppError> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(vec![std::net::SocketAddr::new(ip, port)]);
    }
    let addresses: Vec<_> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| AppError::Other(format!("DNS resolution failed for '{host}'")))?
        .collect();
    if addresses.is_empty() {
        return Err(AppError::Other(format!(
            "DNS resolution returned no addresses for '{host}'"
        )));
    }
    Ok(addresses)
}

pub(crate) fn authorize_resolved_target(
    host: &str,
    port: u16,
    addresses: &[std::net::SocketAddr],
    lan_policy: Option<&crate::network::lan_policy::LanPolicy>,
) -> Result<(), AppError> {
    let ips: Vec<_> = addresses.iter().map(std::net::SocketAddr::ip).collect();
    if ips.iter().any(crate::network::lan_policy::is_never_allowed) {
        return Err(AppError::Permission(format!(
            "Requests to loopback, link-local, or metadata address '{host}' are not allowed"
        )));
    }
    if ips.iter().any(is_restricted_ip) {
        return lan_policy
            .ok_or_else(|| {
                AppError::Permission(format!(
                    "Requests to private address '{host}' require network:lan"
                ))
            })?
            .authorize(host, port, &ips);
    }
    Ok(())
}

/// COMPAT(remove in 0.2.0): before `network:lan`, `fetch` only blocked private
/// IP literals, so published extensions without `network:lan` reach hostnames
/// that resolve to private or Tailscale addresses (e.g. a self-hosted Mealie
/// URL). Keep allowing that, with a deprecation warning, so they don't break.
/// Never-allowed addresses (loopback, link-local, metadata) and private IP
/// literals stay blocked. Extensions that declare `network:lan` opt into the
/// strict policy. Fetch only: the WebSocket transport always blocked these.
fn authorize_fetch_target(
    host: &str,
    port: u16,
    addresses: &[std::net::SocketAddr],
    lan_policy: Option<&crate::network::lan_policy::LanPolicy>,
    caller_extension_id: Option<&str>,
) -> Result<(), AppError> {
    let result = authorize_resolved_target(host, port, addresses, lan_policy);
    let legacy_hostname = lan_policy.is_none()
        && host.parse::<IpAddr>().is_err()
        && !addresses
            .iter()
            .any(|addr| crate::network::lan_policy::is_never_allowed(&addr.ip()));
    if result.is_err() && legacy_hostname {
        log::warn!(
            "[deprecated] Extension '{}' fetched '{host}', which resolves to a private address, without declaring network:lan. This will be blocked in Asyar 0.2.0; add network:lan to the manifest.",
            caller_extension_id.unwrap_or("asyar")
        );
        return Ok(());
    }
    result
}

async fn response_envelope(response: reqwest::Response) -> Result<serde_json::Value, AppError> {
    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();
    let ok = response.status().is_success();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let mut headers = serde_json::Map::new();
    for (key, value) in response.headers() {
        if let Ok(value) = value.to_str() {
            headers.insert(
                key.as_str().to_string(),
                serde_json::Value::String(value.into()),
            );
        }
    }
    let bytes = read_body_capped(response, MAX_RESPONSE_BYTES).await?;
    Ok(serde_json::json!({
        "status": status,
        "statusText": status_text,
        "headers": headers,
        "body": encode_body(&bytes, content_type.as_deref()),
        "ok": ok,
    }))
}

/// Bodies cross IPC as a JSON string, so anything that is not text travels
/// base64-encoded — the contract `NetworkResponse.body` documents. Text keeps
/// the plain body that existing callers already parse, and bytes that are
/// valid UTF-8 are treated as text even without a declared type.
pub(crate) fn encode_body(bytes: &[u8], content_type: Option<&str>) -> String {
    if is_textual_body(bytes, content_type) {
        decode_text(bytes, content_type)
    } else {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }
}

/// Decodes with the charset declared in `Content-Type` (UTF-8 when absent or
/// unknown) and strips a leading byte-order mark, matching `Response::text()`.
fn decode_text(bytes: &[u8], content_type: Option<&str>) -> String {
    let encoding = content_type
        .and_then(|value| {
            value.split(';').skip(1).find_map(|param| {
                let (key, val) = param.split_once('=')?;
                key.trim()
                    .eq_ignore_ascii_case("charset")
                    .then(|| val.trim().trim_matches('"'))
            })
        })
        .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()))
        .unwrap_or(encoding_rs::UTF_8);
    encoding.decode(bytes).0.into_owned()
}

pub(crate) fn is_textual_body(bytes: &[u8], content_type: Option<&str>) -> bool {
    if let Some(content_type) = content_type {
        let mime = content_type
            .split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if mime.starts_with("image/")
            || mime.starts_with("audio/")
            || mime.starts_with("video/")
            || mime == "application/octet-stream"
            || mime == "application/pdf"
            || mime == "application/wasm"
            || mime == "application/zip"
            || mime.ends_with("+zip")
            || mime.ends_with("+protobuf")
        {
            return false;
        }
        if mime.starts_with("text/")
            || mime.contains("json")
            || mime.contains("xml")
            || mime.contains("javascript")
            || mime.contains("graphql")
            || mime == "application/x-www-form-urlencoded"
        {
            return true;
        }
    }
    // Unknown or missing type: only keep it readable when it really is UTF-8,
    // so binary never reaches an extension as replacement characters.
    std::str::from_utf8(bytes).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::Server;

    #[test]
    fn declared_charset_and_bom_are_honoured_and_wasm_is_binary() {
        assert_eq!(
            encode_body(
                &[0x63, 0x61, 0x66, 0xE9],
                Some("text/plain; charset=windows-1252")
            ),
            "café"
        );
        assert_eq!(encode_body(b"\xEF\xBB\xBFhi", Some("text/plain")), "hi");
        assert_eq!(
            encode_body(b"\0asm", Some("application/wasm")),
            base64::engine::general_purpose::STANDARD.encode(b"\0asm")
        );
    }

    #[test]
    fn text_bodies_stay_plain_and_binary_bodies_become_base64() {
        assert_eq!(
            encode_body(br#"{"ok":true}"#, Some("application/json")),
            r#"{"ok":true}"#
        );
        assert_eq!(
            encode_body(b"<h1>hi</h1>", Some("text/html; charset=utf-8")),
            "<h1>hi</h1>"
        );
        assert_eq!(
            encode_body(&[0x89, b'P', b'N', b'G'], Some("image/png")),
            "iVBORw=="
        );
        // Undeclared binary must not decode to replacement characters.
        assert_eq!(encode_body(&[0xff, 0xfe], None), "//4=");
        // A declared binary type wins over bytes that happen to be UTF-8.
        assert_eq!(encode_body(b"GIF89a", Some("image/gif")), "R0lGODlh");
    }

    #[tokio::test]
    async fn binary_response_envelope_is_base64_and_announces_its_type() {
        let mut server = Server::new_async().await;
        let bytes = vec![0x89, b'P', b'N', b'G', 0x00, 0xff];
        let _m = server
            .mock("GET", "/shot.png")
            .with_header("content-type", "image/png")
            .with_body(bytes.clone())
            .create_async()
            .await;
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let response = client
            .get(format!("{}/shot.png", server.url()))
            .send()
            .await
            .unwrap();

        let envelope = response_envelope(response).await.unwrap();

        assert_eq!(
            envelope["body"].as_str().unwrap(),
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        );
        assert_eq!(envelope["headers"]["content-type"], "image/png");
    }

    #[tokio::test]
    async fn json_response_envelope_stays_plain_text() {
        let mut server = Server::new_async().await;
        let _m = server
            .mock("GET", "/data.json")
            .with_header("content-type", "application/json")
            .with_body(r#"{"ok":true}"#)
            .create_async()
            .await;
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let response = client
            .get(format!("{}/data.json", server.url()))
            .send()
            .await
            .unwrap();

        let envelope = response_envelope(response).await.unwrap();

        assert_eq!(envelope["body"], r#"{"ok":true}"#);
    }

    #[test]
    fn dotted_hostname_is_canonicalized_before_transport() {
        let url = Url::parse("http://speaker.local.:1400/status").unwrap();
        let canonical = canonicalize_request_url(url).unwrap();
        assert_eq!(canonical.as_str(), "http://speaker.local:1400/status");
    }

    #[tokio::test]
    async fn dotted_hostname_uses_the_preauthorized_pinned_tcp_peer() {
        let mut server = Server::new_async().await;
        let reached = server
            .mock("GET", "/status")
            .with_body("speaker")
            .create_async()
            .await;
        let url = canonicalize_request_url(
            Url::parse(&format!(
                "http://speaker.local.:{}/status",
                server.socket_address().port()
            ))
            .unwrap(),
        )
        .unwrap();
        let pool = ScopedHttpClientPool::new();
        let client = pool
            .acquire(
                ClientScope::Extension("org.asyar.test".into()),
                Route::Pinned,
                "http",
                "speaker.local",
                server.socket_address().port(),
                &[server.socket_address()],
            )
            .unwrap();

        let response = client.get(url).send().await.unwrap();

        assert_eq!(response.text().await.unwrap(), "speaker");
        reached.assert_async().await;
    }

    #[test]
    fn resolved_target_requires_lan_scope_and_rejects_public_lan_mixes() {
        let private = ["192.168.1.20:1400".parse().unwrap()];
        assert!(authorize_resolved_target("speaker.local", 1400, &private, None).is_err());
        let policy =
            crate::network::lan_policy::LanPolicy::from_manifest(Some(&serde_json::json!([
                "speaker.local:1400"
            ])))
            .unwrap();
        assert!(authorize_resolved_target("speaker.local", 1400, &private, Some(&policy)).is_ok());
        let mixed = [
            "192.168.1.20:1400".parse().unwrap(),
            "8.8.8.8:1400".parse().unwrap(),
        ];
        assert!(authorize_resolved_target("speaker.local", 1400, &mixed, Some(&policy)).is_err());
        let public = ["8.8.8.8:443".parse().unwrap()];
        assert!(authorize_resolved_target("example.com", 443, &public, Some(&policy)).is_ok());
    }

    #[test]
    fn legacy_extension_without_lan_keeps_reaching_private_hostnames() {
        let private = ["192.168.1.20:9000".parse().unwrap()];
        assert!(authorize_fetch_target("mealie.home", 9000, &private, None, Some("org.x")).is_ok());
        let tailscale = ["100.101.102.103:443".parse().unwrap()];
        assert!(
            authorize_fetch_target("mealie.tail1234.ts.net", 443, &tailscale, None, None).is_ok()
        );
    }

    #[test]
    fn legacy_compat_never_opens_literals_or_never_allowed_addresses() {
        let private = ["192.168.1.20:9000".parse().unwrap()];
        assert!(authorize_fetch_target("192.168.1.20", 9000, &private, None, None).is_err());
        let loopback = ["127.0.0.1:80".parse().unwrap()];
        assert!(authorize_fetch_target("evil.example", 80, &loopback, None, None).is_err());
        let metadata = ["169.254.169.254:80".parse().unwrap()];
        assert!(authorize_fetch_target("evil.example", 80, &metadata, None, None).is_err());
    }

    #[test]
    fn extensions_declaring_network_lan_get_the_strict_policy() {
        let policy = crate::network::lan_policy::LanPolicy::from_manifest(None).unwrap();
        let private = ["192.168.1.20:9000".parse().unwrap()];
        assert!(
            authorize_fetch_target("mealie.home", 9000, &private, Some(&policy), None).is_err()
        );
    }

    #[test]
    fn legacy_private_hostname_compat_is_removed_before_0_2_0() {
        let current =
            semver::Version::parse(env!("CARGO_PKG_VERSION")).expect("package version must parse");
        let deadline = semver::Version::parse("0.2.0").unwrap();
        assert!(
            current < deadline,
            "launcher is at {current}: remove authorize_fetch_target's legacy hostname compat"
        );
        assert!(include_str!("service.rs").contains("COMPAT(remove in 0.2.0)"));
    }

    #[test]
    fn fetch_dials_ipv4_when_available() {
        let v4: std::net::SocketAddr = "192.168.1.20:80".parse().unwrap();
        let v6: std::net::SocketAddr = "[fd00::20]:80".parse().unwrap();
        assert_eq!(
            crate::network::client_pool::prefer_ipv4(&[v6, v4]),
            vec![v4]
        );
        assert_eq!(crate::network::client_pool::prefer_ipv4(&[v6]), vec![v6]);
    }

    #[test]
    fn cross_origin_redirect_strips_sensitive_headers_only() {
        let current = Url::parse("https://public.example/start").unwrap();
        let next = Url::parse("http://speaker.local:1400/status").unwrap();
        let mut headers = HashMap::from([
            ("Authorization".into(), "Bearer token".into()),
            ("COOKIE".into(), "session=secret".into()),
            ("X-Request-Id".into(), "safe".into()),
        ]);

        strip_sensitive_redirect_headers(&current, &next, &mut headers);

        assert_eq!(
            headers,
            HashMap::from([("X-Request-Id".into(), "safe".into())])
        );
    }

    #[tokio::test]
    async fn plain_fetch_unknown_methods_still_fall_back_to_get() {
        let mut server = Server::new_async().await;
        for method in ["unknown", "post", "TRACE", "", "get"] {
            let mock = server
                .mock("GET", "/fallback")
                .with_body("GET")
                .create_async()
                .await;
            let mut request = req(&format!("{}/fallback", server.url()));
            request.method = Some(method.into());
            assert_eq!(fetch(request).await.unwrap()["body"], "GET", "{method}");
            mock.assert_async().await;
            mock.remove_async().await;
        }
    }

    #[tokio::test]
    async fn plain_redirect_public_to_public_still_works() {
        let mut source = Server::new_async().await;
        let mut destination = Server::new_async().await;
        let target = format!(
            "http://destination.example:{}/next",
            destination.socket_address().port()
        );
        let redirect = source
            .mock("GET", "/")
            .with_status(302)
            .with_header("location", &target)
            .create_async()
            .await;
        let result = destination
            .mock("GET", "/next")
            .with_body("public redirect")
            .create_async()
            .await;
        let client = reqwest::Client::builder()
            .no_proxy()
            .resolve("source.example", source.socket_address())
            .resolve("destination.example", destination.socket_address())
            .redirect(plain_redirect_policy())
            .build()
            .unwrap();
        let response = client
            .get(format!(
                "http://source.example:{}/",
                source.socket_address().port()
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(response.text().await.unwrap(), "public redirect");
        redirect.assert_async().await;
        result.assert_async().await;
    }

    #[tokio::test]
    async fn plain_redirect_http_to_public_https_is_followed() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        let mut source = Server::new_async().await;
        let redirect = source
            .mock("GET", "/")
            .with_status(302)
            .with_header("location", "https://destination.example/next")
            .create_async()
            .await;
        let followed = Arc::new(AtomicBool::new(false));
        let observed = followed.clone();
        let policy = plain_redirect_policy();
        // Exercise the real redirect Attempt without external DNS/TLS dependencies.
        // The destination intentionally has no listener: the policy must follow,
        // after which transport fails (not redirect validation).
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let closed = listener.local_addr().unwrap();
        drop(listener);
        let client = reqwest::Client::builder()
            .no_proxy()
            .resolve("source.example", source.socket_address())
            .resolve("destination.example", closed)
            .redirect(reqwest::redirect::Policy::custom(move |attempt| {
                assert_eq!(attempt.previous()[0].scheme(), "http");
                assert_eq!(attempt.url().scheme(), "https");
                let action = policy.redirect(attempt);
                observed.store(format!("{action:?}").contains("Follow"), Ordering::SeqCst);
                action
            }))
            .build()
            .unwrap();
        let error = client
            .get(format!(
                "http://source.example:{}/",
                source.socket_address().port()
            ))
            .send()
            .await
            .unwrap_err();
        assert!(followed.load(Ordering::SeqCst));
        assert!(!error.is_redirect(), "{error}");
        redirect.assert_async().await;
    }

    #[tokio::test]
    async fn head_method_supported() {
        let mut s = Server::new_async().await;
        let m = s.mock("HEAD", "/").with_status(204).create_async().await;
        let mut r = req(&s.url());
        r.method = Some("HEAD".into());
        assert_eq!(fetch(r).await.unwrap()["status"], 204);
        m.assert_async().await;
    }

    #[tokio::test]
    async fn redirect_to_private_ip_is_blocked() {
        let mut s = Server::new_async().await;
        let _m = s
            .mock("GET", "/")
            .with_status(302)
            .with_header("location", "http://127.0.0.1:1/private")
            .create_async()
            .await;
        let e = fetch(req(&s.url())).await.unwrap_err().to_string();
        assert!(e.contains("redirect"), "{e}");
    }

    #[tokio::test]
    async fn public_redirect_still_followed() {
        let mut s = Server::new_async().await;
        let _redirect = s
            .mock("GET", "/")
            .with_status(302)
            .with_header("location", "/next")
            .create_async()
            .await;
        let dest = s
            .mock("GET", "/next")
            .with_body("followed")
            .create_async()
            .await;
        let client = reqwest::Client::builder()
            .no_proxy()
            .resolve("public.example", s.socket_address())
            .redirect(plain_redirect_policy())
            .build()
            .unwrap();
        let res = client
            .get(format!(
                "http://public.example:{}/",
                s.socket_address().port()
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(res.text().await.unwrap(), "followed");
        dest.assert_async().await;
    }
    #[tokio::test]
    async fn existing_behaviour_unchanged() {
        let mut s = Server::new_async().await;
        let get = s
            .mock("GET", "/")
            .with_body("fallback")
            .create_async()
            .await;
        let mut r = req(&s.url());
        r.method = Some("unsupported-method".into());
        assert_eq!(fetch(r).await.unwrap()["body"], "fallback");
        get.assert_async().await;
    }
    #[tokio::test]
    async fn options_method_supported() {
        let mut s = Server::new_async().await;
        let m = s.mock("OPTIONS", "/").with_status(204).create_async().await;
        let mut r = req(&s.url());
        r.method = Some("OPTIONS".into());
        assert_eq!(fetch(r).await.unwrap()["status"], 204);
        m.assert_async().await;
    }

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

    #[tokio::test]
    async fn read_body_capped_keeps_binary_bytes() {
        let mut server = Server::new_async().await;
        let bytes = vec![0x89, b'P', b'N', b'G', 0x00, 0xff];
        let _m = server
            .mock("GET", "/icon")
            .with_body(bytes.clone())
            .create_async()
            .await;
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let response = client
            .get(format!("{}/icon", server.url()))
            .send()
            .await
            .unwrap();

        assert_eq!(read_body_capped(response, 6).await.unwrap(), bytes);
    }

    #[tokio::test]
    async fn read_body_capped_rejects_oversized_bodies() {
        let mut server = Server::new_async().await;
        let _m = server
            .mock("GET", "/icon")
            .with_body("12345")
            .create_async()
            .await;
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let response = client
            .get(format!("{}/icon", server.url()))
            .send()
            .await
            .unwrap();

        let error = read_body_capped(response, 4).await.unwrap_err();
        assert!(error.to_string().contains("4 byte limit"), "{error}");
    }

    #[tokio::test]
    async fn fetch_scoped_bytes_rejects_http_when_https_is_required() {
        let pool = ScopedHttpClientPool::new();
        let error = fetch_scoped_bytes(
            FetchRequest {
                url: "http://example.com/icon.png".into(),
                method: None,
                headers: None,
                body: None,
                timeout_ms: None,
            },
            1024,
            true,
            None,
            Some("org.x"),
            &pool,
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("https://"), "{error}");
    }
}
