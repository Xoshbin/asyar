//! Rust-owned clipboard capture subscription registry.
//!
//! Tracks canonical capture consumers (e.g. `clipboard-history`, `org.example.better-history`).
//! Transitions to active (`CaptureTransition::Start`) when the first consumer subscribes,
//! and to inactive (`CaptureTransition::Stop`) when the final consumer unsubscribes or is force-removed.

use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::sync::Mutex;

pub const CAPTURE_PERMISSION: &str = "clipboard-history:capture";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureTransition {
    Start,
    Stop,
    NoChange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSubscriptionResult {
    pub transition: CaptureTransition,
    pub active_consumers: Vec<String>,
}

#[derive(Default)]
pub struct ClipboardCaptureManager {
    consumers: Mutex<BTreeSet<String>>,
}

impl ClipboardCaptureManager {
    pub fn new() -> Self {
        Self {
            consumers: Mutex::new(BTreeSet::new()),
        }
    }

    /// Subscribes `caller_id` to clipboard capture.
    ///
    /// Validates that:
    /// - If `caller_id` is a built-in feature, `is_feature_enabled` is true.
    /// - If `caller_id` is a Tier 2 extension, it has the `"clipboard-history:capture"` permission.
    ///
    /// Returns `CaptureTransition::Start` if this subscription is the first active consumer,
    /// or `CaptureTransition::NoChange` if already active or already subscribed (idempotent).
    pub fn subscribe(
        &self,
        caller_id: &str,
        permissions: &ExtensionPermissionRegistry,
        is_feature_enabled: bool,
    ) -> Result<CaptureSubscriptionResult, AppError> {
        let caller_trimmed = caller_id.trim();
        if caller_trimmed.is_empty() {
            return Err(AppError::Validation(
                "caller_id cannot be empty".to_string(),
            ));
        }

        if !is_feature_enabled {
            return Err(AppError::Validation(format!(
                "Cannot subscribe capture: feature '{}' is disabled",
                caller_trimmed
            )));
        }

        // Tier 1 built-in clipboard-history or system calls don't require manifest permission check,
        // but any other caller must have `clipboard-history:capture` permission registered.
        if caller_trimmed != "clipboard-history" && caller_trimmed != "asyar" {
            permissions.check(&Some(caller_trimmed.to_string()), CAPTURE_PERMISSION)?;
        }

        let mut lock = self.consumers.lock().map_err(|_| AppError::Lock)?;
        let was_empty = lock.is_empty();
        let inserted = lock.insert(caller_trimmed.to_string());

        let transition = if inserted && was_empty {
            CaptureTransition::Start
        } else {
            CaptureTransition::NoChange
        };

        Ok(CaptureSubscriptionResult {
            transition,
            active_consumers: lock.iter().cloned().collect(),
        })
    }

    /// Unsubscribes `caller_id` from clipboard capture.
    ///
    /// Returns `CaptureTransition::Stop` if this was the last active consumer,
    /// or `CaptureTransition::NoChange` otherwise (or if `caller_id` was not subscribed).
    pub fn unsubscribe(&self, caller_id: &str) -> Result<CaptureSubscriptionResult, AppError> {
        let caller_trimmed = caller_id.trim();
        let mut lock = self.consumers.lock().map_err(|_| AppError::Lock)?;
        let removed = lock.remove(caller_trimmed);

        let transition = if removed && lock.is_empty() {
            CaptureTransition::Stop
        } else {
            CaptureTransition::NoChange
        };

        Ok(CaptureSubscriptionResult {
            transition,
            active_consumers: lock.iter().cloned().collect(),
        })
    }

    /// Forcibly removes an extension from capture consumers (e.g. on disable, uninstall, unload, or consent revoke).
    pub fn force_remove(&self, extension_id: &str) -> Result<CaptureSubscriptionResult, AppError> {
        self.unsubscribe(extension_id)
    }

    /// Returns the current list of active capture consumers.
    pub fn get_consumers(&self) -> Result<Vec<String>, AppError> {
        let lock = self.consumers.lock().map_err(|_| AppError::Lock)?;
        Ok(lock.iter().cloned().collect())
    }

    /// Returns true if there is at least one active capture consumer.
    pub fn is_active(&self) -> Result<bool, AppError> {
        let lock = self.consumers.lock().map_err(|_| AppError::Lock)?;
        Ok(!lock.is_empty())
    }

    /// Clears all consumers.
    pub fn clear(&self) -> Result<CaptureSubscriptionResult, AppError> {
        let mut lock = self.consumers.lock().map_err(|_| AppError::Lock)?;
        let was_empty = lock.is_empty();
        lock.clear();
        let transition = if was_empty {
            CaptureTransition::NoChange
        } else {
            CaptureTransition::Stop
        };
        Ok(CaptureSubscriptionResult {
            transition,
            active_consumers: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::Arc;
    use std::thread;

    fn make_registry_with(ext: &str, perms: &[&str]) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let mut map = reg.inner.lock().unwrap();
        let mut set = HashSet::new();
        for p in perms {
            set.insert(p.to_string());
        }
        map.insert(ext.to_string(), set);
        drop(map);
        reg
    }

    #[test]
    fn test_first_subscriber_starts() {
        let manager = ClipboardCaptureManager::new();
        let perms = ExtensionPermissionRegistry::new();

        let res = manager
            .subscribe("clipboard-history", &perms, true)
            .unwrap();
        assert_eq!(res.transition, CaptureTransition::Start);
        assert_eq!(res.active_consumers, vec!["clipboard-history"]);
        assert!(manager.is_active().unwrap());
    }

    #[test]
    fn test_second_subscriber_no_change() {
        let manager = ClipboardCaptureManager::new();
        let perms = make_registry_with("org.example.better-history", &[CAPTURE_PERMISSION]);

        // First subscriber starts
        let res1 = manager
            .subscribe("clipboard-history", &perms, true)
            .unwrap();
        assert_eq!(res1.transition, CaptureTransition::Start);

        // Second subscriber joins -> NoChange
        let res2 = manager
            .subscribe("org.example.better-history", &perms, true)
            .unwrap();
        assert_eq!(res2.transition, CaptureTransition::NoChange);
        assert_eq!(
            res2.active_consumers,
            vec!["clipboard-history", "org.example.better-history"]
        );
    }

    #[test]
    fn test_duplicate_subscriber_idempotent() {
        let manager = ClipboardCaptureManager::new();
        let perms = ExtensionPermissionRegistry::new();

        let res1 = manager
            .subscribe("clipboard-history", &perms, true)
            .unwrap();
        assert_eq!(res1.transition, CaptureTransition::Start);

        // Duplicate subscribe -> NoChange, active list not duplicated
        let res2 = manager
            .subscribe("clipboard-history", &perms, true)
            .unwrap();
        assert_eq!(res2.transition, CaptureTransition::NoChange);
        assert_eq!(res2.active_consumers, vec!["clipboard-history"]);
    }

    #[test]
    fn test_unsubscribing_one_of_multiple_keeps_active() {
        let manager = ClipboardCaptureManager::new();
        let perms = make_registry_with("org.example.better-history", &[CAPTURE_PERMISSION]);

        manager
            .subscribe("clipboard-history", &perms, true)
            .unwrap();
        manager
            .subscribe("org.example.better-history", &perms, true)
            .unwrap();

        // Remove bundled feature -> Tier 2 still remains -> NoChange
        let res = manager.unsubscribe("clipboard-history").unwrap();
        assert_eq!(res.transition, CaptureTransition::NoChange);
        assert_eq!(res.active_consumers, vec!["org.example.better-history"]);
        assert!(manager.is_active().unwrap());
    }

    #[test]
    fn test_unsubscribing_final_consumer_stops() {
        let manager = ClipboardCaptureManager::new();
        let perms = ExtensionPermissionRegistry::new();

        manager
            .subscribe("clipboard-history", &perms, true)
            .unwrap();

        let res = manager.unsubscribe("clipboard-history").unwrap();
        assert_eq!(res.transition, CaptureTransition::Stop);
        assert!(res.active_consumers.is_empty());
        assert!(!manager.is_active().unwrap());
    }

    #[test]
    fn test_duplicate_unsubscriber_idempotent() {
        let manager = ClipboardCaptureManager::new();
        let res = manager.unsubscribe("non-existent").unwrap();
        assert_eq!(res.transition, CaptureTransition::NoChange);
        assert!(res.active_consumers.is_empty());
    }

    #[test]
    fn test_cannot_unsubscribe_another_consumer() {
        let manager = ClipboardCaptureManager::new();
        let perms = make_registry_with("org.example.better-history", &[CAPTURE_PERMISSION]);

        manager
            .subscribe("clipboard-history", &perms, true)
            .unwrap();
        manager
            .subscribe("org.example.better-history", &perms, true)
            .unwrap();

        // Ext A unsubscribes itself; Ext B must remain untouched
        let res = manager.unsubscribe("org.example.better-history").unwrap();
        assert_eq!(res.transition, CaptureTransition::NoChange);
        assert_eq!(res.active_consumers, vec!["clipboard-history"]);
    }

    #[test]
    fn test_force_remove() {
        let manager = ClipboardCaptureManager::new();
        let perms = make_registry_with("org.example.better-history", &[CAPTURE_PERMISSION]);

        manager
            .subscribe("org.example.better-history", &perms, true)
            .unwrap();

        let res = manager.force_remove("org.example.better-history").unwrap();
        assert_eq!(res.transition, CaptureTransition::Stop);
        assert!(res.active_consumers.is_empty());
    }

    #[test]
    fn test_subscribe_checks_permission_rejects_missing() {
        let manager = ClipboardCaptureManager::new();
        let perms = make_registry_with("org.example.unauthorized", &[]); // no capture permission

        let err = manager
            .subscribe("org.example.unauthorized", &perms, true)
            .expect_err("missing permission must be rejected");
        match err {
            AppError::Permission(msg) => {
                assert!(msg.contains("clipboard-history:capture"));
            }
            other => panic!("expected AppError::Permission, got: {:?}", other),
        }
        assert!(!manager.is_active().unwrap());
    }

    #[test]
    fn test_subscribe_disabled_builtin_rejected() {
        let manager = ClipboardCaptureManager::new();
        let perms = ExtensionPermissionRegistry::new();

        let err = manager
            .subscribe("clipboard-history", &perms, false)
            .expect_err("disabled feature must be rejected");
        match err {
            AppError::Validation(msg) => {
                assert!(msg.contains("is disabled"));
            }
            other => panic!("expected AppError::Validation, got: {:?}", other),
        }
        assert!(!manager.is_active().unwrap());
    }

    #[test]
    fn test_concurrent_subscribe_unsubscribe_thread_safety() {
        let manager = Arc::new(ClipboardCaptureManager::new());
        let perms = Arc::new(make_registry_with("ext", &[CAPTURE_PERMISSION]));

        let mut handles = Vec::new();
        for i in 0..10 {
            let m = Arc::clone(&manager);
            let p = Arc::clone(&perms);
            handles.push(thread::spawn(move || {
                let id = format!("consumer-{}", i);
                // Register permission for this consumer in test
                {
                    let mut map = p.inner.lock().unwrap();
                    let mut set = HashSet::new();
                    set.insert(CAPTURE_PERMISSION.to_string());
                    map.insert(id.clone(), set);
                }
                let _ = m.subscribe(&id, &p, true);
                let _ = m.unsubscribe(&id);
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        // All threads joined and unsubscribed; manager must be clean and not deadlock
        assert_eq!(manager.get_consumers().unwrap().len(), 0);
        assert!(!manager.is_active().unwrap());
    }
}
