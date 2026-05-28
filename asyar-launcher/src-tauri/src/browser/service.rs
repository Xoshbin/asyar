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
    use std::path::Path;

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
}
