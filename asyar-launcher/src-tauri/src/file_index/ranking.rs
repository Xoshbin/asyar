//! Pure ranking functions for file hits.
//!
//! `final_score = match_quality × frecency × depth_factor × type_prior
//!              + per_query_boost (clamped to 0..0.5)`
//!
//! Pins are handled above this layer (a pinned hit gets +10 in `query.rs`,
//! which dominates every unpinned score). `static_rank` is the same formula
//! minus the match component — it orders entries in the arena at build time
//! so a capped candidate collection keeps the most promising entries.
//!
//! Depth here is *relative*: parent-chain hops from the scan root (a file
//! directly in the root has depth 1). The old attempt counted `/` in the
//! absolute path; relative hops rank the same intent (shallow = better)
//! without depending on where the root itself lives.

use super::types::FileType;

pub fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// How the query matched the file name; determines the match-quality base.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MatchKind {
    /// Name equals the query.
    Exact,
    /// Name starts with the query.
    Prefix,
    /// Match starts right after a separator (`-`, `_`, `.`, space).
    WordBoundary,
    /// Match anywhere else in the name.
    Substring,
    /// Non-contiguous fuzzy match; payload is the nucleo score in 0..1.
    Fuzzy(f32),
}

pub fn match_quality(kind: MatchKind) -> f32 {
    match kind {
        MatchKind::Exact => 1.0,
        MatchKind::Prefix => 0.9,
        MatchKind::WordBoundary => 0.8,
        MatchKind::Substring => 0.7,
        MatchKind::Fuzzy(s) => 0.4 + 0.2 * s.clamp(0.0, 1.0),
    }
}

/// Recency-decay multiplier: very recent files (< 1 day) get 2.0×,
/// files older than 1 year get 0.5×. Steps in between.
pub fn frecency_factor(mtime: u32, now: i64) -> f32 {
    let age_days = ((now - mtime as i64).max(0) as f32) / 86_400.0;
    if age_days < 1.0 {
        2.0
    } else if age_days < 7.0 {
        1.5
    } else if age_days < 30.0 {
        1.2
    } else if age_days < 90.0 {
        1.0
    } else if age_days < 365.0 {
        0.75
    } else {
        0.5
    }
}

/// Depth penalty on parent-chain hops from the scan root:
/// root-level items are boosted, deeply nested ones penalized.
pub fn path_depth_factor(depth: u32) -> f32 {
    match depth {
        0..=1 => 1.2,
        2..=3 => 1.1,
        4..=5 => 1.0,
        6..=7 => 0.9,
        _ => 0.8,
    }
}

/// File-type prior: docs/images/code/AV are 1.5×; folders 1.2×;
/// archives 1.0×; other 0.8×. Backups (.bak / .swp / trailing ~) drop to 0.3.
pub fn file_type_prior(ft: FileType, name: &str) -> f32 {
    if name.ends_with(".bak") || name.ends_with(".swp") || name.ends_with('~') {
        return 0.3;
    }
    match ft {
        FileType::Document | FileType::Image | FileType::Code | FileType::AudioVideo => 1.5,
        FileType::Folder => 1.2,
        FileType::Archive => 1.0,
        FileType::Other => 0.8,
    }
}

/// Combined score: multiplicative base + additive boost (clamped 0..0.5).
pub fn score(
    kind: MatchKind,
    mtime: u32,
    now: i64,
    depth: u32,
    ft: FileType,
    name: &str,
    per_query_boost: f32,
) -> f32 {
    let base = match_quality(kind)
        * frecency_factor(mtime, now)
        * path_depth_factor(depth)
        * file_type_prior(ft, name);
    base + per_query_boost.clamp(0.0, 0.5)
}

/// Build-time ordering key: the score formula without a match component.
/// Entries are laid out in the arena in descending `static_rank` order, so
/// when candidate collection stops at the cap it has kept the entries most
/// likely to rank well.
pub fn static_rank(mtime: u32, now: i64, depth: u32, ft: FileType, name: &str) -> f32 {
    frecency_factor(mtime, now) * path_depth_factor(depth) * file_type_prior(ft, name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frecency_recent_file_is_boosted() {
        let now = 100_000_000i64; // large enough that now − 60d stays positive
        assert_eq!(frecency_factor((now - 3_600) as u32, now), 2.0); // 1h ago
        assert_eq!(frecency_factor((now - 3 * 86_400) as u32, now), 1.5);
        assert_eq!(frecency_factor((now - 20 * 86_400) as u32, now), 1.2);
        assert_eq!(frecency_factor((now - 60 * 86_400) as u32, now), 1.0);
    }

    #[test]
    fn frecency_old_file_is_penalized() {
        let now = 40_000_000i64;
        assert_eq!(frecency_factor((now - 200 * 86_400) as u32, now), 0.75);
        assert_eq!(frecency_factor((now - 366 * 86_400) as u32, now), 0.5);
    }

    #[test]
    fn frecency_future_mtime_counts_as_now() {
        // Clock skew / cloud sync can stamp files "in the future" — treat as
        // age zero, never negative.
        let now = 1_000_000i64;
        assert_eq!(frecency_factor((now + 86_400) as u32, now), 2.0);
    }

    #[test]
    fn depth_shallow_is_boosted_deep_is_penalized() {
        assert_eq!(path_depth_factor(0), 1.2);
        assert_eq!(path_depth_factor(1), 1.2);
        assert_eq!(path_depth_factor(2), 1.1);
        assert_eq!(path_depth_factor(3), 1.1);
        assert_eq!(path_depth_factor(4), 1.0);
        assert_eq!(path_depth_factor(5), 1.0);
        assert_eq!(path_depth_factor(6), 0.9);
        assert_eq!(path_depth_factor(7), 0.9);
        assert_eq!(path_depth_factor(8), 0.8);
        assert_eq!(path_depth_factor(30), 0.8);
    }

    #[test]
    fn type_prior_documents_boosted() {
        assert_eq!(file_type_prior(FileType::Document, "a.pdf"), 1.5);
        assert_eq!(file_type_prior(FileType::Image, "a.png"), 1.5);
        assert_eq!(file_type_prior(FileType::Folder, "src"), 1.2);
        assert_eq!(file_type_prior(FileType::Archive, "a.zip"), 1.0);
        assert_eq!(file_type_prior(FileType::Other, "a.dat"), 0.8);
    }

    #[test]
    fn type_prior_backups_strongly_penalised() {
        assert_eq!(file_type_prior(FileType::Document, "a.txt.bak"), 0.3);
        assert_eq!(file_type_prior(FileType::Other, "a.swp"), 0.3);
        assert_eq!(file_type_prior(FileType::Other, "file~"), 0.3);
    }

    #[test]
    fn match_quality_orders_exact_over_prefix_over_boundary_over_substring() {
        let exact = match_quality(MatchKind::Exact);
        let prefix = match_quality(MatchKind::Prefix);
        let boundary = match_quality(MatchKind::WordBoundary);
        let substring = match_quality(MatchKind::Substring);
        let fuzzy_hi = match_quality(MatchKind::Fuzzy(1.0));
        let fuzzy_lo = match_quality(MatchKind::Fuzzy(0.0));
        assert_eq!(exact, 1.0);
        assert!(exact > prefix && prefix > boundary && boundary > substring);
        assert!(substring > fuzzy_hi, "substring beats best fuzzy");
        assert!(fuzzy_hi > fuzzy_lo);
        assert!((0.35..=0.65).contains(&fuzzy_lo) && (0.35..=0.65).contains(&fuzzy_hi));
    }

    #[test]
    fn combined_score_clamps_boost() {
        let now = 1_000_000i64;
        // mtime = now → frecency 2.0; depth 1 → 1.2; Document → 1.5.
        // base = 1.0 × 2.0 × 1.2 × 1.5 = 3.6; boost clamped to 0.5 → 4.1.
        let s = score(
            MatchKind::Exact,
            now as u32,
            now,
            1,
            FileType::Document,
            "a.txt",
            999.0,
        );
        assert!((s - 4.1).abs() < 0.01, "got {s}");
    }

    #[test]
    fn static_rank_prefers_recent_shallow_docs_over_old_deep_other() {
        let now = 40_000_000i64;
        let good = static_rank(now as u32, now, 1, FileType::Document, "a.pdf");
        let bad = static_rank(
            (now - 400 * 86_400) as u32,
            now,
            12,
            FileType::Other,
            "x.dat",
        );
        assert!(good > bad, "good {good} vs bad {bad}");
    }
}
