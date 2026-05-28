use crate::browser::readers::sqlite_copy::copy_for_read;
use crate::browser::types::{Bookmark, BrowserId, HistoryEntry};
use serde::Deserialize;
use std::path::Path;

/// CFAbsoluteTime epoch (2001-01-01 UTC) as unix milliseconds.
const CF_EPOCH_UNIX_MS: i64 = 978_307_200_000;

#[derive(Debug, serde::Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct SafariNode {
    title: Option<String>,
    #[serde(rename = "Children")]
    children: Option<Vec<SafariNode>>,
    #[serde(rename = "URLString")]
    url_string: Option<String>,
    #[serde(rename = "WebBookmarkUUID")]
    uuid: Option<String>,
    #[serde(rename = "WebBookmarkType")]
    web_bookmark_type: Option<String>,
}

pub fn read_bookmarks_file(
    path: &Path,
    browser: &BrowserId,
) -> Result<Vec<Bookmark>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let root: SafariNode = plist::from_file(path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    walk(&root, &[], browser, &mut out);
    Ok(out)
}

fn walk(node: &SafariNode, parents: &[String], browser: &BrowserId, out: &mut Vec<Bookmark>) {
    let kind = node.web_bookmark_type.as_deref().unwrap_or("");
    if kind == "WebBookmarkTypeLeaf" {
        if let Some(url) = &node.url_string {
            let id = node.uuid.clone().unwrap_or_default();
            out.push(Bookmark {
                id: format!("{}:{}:{}", browser.variant, browser.profile_id, id),
                browser: browser.clone(),
                title: node.title.clone().unwrap_or_default(),
                url: url.clone(),
                folder_path: parents.to_vec(),
                added_at: 0,
            });
        }
    } else if let Some(children) = &node.children {
        let mut path = parents.to_vec();
        if let Some(t) = &node.title {
            path.push(t.clone());
        }
        for c in children {
            walk(c, &path, browser, out);
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
        "SELECT i.url, COALESCE(v.title, ''), i.visit_count, MAX(v.visit_time) \
         FROM history_items i JOIN history_visits v ON v.history_item = i.id \
         WHERE (LOWER(i.url) LIKE ?1 OR LOWER(COALESCE(v.title, '')) LIKE ?1) \
         GROUP BY i.id \
         ORDER BY MAX(v.visit_time) DESC{}",
        limit_clause
    );
    let like = format!("%{}%", query.to_lowercase());
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&like], |row| {
            let url: String = row.get(0)?;
            let title: String = row.get(1)?;
            let visit_count: u32 = row.get(2)?;
            let cf_secs: f64 = row.get(3)?;
            Ok(HistoryEntry {
                url,
                title,
                browser: browser.clone(),
                last_visit_at: (cf_secs * 1000.0) as i64 + CF_EPOCH_UNIX_MS,
                visit_count,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::types::BrowserFamily;
    use std::path::PathBuf;

    fn bookmarks_fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/browser/fixtures/safari_bookmarks.plist")
    }

    fn history_fixture() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/browser/fixtures/safari_history.sqlite")
    }

    fn fake_safari() -> BrowserId {
        BrowserId {
            family: BrowserFamily::Safari,
            variant: "safari".to_string(),
            profile_id: "Default".to_string(),
        }
    }

    #[test]
    #[ignore]
    fn generate_safari_fixtures() {
        // Bookmarks.plist
        let bookmarks_root = SafariNode {
            title: Some("BookmarksBar".to_string()),
            children: Some(vec![
                SafariNode {
                    title: Some("Apple".to_string()),
                    children: None,
                    url_string: Some("https://www.apple.com".to_string()),
                    uuid: Some("uuid-apple".to_string()),
                    web_bookmark_type: Some("WebBookmarkTypeLeaf".to_string()),
                },
                SafariNode {
                    title: Some("Dev".to_string()),
                    children: Some(vec![SafariNode {
                        title: Some("Swift".to_string()),
                        children: None,
                        url_string: Some("https://swift.org".to_string()),
                        uuid: Some("uuid-swift".to_string()),
                        web_bookmark_type: Some("WebBookmarkTypeLeaf".to_string()),
                    }]),
                    url_string: None,
                    uuid: Some("uuid-dev".to_string()),
                    web_bookmark_type: Some("WebBookmarkTypeList".to_string()),
                },
            ]),
            url_string: None,
            uuid: Some("uuid-bar".to_string()),
            web_bookmark_type: Some("WebBookmarkTypeList".to_string()),
        };
        let file = std::fs::File::create(bookmarks_fixture()).unwrap();
        plist::to_writer_binary(file, &bookmarks_root).unwrap();

        // History.db
        let _ = std::fs::remove_file(history_fixture());
        let conn = rusqlite::Connection::open(history_fixture()).unwrap();
        conn.execute_batch(
            "CREATE TABLE history_items (
                id INTEGER PRIMARY KEY,
                url TEXT,
                visit_count INTEGER
            );
            CREATE TABLE history_visits (
                history_item INTEGER,
                visit_time REAL,
                title TEXT
            );
            INSERT INTO history_items VALUES (1, 'https://apple.com', 7);
            INSERT INTO history_items VALUES (2, 'https://swift.org', 3);
            -- Safari visit_time is CFAbsoluteTime: seconds since 2001-01-01 UTC.
            -- 715000000 ≈ 2023-08-30
            INSERT INTO history_visits VALUES (1, 715000000.0, 'Apple');
            INSERT INTO history_visits VALUES (2, 715000010.0, 'Swift');"
        ).unwrap();
    }

    #[test]
    fn safari_reads_nested_bookmarks() {
        let bookmarks = read_bookmarks_file(&bookmarks_fixture(), &fake_safari()).unwrap();
        let swift = bookmarks.iter().find(|b| b.title == "Swift").unwrap();
        assert_eq!(swift.url, "https://swift.org");
        assert_eq!(swift.folder_path, vec!["BookmarksBar".to_string(), "Dev".to_string()]);
    }

    #[test]
    fn safari_history_filters_and_orders_desc() {
        let entries = read_history_file(&history_fixture(), &fake_safari(), "", None).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].title, "Swift");   // higher visit_time, comes first
    }

    #[test]
    fn safari_missing_files_return_empty() {
        assert!(read_bookmarks_file(Path::new("/none"), &fake_safari()).unwrap().is_empty());
        assert!(read_history_file(Path::new("/none"), &fake_safari(), "", None).unwrap().is_empty());
    }
}
