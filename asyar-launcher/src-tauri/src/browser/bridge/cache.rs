use crate::browser::types::{BrowserKey, Tab};
use std::collections::HashMap;
use std::sync::RwLock;

pub struct TabSnapshotCache {
    inner: RwLock<HashMap<BrowserKey, Vec<Tab>>>,
}

impl TabSnapshotCache {
    pub fn new() -> Self {
        Self { inner: RwLock::new(HashMap::new()) }
    }

    pub fn set(&self, key: &BrowserKey, tabs: Vec<Tab>) {
        self.inner.write().unwrap().insert(key.clone(), tabs);
    }

    pub fn get(&self, key: &BrowserKey) -> Vec<Tab> {
        self.inner
            .read()
            .unwrap()
            .get(key)
            .cloned()
            .unwrap_or_default()
    }

    pub fn list_all(&self) -> Vec<Tab> {
        let inner = self.inner.read().unwrap();
        inner.values().flat_map(|v| v.iter().cloned()).collect()
    }

    pub fn active_tab(&self, key: &BrowserKey) -> Option<Tab> {
        self.inner
            .read()
            .unwrap()
            .get(key)
            .and_then(|tabs| tabs.iter().find(|t| t.is_active).cloned())
    }

    pub fn invalidate(&self, key: &BrowserKey) {
        self.inner.write().unwrap().remove(key);
    }
}

impl Default for TabSnapshotCache {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::types::{BrowserFamily, BrowserId};

    fn key() -> BrowserKey {
        BrowserKey { family: BrowserFamily::Chromium, variant: "chrome".to_string() }
    }

    fn tab(id: &str, url: &str, title: &str, is_active: bool) -> Tab {
        Tab {
            id: id.to_string(),
            browser: BrowserId {
                family: BrowserFamily::Chromium,
                variant: "chrome".to_string(),
                profile_id: "Default".to_string(),
            },
            window_id: "w1".to_string(),
            index: 0,
            title: title.to_string(),
            url: url.to_string(),
            favicon_url: None,
            is_active,
            is_pinned: false,
            is_audible: false,
            group_name: None,
        }
    }

    #[test]
    fn set_and_get_tabs_for_browser() {
        let cache = TabSnapshotCache::new();
        cache.set(&key(), vec![tab("1", "https://a", "A", true)]);
        let got = cache.get(&key());
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].title, "A");
    }

    #[test]
    fn list_all_aggregates_across_browsers() {
        let cache = TabSnapshotCache::new();
        let k1 = BrowserKey { family: BrowserFamily::Chromium, variant: "chrome".to_string() };
        let k2 = BrowserKey { family: BrowserFamily::Firefox, variant: "firefox".to_string() };
        cache.set(&k1, vec![tab("1", "https://a", "A", false)]);
        cache.set(&k2, vec![tab("2", "https://b", "B", true)]);
        let all = cache.list_all();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn active_tab_returns_the_one_with_is_active_true() {
        let cache = TabSnapshotCache::new();
        cache.set(&key(), vec![
            tab("1", "https://a", "A", false),
            tab("2", "https://b", "B", true),
            tab("3", "https://c", "C", false),
        ]);
        let active = cache.active_tab(&key()).expect("expected active");
        assert_eq!(active.id, "2");
    }

    #[test]
    fn invalidate_clears_browser_state() {
        let cache = TabSnapshotCache::new();
        cache.set(&key(), vec![tab("1", "https://a", "A", true)]);
        cache.invalidate(&key());
        assert!(cache.get(&key()).is_empty());
    }
}
