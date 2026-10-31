//! The one place that turns an icon string into something the launcher can
//! show. Every surface (manifest, commands, actions, search results) goes
//! through [`resolve_icon`].

use serde::{Deserialize, Serialize};

/// A display-ready icon. Tagged by `kind` on the wire.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResolvedIcon {
    /// A glyph from the launcher's built-in icon set (`icon:<name>`).
    Glyph { name: String },
    /// Plain text, normally a single emoji.
    Emoji { value: String },
    /// A local image the webview may load: an extension's bundled file,
    /// a host scheme (`asyar-icon://`, `asyar-thumb://`) or a `data:image/`.
    Image { src: String },
    /// An `https://` image. Only produced for runtime icons; manifest icons
    /// are known at install time and never need the network.
    Remote { url: String },
}

const HOST_IMAGE_SCHEMES: &[&str] = &["asyar-extension://", "asyar-icon://", "asyar-thumb://"];

/// Resolve a raw icon string.
///
/// * `extension_id` — owner used to turn a relative path into an
///   `asyar-extension://{id}/{path}` URL. Without it, relative paths resolve
///   to `None`.
/// * `allow_remote` — whether `https://` is accepted. `false` for manifest
///   icons.
///
/// Returns `None` for empty or unsafe input (`..`, absolute paths,
/// `file://`, `http://`), so callers fall back to their default icon.
pub fn resolve_icon(
    raw: &str,
    extension_id: Option<&str>,
    allow_remote: bool,
) -> Option<ResolvedIcon> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let Some(name) = raw.strip_prefix("icon:") {
        return (!name.is_empty()).then(|| ResolvedIcon::Glyph { name: name.into() });
    }
    if raw.starts_with("data:image/") || HOST_IMAGE_SCHEMES.iter().any(|s| raw.starts_with(s)) {
        return Some(ResolvedIcon::Image { src: raw.into() });
    }
    if raw.starts_with("https://") {
        return allow_remote.then(|| ResolvedIcon::Remote { url: raw.into() });
    }
    if raw.contains(':') {
        return None;
    }
    if raw.contains('.') || raw.contains('/') || raw.contains('\\') {
        return bundled_file(raw, extension_id?);
    }
    Some(ResolvedIcon::Emoji { value: raw.into() })
}

/// Resolve an optional raw icon; shorthand for the common `Option<String>` field.
pub fn resolve_opt(
    raw: Option<&str>,
    extension_id: Option<&str>,
    allow_remote: bool,
) -> Option<ResolvedIcon> {
    resolve_icon(raw?, extension_id, allow_remote)
}

fn bundled_file(path: &str, extension_id: &str) -> Option<ResolvedIcon> {
    let path = path.strip_prefix("./").unwrap_or(path);
    let escapes = path.split('/').any(|seg| seg == "..");
    if path.starts_with('/') || path.contains('\\') || escapes || extension_id.is_empty() {
        return None;
    }
    Some(ResolvedIcon::Image {
        src: format!("asyar-extension://{extension_id}/{path}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn img(src: &str) -> Option<ResolvedIcon> {
        Some(ResolvedIcon::Image { src: src.into() })
    }

    #[test]
    fn glyph_emoji_and_empty() {
        assert_eq!(
            resolve_icon("icon:timer", None, false),
            Some(ResolvedIcon::Glyph {
                name: "timer".into()
            })
        );
        assert_eq!(
            resolve_icon("🍅", None, false),
            Some(ResolvedIcon::Emoji {
                value: "🍅".into()
            })
        );
        assert_eq!(resolve_icon("  ", None, false), None);
        assert_eq!(resolve_icon("icon:", None, false), None);
    }

    #[test]
    fn relative_paths_become_extension_urls() {
        assert_eq!(
            resolve_icon("assets/icon.png", Some("org.x"), false),
            img("asyar-extension://org.x/assets/icon.png")
        );
        assert_eq!(
            resolve_icon("./icon.svg", Some("org.x"), false),
            img("asyar-extension://org.x/icon.svg")
        );
        // No owner → nothing to resolve against.
        assert_eq!(resolve_icon("icon.png", None, false), None);
    }

    #[test]
    fn unsafe_paths_are_rejected() {
        for raw in [
            "../secret.png",
            "assets/../../x.png",
            "/etc/passwd.png",
            "C:\\x.png",
            "C:/x.png",
            "assets\\x.png",
            "file:///x.png",
            "http://example.com/x.png",
            "javascript:alert(1)",
            "data:text/html,<script>",
        ] {
            assert_eq!(resolve_icon(raw, Some("org.x"), true), None, "{raw}");
        }
    }

    #[test]
    fn host_schemes_and_data_pass_through() {
        for raw in [
            "asyar-icon://localhost/safari.png",
            "asyar-thumb://localhost/a.png",
            "asyar-extension://org.x/icon.png",
            "data:image/png;base64,AAAA",
        ] {
            assert_eq!(resolve_icon(raw, Some("org.x"), false), img(raw));
        }
    }

    #[test]
    fn remote_only_when_allowed() {
        let url = "https://example.com/x.png";
        assert_eq!(resolve_icon(url, Some("org.x"), false), None);
        assert_eq!(
            resolve_icon(url, Some("org.x"), true),
            Some(ResolvedIcon::Remote { url: url.into() })
        );
    }

    #[test]
    fn manifest_icons_resolve_with_command_fallback() {
        let mut m: crate::extensions::ExtensionManifest =
            serde_json::from_value(serde_json::json!({
                "id": "org.x", "name": "X", "version": "1.0.0",
                "icon": "assets/icon.png",
                "commands": [
                    { "id": "a", "name": "A", "icon": "icon:timer" },
                    { "id": "b", "name": "B" },
                    { "id": "c", "name": "C", "icon": "https://example.com/x.png" }
                ]
            }))
            .unwrap();
        m.resolve_icons();
        let ext_icon = img("asyar-extension://org.x/assets/icon.png");
        assert_eq!(m.resolved_icon, ext_icon);
        assert_eq!(
            m.commands[0].resolved_icon,
            Some(ResolvedIcon::Glyph {
                name: "timer".into()
            })
        );
        assert_eq!(m.commands[1].resolved_icon, ext_icon);
        // Remote is refused for manifest icons → falls back to the extension's.
        assert_eq!(m.commands[2].resolved_icon, ext_icon);
    }

    #[test]
    fn manifest_cannot_inject_a_resolved_icon() {
        let res =
            serde_json::from_value::<crate::extensions::ExtensionManifest>(serde_json::json!({
                "id": "org.x", "name": "X", "version": "1.0.0",
                "resolvedIcon": { "kind": "remote", "url": "https://evil.example/x.png" }
            }));
        assert!(res.is_err());
    }

    #[test]
    fn serializes_with_kind_tag() {
        let json = serde_json::to_value(ResolvedIcon::Glyph {
            name: "timer".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "glyph", "name": "timer" })
        );
    }
}
