use crate::browser::types::{Bookmark, BrowserId};
use serde::Deserialize;
use std::path::Path;

/// Chromium stores timestamps as microseconds since 1601-01-01.
/// Convert to unix-ms (since 1970-01-01).
const WINDOWS_TO_UNIX_EPOCH_MICROS: i64 = 11_644_473_600_000_000;

fn chromium_micros_to_unix_ms(micros_str: &str) -> i64 {
    let micros: i64 = micros_str.parse().unwrap_or(0);
    if micros == 0 {
        return 0;
    }
    (micros - WINDOWS_TO_UNIX_EPOCH_MICROS) / 1000
}

#[derive(Debug, Deserialize)]
struct ChromiumFile {
    roots: ChromiumRoots,
}

#[derive(Debug, Deserialize)]
struct ChromiumRoots {
    bookmark_bar: ChromiumNode,
    other: ChromiumNode,
    #[serde(default)]
    synced: Option<ChromiumNode>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ChromiumNode {
    Url {
        id: String,
        name: String,
        url: String,
        #[serde(default)]
        date_added: String,
    },
    Folder {
        name: String,
        #[serde(default)]
        children: Vec<ChromiumNode>,
    },
}

pub fn read_bookmarks_file(
    path: &Path,
    browser: &BrowserId,
) -> Result<Vec<Bookmark>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let parsed: ChromiumFile = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    walk(&parsed.roots.bookmark_bar, &[], browser, &mut out);
    walk(&parsed.roots.other, &[], browser, &mut out);
    if let Some(synced) = &parsed.roots.synced {
        walk(synced, &[], browser, &mut out);
    }
    Ok(out)
}

fn walk(node: &ChromiumNode, parents: &[String], browser: &BrowserId, out: &mut Vec<Bookmark>) {
    match node {
        ChromiumNode::Url { id, name, url, date_added } => {
            out.push(Bookmark {
                id: format!("{}:{}:{}", browser.variant, browser.profile_id, id),
                browser: browser.clone(),
                title: name.clone(),
                url: url.clone(),
                folder_path: parents.to_vec(),
                added_at: chromium_micros_to_unix_ms(date_added),
            });
        }
        ChromiumNode::Folder { name, children } => {
            let mut path = parents.to_vec();
            path.push(name.clone());
            for child in children {
                walk(child, &path, browser, out);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::types::{BrowserFamily, BrowserId};
    use std::path::PathBuf;

    fn fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/browser/fixtures/chrome_bookmarks.json")
    }

    fn fake_browser() -> BrowserId {
        BrowserId {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
            profile_id: "Default".to_string(),
        }
    }

    #[test]
    fn reads_flat_bookmark_at_root_with_correct_folder_path() {
        let bookmarks = read_bookmarks_file(&fixture_path(), &fake_browser()).unwrap();
        let gh = bookmarks.iter().find(|b| b.title == "GitHub").expect("GitHub bookmark");
        assert_eq!(gh.url, "https://github.com");
        assert_eq!(gh.folder_path, vec!["Bookmarks Bar".to_string()]);
        assert_eq!(gh.browser.variant, "chrome");
    }

    #[test]
    fn descends_into_nested_folders() {
        let bookmarks = read_bookmarks_file(&fixture_path(), &fake_browser()).unwrap();
        let rust = bookmarks.iter().find(|b| b.title == "Rust Book").expect("Rust Book");
        assert_eq!(rust.folder_path, vec!["Bookmarks Bar".to_string(), "Work".to_string()]);
    }

    #[test]
    fn converts_chromium_microseconds_to_unix_ms() {
        let bookmarks = read_bookmarks_file(&fixture_path(), &fake_browser()).unwrap();
        let gh = bookmarks.iter().find(|b| b.title == "GitHub").unwrap();
        // 13350000000000000 microseconds since 1601-01-01 → 2023-09-03T20:00:00Z (approx).
        // Assert it converts to a plausible 2020s timestamp (between 2020 and 2030).
        assert!(gh.added_at > 1_577_836_800_000, "added_at too old: {}", gh.added_at);
        assert!(gh.added_at < 1_893_456_000_000, "added_at too new: {}", gh.added_at);
    }

    #[test]
    fn missing_file_returns_empty_vec() {
        let result = read_bookmarks_file(
            &PathBuf::from("/nonexistent/path/Bookmarks"),
            &fake_browser(),
        );
        assert_eq!(result.unwrap(), Vec::new());
    }
}
