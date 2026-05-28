use crate::browser::bridge::BridgeState;
use crate::browser::service::{BrowserService, ListBookmarksFilter, SearchHistoryOptions};
use crate::browser::types::{
    Bookmark, BrowserFamily, BrowserId, HistoryEntry, OpenUrlTarget, PairDecision, Tab,
};
use tauri::State;

#[tauri::command]
pub fn browser_list_available_browsers() -> Vec<BrowserId> {
    BrowserService::new().list_available_browsers()
}

#[tauri::command]
pub async fn browser_is_companion_installed(
    bridge: State<'_, BridgeState>,
    family: BrowserFamily,
) -> Result<bool, String> {
    Ok(BrowserService::new()
        .is_companion_installed_via(bridge.inner(), family)
        .await)
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

#[tauri::command]
pub async fn browser_list_tabs(
    bridge: State<'_, BridgeState>,
    browser: Option<BrowserId>,
    query: Option<String>,
) -> Result<Vec<Tab>, String> {
    BrowserService::new()
        .list_tabs(bridge.inner(), browser, query)
        .await
}

#[tauri::command]
pub async fn browser_get_active_tab(
    bridge: State<'_, BridgeState>,
    browser: Option<BrowserId>,
) -> Result<Option<Tab>, String> {
    BrowserService::new()
        .get_active_tab(bridge.inner(), browser)
        .await
}

#[tauri::command]
pub async fn browser_activate_tab(
    bridge: State<'_, BridgeState>,
    tab_id: String,
) -> Result<(), String> {
    BrowserService::new()
        .activate_tab(bridge.inner(), tab_id)
        .await
}

#[tauri::command]
pub async fn browser_close_tab(
    bridge: State<'_, BridgeState>,
    tab_id: String,
) -> Result<(), String> {
    BrowserService::new().close_tab(bridge.inner(), tab_id).await
}

#[tauri::command]
pub async fn browser_open_url(
    bridge: State<'_, BridgeState>,
    url: String,
    target: Option<OpenUrlTarget>,
) -> Result<(), String> {
    BrowserService::new()
        .open_url(bridge.inner(), url, target)
        .await
}

#[tauri::command]
pub async fn browser_list_paired_browsers(
    bridge: State<'_, BridgeState>,
) -> Result<Vec<crate::browser::types::BrowserKey>, String> {
    BrowserService::new()
        .list_paired_browsers(bridge.inner())
        .await
}

use crate::browser::bridge::token_store::generate_token;

#[derive(serde::Serialize)]
pub struct PendingPairingDto {
    pub id: String,
    pub family: String,
    pub variant: String,
}

#[tauri::command]
pub async fn browser_list_pending_pairings(
    bridge: State<'_, BridgeState>,
) -> Result<Vec<PendingPairingDto>, String> {
    Ok(bridge
        .pairing
        .pending_requests()
        .await
        .into_iter()
        .map(|p| PendingPairingDto {
            id: p.id,
            family: match p.browser.family {
                BrowserFamily::Chromium => "chromium",
                BrowserFamily::Firefox => "firefox",
                BrowserFamily::Safari => "safari",
            }
            .to_string(),
            variant: p.browser.variant,
        })
        .collect())
}

#[tauri::command]
pub async fn browser_resolve_pairing(
    bridge: State<'_, BridgeState>,
    pairing_id: String,
    decision: PairDecision,
) -> Result<(), String> {
    let key = bridge
        .pairing
        .browser_for(&pairing_id)
        .await
        .ok_or_else(|| format!("unknown pairing id: {}", pairing_id))?;
    let token = match decision {
        PairDecision::Allow => {
            let t = generate_token();
            bridge.tokens.set(&key, &t)?;
            Some(t)
        }
        PairDecision::Deny => None,
    };
    bridge.pairing.resolve(&pairing_id, decision, token).await
}

#[tauri::command]
pub async fn browser_revoke_pairing(
    bridge: State<'_, BridgeState>,
    family: BrowserFamily,
    variant: String,
) -> Result<(), String> {
    let key = crate::browser::types::BrowserKey { family, variant };
    bridge.tokens.delete(&key)?;
    bridge.connections.unregister(&key).await;
    Ok(())
}
