use crate::browser::readers::sqlite_copy::copy_for_read;
use crate::browser::types::{Bookmark, BrowserId, HistoryEntry};
use std::path::Path;

pub fn read_bookmarks_file(
    places_path: &Path,
    browser: &BrowserId,
) -> Result<Vec<Bookmark>, String> {
    if !places_path.exists() {
        return Ok(Vec::new());
    }
    let copy = copy_for_read(places_path)?;
    let conn = rusqlite::Connection::open_with_flags(
        copy.path(),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| e.to_string())?;

    let mut folders = std::collections::HashMap::<i64, (Option<i64>, String)>::new();
    let mut stmt = conn
        .prepare("SELECT id, parent, COALESCE(title, '') FROM moz_bookmarks WHERE type = 2")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let parent: Option<i64> = row.get(1)?;
            let title: String = row.get(2)?;
            Ok((id, (parent, title)))
        })
        .map_err(|e| e.to_string())?;
    for r in rows {
        let (id, info) = r.map_err(|e| e.to_string())?;
        folders.insert(id, info);
    }

    let mut stmt = conn
        .prepare(
            "SELECT b.id, b.fk, p.url, COALESCE(b.title, p.title, ''), \
                    COALESCE(b.dateAdded, 0), b.parent \
             FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk \
             WHERE b.type = 1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let bm_id: i64 = row.get(0)?;
            let _fk: i64 = row.get(1)?;
            let url: String = row.get(2)?;
            let title: String = row.get(3)?;
            let date_added: i64 = row.get(4)?;
            let parent: i64 = row.get(5)?;
            Ok((bm_id, url, title, date_added, parent))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for r in rows {
        let (bm_id, url, title, micros, parent) = r.map_err(|e| e.to_string())?;
        let folder_path = build_folder_path(parent, &folders);
        out.push(Bookmark {
            id: format!("{}:{}:{}", browser.variant, browser.profile_id, bm_id),
            browser: browser.clone(),
            title,
            url,
            folder_path,
            added_at: micros / 1000,
        });
    }
    Ok(out)
}

fn build_folder_path(
    start: i64,
    folders: &std::collections::HashMap<i64, (Option<i64>, String)>,
) -> Vec<String> {
    let mut chain = Vec::new();
    let mut current = Some(start);
    while let Some(id) = current {
        match folders.get(&id) {
            Some((parent, title)) => {
                // Skip the 'root' synthetic entry. Firefox represents "no parent"
                // either as NULL or as the sentinel 0.
                if matches!(parent, None | Some(0)) {
                    break;
                }
                chain.push(title.clone());
                current = *parent;
            }
            None => break,
        }
    }
    chain.reverse();
    chain
}

pub fn read_history_file(
    places_path: &Path,
    browser: &BrowserId,
    query: &str,
    limit: Option<u32>,
) -> Result<Vec<HistoryEntry>, String> {
    if !places_path.exists() {
        return Ok(Vec::new());
    }
    let copy = copy_for_read(places_path)?;
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
        "SELECT url, COALESCE(title, ''), visit_count, COALESCE(last_visit_date, 0) \
         FROM moz_places \
         WHERE (LOWER(url) LIKE ?1 OR LOWER(COALESCE(title, '')) LIKE ?1) AND hidden = 0 \
         ORDER BY last_visit_date DESC{}",
        limit_clause
    );
    let like = format!("%{}%", query.to_lowercase());
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&like], |row| {
            let url: String = row.get(0)?;
            let title: String = row.get(1)?;
            let visit_count: u32 = row.get(2)?;
            let micros: i64 = row.get(3)?;
            Ok(HistoryEntry {
                url,
                title,
                browser: browser.clone(),
                last_visit_at: micros / 1000,
                visit_count,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::types::BrowserFamily;
    use std::path::PathBuf;

    fn fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/browser/fixtures/firefox_places.sqlite")
    }

    fn fake_firefox() -> BrowserId {
        BrowserId {
            family: BrowserFamily::Firefox,
            variant: "firefox".to_string(),
            profile_id: "default-release".to_string(),
        }
    }

    #[test]
    #[ignore]
    fn generate_firefox_fixture() {
        let _ = std::fs::remove_file(fixture_path());
        let conn = rusqlite::Connection::open(fixture_path()).unwrap();
        conn.execute_batch(
            "CREATE TABLE moz_places (
                id INTEGER PRIMARY KEY,
                url LONGVARCHAR,
                title LONGVARCHAR,
                visit_count INTEGER DEFAULT 0,
                last_visit_date INTEGER,
                hidden INTEGER DEFAULT 0
            );
            CREATE TABLE moz_bookmarks (
                id INTEGER PRIMARY KEY,
                type INTEGER,
                fk INTEGER,
                parent INTEGER,
                title LONGVARCHAR,
                dateAdded INTEGER
            );
            INSERT INTO moz_places VALUES (1, 'https://github.com', 'GitHub', 5, 1693771200000000, 0);
            INSERT INTO moz_places VALUES (2, 'https://mozilla.org', 'Mozilla', 2, 1693771210000000, 0);
            -- type=1 means bookmark (a URL), type=2 means folder.
            -- Folder hierarchy: root(1) -> 'Bookmarks Toolbar'(2) -> bookmark(3) pointing at moz_places.id=1.
            INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 'root', 0);
            INSERT INTO moz_bookmarks VALUES (2, 2, NULL, 1, 'Bookmarks Toolbar', 0);
            INSERT INTO moz_bookmarks VALUES (3, 1, 1, 2, 'GitHub', 1693771200000000);"
        ).unwrap();
    }

    #[test]
    fn reads_bookmarks_with_folder_path() {
        let bookmarks = read_bookmarks_file(&fixture_path(), &fake_firefox()).unwrap();
        let gh = bookmarks
            .iter()
            .find(|b| b.title == "GitHub")
            .expect("GitHub");
        assert_eq!(gh.url, "https://github.com");
        assert_eq!(gh.folder_path, vec!["Bookmarks Toolbar".to_string()]);
    }

    #[test]
    fn reads_history_with_query_filter() {
        let entries = read_history_file(&fixture_path(), &fake_firefox(), "mozilla", None).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "Mozilla");
    }

    #[test]
    fn missing_file_returns_empty() {
        assert_eq!(
            read_bookmarks_file(std::path::Path::new("/none"), &fake_firefox()).unwrap(),
            Vec::new()
        );
        assert_eq!(
            read_history_file(std::path::Path::new("/none"), &fake_firefox(), "", None).unwrap(),
            Vec::new()
        );
    }
}
