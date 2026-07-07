//! fs-event ingest for the file index: a raw `notify` watcher plus an
//! Asyar-owned coalescer.
//!
//! Deliberately NOT `notify-debouncer-full`. Its default `FileIdMap` cache
//! stats every file under each watched root into a `HashMap<PathBuf,
//! FileId>` — no exclusions, symlinks followed — and re-walks the whole
//! tree on every kernel "events dropped" flag. Watching `$HOME` that way
//! kept one core pinned in an endless stat-walk loop and held gigabytes of
//! path strings, all to power rename stitching the index never consumed.
//!
//! Here the exclusion set is the FIRST thing an event meets, on the event
//! callback thread, before any stat or queueing: excluded churn (browser
//! caches, `node_modules`, VM disks) costs one glob check and nothing
//! else. Survivors are de-duplicated per coalesce window and resolved
//! against the live filesystem at flush time. The kernel's rescan flag
//! (and a pending-set overflow valve) degrade to `on_rescan` — the caller
//! answers with the bounded, exclusion-aware walker scan, never an
//! unbounded walk.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use globset::{Glob, GlobBuilder, GlobSet, GlobSetBuilder};
use notify::{EventKind, RecursiveMode, Watcher};

use super::index::{IndexUpdate, ScannedEntry};
use super::ranking::now_seconds;
use super::service::FileIndexState;
use super::types::EntryKind;
use super::walker::DEFAULT_IGNORE_PATTERNS;

const COALESCE_WINDOW: Duration = Duration::from_millis(500);

/// Overflow valve: if one coalesce window accumulates more distinct
/// non-excluded paths than this, stop collecting and degrade to a single
/// bounded rescan — cheaper than resolving each path and appending an
/// unbounded live tail to the index.
const PENDING_OVERFLOW: usize = 50_000;

/// Builds the exclusion matcher from the same default patterns the walker
/// uses, plus user-configured extras. A pattern matches anywhere in the
/// path (as a path segment or as a segment's subtree).
pub fn build_exclusion_set(custom_patterns: &[String]) -> GlobSet {
    let mut builder = GlobSetBuilder::new();
    for pat in DEFAULT_IGNORE_PATTERNS
        .iter()
        .map(|s| s.to_string())
        .chain(custom_patterns.iter().cloned())
    {
        if let Ok(g) = Glob::new(&format!("**/{pat}")) {
            builder.add(g);
        }
        if let Ok(g) = Glob::new(&format!("**/{pat}/**")) {
            builder.add(g);
        }
    }
    // Bundle *internals* only — the bundle directory itself stays watchable
    // because the walker indexes it as a leaf entry. Case-insensitive to
    // match the walker's extension comparison.
    for ext in super::walker::BUNDLE_EXTENSIONS {
        if let Ok(g) = GlobBuilder::new(&format!("**/*.{ext}/**"))
            .case_insensitive(true)
            .build()
        {
            builder.add(g);
        }
    }
    builder.build().unwrap_or_else(|_| {
        GlobSetBuilder::new()
            .build()
            .expect("empty GlobSet always builds")
    })
}

pub fn is_excluded(set: &GlobSet, path: &Path) -> bool {
    set.is_match(path)
}

/// What one flush window produced: the surviving distinct paths, and
/// whether the window degraded to "just rescan everything (bounded)".
#[derive(Default)]
pub struct Drained {
    pub paths: Vec<PathBuf>,
    pub rescan: bool,
}

/// Pure coalescing core, kept thread-free so the policy is unit-testable:
/// exclusion check first (never a syscall), de-dup within the window, and
/// two degrade-to-rescan valves (kernel rescan flag, pending overflow).
pub struct Coalescer {
    exclusions: GlobSet,
    pending: HashSet<PathBuf>,
    rescan: bool,
    overflow_cap: usize,
}

impl Coalescer {
    pub fn new(exclusions: GlobSet) -> Self {
        Self::with_overflow_cap(exclusions, PENDING_OVERFLOW)
    }

    fn with_overflow_cap(exclusions: GlobSet, overflow_cap: usize) -> Self {
        Self {
            exclusions,
            pending: HashSet::new(),
            rescan: false,
            overflow_cap,
        }
    }

    /// Ingests one raw watcher event. Runs on the event callback thread,
    /// so the only work allowed here is the glob check and a set insert.
    pub fn ingest(&mut self, event: &notify::Event) {
        if self.rescan {
            // A full scan supersedes anything else this window.
            return;
        }
        if event.need_rescan() {
            self.flip_to_rescan();
            return;
        }
        if !matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
        ) {
            return;
        }
        for path in &event.paths {
            if self.exclusions.is_match(path) {
                continue;
            }
            if self.pending.len() >= self.overflow_cap {
                self.flip_to_rescan();
                return;
            }
            self.pending.insert(path.clone());
        }
    }

    /// Takes everything accumulated this window and resets the slate.
    pub fn drain(&mut self) -> Drained {
        Drained {
            paths: self.pending.drain().collect(),
            rescan: std::mem::take(&mut self.rescan),
        }
    }

    /// Replaces (not clears) the set so a storm's capacity is released.
    fn flip_to_rescan(&mut self) {
        self.rescan = true;
        self.pending = HashSet::new();
    }
}

/// Resolves one surviving path against the live filesystem at flush time.
/// The path's current state — not the event kind — decides the update, so
/// create/modify/remove races within a window and rename-from paths
/// (whose old name no longer exists) all land on the truth: a rename now
/// tombstones the old entry instead of leaving it stale until rescan.
pub fn resolve(path: &Path) -> IndexUpdate {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return IndexUpdate::Removed(path.to_path_buf());
    };
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let kind = if meta.file_type().is_symlink() {
        EntryKind::Symlink
    } else if meta.is_dir() {
        EntryKind::Dir
    } else {
        EntryKind::File
    };
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as u32)
        .unwrap_or(0);
    IndexUpdate::Upserted(ScannedEntry {
        path: path.to_path_buf(),
        kind,
        mtime,
        hidden: name.starts_with('.'),
        placeholder: false,
    })
}

/// Live watch over `roots`. Dropping stops the OS watch and joins the
/// flush thread (bounded by one `COALESCE_WINDOW`).
pub struct FileIndexWatcher {
    /// Keeps the OS watch alive; dropped after the flusher joined.
    _watcher: notify::RecommendedWatcher,
    stop_tx: mpsc::Sender<()>,
    flusher: Option<JoinHandle<()>>,
}

impl Drop for FileIndexWatcher {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(());
        if let Some(h) = self.flusher.take() {
            let _ = h.join();
        }
    }
}

/// Arms a raw watcher over `roots` and a flush thread that hands each
/// non-empty resolved batch to `on_updates`; a degraded window fires
/// `on_rescan` instead.
pub fn start_watcher<F, R>(
    roots: &[PathBuf],
    exclusions: GlobSet,
    mut on_updates: F,
    on_rescan: R,
) -> notify::Result<FileIndexWatcher>
where
    F: FnMut(Vec<IndexUpdate>) + Send + 'static,
    R: Fn() + Send + 'static,
{
    let coalescer = Arc::new(Mutex::new(Coalescer::new(exclusions)));
    let ingest_side = Arc::clone(&coalescer);
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if let Ok(mut c) = ingest_side.lock() {
            c.ingest(&event);
        }
    })?;
    for root in roots {
        watcher.watch(root, RecursiveMode::Recursive)?;
    }

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let flusher = std::thread::Builder::new()
        .name("file-index-flush".into())
        .spawn(move || {
            // Timeout = one coalesce window elapsed → flush; a stop signal
            // (or the sender dropping) ends the thread.
            while let Err(RecvTimeoutError::Timeout) = stop_rx.recv_timeout(COALESCE_WINDOW) {
                let drained = match coalescer.lock() {
                    Ok(mut c) => c.drain(),
                    Err(_) => Drained::default(),
                };
                if drained.rescan {
                    on_rescan();
                }
                if drained.paths.is_empty() {
                    continue;
                }
                on_updates(drained.paths.iter().map(|p| resolve(p)).collect());
            }
        })
        .map_err(|e| notify::Error::generic(&e.to_string()))?;

    Ok(FileIndexWatcher {
        _watcher: watcher,
        stop_tx,
        flusher: Some(flusher),
    })
}

/// Long-lived managed handle owning the live watcher. `rearm` fully
/// replaces the watch set — file-index roots only ever change as one
/// atomic settings edit, so unwatch-then-rewatch is the right amount of
/// complexity.
pub struct FileIndexWatcherHandle {
    watcher: Mutex<Option<FileIndexWatcher>>,
}

impl Default for FileIndexWatcherHandle {
    fn default() -> Self {
        Self::new()
    }
}

impl FileIndexWatcherHandle {
    pub fn new() -> Self {
        Self {
            watcher: Mutex::new(None),
        }
    }

    /// Drops any existing watcher (stopping all prior watches) and, if
    /// `roots` is non-empty, arms a fresh one that applies batches directly
    /// to `state` and answers degraded windows via `on_rescan`.
    pub fn rearm<R>(
        &self,
        roots: Vec<PathBuf>,
        exclusions: GlobSet,
        state: Arc<FileIndexState>,
        on_rescan: R,
    ) where
        R: Fn() + Send + 'static,
    {
        let mut guard = self.watcher.lock().expect("watcher lock");
        *guard = None;
        if roots.is_empty() {
            return;
        }
        match start_watcher(
            &roots,
            exclusions,
            move |updates| state.apply_watcher_batch(updates, now_seconds()),
            on_rescan,
        ) {
            Ok(w) => *guard = Some(w),
            Err(e) => log::warn!("[file_index_watcher] rearm failed: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_index::types::FileIndexConfig;
    use notify::event::{AccessKind, AccessMode, CreateKind, Flag, ModifyKind, RemoveKind};
    use std::fs;

    fn ev(kind: EventKind, path: &Path) -> notify::Event {
        notify::Event::new(kind).add_path(path.to_path_buf())
    }

    fn create_ev(path: &Path) -> notify::Event {
        ev(EventKind::Create(CreateKind::File), path)
    }

    #[test]
    fn exclusion_set_matches_default_and_custom_patterns() {
        let set = build_exclusion_set(&["my-custom-skip".to_string()]);
        assert!(is_excluded(
            &set,
            Path::new("/home/u/proj/node_modules/react/index.js")
        ));
        assert!(is_excluded(
            &set,
            Path::new("/home/u/proj/target/debug/foo")
        ));
        assert!(is_excluded(&set, Path::new("/home/u/Library/Caches/x")));
        assert!(is_excluded(
            &set,
            Path::new("/home/u/proj/my-custom-skip/x.txt")
        ));
        assert!(!is_excluded(&set, Path::new("/home/u/proj/src/main.rs")));
    }

    #[test]
    fn exclusion_set_drops_bundle_internals_but_keeps_the_bundle_leaf_itself() {
        let set = build_exclusion_set(&[]);
        // The walker indexes bundles as opaque leaves and never descends
        // into them — watcher events from inside a bundle must not be able
        // to append entries the scan policy excludes.
        assert!(is_excluded(
            &set,
            Path::new("/Users/u/Applications/Foo.app/Contents/Info.plist")
        ));
        assert!(is_excluded(
            &set,
            Path::new("/Users/u/Pictures/Photos Library.photoslibrary/database/Photos.sqlite")
        ));
        assert!(is_excluded(
            &set,
            Path::new("/Users/u/dev/Some.framework/Versions/A/Some")
        ));
        // Extension casing must not matter (walker compares case-insensitively).
        assert!(is_excluded(
            &set,
            Path::new("/Users/u/Applications/Odd.APP/Contents/x")
        ));
        // The bundle itself is a real indexed leaf — events on it (e.g. an
        // app update bumping the bundle mtime) must still pass through.
        assert!(!is_excluded(
            &set,
            Path::new("/Users/u/Applications/Foo.app")
        ));
        assert!(!is_excluded(
            &set,
            Path::new("/Users/u/Pictures/Photos Library.photoslibrary")
        ));
    }

    #[test]
    fn exclusion_set_drops_vm_disk_churn_so_a_running_vm_cannot_wake_the_watcher() {
        let set = build_exclusion_set(&[]);
        assert!(is_excluded(
            &set,
            Path::new("/home/u/Virtual Machines.localized/Ubuntu.pvm/Ubuntu.hdd/disk-s001.hds")
        ));
        assert!(is_excluded(
            &set,
            Path::new("/home/u/VirtualBox VMs/Ubuntu/Ubuntu-disk001.vdi")
        ));
    }

    #[test]
    fn coalescer_drops_excluded_paths_at_ingest() {
        let mut c = Coalescer::new(build_exclusion_set(&[]));
        c.ingest(&create_ev(Path::new(
            "/home/u/proj/node_modules/react/index.js",
        )));
        c.ingest(&create_ev(Path::new("/home/u/Library/Caches/noise.db")));
        let d = c.drain();
        assert!(
            d.paths.is_empty(),
            "excluded paths must never survive ingest"
        );
        assert!(!d.rescan);
    }

    #[test]
    fn coalescer_dedupes_repeated_events_for_one_path() {
        let mut c = Coalescer::new(build_exclusion_set(&[]));
        let p = Path::new("/home/u/notes.txt");
        c.ingest(&create_ev(p));
        c.ingest(&ev(EventKind::Modify(ModifyKind::Any), p));
        c.ingest(&ev(EventKind::Remove(RemoveKind::File), p));
        let d = c.drain();
        assert_eq!(d.paths, vec![PathBuf::from("/home/u/notes.txt")]);
        assert!(!d.rescan);
    }

    #[test]
    fn coalescer_ignores_access_events() {
        let mut c = Coalescer::new(build_exclusion_set(&[]));
        c.ingest(&ev(
            EventKind::Access(AccessKind::Open(AccessMode::Read)),
            Path::new("/home/u/opened.txt"),
        ));
        let d = c.drain();
        assert!(d.paths.is_empty());
        assert!(!d.rescan);
    }

    #[test]
    fn coalescer_drain_resets_the_slate() {
        let mut c = Coalescer::new(build_exclusion_set(&[]));
        c.ingest(&create_ev(Path::new("/home/u/a.txt")));
        let first = c.drain();
        assert_eq!(first.paths.len(), 1);
        let second = c.drain();
        assert!(second.paths.is_empty());
        assert!(!second.rescan);
    }

    #[test]
    fn coalescer_rescan_flag_supersedes_pending_paths() {
        let mut c = Coalescer::new(build_exclusion_set(&[]));
        c.ingest(&create_ev(Path::new("/home/u/a.txt")));
        c.ingest(&notify::Event::new(EventKind::Other).set_flag(Flag::Rescan));
        // Anything after the flag is pointless — the full scan supersedes it.
        c.ingest(&create_ev(Path::new("/home/u/b.txt")));
        let d = c.drain();
        assert!(d.rescan);
        assert!(d.paths.is_empty(), "a rescan window emits no per-path work");
        // Slate is clean afterwards.
        let d2 = c.drain();
        assert!(!d2.rescan);
        assert!(d2.paths.is_empty());
    }

    #[test]
    fn coalescer_overflow_converts_to_rescan() {
        let mut c = Coalescer::with_overflow_cap(build_exclusion_set(&[]), 3);
        for i in 0..5 {
            c.ingest(&create_ev(&PathBuf::from(format!("/home/u/f{i}.txt"))));
        }
        let d = c.drain();
        assert!(d.rescan, "overflow must degrade to one bounded rescan");
        assert!(d.paths.is_empty());
    }

    #[test]
    fn resolve_existing_file_yields_upserted_with_metadata() {
        let id = std::process::id();
        let p = std::env::temp_dir().join(format!("fi_watcher_resolve_{id}.txt"));
        fs::write(&p, "x").unwrap();
        match resolve(&p) {
            IndexUpdate::Upserted(e) => {
                assert_eq!(e.path, p);
                assert!(matches!(e.kind, EntryKind::File));
                assert!(e.mtime > 0);
                assert!(!e.hidden);
            }
            IndexUpdate::Removed(_) => panic!("existing file must upsert"),
        }
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn resolve_missing_path_yields_removed() {
        let p = Path::new("/tmp/definitely_missing_fi_watcher.txt");
        match resolve(p) {
            IndexUpdate::Removed(removed) => assert_eq!(removed, p),
            IndexUpdate::Upserted(_) => panic!("missing path must remove"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn resolve_symlink_keeps_symlink_kind_without_following() {
        let id = std::process::id();
        let dir = std::env::temp_dir().join(format!("fi_watcher_symlink_{id}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("target-dir");
        fs::create_dir_all(&target).unwrap();
        let link = dir.join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        match resolve(&link) {
            IndexUpdate::Upserted(e) => assert!(
                matches!(e.kind, EntryKind::Symlink),
                "symlink must keep Symlink kind (walker parity), got {:?}",
                e.kind
            ),
            IndexUpdate::Removed(_) => panic!("symlink exists"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn excluded_path_events_are_dropped_before_reaching_callback() {
        let id = std::process::id();
        let root = std::env::temp_dir().join(format!("fi_watcher_e2e_{id}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("node_modules")).unwrap();

        let exclusions = build_exclusion_set(&[]);
        let received: Arc<Mutex<Vec<IndexUpdate>>> = Arc::new(Mutex::new(Vec::new()));
        let received_cb = received.clone();
        let rescans = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let rescans_cb = rescans.clone();

        let watcher = start_watcher(
            std::slice::from_ref(&root),
            exclusions,
            move |updates| received_cb.lock().unwrap().extend(updates),
            move || {
                rescans_cb.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            },
        )
        .expect("watcher starts");

        // Excluded: must never surface.
        fs::write(root.join("node_modules/pkg.json"), "{}").unwrap();
        // Not excluded: must surface.
        fs::write(root.join("keep.txt"), "hi").unwrap();

        // Give the coalesce window (500ms) time to flush.
        std::thread::sleep(Duration::from_millis(1200));
        drop(watcher);

        let updates = received.lock().unwrap();
        let has_excluded = updates.iter().any(|u| match u {
            IndexUpdate::Upserted(e) => e.path.to_string_lossy().contains("node_modules"),
            IndexUpdate::Removed(p) => p.to_string_lossy().contains("node_modules"),
        });
        let has_kept = updates.iter().any(|u| match u {
            IndexUpdate::Upserted(e) => e.path.ends_with("keep.txt"),
            IndexUpdate::Removed(p) => p.ends_with("keep.txt"),
        });
        assert!(
            !has_excluded,
            "node_modules event must be dropped, got {updates:?}"
        );
        assert!(has_kept, "non-excluded event must surface, got {updates:?}");
        assert_eq!(rescans.load(std::sync::atomic::Ordering::SeqCst), 0);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_tombstones_old_path_and_upserts_new_path() {
        let id = std::process::id();
        let root = std::env::temp_dir().join(format!("fi_watcher_rename_{id}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let old = root.join("old-name.txt");
        fs::write(&old, "x").unwrap();

        let received: Arc<Mutex<Vec<IndexUpdate>>> = Arc::new(Mutex::new(Vec::new()));
        let received_cb = received.clone();
        let watcher = start_watcher(
            std::slice::from_ref(&root),
            build_exclusion_set(&[]),
            move |updates| received_cb.lock().unwrap().extend(updates),
            || {},
        )
        .expect("watcher starts");

        let new = root.join("new-name.txt");
        fs::rename(&old, &new).unwrap();

        std::thread::sleep(Duration::from_millis(1200));
        drop(watcher);

        let updates = received.lock().unwrap();
        let old_removed = updates
            .iter()
            .any(|u| matches!(u, IndexUpdate::Removed(p) if p.ends_with("old-name.txt")));
        let new_upserted = updates
            .iter()
            .any(|u| matches!(u, IndexUpdate::Upserted(e) if e.path.ends_with("new-name.txt")));
        assert!(
            old_removed,
            "rename must tombstone the old path (stat fails at flush), got {updates:?}"
        );
        assert!(
            new_upserted,
            "rename must upsert the new path, got {updates:?}"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rearm_with_empty_roots_disarms() {
        let handle = FileIndexWatcherHandle::new();
        let state = Arc::new(FileIndexState::new(FileIndexConfig::default()));
        handle.rearm(Vec::new(), build_exclusion_set(&[]), state, || {});
        assert!(handle.watcher.lock().unwrap().is_none());
    }
}
