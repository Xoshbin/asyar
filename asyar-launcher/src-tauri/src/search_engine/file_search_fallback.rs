//! The root-search engine's only file-search touch point: a single
//! synthetic "Search files for…" row appended when matches are sparse and
//! the file index is enabled. Deliberately kept outside `SearchState` —
//! this is a pure, O(1) post-processing step over the already-computed
//! `merged_search` result, not a new data source the hot path has to
//! query. See `commands.rs::merged_search` for the call site.

use super::models::SearchResult;
use super::ranker::Tier;

pub const FILE_SEARCH_FALLBACK_OBJECT_ID: &str = "cmd_file-search_show-files";
const MAX_MATCHED_TO_SHOW_FALLBACK: usize = 5;
const MAX_QUERY_LABEL_CHARS: usize = 60;

/// Appends the fallback row in place, right below the real matches
/// (`results[..matched_count]`) and above any frecency backfill. No-op
/// when: the file index isn't available/enabled, the query is under 2
/// chars, there are already enough real matches, or the real "Search
/// Files" command already matched (typing "files" shouldn't show it
/// twice).
pub fn append_file_search_fallback(
    results: &mut Vec<SearchResult>,
    query: &str,
    matched_count: usize,
    file_search_available: bool,
) {
    let trimmed = query.trim();
    if !file_search_available
        || trimmed.chars().count() < 2
        || matched_count >= MAX_MATCHED_TO_SHOW_FALLBACK
    {
        return;
    }
    if results
        .iter()
        .any(|r| r.object_id == FILE_SEARCH_FALLBACK_OBJECT_ID)
    {
        return;
    }

    let label: String = trimmed.chars().take(MAX_QUERY_LABEL_CHARS).collect();
    let ellipsis = if trimmed.chars().count() > MAX_QUERY_LABEL_CHARS {
        "…"
    } else {
        ""
    };
    let row = SearchResult {
        object_id: FILE_SEARCH_FALLBACK_OBJECT_ID.to_string(),
        name: format!("Search files for \u{201c}{label}{ellipsis}\u{201d}…"),
        result_type: "command".to_string(),
        score: 0.0,
        path: None,
        icon: Some("icon:folder-search".to_string()),
        extension_id: Some("file-search".to_string()),
        description: None,
        style: None,
        alias: None,
        tier: Tier::FrecencyOnly as u8,
    };

    let insert_at = matched_count.min(results.len());
    results.insert(insert_at, row);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(object_id: &str) -> SearchResult {
        SearchResult {
            object_id: object_id.to_string(),
            name: object_id.to_string(),
            result_type: "application".to_string(),
            score: 0.5,
            path: None,
            icon: None,
            extension_id: None,
            description: None,
            style: None,
            alias: None,
            tier: Tier::TitleFuzzy as u8,
        }
    }

    #[test]
    fn appends_when_sparse_and_available() {
        let mut results = vec![result("app_a")];
        append_file_search_fallback(&mut results, "invoi", 1, true);
        assert_eq!(results.len(), 2);
        assert_eq!(results[1].object_id, FILE_SEARCH_FALLBACK_OBJECT_ID);
        assert!(results[1].name.contains("invoi"));
    }

    #[test]
    fn inserts_right_after_real_matches_before_backfill() {
        let mut results = vec![result("app_a"), result("app_b")];
        // Simulate backfill already appended (matched_count=2, but vec has 3
        // entries because a backfill suggestion was pushed).
        results.push(result("app_backfill"));
        append_file_search_fallback(&mut results, "xy", 2, true);
        assert_eq!(results[2].object_id, FILE_SEARCH_FALLBACK_OBJECT_ID);
        assert_eq!(results[3].object_id, "app_backfill");
    }

    #[test]
    fn no_op_when_unavailable() {
        let mut results = vec![result("app_a")];
        append_file_search_fallback(&mut results, "invoi", 1, false);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn no_op_when_query_too_short() {
        let mut results: Vec<SearchResult> = vec![];
        append_file_search_fallback(&mut results, "i", 0, true);
        assert!(results.is_empty());
        append_file_search_fallback(&mut results, "  ", 0, true);
        assert!(results.is_empty());
    }

    #[test]
    fn no_op_when_matches_are_plentiful() {
        let mut results: Vec<SearchResult> = (0..5).map(|i| result(&format!("app_{i}"))).collect();
        append_file_search_fallback(&mut results, "app", 5, true);
        assert_eq!(results.len(), 5, "5 matches already meets the threshold");
    }

    #[test]
    fn no_op_when_real_file_search_command_already_matched() {
        let mut results = vec![result(FILE_SEARCH_FALLBACK_OBJECT_ID)];
        append_file_search_fallback(&mut results, "files", 1, true);
        assert_eq!(results.len(), 1, "must not duplicate the real command");
    }

    #[test]
    fn truncates_long_query_in_label() {
        let mut results: Vec<SearchResult> = vec![];
        let long_query = "a".repeat(80);
        append_file_search_fallback(&mut results, &long_query, 0, true);
        assert_eq!(results.len(), 1);
        assert!(
            results[0].name.contains('…'),
            "long label must be truncated with an ellipsis"
        );
        assert!(results[0].name.len() < long_query.len() + 20);
    }
}
