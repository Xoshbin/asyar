use crate::browser::bridge::BridgeState;
use crate::browser::service::{BrowserService, ListBookmarksFilter, SearchHistoryOptions};
use crate::browser::types::{
    Bookmark, BrowserFamily, BrowserId, BrowserKey, HistoryEntry, OpenUrlTarget, PairDecision, Tab,
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
    BrowserService::new()
        .close_tab(bridge.inner(), tab_id)
        .await
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

#[tauri::command]
pub async fn browser_search_web(
    bridge: State<'_, BridgeState>,
    text: String,
    browser: Option<BrowserId>,
) -> Result<(), String> {
    BrowserService::new()
        .search_web(bridge.inner(), text, browser)
        .await
}

#[tauri::command]
pub fn browser_get_most_recent_active_browser(
    bridge: State<'_, BridgeState>,
) -> Option<BrowserKey> {
    BrowserService::new().most_recent_active_browser(bridge.inner())
}

// ── Browser page methods ──────────────────────────────────────────────────

use crate::browser::types::{PageAction, PageMatch, PageSnapshot};

#[tauri::command]
pub async fn browser_get_current_page(
    bridge: State<'_, BridgeState>,
    browser: Option<BrowserId>,
) -> Result<Option<PageSnapshot>, String> {
    BrowserService::new()
        .get_current_page(bridge.inner(), browser)
        .await
}

#[tauri::command]
pub async fn browser_query_page(
    bridge: State<'_, BridgeState>,
    tab_id: String,
    selector: String,
    attrs: Option<Vec<String>>,
) -> Result<Vec<PageMatch>, String> {
    BrowserService::new()
        .query_page(bridge.inner(), tab_id, selector, attrs)
        .await
}

#[tauri::command]
pub async fn browser_act_on_page(
    bridge: State<'_, BridgeState>,
    tab_id: String,
    action: PageAction,
) -> Result<(), String> {
    BrowserService::new()
        .act_on_page(bridge.inner(), tab_id, action)
        .await
}

// ── Browser events: subscribe / unsubscribe ───────────────────────────────
//
// Mirrors `commands::system_events::system_events_{subscribe,unsubscribe}`:
// thin Tauri wrappers delegating to pure `*_inner` functions for unit-testing
// without a running Tauri app. Gated in Rust by the same permission the JS
// `PERMISSION_MAP` enforces — `browser:tabs.read`.

use crate::browser::events::{BrowserEventKind, BrowserEventsHub};
use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use std::collections::HashSet;
use std::sync::Arc;

/// The permission a given browser event kind requires. Page events expose page
/// content, so they need `browser:page.read`; tab events need `browser:tabs.read`.
/// Exhaustive on purpose: a new kind forces an explicit permission decision here.
fn permission_for_kind(kind: BrowserEventKind) -> &'static str {
    match kind {
        BrowserEventKind::PageChanged => "browser:page.read",
        BrowserEventKind::TabsChanged => "browser:tabs.read",
    }
}

#[tauri::command]
pub fn browser_events_subscribe(
    hub: State<'_, Arc<BrowserEventsHub>>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    event_types: Vec<String>,
) -> Result<String, AppError> {
    browser_events_subscribe_inner(&hub, &permissions, extension_id, event_types)
}

#[tauri::command]
pub fn browser_events_unsubscribe(
    hub: State<'_, Arc<BrowserEventsHub>>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    subscription_id: String,
) -> Result<(), AppError> {
    browser_events_unsubscribe_inner(&hub, &permissions, extension_id, subscription_id)
}

pub(crate) fn browser_events_subscribe_inner(
    hub: &BrowserEventsHub,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    event_types: Vec<String>,
) -> Result<String, AppError> {
    let ext = extension_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("extensionId required for subscribe".into()))?;
    let kinds: HashSet<BrowserEventKind> = event_types
        .iter()
        .filter_map(|s| BrowserEventKind::from_wire(s))
        .collect();
    if kinds.is_empty() {
        return Err(AppError::Validation(
            "at least one valid event type required".into(),
        ));
    }
    // Check the permission required for EACH requested kind — page events need
    // browser:page.read, tab events browser:tabs.read. A hardcoded single
    // permission would either bypass page.read or over-require tabs.read.
    for kind in &kinds {
        permissions.check(&extension_id, permission_for_kind(*kind))?;
    }
    hub.subscribe(ext, kinds)
}

pub(crate) fn browser_events_unsubscribe_inner(
    hub: &BrowserEventsHub,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    subscription_id: String,
) -> Result<(), AppError> {
    // Unsubscribe removes only the caller's own subscription (ownership enforced
    // by the hub) and accesses no data. Accept either browser event-read
    // permission so a page-only extension can unsubscribe its page subscription.
    permissions
        .check(&extension_id, "browser:tabs.read")
        .or_else(|_| permissions.check(&extension_id, "browser:page.read"))?;
    let ext = extension_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("extensionId required for unsubscribe".into()))?;
    hub.unsubscribe(ext, &subscription_id)
}

#[cfg(test)]
mod browser_events_command_tests {
    use super::*;

    fn permissions_with(ext_id: &str) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let mut inner = reg.inner.lock().unwrap();
        let mut set = HashSet::new();
        set.insert("browser:tabs.read".to_string());
        inner.insert(ext_id.to_string(), set);
        drop(inner);
        reg
    }

    fn empty_permissions() -> ExtensionPermissionRegistry {
        ExtensionPermissionRegistry::new()
    }

    fn permissions_with_perm(ext_id: &str, perm: &str) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let mut inner = reg.inner.lock().unwrap();
        let mut set = HashSet::new();
        set.insert(perm.to_string());
        inner.insert(ext_id.to_string(), set);
        drop(inner);
        reg
    }

    #[test]
    fn subscribe_page_changed_requires_page_read_not_tabs_read() {
        // The bug: a hardcoded browser:tabs.read check let tabs.read stand in for
        // page.read. tabs.read alone MUST NOT authorize a page.changed subscription.
        let hub = BrowserEventsHub::new();
        let perms = permissions_with_perm("ext-a", "browser:tabs.read");
        let err = browser_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["page.changed".into()],
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn subscribe_page_changed_allowed_with_page_read() {
        // And page.read alone (no tabs.read) MUST authorize it — no over-strictness.
        let hub = BrowserEventsHub::new();
        let perms = permissions_with_perm("ext-a", "browser:page.read");
        let id = browser_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["page.changed".into()],
        )
        .unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn subscribe_without_permission_is_rejected() {
        let hub = BrowserEventsHub::new();
        let perms = empty_permissions();
        let err = browser_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["tabs.changed".into()],
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn subscribe_with_permission_returns_uuid() {
        let hub = BrowserEventsHub::new();
        let perms = permissions_with("ext-a");
        let id = browser_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["tabs.changed".into()],
        )
        .unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn subscribe_with_no_valid_kinds_is_validation_error() {
        let hub = BrowserEventsHub::new();
        let perms = permissions_with("ext-a");
        let err = browser_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["bogus-kind".into()],
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    fn subscribe_ignores_unknown_kinds_and_keeps_valid_ones() {
        let hub = BrowserEventsHub::new();
        let perms = permissions_with("ext-a");
        let id = browser_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["tabs.changed".into(), "bogus".into()],
        )
        .unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn unsubscribe_roundtrip() {
        let hub = BrowserEventsHub::new();
        let perms = permissions_with("ext-a");
        let id = browser_events_subscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            vec!["tabs.changed".into()],
        )
        .unwrap();
        browser_events_unsubscribe_inner(&hub, &perms, Some("ext-a".into()), id)
            .expect("unsubscribe ok");
    }

    #[test]
    fn unsubscribe_without_permission_is_rejected() {
        let hub = BrowserEventsHub::new();
        let perms = empty_permissions();
        let err =
            browser_events_unsubscribe_inner(&hub, &perms, Some("ext-a".into()), "any-id".into())
                .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn core_caller_without_extension_id_passes_permission_but_fails_validation() {
        // extension_id = None bypasses permission check but subscribe still
        // requires a concrete extension id.
        let hub = BrowserEventsHub::new();
        let perms = empty_permissions();
        let err = browser_events_subscribe_inner(&hub, &perms, None, vec!["tabs.changed".into()])
            .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    fn unsubscribe_unknown_id_returns_not_found() {
        let hub = BrowserEventsHub::new();
        let perms = permissions_with("ext-a");
        let err =
            browser_events_unsubscribe_inner(&hub, &perms, Some("ext-a".into()), "bogus".into())
                .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }
}
