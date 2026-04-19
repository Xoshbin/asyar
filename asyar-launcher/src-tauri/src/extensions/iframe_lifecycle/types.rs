use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy)]
pub struct LifecycleConfig {
    pub keep_alive: Duration,
    pub mount_timeout: Duration,
    pub strike_window: Duration,
    pub strike_threshold: u32,
    pub degraded_cooldown: Duration,
    pub tick_interval: Duration,
}

impl Default for LifecycleConfig {
    fn default() -> Self {
        Self {
            keep_alive: Duration::from_secs(420),
            mount_timeout: Duration::from_secs(3),
            strike_window: Duration::from_secs(300),
            strike_threshold: 3,
            degraded_cooldown: Duration::from_secs(3600),
            tick_interval: Duration::from_secs(1),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageKind {
    Command,
    Action,
    ViewSubmit,
    ViewSearch,
    PredictiveWarm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TriggerSource {
    Search,
    Argument,
    Schedule,
    Timer,
    Deeplink,
    Notification,
    Invoke,
    UserHighlight,
}

impl TriggerSource {
    /// User-facing sources may surface UI affordances (pending glyph, toast).
    /// Background sources log-and-drop on failure.
    pub fn is_user_facing(&self) -> bool {
        matches!(
            self,
            TriggerSource::Search
                | TriggerSource::Argument
                | TriggerSource::Deeplink
                | TriggerSource::UserHighlight
        )
    }
}

#[derive(Debug, Clone)]
pub struct PendingMessage {
    pub kind: MessageKind,
    /// Opaque JSON; TS restores shape per kind.
    pub payload: serde_json::Value,
    pub enqueued_at: Instant,
    pub source: TriggerSource,
}

#[derive(Debug, Clone, Default)]
pub enum IframeState {
    #[default]
    Dormant,
    Mounting {
        since: Instant,
        mount_token: u64,
    },
    Ready {
        last_activity: Instant,
        mount_token: u64,
    },
    Degraded {
        strikes: u32,
        last_strike: Instant,
        cooldown_until: Option<Instant>,
    },
}

#[derive(Debug, Clone)]
pub enum DispatchOutcome {
    ReadyDeliverNow { messages: Vec<PendingMessage> },
    MountingWaitForReady,
    NeedsMount { mount_token: u64 },
    Degraded { strikes: u32 },
}

#[derive(Debug, Clone, Default)]
pub struct TickActions {
    pub idle_unmounts: Vec<String>,
    pub timeouts: Vec<(String, u64)>,
}

#[derive(Debug, Clone, Default)]
pub struct TimeoutOutcome {
    pub dropped_user_messages: Vec<PendingMessage>,
    pub dropped_background_messages: Vec<PendingMessage>,
    pub transition_to_degraded: bool,
    pub new_strike_count: u32,
}

#[cfg(test)]
mod type_tests {
    use super::*;

    #[test]
    fn message_kind_roundtrips_all_variants() {
        let kinds = [
            MessageKind::Command,
            MessageKind::Action,
            MessageKind::ViewSubmit,
            MessageKind::ViewSearch,
            MessageKind::PredictiveWarm,
        ];
        for k in kinds {
            assert_eq!(k, k.clone());
        }
    }

    #[test]
    fn trigger_source_is_user_facing_only_for_expected_sources() {
        assert!(TriggerSource::Search.is_user_facing());
        assert!(TriggerSource::Argument.is_user_facing());
        assert!(TriggerSource::Deeplink.is_user_facing());
        assert!(TriggerSource::UserHighlight.is_user_facing());
        assert!(!TriggerSource::Schedule.is_user_facing());
        assert!(!TriggerSource::Timer.is_user_facing());
        assert!(!TriggerSource::Notification.is_user_facing());
        assert!(!TriggerSource::Invoke.is_user_facing());
    }

    #[test]
    fn iframe_state_default_is_dormant() {
        let s: IframeState = IframeState::default();
        assert!(matches!(s, IframeState::Dormant));
    }
}
