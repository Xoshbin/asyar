use tauri::Manager;

/// URI scheme handlers for `asyar-extension://` and `asyar-icon://`.
///
/// These are registered in `lib.rs` via `register_uri_scheme_protocol` and serve
/// extension bundle files and cached application icons respectively.

// ── asyar-extension:// ────────────────────────────────────────────────────────

/// Serves files from installed/built-in/dev extensions under the `asyar-extension://` scheme.
///
/// Lookup priority:
/// 0. Dev registry (`dev_extensions.json`) — hotlinked source during development
/// 1. Debug build fallback — `src/built-in-extensions/{id}/dist/` (debug only)
/// 2. Built-in resources — bundled inside the app binary
/// 3. Installed extensions — `$APPDATA/extensions/{id}/`
pub fn handle_extension_request(
    app: &tauri::AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let uri = request.uri().to_string();
    let path = if uri.starts_with("asyar-extension://localhost/") {
        uri.strip_prefix("asyar-extension://localhost/").unwrap()
    } else if uri.starts_with("asyar-extension://") {
        uri.strip_prefix("asyar-extension://").unwrap()
    } else if uri.starts_with("http://asyar-extension.localhost/") {
        uri.strip_prefix("http://asyar-extension.localhost/").unwrap()
    } else {
        &uri
    };

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
    let file_path = encoded_file_path
        .split('?')
        .next()
        .unwrap_or(encoded_file_path)
        .split('#')
        .next()
        .unwrap_or(encoded_file_path);

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
                        std::path::PathBuf::from(base_path).join("dist").join(file_path),
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
            .join("src/built-in-extensions")
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
            .join("built-in-extensions")
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

    match final_path {
        Some(resolved_path) => {
            // Step 1: Canonicalize to resolve any symlinks
            let canonical_path = match std::fs::canonicalize(&resolved_path) {
                Ok(p) => p,
                Err(_) => {
                    return tauri::http::Response::builder()
                        .status(404)
                        .body(Vec::new())
                        .unwrap();
                }
            };

            // Step 2: Validate the canonical path is in an allowed location
            if !is_path_allowed(&canonical_path, app) {
                return tauri::http::Response::builder()
                    .status(403)
                    .body(b"Access denied".to_vec())
                    .unwrap();
            }

            // Step 3: Read from the canonical (real) path
            let content = match std::fs::read(&canonical_path) {
                Ok(bytes) => bytes,
                Err(_) => {
                    return tauri::http::Response::builder()
                        .status(404)
                        .body(b"File not found".to_vec())
                        .unwrap();
                }
            };

            let mime_type = match canonical_path.extension().and_then(|e| e.to_str()) {
                Some("html") => "text/html",
                Some("js") => "application/javascript",
                Some("css") => "text/css",
                Some("png") => "image/png",
                Some("svg") => "image/svg+xml",
                Some("json") => "application/json",
                _ => "text/plain",
            };

            tauri::http::Response::builder()
                .header("Content-Type", mime_type)
                .header("Access-Control-Allow-Origin", "*")
                .header("Content-Security-Policy", "default-src asyar-extension: 'self'; script-src asyar-extension: 'self' 'unsafe-inline' 'unsafe-eval'; style-src asyar-extension: 'self' 'unsafe-inline'; font-src asyar-extension: 'self'; img-src asyar-extension: 'self' asyar-icon: http://asyar-icon.localhost data:;")
                .body(content)
                .unwrap()
        }
        None => tauri::http::Response::builder()
            .status(404)
            .body(Vec::new())
            .unwrap(),
    }
}

// ── asyar-icon:// ─────────────────────────────────────────────────────────────

/// Serves cached application icons from `$APPDATA/icon_cache/` under the `asyar-icon://` scheme.
pub fn handle_icon_request(
    app: &tauri::AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let uri = request.uri().to_string();
    let uri_lower = uri.to_lowercase();

    log::debug!("Icon request URI: {}", uri);

    let mut path = if uri_lower.starts_with("asyar-icon://localhost/") {
        &uri["asyar-icon://localhost/".len()..]
    } else if uri_lower.starts_with("asyar-icon://") {
        &uri["asyar-icon://".len()..]
    } else if uri_lower.starts_with("http://asyar-icon.localhost/") {
        &uri["http://asyar-icon.localhost/".len()..]
    } else {
        &uri
    };

    // Trim trailing slash if present (often added by webview for host-only URIs)
    if path.ends_with('/') {
        path = &path[..path.len() - 1];
    }

    // Percent-decode the path (e.g. for parentheses or spaces)
    let decoded_path = percent_encoding::percent_decode_str(path).decode_utf8_lossy();
    let path = &decoded_path;

    let icon_cache_dir = app
        .path()
        .app_data_dir()
        .map(|p| p.join("icon_cache"))
        .unwrap_or_else(|_| {
            #[cfg(target_os = "windows")]
            {
                app.path()
                    .app_local_data_dir()
                    .unwrap_or_default()
                    .join("icon_cache")
            }
            #[cfg(not(target_os = "windows"))]
            {
                std::path::PathBuf::from("/tmp/asyar_icon_cache")
            }
        });

    // Strip any query parameters or fragments
    let filename = path
        .split('?')
        .next()
        .unwrap_or(path)
        .split('#')
        .next()
        .unwrap_or(path);

    // [SECURITY]: Prevent path traversal
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        log::warn!("Icon security violation (traversal): {}", filename);
        return tauri::http::Response::builder()
            .status(403)
            .body(Vec::new())
            .unwrap();
    }

    let file_path = icon_cache_dir.join(filename);

    match std::fs::read(&file_path) {
        Ok(bytes) => tauri::http::Response::builder()
            .header("Content-Type", "image/png")
            .header("Access-Control-Allow-Origin", "*")
            .body(bytes)
            .unwrap(),
        Err(e) => {
            log::debug!("Icon not found in cache: {:?} ({})", file_path, e);
            tauri::http::Response::builder()
                .status(404)
                .body(Vec::new())
                .unwrap()
        }
    }
}

// ── Path allow-list ───────────────────────────────────────────────────────────

/// Returns `true` if `path` is within an approved location for extension file serving.
///
/// In release builds only `$APPDATA/extensions` and `$APPLOCALDATA/extensions` are
/// permitted. Debug builds additionally allow any path under the user's home directory
/// so that symlink-linked dev extensions resolve correctly.
fn is_path_allowed(path: &std::path::Path, app: &tauri::AppHandle) -> bool {
    // Allow 1: Path is inside the app's extensions directory
    if let Ok(extensions_dir) = app.path().app_data_dir().map(|p| p.join("extensions")) {
        if path.starts_with(&extensions_dir) {
            return true;
        }
    }

    // Allow 2: Path is inside the app's local data extensions directory (Windows)
    if let Ok(local_extensions_dir) = app
        .path()
        .app_local_data_dir()
        .map(|p| p.join("extensions"))
    {
        if path.starts_with(&local_extensions_dir) {
            return true;
        }
    }

    // Allow 3: Path is inside the user's home directory
    // This covers developer symlink targets like ~/develop/extensions/my-ext/
    #[cfg(debug_assertions)]
    if let Some(home_dir) = dirs::home_dir() {
        if path.starts_with(&home_dir) {
            return true;
        }
    }

    // Allow 4: Debug builds only — allow any path for development flexibility
    #[cfg(debug_assertions)]
    {
        return true;
    }

    #[cfg(not(debug_assertions))]
    false
}
