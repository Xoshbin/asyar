//! Pure-function helpers for the `shell:open-url` declared-scheme
//! allowlist.
//!
//! Bare `shell:open-url` keeps meaning the web schemes the webview ACL
//! (`opener:allow-default-urls`) always allowed; a manifest's
//! `permissionArgs["shell:open-url"]` EXTENDS that set with additional
//! schemes (`steam`, `vscode`, …), exact-matched lowercase — no globs.
//! Schemeless/relative URLs are rejected outright. The check runs in the
//! Rust commands that reach `tauri_plugin_opener`'s scope-free Rust-side
//! `open_url` (`opener_open_url`, `browser_open_url`), so the webview ACL
//! itself stays web-only for host code.

use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;

/// The schemes every `shell:open-url` holder may open — the same set the
/// webview ACL's `opener:allow-default-urls` grants.
pub const WEB_DEFAULT_SCHEMES: &[&str] = &["http", "https", "mailto", "tel"];

/// Schemes an extension may never declare: these launch content the OS
/// treats as executable/scriptable rather than a protocol handler.
const SCHEME_DENY: &[&str] = &["file", "javascript", "data", "vbscript"];

/// Extract the URL scheme (RFC 3986: `ALPHA *( ALPHA / DIGIT / "+" / "-"
/// / "." )` before the first `:`), lowercased. `None` for schemeless or
/// relative inputs.
pub fn parse_scheme(url: &str) -> Option<String> {
    let colon = url.find(':')?;
    let scheme = &url[..colon];
    let mut chars = scheme.chars();
    let first = chars.next()?;
    if !first.is_ascii_alphabetic() {
        return None;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')) {
        return None;
    }
    Some(scheme.to_ascii_lowercase())
}

/// Validate a single declared scheme at extension load time. Must be a
/// lowercase RFC 3986 scheme name of at least two characters (a
/// single-letter scheme is indistinguishable from a Windows drive-letter
/// path) and not on the deny-list.
pub fn validate_declared_scheme(scheme: &str) -> Result<(), AppError> {
    let valid_shape = scheme.len() >= 2
        && scheme.starts_with(|c: char| c.is_ascii_lowercase())
        && scheme
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '+' | '-' | '.'));
    if !valid_shape {
        return Err(AppError::Validation(format!(
            "shell:open-url scheme '{}' is not a valid scheme name (lowercase letters/digits/+-., \
             starting with a letter, at least two characters)",
            scheme
        )));
    }
    if SCHEME_DENY.contains(&scheme) {
        return Err(AppError::Validation(format!(
            "shell:open-url scheme '{}' cannot be declared",
            scheme
        )));
    }
    Ok(())
}

/// The extension's declared extra schemes, or empty when it declared none
/// (bare `shell:open-url`). Malformed arg shapes are rejected at manifest
/// load; anything unexpected here degrades to "no extra schemes".
pub fn declared_schemes(registry: &ExtensionPermissionRegistry, extension_id: &str) -> Vec<String> {
    registry
        .args_for(extension_id, "shell:open-url")
        .and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|s| s.as_str().map(String::from))
                    .collect()
            })
        })
        .unwrap_or_default()
}

/// Allow the open when the URL's scheme is a web default or in the
/// caller's declared list. Schemeless/relative URLs are rejected.
pub fn check_url_allowed(url: &str, declared: &[String]) -> Result<(), AppError> {
    let scheme = parse_scheme(url).ok_or_else(|| {
        AppError::Validation(format!(
            "shell:open-url: '{}' has no URL scheme — schemeless and relative URLs are not allowed",
            url
        ))
    })?;
    if WEB_DEFAULT_SCHEMES.contains(&scheme.as_str()) || declared.iter().any(|d| d == &scheme) {
        Ok(())
    } else {
        Err(AppError::Permission(format!(
            "shell:open-url: scheme '{}' is not a web default and is not in the caller's declared scheme list",
            scheme
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    // ---- parse_scheme ----

    #[test]
    fn parses_and_lowercases_schemes() {
        assert_eq!(parse_scheme("https://x").as_deref(), Some("https"));
        assert_eq!(parse_scheme("STEAM://run/42").as_deref(), Some("steam"));
        assert_eq!(parse_scheme("zoommtg://join").as_deref(), Some("zoommtg"));
        assert_eq!(parse_scheme("web+app:x").as_deref(), Some("web+app"));
    }

    #[test]
    fn rejects_schemeless_and_relative() {
        assert_eq!(parse_scheme("example.com/path"), None);
        assert_eq!(parse_scheme("/absolute/path"), None);
        assert_eq!(parse_scheme("./relative"), None);
        assert_eq!(parse_scheme(""), None);
        assert_eq!(parse_scheme(":no-scheme"), None);
        assert_eq!(parse_scheme("1abc://x"), None);
    }

    #[test]
    fn windows_drive_path_parses_as_single_letter_scheme() {
        // "C:\evil.exe" technically parses as scheme "c" — which can never
        // be declared (validate_declared_scheme requires >= 2 chars) and is
        // no web default, so drive-letter paths are always denied.
        assert_eq!(parse_scheme("C:\\evil.exe").as_deref(), Some("c"));
    }

    // ---- validate_declared_scheme ----

    #[test]
    fn accepts_ordinary_schemes() {
        for s in [
            "steam", "vscode", "obsidian", "zoommtg", "web+app", "x-y.z1",
        ] {
            assert!(validate_declared_scheme(s).is_ok(), "expected ok for {s}");
        }
    }

    #[test]
    fn rejects_invalid_shapes() {
        for s in ["", "c", "Steam", "ste am", "st:eam", "1steam", "+steam"] {
            assert!(validate_declared_scheme(s).is_err(), "expected err for {s}");
        }
    }

    #[test]
    fn rejects_denied_schemes() {
        for s in ["file", "javascript", "data", "vbscript"] {
            let err = validate_declared_scheme(s).unwrap_err();
            assert!(
                format!("{err}").contains("cannot be declared"),
                "got: {err}"
            );
        }
    }

    // ---- declared_schemes ----

    fn registry_with(args_value: Option<serde_json::Value>) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::default();
        let mut args = HashMap::new();
        if let Some(v) = args_value {
            args.insert("shell:open-url".to_string(), v);
        }
        reg.register("ext.a", HashSet::from(["shell:open-url".to_string()]), args);
        reg
    }

    #[test]
    fn declared_schemes_returns_registered_list() {
        let reg = registry_with(Some(serde_json::json!(["steam", "vscode"])));
        assert_eq!(declared_schemes(&reg, "ext.a"), vec!["steam", "vscode"]);
    }

    #[test]
    fn declared_schemes_empty_when_bare_permission() {
        let reg = registry_with(None);
        assert!(declared_schemes(&reg, "ext.a").is_empty());
    }

    #[test]
    fn declared_schemes_empty_when_extension_unknown() {
        let reg = ExtensionPermissionRegistry::default();
        assert!(declared_schemes(&reg, "ext.missing").is_empty());
    }

    // ---- check_url_allowed ----

    #[test]
    fn web_defaults_always_allowed() {
        for url in [
            "https://example.com",
            "http://example.com",
            "mailto:a@b.c",
            "tel:+1555",
        ] {
            assert!(check_url_allowed(url, &[]).is_ok(), "expected ok for {url}");
        }
    }

    #[test]
    fn declared_scheme_allowed_case_insensitively_on_the_url() {
        let declared = vec!["steam".to_string()];
        assert!(check_url_allowed("steam://run/3932890", &declared).is_ok());
        assert!(check_url_allowed("STEAM://run/3932890", &declared).is_ok());
    }

    #[test]
    fn undeclared_scheme_rejected() {
        let err = check_url_allowed("steam://run/42", &[]).unwrap_err();
        assert!(
            format!("{err}").contains("declared scheme list"),
            "got: {err}"
        );
        let declared = vec!["vscode".to_string()];
        assert!(check_url_allowed("steam://run/42", &declared).is_err());
    }

    #[test]
    fn schemeless_url_rejected_outright() {
        let err = check_url_allowed("example.com/path", &[]).unwrap_err();
        assert!(format!("{err}").contains("no URL scheme"), "got: {err}");
    }

    #[test]
    fn drive_letter_path_rejected() {
        assert!(check_url_allowed("C:\\Users\\x\\evil.exe", &[]).is_err());
    }
}
