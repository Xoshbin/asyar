//! Custom URI schemes: `asyar-extension://` serves extension bundle files,
//! `asyar-icon://` cached application icons, and `asyar-thumb://` cached
//! file-preview thumbnails.
//!
//! Every scheme is listed once in `schemes()` and registered by [`register`],
//! which sends each handler's [`SchemeResponse`] through the shared builder.

mod response;

pub use response::SchemeResponse;
use tauri::{Manager, Runtime};

/// A scheme handler. It returns a [`SchemeResponse`], so it can't build a
/// response without the shared cache policy.
pub(crate) type SchemeHandler<R> =
    fn(&tauri::AppHandle<R>, &tauri::http::Request<Vec<u8>>) -> SchemeResponse;

/// Every custom scheme the launcher serves. Add new schemes here, never in
/// `lib.rs`: `every_scheme_sets_the_cache_policy_on_success_and_error` walks
/// this list.
pub(crate) fn schemes<R: Runtime>() -> [(&'static str, SchemeHandler<R>); 3] {
    [
        ("asyar-extension", handle_extension_request::<R>),
        ("asyar-icon", handle_icon_request::<R>),
        ("asyar-thumb", handle_thumbnail_request::<R>),
    ]
}

/// Registers every scheme in `schemes()` on the app builder.
pub fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    schemes::<R>()
        .into_iter()
        .fold(builder, |builder, (scheme, handler)| {
            builder.register_uri_scheme_protocol(scheme, move |ctx, req| {
                handler(ctx.app_handle(), &req).into_http()
            })
        })
}

/// Strips the scheme prefix from a request URI. Webviews send one of
/// `{scheme}://localhost/…`, `{scheme}://…` or, on Windows,
/// `http://{scheme}.localhost/…`. The prefix match ignores ASCII case.
fn scheme_path<'a>(uri: &'a str, scheme: &str) -> &'a str {
    [
        format!("{scheme}://localhost/"),
        format!("{scheme}://"),
        format!("http://{scheme}.localhost/"),
    ]
    .iter()
    .find_map(|prefix| {
        uri.get(..prefix.len())
            .filter(|head| head.eq_ignore_ascii_case(prefix))
            .map(|_| &uri[prefix.len()..])
    })
    .unwrap_or(uri)
}

/// Drops any `?query` or `#fragment` from a requested path.
fn without_query(path: &str) -> &str {
    path.split(['?', '#']).next().unwrap_or(path)
}

/// Reads one file from a flat cache folder (`icon_cache`, `thumbnail_cache`).
/// The name must be a plain filename: any `..`, `/` or `\` is refused.
/// Returns the filename with its bytes, or the error response to send.
fn read_cache_file(
    cache_dir: &std::path::Path,
    uri: &str,
    scheme: &str,
) -> Result<(String, Vec<u8>), SchemeResponse> {
    let path = scheme_path(uri, scheme);
    // Webviews add a trailing slash to host-only URIs.
    let path = path.strip_suffix('/').unwrap_or(path);
    let decoded = percent_encoding::percent_decode_str(path).decode_utf8_lossy();
    let filename = without_query(&decoded);

    // [SECURITY]: Prevent path traversal
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        log::warn!("{scheme} security violation (traversal): {filename}");
        return Err(SchemeResponse::forbidden());
    }

    let file_path = cache_dir.join(filename);
    match std::fs::read(&file_path) {
        Ok(bytes) => Ok((filename.to_string(), bytes)),
        Err(e) => {
            log::debug!("{scheme} file not found in cache: {file_path:?} ({e})");
            Err(SchemeResponse::not_found())
        }
    }
}

// ── asyar-extension:// ────────────────────────────────────────────────────────

/// Serves files from installed/built-in/dev extensions under the `asyar-extension://` scheme.
///
/// Lookup priority:
/// 0. Dev registry (`dev_extensions.json`) — hotlinked source during development
/// 1. Debug build fallback — `src/built-in-features/{id}/dist/` (debug only)
/// 2. Built-in resources — bundled inside the app binary
/// 3. Installed extensions — `$APPDATA/extensions/{id}/`
fn handle_extension_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    request: &tauri::http::Request<Vec<u8>>,
) -> SchemeResponse {
    let uri = request.uri().to_string();
    let path = scheme_path(&uri, "asyar-extension");

    // Expected format: asyar-extension://[localhost/]{extension_id}/{file_path}
    let mut parts = path.splitn(2, '/');
    let extension_id = parts.next().unwrap_or("");
    let encoded_file_path = parts.next().unwrap_or("index.html");

    // [ARCHITECTURE SAFEGUARD]: LOCAL FILE RESOLUTION
    // Strip any query parameters (?foo=bar) or URL fragments (#baz) from the requested file path.
    // When iframes load URLs (e.g. `asyar-extension://xyz/index.html?view=DefaultView`),
    // the parameters are part of the raw HTTP request. If we do not strip them here,
    // the Rust `std::fs` backend will look for a literal file on disk named
    // "index.html?view=DefaultView" and fail with File Not Found.
    let file_path = without_query(encoded_file_path);
    let wants_icon_copy = request.uri().query().is_some_and(|q| {
        q.split('&')
            .any(|pair| pair == crate::icons::copies::COPY_QUERY)
    });

    let app_data_dir = app.path().app_data_dir().unwrap_or_default();
    let resource_dir = app.path().resource_dir().unwrap_or_default();

    let mut final_path: Option<std::path::PathBuf> = None;

    // Priority 0: Dev Registry Paths
    let dev_registry_file = app_data_dir.join("dev_extensions.json");
    if dev_registry_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&dev_registry_file) {
            if let Ok(dev_extensions) =
                serde_json::from_str::<std::collections::HashMap<String, String>>(&content)
            {
                if let Some(base_path) = dev_extensions.get(extension_id) {
                    let possible_paths = vec![
                        std::path::PathBuf::from(base_path)
                            .join("dist")
                            .join(file_path),
                        std::path::PathBuf::from(base_path).join(file_path),
                    ];
                    for p in possible_paths {
                        if p.exists() && p.is_file() {
                            final_path = Some(p);
                            break;
                        }
                    }
                }
            }
        }
    }

    // Priority 1: Fallback for development (fresh build output) — debug builds only
    #[cfg(debug_assertions)]
    {
        let dev_base = std::env::current_dir()
            .unwrap_or_default()
            .join("src/built-in-features")
            .join(extension_id)
            .join("dist");

        let mut dev_path = dev_base.join(file_path);

        // If index.css is requested but doesn't exist, try any .css file in the dist dir
        if file_path == "index.css" && !dev_path.exists() {
            if let Ok(entries) = std::fs::read_dir(&dev_base) {
                for entry in entries.flatten() {
                    if entry.path().extension().and_then(|s| s.to_str()) == Some("css") {
                        dev_path = entry.path();
                        break;
                    }
                }
            }
        }

        if dev_path.exists() && dev_path.is_file() {
            final_path = Some(dev_path);
        }
    }

    if final_path.is_none() {
        // Priority 2: Built-in (Bundled Resources)
        let resource_path = resource_dir
            .join("built-in-features")
            .join(extension_id)
            .join(file_path);
        if resource_path.exists() && resource_path.is_file() {
            final_path = Some(resource_path);
        }
    }

    if final_path.is_none() {
        // Priority 3: Installed (AppData)
        let possible_paths = vec![
            app_data_dir
                .join("extensions")
                .join(extension_id)
                .join("dist")
                .join(file_path),
            app_data_dir
                .join("extensions")
                .join(extension_id)
                .join(file_path),
        ];
        for p in possible_paths {
            if p.exists() && p.is_file() {
                final_path = Some(p);
                break;
            }
        }
    }

    // Icon URLs ask for the 128px copy written at install. It sits next to
    // the original, so it goes through the same canonicalize + allow-list
    // checks below. No copy → the original is served.
    if wants_icon_copy {
        if let Some(copy) = final_path
            .as_deref()
            .map(crate::icons::copies::copy_path)
            .filter(|copy| copy.is_file())
        {
            final_path = Some(copy);
        }
    }

    match final_path {
        Some(resolved_path) => {
            // Step 1: Canonicalize to resolve any symlinks
            let canonical_path = match std::fs::canonicalize(&resolved_path) {
                Ok(p) => p,
                Err(_) => return SchemeResponse::not_found(),
            };

            // Step 2: Validate the canonical path is in an allowed location
            if !is_path_allowed(&canonical_path, app) {
                return SchemeResponse::forbidden();
            }

            // Step 3: Read from the canonical (real) path
            let raw = match std::fs::read(&canonical_path) {
                Ok(bytes) => bytes,
                Err(_) => return SchemeResponse::not_found(),
            };

            // Inject the execution-context role into view.html and worker.html
            // so extension code can assert it is running in the correct context.
            // In debug builds only, also inject the dev-inspector active flag so
            // the SDK's MessageBroker / ExtensionRpc emit diagnostic `asyar:dev:*`
            // postMessages the dev inspector listens for. Production builds
            // never carry the flag — the SDK tap is silent by default.
            let content = match file_path {
                "view.html" => {
                    let with_role = inject_asyar_role(&raw, "view");
                    let with_scheme =
                        inject_color_scheme(&with_role, view_color_scheme(request.uri().query()));
                    maybe_inject_dev_inspector_flag(with_scheme)
                }
                "worker.html" => {
                    let with_role = inject_asyar_role(&raw, "worker");
                    maybe_inject_dev_inspector_flag(with_role)
                }
                _ => raw,
            };

            SchemeResponse::ok(extension_mime_type(&canonical_path), content)
                .with_csp(extension_csp_header())
        }
        None => SchemeResponse::not_found(),
    }
}

/// Content type for a file served from an extension bundle.
fn extension_mime_type(path: &std::path::Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("html") => "text/html",
        Some("js") => "application/javascript",
        Some("css") => "text/css",
        Some("json") => "application/json",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("svg") => "image/svg+xml",
        _ => "text/plain",
    }
}

/// Baseline Content Security Policy for `asyar-extension://` in release builds.
/// Strictly disallows `'unsafe-eval'`.
pub(crate) const EXTENSION_CSP_RELEASE: &str = "default-src asyar-extension: 'self'; script-src asyar-extension: 'self' 'unsafe-inline'; style-src asyar-extension: 'self' 'unsafe-inline'; font-src asyar-extension: 'self' data:; img-src asyar-extension: 'self' asyar-icon: http://asyar-icon.localhost data:;";

/// Content Security Policy for `asyar-extension://` in debug builds.
/// Allows `'unsafe-eval'` for local development tools.
pub(crate) const EXTENSION_CSP_DEBUG: &str = "default-src asyar-extension: 'self'; script-src asyar-extension: 'self' 'unsafe-inline' 'unsafe-eval'; style-src asyar-extension: 'self' 'unsafe-inline'; font-src asyar-extension: 'self' data:; img-src asyar-extension: 'self' asyar-icon: http://asyar-icon.localhost data:;";

/// Resolves the CSP header string based on whether debug mode is enabled.
pub(crate) fn resolve_extension_csp(is_debug: bool) -> &'static str {
    if is_debug {
        EXTENSION_CSP_DEBUG
    } else {
        EXTENSION_CSP_RELEASE
    }
}

/// Returns the Content Security Policy header value for `asyar-extension://` requests,
/// enforcing strict CSP without `'unsafe-eval'` in release builds while allowing `'unsafe-eval'` in debug builds.
pub(crate) fn extension_csp_header() -> &'static str {
    resolve_extension_csp(cfg!(debug_assertions))
}

/// Inserts `snippet` immediately after `<head>` (case-insensitive), or wraps
/// it in `<head>...</head>` before the document body when `<head>` is absent.
fn inject_into_head(html: &[u8], snippet: &str) -> Vec<u8> {
    let html_str = match std::str::from_utf8(html) {
        Ok(s) => s,
        Err(_) => return html.to_vec(),
    };
    // A full HTML parser is not available here; a single-pass search is
    // sufficient because <head> appears once at the top of well-formed
    // extension HTML files.
    let lower = html_str.to_ascii_lowercase();
    if let Some(pos) = lower.find("<head>") {
        let insert_at = pos + "<head>".len();
        let mut result = String::with_capacity(html_str.len() + snippet.len());
        result.push_str(&html_str[..insert_at]);
        result.push_str(snippet);
        result.push_str(&html_str[insert_at..]);
        result.into_bytes()
    } else {
        let mut result = String::with_capacity(html_str.len() + snippet.len() + 15);
        result.push_str("<head>");
        result.push_str(snippet);
        result.push_str("</head>");
        result.push_str(html_str);
        result.into_bytes()
    }
}

/// Extracts the host-resolved color scheme (`"dark"` or `"light"`) from a
/// `view.html` query string, falling back to `"light dark"` when absent.
pub(crate) fn view_color_scheme(query: Option<&str>) -> &'static str {
    let theme = query.and_then(|q| {
        q.split('&').find_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            (k == "theme").then_some(v)
        })
    });
    match theme {
        Some("dark") => "dark",
        Some("light") => "light",
        _ => "light dark",
    }
}

/// Injects `<meta name="color-scheme" content="<scheme>">` into `view.html` so
/// the embedded document's root `color-scheme` matches the host `<iframe>`
/// before first paint. Without this, Chromium/WebView2 forces an opaque white
/// canvas whenever the host is dark and the extension omits `color-scheme`.
pub(crate) fn inject_color_scheme(html: &[u8], scheme: &str) -> Vec<u8> {
    let meta = format!(r#"<meta name="color-scheme" content="{scheme}">"#);
    inject_into_head(html, &meta)
}

/// Injects `<script>window.__ASYAR_ROLE__ = "<role>";</script>` immediately
/// after the opening `<head>` tag of the given HTML bytes. If no `<head>` tag
/// is present the script is prepended before the first byte of content.
///
/// Only called for `view.html` (role = "view") and `worker.html` (role =
/// "worker") by `handle_extension_request`. All other file types are served
/// without modification.
pub(crate) fn inject_asyar_role(html: &[u8], role: &str) -> Vec<u8> {
    let script = format!("<script>window.__ASYAR_ROLE__ = \"{}\";</script>", role);
    inject_into_head(html, &script)
}

/// Debug-only wrapper around [`inject_dev_inspector_flag`]: production
/// builds pass the HTML through untouched. Split so the pure injector can
/// be unit-tested without `cfg(debug_assertions)` gating the test.
pub(crate) fn maybe_inject_dev_inspector_flag(html: Vec<u8>) -> Vec<u8> {
    #[cfg(debug_assertions)]
    {
        inject_dev_inspector_flag(&html)
    }
    #[cfg(not(debug_assertions))]
    {
        html
    }
}

/// Injects `<script>window.__ASYAR_DEV_INSPECTOR_ACTIVE__ = true;</script>`
/// immediately after the opening `<head>` tag, mirroring
/// [`inject_asyar_role`]. Consumed by the SDK's MessageBroker + ExtensionRpc
/// emitters to decide whether to fire `asyar:dev:*` diagnostic postMessages.
///
/// Always callable at the function level — the `cfg` guard is at the call
/// site so tests can exercise the pure injector.
pub(crate) fn inject_dev_inspector_flag(html: &[u8]) -> Vec<u8> {
    inject_into_head(
        html,
        "<script>window.__ASYAR_DEV_INSPECTOR_ACTIVE__ = true;</script>",
    )
}

// ── asyar-icon:// ─────────────────────────────────────────────────────────────

/// Serves cached application icons from `$APPDATA/icon_cache/` under the `asyar-icon://` scheme.
fn handle_icon_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    request: &tauri::http::Request<Vec<u8>>,
) -> SchemeResponse {
    let uri = request.uri().to_string();
    log::debug!("Icon request URI: {}", uri);

    let icon_cache_dir = crate::icons::remote::icon_cache_dir(app);

    match read_cache_file(&icon_cache_dir, &uri, "asyar-icon") {
        Ok((filename, bytes)) => {
            let content_type = if filename.ends_with(".svg") {
                "image/svg+xml"
            } else if filename.ends_with(".gif") {
                "image/gif"
            } else if filename.ends_with(".ico") {
                "image/x-icon"
            } else {
                "image/png"
            };
            SchemeResponse::ok(content_type, bytes)
        }
        Err(response) => response,
    }
}

// ── asyar-thumb:// ────────────────────────────────────────────────────────────

/// Serves cached file-preview thumbnails from `$APPDATA/thumbnail_cache/`
/// under the `asyar-thumb://` scheme. Thumbnails are content-addressed by
/// path+mtime+size, unlike app icons which are keyed by install path alone.
fn handle_thumbnail_request<R: Runtime>(
    app: &tauri::AppHandle<R>,
    request: &tauri::http::Request<Vec<u8>>,
) -> SchemeResponse {
    let uri = request.uri().to_string();
    let thumbnail_cache_dir = crate::thumbnail::cache::get_thumbnail_cache_dir(app);

    match read_cache_file(&thumbnail_cache_dir, &uri, "asyar-thumb") {
        Ok((_, bytes)) => SchemeResponse::ok("image/png", bytes),
        Err(response) => response,
    }
}

// ── Path allow-list ───────────────────────────────────────────────────────────

/// Returns `true` if `path` is within an approved location for extension file serving.
///
/// In release builds only `$APPDATA/extensions` and `$APPLOCALDATA/extensions` are
/// permitted. Debug builds additionally allow any path under the user's home directory
/// so that symlink-linked dev extensions resolve correctly.
fn is_path_allowed<R: Runtime>(path: &std::path::Path, app: &tauri::AppHandle<R>) -> bool {
    // Canonicalize a directory for comparison. On Windows, std::fs::canonicalize adds a
    // verbatim prefix (\\?\) that must match the already-canonicalized `path` argument.
    // On macOS/Linux, canonicalization resolves symlinks so both sides are consistent.
    // Falls back to the raw path if the directory does not exist yet.
    let canonical_dir =
        |p: std::path::PathBuf| -> std::path::PathBuf { std::fs::canonicalize(&p).unwrap_or(p) };

    // Allow 1: Path is inside the app's extensions directory
    if let Ok(extensions_dir) = app
        .path()
        .app_data_dir()
        .map(|p| canonical_dir(p.join("extensions")))
    {
        if path.starts_with(&extensions_dir) {
            return true;
        }
    }

    // Allow 2: Path is inside the app's local data extensions directory (Windows)
    if let Ok(local_extensions_dir) = app
        .path()
        .app_local_data_dir()
        .map(|p| canonical_dir(p.join("extensions")))
    {
        if path.starts_with(&local_extensions_dir) {
            return true;
        }
    }

    // Allow 3: Path is inside a registered dev extension directory.
    // Covers extensions created via "Create Extension" which live in user-chosen directories.
    {
        let dev_registry_file = app
            .path()
            .app_data_dir()
            .map(|d| d.join("dev_extensions.json"))
            .unwrap_or_default();
        if dev_registry_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&dev_registry_file) {
                if let Ok(dev_map) =
                    serde_json::from_str::<std::collections::HashMap<String, String>>(&content)
                {
                    for base_path in dev_map.values() {
                        let canonical_base = canonical_dir(std::path::PathBuf::from(base_path));
                        if path.starts_with(&canonical_base) {
                            return true;
                        }
                    }
                }
            }
        }
    }

    // Allow 4: Path is inside the user's home directory
    // This covers developer symlink targets like ~/develop/extensions/my-ext/
    #[cfg(debug_assertions)]
    if let Some(home_dir) = dirs::home_dir() {
        if path.starts_with(canonical_dir(home_dir)) {
            return true;
        }
    }

    // Allow 5: Debug builds only — allow any path for development flexibility
    #[cfg(debug_assertions)]
    {
        true
    }

    #[cfg(not(debug_assertions))]
    false
}

#[cfg(test)]
mod role_injection_tests {
    use super::inject_asyar_role;

    #[test]
    fn view_html_injects_view_role() {
        let html = b"<html><head></head><body>view</body></html>";
        let result = inject_asyar_role(html, "view");
        let s = String::from_utf8(result).unwrap();
        assert!(
            s.contains("window.__ASYAR_ROLE__ = \"view\""),
            "expected view role injection, got: {}",
            s
        );
    }

    #[test]
    fn worker_html_injects_worker_role() {
        let html = b"<html><head></head><body>worker</body></html>";
        let result = inject_asyar_role(html, "worker");
        let s = String::from_utf8(result).unwrap();
        assert!(
            s.contains("window.__ASYAR_ROLE__ = \"worker\""),
            "expected worker role injection, got: {}",
            s
        );
    }

    #[test]
    fn injection_is_placed_inside_head() {
        let html = b"<html><head><title>Test</title></head><body></body></html>";
        let result = inject_asyar_role(html, "view");
        let s = String::from_utf8(result).unwrap();
        let script_pos = s
            .find("window.__ASYAR_ROLE__")
            .expect("script must be present");
        let head_end = s.find("</head>").expect("</head> must be present");
        assert!(
            script_pos < head_end,
            "role script must appear before </head>"
        );
    }

    #[test]
    fn injection_works_when_head_is_absent() {
        let html = b"<html><body>content</body></html>";
        let result = inject_asyar_role(html, "view");
        let s = String::from_utf8(result).unwrap();
        assert!(
            s.contains("window.__ASYAR_ROLE__ = \"view\""),
            "role must be injected even when <head> is absent, got: {}",
            s
        );
    }

    #[test]
    fn injection_produces_valid_script_tag() {
        let html = b"<html><head></head><body></body></html>";
        let result = inject_asyar_role(html, "view");
        let s = String::from_utf8(result).unwrap();
        assert!(s.contains("<script>"), "must emit <script>");
        assert!(s.contains("</script>"), "must close </script>");
    }

    #[test]
    fn dev_inspector_flag_injected_inside_head() {
        use super::inject_dev_inspector_flag;
        let html = b"<html><head><title>T</title></head><body></body></html>";
        let result = inject_dev_inspector_flag(html);
        let s = String::from_utf8(result).unwrap();
        assert!(
            s.contains("window.__ASYAR_DEV_INSPECTOR_ACTIVE__ = true"),
            "flag must be injected, got: {}",
            s
        );
        let script_pos = s.find("__ASYAR_DEV_INSPECTOR_ACTIVE__").unwrap();
        let head_end = s.find("</head>").unwrap();
        assert!(script_pos < head_end, "flag must appear before </head>");
    }

    #[test]
    fn dev_inspector_flag_injection_works_without_head_tag() {
        use super::inject_dev_inspector_flag;
        let html = b"<html><body></body></html>";
        let result = inject_dev_inspector_flag(html);
        let s = String::from_utf8(result).unwrap();
        assert!(s.contains("__ASYAR_DEV_INSPECTOR_ACTIVE__"));
    }

    #[test]
    #[cfg(debug_assertions)]
    fn maybe_inject_dev_inspector_flag_is_active_in_debug_builds() {
        use super::maybe_inject_dev_inspector_flag;
        let html = b"<html><head></head><body></body></html>".to_vec();
        let result = maybe_inject_dev_inspector_flag(html);
        let s = String::from_utf8(result).unwrap();
        assert!(s.contains("__ASYAR_DEV_INSPECTOR_ACTIVE__"));
    }

    #[test]
    fn inject_preserves_existing_html_content() {
        let html = b"<html><head><title>App</title></head><body><p>hello</p></body></html>";
        let result = inject_asyar_role(html, "view");
        let s = String::from_utf8(result).unwrap();
        assert!(
            s.contains("<title>App</title>"),
            "existing head content preserved"
        );
        assert!(s.contains("<p>hello</p>"), "body content preserved");
    }

    #[test]
    fn test_extension_csp_release_does_not_contain_unsafe_eval() {
        use super::resolve_extension_csp;
        let csp = resolve_extension_csp(false);
        assert!(
            !csp.contains("'unsafe-eval'"),
            "release CSP must not contain 'unsafe-eval', got: {csp}"
        );
        assert!(
            csp.contains("default-src asyar-extension: 'self';"),
            "CSP must define baseline default-src"
        );
        assert!(
            csp.contains("script-src asyar-extension: 'self' 'unsafe-inline';"),
            "CSP must restrict script-src without unsafe-eval"
        );
    }

    #[test]
    fn test_extension_csp_debug_contains_unsafe_eval() {
        use super::resolve_extension_csp;
        let csp = resolve_extension_csp(true);
        assert!(
            csp.contains("'unsafe-eval'"),
            "debug CSP should allow 'unsafe-eval' for dev tooling, got: {csp}"
        );
    }

    #[test]
    fn test_extension_csp_header_matches_build_mode() {
        use super::extension_csp_header;
        let csp = extension_csp_header();
        if cfg!(debug_assertions) {
            assert!(csp.contains("'unsafe-eval'"));
        } else {
            assert!(!csp.contains("'unsafe-eval'"));
        }
    }

    #[test]
    fn view_color_scheme_parses_theme_query_param() {
        use super::view_color_scheme;
        assert_eq!(
            view_color_scheme(Some("view=TranslateView&theme=dark")),
            "dark"
        );
        assert_eq!(view_color_scheme(Some("theme=light")), "light");
        assert_eq!(view_color_scheme(Some("view=DefaultView")), "light dark");
        assert_eq!(view_color_scheme(Some("theme=invalid")), "light dark");
        assert_eq!(view_color_scheme(None), "light dark");
    }

    #[test]
    fn color_scheme_meta_is_injected_inside_head() {
        use super::inject_color_scheme;
        let html = b"<html><head><title>Test</title></head><body></body></html>";
        let result = inject_color_scheme(html, "dark");
        let s = String::from_utf8(result).unwrap();
        let meta_pos = s
            .find(r#"<meta name="color-scheme" content="dark">"#)
            .expect("color-scheme meta must be present");
        let head_end = s.find("</head>").expect("</head> must be present");
        assert!(meta_pos < head_end, "meta must appear before </head>");
    }

    #[test]
    fn color_scheme_meta_works_without_head_tag() {
        use super::inject_color_scheme;
        let html = b"<html><body>content</body></html>";
        let result = inject_color_scheme(html, "light");
        let s = String::from_utf8(result).unwrap();
        assert!(
            s.contains(r#"<meta name="color-scheme" content="light">"#),
            "meta must be injected even when <head> is absent, got: {s}"
        );
    }
}

#[cfg(test)]
mod scheme_registry_tests {
    use super::*;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};

    /// A mock app with its own app-data folder, so the fixtures below never
    /// touch the real `~/Library/Application Support` root.
    fn isolated_app(identifier: &str) -> tauri::App<MockRuntime> {
        let mut context = mock_context(noop_assets());
        context.config_mut().identifier = identifier.to_string();
        mock_builder().build(context).unwrap()
    }

    /// Writes a file the scheme can serve and returns its URI. A new scheme
    /// in [`schemes`] fails here until it gets a fixture, so it can't skip
    /// the cache-policy check below.
    fn seed_fixture(app: &tauri::AppHandle<MockRuntime>, scheme: &str) -> String {
        let data = app.path().app_data_dir().unwrap();
        let (dir, file) = match scheme {
            "asyar-extension" => (data.join("extensions").join("cache-probe"), "probe.js"),
            "asyar-icon" => (data.join("icon_cache"), "probe.png"),
            "asyar-thumb" => (
                crate::thumbnail::cache::get_thumbnail_cache_dir(app),
                "probe.png",
            ),
            other => panic!("add a fixture for the `{other}` scheme"),
        };
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(file), b"probe").unwrap();
        match scheme {
            "asyar-extension" => format!("{scheme}://localhost/cache-probe/{file}"),
            _ => format!("{scheme}://localhost/{file}"),
        }
    }

    fn get(
        handler: SchemeHandler<MockRuntime>,
        app: &tauri::AppHandle<MockRuntime>,
        uri: &str,
    ) -> tauri::http::Response<Vec<u8>> {
        let req = tauri::http::Request::builder()
            .uri(uri)
            .body(Vec::new())
            .unwrap();
        handler(app, &req).into_http()
    }

    #[test]
    fn every_scheme_sets_the_cache_policy_on_success_and_error() {
        let app = isolated_app("org.asyar.test.uri-schemes");
        let handle = app.handle();

        for (scheme, handler) in schemes::<MockRuntime>() {
            let found = get(handler, handle, &seed_fixture(handle, scheme));
            let missing = get(
                handler,
                handle,
                &format!("{scheme}://localhost/missing.png"),
            );

            for (res, status) in [(found, 200), (missing, 404)] {
                assert_eq!(res.status().as_u16(), status, "{scheme} status");
                assert_eq!(
                    res.headers()
                        .get("Cache-Control")
                        .and_then(|v| v.to_str().ok()),
                    Some(response::CACHE_CONTROL),
                    "{scheme} {status} must carry the shared cache policy"
                );
            }
        }

        let _ = std::fs::remove_dir_all(handle.path().app_data_dir().unwrap());
    }

    #[test]
    fn icon_requests_get_the_128px_copy_and_everything_else_the_original() {
        let app = isolated_app("org.asyar.test.uri-schemes-icon-copy");
        let handle = app.handle();
        let dist = handle
            .path()
            .app_data_dir()
            .unwrap()
            .join("extensions/copy-probe/dist");
        std::fs::create_dir_all(&dist).unwrap();
        std::fs::write(dist.join("icon.png"), b"original").unwrap();
        std::fs::write(dist.join("plain.png"), b"plain").unwrap();
        std::fs::write(
            crate::icons::copies::copy_path(&dist.join("icon.png")),
            b"copy",
        )
        .unwrap();
        let handler = handle_extension_request::<MockRuntime>;
        let body = |uri: &str| get(handler, handle, uri).body().clone();

        assert_eq!(body("asyar-extension://copy-probe/icon.png?icon"), b"copy");
        assert_eq!(body("asyar-extension://copy-probe/icon.png"), b"original");
        // No copy (small, SVG, dev extension, older install) → the original.
        assert_eq!(
            body("asyar-extension://copy-probe/plain.png?icon"),
            b"plain"
        );

        let _ = std::fs::remove_dir_all(handle.path().app_data_dir().unwrap());
    }

    #[test]
    fn extension_images_are_served_with_their_own_mime_type() {
        for (file, mime) in [
            ("a.png", "image/png"),
            ("a.jpg", "image/jpeg"),
            ("a.JPEG", "image/jpeg"),
            ("a.webp", "image/webp"),
            ("a.gif", "image/gif"),
            ("a.bmp", "image/bmp"),
            ("a.ico", "image/x-icon"),
            ("a.svg", "image/svg+xml"),
            ("a.unknown", "text/plain"),
        ] {
            assert_eq!(
                extension_mime_type(std::path::Path::new(file)),
                mime,
                "{file}"
            );
        }
    }

    #[test]
    fn scheme_names_are_unique() {
        let names: Vec<_> = schemes::<MockRuntime>().iter().map(|(n, _)| *n).collect();
        let mut deduped = names.clone();
        deduped.sort_unstable();
        deduped.dedup();
        assert_eq!(names.len(), deduped.len(), "duplicate scheme in {names:?}");
    }

    /// Registering a scheme anywhere else would skip [`SchemeResponse`] and
    /// its cache policy, the way `asyar-extension://` once did.
    #[test]
    fn schemes_are_only_registered_through_this_module() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let this_module = src.join("uri_schemes.rs");
        let mut offenders = Vec::new();
        let mut dirs = vec![src];
        while let Some(dir) = dirs.pop() {
            for entry in std::fs::read_dir(dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    dirs.push(path);
                } else if path.extension().is_some_and(|e| e == "rs") && path != this_module {
                    let code = std::fs::read_to_string(&path).unwrap();
                    if code.contains("register_uri_scheme_protocol")
                        || code.contains("register_asynchronous_uri_scheme_protocol")
                    {
                        offenders.push(path);
                    }
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "add new schemes to `uri_schemes::schemes` instead: {offenders:?}"
        );
    }

    #[test]
    fn scheme_path_strips_every_prefix_form() {
        for uri in [
            "asyar-icon://localhost/a.png",
            "ASYAR-ICON://localhost/a.png",
            "asyar-icon://a.png",
            "http://asyar-icon.localhost/a.png",
        ] {
            assert_eq!(scheme_path(uri, "asyar-icon"), "a.png", "{uri}");
        }
        assert_eq!(scheme_path("other://a.png", "asyar-icon"), "other://a.png");
    }

    #[test]
    fn cache_files_reject_traversal() {
        let app = isolated_app("org.asyar.test.uri-schemes-traversal");
        for uri in [
            "asyar-icon://localhost/..%2Fsecret.png",
            "asyar-icon://localhost/a/b.png",
            "asyar-icon://localhost/a%5Cb.png",
        ] {
            let res = get(handle_icon_request, app.handle(), uri);
            assert_eq!(res.status().as_u16(), 403, "{uri}");
        }
    }

    #[test]
    fn view_html_injects_color_scheme_matching_theme_query_while_worker_does_not() {
        let app = isolated_app("org.asyar.test.uri-schemes-color-scheme");
        let handle = app.handle();
        let dist = handle
            .path()
            .app_data_dir()
            .unwrap()
            .join("extensions/scheme-probe/dist");
        std::fs::create_dir_all(&dist).unwrap();
        std::fs::write(
            dist.join("view.html"),
            b"<html><head></head><body></body></html>",
        )
        .unwrap();
        std::fs::write(
            dist.join("worker.html"),
            b"<html><head></head><body></body></html>",
        )
        .unwrap();

        let handler = handle_extension_request::<MockRuntime>;
        let get_body =
            |uri: &str| String::from_utf8(get(handler, handle, uri).body().clone()).unwrap();

        let dark = get_body(
            "http://asyar-extension.localhost/scheme-probe/view.html?view=TranslateView&theme=dark",
        );
        assert!(
            dark.contains(r#"<meta name="color-scheme" content="dark">"#),
            "{dark}"
        );
        assert!(dark.contains("window.__ASYAR_ROLE__ = \"view\""), "{dark}");

        let light = get_body("asyar-extension://scheme-probe/view.html?theme=light");
        assert!(
            light.contains(r#"<meta name="color-scheme" content="light">"#),
            "{light}"
        );

        let fallback = get_body("asyar-extension://scheme-probe/view.html");
        assert!(
            fallback.contains(r#"<meta name="color-scheme" content="light dark">"#),
            "{fallback}"
        );

        let worker =
            get_body("http://asyar-extension.localhost/scheme-probe/worker.html?theme=dark");
        assert!(!worker.contains("color-scheme"), "{worker}");

        let _ = std::fs::remove_dir_all(handle.path().app_data_dir().unwrap());
    }
}
