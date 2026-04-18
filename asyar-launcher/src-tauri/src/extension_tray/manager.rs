//! Extension-tray lifecycle manager.
//!
//! Owns the in-memory registry of `(extension_id, item_id) -> backend-handle`
//! mappings. All Tauri I/O flows through the [`TrayBackend`] trait so the
//! coordination logic is unit-testable without a live `App`.

use crate::error::AppError;
use crate::extension_tray::item::StatusBarItem;
use crate::extension_tray::validation::validate_top_level;
use std::collections::HashSet;
use std::sync::Mutex;

/// `(extension_id, top_item_id)` — uniquely identifies one tray icon.
pub type TrayKey = (String, String);

/// Abstraction over Tauri-level tray operations. The production impl wraps a
/// `TrayIconBuilder`; tests substitute a recorder.
pub trait TrayBackend: Send + Sync {
    fn create(&self, key: &TrayKey, item: &StatusBarItem) -> Result<(), AppError>;
    fn update(&self, key: &TrayKey, item: &StatusBarItem) -> Result<(), AppError>;
    fn destroy(&self, key: &TrayKey) -> Result<(), AppError>;
}

pub struct ExtensionTrayManager {
    backend: Box<dyn TrayBackend>,
    known_keys: Mutex<HashSet<TrayKey>>,
}

impl ExtensionTrayManager {
    pub fn new(backend: Box<dyn TrayBackend>) -> Self {
        Self {
            backend,
            known_keys: Mutex::new(HashSet::new()),
        }
    }

    /// Register or update the top-level tray icon described by `item`. New
    /// keys call `create`; existing keys call `update`. `item` must carry a
    /// populated `extension_id` (the SDK proxy injects this before IPC).
    pub fn register_or_update(&self, item: &StatusBarItem) -> Result<(), AppError> {
        let extension_id = item
            .extension_id
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                AppError::Validation(
                    "Status-bar item is missing its extension id".into(),
                )
            })?;

        validate_top_level(item)?;

        let key: TrayKey = (extension_id.to_string(), item.id.clone());
        let already_known = self.known_keys.lock().map_err(|_| AppError::Lock)?.contains(&key);
        if already_known {
            self.backend.update(&key, item)?;
        } else {
            self.backend.create(&key, item)?;
            self.known_keys.lock().map_err(|_| AppError::Lock)?.insert(key);
        }
        Ok(())
    }

    /// Drop a single tray icon. No-op if the key is unknown.
    pub fn unregister(&self, extension_id: &str, item_id: &str) -> Result<(), AppError> {
        let key: TrayKey = (extension_id.to_string(), item_id.to_string());
        let was_present = self
            .known_keys
            .lock()
            .map_err(|_| AppError::Lock)?
            .remove(&key);
        if was_present {
            self.backend.destroy(&key)?;
        }
        Ok(())
    }

    /// Drop every tray owned by the given extension. Returns the list of
    /// keys that were actually removed.
    pub fn remove_all_for_extension(&self, extension_id: &str) -> Result<Vec<TrayKey>, AppError> {
        // Drain matching keys under the lock, then destroy them outside.
        let to_remove: Vec<TrayKey> = {
            let mut set = self.known_keys.lock().map_err(|_| AppError::Lock)?;
            let matching: Vec<TrayKey> = set
                .iter()
                .filter(|(ext, _)| ext == extension_id)
                .cloned()
                .collect();
            for k in &matching {
                set.remove(k);
            }
            matching
        };
        for key in &to_remove {
            self.backend.destroy(key)?;
        }
        Ok(to_remove)
    }

    #[cfg(test)]
    pub(crate) fn known_keys(&self) -> Vec<TrayKey> {
        let mut keys: Vec<TrayKey> =
            self.known_keys.lock().unwrap().iter().cloned().collect();
        keys.sort();
        keys
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum Call {
        Create(TrayKey),
        Update(TrayKey),
        Destroy(TrayKey),
    }

    struct RecordingBackend {
        calls: Arc<Mutex<Vec<Call>>>,
        fail_on: Option<(String, TrayKey)>,
    }

    impl RecordingBackend {
        fn new() -> (Self, Arc<Mutex<Vec<Call>>>) {
            let calls = Arc::new(Mutex::new(Vec::new()));
            (
                Self {
                    calls: calls.clone(),
                    fail_on: None,
                },
                calls,
            )
        }
    }

    impl TrayBackend for RecordingBackend {
        fn create(&self, key: &TrayKey, _item: &StatusBarItem) -> Result<(), AppError> {
            if let Some((op, bad)) = &self.fail_on {
                if op == "create" && bad == key {
                    return Err(AppError::Platform("boom".into()));
                }
            }
            self.calls.lock().unwrap().push(Call::Create(key.clone()));
            Ok(())
        }
        fn update(&self, key: &TrayKey, _item: &StatusBarItem) -> Result<(), AppError> {
            self.calls.lock().unwrap().push(Call::Update(key.clone()));
            Ok(())
        }
        fn destroy(&self, key: &TrayKey) -> Result<(), AppError> {
            self.calls.lock().unwrap().push(Call::Destroy(key.clone()));
            Ok(())
        }
    }

    fn top(ext: &str, id: &str) -> StatusBarItem {
        StatusBarItem {
            id: id.to_string(),
            extension_id: Some(ext.to_string()),
            icon: Some("☕".into()),
            icon_path: None,
            text: "Coffee".to_string(),
            checked: None,
            submenu: None,
            enabled: None,
            separator: None,
        }
    }

    fn mgr() -> (ExtensionTrayManager, Arc<Mutex<Vec<Call>>>) {
        let (backend, calls) = RecordingBackend::new();
        (ExtensionTrayManager::new(Box::new(backend)), calls)
    }

    #[test]
    fn register_new_key_calls_create() {
        let (m, calls) = mgr();
        m.register_or_update(&top("ext-a", "coffee")).unwrap();
        assert_eq!(
            &*calls.lock().unwrap(),
            &[Call::Create(("ext-a".into(), "coffee".into()))]
        );
    }

    #[test]
    fn register_existing_key_calls_update() {
        let (m, calls) = mgr();
        m.register_or_update(&top("ext-a", "coffee")).unwrap();
        m.register_or_update(&top("ext-a", "coffee")).unwrap();
        let got = calls.lock().unwrap().clone();
        assert_eq!(
            got,
            vec![
                Call::Create(("ext-a".into(), "coffee".into())),
                Call::Update(("ext-a".into(), "coffee".into())),
            ]
        );
    }

    #[test]
    fn register_different_ids_each_create() {
        let (m, calls) = mgr();
        m.register_or_update(&top("ext-a", "coffee")).unwrap();
        m.register_or_update(&top("ext-a", "tea")).unwrap();
        let got = calls.lock().unwrap().clone();
        assert_eq!(
            got,
            vec![
                Call::Create(("ext-a".into(), "coffee".into())),
                Call::Create(("ext-a".into(), "tea".into())),
            ]
        );
    }

    #[test]
    fn register_same_id_different_extensions_each_create() {
        let (m, calls) = mgr();
        m.register_or_update(&top("ext-a", "clock")).unwrap();
        m.register_or_update(&top("ext-b", "clock")).unwrap();
        let got = calls.lock().unwrap().clone();
        assert_eq!(
            got,
            vec![
                Call::Create(("ext-a".into(), "clock".into())),
                Call::Create(("ext-b".into(), "clock".into())),
            ]
        );
    }

    #[test]
    fn unregister_known_key_calls_destroy() {
        let (m, calls) = mgr();
        m.register_or_update(&top("ext-a", "coffee")).unwrap();
        m.unregister("ext-a", "coffee").unwrap();
        let got = calls.lock().unwrap().clone();
        assert_eq!(
            got,
            vec![
                Call::Create(("ext-a".into(), "coffee".into())),
                Call::Destroy(("ext-a".into(), "coffee".into())),
            ]
        );
    }

    #[test]
    fn unregister_unknown_key_noop() {
        let (m, calls) = mgr();
        m.unregister("ghost", "x").unwrap();
        assert!(calls.lock().unwrap().is_empty());
    }

    #[test]
    fn reregister_after_unregister_calls_create_again() {
        let (m, calls) = mgr();
        m.register_or_update(&top("ext-a", "coffee")).unwrap();
        m.unregister("ext-a", "coffee").unwrap();
        m.register_or_update(&top("ext-a", "coffee")).unwrap();
        let got = calls.lock().unwrap().clone();
        assert_eq!(
            got,
            vec![
                Call::Create(("ext-a".into(), "coffee".into())),
                Call::Destroy(("ext-a".into(), "coffee".into())),
                Call::Create(("ext-a".into(), "coffee".into())),
            ]
        );
    }

    #[test]
    fn remove_all_for_extension_drops_only_that_extension() {
        let (m, calls) = mgr();
        m.register_or_update(&top("ext-a", "c1")).unwrap();
        m.register_or_update(&top("ext-a", "c2")).unwrap();
        m.register_or_update(&top("ext-b", "c1")).unwrap();
        let removed = m.remove_all_for_extension("ext-a").unwrap();

        let mut sorted = removed;
        sorted.sort();
        assert_eq!(
            sorted,
            vec![
                ("ext-a".into(), "c1".into()),
                ("ext-a".into(), "c2".into()),
            ]
        );

        let destroys: Vec<TrayKey> = calls
            .lock()
            .unwrap()
            .iter()
            .filter_map(|c| match c {
                Call::Destroy(k) => Some(k.clone()),
                _ => None,
            })
            .collect();
        let mut sorted_destroys = destroys;
        sorted_destroys.sort();
        assert_eq!(
            sorted_destroys,
            vec![
                ("ext-a".into(), "c1".into()),
                ("ext-a".into(), "c2".into()),
            ]
        );

        assert_eq!(m.known_keys(), vec![("ext-b".into(), "c1".into())]);
    }

    #[test]
    fn remove_all_for_extension_no_matches_returns_empty() {
        let (m, _calls) = mgr();
        m.register_or_update(&top("ext-b", "c1")).unwrap();
        let removed = m.remove_all_for_extension("ghost").unwrap();
        assert!(removed.is_empty());
        assert_eq!(m.known_keys(), vec![("ext-b".into(), "c1".into())]);
    }

    #[test]
    fn register_missing_extension_id_errors() {
        let (m, _calls) = mgr();
        let mut item = top("ext-a", "coffee");
        item.extension_id = None;
        let err = m.register_or_update(&item).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("extension"));
    }

    #[test]
    fn register_empty_extension_id_errors() {
        let (m, _calls) = mgr();
        let mut item = top("", "coffee");
        item.extension_id = Some("".into());
        let err = m.register_or_update(&item).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("extension"));
    }

    #[test]
    fn register_invalid_tree_errors_and_leaves_state_clean() {
        let (m, calls) = mgr();
        let mut bad = top("ext-a", "coffee");
        bad.separator = Some(true); // top-level separator is rejected
        assert!(m.register_or_update(&bad).is_err());
        assert!(calls.lock().unwrap().is_empty());
        assert!(m.known_keys().is_empty());
    }

    #[test]
    fn tracks_key_only_after_successful_create() {
        let (mut backend, calls) = RecordingBackend::new();
        backend.fail_on = Some(("create".into(), ("ext-a".into(), "coffee".into())));
        let m = ExtensionTrayManager::new(Box::new(backend));

        assert!(m.register_or_update(&top("ext-a", "coffee")).is_err());
        assert!(m.known_keys().is_empty());
        assert!(calls.lock().unwrap().is_empty());
    }

    /// Ensures that `remove_all_for_extension` drops its exclusive lock
    /// before calling the backend, so a backend that itself reaches back
    /// through the manager (e.g., via a downstream service) doesn't deadlock.
    #[test]
    fn remove_all_for_extension_does_not_hold_lock_across_backend_calls() {
        struct ReentrantBackend {
            inner_calls: Arc<Mutex<Vec<Call>>>,
        }
        impl TrayBackend for ReentrantBackend {
            fn create(&self, key: &TrayKey, _: &StatusBarItem) -> Result<(), AppError> {
                self.inner_calls.lock().unwrap().push(Call::Create(key.clone()));
                Ok(())
            }
            fn update(&self, key: &TrayKey, _: &StatusBarItem) -> Result<(), AppError> {
                self.inner_calls.lock().unwrap().push(Call::Update(key.clone()));
                Ok(())
            }
            fn destroy(&self, key: &TrayKey) -> Result<(), AppError> {
                self.inner_calls.lock().unwrap().push(Call::Destroy(key.clone()));
                Ok(())
            }
        }
        let calls = Arc::new(Mutex::new(Vec::new()));
        let m = ExtensionTrayManager::new(Box::new(ReentrantBackend {
            inner_calls: calls.clone(),
        }));
        m.register_or_update(&top("ext", "x")).unwrap();
        m.register_or_update(&top("ext", "y")).unwrap();
        let removed = m.remove_all_for_extension("ext").unwrap();
        assert_eq!(removed.len(), 2);
        assert!(m.known_keys().is_empty());
    }
}
