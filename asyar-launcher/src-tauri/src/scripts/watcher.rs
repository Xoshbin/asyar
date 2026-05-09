//! Filesystem watcher for user-configured script directories.
//!
//! On any filesystem event in a watched directory, calls the provided
//! `on_change` callback. No debouncing — every event fires immediately.
//! Production code wires `on_change` to emit the Tauri `scripts:changed`
//! event; tests pass a closure that records calls.

use crate::error::AppError;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// Shared state holding the current list of watched directories.
/// Cloning the Arc is cheap; mutation is serialized through the Mutex.
pub type DirectoriesState = Arc<Mutex<Vec<PathBuf>>>;

/// Build a fresh shared state. Tests may construct one independently of
/// the watcher to verify invariants.
pub fn build_directories_state(initial: Vec<PathBuf>) -> DirectoriesState {
    Arc::new(Mutex::new(initial))
}

/// Watcher handle. Owns the notify::RecommendedWatcher and the directories
/// state. Started via `start(...)`.
pub struct ScriptsWatcher {
    state: DirectoriesState,
    watcher: Mutex<RecommendedWatcher>,
}

impl ScriptsWatcher {
    /// Start watching the given directories. Calls `on_change` on any FS
    /// event in the watched set. No debouncing — every event fires.
    pub fn start(
        directories: DirectoriesState,
        on_change: impl Fn() + Send + Sync + 'static,
    ) -> Result<Arc<Self>, AppError> {
        let on_change = Arc::new(on_change);
        let on_change_cb = on_change.clone();

        let watcher = notify::recommended_watcher(
            move |res: Result<notify::Event, notify::Error>| {
                if res.is_ok() {
                    on_change_cb();
                }
            },
        )
        .map_err(|e| AppError::Other(format!("scripts watcher init: {e}")))?;

        let initial_dirs: Vec<PathBuf> = directories
            .lock()
            .map_err(|_| AppError::Other("ScriptsWatcher state mutex poisoned".into()))?
            .clone();

        let watcher_mutex = Mutex::new(watcher);
        for dir in &initial_dirs {
            if let Err(e) = watcher_mutex
                .lock()
                .map_err(|_| AppError::Other("watcher mutex poisoned".into()))?
                .watch(dir, RecursiveMode::NonRecursive)
            {
                log::warn!("[scripts_watcher] failed to watch {:?}: {}", dir, e);
            }
        }

        Ok(Arc::new(Self {
            state: directories,
            watcher: watcher_mutex,
        }))
    }

    /// Replace the watched directory set. Drops the old subscriptions and
    /// installs new ones.
    pub fn set_directories(&self, dirs: Vec<PathBuf>) -> Result<(), AppError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| AppError::Other("ScriptsWatcher state mutex poisoned".into()))?;
        let mut watcher = self
            .watcher
            .lock()
            .map_err(|_| AppError::Other("ScriptsWatcher mutex poisoned".into()))?;

        for old in state.iter() {
            let _ = watcher.unwatch(old);
        }

        for dir in &dirs {
            if let Err(e) = watcher.watch(dir, RecursiveMode::NonRecursive) {
                log::warn!("[scripts_watcher] failed to watch {:?}: {}", dir, e);
            }
        }

        *state = dirs;
        Ok(())
    }

    /// Snapshot of the current directories — primarily for tests.
    #[cfg(test)]
    pub fn current_directories(&self) -> Vec<PathBuf> {
        self.state.lock().unwrap().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_directories_state_with_empty_vec() {
        let state = build_directories_state(vec![]);
        let guard = state.lock().unwrap();
        assert!(guard.is_empty(), "expected empty Vec from build_directories_state(vec![])");
    }

    #[test]
    fn build_directories_state_with_initial_paths() {
        let state = build_directories_state(vec![PathBuf::from("/a")]);
        let guard = state.lock().unwrap();
        assert_eq!(*guard, vec![PathBuf::from("/a")]);
    }

    #[test]
    fn state_arc_aliases_a_single_arc() {
        let state = build_directories_state(vec![PathBuf::from("/Users/test/Scripts")]);
        let alias = Arc::clone(&state);

        assert!(
            Arc::ptr_eq(&state, &alias),
            "both Arcs must point to the same allocation"
        );

        // Mutate through one; observe through the other.
        let new_dirs = vec![PathBuf::from("/Users/test/Other")];
        *state.lock().unwrap() = new_dirs.clone();
        assert_eq!(*alias.lock().unwrap(), new_dirs);
    }

    #[test]
    fn start_with_empty_directories_succeeds() {
        let dirs = build_directories_state(vec![]);
        let result = ScriptsWatcher::start(dirs, || {});
        assert!(result.is_ok(), "start with empty directories must succeed");
    }

    #[test]
    fn set_directories_updates_state() {
        let dirs = build_directories_state(vec![]);
        let watcher = ScriptsWatcher::start(dirs, || {}).expect("start succeeds");
        watcher
            .set_directories(vec![PathBuf::from("/tmp/scripts-test")])
            .expect("set_directories succeeds");
        assert_eq!(
            watcher.current_directories(),
            vec![PathBuf::from("/tmp/scripts-test")]
        );
    }

    #[test]
    fn set_directories_clears_when_empty() {
        let dirs = build_directories_state(vec![PathBuf::from("/a")]);
        let watcher = ScriptsWatcher::start(dirs, || {}).expect("start succeeds");
        watcher
            .set_directories(vec![])
            .expect("set_directories to empty succeeds");
        assert!(
            watcher.current_directories().is_empty(),
            "state must be empty after set_directories(vec![])"
        );
    }

    #[test]
    fn set_directories_replaces_not_appends() {
        let dirs = build_directories_state(vec![PathBuf::from("/a")]);
        let watcher = ScriptsWatcher::start(dirs, || {}).expect("start succeeds");
        watcher
            .set_directories(vec![PathBuf::from("/b")])
            .expect("set_directories succeeds");
        let current = watcher.current_directories();
        assert_eq!(
            current,
            vec![PathBuf::from("/b")],
            "state must be [/b], not [/a, /b]"
        );
    }

    #[test]
    fn start_returns_arc_so_handle_can_be_shared() {
        let dirs = build_directories_state(vec![]);
        let arc = ScriptsWatcher::start(dirs, || {}).expect("start succeeds");
        // Verify we can clone the Arc (proves return type is Arc<ScriptsWatcher>).
        let _clone = Arc::clone(&arc);
    }

    #[test]
    fn set_directories_idempotent_for_same_set() {
        let dirs = build_directories_state(vec![PathBuf::from("/a")]);
        let watcher = ScriptsWatcher::start(dirs, || {}).expect("start succeeds");
        watcher
            .set_directories(vec![PathBuf::from("/a")])
            .expect("set_directories with same set succeeds");
        assert_eq!(
            watcher.current_directories(),
            vec![PathBuf::from("/a")],
            "state must remain [/a] after idempotent set_directories"
        );
    }
}
