use std::collections::HashSet;
use std::path::Path;

use asyar_search::Tier;

use crate::file_index::query::QueryOptions;
use crate::file_index::service::FileIndexState;
use crate::file_index::types::IndexStateKind;

use super::file_search_fallback::FILE_SEARCH_FALLBACK_OBJECT_ID;
use super::models::SearchResult;

pub const ROOT_FILE_ROW_CAP: usize = 4;
pub const MIN_FILE_QUERY_CHARS: usize = 3;

/// Inserts bounded file-index matches after the app/command match block.
pub fn append_inline_file_results(
    results: &mut Vec<SearchResult>,
    query: &str,
    matched_count: usize,
    file_index: &FileIndexState,
    now: i64,
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
            limit: ROOT_FILE_ROW_CAP + 2,
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
    let mut rows: Vec<SearchResult> = response
        .hits
        .into_iter()
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
    if response.truncated {
        rows.push(drill_down_row(trimmed));
    }
    let insert_at = matched_count.min(results.len());
    results.splice(insert_at..insert_at, rows);
    inserted
}

fn normalize_path_for_dedup(path: &str) -> String {
    let trimmed = path.trim_end_matches(['/', '\\']);
    let s = trimmed.replace('\\', "/");
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

fn parent_description(path: &str, home_root: Option<&str>) -> Option<String> {
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

fn drill_down_row(query: &str) -> SearchResult {
    SearchResult {
        object_id: FILE_SEARCH_FALLBACK_OBJECT_ID.to_string(),
        name: format!("Search files for “{query}”…"),
        result_type: "command".to_string(),
        score: 0.0,
        path: None,
        icon: Some("icon:folder-search".to_string()),
        extension_id: Some("file-search".to_string()),
        description: None,
        type_label: None,
        has_arguments: false,
        favorite: false,
        style: None,
        alias: None,
        tier: Tier::FrecencyOnly as u8,
    }
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
            append_inline_file_results(&mut rows, "report", 2, &index, 100),
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
            append_inline_file_results(&mut rows, "re", 0, &ready, 100),
            0
        );

        let disabled = FileIndexState::new(FileIndexConfig {
            root_search_enabled: false,
            ..Default::default()
        });
        assert_eq!(
            append_inline_file_results(&mut rows, "report", 0, &disabled, 100),
            0
        );

        let building = FileIndexState::new(FileIndexConfig::default());
        assert_eq!(
            append_inline_file_results(&mut rows, "report", 0, &building, 100),
            0
        );
    }

    #[test]
    fn skips_existing_paths_and_stamps_file_tier() {
        let index = state(&["/home/me/Safari.app", "/home/me/report.txt"]);
        let mut rows = vec![row("app_safari", Some("/home/me/Safari.app"), 1.0)];
        assert_eq!(
            append_inline_file_results(&mut rows, "safari", 1, &index, 100),
            0
        );

        assert_eq!(
            append_inline_file_results(&mut rows, "report", 1, &index, 100),
            1
        );
        assert_eq!(rows[1].tier, Tier::Files as u8);
        assert_eq!(rows[1].description.as_deref(), Some("~"));

        // Windows-style backslashes in existing row deduplicate against forward-slash indexed paths
        let mut rows_win = vec![row("app_safari", Some(r"\home\me\Safari.app"), 1.0)];
        assert_eq!(
            append_inline_file_results(&mut rows_win, "safari", 1, &index, 100),
            0
        );
    }
}
