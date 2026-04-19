//! Tier 2 extension iframe lifecycle state machine.
//! See docs/superpowers/specs/2026-04-19-tier2-command-delivery-design.md

pub mod types;

pub use types::*;

use std::collections::{HashMap, VecDeque};
use std::time::Instant;

pub type ExtensionId = String;

pub struct IframeLifecycle {
    states: HashMap<ExtensionId, IframeState>,
    mailboxes: HashMap<ExtensionId, VecDeque<PendingMessage>>,
    strike_history: HashMap<ExtensionId, VecDeque<Instant>>,
    config: LifecycleConfig,
    next_mount_token: u64,
}

impl IframeLifecycle {
    pub fn new(config: LifecycleConfig) -> Self {
        Self {
            states: HashMap::new(),
            mailboxes: HashMap::new(),
            strike_history: HashMap::new(),
            config,
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
            IframeState::Dormant => {
                let token = self.next_mount_token;
                self.next_mount_token += 1;
                *state = IframeState::Mounting {
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
            IframeState::Mounting { .. } => {
                if !matches!(msg.kind, MessageKind::PredictiveWarm) {
                    self.mailboxes
                        .entry(ext.to_string())
                        .or_default()
                        .push_back(msg);
                }
                DispatchOutcome::MountingWaitForReady
            }
            IframeState::Ready {
                last_activity,
                ..
            } => {
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
            IframeState::Degraded {
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
                    *state = IframeState::Mounting {
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
        let keep_alive = self.config.keep_alive;
        let mount_timeout = self.config.mount_timeout;

        let mut idle_ids: Vec<String> = Vec::new();
        let mut timeout_ids: Vec<(String, u64)> = Vec::new();

        for (id, state) in self.states.iter() {
            match state {
                IframeState::Ready { last_activity, .. } => {
                    if now.saturating_duration_since(*last_activity) >= keep_alive {
                        idle_ids.push(id.clone());
                    }
                }
                IframeState::Mounting { since, mount_token } => {
                    if now.saturating_duration_since(*since) >= mount_timeout {
                        timeout_ids.push((id.clone(), *mount_token));
                    }
                }
                _ => {}
            }
        }

        for id in &idle_ids {
            self.states.insert(id.clone(), IframeState::Dormant);
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
            IframeState::Mounting {
                mount_token: expected,
                ..
            } if *expected == mount_token => {
                let token = *expected;
                *state = IframeState::Ready {
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
            Some(IframeState::Mounting { mount_token: t, .. }) => Some(*t),
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
                IframeState::Degraded {
                    strikes: strike_count,
                    last_strike: now,
                    cooldown_until: Some(now + self.config.degraded_cooldown),
                },
            );
        } else {
            self.states.insert(ext.to_string(), IframeState::Dormant);
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
            self.states.insert(ext.to_string(), IframeState::Dormant);
            self.mailboxes.remove(ext);
        }
    }

    #[cfg(test)]
    pub(crate) fn mailbox_len(&self, ext: &str) -> usize {
        self.mailboxes.get(ext).map(|q| q.len()).unwrap_or(0)
    }

    #[cfg(test)]
    pub(crate) fn state(&self, ext: &str) -> Option<&IframeState> {
        self.states.get(ext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn default_lifecycle_config_matches_pinned_budgets() {
        let cfg = LifecycleConfig::default();
        assert_eq!(cfg.keep_alive.as_secs(), 420); // 7 min
        assert_eq!(cfg.mount_timeout.as_secs(), 3);
        assert_eq!(cfg.strike_window.as_secs(), 300);
        assert_eq!(cfg.strike_threshold, 3);
        assert_eq!(cfg.degraded_cooldown.as_secs(), 3600);
        assert_eq!(cfg.tick_interval.as_secs(), 1);
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
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let now = Instant::now();
        let outcome = lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            now,
        );
        assert!(matches!(outcome, DispatchOutcome::NeedsMount { .. }));
        assert_eq!(lc.mailbox_len("ext.a"), 1);
        assert!(matches!(lc.state("ext.a"), Some(IframeState::Mounting { .. })));
    }

    #[test]
    fn enqueue_predictive_warm_on_dormant_still_returns_needs_mount_but_empty_mailbox() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let now = Instant::now();
        let outcome = lc.enqueue(
            "ext.a",
            msg(MessageKind::PredictiveWarm, TriggerSource::UserHighlight),
            now,
        );
        assert!(matches!(outcome, DispatchOutcome::NeedsMount { .. }));
        assert_eq!(lc.mailbox_len("ext.a"), 0);
    }

    #[test]
    fn enqueue_on_mounting_appends_and_returns_mounting_wait() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let now = Instant::now();
        lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            now,
        );
        let outcome = lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Argument),
            now,
        );
        assert!(matches!(outcome, DispatchOutcome::MountingWaitForReady));
        assert_eq!(lc.mailbox_len("ext.a"), 2);
    }

    #[test]
    fn enqueue_predictive_warm_on_mounting_does_not_append() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let now = Instant::now();
        lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            now,
        );
        let outcome = lc.enqueue(
            "ext.a",
            msg(MessageKind::PredictiveWarm, TriggerSource::UserHighlight),
            now,
        );
        assert!(matches!(outcome, DispatchOutcome::MountingWaitForReady));
        assert_eq!(lc.mailbox_len("ext.a"), 1);
    }

    #[test]
    fn on_ready_ack_with_matching_token_drains_and_transitions_to_ready() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let now = Instant::now();
        let outcome = lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            now,
        );
        let token = match outcome {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!("expected NeedsMount"),
        };

        let drained = lc.on_ready_ack("ext.a", token, now);
        assert_eq!(drained.len(), 1);
        assert_eq!(lc.mailbox_len("ext.a"), 0);
        assert!(matches!(lc.state("ext.a"), Some(IframeState::Ready { .. })));
    }

    #[test]
    fn on_ready_ack_with_stale_token_is_rejected() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let now = Instant::now();
        lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            now,
        );
        let drained = lc.on_ready_ack("ext.a", 999, now);
        assert!(drained.is_empty());
        assert!(matches!(lc.state("ext.a"), Some(IframeState::Mounting { .. })));
        assert_eq!(lc.mailbox_len("ext.a"), 1);
    }

    #[test]
    fn enqueue_on_ready_returns_ready_deliver_now_with_single_message() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let now = Instant::now();
        let first = lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            now,
        );
        let token = match first {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        lc.on_ready_ack("ext.a", token, now);

        let outcome = lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Timer),
            now,
        );
        match outcome {
            DispatchOutcome::ReadyDeliverNow { messages } => {
                assert_eq!(messages.len(), 1);
                assert_eq!(messages[0].source, TriggerSource::Timer);
            }
            other => panic!("expected ReadyDeliverNow, got {:?}", other),
        }
        assert_eq!(lc.mailbox_len("ext.a"), 0);
    }

    #[test]
    fn enqueue_on_ready_bumps_last_activity() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let t0 = Instant::now();
        let outcome = lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            t0,
        );
        let token = match outcome {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        lc.on_ready_ack("ext.a", token, t0);

        let t1 = t0 + std::time::Duration::from_secs(10);
        lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Timer),
            t1,
        );
        match lc.state("ext.a") {
            Some(IframeState::Ready { last_activity, .. }) => assert_eq!(*last_activity, t1),
            _ => panic!("expected Ready"),
        }
    }

    #[test]
    fn tick_unmounts_ready_iframes_older_than_keep_alive() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let t0 = Instant::now();
        let outcome = lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            t0,
        );
        let token = match outcome {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        lc.on_ready_ack("ext.a", token, t0);

        let later = t0 + std::time::Duration::from_secs(480);
        let actions = lc.tick(later);
        assert_eq!(actions.idle_unmounts, vec!["ext.a".to_string()]);
        assert!(matches!(lc.state("ext.a"), Some(IframeState::Dormant)));
    }

    #[test]
    fn tick_does_not_unmount_ready_within_keep_alive() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let t0 = Instant::now();
        let outcome = lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            t0,
        );
        let token = match outcome {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        lc.on_ready_ack("ext.a", token, t0);

        let soon = t0 + std::time::Duration::from_secs(60);
        let actions = lc.tick(soon);
        assert!(actions.idle_unmounts.is_empty());
        assert!(matches!(lc.state("ext.a"), Some(IframeState::Ready { .. })));
    }

    #[test]
    fn on_mount_timeout_records_strike_drops_messages_returns_to_dormant() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let now = Instant::now();
        let outcome = lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            now,
        );
        let token = match outcome {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        let r = lc.on_mount_timeout("ext.a", token, now);
        assert_eq!(r.dropped_user_messages.len(), 1);
        assert!(r.dropped_background_messages.is_empty());
        assert!(!r.transition_to_degraded);
        assert_eq!(r.new_strike_count, 1);
        assert!(matches!(lc.state("ext.a"), Some(IframeState::Dormant)));
        assert_eq!(lc.mailbox_len("ext.a"), 0);
    }

    #[test]
    fn three_timeouts_in_window_transition_to_degraded() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let now = Instant::now();

        for i in 0..3 {
            let outcome = lc.enqueue(
                "ext.a",
                msg(MessageKind::Command, TriggerSource::Timer),
                now + std::time::Duration::from_secs(i as u64),
            );
            let token = match outcome {
                DispatchOutcome::NeedsMount { mount_token } => mount_token,
                DispatchOutcome::Degraded { .. } => break,
                other => panic!("unexpected outcome on attempt {i}: {other:?}"),
            };
            let r = lc.on_mount_timeout(
                "ext.a",
                token,
                now + std::time::Duration::from_secs(i as u64 + 1),
            );
            if i == 2 {
                assert!(r.transition_to_degraded);
                assert_eq!(r.new_strike_count, 3);
            }
        }
        match lc.state("ext.a") {
            Some(IframeState::Degraded { strikes, .. }) => assert_eq!(*strikes, 3),
            other => panic!("expected Degraded, got {other:?}"),
        }
    }

    #[test]
    fn strikes_outside_window_do_not_accumulate() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let t0 = Instant::now();

        let o1 = lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            t0,
        );
        let tok1 = match o1 {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        let r1 = lc.on_mount_timeout("ext.a", tok1, t0);
        assert_eq!(r1.new_strike_count, 1);

        let t1 = t0 + std::time::Duration::from_secs(301);
        let o2 = lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            t1,
        );
        let tok2 = match o2 {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        let r2 = lc.on_mount_timeout("ext.a", tok2, t1);
        assert_eq!(r2.new_strike_count, 1);
        assert!(!r2.transition_to_degraded);
    }

    #[test]
    fn enqueue_during_degraded_cooldown_returns_degraded_and_drops_message() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let t = Instant::now();
        for i in 0..3 {
            let o = lc.enqueue(
                "ext.a",
                msg(MessageKind::Command, TriggerSource::Timer),
                t + std::time::Duration::from_secs(i),
            );
            if let DispatchOutcome::NeedsMount { mount_token } = o {
                lc.on_mount_timeout(
                    "ext.a",
                    mount_token,
                    t + std::time::Duration::from_secs(i + 1),
                );
            }
        }
        assert!(matches!(lc.state("ext.a"), Some(IframeState::Degraded { .. })));

        let later = t + std::time::Duration::from_secs(60);
        let outcome = lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            later,
        );
        assert!(matches!(outcome, DispatchOutcome::Degraded { strikes: 3 }));
        assert_eq!(lc.mailbox_len("ext.a"), 0);
    }

    #[test]
    fn enqueue_after_cooldown_elapses_retries_mount() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let t = Instant::now();
        for i in 0..3 {
            let o = lc.enqueue(
                "ext.a",
                msg(MessageKind::Command, TriggerSource::Timer),
                t + std::time::Duration::from_secs(i),
            );
            if let DispatchOutcome::NeedsMount { mount_token } = o {
                lc.on_mount_timeout(
                    "ext.a",
                    mount_token,
                    t + std::time::Duration::from_secs(i + 1),
                );
            }
        }

        let far_future = t + std::time::Duration::from_secs(3604);
        let outcome = lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            far_future,
        );
        assert!(matches!(outcome, DispatchOutcome::NeedsMount { .. }));
        assert!(matches!(lc.state("ext.a"), Some(IframeState::Mounting { .. })));
    }

    #[test]
    fn on_extension_removed_clears_all_state_and_signals_unmount() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let now = Instant::now();
        lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            now,
        );
        let emit_unmount = lc.on_extension_removed("ext.a");
        assert!(emit_unmount);
        assert!(lc.state("ext.a").is_none());
        assert_eq!(lc.mailbox_len("ext.a"), 0);
    }

    #[test]
    fn on_extension_removed_on_unknown_id_is_noop() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let emit_unmount = lc.on_extension_removed("missing");
        assert!(!emit_unmount);
    }

    #[test]
    fn on_unmount_ack_resets_to_dormant_for_known_id() {
        let mut lc = IframeLifecycle::new(LifecycleConfig::default());
        let now = Instant::now();
        lc.enqueue(
            "ext.a",
            msg(MessageKind::Command, TriggerSource::Search),
            now,
        );
        lc.on_unmount_ack("ext.a");
        assert!(matches!(lc.state("ext.a"), Some(IframeState::Dormant)));
    }
}

#[cfg(test)]
mod proptests;
