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

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct BrowserKey {
    pub family: BrowserFamily,
    pub variant: String,
}

impl BrowserKey {
    pub fn from_id(id: &BrowserId) -> Self {
        Self { family: id.family, variant: id.variant.clone() }
    }
}
