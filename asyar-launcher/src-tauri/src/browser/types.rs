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
