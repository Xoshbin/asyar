use super::context::ContextMachine;
use super::types::*;
use std::sync::Mutex;
use std::time::Instant;

pub struct ExtensionRuntimeManager {
    pub worker: Mutex<ContextMachine>,
    pub view: Mutex<ContextMachine>,
}

impl ExtensionRuntimeManager {
    pub fn new(config: RuntimeConfig) -> Self {
        Self {
            worker: Mutex::new(ContextMachine::new(config.worker, ContextRole::Worker)),
            view: Mutex::new(ContextMachine::new(config.view, ContextRole::View)),
        }
    }

    pub fn enqueue_worker(&self, ext: &str, msg: PendingMessage, now: Instant) -> DispatchOutcome {
        self.worker.lock().unwrap().enqueue(ext, msg, now)
    }

    pub fn enqueue_view(&self, ext: &str, msg: PendingMessage, now: Instant) -> DispatchOutcome {
        self.view.lock().unwrap().enqueue(ext, msg, now)
    }

    pub fn on_ready_ack(
        &self,
        ext: &str,
        mount_token: u64,
        role: ContextRole,
        now: Instant,
    ) -> Vec<PendingMessage> {
        match role {
            ContextRole::Worker => self.worker.lock().unwrap().on_ready_ack(ext, mount_token, now),
            ContextRole::View => self.view.lock().unwrap().on_ready_ack(ext, mount_token, now),
        }
    }

    pub fn on_mount_timeout(
        &self,
        ext: &str,
        mount_token: u64,
        role: ContextRole,
        now: Instant,
    ) -> TimeoutOutcome {
        match role {
            ContextRole::Worker => self.worker.lock().unwrap().on_mount_timeout(ext, mount_token, now),
            ContextRole::View => self.view.lock().unwrap().on_mount_timeout(ext, mount_token, now),
        }
    }

    pub fn on_unmount_ack(&self, ext: &str, role: ContextRole) {
        match role {
            ContextRole::Worker => self.worker.lock().unwrap().on_unmount_ack(ext),
            ContextRole::View => self.view.lock().unwrap().on_unmount_ack(ext),
        }
    }

    /// Drives the worker context from Dormant → Mounting for `ext` if it is
    /// currently Dormant (or has no state). Idempotent: returns `None` if the
    /// worker is already Mounting, Ready, or Degraded (no emit needed).
    /// Returns `Some(mount_token)` when a fresh mount must be announced to the
    /// frontend.
    ///
    /// Always-on worker bootstrap: enabling an extension with `background.main`
    /// (or restoring state on launcher start) must make the worker iframe
    /// materialise before any command dispatch. The caller emits `EVENT_MOUNT`
    /// with role: worker using the returned token; subsequent dispatches still
    /// go through `enqueue_worker` and land in the mailbox while the mount
    /// finishes its ready handshake.
    pub fn ensure_worker_mounted(&self, ext: &str, now: Instant) -> Option<u64> {
        self.worker
            .lock()
            .unwrap()
            .transition_dormant_to_mounting(ext, now)
    }

    /// Removes an extension from both machines independently.
    /// Returns `(worker_had, view_had)` — `true` if that machine had active state.
    pub fn tear_down_both(&self, ext: &str) -> (bool, bool) {
        let worker_had = self.worker.lock().unwrap().on_extension_removed(ext);
        let view_had = self.view.lock().unwrap().on_extension_removed(ext);
        (worker_had, view_had)
    }

    /// Removes an extension from the worker machine only — leaves the view
    /// context untouched. Returns `true` if the worker had active state.
    /// Called by the dev-inspector's `force_remount_worker` command so a
    /// developer can bounce a worker iframe without disrupting a live view.
    pub fn tear_down_worker(&self, ext: &str) -> bool {
        self.worker.lock().unwrap().on_extension_removed(ext)
    }

    pub fn snapshot_entries(&self) -> Vec<ContextSnapshotEntry> {
        let mut entries = self.worker.lock().unwrap().snapshot_entries();
        entries.extend(self.view.lock().unwrap().snapshot_entries());
        entries
    }

    pub fn tick_worker(&self, now: Instant) -> TickActions {
        self.worker.lock().unwrap().tick(now)
    }

    pub fn tick_view(&self, now: Instant) -> TickActions {
        self.view.lock().unwrap().tick(now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn mgr() -> ExtensionRuntimeManager {
        ExtensionRuntimeManager::new(RuntimeConfig::default())
    }

    fn cmd_msg(src: TriggerSource) -> PendingMessage {
        PendingMessage {
            kind: MessageKind::Command,
            payload: serde_json::json!({}),
            enqueued_at: Instant::now(),
            source: src,
        }
    }

    // ── Role routing ───────────────────────────────────────────────────────────

    #[test]
    fn enqueue_view_and_worker_are_independent() {
        let mgr = mgr();
        let now = Instant::now();
        let vo = mgr.enqueue_view("ext.a", cmd_msg(TriggerSource::Search), now);
        let wo = mgr.enqueue_worker("ext.a", cmd_msg(TriggerSource::Timer), now);
        // Each machine has its own mount token sequence starting at 1
        assert!(matches!(vo, DispatchOutcome::NeedsMount { mount_token: 1 }));
        assert!(matches!(wo, DispatchOutcome::NeedsMount { mount_token: 1 }));
    }

    #[test]
    fn on_ready_ack_routes_to_correct_machine() {
        let mgr = mgr();
        let now = Instant::now();
        mgr.enqueue_view("ext.a", cmd_msg(TriggerSource::Search), now);
        mgr.enqueue_worker("ext.a", cmd_msg(TriggerSource::Timer), now);

        // ACK for view with token 1 drains view; worker stays Mounting
        let drained = mgr.on_ready_ack("ext.a", 1, ContextRole::View, now);
        assert_eq!(drained.len(), 1);

        // Worker is still Mounting (different machine)
        let worker_guard = mgr.worker.lock().unwrap();
        assert!(matches!(
            worker_guard.state("ext.a"),
            Some(LifecycleState::Mounting { .. })
        ));
    }

    // ── Worker never idle-evicts ───────────────────────────────────────────────

    #[test]
    fn worker_keep_alive_is_none() {
        let mgr = mgr();
        assert!(mgr.worker.lock().unwrap().role == ContextRole::Worker);
        // RuntimeConfig::default() sets worker.keep_alive = None
        let cfg = RuntimeConfig::default();
        assert!(cfg.worker.keep_alive.is_none());
    }

    #[test]
    fn view_keep_alive_is_120s() {
        let cfg = RuntimeConfig::default();
        assert_eq!(cfg.view.keep_alive, Some(Duration::from_secs(120)));
    }

    #[test]
    fn worker_ready_extension_never_idle_evicted_by_tick() {
        let mgr = mgr();
        let t0 = Instant::now();
        let wo = mgr.enqueue_worker("ext.a", cmd_msg(TriggerSource::Timer), t0);
        let token = match wo {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        mgr.on_ready_ack("ext.a", token, ContextRole::Worker, t0);

        // Tick far in the future
        let far = t0 + Duration::from_secs(86400);
        let actions = mgr.tick_worker(far);
        assert!(
            actions.idle_unmounts.is_empty(),
            "worker must never be idle-evicted"
        );
    }

    // ── Atomic teardown ────────────────────────────────────────────────────────

    #[test]
    fn tear_down_worker_leaves_view_alone() {
        let mgr = mgr();
        let now = Instant::now();
        mgr.enqueue_view("ext.a", cmd_msg(TriggerSource::Search), now);
        mgr.enqueue_worker("ext.a", cmd_msg(TriggerSource::Timer), now);

        let had = mgr.tear_down_worker("ext.a");
        assert!(had, "worker had state");
        assert!(
            mgr.worker.lock().unwrap().state("ext.a").is_none(),
            "worker torn down"
        );
        assert!(
            mgr.view.lock().unwrap().state("ext.a").is_some(),
            "view left intact — dev-inspector remount must not disrupt live view"
        );
    }

    #[test]
    fn tear_down_worker_on_extension_without_worker_state_returns_false() {
        let mgr = mgr();
        let had = mgr.tear_down_worker("ext.ghost");
        assert!(!had);
    }

    #[test]
    fn tear_down_both_removes_from_both_machines() {
        let mgr = mgr();
        let now = Instant::now();
        mgr.enqueue_view("ext.a", cmd_msg(TriggerSource::Search), now);
        mgr.enqueue_worker("ext.a", cmd_msg(TriggerSource::Timer), now);

        let (w, v) = mgr.tear_down_both("ext.a");
        assert!(w, "worker had state");
        assert!(v, "view had state");

        // Both machines should now have no state for ext.a
        assert!(mgr.worker.lock().unwrap().state("ext.a").is_none());
        assert!(mgr.view.lock().unwrap().state("ext.a").is_none());
    }

    #[test]
    fn tear_down_both_on_unknown_extension_returns_false_false() {
        let mgr = mgr();
        let (w, v) = mgr.tear_down_both("missing");
        assert!(!w);
        assert!(!v);
    }

    #[test]
    fn tear_down_both_partial_state_only_reports_machines_that_had_it() {
        let mgr = mgr();
        let now = Instant::now();
        // Only enqueue to view, not worker
        mgr.enqueue_view("ext.a", cmd_msg(TriggerSource::Search), now);

        let (w, v) = mgr.tear_down_both("ext.a");
        assert!(!w, "worker had no state");
        assert!(v, "view had state");
    }

    // ── Snapshot ──────────────────────────────────────────────────────────────

    #[test]
    fn snapshot_entries_includes_both_roles() {
        let mgr = mgr();
        let now = Instant::now();
        mgr.enqueue_view("ext.a", cmd_msg(TriggerSource::Search), now);
        mgr.enqueue_worker("ext.b", cmd_msg(TriggerSource::Timer), now);

        let snap = mgr.snapshot_entries();
        assert_eq!(snap.len(), 2);
        let roles: std::collections::HashSet<_> = snap.iter().map(|e| e.role).collect();
        assert!(roles.contains(&ContextRole::Worker));
        assert!(roles.contains(&ContextRole::View));
    }

    // ── Dormant-worker mailbox ────────────────────────────────────────────────

    #[test]
    fn worker_queues_message_while_dormant_and_holds_in_mailbox_until_ready_ack() {
        let mgr = mgr();
        let now = Instant::now();
        let outcome = mgr.enqueue_worker("ext.a", cmd_msg(TriggerSource::Timer), now);
        assert!(
            matches!(outcome, DispatchOutcome::NeedsMount { .. }),
            "worker should start mounting even with no iframe present"
        );
        // Message is held in mailbox
        let worker_guard = mgr.worker.lock().unwrap();
        assert_eq!(worker_guard.mailbox_len("ext.a"), 1);
    }

    // ── View keep_alive eviction integration ──────────────────────────────────

    #[test]
    fn view_tick_evicts_after_120s() {
        let mgr = mgr();
        let t0 = Instant::now();
        let vo = mgr.enqueue_view("ext.a", cmd_msg(TriggerSource::Search), t0);
        let token = match vo {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        mgr.on_ready_ack("ext.a", token, ContextRole::View, t0);

        // Just under keep_alive: no eviction
        let actions = mgr.tick_view(t0 + Duration::from_secs(119));
        assert!(actions.idle_unmounts.is_empty());

        // At keep_alive: evicted
        let actions = mgr.tick_view(t0 + Duration::from_secs(120));
        assert_eq!(actions.idle_unmounts, vec!["ext.a".to_string()]);
    }

    // ── Role roundtrip in snapshot ────────────────────────────────────────────

    #[test]
    fn snapshot_role_field_serializes_as_camel_case() {
        let mgr = mgr();
        let now = Instant::now();
        mgr.enqueue_worker("ext.a", cmd_msg(TriggerSource::Timer), now);
        let snap = mgr.snapshot_entries();
        let entry = snap.iter().find(|e| e.extension_id == "ext.a").unwrap();
        let json = serde_json::to_value(entry).unwrap();
        assert_eq!(json["role"], "worker");
    }

    // ── ensure_worker_mounted (always-on worker auto-mount) ────────────────────

    #[test]
    fn ensure_worker_mounted_transitions_worker_not_view_and_is_idempotent() {
        let mgr = mgr();
        let now = Instant::now();

        // First call: worker is Dormant (no state yet) → Mounting, returns Some(token).
        let token = mgr
            .ensure_worker_mounted("ext.a", now)
            .expect("dormant worker must transition and yield a token");

        // Worker machine is now Mounting with that token; view machine untouched.
        {
            let w = mgr.worker.lock().unwrap();
            assert!(matches!(
                w.state("ext.a"),
                Some(LifecycleState::Mounting { mount_token, .. }) if *mount_token == token
            ));
            // Pure transition: no message enqueued in the worker mailbox.
            assert_eq!(w.mailbox_len("ext.a"), 0);
        }
        {
            let v = mgr.view.lock().unwrap();
            assert!(
                v.state("ext.a").is_none(),
                "view machine must not be touched by worker auto-mount"
            );
        }

        // Second call: worker is already Mounting → None (no duplicate emit needed).
        assert!(
            mgr.ensure_worker_mounted("ext.a", now).is_none(),
            "idempotent: second call while Mounting must return None"
        );
    }
}
