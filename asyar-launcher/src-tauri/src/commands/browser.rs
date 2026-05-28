use crate::browser::service::{BrowserService, ListBookmarksFilter, SearchHistoryOptions};
use crate::browser::types::{Bookmark, BrowserFamily, BrowserId, HistoryEntry};

#[tauri::command]
pub fn browser_list_available_browsers() -> Vec<BrowserId> {
    BrowserService::new().list_available_browsers()
}

#[tauri::command]
pub fn browser_is_companion_installed(family: BrowserFamily) -> bool {
    BrowserService::new().is_companion_installed(family)
}

#[tauri::command]
pub fn browser_list_bookmarks(
    browser: Option<BrowserId>,
    query: Option<String>,
) -> Result<Vec<Bookmark>, String> {
    BrowserService::new().list_bookmarks(ListBookmarksFilter { browser, query })
}

#[tauri::command]
pub fn browser_search_history(
    query: String,
    limit: Option<u32>,
    since_ms: Option<i64>,
) -> Result<Vec<HistoryEntry>, String> {
    BrowserService::new().search_history(&query, SearchHistoryOptions { limit, since_ms })
}
