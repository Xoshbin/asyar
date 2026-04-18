//! `StatusBarItem` — the tree of tray-icon + menu data sent by extensions.
//!
//! The shape must round-trip with the SDK's `IStatusBarItem` interface
//! (camelCase on the wire). Top-level items always become independent tray
//! icons; children inside `submenu` become menu entries.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusBarItem {
    /// Item id. Defaulted to empty for wire payloads like `{separator:true}`
    /// where the client omits it — validation enforces non-empty ids only on
    /// top-level and non-separator children.
    #[serde(default)]
    pub id: String,
    /// Injected by the SDK proxy on the top-level item only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extension_id: Option<String>,
    /// Emoji / unicode / short label fragment shown alongside `text`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Filesystem path or `asyar-extension://` URI for the tray image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_path: Option<String>,
    /// Tooltip at top level; label in a submenu. Defaults to empty so
    /// separator items (which don't carry text) still deserialize.
    #[serde(default)]
    pub text: String,
    /// `✓` state — valid only inside a submenu.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
    /// Nested items. If present the menu-bar click opens this dropdown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submenu: Option<Vec<StatusBarItem>>,
    /// `false` greys out — valid only inside a submenu.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Divider — valid only inside a submenu.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub separator: Option<bool>,
}

impl StatusBarItem {
    pub fn leaf(id: &str, text: &str) -> Self {
        Self {
            id: id.to_string(),
            extension_id: None,
            icon: None,
            icon_path: None,
            text: text.to_string(),
            checked: None,
            submenu: None,
            enabled: None,
            separator: None,
        }
    }
}

#[cfg(test)]
mod serde_tests {
    use super::*;

    /// Regression: the SDK proxy sends `{separator: true}` with no id/text
    /// for divider rows. Before adding `#[serde(default)]` on id/text, this
    /// failed to deserialize and silently dropped the whole registerItem
    /// call, leaving the tray invisible.
    #[test]
    fn separator_only_payload_deserializes() {
        let v: StatusBarItem =
            serde_json::from_str(r#"{"separator": true}"#).expect("separator must deserialize");
        assert_eq!(v.separator, Some(true));
        assert_eq!(v.id, "");
        assert_eq!(v.text, "");
    }

    #[test]
    fn full_top_level_item_deserializes() {
        let json = r#"{"id":"coffee","icon":"☕","text":"Coffee","extensionId":"ext"}"#;
        let v: StatusBarItem = serde_json::from_str(json).unwrap();
        assert_eq!(v.id, "coffee");
        assert_eq!(v.text, "Coffee");
        assert_eq!(v.extension_id.as_deref(), Some("ext"));
    }

    #[test]
    fn submenu_with_mixed_leaves_and_separators_deserializes() {
        // Matches the Coffee playground tree verbatim.
        let json = r#"{
            "id":"coffee-pot","icon":"☕","text":"Coffee","extensionId":"ext",
            "submenu":[
                {"id":"play","text":"Playing","checked":false},
                {"separator":true},
                {"id":"quit","text":"Quit"}
            ]
        }"#;
        let v: StatusBarItem = serde_json::from_str(json).unwrap();
        let submenu = v.submenu.as_ref().unwrap();
        assert_eq!(submenu.len(), 3);
        assert_eq!(submenu[0].id, "play");
        assert_eq!(submenu[1].separator, Some(true));
        assert_eq!(submenu[1].id, "");
        assert_eq!(submenu[2].id, "quit");
    }
}
