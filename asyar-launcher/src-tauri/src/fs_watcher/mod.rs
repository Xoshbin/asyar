//! Per-extension filesystem watcher registry. See
//! docs/superpowers/specs/2026-04-21-fs-watch-sdk-design.md.
//!
//! Parallel primitive to [`crate::event_hub::EventHub`]: events route
//! to a specific `(extension_id, handle_id)` pair rather than fanning
//! out to every subscriber of a `Kind`. Built on `notify-debouncer-full`
//! so cross-platform semantics match [`crate::application::index_watcher`].

pub mod matcher;

use crate::error::AppError;
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Resource limits. Enforced at `create()` time; breach returns
/// `AppError::Validation`. Values tuned so a single extension can't
/// exhaust the host's FS-watcher budget (macOS FSEvents and Linux
/// inotify both have per-process ceilings).
pub const MAX_HANDLES_PER_EXTENSION: usize = 16;
pub const MAX_PATHS_PER_HANDLE: usize = 64;
pub const MAX_GLOBAL_PATHS: usize = 512;

pub type HandleId = String;

/// Callback invoked by the registry after every debounced batch that
/// coalesces down to ≥1 root. `ext` identifies the owning extension;
/// `hid` is the handle returned by `create()`. The wiring in `lib.rs`
/// turns each call into a Tauri event.
pub type EmitFn = Box<dyn Fn(String, HandleId, FsWatchEvent) + Send + Sync>;

#[derive(Debug, Clone, PartialEq)]
pub struct FsWatchEvent {
    /// Subset of the handle's declared roots that saw activity. Never
    /// empty when emitted — the callback drops batches whose raw events
    /// all fall outside every root.
    pub paths: Vec<PathBuf>,
}

#[derive(Debug, Clone, Copy)]
pub struct FsWatcherOptions {
    pub recursive: bool,
    pub debounce: Duration,
}

impl Default for FsWatcherOptions {
    fn default() -> Self {
        Self {
            recursive: true,
            debounce: Duration::from_millis(500),
        }
    }
}

struct WatcherEntry {
    extension_id: String,
    paths: Vec<PathBuf>,
    /// Dropping this entry stops the watcher thread. Underscore-prefixed
    /// because we never access it directly after construction.
    _debouncer: Debouncer<notify::RecommendedWatcher, RecommendedCache>,
}

/// Per-handle registry. Stored as managed Tauri state (`Arc<Self>`).
/// Test-visible `set_emitter` + `RecordingEmitter` mirrors the
/// `EventHub` pattern for unit tests.
#[derive(Default)]
pub struct FsWatcherRegistry {
    handles: Mutex<HashMap<HandleId, WatcherEntry>>,
    /// Wrapped in Arc so debouncer callbacks capture a clone that
    /// outlives the registry — avoids a retain-cycle (registry owns
    /// the debouncer; debouncer callback needs to emit).
    emit: Arc<Mutex<Option<EmitFn>>>,
}

impl FsWatcherRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_emitter(&self, emit: EmitFn) {
        if let Ok(mut g) = self.emit.lock() {
            *g = Some(emit);
        }
    }

    pub fn create(
        &self,
        extension_id: &str,
        paths: Vec<PathBuf>,
        opts: FsWatcherOptions,
    ) -> Result<HandleId, AppError> {
        // Per-handle path limit.
        if paths.len() > MAX_PATHS_PER_HANDLE {
            return Err(AppError::Validation(format!(
                "fs-watch limit exceeded: handle requested {} paths (max {})",
                paths.len(),
                MAX_PATHS_PER_HANDLE
            )));
        }
        // Per-extension handle-count + global path-count limits. Held
        // inside a short-lived lock scope so the debouncer creation
        // below doesn't deadlock on reentry.
        {
            let guard = self.handles.lock().map_err(|_| AppError::Lock)?;
            let ext_count = guard
                .values()
                .filter(|e| e.extension_id == extension_id)
                .count();
            if ext_count >= MAX_HANDLES_PER_EXTENSION {
                return Err(AppError::Validation(format!(
                    "fs-watch limit exceeded: extension '{}' has {} handles (max {})",
                    extension_id, ext_count, MAX_HANDLES_PER_EXTENSION
                )));
            }
            let global_count: usize = guard.values().map(|e| e.paths.len()).sum();
            if global_count + paths.len() > MAX_GLOBAL_PATHS {
                return Err(AppError::Validation(format!(
                    "fs-watch limit exceeded: global path count would be {} (max {})",
                    global_count + paths.len(),
                    MAX_GLOBAL_PATHS
                )));
            }
        }

        let debounce = opts.debounce.clamp(
            Duration::from_millis(50),
            Duration::from_millis(5000),
        );
        let mode = if opts.recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        let handle_id = uuid::Uuid::new_v4().to_string();

        let ext_for_cb = extension_id.to_string();
        let hid_for_cb = handle_id.clone();
        let emit_for_cb = self.emit.clone();
        let roots_for_cb = paths.clone();

        let mut debouncer = new_debouncer(
            debounce,
            None,
            move |result: DebounceEventResult| {
                let events = match result {
                    Ok(e) if !e.is_empty() => e,
                    _ => return,
                };
                let raw_paths: Vec<PathBuf> = events
                    .into_iter()
                    .flat_map(|ev| ev.paths.clone())
                    .collect();
                let coalesced = coalesce_to_roots(&raw_paths, &roots_for_cb);
                if coalesced.is_empty() {
                    return;
                }
                if let Ok(guard) = emit_for_cb.lock() {
                    if let Some(ref f) = *guard {
                        f(
                            ext_for_cb.clone(),
                            hid_for_cb.clone(),
                            FsWatchEvent { paths: coalesced },
                        );
                    }
                }
            },
        )
        .map_err(|e| AppError::Other(format!("failed to create debouncer: {e}")))?;

        for p in &paths {
            debouncer
                .watch(p, mode)
                .map_err(|e| AppError::Other(format!("failed to watch {:?}: {}", p, e)))?;
        }

        let entry = WatcherEntry {
            extension_id: extension_id.to_string(),
            paths,
            _debouncer: debouncer,
        };
        self.handles
            .lock()
            .map_err(|_| AppError::Lock)?
            .insert(handle_id.clone(), entry);
        Ok(handle_id)
    }

    /// Dispose a handle. Idempotent: disposing an unknown handle is a
    /// no-op. Cross-extension disposal is rejected.
    pub fn dispose(&self, extension_id: &str, handle_id: &str) -> Result<(), AppError> {
        let mut guard = self.handles.lock().map_err(|_| AppError::Lock)?;
        match guard.get(handle_id) {
            Some(entry) if entry.extension_id == extension_id => {
                guard.remove(handle_id);
                Ok(())
            }
            Some(_) => Err(AppError::Permission(format!(
                "Extension '{}' does not own handle '{}'",
                extension_id, handle_id
            ))),
            None => Ok(()),
        }
    }

    /// Sweep every handle owned by `extension_id`. Returns the count
    /// removed. Called from `extensions::lifecycle::uninstall` alongside
    /// the existing hub cleanup sweeps.
    pub fn remove_all_for_extension(
        &self,
        extension_id: &str,
    ) -> Result<usize, AppError> {
        let mut guard = self.handles.lock().map_err(|_| AppError::Lock)?;
        let victims: Vec<String> = guard
            .iter()
            .filter(|(_, e)| e.extension_id == extension_id)
            .map(|(id, _)| id.clone())
            .collect();
        let n = victims.len();
        for id in victims {
            guard.remove(&id);
        }
        Ok(n)
    }

    #[cfg(test)]
    pub(crate) fn handle_count(&self) -> usize {
        self.handles.lock().map(|g| g.len()).unwrap_or(0)
    }
}

/// For each event path, find the handle's watched root (if any) that
/// contains it. Returns the set of matched roots in first-occurrence
/// order within `roots`, deduplicated. Event paths outside every root
/// are dropped.
///
/// Roots-up coalescing: if 50 raw events fire under one root, the result
/// is a one-element vec containing that root. This hides cross-platform
/// event-fidelity differences (FSEvents / inotify / ReadDirectoryChangesW)
/// from the extension.
pub fn coalesce_to_roots(event_paths: &[PathBuf], roots: &[PathBuf]) -> Vec<PathBuf> {
    use std::collections::HashSet;
    let mut seen: HashSet<PathBuf> = HashSet::new();
    for ev in event_paths {
        for root in roots {
            if ev.starts_with(root) {
                seen.insert(root.clone());
                break;
            }
        }
    }
    roots.iter().filter(|r| seen.contains(*r)).cloned().collect()
}

// ---- test-only fake emitter ----

#[cfg(test)]
pub(crate) mod fake {
    use super::*;

    #[derive(Clone)]
    pub struct RecordingEmitter {
        pub emitted: Arc<Mutex<Vec<(String, HandleId, FsWatchEvent)>>>,
    }

    impl RecordingEmitter {
        pub fn new() -> Self {
            Self {
                emitted: Arc::new(Mutex::new(Vec::new())),
            }
        }

        pub fn into_emit_fn(self) -> EmitFn {
            Box::new(move |ext, hid, ev| {
                if let Ok(mut g) = self.emitted.lock() {
                    g.push((ext, hid, ev));
                }
            })
        }

        pub fn snapshot(&self) -> Vec<(String, HandleId, FsWatchEvent)> {
            self.emitted.lock().map(|g| g.clone()).unwrap_or_default()
        }
    }
}

#[cfg(test)]
mod coalesce_tests {
    use super::*;

    #[test]
    fn single_event_under_single_root_yields_that_root() {
        let events = vec![PathBuf::from("/tmp/smoke/file.txt")];
        let roots = vec![PathBuf::from("/tmp/smoke")];
        assert_eq!(coalesce_to_roots(&events, &roots), roots);
    }

    #[test]
    fn many_events_under_one_root_coalesce_to_that_root() {
        let events = vec![
            PathBuf::from("/tmp/smoke/a.txt"),
            PathBuf::from("/tmp/smoke/b.txt"),
            PathBuf::from("/tmp/smoke/nested/c.txt"),
        ];
        let roots = vec![PathBuf::from("/tmp/smoke")];
        assert_eq!(coalesce_to_roots(&events, &roots).len(), 1);
    }

    #[test]
    fn events_under_two_roots_yield_both_roots() {
        let events = vec![
            PathBuf::from("/tmp/a/x"),
            PathBuf::from("/tmp/b/y"),
        ];
        let roots = vec![PathBuf::from("/tmp/a"), PathBuf::from("/tmp/b")];
        let out = coalesce_to_roots(&events, &roots);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0], PathBuf::from("/tmp/a"));
        assert_eq!(out[1], PathBuf::from("/tmp/b"));
    }

    #[test]
    fn event_outside_all_roots_is_dropped() {
        let events = vec![PathBuf::from("/etc/passwd")];
        let roots = vec![PathBuf::from("/tmp/smoke")];
        assert!(coalesce_to_roots(&events, &roots).is_empty());
    }

    #[test]
    fn duplicate_roots_are_deduplicated_in_output() {
        let events = vec![
            PathBuf::from("/tmp/smoke/a"),
            PathBuf::from("/tmp/smoke/b"),
            PathBuf::from("/tmp/smoke/c"),
        ];
        let roots = vec![PathBuf::from("/tmp/smoke")];
        let out = coalesce_to_roots(&events, &roots);
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn path_that_is_exactly_a_root_maps_to_that_root() {
        let events = vec![PathBuf::from("/tmp/smoke")];
        let roots = vec![PathBuf::from("/tmp/smoke")];
        assert_eq!(coalesce_to_roots(&events, &roots), roots);
    }
}

#[cfg(test)]
mod registry_tests {
    use super::*;

    fn new_registry() -> FsWatcherRegistry {
        FsWatcherRegistry::new()
    }

    // ---- Task 9: core create/dispose ----

    #[test]
    fn create_returns_fresh_handle_ids() {
        let reg = new_registry();
        let tmp = tempfile::tempdir().unwrap();
        let h1 = reg
            .create("ext.a", vec![tmp.path().to_path_buf()], Default::default())
            .unwrap();
        let h2 = reg
            .create("ext.a", vec![tmp.path().to_path_buf()], Default::default())
            .unwrap();
        assert_ne!(h1, h2);
        assert_eq!(reg.handle_count(), 2);
    }

    #[test]
    fn dispose_removes_handle() {
        let reg = new_registry();
        let tmp = tempfile::tempdir().unwrap();
        let h = reg
            .create("ext.a", vec![tmp.path().to_path_buf()], Default::default())
            .unwrap();
        assert_eq!(reg.handle_count(), 1);
        reg.dispose("ext.a", &h).unwrap();
        assert_eq!(reg.handle_count(), 0);
    }

    #[test]
    fn dispose_unknown_handle_is_noop() {
        let reg = new_registry();
        assert!(reg.dispose("ext.a", "unknown-handle").is_ok());
    }

    #[test]
    fn dispose_with_wrong_owner_errors() {
        let reg = new_registry();
        let tmp = tempfile::tempdir().unwrap();
        let h = reg
            .create("ext.a", vec![tmp.path().to_path_buf()], Default::default())
            .unwrap();
        assert!(reg.dispose("ext.b", &h).is_err());
        assert_eq!(reg.handle_count(), 1);
    }

    // ---- Task 10: resource limits ----

    #[test]
    fn rejects_more_than_max_handles_per_extension() {
        let reg = new_registry();
        let tmp = tempfile::tempdir().unwrap();
        let p = vec![tmp.path().to_path_buf()];
        for _ in 0..MAX_HANDLES_PER_EXTENSION {
            reg.create("ext.a", p.clone(), Default::default()).unwrap();
        }
        let err = reg
            .create("ext.a", p.clone(), Default::default())
            .unwrap_err();
        assert!(format!("{err}").contains("limit exceeded"), "got: {err}");
    }

    #[test]
    fn rejects_more_than_max_paths_per_handle() {
        let reg = new_registry();
        let tmp = tempfile::tempdir().unwrap();
        let mut paths = Vec::with_capacity(MAX_PATHS_PER_HANDLE + 1);
        for i in 0..(MAX_PATHS_PER_HANDLE + 1) {
            let p = tmp.path().join(format!("d{i}"));
            std::fs::create_dir(&p).unwrap();
            paths.push(p);
        }
        let err = reg
            .create("ext.a", paths, Default::default())
            .unwrap_err();
        assert!(format!("{err}").contains("limit exceeded"), "got: {err}");
    }

    #[test]
    fn rejects_when_global_total_paths_would_exceed_limit() {
        let reg = new_registry();
        let tmp = tempfile::tempdir().unwrap();
        let p = vec![tmp.path().to_path_buf()];
        // 32 extensions × 16 handles × 1 path = 512 (the limit).
        'outer: for ext_idx in 0..32 {
            let ext = format!("ext.{ext_idx}");
            for _ in 0..MAX_HANDLES_PER_EXTENSION {
                if reg.create(&ext, p.clone(), Default::default()).is_err() {
                    break 'outer;
                }
            }
        }
        let err = reg
            .create("ext.spillover", p.clone(), Default::default())
            .unwrap_err();
        assert!(format!("{err}").contains("limit exceeded"), "got: {err}");
    }

    // ---- Task 11: remove_all_for_extension ----

    #[test]
    fn remove_all_for_extension_removes_only_that_extensions_handles() {
        let reg = new_registry();
        let tmp = tempfile::tempdir().unwrap();
        let p = vec![tmp.path().to_path_buf()];
        reg.create("ext.a", p.clone(), Default::default()).unwrap();
        reg.create("ext.a", p.clone(), Default::default()).unwrap();
        reg.create("ext.b", p.clone(), Default::default()).unwrap();
        assert_eq!(reg.handle_count(), 3);
        let n = reg.remove_all_for_extension("ext.a").unwrap();
        assert_eq!(n, 2);
        assert_eq!(reg.handle_count(), 1);
    }

    #[test]
    fn remove_all_for_extension_zero_when_no_handles() {
        let reg = new_registry();
        let n = reg.remove_all_for_extension("ext.missing").unwrap();
        assert_eq!(n, 0);
    }

    // ---- Task 12: end-to-end with real debouncer ----

    /// Mirrors `debouncer_wakes_on_file_change_and_dispatches_through_hub`
    /// in `application/index_watcher.rs`. Uses a real debouncer + real
    /// tempdir + `RecordingEmitter` to prove the full pipeline:
    /// filesystem change → debouncer wakes → coalescer runs → emitter
    /// receives `(extensionId, handleId, FsWatchEvent)`.
    #[test]
    fn debouncer_fires_and_emitter_records_roots_up_event() {
        use super::fake::RecordingEmitter;

        let tmp = tempfile::tempdir().unwrap();
        let reg = FsWatcherRegistry::new();
        let rec = RecordingEmitter::new();
        reg.set_emitter(rec.clone().into_emit_fn());

        // macOS tempdirs resolve through `/private/var/folders/...` —
        // canonicalize the root so the coalescer matches what notify
        // reports.
        let canonical_root = tmp
            .path()
            .canonicalize()
            .unwrap_or_else(|_| tmp.path().to_path_buf());
        let handle_id = reg
            .create(
                "ext.a",
                vec![canonical_root.clone()],
                FsWatcherOptions {
                    recursive: true,
                    debounce: Duration::from_millis(150),
                },
            )
            .unwrap();

        std::fs::write(tmp.path().join("trigger.txt"), b"hello").unwrap();

        let start = std::time::Instant::now();
        loop {
            let snap = rec.snapshot();
            if !snap.is_empty() {
                assert_eq!(snap[0].0, "ext.a");
                assert_eq!(snap[0].1, handle_id);
                assert!(
                    snap[0].2.paths.iter().any(|p| p == &canonical_root),
                    "emitted paths {:?} should include canonical root {:?}",
                    snap[0].2.paths,
                    canonical_root,
                );
                return;
            }
            if start.elapsed() > Duration::from_secs(5) {
                panic!("debouncer callback did not fire within 5s");
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
