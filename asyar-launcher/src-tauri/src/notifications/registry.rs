//! Pending-notification-action registry.
//!
//! When an extension sends a notification with `actions`, the launcher must
//! remember which extension/command/args each button corresponds to so the
//! OS-level action click (which only carries `notification_id` + `action_id`)
//! can be translated back into a command dispatch.
//!
//! Entries are purged on:
//!
//! - explicit dismiss (`remove`)
//! - TTL expiry (`purge_expired`, default 24 h — prevents indefinite growth
//!   if the OS drops a notification without telling us)
//! - extension uninstall / disable (`remove_all_for_extension`)
//!
//! All state is behind a single `Mutex`, mirroring the ExtensionTrayManager
//! convention so lock semantics are uniform across host subsystems.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Command target stored against a (notification_id, action_id) pair. Built
/// directly from what the extension passed to `send()`; nothing else is
/// retained so sensitive payloads don't linger past their usefulness.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingAction {
    pub extension_id: String,
    pub command_id: String,
    /// Serialised JSON object (never raw strings / arrays) so downstream
    /// dispatch can forward it as `args` to `handleCommandAction`.
    pub args_json: Option<String>,
}

/// Default TTL after which un-clicked/un-dismissed entries are purged.
pub const DEFAULT_TTL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug)]
struct Entry {
    action: PendingAction,
    inserted_at: Instant,
}

pub struct NotificationActionRegistry {
    entries: Mutex<HashMap<(String, String), Entry>>,
}

impl Default for NotificationActionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl NotificationActionRegistry {
    pub fn new() -> Self {
        Self { entries: Mutex::new(HashMap::new()) }
    }

    /// Store the actions for a freshly-sent notification. Overwrites any
    /// pre-existing entries under the same `notification_id` — consistent
    /// with "send replaces" semantics on every OS.
    pub fn insert_many<I>(&self, notification_id: &str, actions: I)
    where
        I: IntoIterator<Item = (String, PendingAction)>,
    {
        self.insert_many_at(notification_id, actions, Instant::now());
    }

    /// Test seam: same as `insert_many` but lets the caller pin the
    /// insertion timestamp so TTL assertions stay deterministic.
    pub fn insert_many_at<I>(&self, notification_id: &str, actions: I, now: Instant)
    where
        I: IntoIterator<Item = (String, PendingAction)>,
    {
        let mut guard = self.entries.lock().expect("registry mutex poisoned");
        guard.retain(|(nid, _), _| nid != notification_id);
        for (action_id, action) in actions {
            guard.insert(
                (notification_id.to_string(), action_id),
                Entry { action, inserted_at: now },
            );
        }
    }

    /// Look up an individual action. Returns `None` if the notification or
    /// its action has been purged.
    pub fn lookup(&self, notification_id: &str, action_id: &str) -> Option<PendingAction> {
        let guard = self.entries.lock().expect("registry mutex poisoned");
        guard
            .get(&(notification_id.to_string(), action_id.to_string()))
            .map(|e| e.action.clone())
    }

    /// Drop every action stored under `notification_id`. Returns the number
    /// of entries removed.
    pub fn remove(&self, notification_id: &str) -> usize {
        let mut guard = self.entries.lock().expect("registry mutex poisoned");
        let before = guard.len();
        guard.retain(|(nid, _), _| nid != notification_id);
        before - guard.len()
    }

    /// Drop every action owned by `extension_id`. Called on extension
    /// uninstall/disable so stale clicks don't fire into nothing.
    pub fn remove_all_for_extension(&self, extension_id: &str) -> usize {
        let mut guard = self.entries.lock().expect("registry mutex poisoned");
        let before = guard.len();
        guard.retain(|_, e| e.action.extension_id != extension_id);
        before - guard.len()
    }

    /// Drop entries whose insertion time is older than `ttl` relative to
    /// `now`. Called on a timer + at backend startup.
    pub fn purge_expired(&self, now: Instant, ttl: Duration) -> usize {
        let mut guard = self.entries.lock().expect("registry mutex poisoned");
        let before = guard.len();
        guard.retain(|_, e| now.duration_since(e.inserted_at) < ttl);
        before - guard.len()
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.lock().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn act(ext: &str, cmd: &str) -> PendingAction {
        PendingAction {
            extension_id: ext.to_string(),
            command_id: cmd.to_string(),
            args_json: None,
        }
    }

    #[test]
    fn insert_and_lookup_roundtrip() {
        let r = NotificationActionRegistry::new();
        r.insert_many(
            "notif-1",
            vec![
                ("extend".to_string(), act("coffee", "coffee.extend")),
                ("stop".to_string(), act("coffee", "coffee.stop")),
            ],
        );
        assert_eq!(r.lookup("notif-1", "extend"), Some(act("coffee", "coffee.extend")));
        assert_eq!(r.lookup("notif-1", "stop"), Some(act("coffee", "coffee.stop")));
    }

    #[test]
    fn insert_preserves_args_json() {
        let r = NotificationActionRegistry::new();
        r.insert_many(
            "n",
            vec![(
                "a".to_string(),
                PendingAction {
                    extension_id: "ext".to_string(),
                    command_id: "c".to_string(),
                    args_json: Some(r#"{"minutes":30}"#.to_string()),
                },
            )],
        );
        assert_eq!(
            r.lookup("n", "a").unwrap().args_json.as_deref(),
            Some(r#"{"minutes":30}"#),
        );
    }

    #[test]
    fn lookup_unknown_ids_returns_none() {
        let r = NotificationActionRegistry::new();
        r.insert_many("n", vec![("a".to_string(), act("ext", "cmd"))]);
        assert_eq!(r.lookup("other", "a"), None);
        assert_eq!(r.lookup("n", "other"), None);
        assert_eq!(r.lookup("", ""), None);
    }

    #[test]
    fn re_inserting_same_notification_replaces_actions() {
        let r = NotificationActionRegistry::new();
        r.insert_many("n", vec![("old".to_string(), act("ext", "cmd"))]);
        r.insert_many("n", vec![("new".to_string(), act("ext", "cmd"))]);
        assert!(r.lookup("n", "old").is_none());
        assert!(r.lookup("n", "new").is_some());
    }

    #[test]
    fn remove_drops_all_actions_for_notification() {
        let r = NotificationActionRegistry::new();
        r.insert_many(
            "n",
            vec![
                ("a".to_string(), act("ext", "c1")),
                ("b".to_string(), act("ext", "c2")),
            ],
        );
        r.insert_many("m", vec![("a".to_string(), act("ext", "c1"))]);

        let removed = r.remove("n");

        assert_eq!(removed, 2);
        assert!(r.lookup("n", "a").is_none());
        assert!(r.lookup("n", "b").is_none());
        assert!(r.lookup("m", "a").is_some());
    }

    #[test]
    fn remove_unknown_notification_is_noop() {
        let r = NotificationActionRegistry::new();
        r.insert_many("n", vec![("a".to_string(), act("ext", "c"))]);
        assert_eq!(r.remove("ghost"), 0);
        assert!(r.lookup("n", "a").is_some());
    }

    #[test]
    fn remove_all_for_extension_drops_only_its_entries() {
        let r = NotificationActionRegistry::new();
        r.insert_many(
            "n1",
            vec![
                ("a".to_string(), act("alpha", "x")),
                ("b".to_string(), act("beta", "y")),
            ],
        );
        r.insert_many("n2", vec![("a".to_string(), act("alpha", "z"))]);

        let removed = r.remove_all_for_extension("alpha");

        assert_eq!(removed, 2);
        assert!(r.lookup("n1", "a").is_none());
        assert!(r.lookup("n2", "a").is_none());
        assert!(r.lookup("n1", "b").is_some());
    }

    #[test]
    fn purge_expired_removes_entries_older_than_ttl() {
        let r = NotificationActionRegistry::new();
        let past = Instant::now();
        r.insert_many_at("n", vec![("a".to_string(), act("ext", "c"))], past);

        let removed = r.purge_expired(past + Duration::from_secs(3600), Duration::from_secs(1800));

        assert_eq!(removed, 1);
        assert!(r.lookup("n", "a").is_none());
    }

    #[test]
    fn purge_expired_keeps_fresh_entries() {
        let r = NotificationActionRegistry::new();
        let past = Instant::now();
        r.insert_many_at("n", vec![("a".to_string(), act("ext", "c"))], past);

        let removed = r.purge_expired(past + Duration::from_secs(60), Duration::from_secs(1800));

        assert_eq!(removed, 0);
        assert!(r.lookup("n", "a").is_some());
    }

    #[test]
    fn purge_expired_on_empty_registry() {
        let r = NotificationActionRegistry::new();
        assert_eq!(r.purge_expired(Instant::now(), Duration::from_secs(1)), 0);
        assert_eq!(r.len(), 0);
    }

    #[test]
    fn default_ttl_matches_24_hours() {
        assert_eq!(DEFAULT_TTL, Duration::from_secs(86_400));
    }
}
