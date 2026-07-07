//! File-index lifecycle orchestration.
//!
//! Deliberately Tauri-agnostic: every method here takes plain data (paths,
//! configs, timestamps) and returns plain data. `AppHandle`-specific work —
//! spawning the detached startup thread, emitting `asyar:file-index-status`
//! events, reading/writing `settings.dat` — belongs to `commands.rs` and
//! `lib.rs`, mirroring how `application::service` stays free of watcher
//! plumbing. That split is what makes the state machine below testable
//! without `tauri::test::mock_app()`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, RwLock};

use super::index::{FileIndex, IndexUpdate};
use super::learning::LearningCache;
use super::matcher::Matcher;
use super::query::{self, QueryCache, QueryOptions};
use super::snapshot;
use super::types::{FileIndexConfig, FileSearchResponse, IndexStateKind, IndexStatus, WorkMeter};
use super::walker::{self, WalkOutcome};

pub struct FileIndexState {
    index: RwLock<FileIndex>,
    query_cache: Mutex<Option<QueryCache>>,
    matcher: Mutex<Matcher>,
    learning: RwLock<LearningCache>,
    config: RwLock<FileIndexConfig>,
    status: Mutex<IndexStatus>,
    /// Bumped on every `search()` call; a query's abort check compares its
    /// captured token against the live value, so a newer keystroke's call
    /// cancels an older in-flight scan instead of racing it to completion.
    query_epoch: AtomicU64,
}

fn empty_response() -> FileSearchResponse {
    FileSearchResponse {
        hits: Vec::new(),
        truncated: false,
        scanned_all: true,
        index_generation: 0,
        work: WorkMeter::default(),
    }
}

impl FileIndexState {
    pub fn new(config: FileIndexConfig) -> Self {
        let state = if config.enabled {
            IndexStateKind::Building
        } else {
            IndexStateKind::Disabled
        };
        Self {
            index: RwLock::new(FileIndex::empty()),
            query_cache: Mutex::new(None),
            matcher: Mutex::new(Matcher::new()),
            learning: RwLock::new(LearningCache::new()),
            config: RwLock::new(config),
            status: Mutex::new(IndexStatus {
                state,
                entry_count: 0,
                last_scan_ms: 0,
                snapshot_loaded: false,
                cap_reached: false,
            }),
            query_epoch: AtomicU64::new(0),
        }
    }

    #[cfg(test)]
    pub fn with_index(config: FileIndexConfig, index: FileIndex) -> Self {
        let s = Self::new(config);
        let entry_count = index.live_count() as u64;
        *s.index.write().unwrap() = index;
        s.status.lock().unwrap().entry_count = entry_count;
        s.status.lock().unwrap().state = IndexStateKind::Ready;
        s
    }

    pub fn config(&self) -> FileIndexConfig {
        self.config.read().expect("config lock").clone()
    }

    pub fn status(&self) -> IndexStatus {
        self.status.lock().expect("status lock").clone()
    }

    pub fn learning_boost(&self, query: &str, file_id: u64, now: i64) -> f32 {
        self.learning
            .read()
            .expect("learning lock")
            .boost(query, file_id, now)
    }

    pub fn is_pinned(&self, file_id: u64) -> bool {
        self.learning
            .read()
            .expect("learning lock")
            .is_pinned(file_id)
    }

    /// Registers a token for one query invocation and a callback that
    /// reports "abort" once a *later* call to `begin_query` has happened.
    fn begin_query(&self) -> (u64, impl Fn() -> bool + '_) {
        let token = self.query_epoch.fetch_add(1, Ordering::SeqCst) + 1;
        (token, move || {
            self.query_epoch.load(Ordering::SeqCst) != token
        })
    }

    /// Runs one query through the bounded engine, reusing the persistent
    /// `Matcher` and `QueryCache` — never allocated per call. Returns an
    /// empty response without touching the index when the feature is
    /// disabled in settings.
    pub fn search(&self, raw_query: &str, opts: &QueryOptions, now: i64) -> FileSearchResponse {
        if !self.config.read().expect("config lock").enabled {
            return empty_response();
        }
        let (_, should_abort) = self.begin_query();
        let index = self.index.read().expect("index lock");
        let learning = self.learning.read().expect("learning lock");
        let mut matcher = self.matcher.lock().expect("matcher lock");
        let mut cache = self.query_cache.lock().expect("query cache lock");
        query::execute(
            &index,
            &learning,
            &mut matcher,
            &mut cache,
            raw_query,
            opts,
            now,
            &should_abort,
        )
    }

    /// Toggling off drops the in-memory index (nothing left to search, and
    /// nothing left to leak into the root-search fallback row); toggling on
    /// puts the state machine back into `Building` so the caller knows to
    /// kick a scan.
    pub fn set_enabled(&self, enabled: bool) {
        self.config.write().expect("config lock").enabled = enabled;
        let mut status = self.status.lock().expect("status lock");
        if enabled {
            if status.state == IndexStateKind::Disabled {
                status.state = IndexStateKind::Building;
            }
        } else {
            status.state = IndexStateKind::Disabled;
            status.entry_count = 0;
            drop(status);
            *self.index.write().expect("index lock") = FileIndex::empty();
            *self.query_cache.lock().expect("query cache lock") = None;
        }
    }

    /// Pure config setter. Returns `true` when the include/exclude sets
    /// actually changed — the caller (command layer) uses that to decide
    /// whether a background rebuild is warranted.
    pub fn update_roots_and_excludes(
        &self,
        include_roots: Vec<String>,
        exclude_patterns: Vec<String>,
    ) -> bool {
        let mut cfg = self.config.write().expect("config lock");
        let changed =
            cfg.include_roots != include_roots || cfg.exclude_patterns != exclude_patterns;
        cfg.include_roots = include_roots;
        cfg.exclude_patterns = exclude_patterns;
        changed
    }

    /// Replaces the in-memory learning cache with rows loaded from
    /// persisted storage. Called once at startup (before the watcher is
    /// armed) so historical selections and pins are boosting scores from
    /// the very first query, not just ones made this session.
    pub fn seed_learning(&self, rows: Vec<(String, u64, u32, i64)>, pinned_ids: Vec<u64>) {
        *self.learning.write().expect("learning lock") = LearningCache::load(rows, pinned_ids);
    }

    pub fn record_selection_in_memory(&self, query: &str, file_id: u64, now: i64) {
        self.learning
            .write()
            .expect("learning lock")
            .record_selection(query, file_id, now);
    }

    pub fn set_pinned_in_memory(&self, file_id: u64, pinned: bool) {
        self.learning
            .write()
            .expect("learning lock")
            .set_pinned(file_id, pinned);
    }

    pub fn clear_learning_in_memory(&self) {
        self.learning
            .write()
            .expect("learning lock")
            .clear_selections();
    }

    /// Loads a persisted snapshot if present and structurally valid. `Ok`
    /// state transitions to `Ready` immediately — this is what makes
    /// restart-then-search instant instead of waiting for a full rescan.
    /// A missing/corrupt/incompatible snapshot is a silent no-op: the
    /// state stays `Building` and the caller proceeds to a full scan.
    pub fn load_snapshot_or_empty(&self, path: &Path) {
        let Some(loaded) = snapshot::load(path) else {
            return;
        };
        let entry_count = loaded.live_count() as u64;
        *self.index.write().expect("index lock") = loaded;
        let mut status = self.status.lock().expect("status lock");
        status.state = IndexStateKind::Ready;
        status.snapshot_loaded = true;
        status.entry_count = entry_count;
    }

    pub fn save_snapshot(&self, path: &Path) -> std::io::Result<()> {
        snapshot::save(&self.index.read().expect("index lock"), path)
    }

    /// Flips status to `Rescanning` immediately — call this synchronously
    /// before spawning the (possibly many-second) background scan, so a
    /// status event fired right after returns "in progress" rather than
    /// leaving the UI showing stale `Ready` data with no indication a
    /// rebuild is even happening until it silently finishes.
    pub fn mark_rescanning(&self) {
        self.status.lock().expect("status lock").state = IndexStateKind::Rescanning;
    }

    /// Walks `roots`, rebuilds the index from scratch, and updates status
    /// (`CapReached` if the walker's hard cap tripped, `Ready` otherwise).
    /// Callers run this off the calling thread — it's a full scan, not a
    /// bounded operation.
    pub fn run_full_scan(
        &self,
        roots: Vec<PathBuf>,
        excludes: Vec<String>,
        cap: usize,
        now: i64,
    ) -> WalkOutcome {
        self.mark_rescanning();
        let start = std::time::Instant::now();
        let mut entries = Vec::new();
        let mut cap_reached = false;
        let mut remaining = cap;
        for root in &roots {
            if remaining == 0 {
                cap_reached = true;
                break;
            }
            let outcome = walker::walk_root(root, &excludes, remaining);
            remaining = remaining.saturating_sub(outcome.entries.len());
            cap_reached |= outcome.cap_reached;
            entries.extend(outcome.entries);
        }
        let scan_ms = start.elapsed().as_millis() as u64;

        let index = FileIndex::build(roots, entries, now);
        let entry_count = index.live_count() as u64;
        *self.index.write().expect("index lock") = index;
        *self.query_cache.lock().expect("query cache lock") = None;

        let mut status = self.status.lock().expect("status lock");
        status.entry_count = entry_count;
        status.last_scan_ms = scan_ms;
        status.cap_reached = cap_reached;
        status.state = if cap_reached {
            IndexStateKind::CapReached
        } else {
            IndexStateKind::Ready
        };
        drop(status);

        WalkOutcome {
            entries: Vec::new(),
            cap_reached,
        }
    }

    /// Applies a debounced batch of watcher updates to the live index.
    pub fn apply_watcher_batch(&self, updates: Vec<IndexUpdate>, now: i64) {
        self.index
            .write()
            .expect("index lock")
            .apply_batch(updates, now);
        let live = self.index.read().expect("index lock").live_count() as u64;
        self.status.lock().expect("status lock").entry_count = live;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_index::index::ScannedEntry;
    use crate::file_index::types::EntryKind;

    const NOW: i64 = 100_000_000;

    fn entry(path: &str, mtime: u32) -> ScannedEntry {
        ScannedEntry {
            path: PathBuf::from(path),
            kind: EntryKind::File,
            mtime,
            hidden: false,
            placeholder: false,
        }
    }

    fn built_index(paths: &[&str]) -> FileIndex {
        let items = paths.iter().map(|p| entry(p, NOW as u32)).collect();
        FileIndex::build(vec![PathBuf::from("/r")], items, NOW)
    }

    #[test]
    fn new_state_reflects_enabled_config() {
        let enabled = FileIndexState::new(FileIndexConfig::default());
        assert_eq!(enabled.status().state, IndexStateKind::Building);

        let disabled_cfg = FileIndexConfig {
            enabled: false,
            ..Default::default()
        };
        let disabled = FileIndexState::new(disabled_cfg);
        assert_eq!(disabled.status().state, IndexStateKind::Disabled);
    }

    #[test]
    fn search_returns_empty_when_disabled() {
        let cfg = FileIndexConfig {
            enabled: false,
            ..Default::default()
        };
        let state = FileIndexState::with_index(cfg, built_index(&["/r/report.txt"]));
        let r = state.search("report", &QueryOptions::default(), NOW);
        assert!(r.hits.is_empty());
    }

    #[test]
    fn search_reuses_matcher_and_cache_so_extension_query_narrows() {
        let paths: Vec<String> = (0..3000).map(|i| format!("/r/ma-{i:04}.txt")).collect();
        let refs: Vec<&str> = paths.iter().map(String::as_str).collect();
        let state = FileIndexState::with_index(FileIndexConfig::default(), built_index(&refs));

        let first = state.search("ma", &QueryOptions::default(), NOW);
        assert!(first.truncated);
        let second = state.search("ma-0", &QueryOptions::default(), NOW);
        assert!(
            second.work.narrowed,
            "second call must reuse the session cache"
        );
    }

    #[test]
    fn begin_query_epoch_lets_newer_call_cancel_older() {
        let state = FileIndexState::new(FileIndexConfig::default());
        let (_, older_should_abort) = state.begin_query();
        assert!(!older_should_abort(), "no newer call yet");
        let (_, newer_should_abort) = state.begin_query();
        assert!(
            older_should_abort(),
            "a newer call must cancel the older one"
        );
        assert!(
            !newer_should_abort(),
            "the newest call is never self-cancelled"
        );
    }

    #[test]
    fn set_enabled_false_drops_index_and_true_reopens_for_building() {
        let state =
            FileIndexState::with_index(FileIndexConfig::default(), built_index(&["/r/a.txt"]));
        assert_eq!(state.status().entry_count, 1);

        state.set_enabled(false);
        assert_eq!(state.status().state, IndexStateKind::Disabled);
        assert_eq!(state.status().entry_count, 0);
        assert!(!state.config().enabled);

        state.set_enabled(true);
        assert_eq!(state.status().state, IndexStateKind::Building);
        assert!(state.config().enabled);
    }

    #[test]
    fn mark_rescanning_flips_status_immediately_without_touching_index_or_config() {
        let state =
            FileIndexState::with_index(FileIndexConfig::default(), built_index(&["/r/a.txt"]));
        assert_eq!(state.status().state, IndexStateKind::Ready);

        state.mark_rescanning();

        assert_eq!(
            state.status().state,
            IndexStateKind::Rescanning,
            "must be visible before any scan work runs — this is what the UI \
             polls/listens for to show \"Rescanning…\" instead of stale data"
        );
        // Nothing else about the snapshot changes yet — the caller hasn't
        // walked anything.
        assert_eq!(state.status().entry_count, 1);
    }

    #[test]
    fn update_roots_and_excludes_reports_change_and_persists() {
        let state = FileIndexState::new(FileIndexConfig::default());
        assert!(
            !state.update_roots_and_excludes(vec![], vec![]),
            "no-op change"
        );
        let changed =
            state.update_roots_and_excludes(vec!["/x".to_string()], vec!["skip-me".to_string()]);
        assert!(changed);
        assert_eq!(state.config().include_roots, vec!["/x".to_string()]);
        assert_eq!(state.config().exclude_patterns, vec!["skip-me".to_string()]);
        assert!(
            !state.update_roots_and_excludes(vec!["/x".to_string()], vec!["skip-me".to_string()])
        );
    }

    #[test]
    fn record_and_pin_flow_through_to_search_scoring() {
        let state = FileIndexState::with_index(
            FileIndexConfig::default(),
            built_index(&["/r/aaa.txt", "/r/bbb.txt"]),
        );
        let r0 = state.search("txt", &QueryOptions::default(), NOW);
        let bbb_id_hex = r0
            .hits
            .iter()
            .find(|h| h.name == "bbb.txt")
            .unwrap()
            .file_id
            .clone();
        let bbb_id = crate::file_index::file_id::from_hex(&bbb_id_hex).unwrap();

        state.set_pinned_in_memory(bbb_id, true);
        assert!(state.is_pinned(bbb_id));

        let r1 = state.search("txt", &QueryOptions::default(), NOW);
        assert_eq!(r1.hits[0].name, "bbb.txt", "pinned hit ranks first");

        state.set_pinned_in_memory(bbb_id, false);
        assert!(!state.is_pinned(bbb_id));
    }

    #[test]
    fn load_snapshot_or_empty_adopts_valid_snapshot_and_ignores_missing() {
        let tmp = std::env::temp_dir().join(format!(
            "fi_service_snapshot_test_{}.bin",
            std::process::id()
        ));
        let source =
            FileIndexState::with_index(FileIndexConfig::default(), built_index(&["/r/x.txt"]));
        source.save_snapshot(&tmp).unwrap();

        let state = FileIndexState::new(FileIndexConfig::default());
        assert_eq!(state.status().state, IndexStateKind::Building);
        state.load_snapshot_or_empty(&tmp);
        assert_eq!(state.status().state, IndexStateKind::Ready);
        assert!(state.status().snapshot_loaded);
        assert_eq!(state.status().entry_count, 1);

        let missing = FileIndexState::new(FileIndexConfig::default());
        missing.load_snapshot_or_empty(Path::new("/definitely/missing.bin"));
        assert_eq!(
            missing.status().state,
            IndexStateKind::Building,
            "no-op on missing"
        );

        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn run_full_scan_rebuilds_index_and_updates_status() {
        let root =
            std::env::temp_dir().join(format!("fi_service_scan_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("hello.txt"), "hi").unwrap();

        let state = FileIndexState::new(FileIndexConfig::default());
        let outcome = state.run_full_scan(vec![root.clone()], vec![], walker::HARD_CAP, NOW);
        assert!(!outcome.cap_reached);
        assert_eq!(state.status().state, IndexStateKind::Ready);
        assert!(state.status().entry_count >= 1);

        let r = state.search("hello", &QueryOptions::default(), NOW);
        assert!(r.hits.iter().any(|h| h.name == "hello.txt"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn run_full_scan_marks_cap_reached_state() {
        let root = std::env::temp_dir().join(format!("fi_service_cap_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        for i in 0..10 {
            std::fs::write(root.join(format!("f{i}.txt")), "x").unwrap();
        }

        let state = FileIndexState::new(FileIndexConfig::default());
        let outcome = state.run_full_scan(vec![root.clone()], vec![], 3, NOW);
        assert!(outcome.cap_reached);
        assert_eq!(state.status().state, IndexStateKind::CapReached);
        assert!(state.status().cap_reached);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn seed_learning_replaces_cache_with_persisted_rows() {
        let state =
            FileIndexState::with_index(FileIndexConfig::default(), built_index(&["/r/aaa.txt"]));
        state.seed_learning(vec![("txt".to_string(), 7, 10, NOW)], vec![9]);
        assert!(state.learning_boost("txt", 7, NOW) > 0.0);
        assert!(state.is_pinned(9));
    }

    #[test]
    fn apply_watcher_batch_updates_entry_count() {
        let state =
            FileIndexState::with_index(FileIndexConfig::default(), built_index(&["/r/a.txt"]));
        assert_eq!(state.status().entry_count, 1);
        state.apply_watcher_batch(
            vec![IndexUpdate::Upserted(entry("/r/b.txt", NOW as u32))],
            NOW,
        );
        assert_eq!(state.status().entry_count, 2);
    }
}
