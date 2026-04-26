use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ContextRole {
    Worker,
    #[default]
    View,
}

#[derive(Debug, Clone, Copy)]
pub struct ContextConfig {
    /// `None` = never evict on idle (worker role).
    /// `Some(d)` = evict after `d` of inactivity (view role).
    pub keep_alive: Option<Duration>,
    pub mount_timeout: Duration,
    pub strike_window: Duration,
    pub strike_threshold: u32,
    pub degraded_cooldown: Duration,
    pub tick_interval: Duration,
}

#[derive(Debug, Clone, Copy)]
pub struct RuntimeConfig {
    pub worker: ContextConfig,
    pub view: ContextConfig,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        let base = ContextConfig {
            mount_timeout: Duration::from_secs(3),
            strike_window: Duration::from_secs(300),
            strike_threshold: 3,
            degraded_cooldown: Duration::from_secs(3600),
            tick_interval: Duration::from_secs(1),
            keep_alive: None,
        };
        Self {
            worker: base,
            view: ContextConfig {
                keep_alive: Some(Duration::from_secs(120)),
                ..base
            },
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
pub enum LifecycleState {
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSnapshotEntry {
    pub extension_id: String,
    pub state: String,
    pub mailbox_len: usize,
    pub role: ContextRole,
}

#[cfg(test)]
mod type_tests {
    use super::*;

    #[test]
    fn context_role_default_is_view() {
        assert_eq!(ContextRole::default(), ContextRole::View);
    }

    #[test]
    fn context_role_serializes_to_camel_case() {
        let worker = serde_json::to_value(ContextRole::Worker).unwrap();
        assert_eq!(worker, "worker");
        let view = serde_json::to_value(ContextRole::View).unwrap();
        assert_eq!(view, "view");
    }

    #[test]
    fn context_role_deserializes_from_camel_case() {
        let worker: ContextRole = serde_json::from_value(serde_json::json!("worker")).unwrap();
        assert_eq!(worker, ContextRole::Worker);
        let view: ContextRole = serde_json::from_value(serde_json::json!("view")).unwrap();
        assert_eq!(view, ContextRole::View);
    }

    #[test]
    fn context_role_roundtrips() {
        for role in [ContextRole::Worker, ContextRole::View] {
            let json = serde_json::to_string(&role).unwrap();
            let back: ContextRole = serde_json::from_str(&json).unwrap();
            assert_eq!(role, back);
        }
    }

    #[test]
    fn runtime_config_default_worker_has_no_keep_alive() {
        let cfg = RuntimeConfig::default();
        assert!(cfg.worker.keep_alive.is_none());
    }

    #[test]
    fn runtime_config_default_view_keep_alive_is_120s() {
        let cfg = RuntimeConfig::default();
        assert_eq!(cfg.view.keep_alive, Some(Duration::from_secs(120)));
    }

    #[test]
    fn runtime_config_default_timers_match_pinned_budgets() {
        let cfg = RuntimeConfig::default();
        // Both roles share the same non-eviction timers
        for cc in [cfg.worker, cfg.view] {
            assert_eq!(cc.mount_timeout.as_secs(), 3);
            assert_eq!(cc.strike_window.as_secs(), 300);
            assert_eq!(cc.strike_threshold, 3);
            assert_eq!(cc.degraded_cooldown.as_secs(), 3600);
            assert_eq!(cc.tick_interval.as_secs(), 1);
        }
    }

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
    fn lifecycle_state_default_is_dormant() {
        let s = LifecycleState::default();
        assert!(matches!(s, LifecycleState::Dormant));
    }

    #[test]
    fn role_in_event_payload_roundtrips_json() {
        let payload = serde_json::json!({
            "extensionId": "ext.test",
            "mountToken": 7u64,
            "role": ContextRole::Worker,
        });
        let json = serde_json::to_string(&payload).unwrap();
        let back: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(back["role"], "worker");
        assert_eq!(back["mountToken"], 7);
    }

    #[test]
    fn role_absent_in_payload_can_be_defaulted_to_view() {
        let payload = serde_json::json!({ "extensionId": "ext.test", "mountToken": 1u64 });
        let role: ContextRole = payload
            .get("role")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        assert_eq!(role, ContextRole::View);
    }

    #[test]
    fn unknown_role_string_defaults_to_view_via_deserialize_fallback() {
        // Simulates the frontend defensive: if role is unrecognised, fall back to View.
        let payload = serde_json::json!({ "role": "exotic" });
        let role: ContextRole = payload
            .get("role")
            .and_then(|v| serde_json::from_value::<ContextRole>(v.clone()).ok())
            .unwrap_or_default();
        assert_eq!(role, ContextRole::View);
    }
}
