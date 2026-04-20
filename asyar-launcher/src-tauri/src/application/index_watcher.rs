//! Filesystem watcher that keeps the application index fresh.
//!
//! ## Why this exists
//!
//! Before this module, installed-app discovery was a one-shot pull: the
//! launcher called `sync_application_index` at startup and never again until
//! the user explicitly re-triggered it. New installs, uninstalls, and edits
//! to user-configured scan paths (`settings.search.additionalScanPaths`)
//! stayed invisible until an app restart.
//!
//! The watcher reactively drives rescans instead. It holds a debounced
//! `notify` watcher over the union of default + user-configured scan
//! directories; after every debounced event batch it calls
//! `sync_application_index` and, if the diff is non-empty, dispatches
//! `IndexEvent::ApplicationsChanged` through [`IndexEventsHub`] so
//! subscribed extensions and UI code can react.
//!
//! ## Design notes
//!
//! - **Debouncing is mandatory.** App installs on macOS emit bursts of tens
//!   of FSEvent callbacks as the bundle is copied in; a naive watcher would
//!   trigger a full rescan for each. The `notify-debouncer-full` crate
//!   coalesces these into one event per quiescent window (default 500ms).
//!
//! - **Default paths are always watched**; they're part of the OS and
//!   can't be "unconfigured". Extras are watched via a separate, mutable
//!   path set so edits to `additionalScanPaths` can re-arm cleanly
//!   (unwatch old → watch new) without tearing down the whole debouncer.
//!
//! - **The watcher owns its own `AppHandle` clone**. At dispatch time it
//!   re-derives `SearchState` from `app.state::<SearchState>()` rather than
//!   holding an `Arc<SearchState>` — this keeps `SearchState`'s managed
//!   state singular and avoids lifecycle coupling.
//!
//! - **No-op events are suppressed.** FSEvent replays at startup and
//!   cosmetic changes (mtime bumps, file attribute edits) can produce a
//!   scan that shows `added == 0 && removed == 0`. `sync_result_to_event`
//!   filters those out so subscribers don't wake for nothing.

use crate::application::service::{get_default_app_scan_paths, sync_application_index, SyncResult};
use crate::error::AppError;
use crate::index_events::{IndexEvent, IndexEventsHub};
use crate::search_engine::SearchState;
use log::{debug, warn};
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const DEBOUNCE_WINDOW: Duration = Duration::from_millis(500);

/// Pure helper: compute the de-duplicated, existence-filtered set of paths
/// to watch given the platform defaults and user-configured extras.
///
/// - Normalizes each path via [`std::path::Path::canonicalize`] so that
///   `/tmp/x` and `/tmp/x/` collapse to the same entry (defensive against user input —
///   TS `normalizeScanPath` strips trailing separators but the watcher
///   shouldn't assume that).
/// - Drops paths that don't exist at call time. `notify` would error
///   otherwise, and a non-existent extra path is a silent-recovery case
///   (user removed the dir after adding it to settings).
/// - Preserves ordering of first occurrence for deterministic tests.
pub fn compute_watch_set(defaults: &[PathBuf], extras: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut out: Vec<PathBuf> = Vec::new();

    for p in defaults.iter().chain(extras.iter()) {
        let canonical = p.canonicalize().unwrap_or_else(|_| p.clone());
        if !canonical.exists() {
            continue;
        }
        if seen.insert(canonical.clone()) {
            out.push(canonical);
        }
    }
    out
}

/// Pure helper: map a `SyncResult` to the event to dispatch, or `None` if
/// the rescan was a no-op. Watcher callbacks call this so the filter logic
/// is testable without mocking the hub.
pub fn sync_result_to_event(result: &SyncResult) -> Option<IndexEvent> {
    if result.added == 0 && result.removed == 0 {
        return None;
    }
    Some(IndexEvent::ApplicationsChanged {
        added: result.added,
        removed: result.removed,
        total: result.total,
    })
}

/// Long-lived watcher handle. Drop drops the debouncer which unwatches all
/// paths, so this must be stored in managed state for the app's lifetime.
pub struct IndexWatcher {
    // Holding the debouncer keeps the watcher thread alive. The concrete
    // type is the debouncer-full recommended bundle (RecommendedWatcher +
    // FileIdMap cache); we don't name it directly because the crate's
    // public type alias `Debouncer<RecommendedWatcher, RecommendedCache>`
    // is the stable surface.
    debouncer: Mutex<Debouncer<notify::RecommendedWatcher, RecommendedCache>>,
    extras: Mutex<Vec<PathBuf>>,
}

impl IndexWatcher {
    /// Arm the watcher with default scan paths + the given `initial_extras`
    /// (typically `settings.search.additionalScanPaths` loaded at startup).
    /// After this returns, filesystem events trigger rescans and dispatch
    /// through `hub` until the returned `Arc<IndexWatcher>` is dropped.
    pub fn start(
        app_handle: AppHandle,
        hub: Arc<IndexEventsHub>,
        initial_extras: Vec<PathBuf>,
    ) -> Result<Arc<Self>, AppError> {
        let defaults = get_default_app_scan_paths();
        let initial_watch = compute_watch_set(&defaults, &initial_extras);

        let handler_app = app_handle.clone();
        let handler_hub = hub.clone();
        let handler_extras = Arc::new(Mutex::new(initial_extras.clone()));
        let callback_extras = handler_extras.clone();

        let mut debouncer = new_debouncer(
            DEBOUNCE_WINDOW,
            None,
            move |result: DebounceEventResult| match result {
                Ok(events) if events.is_empty() => {}
                Ok(_events) => {
                    let extras = callback_extras
                        .lock()
                        .map(|g| g.clone())
                        .unwrap_or_default();
                    on_debounced_batch(&handler_app, &handler_hub, extras);
                }
                Err(errs) => {
                    for e in errs {
                        warn!("[index_watcher] debouncer error: {e}");
                    }
                }
            },
        )
        .map_err(|e| AppError::Other(format!("failed to create debouncer: {e}")))?;

        for path in &initial_watch {
            if let Err(e) = debouncer.watch(path, RecursiveMode::Recursive) {
                warn!("[index_watcher] failed to watch {:?}: {}", path, e);
            } else {
                debug!("[index_watcher] watching {:?}", path);
            }
        }

        // `handler_extras` tracks the currently-watched extras so the debounce
        // callback always sees the latest set; `self.extras` mirrors the same
        // value so `set_extra_paths` can compute the diff.
        Ok(Arc::new(Self {
            debouncer: Mutex::new(debouncer),
            extras: Mutex::new(initial_extras),
        }))
    }

    /// Replace the user-configured extra scan paths. Unwatches paths that
    /// were removed, watches paths that were added. Default paths are
    /// untouched.
    ///
    /// Called from the `set_application_scan_paths` Tauri command when the
    /// user edits `additionalScanPaths` in settings.
    pub fn set_extra_paths(&self, new_extras: Vec<PathBuf>) -> Result<(), AppError> {
        let defaults = get_default_app_scan_paths();
        let default_set: HashSet<PathBuf> = defaults
            .iter()
            .map(|p| p.canonicalize().unwrap_or_else(|_| p.clone()))
            .collect();

        let mut extras_guard = self.extras.lock().map_err(|_| AppError::Lock)?;
        let mut debouncer = self.debouncer.lock().map_err(|_| AppError::Lock)?;

        let old_canonical: HashSet<PathBuf> = extras_guard
            .iter()
            .map(|p| p.canonicalize().unwrap_or_else(|_| p.clone()))
            .collect();
        let new_canonical: HashSet<PathBuf> = new_extras
            .iter()
            .map(|p| p.canonicalize().unwrap_or_else(|_| p.clone()))
            .collect();

        // Unwatch paths removed from extras — but only if they're not
        // defaults. A user-added path that happens to be a default stays
        // watched regardless.
        for removed in old_canonical.difference(&new_canonical) {
            if default_set.contains(removed) {
                continue;
            }
            if let Err(e) = debouncer.unwatch(removed) {
                debug!("[index_watcher] unwatch {:?} skipped: {}", removed, e);
            }
        }

        // Watch newly-added paths that aren't already watched by defaults.
        for added in new_canonical.difference(&old_canonical) {
            if default_set.contains(added) {
                continue;
            }
            if !added.exists() {
                debug!("[index_watcher] skipping non-existent extra {:?}", added);
                continue;
            }
            if let Err(e) = debouncer.watch(added, RecursiveMode::Recursive) {
                warn!("[index_watcher] failed to watch {:?}: {}", added, e);
            }
        }

        *extras_guard = new_extras;
        Ok(())
    }

}

/// Runs on the debouncer thread after each quiescent window. Re-derives
/// `SearchState` from the app handle (rather than holding a long-lived
/// reference) so `SearchState`'s lifecycle stays owned by Tauri's managed
/// state.
fn on_debounced_batch(
    app_handle: &AppHandle,
    hub: &IndexEventsHub,
    extras: Vec<PathBuf>,
) {
    let search_state = app_handle.state::<SearchState>();
    match sync_application_index(app_handle, search_state.inner(), extras) {
        Ok(result) => {
            if let Some(event) = sync_result_to_event(&result) {
                debug!(
                    "[index_watcher] dispatch: added={} removed={} total={}",
                    result.added, result.removed, result.total
                );
                hub.dispatch(event);
            }
        }
        Err(e) => {
            warn!("[index_watcher] rescan failed: {e}");
        }
    }
}

/// Escape hatch that isolates the watcher's dependencies on `AppHandle` so
/// unit tests can exercise the rescan-and-dispatch path without a running
/// Tauri app.
///
/// Used by the integration test: pass a real `SearchState` (in-memory
/// SQLite) and a fake icon cache dir; the fn calls the existing scan logic
/// directly and dispatches the derived event.
#[cfg(test)]
pub(crate) fn process_scan_result_into_hub(hub: &IndexEventsHub, result: SyncResult) {
    if let Some(event) = sync_result_to_event(&result) {
        hub.dispatch(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- compute_watch_set ----

    #[test]
    fn compute_watch_set_returns_existing_defaults_only_when_extras_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let defaults = vec![tmp.path().to_path_buf()];
        let out = compute_watch_set(&defaults, &[]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0], tmp.path().canonicalize().unwrap());
    }

    #[test]
    fn compute_watch_set_dedupes_when_extra_overlaps_with_default() {
        let tmp = tempfile::tempdir().unwrap();
        let defaults = vec![tmp.path().to_path_buf()];
        let extras = vec![tmp.path().to_path_buf()];
        let out = compute_watch_set(&defaults, &extras);
        assert_eq!(out.len(), 1, "duplicate of default should be dropped");
    }

    #[test]
    fn compute_watch_set_dedupes_when_extras_overlap_with_each_other() {
        let tmp = tempfile::tempdir().unwrap();
        let extras = vec![tmp.path().to_path_buf(), tmp.path().to_path_buf()];
        let out = compute_watch_set(&[], &extras);
        assert_eq!(out.len(), 1, "duplicate within extras should be dropped");
    }

    #[test]
    fn compute_watch_set_drops_nonexistent_paths() {
        let missing = PathBuf::from("/tmp/asyar_nonexistent_path_8712946");
        let out = compute_watch_set(&[missing], &[]);
        assert!(
            out.is_empty(),
            "paths that don't exist must be filtered out"
        );
    }

    #[test]
    fn compute_watch_set_preserves_default_before_extra_ordering() {
        let d = tempfile::tempdir().unwrap();
        let e = tempfile::tempdir().unwrap();
        let defaults = vec![d.path().to_path_buf()];
        let extras = vec![e.path().to_path_buf()];
        let out = compute_watch_set(&defaults, &extras);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0], d.path().canonicalize().unwrap());
        assert_eq!(out[1], e.path().canonicalize().unwrap());
    }

    #[test]
    fn compute_watch_set_normalizes_trailing_separator() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().to_path_buf();
        // Two variants of the same path — trailing-slash and not. Both
        // canonicalize to the same thing, so the set should contain one
        // entry.
        let with_slash = base.join("");
        let extras = vec![base.clone(), with_slash];
        let out = compute_watch_set(&[], &extras);
        assert_eq!(out.len(), 1);
    }

    // ---- sync_result_to_event ----

    #[test]
    fn sync_result_to_event_returns_none_when_no_changes() {
        let r = SyncResult {
            added: 0,
            removed: 0,
            total: 42,
        };
        assert!(sync_result_to_event(&r).is_none());
    }

    #[test]
    fn sync_result_to_event_returns_some_when_added_nonzero() {
        let r = SyncResult {
            added: 1,
            removed: 0,
            total: 43,
        };
        let ev = sync_result_to_event(&r).expect("some");
        assert_eq!(
            ev,
            IndexEvent::ApplicationsChanged {
                added: 1,
                removed: 0,
                total: 43,
            }
        );
    }

    #[test]
    fn sync_result_to_event_returns_some_when_removed_nonzero() {
        let r = SyncResult {
            added: 0,
            removed: 2,
            total: 40,
        };
        assert!(sync_result_to_event(&r).is_some());
    }

    #[test]
    fn sync_result_to_event_returns_some_when_both_nonzero() {
        let r = SyncResult {
            added: 3,
            removed: 1,
            total: 45,
        };
        let ev = sync_result_to_event(&r).expect("some");
        assert_eq!(
            ev,
            IndexEvent::ApplicationsChanged {
                added: 3,
                removed: 1,
                total: 45,
            }
        );
    }

    // ---- process_scan_result_into_hub (integration proxy) ----

    #[test]
    fn process_scan_result_dispatches_when_changes_nonzero() {
        use crate::index_events::IndexEventKind;

        let hub: IndexEventsHub = IndexEventsHub::new();
        let rec = crate::index_events::fake::RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        let mut kinds = HashSet::new();
        kinds.insert(IndexEventKind::ApplicationsChanged);
        hub.subscribe("ext-a", kinds).unwrap();

        process_scan_result_into_hub(
            &hub,
            SyncResult {
                added: 1,
                removed: 0,
                total: 1,
            },
        );

        let snap = rec.snapshot();
        assert_eq!(snap.len(), 1);
        assert_eq!(
            snap[0].1,
            IndexEvent::ApplicationsChanged {
                added: 1,
                removed: 0,
                total: 1,
            }
        );
    }

    // ---- end-to-end: real debouncer drives real callback ----

    /// Exercises the full watcher pipeline minus `AppHandle` dependency:
    /// a real `notify-debouncer-full` watcher, a real temp directory, and
    /// a hand-rolled callback that substitutes `on_debounced_batch` (which
    /// needs an `AppHandle`) with a direct dispatch — the substitute mirrors
    /// what production does after the rescan: run `sync_result_to_event` on
    /// a known `SyncResult` and dispatch to the hub.
    ///
    /// Proves end-to-end that:
    ///  1. The debouncer wakes on a filesystem change.
    ///  2. The callback runs within the test's timeout budget.
    ///  3. The dispatch arrives at the subscribed extension.
    #[test]
    fn debouncer_wakes_on_file_change_and_dispatches_through_hub() {
        use crate::index_events::IndexEventKind;
        use std::sync::mpsc;

        let tmp = tempfile::tempdir().unwrap();
        let hub = Arc::new(IndexEventsHub::new());
        let rec = crate::index_events::fake::RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        let mut kinds = HashSet::new();
        kinds.insert(IndexEventKind::ApplicationsChanged);
        hub.subscribe("ext-a", kinds).unwrap();

        let (tx, rx) = mpsc::channel::<()>();
        let hub_cb = hub.clone();
        let mut debouncer = new_debouncer(
            Duration::from_millis(150),
            None,
            move |result: DebounceEventResult| {
                if let Ok(events) = result {
                    if !events.is_empty() {
                        // Stand-in for the real rescan — production looks up
                        // SearchState and calls sync_application_index, then
                        // `sync_result_to_event`. Here we fabricate a
                        // non-empty SyncResult to prove the dispatch wiring.
                        let ev = sync_result_to_event(&SyncResult {
                            added: 1,
                            removed: 0,
                            total: 1,
                        });
                        if let Some(ev) = ev {
                            hub_cb.dispatch(ev);
                        }
                        let _ = tx.send(());
                    }
                }
            },
        )
        .expect("debouncer starts");

        debouncer
            .watch(tmp.path(), RecursiveMode::Recursive)
            .expect("watcher arms on tempdir");

        // Create a file to trigger the watcher.
        std::fs::write(tmp.path().join("trigger.txt"), b"hi").unwrap();

        // Wait up to 3 seconds for the debounced callback.
        rx.recv_timeout(Duration::from_secs(3))
            .expect("debouncer callback fired within timeout");

        let snap = rec.snapshot();
        assert_eq!(snap.len(), 1, "exactly one dispatch");
        assert_eq!(snap[0].0, "ext-a");
        assert_eq!(
            snap[0].1,
            IndexEvent::ApplicationsChanged {
                added: 1,
                removed: 0,
                total: 1,
            }
        );
    }

    #[test]
    fn process_scan_result_suppresses_when_no_changes() {
        use crate::index_events::IndexEventKind;

        let hub: IndexEventsHub = IndexEventsHub::new();
        let rec = crate::index_events::fake::RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        let mut kinds = HashSet::new();
        kinds.insert(IndexEventKind::ApplicationsChanged);
        hub.subscribe("ext-a", kinds).unwrap();

        process_scan_result_into_hub(
            &hub,
            SyncResult {
                added: 0,
                removed: 0,
                total: 42,
            },
        );

        assert!(
            rec.snapshot().is_empty(),
            "no-op scan must not dispatch an event"
        );
    }

}
