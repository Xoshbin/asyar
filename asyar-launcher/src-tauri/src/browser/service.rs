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

    pub fn list_bookmarks(
        &self,
        filter: ListBookmarksFilter,
    ) -> Result<Vec<Bookmark>, String> {
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
            Some(id) => bridge.cache.get(&crate::browser::types::BrowserKey::from_id(id)),
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
        let key = match target.browser.as_ref() {
            Some(b) => crate::browser::types::BrowserKey::from_id(b),
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
}

impl Default for BrowserService {
    fn default() -> Self {
        Self::new()
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
        write_chromium_bookmarks(dir.path(), "chrome", "Default", minimal_chrome_bookmarks_json());
        write_chromium_bookmarks(dir.path(), "chrome", "Profile 1", minimal_chrome_bookmarks_json());
        let svc = BrowserService::with_home(dir.path().to_path_buf());
        let bookmarks = svc.list_bookmarks(ListBookmarksFilter { browser: None, query: None }).unwrap();
        assert_eq!(bookmarks.len(), 2);
    }

    #[test]
    fn list_bookmarks_filters_by_browser() {
        let dir = tempfile::tempdir().unwrap();
        write_chromium_bookmarks(dir.path(), "chrome", "Default", minimal_chrome_bookmarks_json());
        write_chromium_bookmarks(dir.path(), "brave", "Default", minimal_chrome_bookmarks_json());
        let svc = BrowserService::with_home(dir.path().to_path_buf());
        let only_chrome = BrowserId {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
            profile_id: "Default".to_string(),
        };
        let bookmarks = svc
            .list_bookmarks(ListBookmarksFilter { browser: Some(only_chrome), query: None })
            .unwrap();
        assert_eq!(bookmarks.len(), 1);
        assert_eq!(bookmarks[0].browser.variant, "chrome");
    }

    #[test]
    fn list_bookmarks_filters_by_query_case_insensitive() {
        let dir = tempfile::tempdir().unwrap();
        write_chromium_bookmarks(dir.path(), "chrome", "Default", minimal_chrome_bookmarks_json());
        let svc = BrowserService::with_home(dir.path().to_path_buf());
        let q = svc.list_bookmarks(ListBookmarksFilter {
            browser: None,
            query: Some("X".to_string()),
        }).unwrap();
        assert_eq!(q.len(), 1);
        let nothing = svc.list_bookmarks(ListBookmarksFilter {
            browser: None,
            query: Some("nomatch".to_string()),
        }).unwrap();
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
        let key = BrowserKey { family: BrowserFamily::Chromium, variant: "chrome".to_string() };
        bridge.cache.set(&key, vec![
            crate::browser::types::Tab {
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
            },
        ]);
        let tabs = svc.list_tabs(&bridge, None, None).await.unwrap();
        assert_eq!(tabs.len(), 1);
    }

    #[tokio::test]
    async fn list_tabs_filters_by_query_case_insensitive() {
        let svc = BrowserService::new();
        let bridge = build_bridge_state();
        let key = BrowserKey { family: BrowserFamily::Chromium, variant: "chrome".to_string() };
        bridge.cache.set(&key, vec![
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
        ]);
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
        assert!(!svc
            .is_companion_installed_via(&bridge, BrowserFamily::Chromium)
            .await);
        let (tx, _rx) = tokio::sync::mpsc::channel(8);
        bridge
            .connections
            .register(
                BrowserKey { family: BrowserFamily::Chromium, variant: "chrome".to_string() },
                tx,
            )
            .await;
        assert!(svc
            .is_companion_installed_via(&bridge, BrowserFamily::Chromium)
            .await);
    }

    #[tokio::test]
    async fn list_paired_browsers_returns_tokens_index() {
        let svc = BrowserService::new();
        let bridge = build_bridge_state();
        bridge
            .tokens
            .set(
                &BrowserKey { family: BrowserFamily::Chromium, variant: "chrome".to_string() },
                "t",
            )
            .unwrap();
        bridge
            .tokens
            .set(
                &BrowserKey { family: BrowserFamily::Firefox, variant: "firefox".to_string() },
                "t",
            )
            .unwrap();
        let paired = svc.list_paired_browsers(&bridge).await.unwrap();
        assert_eq!(paired.len(), 2);
    }
}
