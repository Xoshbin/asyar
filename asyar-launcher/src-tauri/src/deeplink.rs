use serde::Serialize;
use std::collections::HashMap;
use tauri::AppHandle;

/// The custom URL scheme this running instance is registered for with the
/// OS. Mirrors `plugins.deep-link.desktop.schemes` in the active tauri
/// config — `tauri.conf.json` (`asyar`) for production, `tauri.dev.conf.json`
/// (`asyar-dev`) for the local dev flavor. Production and dev must never
/// register the same scheme, or the OS can deliver an OAuth or extension
/// deep link to the wrong flavor.
pub fn deep_link_scheme(app: &AppHandle) -> &'static str {
    if app.config().identifier == "org.asyar.dev" {
        "asyar-dev"
    } else {
        "asyar"
    }
}

/// Typed payload emitted as `asyar:deeplink:extension` when a deep link
/// targets an extension command: `{scheme}://extensions/{extensionId}/{commandId}?args`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionDeeplinkPayload {
    pub extension_id: String,
    pub command_id: String,
    pub args: HashMap<String, String>,
}

/// Attempts to parse a `{expected_scheme}://extensions/{extensionId}/{commandId}?args` URL.
///
/// Returns `None` (and logs a warning) if the URL is not an extension deep link,
/// has missing/empty segments, or contains unsafe characters in the extension ID.
pub fn parse_extension_deeplink(
    raw: &str,
    expected_scheme: &str,
) -> Option<ExtensionDeeplinkPayload> {
    let parsed = url::Url::parse(raw).ok()?;

    // Must be this flavor's registered scheme
    if parsed.scheme() != expected_scheme {
        return None;
    }

    // Host is "extensions" (URL parses asyar://extensions/... as host = "extensions")
    if parsed.host_str() != Some("extensions") {
        return None;
    }

    // Path segments after host: /{extensionId}/{commandId}
    let segments: Vec<&str> = parsed.path_segments()?.filter(|s| !s.is_empty()).collect();

    if segments.len() < 2 {
        log::warn!("Deep link missing extensionId or commandId: {}", raw);
        return None;
    }

    let extension_id = segments[0];
    let command_id = segments[1];

    // Validate extensionId format: alphanumeric, dots, hyphens, underscores only.
    // Prevents path traversal (e.g. "../etc/passwd") and other injection.
    if !extension_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        log::warn!(
            "Deep link extensionId contains invalid characters: {}",
            extension_id
        );
        return None;
    }

    // Validate commandId is non-empty and safe
    if !command_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        log::warn!(
            "Deep link commandId contains invalid characters: {}",
            command_id
        );
        return None;
    }

    // Collect query params with URL decoding (handled by url::Url)
    let args: HashMap<String, String> = parsed
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();

    Some(ExtensionDeeplinkPayload {
        extension_id: extension_id.to_string(),
        command_id: command_id.to_string(),
        args,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_deeplink_with_args() {
        let result = parse_extension_deeplink(
            "asyar://extensions/com.example.weather/check?city=Berlin&units=metric",
            "asyar",
        );
        let payload = result.expect("should parse successfully");
        assert_eq!(payload.extension_id, "com.example.weather");
        assert_eq!(payload.command_id, "check");
        assert_eq!(payload.args.get("city"), Some(&"Berlin".to_string()));
        assert_eq!(payload.args.get("units"), Some(&"metric".to_string()));
    }

    #[test]
    fn parses_valid_deeplink_without_args() {
        let result = parse_extension_deeplink("asyar://extensions/com.example.calc/run", "asyar");
        let payload = result.expect("should parse successfully");
        assert_eq!(payload.extension_id, "com.example.calc");
        assert_eq!(payload.command_id, "run");
        assert!(payload.args.is_empty());
    }

    #[test]
    fn rejects_missing_command_id() {
        assert!(parse_extension_deeplink("asyar://extensions/com.example.calc", "asyar").is_none());
    }

    #[test]
    fn rejects_empty_extension_id() {
        assert!(parse_extension_deeplink("asyar://extensions//run", "asyar").is_none());
    }

    #[test]
    fn rejects_path_traversal_in_extension_id() {
        // Dots in isolation are fine (e.g. "com.example"), but characters like
        // slashes or percent-encoded slashes would be caught by the URL parser
        // or the character allowlist. Test that special chars are rejected:
        assert!(
            parse_extension_deeplink("asyar://extensions/ext%2F..%2Fetc/run", "asyar").is_none()
        );
        assert!(parse_extension_deeplink("asyar://extensions/ext%00id/run", "asyar").is_none());
    }

    #[test]
    fn rejects_non_extension_deeplinks() {
        assert!(parse_extension_deeplink("asyar://auth/callback?code=abc", "asyar").is_none());
    }

    #[test]
    fn handles_url_encoded_args() {
        let result =
            parse_extension_deeplink("asyar://extensions/ext/cmd?q=hello%20world&n=42", "asyar");
        let payload = result.expect("should parse successfully");
        assert_eq!(payload.args.get("q"), Some(&"hello world".to_string()));
        assert_eq!(payload.args.get("n"), Some(&"42".to_string()));
    }

    #[test]
    fn rejects_non_asyar_scheme() {
        assert!(parse_extension_deeplink("https://extensions/com.example/cmd", "asyar").is_none());
    }

    #[test]
    fn accepts_hyphenated_and_underscored_ids() {
        let result = parse_extension_deeplink("asyar://extensions/my-ext_v2/do-thing_now", "asyar");
        let payload = result.expect("should parse successfully");
        assert_eq!(payload.extension_id, "my-ext_v2");
        assert_eq!(payload.command_id, "do-thing_now");
    }

    #[test]
    fn serializes_payload_as_camel_case() {
        let payload = ExtensionDeeplinkPayload {
            extension_id: "test".to_string(),
            command_id: "cmd".to_string(),
            args: HashMap::new(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("extensionId"));
        assert!(json.contains("commandId"));
        assert!(!json.contains("extension_id"));
    }

    #[test]
    fn parses_store_browse_deeplink_with_slug() {
        let result = parse_extension_deeplink(
            "asyar://extensions/store/browse?slug=pomodoro-timer",
            "asyar",
        );
        let payload = result.expect("should parse store browse deeplink");
        assert_eq!(payload.extension_id, "store");
        assert_eq!(payload.command_id, "browse");
        assert_eq!(
            payload.args.get("slug"),
            Some(&"pomodoro-timer".to_string())
        );
    }

    #[test]
    fn accepts_dev_scheme_when_expected() {
        let result =
            parse_extension_deeplink("asyar-dev://extensions/com.example.calc/run", "asyar-dev");
        let payload = result.expect("should parse the dev-flavor scheme");
        assert_eq!(payload.extension_id, "com.example.calc");
        assert_eq!(payload.command_id, "run");
    }

    #[test]
    fn rejects_prod_scheme_when_dev_expected() {
        // A link for the installed production app must not be accepted by a
        // dev-flavor instance, and vice versa — the two must stay isolated.
        assert!(
            parse_extension_deeplink("asyar://extensions/com.example.calc/run", "asyar-dev")
                .is_none()
        );
    }
}
