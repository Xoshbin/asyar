use crate::browser::paths;
use crate::browser::readers;
use crate::browser::scanner::BrowserScanner;
use crate::browser::types::{Bookmark, BrowserFamily, BrowserId, HistoryEntry};
use std::path::PathBuf;

pub struct ListBookmarksFilter {
    pub browser: Option<BrowserId>,
    pub query: Option<String>,
}

pub struct SearchHistoryOptions {
    pub limit: Option<u32>,
    pub since_ms: Option<i64>,
}

pub struct BrowserService {
    home: PathBuf,
}

impl BrowserService {
    pub fn new() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        Self { home }
    }

    pub fn with_home(home: PathBuf) -> Self {
        Self { home }
    }

    pub fn list_available_browsers(&self) -> Vec<BrowserId> {
        BrowserScanner::with_home(self.home.clone()).scan()
    }

    pub fn is_companion_installed(&self, _family: BrowserFamily) -> bool {
        // Companion bridge ships in Plan 2 — always false here.
        false
    }

    pub fn list_bookmarks(&self, filter: ListBookmarksFilter) -> Result<Vec<Bookmark>, String> {
        let browsers = self.list_available_browsers();
        let target = filter.browser.as_ref();
        let mut out = Vec::new();
        for b in browsers {
            if let Some(t) = target {
                if !browser_matches(t, &b) {
                    continue;
                }
            }
            match b.family {
                BrowserFamily::Chromium => {
                    let path = paths::chromium_user_data_root(&self.home, &b.variant)
                        .join(&b.profile_id)
                        .join("Bookmarks");
                    out.extend(readers::chromium::read_bookmarks_file(&path, &b)?);
                }
                BrowserFamily::Firefox => {
                    let path = paths::firefox_profiles_dir(&self.home, &b.variant)
                        .join(&b.profile_id)
                        .join("places.sqlite");
                    out.extend(readers::firefox::read_bookmarks_file(&path, &b)?);
                }
                BrowserFamily::Safari => {
                    let path = paths::safari_root(&self.home).join("Bookmarks.plist");
                    out.extend(readers::safari::read_bookmarks_file(&path, &b)?);
                }
            }
        }
        if let Some(q) = filter.query.as_deref() {
            let q = q.to_lowercase();
            out.retain(|b| {
                b.title.to_lowercase().contains(&q) || b.url.to_lowercase().contains(&q)
            });
        }
        Ok(out)
    }

    pub fn search_history(
        &self,
        query: &str,
        opts: SearchHistoryOptions,
    ) -> Result<Vec<HistoryEntry>, String> {
        let browsers = self.list_available_browsers();
        let mut out = Vec::new();
        for b in browsers {
            let entries = match b.family {
                BrowserFamily::Chromium => {
                    let path = paths::chromium_user_data_root(&self.home, &b.variant)
                        .join(&b.profile_id)
                        .join("History");
                    readers::chromium::read_history_file(&path, &b, query, opts.limit)?
                }
                BrowserFamily::Firefox => {
                    let path = paths::firefox_profiles_dir(&self.home, &b.variant)
                        .join(&b.profile_id)
                        .join("places.sqlite");
                    readers::firefox::read_history_file(&path, &b, query, opts.limit)?
                }
                BrowserFamily::Safari => {
                    let path = paths::safari_root(&self.home).join("History.db");
                    readers::safari::read_history_file(&path, &b, query, opts.limit)?
                }
            };
            out.extend(entries);
        }
        if let Some(since) = opts.since_ms {
            out.retain(|e| e.last_visit_at >= since);
        }
        out.sort_by(|a, b| b.last_visit_at.cmp(&a.last_visit_at));
        if let Some(limit) = opts.limit {
            out.truncate(limit as usize);
        }
        Ok(out)
    }

    pub async fn list_tabs<R: tauri::Runtime>(
        &self,
        bridge: &crate::browser::bridge::BridgeState<R>,
        browser: Option<crate::browser::types::BrowserId>,
        query: Option<String>,
    ) -> Result<Vec<crate::browser::types::Tab>, String> {
        let mut tabs = match browser.as_ref() {
            Some(id) => bridge
                .cache
                .get(&crate::browser::types::BrowserKey::from_id(id)),
            None => bridge.cache.list_all(),
        };
        if let Some(q) = query.as_deref() {
            let q = q.to_lowercase();
            tabs.retain(|t| {
                t.title.to_lowercase().contains(&q) || t.url.to_lowercase().contains(&q)
            });
        }
        Ok(tabs)
    }

    pub async fn get_active_tab<R: tauri::Runtime>(
        &self,
        bridge: &crate::browser::bridge::BridgeState<R>,
        browser: Option<crate::browser::types::BrowserId>,
    ) -> Result<Option<crate::browser::types::Tab>, String> {
        match browser.as_ref() {
            Some(id) => Ok(bridge
                .cache
                .active_tab(&crate::browser::types::BrowserKey::from_id(id))),
            None => Ok(bridge.cache.list_all().into_iter().find(|t| t.is_active)),
        }
    }

    pub async fn activate_tab<R: tauri::Runtime>(
        &self,
        bridge: &crate::browser::bridge::BridgeState<R>,
        tab_id: String,
    ) -> Result<(), String> {
        let owning = bridge
            .cache
            .list_all()
            .into_iter()
            .find(|t| t.id == tab_id)
            .ok_or_else(|| format!("tab not found: {}", tab_id))?;
        let key = crate::browser::types::BrowserKey::from_id(&owning.browser);
        bridge
            .connections
            .send_req(
                &key,
                "tabs.activate".to_string(),
                serde_json::json!({ "tabId": tab_id }),
                std::time::Duration::from_secs(5),
            )
            .await?;
        Ok(())
    }

    pub async fn close_tab<R: tauri::Runtime>(
        &self,
        bridge: &crate::browser::bridge::BridgeState<R>,
        tab_id: String,
    ) -> Result<(), String> {
        let owning = bridge
            .cache
            .list_all()
            .into_iter()
            .find(|t| t.id == tab_id)
            .ok_or_else(|| format!("tab not found: {}", tab_id))?;
        let key = crate::browser::types::BrowserKey::from_id(&owning.browser);
        bridge
            .connections
            .send_req(
                &key,
                "tabs.close".to_string(),
                serde_json::json!({ "tabId": tab_id }),
                std::time::Duration::from_secs(5),
            )
            .await?;
        Ok(())
    }

    pub async fn open_url<R: tauri::Runtime>(
        &self,
        bridge: &crate::browser::bridge::BridgeState<R>,
        url: String,
        target: Option<crate::browser::types::OpenUrlTarget>,
    ) -> Result<(), String> {
        let target = target.unwrap_or_default();
        let target_key = target
            .browser
            .as_ref()
            .map(crate::browser::types::BrowserKey::from_id);
        let connected = bridge.connections.list_connected().await;

        match resolve_open_strategy(target_key, &connected) {
            OpenStrategy::Companion(key) => {
                bridge
                    .connections
                    .send_req(
                        &key,
                        "tabs.open".to_string(),
                        serde_json::json!({
                            "url": url,
                            "newWindow": target.new_window.unwrap_or(false),
                        }),
                        std::time::Duration::from_secs(5),
                    )
                    .await?;
                Ok(())
            }
            OpenStrategy::OsDefault => {
                use tauri_plugin_opener::OpenerExt;
                bridge
                    .app_handle
                    .opener()
                    .open_url(url, None::<&str>)
                    .map_err(|e| format!("OS opener failed: {}", e))
            }
            OpenStrategy::ErrorTargetUnreachable => {
                Err("requested browser has no connected companion".to_string())
            }
        }
    }

    pub async fn is_companion_installed_via<R: tauri::Runtime>(
        &self,
        bridge: &crate::browser::bridge::BridgeState<R>,
        family: BrowserFamily,
    ) -> bool {
        bridge
            .connections
            .list_connected()
            .await
            .into_iter()
            .any(|k| k.family == family)
    }

    pub async fn list_paired_browsers<R: tauri::Runtime>(
        &self,
        bridge: &crate::browser::bridge::BridgeState<R>,
    ) -> Result<Vec<crate::browser::types::BrowserKey>, String> {
        bridge.tokens.list_paired()
    }

    pub async fn get_current_page<R: tauri::Runtime>(
        &self,
        bridge: &crate::browser::bridge::BridgeState<R>,
        browser: Option<crate::browser::types::BrowserId>,
    ) -> Result<Option<crate::browser::types::PageSnapshot>, String> {
        let active = match browser.as_ref() {
            Some(id) => bridge
                .cache
                .active_tab(&crate::browser::types::BrowserKey::from_id(id)),
            None => bridge.cache.list_all().into_iter().find(|t| t.is_active),
        };
        let tab = match active {
            Some(t) => t,
            None => return Ok(None),
        };
        let key = crate::browser::types::BrowserKey::from_id(&tab.browser);
        let raw = bridge
            .connections
            .send_req(
                &key,
                "page.snapshot".to_string(),
                serde_json::json!({ "tabId": tab.id }),
                std::time::Duration::from_secs(10),
            )
            .await?;
        let page: crate::browser::types::PageSnapshot =
            serde_json::from_value(raw).map_err(|e| format!("invalid PageSnapshot: {}", e))?;
        Ok(Some(page))
    }

    pub async fn query_page<R: tauri::Runtime>(
        &self,
        bridge: &crate::browser::bridge::BridgeState<R>,
        tab_id: String,
        selector: String,
        attrs: Option<Vec<String>>,
    ) -> Result<Vec<crate::browser::types::PageMatch>, String> {
        let owning = bridge
            .cache
            .list_all()
            .into_iter()
            .find(|t| t.id == tab_id)
            .ok_or_else(|| format!("tab not found: {}", tab_id))?;
        let key = crate::browser::types::BrowserKey::from_id(&owning.browser);
        let raw = bridge
            .connections
            .send_req(
                &key,
                "page.query".to_string(),
                serde_json::json!({ "tabId": tab_id, "selector": selector, "attrs": attrs }),
                std::time::Duration::from_secs(10),
            )
            .await?;
        serde_json::from_value(raw).map_err(|e| format!("invalid PageMatch list: {}", e))
    }

    pub async fn search_web<R: tauri::Runtime>(
        &self,
        bridge: &crate::browser::bridge::BridgeState<R>,
        text: String,
        target: Option<crate::browser::types::BrowserId>,
    ) -> Result<(), String> {
        let key = match target {
            Some(id) => crate::browser::types::BrowserKey::from_id(&id),
            None => bridge
                .connections
                .list_connected()
                .await
                .into_iter()
                .next()
                .ok_or_else(|| "no companion connected".to_string())?,
        };
        bridge
            .connections
            .send_req(
                &key,
                "search.web".to_string(),
                serde_json::json!({ "text": text }),
                std::time::Duration::from_secs(5),
            )
            .await?;
        Ok(())
    }

    pub fn most_recent_active_browser<R: tauri::Runtime>(
        &self,
        bridge: &crate::browser::bridge::BridgeState<R>,
    ) -> Option<crate::browser::types::BrowserKey> {
        bridge.last_active.read().ok().and_then(|g| g.clone())
    }

    pub async fn act_on_page<R: tauri::Runtime>(
        &self,
        bridge: &crate::browser::bridge::BridgeState<R>,
        tab_id: String,
        action: crate::browser::types::PageAction,
    ) -> Result<(), String> {
        let owning = bridge
            .cache
            .list_all()
            .into_iter()
            .find(|t| t.id == tab_id)
            .ok_or_else(|| format!("tab not found: {}", tab_id))?;
        let key = crate::browser::types::BrowserKey::from_id(&owning.browser);
        bridge
            .connections
            .send_req(
                &key,
                "page.action".to_string(),
                serde_json::json!({ "tabId": tab_id, "action": action }),
                std::time::Duration::from_secs(10),
            )
            .await?;
        Ok(())
    }
}

impl Default for BrowserService {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum OpenStrategy {
    Companion(crate::browser::types::BrowserKey),
    OsDefault,
    ErrorTargetUnreachable,
}

/// Decide how to open a URL given the requested target (if any) and the set of
/// currently-connected companion browsers. Pure — no I/O, fully unit-testable.
pub fn resolve_open_strategy(
    target: Option<crate::browser::types::BrowserKey>,
    connected: &[crate::browser::types::BrowserKey],
) -> OpenStrategy {
    match target {
        Some(key) => {
            if connected.contains(&key) {
                OpenStrategy::Companion(key)
            } else {
                OpenStrategy::ErrorTargetUnreachable
            }
        }
        None => match connected.first() {
            Some(k) => OpenStrategy::Companion(k.clone()),
            None => OpenStrategy::OsDefault,
        },
    }
}

fn browser_matches(target: &BrowserId, candidate: &BrowserId) -> bool {
    target.family == candidate.family
        && target.variant == candidate.variant
        && target.profile_id == candidate.profile_id
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::bridge::{
        cache::TabSnapshotCache, connections::CompanionRegistry, pairing::PairingRegistry,
        token_store::InMemoryTokenStore, BridgeState,
    };
    use crate::browser::types::BrowserKey;
    use std::path::Path;
    use std::sync::Arc;

    fn build_bridge_state() -> BridgeState<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        BridgeState {
            tokens: Arc::new(InMemoryTokenStore::new()),
            pairing: Arc::new(PairingRegistry::new()),
            connections: Arc::new(CompanionRegistry::new()),
            cache: Arc::new(TabSnapshotCache::new()),
            events: Arc::new(crate::browser::events::BrowserEventsHub::new()),
            last_active: Arc::new(std::sync::RwLock::new(None)),
            app_handle: app.handle().clone(),
        }
    }

    fn write_chromium_bookmarks(home: &Path, variant: &str, profile: &str, contents: &str) {
        let root = paths::chromium_user_data_root(home, variant);
        let profile_dir = root.join(profile);
        std::fs::create_dir_all(&profile_dir).unwrap();
        std::fs::write(profile_dir.join("Bookmarks"), contents).unwrap();
    }

    fn minimal_chrome_bookmarks_json() -> &'static str {
        r#"{
            "roots": {
                "bookmark_bar": {
                    "children": [
                        {"date_added":"13350000000000000","id":"1","name":"X","type":"url","url":"https://x.com"}
                    ],
                    "date_added":"0","id":"0","name":"Bookmarks Bar","type":"folder"
                },
                "other":{"children":[],"date_added":"0","id":"2","name":"Other","type":"folder"}
            },
            "version":1
        }"#
    }

    #[test]
    fn list_bookmarks_aggregates_across_installed_chromium_profiles() {
        let dir = tempfile::tempdir().unwrap();
        write_chromium_bookmarks(
            dir.path(),
            "chrome",
            "Default",
            minimal_chrome_bookmarks_json(),
        );
        write_chromium_bookmarks(
            dir.path(),
            "chrome",
            "Profile 1",
            minimal_chrome_bookmarks_json(),
        );
        let svc = BrowserService::with_home(dir.path().to_path_buf());
        let bookmarks = svc
            .list_bookmarks(ListBookmarksFilter {
                browser: None,
                query: None,
            })
            .unwrap();
        assert_eq!(bookmarks.len(), 2);
    }

    #[test]
    fn list_bookmarks_filters_by_browser() {
        let dir = tempfile::tempdir().unwrap();
        write_chromium_bookmarks(
            dir.path(),
            "chrome",
            "Default",
            minimal_chrome_bookmarks_json(),
        );
        write_chromium_bookmarks(
            dir.path(),
            "brave",
            "Default",
            minimal_chrome_bookmarks_json(),
        );
        let svc = BrowserService::with_home(dir.path().to_path_buf());
        let only_chrome = BrowserId {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
            profile_id: "Default".to_string(),
        };
        let bookmarks = svc
            .list_bookmarks(ListBookmarksFilter {
                browser: Some(only_chrome),
                query: None,
            })
            .unwrap();
        assert_eq!(bookmarks.len(), 1);
        assert_eq!(bookmarks[0].browser.variant, "chrome");
    }

    #[test]
    fn list_bookmarks_filters_by_query_case_insensitive() {
        let dir = tempfile::tempdir().unwrap();
        write_chromium_bookmarks(
            dir.path(),
            "chrome",
            "Default",
            minimal_chrome_bookmarks_json(),
        );
        let svc = BrowserService::with_home(dir.path().to_path_buf());
        let q = svc
            .list_bookmarks(ListBookmarksFilter {
                browser: None,
                query: Some("X".to_string()),
            })
            .unwrap();
        assert_eq!(q.len(), 1);
        let nothing = svc
            .list_bookmarks(ListBookmarksFilter {
                browser: None,
                query: Some("nomatch".to_string()),
            })
            .unwrap();
        assert!(nothing.is_empty());
    }

    #[test]
    fn is_companion_installed_always_false_in_milestone_one() {
        let svc = BrowserService::new();
        assert!(!svc.is_companion_installed(BrowserFamily::Chromium));
        assert!(!svc.is_companion_installed(BrowserFamily::Firefox));
        assert!(!svc.is_companion_installed(BrowserFamily::Safari));
    }

    #[test]
    fn list_available_browsers_empty_when_nothing_installed() {
        let dir = tempfile::tempdir().unwrap();
        let svc = BrowserService::with_home(dir.path().to_path_buf());
        assert!(svc.list_available_browsers().is_empty());
    }

    #[tokio::test]
    async fn list_tabs_returns_cache_for_all_browsers() {
        let svc = BrowserService::new();
        let bridge = build_bridge_state();
        let key = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        bridge.cache.set(
            &key,
            vec![crate::browser::types::Tab {
                id: "1".to_string(),
                browser: BrowserId {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                    profile_id: "Default".to_string(),
                },
                window_id: "w".to_string(),
                index: 0,
                title: "T".to_string(),
                url: "U".to_string(),
                favicon_url: None,
                is_active: true,
                is_pinned: false,
                is_audible: false,
                group_name: None,
            }],
        );
        let tabs = svc.list_tabs(&bridge, None, None).await.unwrap();
        assert_eq!(tabs.len(), 1);
    }

    #[tokio::test]
    async fn list_tabs_filters_by_query_case_insensitive() {
        let svc = BrowserService::new();
        let bridge = build_bridge_state();
        let key = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        bridge.cache.set(
            &key,
            vec![
                crate::browser::types::Tab {
                    id: "1".to_string(),
                    browser: BrowserId {
                        family: BrowserFamily::Chromium,
                        variant: "chrome".to_string(),
                        profile_id: "Default".to_string(),
                    },
                    window_id: "w".to_string(),
                    index: 0,
                    title: "GitHub".to_string(),
                    url: "https://github.com".to_string(),
                    favicon_url: None,
                    is_active: false,
                    is_pinned: false,
                    is_audible: false,
                    group_name: None,
                },
                crate::browser::types::Tab {
                    id: "2".to_string(),
                    browser: BrowserId {
                        family: BrowserFamily::Chromium,
                        variant: "chrome".to_string(),
                        profile_id: "Default".to_string(),
                    },
                    window_id: "w".to_string(),
                    index: 1,
                    title: "Mozilla".to_string(),
                    url: "https://mozilla.org".to_string(),
                    favicon_url: None,
                    is_active: false,
                    is_pinned: false,
                    is_audible: false,
                    group_name: None,
                },
            ],
        );
        let tabs = svc
            .list_tabs(&bridge, None, Some("github".to_string()))
            .await
            .unwrap();
        assert_eq!(tabs.len(), 1);
        assert_eq!(tabs[0].title, "GitHub");
    }

    #[tokio::test]
    async fn is_companion_installed_reflects_registry() {
        let svc = BrowserService::new();
        let bridge = build_bridge_state();
        assert!(
            !svc.is_companion_installed_via(&bridge, BrowserFamily::Chromium)
                .await
        );
        let (tx, _rx) = tokio::sync::mpsc::channel(8);
        bridge
            .connections
            .register(
                BrowserKey {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                },
                tx,
            )
            .await;
        assert!(
            svc.is_companion_installed_via(&bridge, BrowserFamily::Chromium)
                .await
        );
    }

    #[tokio::test]
    async fn list_paired_browsers_returns_tokens_index() {
        let svc = BrowserService::new();
        let bridge = build_bridge_state();
        bridge
            .tokens
            .set(
                &BrowserKey {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                },
                "t",
            )
            .unwrap();
        bridge
            .tokens
            .set(
                &BrowserKey {
                    family: BrowserFamily::Firefox,
                    variant: "firefox".to_string(),
                },
                "t",
            )
            .unwrap();
        let paired = svc.list_paired_browsers(&bridge).await.unwrap();
        assert_eq!(paired.len(), 2);
    }

    #[tokio::test]
    async fn get_current_page_returns_none_when_no_active_tab() {
        let svc = BrowserService::new();
        let bridge = build_bridge_state();
        let page = svc.get_current_page(&bridge, None).await.unwrap();
        assert!(page.is_none());
    }

    #[tokio::test]
    async fn get_current_page_invokes_companion_rpc_for_active_tab() {
        let svc = BrowserService::new();
        let bridge = build_bridge_state();
        let key = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        bridge.cache.set(
            &key,
            vec![crate::browser::types::Tab {
                id: "tab-1".to_string(),
                browser: BrowserId {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                    profile_id: "Default".to_string(),
                },
                window_id: "w".to_string(),
                index: 0,
                title: "T".to_string(),
                url: "https://x".to_string(),
                favicon_url: None,
                is_active: true,
                is_pinned: false,
                is_audible: false,
                group_name: None,
            }],
        );

        let (tx, mut rx) =
            tokio::sync::mpsc::channel::<crate::browser::bridge::protocol::ServerMessage>(8);
        bridge.connections.register(key.clone(), tx).await;

        let bridge_clone = bridge.clone();
        let svc_task = tokio::spawn(async move { svc.get_current_page(&bridge_clone, None).await });

        let req = rx.recv().await.expect("expected req");
        let req_id = match req {
            crate::browser::bridge::protocol::ServerMessage::Req { id, method, .. } => {
                assert_eq!(method, "page.snapshot");
                id
            }
        };
        bridge
            .connections
            .deliver_response(
                &req_id,
                Ok(serde_json::json!({
                    "url": "https://x",
                    "title": "T",
                    "readableText": "body content",
                    "meta": {}
                })),
            )
            .await
            .unwrap();

        let result = svc_task.await.unwrap().unwrap();
        let page = result.expect("expected Some(page)");
        assert_eq!(page.url, "https://x");
        assert_eq!(page.readable_text, "body content");
    }

    #[tokio::test]
    async fn query_page_routes_request_to_owning_browser() {
        let svc = BrowserService::new();
        let bridge = build_bridge_state();
        let key = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        bridge.cache.set(
            &key,
            vec![crate::browser::types::Tab {
                id: "tab-7".to_string(),
                browser: BrowserId {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                    profile_id: "Default".to_string(),
                },
                window_id: "w".to_string(),
                index: 0,
                title: "T".to_string(),
                url: "U".to_string(),
                favicon_url: None,
                is_active: false,
                is_pinned: false,
                is_audible: false,
                group_name: None,
            }],
        );
        let (tx, mut rx) = tokio::sync::mpsc::channel(8);
        bridge.connections.register(key.clone(), tx).await;

        let bridge_clone = bridge.clone();
        let task = tokio::spawn(async move {
            svc.query_page(
                &bridge_clone,
                "tab-7".to_string(),
                "a[href]".to_string(),
                None,
            )
            .await
        });

        let req = rx.recv().await.unwrap();
        let id = match req {
            crate::browser::bridge::protocol::ServerMessage::Req { id, method, params } => {
                assert_eq!(method, "page.query");
                assert_eq!(params["tabId"], "tab-7");
                assert_eq!(params["selector"], "a[href]");
                id
            }
        };
        bridge
            .connections
            .deliver_response(
                &id,
                Ok(serde_json::json!([
                    { "tag": "a", "attrs": { "href": "https://x" }, "textContent": "Link" }
                ])),
            )
            .await
            .unwrap();

        let matches = task.await.unwrap().unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].tag, "a");
    }

    #[test]
    fn open_strategy_uses_companion_when_target_browser_connected() {
        use crate::browser::types::BrowserFamily;
        let key = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        let connected = vec![BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        }];
        let strat = resolve_open_strategy(Some(key.clone()), &connected);
        assert!(matches!(strat, OpenStrategy::Companion(ref k) if *k == key));
    }

    #[test]
    fn open_strategy_uses_first_companion_when_no_target_but_some_connected() {
        use crate::browser::types::BrowserFamily;
        let connected = vec![BrowserKey {
            family: BrowserFamily::Firefox,
            variant: "firefox".to_string(),
        }];
        let strat = resolve_open_strategy(None, &connected);
        assert!(matches!(strat, OpenStrategy::Companion(ref k) if k.variant == "firefox"));
    }

    #[test]
    fn open_strategy_falls_back_to_os_default_when_no_target_and_none_connected() {
        let strat = resolve_open_strategy(None, &[]);
        assert!(matches!(strat, OpenStrategy::OsDefault));
    }

    #[test]
    fn open_strategy_errors_when_target_requested_but_that_browser_not_connected() {
        use crate::browser::types::BrowserFamily;
        let target = Some(BrowserKey {
            family: BrowserFamily::Safari,
            variant: "safari".to_string(),
        });
        let connected = vec![BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        }];
        let strat = resolve_open_strategy(target, &connected);
        assert!(matches!(strat, OpenStrategy::ErrorTargetUnreachable));
    }

    #[tokio::test]
    async fn search_web_routes_to_target_companion() {
        let svc = BrowserService::new();
        let bridge = build_bridge_state();
        let key = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        let (tx, mut rx) =
            tokio::sync::mpsc::channel::<crate::browser::bridge::protocol::ServerMessage>(8);
        bridge.connections.register(key.clone(), tx).await;

        let target = BrowserId {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
            profile_id: "Default".to_string(),
        };
        let bridge_clone = bridge.clone();
        let task = tokio::spawn(async move {
            svc.search_web(&bridge_clone, "react hooks".to_string(), Some(target))
                .await
        });

        let req = rx.recv().await.unwrap();
        let id = match req {
            crate::browser::bridge::protocol::ServerMessage::Req { id, method, params } => {
                assert_eq!(method, "search.web");
                assert_eq!(params["text"], "react hooks");
                id
            }
        };
        bridge
            .connections
            .deliver_response(&id, Ok(serde_json::Value::Null))
            .await
            .unwrap();
        task.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn search_web_errors_when_target_not_connected() {
        let svc = BrowserService::new();
        let bridge = build_bridge_state();
        let target = BrowserId {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
            profile_id: "Default".to_string(),
        };
        let result = svc.search_web(&bridge, "q".to_string(), Some(target)).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn search_web_errors_when_no_companion_connected() {
        let svc = BrowserService::new();
        let bridge = build_bridge_state();
        let result = svc.search_web(&bridge, "q".to_string(), None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn act_on_page_routes_reload_to_companion() {
        use crate::browser::types::PageAction;
        let svc = BrowserService::new();
        let bridge = build_bridge_state();
        let key = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        bridge.cache.set(
            &key,
            vec![crate::browser::types::Tab {
                id: "tab-3".to_string(),
                browser: BrowserId {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                    profile_id: "Default".to_string(),
                },
                window_id: "w".to_string(),
                index: 0,
                title: "T".to_string(),
                url: "U".to_string(),
                favicon_url: None,
                is_active: false,
                is_pinned: false,
                is_audible: false,
                group_name: None,
            }],
        );
        let (tx, mut rx) = tokio::sync::mpsc::channel(8);
        bridge.connections.register(key.clone(), tx).await;

        let bridge_clone = bridge.clone();
        let task = tokio::spawn(async move {
            svc.act_on_page(&bridge_clone, "tab-3".to_string(), PageAction::Reload)
                .await
        });

        let req = rx.recv().await.unwrap();
        let id = match req {
            crate::browser::bridge::protocol::ServerMessage::Req { id, method, params } => {
                assert_eq!(method, "page.action");
                assert_eq!(params["tabId"], "tab-3");
                assert_eq!(params["action"]["kind"], "reload");
                id
            }
        };
        bridge
            .connections
            .deliver_response(&id, Ok(serde_json::Value::Null))
            .await
            .unwrap();
        task.await.unwrap().unwrap();
    }
}
