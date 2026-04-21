use super::types::*;
use std::collections::{HashMap, VecDeque};
use std::time::Instant;

pub type ExtensionId = String;

pub struct ContextMachine {
    states: HashMap<ExtensionId, LifecycleState>,
    mailboxes: HashMap<ExtensionId, VecDeque<PendingMessage>>,
    strike_history: HashMap<ExtensionId, VecDeque<Instant>>,
    config: ContextConfig,
    pub role: ContextRole,
    next_mount_token: u64,
}

impl ContextMachine {
    pub fn new(config: ContextConfig, role: ContextRole) -> Self {
        Self {
            states: HashMap::new(),
            mailboxes: HashMap::new(),
            strike_history: HashMap::new(),
            config,
            role,
            next_mount_token: 1,
        }
    }

    pub fn enqueue(
        &mut self,
        ext: &str,
        msg: PendingMessage,
        now: Instant,
    ) -> DispatchOutcome {
        let state = self.states.entry(ext.to_string()).or_default();
        match state {
            LifecycleState::Dormant => {
                let token = self.next_mount_token;
                self.next_mount_token += 1;
                *state = LifecycleState::Mounting {
                    since: now,
                    mount_token: token,
                };
                if !matches!(msg.kind, MessageKind::PredictiveWarm) {
                    self.mailboxes
                        .entry(ext.to_string())
                        .or_default()
                        .push_back(msg);
                }
                DispatchOutcome::NeedsMount { mount_token: token }
            }
            LifecycleState::Mounting { .. } => {
                if !matches!(msg.kind, MessageKind::PredictiveWarm) {
                    self.mailboxes
                        .entry(ext.to_string())
                        .or_default()
                        .push_back(msg);
                }
                DispatchOutcome::MountingWaitForReady
            }
            LifecycleState::Ready { last_activity, .. } => {
                *last_activity = now;
                if matches!(msg.kind, MessageKind::PredictiveWarm) {
                    return DispatchOutcome::ReadyDeliverNow { messages: vec![] };
                }
                let mut drained: Vec<PendingMessage> = self
                    .mailboxes
                    .remove(ext)
                    .map(|q| q.into_iter().collect())
                    .unwrap_or_default();
                drained.push(msg);
                DispatchOutcome::ReadyDeliverNow { messages: drained }
            }
            LifecycleState::Degraded {
                strikes,
                cooldown_until,
                ..
            } => {
                let strike_count = *strikes;
                let cooldown_expired = cooldown_until
                    .map(|until| now >= until)
                    .unwrap_or(true);

                if cooldown_expired {
                    let token = self.next_mount_token;
                    self.next_mount_token += 1;
                    self.strike_history.remove(ext);
                    *state = LifecycleState::Mounting {
                        since: now,
                        mount_token: token,
                    };
                    if !matches!(msg.kind, MessageKind::PredictiveWarm) {
                        self.mailboxes
                            .entry(ext.to_string())
                            .or_default()
                            .push_back(msg);
                    }
                    DispatchOutcome::NeedsMount { mount_token: token }
                } else {
                    DispatchOutcome::Degraded {
                        strikes: strike_count,
                    }
                }
            }
        }
    }

    pub fn tick(&mut self, now: Instant) -> TickActions {
        let mut actions = TickActions::default();
        let mount_timeout = self.config.mount_timeout;

        let mut idle_ids: Vec<String> = Vec::new();
        let mut timeout_ids: Vec<(String, u64)> = Vec::new();

        for (id, state) in self.states.iter() {
            match state {
                LifecycleState::Ready { last_activity, .. } => {
                    // Worker has keep_alive=None (never idle-evict); View has Some(d).
                    if let Some(ka) = self.config.keep_alive {
                        if now.saturating_duration_since(*last_activity) >= ka {
                            idle_ids.push(id.clone());
                        }
                    }
                }
                LifecycleState::Mounting { since, mount_token }
                    if now.saturating_duration_since(*since) >= mount_timeout =>
                {
                    timeout_ids.push((id.clone(), *mount_token));
                }
                _ => {}
            }
        }

        for id in &idle_ids {
            self.states.insert(id.clone(), LifecycleState::Dormant);
            self.mailboxes.remove(id);
        }
        actions.idle_unmounts = idle_ids;
        actions.timeouts = timeout_ids;
        actions
    }

    pub fn on_ready_ack(
        &mut self,
        ext: &str,
        mount_token: u64,
        now: Instant,
    ) -> Vec<PendingMessage> {
        let state = match self.states.get_mut(ext) {
            Some(s) => s,
            None => return vec![],
        };
        match state {
            LifecycleState::Mounting {
                mount_token: expected,
                ..
            } if *expected == mount_token => {
                let token = *expected;
                *state = LifecycleState::Ready {
                    last_activity: now,
                    mount_token: token,
                };
                self.mailboxes
                    .remove(ext)
                    .map(|q| q.into_iter().collect())
                    .unwrap_or_default()
            }
            _ => vec![],
        }
    }

    pub fn on_mount_timeout(
        &mut self,
        ext: &str,
        mount_token: u64,
        now: Instant,
    ) -> TimeoutOutcome {
        let mut out = TimeoutOutcome::default();

        let current_token = match self.states.get(ext) {
            Some(LifecycleState::Mounting { mount_token: t, .. }) => Some(*t),
            _ => None,
        };
        if current_token != Some(mount_token) {
            return out;
        }

        if let Some(mb) = self.mailboxes.remove(ext) {
            for m in mb {
                if m.source.is_user_facing() {
                    out.dropped_user_messages.push(m);
                } else {
                    out.dropped_background_messages.push(m);
                }
            }
        }

        let window = self.config.strike_window;
        let history = self.strike_history.entry(ext.to_string()).or_default();
        history.push_back(now);
        while let Some(&front) = history.front() {
            if now.saturating_duration_since(front) > window {
                history.pop_front();
            } else {
                break;
            }
        }
        let strike_count = history.len() as u32;
        out.new_strike_count = strike_count;

        if strike_count >= self.config.strike_threshold {
            out.transition_to_degraded = true;
            self.states.insert(
                ext.to_string(),
                LifecycleState::Degraded {
                    strikes: strike_count,
                    last_strike: now,
                    cooldown_until: Some(now + self.config.degraded_cooldown),
                },
            );
        } else {
            self.states.insert(ext.to_string(), LifecycleState::Dormant);
        }
        out
    }

    pub fn on_extension_removed(&mut self, ext: &str) -> bool {
        let had = self.states.remove(ext).is_some();
        self.mailboxes.remove(ext);
        self.strike_history.remove(ext);
        had
    }

    pub fn on_unmount_ack(&mut self, ext: &str) {
        if self.states.contains_key(ext) {
            self.states.insert(ext.to_string(), LifecycleState::Dormant);
            self.mailboxes.remove(ext);
        }
    }

    pub fn snapshot_entries(&self) -> Vec<ContextSnapshotEntry> {
        self.states
            .iter()
            .map(|(id, s)| {
                let name = match s {
                    LifecycleState::Dormant => "dormant",
                    LifecycleState::Mounting { .. } => "mounting",
                    LifecycleState::Ready { .. } => "ready",
                    LifecycleState::Degraded { .. } => "degraded",
                };
                ContextSnapshotEntry {
                    extension_id: id.clone(),
                    state: name.into(),
                    mailbox_len: self.mailboxes.get(id).map(|q| q.len()).unwrap_or(0),
                    role: self.role,
                }
            })
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn mailbox_len(&self, ext: &str) -> usize {
        self.mailboxes.get(ext).map(|q| q.len()).unwrap_or(0)
    }

    #[cfg(test)]
    pub(crate) fn state(&self, ext: &str) -> Option<&LifecycleState> {
        self.states.get(ext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn view_machine() -> ContextMachine {
        let cfg = ContextConfig {
            keep_alive: Some(Duration::from_secs(120)),
            mount_timeout: Duration::from_secs(3),
            strike_window: Duration::from_secs(300),
            strike_threshold: 3,
            degraded_cooldown: Duration::from_secs(3600),
            tick_interval: Duration::from_secs(1),
        };
        ContextMachine::new(cfg, ContextRole::View)
    }

    fn worker_machine() -> ContextMachine {
        let cfg = ContextConfig {
            keep_alive: None,
            mount_timeout: Duration::from_secs(3),
            strike_window: Duration::from_secs(300),
            strike_threshold: 3,
            degraded_cooldown: Duration::from_secs(3600),
            tick_interval: Duration::from_secs(1),
        };
        ContextMachine::new(cfg, ContextRole::Worker)
    }

    fn msg(kind: MessageKind, src: TriggerSource) -> PendingMessage {
        PendingMessage {
            kind,
            payload: serde_json::json!({}),
            enqueued_at: Instant::now(),
            source: src,
        }
    }

    #[test]
    fn enqueue_on_dormant_returns_needs_mount_and_queues_message() {
        let mut m = view_machine();
        let now = Instant::now();
        let outcome = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), now);
        assert!(matches!(outcome, DispatchOutcome::NeedsMount { .. }));
        assert_eq!(m.mailbox_len("ext.a"), 1);
        assert!(matches!(m.state("ext.a"), Some(LifecycleState::Mounting { .. })));
    }

    #[test]
    fn enqueue_predictive_warm_on_dormant_still_returns_needs_mount_but_empty_mailbox() {
        let mut m = view_machine();
        let now = Instant::now();
        let outcome = m.enqueue(
            "ext.a",
            msg(MessageKind::PredictiveWarm, TriggerSource::UserHighlight),
            now,
        );
        assert!(matches!(outcome, DispatchOutcome::NeedsMount { .. }));
        assert_eq!(m.mailbox_len("ext.a"), 0);
    }

    #[test]
    fn enqueue_on_mounting_appends_and_returns_mounting_wait() {
        let mut m = view_machine();
        let now = Instant::now();
        m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), now);
        let outcome = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Argument), now);
        assert!(matches!(outcome, DispatchOutcome::MountingWaitForReady));
        assert_eq!(m.mailbox_len("ext.a"), 2);
    }

    #[test]
    fn enqueue_predictive_warm_on_mounting_does_not_append() {
        let mut m = view_machine();
        let now = Instant::now();
        m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), now);
        let outcome = m.enqueue(
            "ext.a",
            msg(MessageKind::PredictiveWarm, TriggerSource::UserHighlight),
            now,
        );
        assert!(matches!(outcome, DispatchOutcome::MountingWaitForReady));
        assert_eq!(m.mailbox_len("ext.a"), 1);
    }

    #[test]
    fn on_ready_ack_with_matching_token_drains_and_transitions_to_ready() {
        let mut m = view_machine();
        let now = Instant::now();
        let outcome = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), now);
        let token = match outcome {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!("expected NeedsMount"),
        };
        let drained = m.on_ready_ack("ext.a", token, now);
        assert_eq!(drained.len(), 1);
        assert_eq!(m.mailbox_len("ext.a"), 0);
        assert!(matches!(m.state("ext.a"), Some(LifecycleState::Ready { .. })));
    }

    #[test]
    fn on_ready_ack_with_stale_token_is_rejected() {
        let mut m = view_machine();
        let now = Instant::now();
        m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), now);
        let drained = m.on_ready_ack("ext.a", 999, now);
        assert!(drained.is_empty());
        assert!(matches!(m.state("ext.a"), Some(LifecycleState::Mounting { .. })));
        assert_eq!(m.mailbox_len("ext.a"), 1);
    }

    #[test]
    fn enqueue_on_ready_returns_ready_deliver_now_with_single_message() {
        let mut m = view_machine();
        let now = Instant::now();
        let first = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), now);
        let token = match first {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        m.on_ready_ack("ext.a", token, now);
        let outcome = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Timer), now);
        match outcome {
            DispatchOutcome::ReadyDeliverNow { messages } => {
                assert_eq!(messages.len(), 1);
                assert_eq!(messages[0].source, TriggerSource::Timer);
            }
            other => panic!("expected ReadyDeliverNow, got {:?}", other),
        }
        assert_eq!(m.mailbox_len("ext.a"), 0);
    }

    #[test]
    fn enqueue_on_ready_bumps_last_activity() {
        let mut m = view_machine();
        let t0 = Instant::now();
        let outcome = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), t0);
        let token = match outcome {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        m.on_ready_ack("ext.a", token, t0);
        let t1 = t0 + Duration::from_secs(10);
        m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Timer), t1);
        match m.state("ext.a") {
            Some(LifecycleState::Ready { last_activity, .. }) => assert_eq!(*last_activity, t1),
            _ => panic!("expected Ready"),
        }
    }

    #[test]
    fn view_tick_unmounts_ready_after_keep_alive() {
        let mut m = view_machine();
        let t0 = Instant::now();
        let outcome = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), t0);
        let token = match outcome {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        m.on_ready_ack("ext.a", token, t0);
        let later = t0 + Duration::from_secs(121);
        let actions = m.tick(later);
        assert_eq!(actions.idle_unmounts, vec!["ext.a".to_string()]);
        assert!(matches!(m.state("ext.a"), Some(LifecycleState::Dormant)));
    }

    #[test]
    fn view_tick_does_not_unmount_within_keep_alive() {
        let mut m = view_machine();
        let t0 = Instant::now();
        let outcome = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), t0);
        let token = match outcome {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        m.on_ready_ack("ext.a", token, t0);
        let soon = t0 + Duration::from_secs(60);
        let actions = m.tick(soon);
        assert!(actions.idle_unmounts.is_empty());
        assert!(matches!(m.state("ext.a"), Some(LifecycleState::Ready { .. })));
    }

    #[test]
    fn worker_tick_never_idle_evicts_regardless_of_age() {
        let mut m = worker_machine();
        let t0 = Instant::now();
        let outcome = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), t0);
        let token = match outcome {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        m.on_ready_ack("ext.a", token, t0);
        // Simulate a very long idle period — far past any reasonable keep_alive
        let far_future = t0 + Duration::from_secs(86400);
        let actions = m.tick(far_future);
        assert!(
            actions.idle_unmounts.is_empty(),
            "worker machine must never idle-evict"
        );
        assert!(matches!(m.state("ext.a"), Some(LifecycleState::Ready { .. })));
    }

    #[test]
    fn on_mount_timeout_records_strike_drops_messages_returns_to_dormant() {
        let mut m = view_machine();
        let now = Instant::now();
        let outcome = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), now);
        let token = match outcome {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        let r = m.on_mount_timeout("ext.a", token, now);
        assert_eq!(r.dropped_user_messages.len(), 1);
        assert!(r.dropped_background_messages.is_empty());
        assert!(!r.transition_to_degraded);
        assert_eq!(r.new_strike_count, 1);
        assert!(matches!(m.state("ext.a"), Some(LifecycleState::Dormant)));
        assert_eq!(m.mailbox_len("ext.a"), 0);
    }

    #[test]
    fn three_timeouts_in_window_transition_to_degraded() {
        let mut m = view_machine();
        let now = Instant::now();
        for i in 0..3 {
            let outcome = m.enqueue(
                "ext.a",
                msg(MessageKind::Command, TriggerSource::Timer),
                now + Duration::from_secs(i as u64),
            );
            let token = match outcome {
                DispatchOutcome::NeedsMount { mount_token } => mount_token,
                DispatchOutcome::Degraded { .. } => break,
                other => panic!("unexpected outcome on attempt {i}: {other:?}"),
            };
            let r = m.on_mount_timeout(
                "ext.a",
                token,
                now + Duration::from_secs(i as u64 + 1),
            );
            if i == 2 {
                assert!(r.transition_to_degraded);
                assert_eq!(r.new_strike_count, 3);
            }
        }
        match m.state("ext.a") {
            Some(LifecycleState::Degraded { strikes, .. }) => assert_eq!(*strikes, 3),
            other => panic!("expected Degraded, got {other:?}"),
        }
    }

    #[test]
    fn strikes_outside_window_do_not_accumulate() {
        let mut m = view_machine();
        let t0 = Instant::now();
        let o1 = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), t0);
        let tok1 = match o1 {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        let r1 = m.on_mount_timeout("ext.a", tok1, t0);
        assert_eq!(r1.new_strike_count, 1);

        let t1 = t0 + Duration::from_secs(301);
        let o2 = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), t1);
        let tok2 = match o2 {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        let r2 = m.on_mount_timeout("ext.a", tok2, t1);
        assert_eq!(r2.new_strike_count, 1);
        assert!(!r2.transition_to_degraded);
    }

    #[test]
    fn enqueue_during_degraded_cooldown_returns_degraded_and_drops_message() {
        let mut m = view_machine();
        let t = Instant::now();
        for i in 0..3 {
            let o = m.enqueue(
                "ext.a",
                msg(MessageKind::Command, TriggerSource::Timer),
                t + Duration::from_secs(i),
            );
            if let DispatchOutcome::NeedsMount { mount_token } = o {
                m.on_mount_timeout("ext.a", mount_token, t + Duration::from_secs(i + 1));
            }
        }
        assert!(matches!(m.state("ext.a"), Some(LifecycleState::Degraded { .. })));
        let later = t + Duration::from_secs(60);
        let outcome = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), later);
        assert!(matches!(outcome, DispatchOutcome::Degraded { strikes: 3 }));
        assert_eq!(m.mailbox_len("ext.a"), 0);
    }

    #[test]
    fn enqueue_after_cooldown_elapses_retries_mount() {
        let mut m = view_machine();
        let t = Instant::now();
        for i in 0..3 {
            let o = m.enqueue(
                "ext.a",
                msg(MessageKind::Command, TriggerSource::Timer),
                t + Duration::from_secs(i),
            );
            if let DispatchOutcome::NeedsMount { mount_token } = o {
                m.on_mount_timeout("ext.a", mount_token, t + Duration::from_secs(i + 1));
            }
        }
        let far_future = t + Duration::from_secs(3604);
        let outcome = m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), far_future);
        assert!(matches!(outcome, DispatchOutcome::NeedsMount { .. }));
        assert!(matches!(m.state("ext.a"), Some(LifecycleState::Mounting { .. })));
    }

    #[test]
    fn on_extension_removed_clears_all_state_and_signals_unmount() {
        let mut m = view_machine();
        let now = Instant::now();
        m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), now);
        let emit_unmount = m.on_extension_removed("ext.a");
        assert!(emit_unmount);
        assert!(m.state("ext.a").is_none());
        assert_eq!(m.mailbox_len("ext.a"), 0);
    }

    #[test]
    fn on_extension_removed_on_unknown_id_is_noop() {
        let mut m = view_machine();
        let emit_unmount = m.on_extension_removed("missing");
        assert!(!emit_unmount);
    }

    #[test]
    fn on_unmount_ack_resets_to_dormant_for_known_id() {
        let mut m = view_machine();
        let now = Instant::now();
        m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Search), now);
        m.on_unmount_ack("ext.a");
        assert!(matches!(m.state("ext.a"), Some(LifecycleState::Dormant)));
    }

    #[test]
    fn snapshot_entries_include_role() {
        let mut m = worker_machine();
        let now = Instant::now();
        m.enqueue("ext.a", msg(MessageKind::Command, TriggerSource::Timer), now);
        let snap = m.snapshot_entries();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].role, ContextRole::Worker);
        assert_eq!(snap[0].state, "mounting");
    }
}
