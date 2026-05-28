use crate::browser::readers::sqlite_copy::copy_for_read;
use crate::browser::types::{Bookmark, BrowserId, HistoryEntry};
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

pub fn read_history_file(
    path: &Path,
    browser: &BrowserId,
    query: &str,
    limit: Option<u32>,
) -> Result<Vec<HistoryEntry>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let copy = copy_for_read(path)?;
    let conn = rusqlite::Connection::open_with_flags(
        copy.path(),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| e.to_string())?;

    let limit_clause = match limit {
        Some(n) => format!(" LIMIT {}", n),
        None => String::new(),
    };
    let sql = format!(
        "SELECT url, title, visit_count, last_visit_time FROM urls \
         WHERE (LOWER(url) LIKE ?1 OR LOWER(title) LIKE ?1) AND hidden = 0 \
         ORDER BY last_visit_time DESC{}",
        limit_clause
    );
    let like_pattern = format!("%{}%", query.to_lowercase());

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&like_pattern], |row| {
            let url: String = row.get(0)?;
            let title: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let visit_count: u32 = row.get(2)?;
            let last_visit_micros: i64 = row.get(3)?;
            Ok(HistoryEntry {
                url,
                title,
                browser: browser.clone(),
                last_visit_at: chromium_micros_to_unix_ms(&last_visit_micros.to_string()),
                visit_count,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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

    #[test]
    #[ignore] // Run manually with: cargo test --lib generate_chrome_history_fixture -- --ignored --nocapture
    fn generate_chrome_history_fixture() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/browser/fixtures/chrome_history.sqlite");
        let _ = std::fs::remove_file(&path);
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE urls (
                id INTEGER PRIMARY KEY,
                url LONGVARCHAR,
                title LONGVARCHAR,
                visit_count INTEGER DEFAULT 0 NOT NULL,
                typed_count INTEGER DEFAULT 0 NOT NULL,
                last_visit_time INTEGER NOT NULL,
                hidden INTEGER DEFAULT 0 NOT NULL
            );
            INSERT INTO urls VALUES (1, 'https://github.com', 'GitHub', 5, 2, 13350000000000000, 0);
            INSERT INTO urls VALUES (2, 'https://doc.rust-lang.org', 'Rust Docs', 3, 1, 13350000010000000, 0);
            INSERT INTO urls VALUES (3, 'https://news.ycombinator.com', 'Hacker News', 12, 0, 13350000020000000, 0);"
        ).unwrap();
        println!("Generated fixture at {}", path.display());
    }

    fn history_fixture_path() -> std::path::PathBuf {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/browser/fixtures/chrome_history.sqlite")
    }

    #[test]
    fn reads_all_history_entries_when_query_is_empty() {
        let entries = read_history_file(&history_fixture_path(), &fake_browser(), "", None).unwrap();
        assert_eq!(entries.len(), 3);
    }

    #[test]
    fn filters_by_query_case_insensitive() {
        let entries = read_history_file(&history_fixture_path(), &fake_browser(), "rust", None).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "Rust Docs");
    }

    #[test]
    fn respects_limit() {
        let entries = read_history_file(&history_fixture_path(), &fake_browser(), "", Some(2)).unwrap();
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn history_file_missing_returns_empty() {
        let entries = read_history_file(
            &std::path::PathBuf::from("/no/such/History"),
            &fake_browser(),
            "",
            None,
        )
        .unwrap();
        assert!(entries.is_empty());
    }
}
