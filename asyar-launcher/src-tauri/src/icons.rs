//! The one place that turns an icon string into something the launcher can
//! show. Every surface (manifest, commands, actions, search results) goes
//! through [`resolve_icon`].

pub mod copies;

use serde::{de::Error as _, Deserialize, Deserializer, Serialize};

/// A display-ready icon. Tagged by `kind` on the wire.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResolvedIcon {
    /// A glyph from the launcher's built-in icon set (`icon:<name>`). With a
    /// `color`, it is drawn on a tile of that colour.
    Glyph {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional)]
        color: Option<TileColor>,
    },
    /// Plain text, normally a single emoji.
    Emoji { value: String },
    /// A local image the webview may load: an extension's bundled file,
    /// a host scheme (`asyar-icon://`, `asyar-thumb://`) or a `data:image/`.
    /// `dark` replaces it in the dark theme; `tint` draws it as a one-colour
    /// mask filled with the text colour.
    Image {
        src: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional)]
        dark: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[specta(optional)]
        tint: Option<bool>,
    },
    /// An `https://` image. Only produced for runtime icons; manifest icons
    /// are known at install time and never need the network.
    Remote { url: String },
}

/// Tile colours for the `{ glyph, color }` icon form. Each maps to a
/// `--tile-<color>` theme token, so tiles work in light and dark.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum TileColor {
    Red,
    Orange,
    Green,
    Teal,
    Blue,
    Purple,
    Pink,
    Gray,
}

/// The `icon` field as manifest.json writes it: the short string
/// (`"icon:timer"`, an emoji, `"assets/icon.png"`), or one of two objects.
/// The objects exclude each other; mixing their fields is a parse error.
#[derive(Serialize, Debug, Clone, PartialEq, Eq, specta::Type)]
#[serde(untagged)]
pub enum ManifestIcon {
    Short(String),
    /// `{ "source": "assets/icon.png", "dark"?: "...", "tint"?: true }`
    Image {
        source: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        dark: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tint: Option<bool>,
    },
    /// `{ "glyph": "timer", "color": "orange" }`
    Tile {
        glyph: String,
        color: TileColor,
    },
}

impl<'de> Deserialize<'de> for ManifestIcon {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Fields {
            source: Option<String>,
            dark: Option<String>,
            tint: Option<bool>,
            glyph: Option<String>,
            color: Option<TileColor>,
        }

        let fields = match serde_json::Value::deserialize(d)? {
            serde_json::Value::String(s) => return Ok(Self::Short(s)),
            v @ serde_json::Value::Object(_) => {
                serde_json::from_value::<Fields>(v).map_err(D::Error::custom)?
            }
            _ => return Err(D::Error::custom("icon must be a string or an object")),
        };
        let image_form = fields.source.is_some() || fields.dark.is_some() || fields.tint.is_some();
        let tile_form = fields.glyph.is_some() || fields.color.is_some();
        match (image_form, tile_form) {
            (true, true) => Err(D::Error::custom(
                "icon uses either { source, dark, tint } or { glyph, color }, not both",
            )),
            (true, false) => Ok(Self::Image {
                source: fields
                    .source
                    .ok_or_else(|| D::Error::custom("icon object needs a `source`"))?,
                dark: fields.dark,
                tint: fields.tint,
            }),
            (false, true) => match (fields.glyph, fields.color) {
                (Some(glyph), Some(color)) => Ok(Self::Tile { glyph, color }),
                _ => Err(D::Error::custom("icon { glyph, color } needs both fields")),
            },
            (false, false) => Err(D::Error::custom(
                "icon object needs { source } or { glyph, color }",
            )),
        }
    }
}

impl From<String> for ManifestIcon {
    fn from(raw: String) -> Self {
        Self::Short(raw)
    }
}

impl ManifestIcon {
    /// Resolve with the same rules as [`resolve_icon`]. The image form only
    /// accepts images; a `dark` that isn't one is dropped.
    pub fn resolve(&self, extension_id: Option<&str>, allow_remote: bool) -> Option<ResolvedIcon> {
        match self {
            Self::Short(raw) => resolve_icon(raw, extension_id, allow_remote),
            Self::Image { source, dark, tint } => {
                let image = |raw: &str| match resolve_icon(raw, extension_id, false)? {
                    ResolvedIcon::Image { src, .. } => Some(src),
                    _ => None,
                };
                Some(ResolvedIcon::Image {
                    src: image(source)?,
                    dark: dark.as_deref().and_then(image),
                    tint: tint.filter(|t| *t),
                })
            }
            Self::Tile { glyph, color } => {
                let name = glyph.trim();
                (!name.is_empty()).then(|| ResolvedIcon::Glyph {
                    name: name.into(),
                    color: Some(*color),
                })
            }
        }
    }

    /// Every raw string that may name a bundled file.
    pub fn files(&self) -> impl Iterator<Item = &str> {
        let (a, b) = match self {
            Self::Short(raw) => (Some(raw.as_str()), None),
            Self::Image { source, dark, .. } => (Some(source.as_str()), dark.as_deref()),
            Self::Tile { .. } => (None, None),
        };
        a.into_iter().chain(b)
    }
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
        return (!name.is_empty()).then(|| ResolvedIcon::Glyph {
            name: name.into(),
            color: None,
        });
    }
    if raw.starts_with("data:image/") || HOST_IMAGE_SCHEMES.iter().any(|s| raw.starts_with(s)) {
        return Some(ResolvedIcon::Image {
            src: raw.into(),
            dark: None,
            tint: None,
        });
    }
    if raw.starts_with("https://") {
        return allow_remote.then(|| ResolvedIcon::Remote { url: raw.into() });
    }
    if raw.contains(':') {
        return None;
    }
    if looks_like_path(raw) {
        return bundled_file(raw, extension_id?);
    }
    Some(ResolvedIcon::Emoji { value: raw.into() })
}

fn looks_like_path(raw: &str) -> bool {
    raw.contains('.') || raw.contains('/') || raw.contains('\\')
}

/// The extension-relative path of a bundled icon file, or `None` when `raw`
/// is a glyph, emoji, URL or unsafe path. The same rule [`resolve_icon`]
/// uses, for code that needs the file itself (see [`copies`]).
pub(crate) fn bundled_icon_path(raw: &str) -> Option<&str> {
    let raw = raw.trim();
    if raw.contains(':') || !looks_like_path(raw) {
        return None;
    }
    safe_relative_path(raw)
}

/// Resolve an optional raw icon; shorthand for the common `Option<String>` field.
pub fn resolve_opt(
    raw: Option<&str>,
    extension_id: Option<&str>,
    allow_remote: bool,
) -> Option<ResolvedIcon> {
    resolve_icon(raw?, extension_id, allow_remote)
}

fn safe_relative_path(path: &str) -> Option<&str> {
    let path = path.strip_prefix("./").unwrap_or(path);
    let escapes = path.split('/').any(|seg| seg == "..");
    (!path.is_empty() && !path.starts_with('/') && !path.contains('\\') && !escapes).then_some(path)
}

/// The URL carries [`copies::COPY_QUERY`] so `asyar-extension://` serves the
/// 128px copy made at install when there is one.
fn bundled_file(path: &str, extension_id: &str) -> Option<ResolvedIcon> {
    let path = safe_relative_path(path)?;
    if extension_id.is_empty() {
        return None;
    }
    Some(ResolvedIcon::Image {
        src: format!(
            "asyar-extension://{extension_id}/{path}?{}",
            copies::COPY_QUERY
        ),
        dark: None,
        tint: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn img(src: &str) -> Option<ResolvedIcon> {
        Some(ResolvedIcon::Image {
            src: src.into(),
            dark: None,
            tint: None,
        })
    }

    #[test]
    fn glyph_emoji_and_empty() {
        assert_eq!(
            resolve_icon("icon:timer", None, false),
            Some(ResolvedIcon::Glyph {
                name: "timer".into(),
                color: None
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
            img("asyar-extension://org.x/assets/icon.png?icon")
        );
        assert_eq!(
            resolve_icon("./icon.svg", Some("org.x"), false),
            img("asyar-extension://org.x/icon.svg?icon")
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
        let ext_icon = img("asyar-extension://org.x/assets/icon.png?icon");
        assert_eq!(m.resolved_icon, ext_icon);
        assert_eq!(
            m.commands[0].resolved_icon,
            Some(ResolvedIcon::Glyph {
                name: "timer".into(),
                color: None
            })
        );
        assert_eq!(m.commands[1].resolved_icon, ext_icon);
        // Remote is refused for manifest icons → falls back to the extension's.
        assert_eq!(m.commands[2].resolved_icon, ext_icon);
    }

    #[test]
    fn bundled_icon_path_only_accepts_safe_relative_files() {
        assert_eq!(
            bundled_icon_path("assets/icon.png"),
            Some("assets/icon.png")
        );
        assert_eq!(bundled_icon_path(" ./icon.png "), Some("icon.png"));
        for raw in [
            "icon:timer",
            "🍅",
            "https://example.com/x.png",
            "data:image/png;base64,AAAA",
            "../x.png",
            "/abs/x.png",
            "a\\b.png",
            "",
        ] {
            assert_eq!(bundled_icon_path(raw), None, "{raw}");
        }
    }

    #[test]
    fn icon_sources_lists_every_manifest_icon() {
        let m: crate::extensions::ExtensionManifest = serde_json::from_value(serde_json::json!({
            "id": "org.x", "name": "X", "version": "1.0.0",
            "icon": "icon.png",
            "actions": [{ "id": "x", "title": "X", "icon": "x.png" }],
            "commands": [
                { "id": "a", "name": "A", "icon": "a.png",
                  "actions": [{ "id": "y", "title": "Y", "icon": "y.png" }] },
                { "id": "b", "name": "B" }
            ]
        }))
        .unwrap();
        let mut sources: Vec<_> = m.icon_sources().collect();
        sources.sort_unstable();
        assert_eq!(sources, ["a.png", "icon.png", "x.png", "y.png"]);
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
            color: None,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "glyph", "name": "timer" })
        );
    }

    fn parse(v: serde_json::Value) -> Result<ManifestIcon, String> {
        serde_json::from_value(v).map_err(|e| e.to_string())
    }

    #[test]
    fn manifest_icon_accepts_both_object_forms() {
        use serde_json::json;
        assert_eq!(
            parse(json!("icon:timer")),
            Ok(ManifestIcon::Short("icon:timer".into()))
        );
        assert_eq!(
            parse(json!({ "source": "a.png", "dark": "b.png", "tint": true })),
            Ok(ManifestIcon::Image {
                source: "a.png".into(),
                dark: Some("b.png".into()),
                tint: Some(true)
            })
        );
        assert_eq!(
            parse(json!({ "glyph": "timer", "color": "orange" })),
            Ok(ManifestIcon::Tile {
                glyph: "timer".into(),
                color: TileColor::Orange
            })
        );
    }

    #[test]
    fn manifest_icon_rejects_mixed_and_incomplete_forms() {
        use serde_json::json;
        for (v, msg) in [
            (json!({ "source": "a.png", "glyph": "timer" }), "not both"),
            (json!({ "tint": true, "color": "red" }), "not both"),
            (json!({ "dark": "b.png" }), "needs a `source`"),
            (json!({ "glyph": "timer" }), "needs both"),
            (json!({}), "needs { source }"),
            (
                json!({ "glyph": "timer", "color": "mauve" }),
                "unknown variant",
            ),
            (json!({ "source": "a.png", "size": 2 }), "unknown field"),
            (json!(42), "string or an object"),
        ] {
            let err = parse(v.clone()).unwrap_err();
            assert!(err.contains(msg), "{v}: {err}");
        }
    }

    #[test]
    fn object_forms_resolve() {
        let image = ManifestIcon::Image {
            source: "a.png".into(),
            dark: Some("b.png".into()),
            tint: Some(true),
        };
        assert_eq!(
            image.resolve(Some("org.x"), false),
            Some(ResolvedIcon::Image {
                src: "asyar-extension://org.x/a.png?icon".into(),
                dark: Some("asyar-extension://org.x/b.png?icon".into()),
                tint: Some(true),
            })
        );
        assert_eq!(image.files().collect::<Vec<_>>(), ["a.png", "b.png"]);

        // A source that isn't an image falls back; a bad `dark` is dropped.
        let emoji = ManifestIcon::Image {
            source: "🍅".into(),
            dark: None,
            tint: None,
        };
        assert_eq!(emoji.resolve(Some("org.x"), false), None);
        let bad_dark = ManifestIcon::Image {
            source: "a.png".into(),
            dark: Some("../b.png".into()),
            tint: Some(false),
        };
        assert_eq!(
            bad_dark.resolve(Some("org.x"), false),
            img("asyar-extension://org.x/a.png?icon")
        );

        let tile = ManifestIcon::Tile {
            glyph: "timer".into(),
            color: TileColor::Teal,
        };
        assert_eq!(
            tile.resolve(None, false),
            Some(ResolvedIcon::Glyph {
                name: "timer".into(),
                color: Some(TileColor::Teal)
            })
        );
        assert_eq!(tile.files().count(), 0);
    }

    #[test]
    fn indexed_commands_keep_string_and_object_icons() {
        let tile = serde_json::json!({ "glyph": "timer", "color": "blue" });
        for icon in [serde_json::json!("🍅"), tile] {
            let parsed = parse(icon.clone()).unwrap();
            assert_eq!(serde_json::to_value(&parsed).unwrap(), icon);
        }
    }
}
