//! fs-event ingest. Watches configured roots and forwards batches of typed
//! `IndexUpdate`s (see `index.rs`) as files appear/change/disappear.
//! `notify-debouncer-full` coalesces bursts (npm install, large rsync) into
//! one callback per quiescent window.
//!
//! Unlike the old attempt, every event path is checked against the same
//! exclusion set the walker used *before* it's stat'ed or translated — a
//! build/install storm inside `node_modules` or `target` must not wake the
//! index (or spend a syscall) just because it's nested under a watched
//! root.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use globset::{Glob, GlobSet, GlobSetBuilder};
use notify::EventKind;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};

use super::index::{IndexUpdate, ScannedEntry};
use super::ranking::now_seconds;
use super::service::FileIndexState;
use super::types::EntryKind;
use super::walker::DEFAULT_IGNORE_PATTERNS;

const COALESCE_WINDOW: Duration = Duration::from_millis(500);

/// Builds the exclusion matcher from the same default patterns the walker
/// uses, plus user-configured extras. A pattern matches anywhere in the
/// path (as a path segment or as a segment's subtree).
pub fn build_exclusion_set(custom_patterns: &[String]) -> GlobSet {
    let mut builder = GlobSetBuilder::new();
    for pat in DEFAULT_IGNORE_PATTERNS.iter().map(|s| s.to_string()).chain(custom_patterns.iter().cloned()) {
        if let Ok(g) = Glob::new(&format!("**/{pat}")) {
            builder.add(g);
        }
        if let Ok(g) = Glob::new(&format!("**/{pat}/**")) {
            builder.add(g);
        }
    }
    builder
        .build()
        .unwrap_or_else(|_| GlobSetBuilder::new().build().expect("empty GlobSet always builds"))
}

pub fn is_excluded(set: &GlobSet, path: &Path) -> bool {
    set.is_match(path)
}

/// Build a debouncer that watches `roots` and calls `on_updates` with each
/// non-empty, non-excluded batch. The returned `Debouncer` must be kept
/// alive — dropping it stops watching.
pub fn start_watcher<F>(
    roots: &[PathBuf],
    exclusions: GlobSet,
    mut on_updates: F,
) -> notify::Result<Debouncer<notify::RecommendedWatcher, RecommendedCache>>
where
    F: FnMut(Vec<IndexUpdate>) + Send + 'static,
{
    let mut debouncer = new_debouncer(COALESCE_WINDOW, None, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let mut updates = Vec::new();
        for ev in events {
            for path in &ev.paths {
                if is_excluded(&exclusions, path) {
                    continue;
                }
                if let Some(u) = translate(&ev.kind, path) {
                    updates.push(u);
                }
            }
        }
        if !updates.is_empty() {
            on_updates(updates);
        }
    })?;
    for root in roots {
        debouncer.watch(root, notify::RecursiveMode::Recursive)?;
    }
    Ok(debouncer)
}

fn translate(kind: &EventKind, path: &Path) -> Option<IndexUpdate> {
    match kind {
        EventKind::Create(_) | EventKind::Modify(_) => {
            let meta = std::fs::metadata(path).ok()?;
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            let hidden = name.starts_with('.');
            let entry_kind = if meta.is_dir() {
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
            Some(IndexUpdate::Upserted(ScannedEntry {
                path: path.to_path_buf(),
                kind: entry_kind,
                mtime,
                hidden,
                placeholder: false,
            }))
        }
        EventKind::Remove(_) => Some(IndexUpdate::Removed(path.to_path_buf())),
        _ => None,
    }
}

/// Long-lived managed handle owning the debouncer. `rearm` fully replaces
/// the watch set — simpler than the applications watcher's incremental
/// diffing, which is worth it there because default+extra scan paths
/// change independently; file-index roots only ever change as one atomic
/// settings edit, so a full unwatch-then-rewatch is the right amount of
/// complexity.
pub struct FileIndexWatcherHandle {
    debouncer: Mutex<Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>>>,
}

impl Default for FileIndexWatcherHandle {
    fn default() -> Self {
        Self::new()
    }
}

impl FileIndexWatcherHandle {
    pub fn new() -> Self {
        Self {
            debouncer: Mutex::new(None),
        }
    }

    /// Drops any existing debouncer (stopping all prior watches) and, if
    /// `roots` is non-empty, arms a fresh one that applies batches directly
    /// to `state`.
    pub fn rearm(&self, roots: Vec<PathBuf>, exclusions: GlobSet, state: Arc<FileIndexState>) {
        let mut guard = self.debouncer.lock().expect("debouncer lock");
        *guard = None;
        if roots.is_empty() {
            return;
        }
        match start_watcher(&roots, exclusions, move |updates| {
            state.apply_watcher_batch(updates, now_seconds());
        }) {
            Ok(d) => *guard = Some(d),
            Err(e) => log::warn!("[file_index_watcher] rearm failed: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn translate_create_yields_upserted_scanned_entry() {
        let id = std::process::id();
        let p = std::env::temp_dir().join(format!("fi_watcher_test_{id}.txt"));
        fs::write(&p, "x").unwrap();
        let u = translate(&EventKind::Create(notify::event::CreateKind::File), &p).unwrap();
        match u {
            IndexUpdate::Upserted(e) => {
                assert_eq!(e.path, p);
                assert!(matches!(e.kind, EntryKind::File));
            }
            _ => panic!("wrong variant"),
        }
        let _ = fs::remove_file(&p);
    }

    #[test]
    fn translate_remove_yields_removed_path() {
        let p = Path::new("/tmp/nonexistent_fi_watcher.txt");
        let u = translate(&EventKind::Remove(notify::event::RemoveKind::File), p).unwrap();
        match u {
            IndexUpdate::Removed(removed) => assert_eq!(removed, p),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn translate_unrelated_event_yields_none() {
        let u = translate(
            &EventKind::Access(notify::event::AccessKind::Open(
                notify::event::AccessMode::Read,
            )),
            Path::new("/tmp/anything.txt"),
        );
        assert!(u.is_none());
    }

    #[test]
    fn exclusion_set_matches_default_and_custom_patterns() {
        let set = build_exclusion_set(&["my-custom-skip".to_string()]);
        assert!(is_excluded(&set, Path::new("/home/u/proj/node_modules/react/index.js")));
        assert!(is_excluded(&set, Path::new("/home/u/proj/target/debug/foo")));
        assert!(is_excluded(&set, Path::new("/home/u/Library/Caches/x")));
        assert!(is_excluded(&set, Path::new("/home/u/proj/my-custom-skip/x.txt")));
        assert!(!is_excluded(&set, Path::new("/home/u/proj/src/main.rs")));
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
    fn excluded_path_events_are_dropped_before_reaching_callback() {
        let id = std::process::id();
        let root = std::env::temp_dir().join(format!("fi_watcher_e2e_{id}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("node_modules")).unwrap();

        let exclusions = build_exclusion_set(&[]);
        let received: Arc<Mutex<Vec<IndexUpdate>>> = Arc::new(Mutex::new(Vec::new()));
        let received_cb = received.clone();

        let mut debouncer = start_watcher(std::slice::from_ref(&root), exclusions, move |updates| {
            received_cb.lock().unwrap().extend(updates);
        })
        .expect("watcher starts");

        // Excluded: must never surface.
        fs::write(root.join("node_modules/pkg.json"), "{}").unwrap();
        // Not excluded: must surface.
        fs::write(root.join("keep.txt"), "hi").unwrap();

        // Give the debouncer's coalesce window (500ms) time to fire, then
        // stop watching so the callback thread quiesces.
        std::thread::sleep(Duration::from_millis(900));
        let _ = debouncer.unwatch(&root);

        let updates = received.lock().unwrap();
        let has_excluded = updates.iter().any(|u| match u {
            IndexUpdate::Upserted(e) => e.path.to_string_lossy().contains("node_modules"),
            IndexUpdate::Removed(p) => p.to_string_lossy().contains("node_modules"),
        });
        let has_kept = updates.iter().any(|u| match u {
            IndexUpdate::Upserted(e) => e.path.ends_with("keep.txt"),
            IndexUpdate::Removed(p) => p.ends_with("keep.txt"),
        });
        assert!(!has_excluded, "node_modules event must be dropped, got {updates:?}");
        assert!(has_kept, "non-excluded event must surface, got {updates:?}");

        let _ = fs::remove_dir_all(&root);
    }
}
