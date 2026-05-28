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

const REQUIRED_PERMISSION: &str = "browser:tabs.read";

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
    permissions.check(&extension_id, REQUIRED_PERMISSION)?;
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
    hub.subscribe(ext, kinds)
}

pub(crate) fn browser_events_unsubscribe_inner(
    hub: &BrowserEventsHub,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    subscription_id: String,
) -> Result<(), AppError> {
    permissions.check(&extension_id, REQUIRED_PERMISSION)?;
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
        set.insert(REQUIRED_PERMISSION.to_string());
        inner.insert(ext_id.to_string(), set);
        drop(inner);
        reg
    }

    fn empty_permissions() -> ExtensionPermissionRegistry {
        ExtensionPermissionRegistry::new()
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
        let err = browser_events_unsubscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            "any-id".into(),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn core_caller_without_extension_id_passes_permission_but_fails_validation() {
        // extension_id = None bypasses permission check but subscribe still
        // requires a concrete extension id.
        let hub = BrowserEventsHub::new();
        let perms = empty_permissions();
        let err =
            browser_events_subscribe_inner(&hub, &perms, None, vec!["tabs.changed".into()])
                .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    fn unsubscribe_unknown_id_returns_not_found() {
        let hub = BrowserEventsHub::new();
        let perms = permissions_with("ext-a");
        let err = browser_events_unsubscribe_inner(
            &hub,
            &perms,
            Some("ext-a".into()),
            "bogus".into(),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }
}
