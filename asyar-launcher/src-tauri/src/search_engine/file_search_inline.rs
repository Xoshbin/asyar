use std::collections::HashSet;
use std::path::Path;

use asyar_search::Tier;

use crate::file_index::query::QueryOptions;
use crate::file_index::service::FileIndexState;
use crate::file_index::types::IndexStateKind;

use super::models::SearchResult;

pub const ROOT_FILE_ROW_CAP: usize = 4;
pub const MIN_FILE_QUERY_CHARS: usize = 3;
/// Hits requested from the index for a path-shaped query. The prefix filter
/// runs after the index applies its limit, so this must be well above
/// `ROOT_FILE_ROW_CAP` or the true completions can be crowded out.
pub const PATH_COMPLETION_CANDIDATES: usize = 64;

/// Inserts bounded file-index matches after the app/command match block.
///
/// `typed_prefix` is the path the user typed, when the query is path-shaped.
/// The index matches on name and ancestor *fragments*, which is wrong for a
/// literal path (`/etc/hosts` matched `…/etc/BuildHost.rs`), so such a query
/// only admits siblings that complete the typed last segment.
pub fn append_inline_file_results(
    results: &mut Vec<SearchResult>,
    query: &str,
    matched_count: usize,
    file_index: &FileIndexState,
    now: i64,
    typed_prefix: Option<&str>,
) -> usize {
    let trimmed = query.trim();
    if trimmed.chars().count() < MIN_FILE_QUERY_CHARS {
        return 0;
    }

    let config = file_index.config();
    if !config.enabled || !config.root_search_enabled {
        return 0;
    }
    if !matches!(
        file_index.status().state,
        IndexStateKind::Ready | IndexStateKind::Rescanning | IndexStateKind::CapReached
    ) {
        return 0;
    }

    let response = file_index.search(
        trimmed,
        &QueryOptions {
            type_filter: None,
            limit: if typed_prefix.is_some() {
                PATH_COMPLETION_CANDIDATES
            } else {
                ROOT_FILE_ROW_CAP + 2
            },
            include_hidden: false,
        },
        now,
    );
    let existing_paths: HashSet<String> = results
        .iter()
        .filter_map(|row| row.path.as_deref().map(normalize_path_for_dedup))
        .collect();
    let indexed_root = config
        .include_roots
        .is_empty()
        .then(|| file_index.primary_root())
        .flatten();
    let home_root = indexed_root.as_deref();
    let rows: Vec<SearchResult> = response
        .hits
        .into_iter()
        .filter(|hit| typed_prefix.is_none_or(|prefix| completes_typed_path(&hit.path, prefix)))
        .filter(|hit| !existing_paths.contains(&normalize_path_for_dedup(&hit.path)))
        .take(ROOT_FILE_ROW_CAP)
        .map(|hit| {
            let description = parent_description(&hit.path, home_root);
            SearchResult {
                object_id: format!("file_{}", hit.file_id),
                name: hit.name,
                result_type: "file".to_string(),
                score: hit.score.min(1.0),
                path: Some(hit.path),
                icon: None,
                extension_id: Some("file-search".to_string()),
                description,
                type_label: None,
                has_arguments: false,
                favorite: false,
                style: None,
                alias: None,
                tier: Tier::Files as u8,
            }
        })
        .collect();

    let inserted = rows.len();
    let insert_at = matched_count.min(results.len());
    results.splice(insert_at..insert_at, rows);
    inserted
}

/// Case-insensitive "is this hit a completion of the typed path" check: it
/// lives in the same directory as the typed path and its name starts with the
/// typed last segment. Descendants of an existing typed folder are not
/// completions — they only resemble the last segment by accident.
fn completes_typed_path(hit_path: &str, typed: &str) -> bool {
    let (hit, typed) = (Path::new(hit_path), Path::new(typed));
    let (Some(hit_parent), Some(typed_parent)) = (hit.parent(), typed.parent()) else {
        return false;
    };
    let (Some(hit_name), Some(typed_name)) = (hit.file_name(), typed.file_name()) else {
        return false;
    };
    let dir = |p: &Path| normalize_path_for_dedup(&p.to_string_lossy()).to_lowercase();
    dir(hit_parent) == dir(typed_parent)
        && hit_name
            .to_string_lossy()
            .to_lowercase()
            .starts_with(&typed_name.to_string_lossy().to_lowercase())
}

pub(super) fn normalize_path_for_dedup(path: &str) -> String {
    let trimmed = path.trim_end_matches(['/', '\\']);
    let s = trimmed.replace('\\', "/");
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

pub(super) fn parent_description(path: &str, home_root: Option<&str>) -> Option<String> {
    let parent = Path::new(path).parent()?;
    if parent.as_os_str().is_empty() {
        return None;
    }
    if let Some(home) = home_root.map(Path::new) {
        if let Ok(rest) = parent.strip_prefix(home) {
            if rest.as_os_str().is_empty() {
                return Some("~".to_string());
            }
            return Some(format!("~{}{}", std::path::MAIN_SEPARATOR, rest.display()));
        }
    }
    Some(parent.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::file_index::index::{FileIndex, ScannedEntry};
    use crate::file_index::types::{EntryKind, FileIndexConfig};

    use super::*;

    fn state(paths: &[&str]) -> FileIndexState {
        let entries = paths
            .iter()
            .map(|path| ScannedEntry {
                path: PathBuf::from(path),
                kind: EntryKind::File,
                file_id: None,
                mtime: 100,
                hidden: false,
                placeholder: false,
            })
            .collect();
        FileIndexState::with_index(
            FileIndexConfig::default(),
            FileIndex::build(vec![PathBuf::from("/home/me")], entries, 100),
        )
    }

    /// Index with explicit directory entries, so ancestor tokens and
    /// materialised paths behave as in a real scan.
    fn tree(entries: &[(&str, EntryKind)]) -> FileIndexState {
        let scanned = entries
            .iter()
            .map(|(path, kind)| ScannedEntry {
                path: PathBuf::from(path),
                kind: *kind,
                file_id: None,
                mtime: 100,
                hidden: false,
                placeholder: false,
            })
            .collect();
        FileIndexState::with_index(
            FileIndexConfig::default(),
            FileIndex::build(vec![PathBuf::from("/home/me")], scanned, 100),
        )
    }

    fn row(id: &str, path: Option<&str>, score: f32) -> SearchResult {
        SearchResult {
            object_id: id.to_string(),
            name: id.to_string(),
            result_type: "application".to_string(),
            score,
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
    fn inserts_capped_file_rows_after_the_matched_block() {
        let index = state(&[
            "/home/me/report-1.txt",
            "/home/me/report-2.txt",
            "/home/me/report-3.txt",
            "/home/me/report-4.txt",
            "/home/me/report-5.txt",
            "/home/me/report-6.txt",
        ]);
        let mut rows = vec![
            row("a", None, 1.0),
            row("b", None, 1.0),
            row("c", None, -1.0),
        ];
        assert_eq!(
            append_inline_file_results(&mut rows, "report", 2, &index, 100, None),
            4
        );
        assert!(rows[2..6].iter().all(|row| row.result_type == "file"));
        assert_eq!(rows.last().unwrap().object_id, "c");
    }

    #[test]
    fn respects_short_query_disabled_setting_and_building_state() {
        let ready = state(&["/home/me/report.txt"]);
        let mut rows = Vec::new();
        assert_eq!(
            append_inline_file_results(&mut rows, "re", 0, &ready, 100, None),
            0
        );

        let disabled = FileIndexState::new(FileIndexConfig {
            root_search_enabled: false,
            ..Default::default()
        });
        assert_eq!(
            append_inline_file_results(&mut rows, "report", 0, &disabled, 100, None),
            0
        );

        let building = FileIndexState::new(FileIndexConfig::default());
        assert_eq!(
            append_inline_file_results(&mut rows, "report", 0, &building, 100, None),
            0
        );
    }

    #[test]
    fn skips_existing_paths_and_stamps_file_tier() {
        let index = state(&["/home/me/Safari.app", "/home/me/report.txt"]);
        let mut rows = vec![row("app_safari", Some("/home/me/Safari.app"), 1.0)];
        assert_eq!(
            append_inline_file_results(&mut rows, "safari", 1, &index, 100, None),
            0
        );

        assert_eq!(
            append_inline_file_results(&mut rows, "report", 1, &index, 100, None),
            1
        );
        assert_eq!(rows[1].tier, Tier::Files as u8);
        assert_eq!(rows[1].description.as_deref(), Some("~"));

        // Windows-style backslashes in existing row deduplicate against forward-slash indexed paths
        let mut rows_win = vec![row("app_safari", Some(r"\home\me\Safari.app"), 1.0)];
        assert_eq!(
            append_inline_file_results(&mut rows_win, "safari", 1, &index, 100, None),
            0
        );
    }
    #[test]
    fn typed_prefix_keeps_only_completions_of_the_typed_path() {
        let index = tree(&[
            ("/home/me/develop", EntryKind::Dir),
            ("/home/me/develop/a.txt", EntryKind::File),
            ("/home/me/Developer", EntryKind::Dir),
            ("/home/me/Developer/b.txt", EntryKind::File),
            ("/home/me/.dotnet", EntryKind::Dir),
            ("/home/me/.dotnet/x", EntryKind::Dir),
            ("/home/me/.dotnet/x/Developer.rs", EntryKind::File),
        ]);
        let mut rows = Vec::new();
        let inserted = append_inline_file_results(
            &mut rows,
            "/home/me/dev",
            0,
            &index,
            100,
            Some("/home/me/dev"),
        );
        assert!(
            inserted > 0,
            "completions under the typed path must survive"
        );
        assert!(rows.iter().all(|r| r
            .path
            .as_deref()
            .unwrap()
            .to_lowercase()
            .starts_with("/home/me/dev")));
    }

    #[test]
    fn typed_prefix_drops_unrelated_fuzzy_hits() {
        // Without a prefix the name token "hosts" and the ancestor "etc" fuzzy-match
        // this unrelated file; with the typed path as prefix nothing is admitted.
        let index = tree(&[
            ("/home/me/.dotnet", EntryKind::Dir),
            ("/home/me/.dotnet/etc", EntryKind::Dir),
            ("/home/me/.dotnet/etc/BuildHost.rs", EntryKind::File),
        ]);
        let mut rows = Vec::new();
        assert!(
            append_inline_file_results(&mut rows, "/etc/hosts", 0, &index, 100, None) > 0,
            "control: the fuzzy match exists"
        );
        let mut rows = Vec::new();
        assert_eq!(
            append_inline_file_results(&mut rows, "/etc/hosts", 0, &index, 100, Some("/etc/hosts")),
            0
        );
    }

    #[test]
    fn typed_prefix_admits_siblings_not_descendants() {
        // Typing an existing folder must not list the deep files inside it
        // whose names merely resemble the last segment.
        let index = tree(&[
            ("/home/me/develop", EntryKind::Dir),
            ("/home/me/develop/Developer.rs", EntryKind::File),
            ("/home/me/develop/deep", EntryKind::Dir),
            ("/home/me/develop/deep/develop-notes.md", EntryKind::File),
            ("/home/me/develop-old", EntryKind::Dir),
            ("/home/me/Developer", EntryKind::Dir),
        ]);
        let mut rows = Vec::new();
        append_inline_file_results(
            &mut rows,
            "/home/me/develop",
            0,
            &index,
            100,
            Some("/home/me/develop"),
        );
        let mut paths: Vec<&str> = rows.iter().map(|r| r.path.as_deref().unwrap()).collect();
        paths.sort_unstable();
        assert_eq!(
            paths,
            [
                "/home/me/Developer",
                "/home/me/develop",
                "/home/me/develop-old"
            ]
        );
    }
}
