//! System events service.
//!
//! Platform watchers emit events into the shared
//! [`crate::event_hub::EventHub`], which owns the per-extension
//! subscription registry and fans out events as one Tauri
//! `asyar:system-event` emit per subscribed extension (deduped — same
//! extension subscribing twice gets one emit per dispatch).
//!
//! Subscription tracking is source-of-truth in Rust. TypeScript is pure
//! dispatch — it listens to the Tauri event and forwards the payload to the
//! matching iframe.
//!
//! The subscribe/unsubscribe/dispatch/fanout logic lives in
//! [`crate::event_hub`]; this module only owns the concrete event enum and
//! the platform watcher trait.

use crate::error::AppError;
use crate::event_hub::{EventHub, HubEvent};
use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
pub mod macos;
pub mod linux;
pub mod windows;

/// Discriminant used on the wire (kebab-case) and as registry keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum SystemEventKind {
    Sleep,
    Wake,
    LidOpen,
    LidClose,
    BatteryLevelChanged,
    PowerSourceChanged,
}

impl SystemEventKind {
    pub fn from_wire(s: &str) -> Option<Self> {
        match s {
            "sleep" => Some(Self::Sleep),
            "wake" => Some(Self::Wake),
            "lid-open" => Some(Self::LidOpen),
            "lid-close" => Some(Self::LidClose),
            "battery-level-changed" => Some(Self::BatteryLevelChanged),
            "power-source-changed" => Some(Self::PowerSourceChanged),
            _ => None,
        }
    }
}

/// Payload shape emitted to TS. `type` discriminant matches the kebab-case
/// wire form; extra fields vary per variant.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SystemEvent {
    Sleep,
    Wake,
    LidOpen,
    LidClose,
    #[serde(rename_all = "camelCase")]
    BatteryLevelChanged { percent: u8 },
    #[serde(rename_all = "camelCase")]
    PowerSourceChanged { on_battery: bool },
}

impl SystemEvent {
    pub fn kind(&self) -> SystemEventKind {
        match self {
            Self::Sleep => SystemEventKind::Sleep,
            Self::Wake => SystemEventKind::Wake,
            Self::LidOpen => SystemEventKind::LidOpen,
            Self::LidClose => SystemEventKind::LidClose,
            Self::BatteryLevelChanged { .. } => SystemEventKind::BatteryLevelChanged,
            Self::PowerSourceChanged { .. } => SystemEventKind::PowerSourceChanged,
        }
    }
}

impl HubEvent for SystemEvent {
    type Kind = SystemEventKind;
    fn kind(&self) -> Self::Kind {
        SystemEvent::kind(self)
    }
}

/// Concrete hub type alias. Resolves to [`EventHub<SystemEvent>`].
pub type SystemEventsHub = EventHub<SystemEvent>;

/// Platform watcher contract. Each backend implements `start` and dispatches
/// events to the hub via `hub.dispatch(event)`. Watchers live for the app
/// lifetime — there is no `stop`.
pub trait SystemEventsWatcher: Send + Sync {
    fn start(&self, hub: std::sync::Arc<SystemEventsHub>) -> Result<(), AppError>;
}

#[cfg(target_os = "macos")]
pub fn default_watcher() -> Box<dyn SystemEventsWatcher> {
    Box::new(macos::MacWatcher::new())
}
#[cfg(target_os = "linux")]
pub fn default_watcher() -> Box<dyn SystemEventsWatcher> {
    Box::new(linux::LinuxWatcher::new())
}
#[cfg(target_os = "windows")]
pub fn default_watcher() -> Box<dyn SystemEventsWatcher> {
    Box::new(windows::WindowsWatcher::new())
}
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub fn default_watcher() -> Box<dyn SystemEventsWatcher> {
    Box::new(fake::NoopWatcher)
}

pub mod fake {
    use super::*;
    use std::sync::Arc;

    /// Re-export of the generic recording emitter, specialized to
    /// [`SystemEvent`] for ergonomics in existing tests.
    pub type RecordingEmitter = crate::event_hub::fake::RecordingEmitter<SystemEvent>;

    pub struct NoopWatcher;
    impl SystemEventsWatcher for NoopWatcher {
        fn start(&self, _hub: Arc<SystemEventsHub>) -> Result<(), AppError> {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::RecordingEmitter;
    use super::*;
    use std::collections::HashSet;

    fn kinds(ks: &[SystemEventKind]) -> HashSet<SystemEventKind> {
        ks.iter().copied().collect()
    }

    #[test]
    fn subscribe_returns_uuid_and_records_subscription() {
        let hub = SystemEventsHub::new();
        let id = hub
            .subscribe("ext-a", kinds(&[SystemEventKind::Wake]))
            .unwrap();
        assert!(uuid::Uuid::parse_str(&id).is_ok());
        assert_eq!(hub.active_subscription_count(), 1);
    }

    #[test]
    fn unsubscribe_by_owner_removes_entry() {
        let hub = SystemEventsHub::new();
        let id = hub
            .subscribe("ext-a", kinds(&[SystemEventKind::Wake]))
            .unwrap();
        hub.unsubscribe("ext-a", &id).unwrap();
        assert_eq!(hub.active_subscription_count(), 0);
    }

    #[test]
    fn unsubscribe_by_non_owner_is_permission_error() {
        let hub = SystemEventsHub::new();
        let id = hub
            .subscribe("ext-a", kinds(&[SystemEventKind::Wake]))
            .unwrap();
        let err = hub.unsubscribe("ext-b", &id).unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
        assert_eq!(
            hub.active_subscription_count(),
            1,
            "sub should NOT be removed when caller is not owner"
        );
    }

    #[test]
    fn unsubscribe_unknown_id_is_not_found() {
        let hub = SystemEventsHub::new();
        let err = hub.unsubscribe("ext-a", "bogus").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }

    #[test]
    fn remove_all_for_extension_drops_only_that_extensions_subs() {
        let hub = SystemEventsHub::new();
        let _a1 = hub
            .subscribe("ext-a", kinds(&[SystemEventKind::Wake]))
            .unwrap();
        let _a2 = hub
            .subscribe("ext-a", kinds(&[SystemEventKind::Sleep]))
            .unwrap();
        let _b1 = hub
            .subscribe("ext-b", kinds(&[SystemEventKind::Wake]))
            .unwrap();
        let dropped = hub.remove_all_for_extension("ext-a").unwrap();
        assert_eq!(dropped, 2);
        assert_eq!(hub.active_subscription_count(), 1);
    }

    #[test]
    fn dispatch_emits_to_matching_extension_only() {
        let hub = SystemEventsHub::new();
        let rec = RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        hub.subscribe("ext-wake", kinds(&[SystemEventKind::Wake]))
            .unwrap();
        hub.subscribe("ext-sleep", kinds(&[SystemEventKind::Sleep]))
            .unwrap();

        hub.dispatch(SystemEvent::Wake);

        let snap = rec.snapshot();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].0, "ext-wake");
        assert!(matches!(snap[0].1, SystemEvent::Wake));
    }

    #[test]
    fn dispatch_dedupes_same_extension_across_multiple_subs() {
        let hub = SystemEventsHub::new();
        let rec = RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        hub.subscribe("ext-a", kinds(&[SystemEventKind::Wake]))
            .unwrap();
        hub.subscribe(
            "ext-a",
            kinds(&[SystemEventKind::Wake, SystemEventKind::Sleep]),
        )
        .unwrap();

        hub.dispatch(SystemEvent::Wake);

        let snap = rec.snapshot();
        assert_eq!(
            snap.len(),
            1,
            "duplicate subs from same extension must emit once"
        );
    }

    #[test]
    fn dispatch_with_no_matching_subs_emits_nothing() {
        let hub = SystemEventsHub::new();
        let rec = RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        hub.subscribe("ext-a", kinds(&[SystemEventKind::Sleep]))
            .unwrap();

        hub.dispatch(SystemEvent::Wake);

        assert!(rec.snapshot().is_empty());
    }

    #[test]
    fn dispatch_battery_payload_includes_percent() {
        let hub = SystemEventsHub::new();
        let rec = RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        hub.subscribe("ext-a", kinds(&[SystemEventKind::BatteryLevelChanged]))
            .unwrap();

        hub.dispatch(SystemEvent::BatteryLevelChanged { percent: 42 });

        let snap = rec.snapshot();
        assert_eq!(snap.len(), 1);
        assert!(matches!(
            snap[0].1,
            SystemEvent::BatteryLevelChanged { percent: 42 }
        ));
    }

    #[test]
    fn dispatch_power_source_payload_includes_on_battery() {
        let hub = SystemEventsHub::new();
        let rec = RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        hub.subscribe("ext-a", kinds(&[SystemEventKind::PowerSourceChanged]))
            .unwrap();

        hub.dispatch(SystemEvent::PowerSourceChanged { on_battery: true });

        let snap = rec.snapshot();
        assert_eq!(snap.len(), 1);
        assert!(matches!(
            snap[0].1,
            SystemEvent::PowerSourceChanged { on_battery: true }
        ));
    }

    #[test]
    fn kind_from_wire_roundtrips_for_all_variants() {
        for (wire, kind) in [
            ("sleep", SystemEventKind::Sleep),
            ("wake", SystemEventKind::Wake),
            ("lid-open", SystemEventKind::LidOpen),
            ("lid-close", SystemEventKind::LidClose),
            ("battery-level-changed", SystemEventKind::BatteryLevelChanged),
            ("power-source-changed", SystemEventKind::PowerSourceChanged),
        ] {
            assert_eq!(
                SystemEventKind::from_wire(wire),
                Some(kind),
                "wire: {wire}"
            );
        }
        assert_eq!(SystemEventKind::from_wire("bogus"), None);
    }

    #[test]
    fn wire_format_serializes_to_kebab_case() {
        // Ensures the SystemEvent JSON matches the SDK's expected type union.
        let ev = SystemEvent::BatteryLevelChanged { percent: 42 };
        let json = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["type"], "battery-level-changed");
        assert_eq!(json["percent"], 42);

        let ev2 = SystemEvent::PowerSourceChanged { on_battery: true };
        let json2 = serde_json::to_value(&ev2).unwrap();
        assert_eq!(json2["type"], "power-source-changed");
        assert_eq!(json2["onBattery"], true);

        let ev3 = SystemEvent::LidOpen;
        let json3 = serde_json::to_value(&ev3).unwrap();
        assert_eq!(json3["type"], "lid-open");
    }
}
