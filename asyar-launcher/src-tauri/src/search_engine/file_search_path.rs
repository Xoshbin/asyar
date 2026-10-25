//! Exact-path rows for root search: a typed filesystem path that exists
//! becomes one row, instead of being fuzzy-matched against the file index
//! (which cannot see hidden entries, does not expand `~`, and happily matched
//! `/etc/hosts` to `…/BuildHost.rs`).

use std::path::{Path, PathBuf};
use std::time::Duration;

use asyar_search::Tier;

use super::file_search_inline::{normalize_path_for_dedup, parent_description};
use super::models::SearchResult;
use crate::file_index::file_id::{derive_from_metadata, to_hex};

/// The absolute path the user typed, with `~` expanded and trailing
/// separators trimmed, or `None` when the query is not path-shaped. Pure: no
/// filesystem access. Spaces are allowed — unlike URLs, paths contain them.
pub fn parse_typed_path(query: &str, home: Option<&Path>) -> Option<PathBuf> {
    let q = query.trim();
    if q.is_empty() || q.chars().any(char::is_control) || q.contains("://") {
        return None;
    }
    let trim_seps = |s: &str| -> String {
        let t = if cfg!(windows) {
            s.trim_end_matches(['/', '\\'])
        } else {
            s.trim_end_matches('/')
        };
        t.to_string()
    };

    if let Some(rest) = q.strip_prefix("~/").or_else(|| q.strip_prefix("~\\")) {
        let rest = rest.trim_start_matches(['/', '\\']);
        if rest.is_empty() {
            return None;
        }
        let full = home?.join(rest);
        return Some(PathBuf::from(trim_seps(&full.to_string_lossy())));
    }
    if q.starts_with('/') {
        if q.trim_start_matches('/').is_empty() {
            return None;
        }
        return Some(PathBuf::from(trim_seps(q)));
    }
    if cfg!(windows) && is_drive_path(q) {
        return Some(PathBuf::from(trim_seps(q)));
    }
    None
}

/// `C:\x` or `C:/x`: a drive letter, a separator, and at least one more character.
fn is_drive_path(q: &str) -> bool {
    let mut chars = q.chars();
    matches!(
        (chars.next(), chars.next(), chars.next(), chars.next()),
        (Some(d), Some(':'), Some('/' | '\\'), Some(_)) if d.is_ascii_alphabetic()
    )
}

/// One root-search row for an existing path, or `None` when it does not exist
/// or cannot be read (including a dangling symlink). Hidden entries are
/// included: the user typed the whole path, so it is not an accident.
///
/// The object id is the same `file_<hex>` the file index derives, so Enter,
/// the ⌘K file actions, pinning and selection learning treat this row exactly
/// like an indexed one.
pub fn exact_path_row(path: &Path, home: Option<&Path>) -> Option<SearchResult> {
    let meta = std::fs::metadata(path).ok()?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    let path_str = path.to_string_lossy().into_owned();
    Some(SearchResult {
        object_id: format!("file_{}", to_hex(derive_from_metadata(path, &meta))),
        name,
        result_type: "file".to_string(),
        score: 1.0,
        description: parent_description(&path_str, home.and_then(Path::to_str)),
        path: Some(path_str),
        icon: None,
        extension_id: Some("file-search".to_string()),
        type_label: None,
        has_arguments: false,
        favorite: false,
        style: None,
        alias: None,
        tier: Tier::ExactTitle as u8,
    })
}

/// Puts the exact row first, dropping any row already pointing at that path.
pub fn prepend_exact_row(results: &mut Vec<SearchResult>, row: SearchResult) {
    if let Some(path) = row.path.as_deref().map(normalize_path_for_dedup) {
        results.retain(|r| r.path.as_deref().map(normalize_path_for_dedup).as_ref() != Some(&path));
    }
    results.insert(0, row);
}

/// Whether a typed path may produce an exact row. It needs File Search to be on
/// (extension enabled and the master switch, i.e. `file_search_available`)
/// *and* the root-search flag: the Settings toggle for the latter is greyed
/// out while File Search is off, but the stored flag can stay `true`.
pub fn exact_row_allowed(
    include_files: bool,
    has_typed_path: bool,
    file_search_available: bool,
    root_search_enabled: bool,
) -> bool {
    include_files && has_typed_path && file_search_available && root_search_enabled
}

/// How long the typed path's `stat` may take before the exact row is skipped.
/// A hung network mount must never hold up the rest of root search.
pub const EXACT_PATH_TIMEOUT: Duration = Duration::from_millis(150);

/// Runs `stat` for a path-shaped query on a blocking thread, bounded by
/// `timeout`. `None` for non-path queries (without calling `stat`), timeouts
/// and join failures. `stat` is injected so the timeout can be tested.
pub async fn resolve_exact_row<F>(
    query: &str,
    home: Option<PathBuf>,
    timeout: Duration,
    stat: F,
) -> Option<SearchResult>
where
    F: FnOnce(PathBuf, Option<PathBuf>) -> Option<SearchResult> + Send + 'static,
{
    let path = parse_typed_path(query, home.as_deref())?;
    let handle = tauri::async_runtime::spawn_blocking(move || stat(path, home));
    tokio::time::timeout(timeout, handle).await.ok()?.ok()?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn home() -> Option<&'static Path> {
        Some(Path::new("/home/me"))
    }

    #[test]
    fn accepts_absolute_unix_paths() {
        assert_eq!(
            parse_typed_path("/etc/hosts", home()),
            Some(PathBuf::from("/etc/hosts"))
        );
        assert_eq!(
            parse_typed_path("  /etc/hosts  ", home()),
            Some(PathBuf::from("/etc/hosts"))
        );
        assert_eq!(
            parse_typed_path("/Users/me/My Folder/a b.txt", home()),
            Some(PathBuf::from("/Users/me/My Folder/a b.txt"))
        );
        assert_eq!(
            parse_typed_path("/etc/", home()),
            Some(PathBuf::from("/etc"))
        );
    }

    #[test]
    fn expands_tilde() {
        assert_eq!(
            parse_typed_path("~/Documents", home()),
            Some(PathBuf::from("/home/me/Documents"))
        );
        assert_eq!(
            parse_typed_path("~/.config", home()),
            Some(PathBuf::from("/home/me/.config"))
        );
    }

    #[test]
    fn rejects_non_paths() {
        for q in [
            "",
            "  ",
            "/",
            "//",
            "~",
            "~/",
            "safari",
            "src/main.rs",
            "https://a.com",
            "1/2",
            "10 / 5",
            "a\0b",
            "/etc/hosts\nx",
        ] {
            assert_eq!(parse_typed_path(q, home()), None, "{q:?}");
        }
        assert_eq!(parse_typed_path("~/x", None), None);
    }

    use crate::file_index::file_id::{derive_from_metadata, to_hex};
    use crate::search_engine::models::SearchResult;
    use asyar_search::Tier;
    use std::time::Duration;
    use tempfile::TempDir;

    fn blank_row(id: &str, path: Option<&str>) -> SearchResult {
        SearchResult {
            object_id: id.to_string(),
            name: id.to_string(),
            result_type: "application".to_string(),
            score: 1.0,
            path: path.map(str::to_string),
            icon: None,
            extension_id: None,
            description: None,
            type_label: None,
            has_arguments: false,
            favorite: false,
            style: None,
            alias: None,
            tier: Tier::ExactTitle as u8,
        }
    }

    #[test]
    fn builds_a_file_row_for_an_existing_file() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("a b.txt");
        std::fs::write(&file, "x").unwrap();
        let row = exact_path_row(&file, Some(dir.path())).unwrap();
        assert_eq!(row.result_type, "file");
        assert_eq!(row.name, "a b.txt");
        assert_eq!(row.path.as_deref(), Some(file.to_str().unwrap()));
        assert_eq!(row.extension_id.as_deref(), Some("file-search"));
        assert_eq!(row.tier, Tier::ExactTitle as u8);
        assert_eq!(row.description.as_deref(), Some("~"));
        assert!(row.object_id.starts_with("file_") && row.object_id.len() == "file_".len() + 16);
    }

    #[test]
    fn builds_a_row_for_a_directory_and_a_hidden_file() {
        let dir = TempDir::new().unwrap();
        let hidden = dir.path().join(".hidden");
        std::fs::write(&hidden, "x").unwrap();
        assert!(exact_path_row(dir.path(), None).is_some());
        assert_eq!(exact_path_row(&hidden, None).unwrap().name, ".hidden");
    }

    #[test]
    fn object_id_matches_the_indexers_id() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("f.txt");
        std::fs::write(&file, "x").unwrap();
        let meta = std::fs::metadata(&file).unwrap();
        let expected = format!("file_{}", to_hex(derive_from_metadata(&file, &meta)));
        assert_eq!(exact_path_row(&file, None).unwrap().object_id, expected);
    }

    #[test]
    fn missing_path_and_broken_symlink_give_none() {
        let dir = TempDir::new().unwrap();
        assert!(exact_path_row(&dir.path().join("nope"), None).is_none());
        #[cfg(unix)]
        {
            let link = dir.path().join("dangling");
            std::os::unix::fs::symlink(dir.path().join("missing-target"), &link).unwrap();
            assert!(exact_path_row(&link, None).is_none());
        }
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_directory_does_not_panic() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new().unwrap();
        let locked = dir.path().join("locked");
        std::fs::create_dir(&locked).unwrap();
        std::fs::write(locked.join("inner.txt"), "x").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
        let result = exact_path_row(&locked.join("inner.txt"), None);
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn prepend_replaces_a_duplicate_path_and_goes_first() {
        let mut rows = vec![
            blank_row("app", None),
            blank_row("file_old", Some("/home/me/a.txt")),
        ];
        let mut exact = blank_row("file_new", Some("/home/me/a.txt"));
        exact.result_type = "file".to_string();
        prepend_exact_row(&mut rows, exact);
        let ids: Vec<&str> = rows.iter().map(|r| r.object_id.as_str()).collect();
        assert_eq!(ids, ["file_new", "app"]);
    }

    #[tokio::test]
    async fn resolve_returns_none_for_a_non_path_query_without_calling_stat() {
        let row = resolve_exact_row("safari", None, Duration::from_millis(100), |_, _| {
            panic!("stat must not run for a non-path query")
        })
        .await;
        assert!(row.is_none());
    }

    #[tokio::test]
    async fn resolve_returns_the_row_for_an_existing_path() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("f.txt");
        std::fs::write(&file, "x").unwrap();
        let row = resolve_exact_row(
            file.to_str().unwrap(),
            None,
            Duration::from_millis(1000),
            |p, h| exact_path_row(&p, h.as_deref()),
        )
        .await;
        assert_eq!(row.unwrap().name, "f.txt");
    }

    #[tokio::test]
    async fn resolve_times_out_when_stat_hangs() {
        let started = std::time::Instant::now();
        let row = resolve_exact_row(
            "/slow/mount/file",
            None,
            Duration::from_millis(50),
            |_, _| {
                std::thread::sleep(Duration::from_millis(500));
                None
            },
        )
        .await;
        assert!(row.is_none());
        assert!(started.elapsed() < Duration::from_millis(300));
    }

    #[test]
    fn exact_row_needs_file_search_on_not_just_the_root_search_flag() {
        // (include_files, typed_path, file_search_available, root_search_enabled)
        assert!(exact_row_allowed(true, true, true, true));
        // The master File Search switch is off but the stored root-search flag
        // is still true: the Settings toggle is greyed out, so no file rows.
        assert!(!exact_row_allowed(true, true, false, true));
        assert!(!exact_row_allowed(true, true, true, false));
        assert!(!exact_row_allowed(false, true, true, true));
        assert!(!exact_row_allowed(true, false, true, true));
    }

    #[cfg(windows)]
    #[test]
    fn accepts_drive_paths_on_windows() {
        assert_eq!(
            parse_typed_path(r"C:\Users\me", None),
            Some(PathBuf::from(r"C:\Users\me"))
        );
    }
}
