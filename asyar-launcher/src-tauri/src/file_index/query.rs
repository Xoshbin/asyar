//! The bounded per-keystroke query engine.
//!
//! Work is bounded *by construction* — the properties the old attempt
//! lacked:
//!
//! - **Collection cap (K):** the memmem arena scan stops after `CANDIDATE_CAP`
//!   verified candidates. Because the arena is static-rank ordered, a capped
//!   scan keeps the most promising entries.
//! - **Incremental narrowing:** when the new query extends the previous one
//!   (same index generation, same filters, no new `/` semantics), only the
//!   previous candidate set is re-verified; if the previous scan was
//!   truncated, the arena scan *resumes* where it stopped — narrowing never
//!   silently loses completeness.
//! - **Bounded fuzzy fallback:** only when substring matching is sparse, and
//!   under a hard operation budget.
//! - **Top-N heap:** results never materialize more than `limit` paths; no
//!   full sort, no per-entry allocation on the scan path.
//! - **Chunked + abortable:** the scan checks an abort callback between 2 MB
//!   chunks so a newer keystroke cancels a stale scan.

use std::collections::BinaryHeap;

use memchr::memmem;

use super::file_id;
use super::index::FileIndex;
use super::learning::LearningCache;
use super::matcher::Matcher;
use super::ranking::{self, MatchKind};
use super::types::{flags_hidden, FileHit, FileSearchResponse, FileType, HitSource, WorkMeter};

pub const CANDIDATE_CAP: usize = 2048;
pub const DEFAULT_LIMIT: usize = 50;
pub const FUZZY_MIN_QUERY_CHARS: usize = 3;
/// Fuzzy fallback runs only when substring matching found fewer candidates.
pub const FUZZY_SPARSE_THRESHOLD: usize = 48;
pub const FUZZY_OP_BUDGET: u32 = 100_000;
pub const FUZZY_CANDIDATE_CAP: usize = 256;
/// Pinned hits outrank everything: no unpinned score can exceed this.
pub const PIN_BONUS: f32 = 10.0;
const SCAN_CHUNK: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct QueryOptions {
    pub type_filter: Option<FileType>,
    /// 0 ⇒ `DEFAULT_LIMIT`.
    pub limit: usize,
    pub include_hidden: bool,
}

impl Default for QueryOptions {
    fn default() -> Self {
        Self {
            type_filter: None,
            limit: DEFAULT_LIMIT,
            include_hidden: false,
        }
    }
}

/// Session state carried between keystrokes for incremental narrowing.
pub struct QueryCache {
    index_generation: u64,
    /// Normalized (lowercased, trimmed) previous query.
    query: String,
    /// Verified substring candidates, in arena order.
    candidates: Vec<u32>,
    truncated: bool,
    /// Arena offset where the capped scan stopped.
    resume_off: usize,
    filter_key: (Option<FileType>, bool),
}

/// Executes one query. `cache` is the narrowing state — pass the same slot
/// on every keystroke of a session. `should_abort` is polled between scan
/// chunks; when it returns true the response is partial
/// (`scanned_all == false`) and the cache is invalidated.
#[allow(clippy::too_many_arguments)]
pub fn execute(
    index: &FileIndex,
    learning: &LearningCache,
    matcher: &mut Matcher,
    cache: &mut Option<QueryCache>,
    raw_query: &str,
    opts: &QueryOptions,
    now: i64,
    should_abort: &dyn Fn() -> bool,
) -> FileSearchResponse {
    let mut work = WorkMeter::default();
    let generation = index.generation();
    let normalized = raw_query.trim().to_lowercase();
    let limit = if opts.limit == 0 {
        DEFAULT_LIMIT
    } else {
        opts.limit.min(DEFAULT_LIMIT)
    };

    let (name_tokens, ancestor_tokens) = tokenize(&normalized);
    let Some(primary) = name_tokens.iter().max_by_key(|t| t.len()).cloned() else {
        return FileSearchResponse {
            hits: Vec::new(),
            truncated: false,
            scanned_all: true,
            index_generation: generation,
            work,
        };
    };
    let secondary: Vec<&str> = name_tokens
        .iter()
        .filter(|t| **t != primary)
        .map(String::as_str)
        .collect();

    let filter_key = (opts.type_filter, opts.include_hidden);

    // ---- collection: narrowing or fresh scan ----
    let mut candidates: Vec<u32> = Vec::new();
    let (mut truncated, mut resume_off, mut aborted) = (false, 0usize, false);

    let can_narrow = cache.as_ref().is_some_and(|c| {
        c.index_generation == generation
            && c.filter_key == filter_key
            && !c.query.is_empty()
            && normalized.len() > c.query.len()
            && normalized.starts_with(&c.query)
            && !normalized[c.query.len()..].contains('/')
    });

    if can_narrow {
        let c = cache.as_ref().expect("checked by can_narrow");
        work.narrowed = true;
        for &idx in &c.candidates {
            if verify_candidate(index, idx, &primary, &secondary, &ancestor_tokens, opts) {
                candidates.push(idx);
            }
        }
        if c.truncated {
            // The previous scan never covered [resume_off..]; cover it now
            // with the new (strictly rarer) needle so narrowing stays
            // complete.
            (truncated, resume_off, aborted) = scan_arena(
                index,
                &primary,
                &secondary,
                &ancestor_tokens,
                opts,
                c.resume_off,
                &mut candidates,
                &mut work,
                should_abort,
            );
        }
    } else {
        (truncated, resume_off, aborted) = scan_arena(
            index,
            &primary,
            &secondary,
            &ancestor_tokens,
            opts,
            0,
            &mut candidates,
            &mut work,
            should_abort,
        );
    }
    work.candidates_collected = candidates.len() as u32;

    // ---- bounded fuzzy fallback ----
    let mut fuzzy_candidates: Vec<u32> = Vec::new();
    if !aborted
        && candidates.len() < FUZZY_SPARSE_THRESHOLD
        && primary.chars().count() >= FUZZY_MIN_QUERY_CHARS
    {
        collect_fuzzy(
            index,
            &primary,
            &secondary,
            &ancestor_tokens,
            opts,
            &candidates,
            &mut fuzzy_candidates,
            &mut work,
        );
    }

    // ---- scoring: top-N heap, zero allocation until materialization ----
    // Scores are non-negative, so `f32::to_bits` is order-preserving and a
    // `(bits, idx)` min-heap keeps the top `limit`.
    let mut heap: BinaryHeap<std::cmp::Reverse<(u32, u32)>> = BinaryHeap::with_capacity(limit + 1);
    for &idx in &candidates {
        let kind = classify_substring_match(index.lc_name(idx), primary.as_bytes());
        let s = score_entry(index, learning, idx, kind, &normalized, now);
        work.candidates_scored += 1;
        push_top(&mut heap, s, idx, limit);
    }
    for &idx in &fuzzy_candidates {
        let name = std::str::from_utf8(index.lc_name(idx)).unwrap_or("");
        let Some(fuzzy) = matcher.score(&primary, name) else {
            continue;
        };
        let s = score_entry(
            index,
            learning,
            idx,
            MatchKind::Fuzzy(fuzzy),
            &normalized,
            now,
        );
        work.candidates_scored += 1;
        push_top(&mut heap, s, idx, limit);
    }

    let mut scored: Vec<(f32, u32)> = heap
        .into_iter()
        .map(|std::cmp::Reverse((bits, idx))| (f32::from_bits(bits), idx))
        .collect();
    scored.sort_by(|a, b| {
        b.0.total_cmp(&a.0)
            .then_with(|| index.lc_name(a.1).cmp(index.lc_name(b.1)))
    });
    let hits: Vec<FileHit> = scored
        .into_iter()
        .map(|(s, idx)| make_hit(index, learning, idx, s))
        .collect();

    if aborted {
        *cache = None;
    } else {
        *cache = Some(QueryCache {
            index_generation: generation,
            query: normalized,
            candidates,
            truncated,
            resume_off,
            filter_key,
        });
    }

    FileSearchResponse {
        hits,
        truncated,
        scanned_all: !truncated && !aborted,
        index_generation: generation,
        work,
    }
}

/// Splits a query into name tokens and ancestor-directory tokens. A token
/// containing `/` contributes its last segment as a name token and the
/// preceding segments as ancestor filters (`docs/report` ⇒ name `report`
/// under a dir matching `docs`).
fn tokenize(q: &str) -> (Vec<String>, Vec<String>) {
    let mut name_tokens = Vec::new();
    let mut ancestors = Vec::new();
    for tok in q.split_whitespace() {
        if tok.contains('/') {
            let parts: Vec<&str> = tok.split('/').filter(|p| !p.is_empty()).collect();
            if let Some((last, init)) = parts.split_last() {
                name_tokens.push((*last).to_string());
                ancestors.extend(init.iter().map(|s| (*s).to_string()));
            }
        } else {
            name_tokens.push(tok.to_string());
        }
    }
    if name_tokens.is_empty() && !ancestors.is_empty() {
        let (i, _) = ancestors
            .iter()
            .enumerate()
            .max_by_key(|(_, t)| t.len())
            .expect("non-empty");
        name_tokens.push(ancestors.remove(i));
    }
    (name_tokens, ancestors)
}

fn passes_filters(index: &FileIndex, idx: u32, opts: &QueryOptions) -> bool {
    if index.is_tombstoned(idx) {
        return false;
    }
    let e = index.entry(idx);
    if !opts.include_hidden && flags_hidden(e.flags) {
        return false;
    }
    if let Some(tf) = opts.type_filter {
        if e.file_type() != tf {
            return false;
        }
    }
    true
}

/// True when `token` occurs in the entry's lowercased name. Roots have an
/// empty match region; their full display path (lowercased) is used so a
/// `dir/` token can still match a scan root.
fn name_contains(index: &FileIndex, idx: u32, token: &str) -> bool {
    let lc = index.lc_name(idx);
    if !lc.is_empty() {
        return memmem::find(lc, token.as_bytes()).is_some();
    }
    index.disp_name(idx).to_lowercase().contains(token)
}

fn verify_tokens(index: &FileIndex, idx: u32, secondary: &[&str], ancestors: &[String]) -> bool {
    let name = index.lc_name(idx);
    for t in secondary {
        if memmem::find(name, t.as_bytes()).is_none() {
            return false;
        }
    }
    for t in ancestors {
        let mut ok = false;
        let mut cur = index.entry(idx).parent;
        let mut hops = 0;
        while cur != super::types::NO_PARENT && hops < 64 {
            if name_contains(index, cur, t) {
                ok = true;
                break;
            }
            cur = index.entry(cur).parent;
            hops += 1;
        }
        if !ok {
            return false;
        }
    }
    true
}

/// Full re-verification of a cached candidate against the new query.
fn verify_candidate(
    index: &FileIndex,
    idx: u32,
    primary: &str,
    secondary: &[&str],
    ancestors: &[String],
    opts: &QueryOptions,
) -> bool {
    passes_filters(index, idx, opts)
        && memmem::find(index.lc_name(idx), primary.as_bytes()).is_some()
        && verify_tokens(index, idx, secondary, ancestors)
}

/// Chunked, abortable memmem scan over `lc_arena[start..]`, pushing verified
/// candidates until `CANDIDATE_CAP`. Returns `(truncated, resume_off,
/// aborted)`; `resume_off` is the first arena offset NOT covered.
#[allow(clippy::too_many_arguments)]
fn scan_arena(
    index: &FileIndex,
    primary: &str,
    secondary: &[&str],
    ancestors: &[String],
    opts: &QueryOptions,
    start: usize,
    candidates: &mut Vec<u32>,
    work: &mut WorkMeter,
    should_abort: &dyn Fn() -> bool,
) -> (bool, usize, bool) {
    let arena = index.lc_arena();
    let needle = primary.as_bytes();
    if needle.is_empty() || start >= arena.len() {
        return (false, arena.len(), false);
    }
    let finder = memmem::Finder::new(needle);
    let mut last_idx: Option<u32> = None;
    let mut pos = start;
    while pos < arena.len() {
        if should_abort() {
            return (false, pos, true);
        }
        let window_end = (pos + SCAN_CHUNK).min(arena.len());
        let slice_end = (window_end + needle.len().saturating_sub(1)).min(arena.len());
        for h in finder.find_iter(&arena[pos..slice_end]) {
            let off = pos + h;
            if off >= window_end {
                break; // belongs to the next window
            }
            let Some(idx) = index.entry_at_offset(off) else {
                continue;
            };
            if last_idx == Some(idx) {
                continue; // repeated needle inside one name
            }
            last_idx = Some(idx);
            if !passes_filters(index, idx, opts) {
                continue;
            }
            if !verify_tokens(index, idx, secondary, ancestors) {
                continue;
            }
            if candidates.len() >= CANDIDATE_CAP {
                work.bytes_scanned += (off - pos) as u64;
                return (true, off, false);
            }
            candidates.push(idx);
        }
        work.bytes_scanned += (window_end - pos) as u64;
        pos = window_end;
    }
    (false, arena.len(), false)
}

/// Approximate byte rarity in file names; lower = rarer. Used to pick the
/// memchr probe byte for the fuzzy fallback.
fn byte_freq(b: u8) -> u8 {
    match b {
        b'e' => 12,
        b'a' | b'i' | b'o' | b'n' | b's' | b'r' | b't' => 10,
        b'-' | b'_' | b'.' => 9,
        b'l' | b'c' | b'd' | b'u' | b'm' => 8,
        b'0'..=b'9' => 7,
        b'p' | b'h' | b'g' | b'b' | b'f' => 6,
        b'w' | b'y' | b'v' | b'k' => 4,
        b'x' | b'z' | b'q' | b'j' => 1,
        _ => 3,
    }
}

fn is_subsequence(needle: &[u8], hay: &[u8]) -> bool {
    let mut it = hay.iter();
    needle.iter().all(|n| it.any(|h| h == n))
}

/// Bounded fuzzy candidate collection: memchr on the needle's rarest byte,
/// in-order subsequence check per distinct entry, hard op budget.
#[allow(clippy::too_many_arguments)]
fn collect_fuzzy(
    index: &FileIndex,
    primary: &str,
    secondary: &[&str],
    ancestors: &[String],
    opts: &QueryOptions,
    existing: &[u32],
    out: &mut Vec<u32>,
    work: &mut WorkMeter,
) {
    let arena = index.lc_arena();
    let Some(rare) = primary.bytes().min_by_key(|&b| byte_freq(b)) else {
        return;
    };
    let existing_set: std::collections::HashSet<u32> = existing.iter().copied().collect();
    let mut seen: std::collections::HashSet<u32> = std::collections::HashSet::new();
    let mut last_idx: Option<u32> = None;
    let mut ops: u32 = 0;
    for pos in memchr::memchr_iter(rare, arena) {
        if ops >= FUZZY_OP_BUDGET || out.len() >= FUZZY_CANDIDATE_CAP {
            break;
        }
        let Some(idx) = index.entry_at_offset(pos) else {
            continue;
        };
        if last_idx == Some(idx) {
            continue;
        }
        last_idx = Some(idx);
        if existing_set.contains(&idx) || !seen.insert(idx) {
            continue;
        }
        let name = index.lc_name(idx);
        ops += name.len() as u32;
        work.fuzzy_checks += 1;
        if !is_subsequence(primary.as_bytes(), name) {
            continue;
        }
        if !passes_filters(index, idx, opts) {
            continue;
        }
        if !verify_tokens(index, idx, secondary, ancestors) {
            continue;
        }
        out.push(idx);
    }
    work.bytes_scanned += arena.len() as u64;
}

fn classify_substring_match(name: &[u8], primary: &[u8]) -> MatchKind {
    if name == primary {
        return MatchKind::Exact;
    }
    if name.starts_with(primary) {
        return MatchKind::Prefix;
    }
    match memmem::find(name, primary) {
        Some(p) if p > 0 && matches!(name[p - 1], b'-' | b'_' | b'.' | b' ') => {
            MatchKind::WordBoundary
        }
        _ => MatchKind::Substring,
    }
}

fn score_entry(
    index: &FileIndex,
    learning: &LearningCache,
    idx: u32,
    kind: MatchKind,
    query: &str,
    now: i64,
) -> f32 {
    let e = index.entry(idx);
    let fid = index.file_id(idx);
    let boost = learning.boost(query, fid, now);
    let mut s = ranking::score(
        kind,
        e.mtime,
        now,
        index.depth(idx),
        e.file_type(),
        index.disp_name(idx),
        boost,
    );
    if learning.is_pinned(fid) {
        s += PIN_BONUS;
    }
    s
}

fn push_top(
    heap: &mut BinaryHeap<std::cmp::Reverse<(u32, u32)>>,
    score: f32,
    idx: u32,
    limit: usize,
) {
    let key = std::cmp::Reverse((score.to_bits(), idx));
    if heap.len() < limit {
        heap.push(key);
    } else if let Some(&std::cmp::Reverse((min_bits, _))) = heap.peek() {
        if score.to_bits() > min_bits {
            heap.pop();
            heap.push(key);
        }
    }
}

fn make_hit(index: &FileIndex, learning: &LearningCache, idx: u32, score: f32) -> FileHit {
    let e = index.entry(idx);
    let fid = index.file_id(idx);
    FileHit {
        file_id: file_id::to_hex(fid),
        name: index.disp_name(idx).to_string(),
        path: index.materialize_path(idx),
        file_type: e.file_type(),
        is_dir: e.is_dir(),
        modified_at: e.mtime as i64,
        score,
        pinned: learning.is_pinned(fid),
        source: HitSource::Local,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_index::index::{IndexUpdate, ScannedEntry};
    use crate::file_index::types::EntryKind;
    use std::path::PathBuf;

    const NOW: i64 = 100_000_000;

    /// Unix-style fixture path → native separators, so it round-trips
    /// through the index (which materializes with `MAIN_SEPARATOR`). No-op
    /// on Unix. Slash-token queries are unaffected: `tokenize` splits the
    /// query on `/` and matches component names, not the stored separator.
    fn np(unix: &str) -> String {
        unix.replace('/', std::path::MAIN_SEPARATOR_STR)
    }

    fn entry(path: &str, kind: EntryKind, mtime: u32) -> ScannedEntry {
        ScannedEntry {
            // hidden detection stays on the unix spelling (rsplit '/').
            path: PathBuf::from(np(path)),
            kind,
            mtime,
            hidden: path.rsplit('/').next().unwrap_or("").starts_with('.'),
            placeholder: false,
        }
    }

    fn build(paths: &[&str]) -> FileIndex {
        // Uniform mtime so ordering tests isolate match quality.
        let items = paths
            .iter()
            .map(|p| {
                let kind = if p.ends_with('/') {
                    EntryKind::Dir
                } else {
                    EntryKind::File
                };
                entry(p.trim_end_matches('/'), kind, NOW as u32)
            })
            .collect();
        FileIndex::build(vec![PathBuf::from(np("/r"))], items, NOW)
    }

    fn never() -> impl Fn() -> bool {
        || false
    }

    fn run(index: &FileIndex, cache: &mut Option<QueryCache>, q: &str) -> FileSearchResponse {
        let learning = LearningCache::new();
        let mut matcher = Matcher::new();
        execute(
            index,
            &learning,
            &mut matcher,
            cache,
            q,
            &QueryOptions::default(),
            NOW,
            &never(),
        )
    }

    fn hit_names(r: &FileSearchResponse) -> Vec<String> {
        r.hits.iter().map(|h| h.name.clone()).collect()
    }

    #[test]
    fn empty_query_returns_empty() {
        let idx = build(&["/r/a.txt"]);
        let r = run(&idx, &mut None, "   ");
        assert!(r.hits.is_empty());
        assert!(r.scanned_all);
    }

    #[test]
    fn match_quality_orders_exact_prefix_boundary_substring() {
        // Extensionless names → identical type prior; same mtime and depth.
        let idx = build(&[
            "/r/xreport",       // substring
            "/r/annual-report", // word boundary
            "/r/reportage",     // prefix
            "/r/report",        // exact
        ]);
        let r = run(&idx, &mut None, "report");
        assert_eq!(
            hit_names(&r),
            vec!["report", "reportage", "annual-report", "xreport"]
        );
        assert!(!r.truncated);
        assert!(r.scanned_all);
    }

    #[test]
    fn multi_token_query_requires_all_tokens_in_name() {
        let idx = build(&[
            "/r/report-2025.txt",
            "/r/report-2026.txt",
            "/r/notes-2026.txt",
        ]);
        let r = run(&idx, &mut None, "report 2026");
        assert_eq!(hit_names(&r), vec!["report-2026.txt"]);
    }

    #[test]
    fn slash_token_filters_by_ancestor_directory() {
        let idx = build(&[
            "/r/docs/",
            "/r/src/",
            "/r/docs/report.txt",
            "/r/src/report.txt",
        ]);
        let r = run(&idx, &mut None, "docs/report");
        assert_eq!(r.hits.len(), 1);
        assert_eq!(r.hits[0].path, np("/r/docs/report.txt"));
    }

    #[test]
    fn type_filter_and_hidden_are_respected() {
        let idx = build(&["/r/a-match.pdf", "/r/a-match.png", "/r/.a-match-hidden.pdf"]);
        let learning = LearningCache::new();
        let mut matcher = Matcher::new();

        // Hidden excluded by default.
        let r = run(&idx, &mut None, "a-match");
        let names = hit_names(&r);
        assert!(names.contains(&"a-match.pdf".to_string()));
        assert!(!names.iter().any(|n| n.contains("hidden")));

        // Type filter keeps only images.
        let r = execute(
            &idx,
            &learning,
            &mut matcher,
            &mut None,
            "a-match",
            &QueryOptions {
                type_filter: Some(FileType::Image),
                ..Default::default()
            },
            NOW,
            &never(),
        );
        assert_eq!(hit_names(&r), vec!["a-match.png"]);

        // include_hidden surfaces the dotfile.
        let r = execute(
            &idx,
            &learning,
            &mut matcher,
            &mut None,
            "a-match",
            &QueryOptions {
                include_hidden: true,
                ..Default::default()
            },
            NOW,
            &never(),
        );
        assert!(hit_names(&r).iter().any(|n| n.contains("hidden")));
    }

    #[test]
    fn same_name_with_repeated_needle_yields_one_hit() {
        let idx = build(&["/r/report-report.txt"]);
        let r = run(&idx, &mut None, "report");
        assert_eq!(r.hits.len(), 1);
    }

    #[test]
    fn cap_bounds_collection_and_marks_truncated() {
        let paths: Vec<String> = (0..3000).map(|i| format!("/r/match-{i:04}.txt")).collect();
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        let idx = build(&refs);
        let r = run(&idx, &mut None, "match");
        assert!(r.truncated);
        assert!(!r.scanned_all);
        assert_eq!(r.work.candidates_collected as usize, CANDIDATE_CAP);
        assert!(r.work.candidates_scored as usize <= CANDIDATE_CAP);
        assert_eq!(r.hits.len(), DEFAULT_LIMIT);
    }

    #[test]
    fn narrowing_extends_previous_query_and_stays_complete_after_truncation() {
        // 3000 names contain "ma"; 30 of them contain "match", scattered so
        // some live beyond the first CANDIDATE_CAP candidates. The narrowed
        // "match" query must resume the scan and find ALL of them.
        let mut paths: Vec<String> = Vec::new();
        for i in 0..3000 {
            if i % 100 == 0 {
                paths.push(format!("/r/match-{i:04}.txt"));
            } else {
                paths.push(format!("/r/ma-{i:04}.txt"));
            }
        }
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        let idx = build(&refs);

        let mut cache = None;
        let first = run(&idx, &mut cache, "ma");
        assert!(first.truncated);

        let narrowed = run(&idx, &mut cache, "match");
        assert!(narrowed.work.narrowed, "must take the narrowing path");

        let mut fresh_cache = None;
        let fresh = run(&idx, &mut fresh_cache, "match");

        let mut a: Vec<String> = narrowed.hits.iter().map(|h| h.path.clone()).collect();
        let mut b: Vec<String> = fresh.hits.iter().map(|h| h.path.clone()).collect();
        a.sort();
        b.sort();
        assert_eq!(a, b, "narrowed results must equal fresh-scan results");
        assert_eq!(a.len(), 30);
    }

    #[test]
    fn narrowing_rejected_when_extension_introduces_slash() {
        let idx = build(&["/r/docs/", "/r/docs/rep.txt", "/r/repo.txt"]);
        let mut cache = None;
        let _ = run(&idx, &mut cache, "rep");
        let r = run(&idx, &mut cache, "rep/x");
        assert!(!r.work.narrowed, "slash changes semantics → fresh scan");
    }

    #[test]
    fn narrowing_invalidated_by_index_generation_change() {
        let mut idx = build(&["/r/alpha-one.txt", "/r/alpha-two.txt"]);
        let mut cache = None;
        let _ = run(&idx, &mut cache, "alpha");
        idx.apply_batch(
            vec![IndexUpdate::Upserted(entry(
                "/r/alpha-three.txt",
                EntryKind::File,
                NOW as u32,
            ))],
            NOW,
        );
        let r = run(&idx, &mut cache, "alpha-t");
        assert!(!r.work.narrowed, "generation bump must force fresh scan");
        assert!(hit_names(&r).contains(&"alpha-three.txt".to_string()));
    }

    #[test]
    fn fuzzy_finds_subsequence_only_when_sparse() {
        let idx = build(&["/r/report-final.txt", "/r/unrelated.txt"]);
        let r = run(&idx, &mut None, "rprt");
        assert!(
            r.hits.iter().any(|h| h.name == "report-final.txt"),
            "fuzzy fallback must find the subsequence match, got {:?}",
            hit_names(&r)
        );
        assert!(r.work.fuzzy_checks > 0);
    }

    #[test]
    fn fuzzy_skipped_when_substring_matches_abound() {
        let paths: Vec<String> = (0..100).map(|i| format!("/r/abundant-{i}.txt")).collect();
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        let idx = build(&refs);
        let r = run(&idx, &mut None, "abundant");
        assert_eq!(r.work.fuzzy_checks, 0);
    }

    #[test]
    fn pinned_hits_rank_first_and_learning_boost_applies() {
        let idx = build(&["/r/aaa-doc.txt", "/r/bbb-doc.txt", "/r/ccc-doc.txt"]);
        let ccc = (0..idx.entries_len() as u32)
            .find(|&i| idx.disp_name(i) == "ccc-doc.txt")
            .unwrap();
        let bbb = (0..idx.entries_len() as u32)
            .find(|&i| idx.disp_name(i) == "bbb-doc.txt")
            .unwrap();

        let mut learning = LearningCache::new();
        learning.set_pinned(idx.file_id(ccc), true);
        for _ in 0..10 {
            learning.record_selection("doc", idx.file_id(bbb), NOW);
        }

        let mut matcher = Matcher::new();
        let r = execute(
            &idx,
            &learning,
            &mut matcher,
            &mut None,
            "doc",
            &QueryOptions::default(),
            NOW,
            &never(),
        );
        let names = hit_names(&r);
        assert_eq!(names[0], "ccc-doc.txt", "pinned first, got {names:?}");
        assert_eq!(names[1], "bbb-doc.txt", "boosted second, got {names:?}");
        assert!(r.hits[0].pinned);
        assert!(r.hits[0].score > PIN_BONUS);
    }

    #[test]
    fn abort_yields_partial_response_and_drops_cache() {
        let paths: Vec<String> = (0..500).map(|i| format!("/r/abort-{i}.txt")).collect();
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        let idx = build(&refs);

        let learning = LearningCache::new();
        let mut matcher = Matcher::new();
        let mut cache = None;
        let r = execute(
            &idx,
            &learning,
            &mut matcher,
            &mut cache,
            "abort",
            &QueryOptions::default(),
            NOW,
            &(|| true),
        );
        assert!(!r.scanned_all);
        assert!(cache.is_none(), "aborted scan must not seed the cache");
    }

    #[test]
    fn hits_carry_wire_fields() {
        let idx = build(&["/r/docs/", "/r/docs/Report.PDF"]);
        let r = run(&idx, &mut None, "report");
        assert_eq!(r.hits.len(), 1);
        let h = &r.hits[0];
        assert_eq!(h.name, "Report.PDF");
        assert_eq!(h.path, np("/r/docs/Report.PDF"));
        assert_eq!(h.file_type, FileType::Document);
        assert!(!h.is_dir);
        assert_eq!(h.modified_at, NOW);
        assert_eq!(h.source, HitSource::Local);
        assert_eq!(h.file_id.len(), 16);
        assert_eq!(r.index_generation, idx.generation());
    }

    /// CI perf regression: operation counts are asserted, never wall-clock.
    /// The bounds are N-independent — this is the contract that keeps the
    /// keystroke path fast at any index size.
    #[test]
    fn perf_budget_op_counts_on_synthetic_index() {
        // ~120k entries; names from a deterministic LCG so a 2-char query is
        // common (truncates) and its 3-char extension is rarer.
        let mut lcg: u64 = 0x243F6A8885A308D3;
        let mut next = || {
            lcg = lcg
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            lcg
        };
        const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
        let mut paths: Vec<String> = Vec::with_capacity(120_000);
        for i in 0..120_000u32 {
            let mut name = String::new();
            let len = 6 + (next() % 7) as usize;
            for _ in 0..len {
                name.push(ALPHABET[(next() % ALPHABET.len() as u64) as usize] as char);
            }
            paths.push(format!("/r/d{}/{}-{}.txt", i % 200, name, i));
        }
        let mut items: Vec<ScannedEntry> = (0..200)
            .map(|d| entry(&format!("/r/d{d}"), EntryKind::Dir, NOW as u32))
            .collect();
        items.extend(paths.iter().map(|p| entry(p, EntryKind::File, NOW as u32)));
        let idx = FileIndex::build(vec![PathBuf::from(np("/r"))], items, NOW);

        let learning = LearningCache::new();
        let mut matcher = Matcher::new();
        let mut cache = None;

        // First keystroke pair "aa" → common, must cap.
        let r1 = execute(
            &idx,
            &learning,
            &mut matcher,
            &mut cache,
            "aa",
            &QueryOptions::default(),
            NOW,
            &never(),
        );
        assert!(
            r1.work.candidates_scored as usize <= CANDIDATE_CAP + FUZZY_CANDIDATE_CAP,
            "scored {} > budget",
            r1.work.candidates_scored
        );
        assert!(r1.hits.len() <= DEFAULT_LIMIT);

        // Extension "aa3" → narrowing path, bounded re-verification.
        let r2 = execute(
            &idx,
            &learning,
            &mut matcher,
            &mut cache,
            "aa3",
            &QueryOptions::default(),
            NOW,
            &never(),
        );
        assert!(r2.work.narrowed);
        assert!(
            r2.work.candidates_scored as usize <= CANDIDATE_CAP + FUZZY_CANDIDATE_CAP,
            "scored {} > budget",
            r2.work.candidates_scored
        );

        // Every response obeys the global work contract.
        for r in [&r1, &r2] {
            assert!(r.work.candidates_collected as usize <= CANDIDATE_CAP);
            assert!(r.work.fuzzy_checks <= FUZZY_OP_BUDGET);
        }
    }

    /// Manual release-mode bench (not run in CI):
    /// `cargo test --release perf_bench_wall_clock -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn perf_bench_wall_clock_1m_entries() {
        let mut lcg: u64 = 0x9E3779B97F4A7C15;
        let mut next = || {
            lcg = lcg
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            lcg
        };
        const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut items: Vec<ScannedEntry> = (0..1000)
            .map(|d| entry(&format!("/r/d{d}"), EntryKind::Dir, NOW as u32))
            .collect();
        for i in 0..1_000_000u32 {
            let mut name = String::new();
            let len = 6 + (next() % 10) as usize;
            for _ in 0..len {
                name.push(ALPHABET[(next() % ALPHABET.len() as u64) as usize] as char);
            }
            items.push(entry(
                &format!("/r/d{}/{}-{}.txt", i % 1000, name, i),
                EntryKind::File,
                NOW as u32,
            ));
        }
        let build_start = std::time::Instant::now();
        let idx = FileIndex::build(vec![PathBuf::from(np("/r"))], items, NOW);
        eprintln!("build 1M: {:?}", build_start.elapsed());

        let learning = LearningCache::new();
        let mut matcher = Matcher::new();
        let mut cache = None;
        let tape = ["r", "re", "rep", "repo", "repor", "report", "zqx", "zqxj"];
        let mut worst = std::time::Duration::ZERO;
        let mut total = std::time::Duration::ZERO;
        for q in tape {
            let t = std::time::Instant::now();
            let r = execute(
                &idx,
                &learning,
                &mut matcher,
                &mut cache,
                q,
                &QueryOptions::default(),
                NOW,
                &never(),
            );
            let dt = t.elapsed();
            eprintln!(
                "{q:>7}: {dt:?} hits={} narrowed={} scanned={}B",
                r.hits.len(),
                r.work.narrowed,
                r.work.bytes_scanned
            );
            worst = worst.max(dt);
            total += dt;
        }
        assert!(worst.as_millis() < 15, "worst {worst:?} over 15ms budget");
        assert!(
            total.as_millis() / tape.len() as u128 <= 5,
            "avg over 5ms budget"
        );
    }
}
