//! Opt-in, provider-agnostic secret resolution and tightly scoped HTTP egress.
//! Session state holds only concurrency locks and keychain denial decisions.

pub mod inject;
pub mod redact;
pub mod source_file;
pub mod source_keychain;

use crate::error::AppError;
use crate::network::{
    host_policy::{parse_secret_host, SecretTarget},
    resolver::SsrfGuardResolver,
    service::FetchRequest,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use zeroize::{Zeroize, Zeroizing};

#[derive(Debug, Clone, Copy, thiserror::Error)]
pub enum SecretError {
    #[error("Invalid secret reference declaration")]
    InvalidDeclaration,
    #[error("Secret source is denied")]
    SourceDenied,
    #[error("Secret source is unavailable")]
    SourceUnavailable,
    #[error("Secret source is unsupported on this platform")]
    UnsupportedPlatform,
    #[error("Secret source access was denied by the user")]
    UserDenied,
    #[error("Invalid secret value")]
    InvalidSecret,
    #[error("Secret request target is denied")]
    TargetDenied,
    #[error("Secret request header is denied")]
    HeaderDenied,
    #[error("Unknown secret reference")]
    UnknownReference,
    #[error("Secret request requires one to four distinct references")]
    ReferenceLimit,
    #[error("Secret request failed")]
    RequestFailed,
    #[error("Secret request timed out")]
    Timeout,
    #[error("Secret response exceeds the size limit")]
    ResponseTooLarge,
    #[error("Too many parallel secret requests")]
    ConcurrencyLimit,
}
impl From<SecretError> for AppError {
    fn from(e: SecretError) -> Self {
        AppError::Permission(e.to_string())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SecretRefDecl {
    pub name: String,
    pub sources: Vec<SecretSource>,
    pub hosts: Vec<String>,
    #[serde(default = "default_methods")]
    pub methods: Vec<String>,
    pub path_prefixes: Option<Vec<String>>,
    pub header: String,
    pub template: String,
}
fn default_methods() -> Vec<String> {
    vec!["GET".into()]
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", deny_unknown_fields, rename_all = "camelCase")]
pub enum SecretSource {
    JsonFile {
        path: String,
        pointer: String,
    },
    Keychain {
        service: String,
        account: Option<String>,
        pointer: Option<String>,
    },
}
pub(crate) fn validate_pointer(p: &str) -> Result<(), SecretError> {
    if !p.is_empty() && !p.starts_with('/') {
        return Err(SecretError::InvalidDeclaration);
    }
    let mut chars = p.chars();
    while let Some(c) = chars.next() {
        if c == '~' && !matches!(chars.next(), Some('0' | '1')) {
            return Err(SecretError::InvalidDeclaration);
        }
    }
    Ok(())
}
pub fn validate_network_secrets_args(
    value: &serde_json::Value,
) -> Result<Vec<SecretRefDecl>, AppError> {
    let decls: Vec<SecretRefDecl> =
        serde_json::from_value(value.clone()).map_err(|_| SecretError::InvalidDeclaration)?;
    if decls.is_empty() {
        return Err(SecretError::InvalidDeclaration.into());
    }
    let mut names = std::collections::HashSet::new();
    for d in &decls {
        if d.name.is_empty()
            || d.name.len() > 32
            || !d
                .name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            || !names.insert(&d.name)
            || !(1..=3).contains(&d.sources.len())
            || d.hosts.is_empty()
            || d.methods.is_empty()
        {
            return Err(SecretError::InvalidDeclaration.into());
        }
        for h in &d.hosts {
            crate::network::host_policy::parse_secret_host(h)
                .map_err(|_| SecretError::InvalidDeclaration)?;
        }
        for m in &d.methods {
            if m != &m.to_ascii_uppercase() || reqwest::Method::from_bytes(m.as_bytes()).is_err() {
                return Err(SecretError::InvalidDeclaration.into());
            }
        }
        if d.path_prefixes.as_ref().is_some_and(|p| {
            p.is_empty()
                || p.iter().any(|p| {
                    !p.starts_with('/')
                        || p.contains(['?', '#', '\\'])
                        || p.chars().any(char::is_control)
                })
        }) {
            return Err(SecretError::InvalidDeclaration.into());
        }
        if reqwest::header::HeaderName::from_bytes(d.header.as_bytes()).is_err()
            || inject::forbidden_header(&d.header)
        {
            return Err(SecretError::InvalidDeclaration.into());
        }
        inject::validate_template(&d.template)?;
        for s in &d.sources {
            match s {
                SecretSource::JsonFile { path, pointer } => {
                    source_file::validate_json_file_path(path)?;
                    validate_pointer(pointer)?;
                }
                SecretSource::Keychain {
                    service,
                    account,
                    pointer,
                } => source_keychain::validate_keychain_source(
                    service,
                    account.as_deref(),
                    pointer.as_deref(),
                )?,
            }
        }
    }
    Ok(decls)
}

/// JSON parsing errors never cross the boundary (they can quote secret values).
pub(crate) fn extract_json_secret(
    bytes: &[u8],
    pointer: &str,
) -> Result<Zeroizing<String>, SecretError> {
    let mut value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| SecretError::InvalidSecret)?;
    let result = value
        .pointer(pointer)
        .and_then(serde_json::Value::as_str)
        .map(|s| Zeroizing::new(s.to_owned()))
        .ok_or(SecretError::InvalidSecret);
    fn wipe(v: &mut serde_json::Value) {
        match v {
            serde_json::Value::String(s) => s.zeroize(),
            serde_json::Value::Array(a) => {
                for v in a {
                    wipe(v)
                }
            }
            serde_json::Value::Object(o) => {
                for (mut k, mut v) in std::mem::take(o) {
                    k.zeroize();
                    wipe(&mut v);
                }
            }
            _ => {}
        }
    }
    wipe(&mut value);
    result
}

/// Session-owned state contains locks and denial decisions, never cached secrets.
#[derive(Default)]
pub struct SecretRuntime {
    keychain: source_keychain::KeychainSession,
    permits: Mutex<HashMap<String, Arc<tokio::sync::Semaphore>>>,
}
impl SecretRuntime {
    fn acquire(&self, extension: &str) -> Result<tokio::sync::OwnedSemaphorePermit, SecretError> {
        let semaphore = self
            .permits
            .lock()
            .map_err(|_| SecretError::ConcurrencyLimit)?
            .entry(extension.into())
            .or_insert_with(|| Arc::new(tokio::sync::Semaphore::new(4)))
            .clone();
        semaphore
            .try_acquire_owned()
            .map_err(|_| SecretError::ConcurrencyLimit)
    }
}
pub struct SecretEnv {
    pub home: PathBuf,
    pub extra_deny_roots: Vec<PathBuf>,
    pub extension_id: String,
    pub runtime: Arc<SecretRuntime>,
    pub keychain_reader: Arc<dyn source_keychain::KeychainReader>,
    #[cfg(test)]
    insecure: bool,
}
impl SecretEnv {
    pub fn new(
        home: PathBuf,
        extra_deny_roots: Vec<PathBuf>,
        extension_id: String,
        runtime: Arc<SecretRuntime>,
    ) -> Self {
        Self {
            home,
            extra_deny_roots,
            extension_id,
            runtime,
            keychain_reader: Arc::new(source_keychain::OsKeychainReader),
            #[cfg(test)]
            insecure: false,
        }
    }
    #[cfg(test)]
    pub fn insecure_for_tests() -> Self {
        let mut env = Self::new(
            PathBuf::new(),
            vec![],
            "test-extension".into(),
            Arc::new(SecretRuntime::default()),
        );
        env.insecure = true;
        env
    }
    fn target(&self, url: &str) -> Result<SecretTarget, SecretError> {
        #[cfg(test)]
        if self.insecure {
            let u = url::Url::parse(url).map_err(|_| SecretError::TargetDenied)?;
            if matches!(u.scheme(), "http" | "https")
                && u.username().is_empty()
                && u.password().is_none()
            {
                return Ok(SecretTarget {
                    host: u
                        .host_str()
                        .ok_or(SecretError::TargetDenied)?
                        .trim_end_matches('.')
                        .to_lowercase(),
                    port: u.port_or_known_default().ok_or(SecretError::TargetDenied)?,
                    path: u.path().into(),
                });
            }
        }
        SecretTarget::parse(url).map_err(|_| SecretError::TargetDenied)
    }
    fn host(&self, host: &str) -> Result<(String, u16), SecretError> {
        #[cfg(test)]
        if self.insecure {
            let u = url::Url::parse(&format!("https://{host}"))
                .map_err(|_| SecretError::TargetDenied)?;
            return Ok((
                u.host_str()
                    .ok_or(SecretError::TargetDenied)?
                    .trim_end_matches('.')
                    .to_lowercase(),
                u.port_or_known_default().ok_or(SecretError::TargetDenied)?,
            ));
        }
        parse_secret_host(host).map_err(|_| SecretError::TargetDenied)
    }
    async fn resolve(&self, decl: &SecretRefDecl) -> Result<Zeroizing<String>, SecretError> {
        let mut last = SecretError::SourceUnavailable;
        for source in &decl.sources {
            let result = match source {
                SecretSource::JsonFile { path, pointer } => {
                    let (path, pointer, home, extra) = (
                        path.clone(),
                        pointer.clone(),
                        self.home.clone(),
                        self.extra_deny_roots.clone(),
                    );
                    tokio::task::spawn_blocking(move || {
                        source_file::read_json_file_secret(&path, &pointer, &home, &extra)
                    })
                    .await
                    .map_err(|_| SecretError::SourceUnavailable)?
                }
                SecretSource::Keychain {
                    service,
                    account,
                    pointer,
                } => {
                    self.runtime
                        .keychain
                        .read(
                            &format!("{}:{}", self.extension_id, decl.name),
                            self.keychain_reader.clone(),
                            service,
                            account.as_deref(),
                            pointer.as_deref(),
                        )
                        .await
                }
            };
            match result {
                Ok(secret) => return Ok(secret),
                Err(e) => last = e,
            }
        }
        Err(last)
    }
}

pub async fn fetch_with_secrets(
    decls: &[SecretRefDecl],
    ref_names: &[String],
    request: FetchRequest,
    env: &SecretEnv,
) -> Result<serde_json::Value, AppError> {
    fetch_secret_inner(decls, ref_names, request, env)
        .await
        .map_err(Into::into)
}
async fn fetch_secret_inner(
    decls: &[SecretRefDecl],
    ref_names: &[String],
    request: FetchRequest,
    env: &SecretEnv,
) -> Result<serde_json::Value, SecretError> {
    if !(1..=4).contains(&ref_names.len())
        || ref_names.iter().collect::<HashSet<_>>().len() != ref_names.len()
    {
        return Err(SecretError::ReferenceLimit);
    }
    let _permit = env.runtime.acquire(&env.extension_id)?;
    let target = env.target(&request.url)?;
    let method = request.method.as_deref().unwrap_or("GET");
    let mut selected = Vec::new();
    let mut injected_names = HashSet::new();
    // Validate every reference before opening any source.
    for name in ref_names {
        let decl = decls
            .iter()
            .find(|d| &d.name == name)
            .ok_or(SecretError::UnknownReference)?;
        if !decl.hosts.iter().any(|h| {
            env.host(h)
                .is_ok_and(|(h, p)| h == target.host && p == target.port)
        }) || !decl.methods.iter().any(|m| m == method)
            || decl
                .path_prefixes
                .as_ref()
                .is_some_and(|p| !p.iter().any(|p| target.path.starts_with(p)))
        {
            return Err(SecretError::TargetDenied);
        }
        if !injected_names.insert(decl.header.to_ascii_lowercase()) {
            return Err(SecretError::HeaderDenied);
        }
        selected.push(decl);
    }
    let headers = request.headers.unwrap_or_default();
    inject::check_extension_headers(
        &headers,
        &selected
            .iter()
            .map(|d| d.header.as_str())
            .collect::<Vec<_>>(),
    )?;
    let method =
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| SecretError::TargetDenied)?;
    let mut secrets = Vec::new();
    let mut rendered = Vec::new();
    for decl in &selected {
        let secret = env.resolve(decl).await?;
        rendered.push(inject::render_header(&decl.template, &secret)?);
        secrets.push(secret);
    }
    let redactor = redact::Redactor::new(
        &secrets
            .iter()
            .chain(rendered.iter())
            .map(|s| s.as_str())
            .collect::<Vec<_>>(),
    );
    let resolver = SsrfGuardResolver::default();
    #[cfg(test)]
    let resolver = if env.insecure {
        SsrfGuardResolver::allowing_loopback_for_tests()
    } else {
        resolver
    };
    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(20_000).clamp(1, 30_000));
    let client = reqwest::Client::builder()
        .no_proxy()
        .dns_resolver(Arc::new(resolver))
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        .build()
        .map_err(|_| SecretError::RequestFailed)?;
    let mut req = client.request(method, &request.url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    for (decl, value) in selected.iter().zip(&rendered) {
        req = req.header(&decl.header, inject::sensitive_header(value)?);
    }
    if let Some(body) = request.body {
        req = req.body(body);
    }
    let result=tokio::time::timeout(timeout,async {
        let mut response=req.send().await.map_err(|_| SecretError::RequestFailed)?;
        let status=response.status();
        let mut headers=serde_json::Map::new();
        for (k,v) in response.headers() { if let Ok(v)=v.to_str() { headers.insert(k.to_string(),serde_json::Value::String(v.into())); } }
        let mut bytes=Zeroizing::new(Vec::new());
        while let Some(chunk)=response.chunk().await.map_err(|_| SecretError::RequestFailed)? {
            if bytes.len()+chunk.len()>10*1024*1024 { return Err(SecretError::ResponseTooLarge); }
            bytes.extend_from_slice(&chunk);
        }
        let mut envelope=serde_json::json!({"status":status.as_u16(),"statusText":status.canonical_reason().unwrap_or(""),"headers":headers,"body":String::from_utf8_lossy(&bytes),"ok":status.is_success()});
        redactor.redact_envelope(&mut envelope); Ok(envelope)
    }).await.map_err(|_| SecretError::Timeout)?;
    // Errors are fixed literals by construction; no reqwest/serde/OS details escape.
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parallel_limit_is_scoped_per_extension_and_released() {
        let rt = SecretRuntime::default();
        let permits = (0..4).map(|_| rt.acquire("a").unwrap()).collect::<Vec<_>>();
        assert!(rt.acquire("a").is_err());
        assert!(rt.acquire("b").is_ok());
        drop(permits);
        assert!(rt.acquire("a").is_ok());
    }
    #[tokio::test]
    async fn response_body_is_capped_at_ten_mib() {
        let mut s = mockito::Server::new_async().await;
        let _m = s
            .mock("GET", "/")
            .with_body(vec![b'x'; 10 * 1024 * 1024 + 1])
            .create_async()
            .await;
        let (_t, e, mut d) = setup();
        allow_server(&mut d, &s.url());
        assert!(fetch_with_secrets(&d, &names(), request(&s.url()), &e)
            .await
            .unwrap_err()
            .to_string()
            .contains("size limit"));
    }
    #[tokio::test]
    async fn four_distinct_refs_inject_distinct_headers() {
        let mut s = mockito::Server::new_async().await;
        let m = s
            .mock("GET", "/")
            .match_header("x-secret-0", "Bearer super-secret-token-123")
            .match_header("x-secret-1", "Bearer super-secret-token-123")
            .match_header("x-secret-2", "Bearer super-secret-token-123")
            .match_header("x-secret-3", "Bearer super-secret-token-123")
            .with_body("ok")
            .create_async()
            .await;
        let (_t, e, mut d) = setup();
        allow_server(&mut d, &s.url());
        let base = d[0].clone();
        d = (0..4)
            .map(|i| {
                let mut v = base.clone();
                v.name = format!("ref-{i}");
                v.header = format!("x-secret-{i}");
                v
            })
            .collect();
        let n = d.iter().map(|v| v.name.clone()).collect::<Vec<_>>();
        assert!(fetch_with_secrets(&d, &n, request(&s.url()), &e)
            .await
            .is_ok());
        m.assert_async().await;
    }
    #[test]
    fn rejects_unknown_source_fields_and_invalid_schema_constraints() {
        let original = declaration();
        for (field, value) in [
            ("name", serde_json::json!("UpperCase")),
            ("sources", serde_json::json!([])),
            ("methods", serde_json::json!([])),
            ("pathPrefixes", serde_json::json!(["relative"])),
            ("header", serde_json::json!("host")),
            ("template", serde_json::json!("{secret}{secret}")),
        ] {
            let mut d = original.clone();
            d[0][field] = value;
            assert!(validate_network_secrets_args(&d).is_err(), "{field}");
        }
        let mut d = original;
        d[0]["sources"][0]["unknown"] = serde_json::json!(true);
        assert!(validate_network_secrets_args(&d).is_err());
    }
    pub(super) fn declaration() -> serde_json::Value {
        serde_json::json!([{"name":"cli-token","sources":[{"type":"jsonFile","path":"~/.somecli/token.json","pointer":"/token"}],"hosts":["api.example.com"],"header":"Authorization","template":"Bearer {secret}"}])
    }
    #[test]
    fn validates_decl_rejects_wildcard_or_ip_hosts() {
        assert!(validate_network_secrets_args(&declaration()).is_ok());
        for h in ["*.example.com", "127.0.0.1"] {
            let mut v = declaration();
            v[0]["hosts"] = serde_json::json!([h]);
            assert!(validate_network_secrets_args(&v).is_err());
        }
    }
    #[test]
    fn rejects_duplicate_names_and_unknown_fields() {
        let v = declaration();
        assert!(validate_network_secrets_args(&serde_json::json!([v[0], v[0]])).is_err());
        let mut v = declaration();
        v[0]["unknown"] = serde_json::json!(true);
        assert!(validate_network_secrets_args(&v).is_err());
    }
    fn setup() -> (tempfile::TempDir, SecretEnv, Vec<SecretRefDecl>) {
        let t = tempfile::tempdir().unwrap();
        let mut env = SecretEnv::insecure_for_tests();
        env.home = dunce::canonicalize(t.path()).unwrap();
        std::fs::create_dir(env.home.join(".somecli")).unwrap();
        std::fs::write(
            env.home.join(".somecli/token.json"),
            r#"{"token":"super-secret-token-123"}"#,
        )
        .unwrap();
        let d = validate_network_secrets_args(&declaration()).unwrap();
        (t, env, d)
    }
    fn request(url: &str) -> crate::network::service::FetchRequest {
        crate::network::service::FetchRequest {
            url: url.into(),
            method: None,
            headers: None,
            body: None,
            timeout_ms: Some(5000),
        }
    }
    fn names() -> Vec<String> {
        vec!["cli-token".into()]
    }
    fn allow_server(d: &mut [SecretRefDecl], url: &str) {
        let u = url::Url::parse(url).unwrap();
        d[0].hosts = vec![format!("{}:{}", u.host_str().unwrap(), u.port().unwrap())];
    }
    #[tokio::test]
    async fn max_four_refs() {
        let (_t, e, d) = setup();
        assert!(fetch_with_secrets(
            &d,
            &vec!["cli-token".into(); 5],
            request("https://api.example.com"),
            &e
        )
        .await
        .is_err());
    }
    #[tokio::test]
    async fn fetch_injects_header_only_for_declared_host() {
        let mut s = mockito::Server::new_async().await;
        let m = s
            .mock("GET", "/")
            .match_header("authorization", "Bearer super-secret-token-123")
            .with_body("ok")
            .create_async()
            .await;
        let (_t, e, mut d) = setup();
        allow_server(&mut d, &s.url());
        assert_eq!(
            fetch_with_secrets(&d, &names(), request(&s.url()), &e)
                .await
                .unwrap()["body"],
            "ok"
        );
        m.assert_async().await;
    }
    #[tokio::test]
    async fn fetch_to_non_declared_host_fails_before_resolving_secret() {
        let (_t, e, d) = setup();
        std::fs::remove_file(e.home.join(".somecli/token.json")).unwrap();
        let err = fetch_with_secrets(&d, &names(), request("https://evil.com"), &e)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("target"));
    }
    #[tokio::test]
    async fn unknown_ref_name_fails() {
        let (_t, e, d) = setup();
        assert!(fetch_with_secrets(
            &d,
            &["unknown".into()],
            request("https://api.example.com"),
            &e
        )
        .await
        .unwrap_err()
        .to_string()
        .contains("Unknown"));
    }
    #[tokio::test]
    async fn method_and_path_prefix_enforced() {
        let (_t, e, mut d) = setup();
        d[0].path_prefixes = Some(vec!["/api/usage".into()]);
        let mut r = request("https://api.example.com/api/usage");
        r.method = Some("POST".into());
        assert!(fetch_with_secrets(&d, &names(), r, &e).await.is_err());
        assert!(
            fetch_with_secrets(&d, &names(), request("https://api.example.com/other"), &e)
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn redirect_not_followed_and_location_returned() {
        let mut s = mockito::Server::new_async().await;
        let _m = s
            .mock("GET", "/")
            .with_status(302)
            .with_header("location", "https://evil.com")
            .create_async()
            .await;
        let (_t, e, mut d) = setup();
        allow_server(&mut d, &s.url());
        let res = fetch_with_secrets(&d, &names(), request(&s.url()), &e)
            .await
            .unwrap();
        assert_eq!(res["status"], 302);
        assert_eq!(res["headers"]["location"], "https://evil.com");
    }
    #[tokio::test]
    async fn echoing_server_response_is_redacted() {
        let mut s = mockito::Server::new_async().await;
        let _m = s
            .mock("GET", "/")
            .with_header("x-echo", "Bearer super-secret-token-123")
            .with_body("super-secret-token-123")
            .create_async()
            .await;
        let (_t, e, mut d) = setup();
        allow_server(&mut d, &s.url());
        let res = fetch_with_secrets(&d, &names(), request(&s.url()), &e)
            .await
            .unwrap();
        assert!(!res.to_string().contains("super-secret-token-123"));
        assert_eq!(res["headers"]["x-echo"], "[REDACTED]");
    }
    #[tokio::test]
    async fn source_fallback_uses_next_source_when_first_missing() {
        let mut s = mockito::Server::new_async().await;
        let _m = s.mock("GET", "/").with_body("ok").create_async().await;
        let (_t, e, mut d) = setup();
        allow_server(&mut d, &s.url());
        d[0].sources.insert(
            0,
            SecretSource::JsonFile {
                path: "~/.somecli/missing.json".into(),
                pointer: "/token".into(),
            },
        );
        assert!(fetch_with_secrets(&d, &names(), request(&s.url()), &e)
            .await
            .is_ok());
    }
    #[tokio::test]
    async fn error_strings_never_contain_secret() {
        let (_t, e, mut d) = setup();
        d[0].hosts = vec!["127.0.0.1:1".into()];
        let err = fetch_with_secrets(
            &d,
            &names(),
            request("http://127.0.0.1:1/super-secret-token-123"),
            &e,
        )
        .await
        .unwrap_err();
        assert!(!err.to_string().contains("super-secret-token-123"));
        for error in [
            SecretError::InvalidDeclaration,
            SecretError::SourceDenied,
            SecretError::SourceUnavailable,
            SecretError::UnsupportedPlatform,
            SecretError::UserDenied,
            SecretError::InvalidSecret,
            SecretError::TargetDenied,
            SecretError::HeaderDenied,
            SecretError::UnknownReference,
            SecretError::ReferenceLimit,
            SecretError::RequestFailed,
            SecretError::Timeout,
            SecretError::ResponseTooLarge,
            SecretError::ConcurrencyLimit,
        ] {
            assert!(!error.to_string().contains("super-secret-token-123"));
        }
    }
}
