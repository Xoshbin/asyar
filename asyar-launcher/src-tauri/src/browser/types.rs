use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrowserFamily {
    Chromium,
    Firefox,
    Safari,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct BrowserId {
    pub family: BrowserFamily,
    pub variant: String,
    #[serde(rename = "profileId")]
    pub profile_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: String,
    pub browser: BrowserId,
    pub title: String,
    pub url: String,
    #[serde(rename = "folderPath")]
    pub folder_path: Vec<String>,
    #[serde(rename = "addedAt")]
    pub added_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub url: String,
    pub title: String,
    pub browser: BrowserId,
    #[serde(rename = "lastVisitAt")]
    pub last_visit_at: i64,
    #[serde(rename = "visitCount")]
    pub visit_count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tab {
    pub id: String,
    pub browser: BrowserId,
    #[serde(rename = "windowId")]
    pub window_id: String,
    pub index: u32,
    pub title: String,
    pub url: String,
    #[serde(rename = "faviconUrl", skip_serializing_if = "Option::is_none")]
    pub favicon_url: Option<String>,
    #[serde(rename = "isActive")]
    pub is_active: bool,
    #[serde(rename = "isPinned")]
    pub is_pinned: bool,
    #[serde(rename = "isAudible")]
    pub is_audible: bool,
    #[serde(rename = "groupName", skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct OpenUrlTarget {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser: Option<BrowserId>,
    #[serde(rename = "newWindow", skip_serializing_if = "Option::is_none")]
    pub new_window: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PairDecision {
    Allow,
    Deny,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserKey {
    pub family: BrowserFamily,
    pub variant: String,
}

impl BrowserKey {
    pub fn from_id(id: &BrowserId) -> Self {
        Self {
            family: id.family,
            variant: id.variant.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PageMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub og_image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSnapshot {
    pub url: String,
    pub title: String,
    pub readable_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection: Option<String>,
    pub meta: PageMeta,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMatch {
    pub tag: String,
    /// Companion-side wire contract: all values are stringified by the companion
    /// before emit. Numeric/boolean attributes are sent as their string form.
    pub attrs: std::collections::BTreeMap<String, String>,
    pub text_content: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PageAction {
    Reload,
    GoBack,
    GoForward,
    ScrollToTop,
}

#[cfg(test)]
mod page_types_tests {
    use super::*;

    #[test]
    fn page_snapshot_round_trips_camel_case() {
        let snap = PageSnapshot {
            url: "https://x".to_string(),
            title: "T".to_string(),
            readable_text: "body".to_string(),
            html: None,
            selection: None,
            meta: PageMeta {
                description: Some("d".to_string()),
                og_image: None,
                lang: Some("en".to_string()),
            },
        };
        let json = serde_json::to_value(&snap).unwrap();
        assert_eq!(json["readableText"], "body");
        assert!(json.get("html").is_none(), "None html should be omitted");
        assert_eq!(json["meta"]["ogImage"], serde_json::Value::Null);
    }

    #[test]
    fn page_action_serializes_with_tag_field() {
        let a = PageAction::Reload;
        let json = serde_json::to_value(&a).unwrap();
        assert_eq!(json["kind"], "reload");

        let q = PageAction::ScrollToTop;
        let json = serde_json::to_value(&q).unwrap();
        assert_eq!(json["kind"], "scrollToTop");
    }

    #[test]
    fn page_match_serializes_with_attrs() {
        let mut attrs = std::collections::BTreeMap::new();
        attrs.insert("href".to_string(), "https://x".to_string());
        let m = PageMatch {
            tag: "a".to_string(),
            attrs,
            text_content: "Link".to_string(),
        };
        let json = serde_json::to_value(&m).unwrap();
        assert_eq!(json["tag"], "a");
        assert_eq!(json["textContent"], "Link");
        assert_eq!(json["attrs"]["href"], "https://x");
    }

    #[test]
    fn page_match_rejects_non_string_attr_values() {
        // Companions must stringify; numeric values are rejected at deserialize time
        // so a mis-behaving companion fails loudly rather than corrupting downstream
        // extension code.
        let raw = serde_json::json!({
            "tag": "div",
            "attrs": { "data-count": 42 },
            "textContent": "x"
        });
        let parsed: Result<PageMatch, _> = serde_json::from_value(raw);
        assert!(parsed.is_err(), "non-string attr values must be rejected");
    }
}
