//! Application presence events service.
//!
//! Push-event layer on top of the query-only `ApplicationService`:
//!
//! - `launched`          — a GUI application process appeared
//! - `terminated`        — a GUI application process went away
//! - `frontmost-changed` — the OS focus/frontmost app changed
//!
//! The subscription/unsubscribe/fanout logic is shared with `system_events`
//! via [`crate::event_hub::EventHub`] — this module only owns the concrete
//! event enum and the per-platform watcher/presence-query wiring.
//!
//! Raycast has no equivalent push-event surface on the built-in app
//! service; exposing this is a deliberate capability difference.

use crate::error::AppError;
use crate::event_hub::{EventHub, HubEvent};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[cfg(target_os = "macos")]
pub mod macos;
pub mod linux;
pub mod windows;

/// Discriminant used on the wire (kebab-case) and as registry keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum AppEventKind {
    Launched,
    Terminated,
    FrontmostChanged,
}

impl AppEventKind {
    pub fn from_wire(s: &str) -> Option<Self> {
        match s {
            "launched" => Some(Self::Launched),
            "terminated" => Some(Self::Terminated),
            "frontmost-changed" => Some(Self::FrontmostChanged),
            _ => None,
        }
    }
}

/// Event payload delivered to subscribers. `type` is the kebab-case wire
/// discriminant; the remaining fields are camelCase.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum AppEvent {
    #[serde(rename_all = "camelCase")]
    Launched {
        pid: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        bundle_id: Option<String>,
        name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Terminated {
        pid: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        bundle_id: Option<String>,
        name: String,
    },
    #[serde(rename_all = "camelCase")]
    FrontmostChanged {
        pid: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        bundle_id: Option<String>,
        name: String,
    },
}

impl AppEvent {
    pub fn kind(&self) -> AppEventKind {
        match self {
            Self::Launched { .. } => AppEventKind::Launched,
            Self::Terminated { .. } => AppEventKind::Terminated,
            Self::FrontmostChanged { .. } => AppEventKind::FrontmostChanged,
        }
    }
}

impl HubEvent for AppEvent {
    type Kind = AppEventKind;
    fn kind(&self) -> Self::Kind {
        AppEvent::kind(self)
    }
}

pub type AppEventsHub = EventHub<AppEvent>;

/// Platform watcher contract. Matches [`crate::system_events::SystemEventsWatcher`]
/// by shape — one `start(hub)` hook invoked once at `setup_app` time.
pub trait AppEventsWatcher: Send + Sync {
    fn start(&self, hub: Arc<AppEventsHub>) -> Result<(), AppError>;
}

#[cfg(target_os = "macos")]
pub fn default_watcher() -> Box<dyn AppEventsWatcher> {
    Box::new(macos::MacAppWatcher::new())
}
#[cfg(target_os = "linux")]
pub fn default_watcher() -> Box<dyn AppEventsWatcher> {
    Box::new(linux::LinuxAppWatcher::new())
}
#[cfg(target_os = "windows")]
pub fn default_watcher() -> Box<dyn AppEventsWatcher> {
    Box::new(windows::WindowsAppWatcher::new())
}
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub fn default_watcher() -> Box<dyn AppEventsWatcher> {
    Box::new(fake::NoopWatcher)
}

/// Synchronous "is this bundle-id running right now?" query. Implemented
/// per-platform; a fake is available for unit tests.
pub trait AppPresenceQuery: Send + Sync {
    fn is_running(&self, bundle_id: &str) -> bool;
}

#[cfg(target_os = "macos")]
pub fn default_presence_query() -> Box<dyn AppPresenceQuery> {
    Box::new(macos::MacPresenceQuery)
}
#[cfg(target_os = "linux")]
pub fn default_presence_query() -> Box<dyn AppPresenceQuery> {
    Box::new(linux::LinuxPresenceQuery)
}
#[cfg(target_os = "windows")]
pub fn default_presence_query() -> Box<dyn AppPresenceQuery> {
    Box::new(windows::WindowsPresenceQuery)
}
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
pub fn default_presence_query() -> Box<dyn AppPresenceQuery> {
    Box::new(fake::FakePresenceQuery::default())
}

pub mod fake {
    use super::*;
    use std::collections::HashSet;
    use std::sync::Mutex;

    /// Re-export of the generic recording emitter, specialized to
    /// [`AppEvent`].
    pub type RecordingEmitter = crate::event_hub::fake::RecordingEmitter<AppEvent>;

    pub struct NoopWatcher;
    impl AppEventsWatcher for NoopWatcher {
        fn start(&self, _hub: Arc<AppEventsHub>) -> Result<(), AppError> {
            Ok(())
        }
    }

    /// Configurable fake for `AppPresenceQuery`. Use to drive
    /// command-layer tests without hitting the OS.
    #[derive(Default)]
    pub struct FakePresenceQuery {
        running: Mutex<HashSet<String>>,
    }

    impl FakePresenceQuery {
        pub fn with_running<I, S>(bundles: I) -> Self
        where
            I: IntoIterator<Item = S>,
            S: Into<String>,
        {
            let set: HashSet<String> = bundles.into_iter().map(Into::into).collect();
            Self {
                running: Mutex::new(set),
            }
        }
    }

    impl AppPresenceQuery for FakePresenceQuery {
        fn is_running(&self, bundle_id: &str) -> bool {
            self.running
                .lock()
                .map(|s| s.contains(bundle_id))
                .unwrap_or(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_from_wire_roundtrips_for_all_variants() {
        for (wire, kind) in [
            ("launched", AppEventKind::Launched),
            ("terminated", AppEventKind::Terminated),
            ("frontmost-changed", AppEventKind::FrontmostChanged),
        ] {
            assert_eq!(AppEventKind::from_wire(wire), Some(kind), "wire: {wire}");
        }
        assert_eq!(AppEventKind::from_wire("bogus"), None);
    }

    #[test]
    fn app_event_kind_extracts_variant_discriminant() {
        let ev = AppEvent::Launched {
            pid: 42,
            bundle_id: None,
            name: "App".into(),
            path: None,
        };
        assert_eq!(ev.kind(), AppEventKind::Launched);

        let ev = AppEvent::Terminated {
            pid: 42,
            bundle_id: None,
            name: "App".into(),
        };
        assert_eq!(ev.kind(), AppEventKind::Terminated);

        let ev = AppEvent::FrontmostChanged {
            pid: 42,
            bundle_id: None,
            name: "App".into(),
        };
        assert_eq!(ev.kind(), AppEventKind::FrontmostChanged);
    }

    #[test]
    fn wire_format_serializes_launched_with_camelcase_fields() {
        let ev = AppEvent::Launched {
            pid: 1234,
            bundle_id: Some("com.apple.Safari".into()),
            name: "Safari".into(),
            path: Some("/Applications/Safari.app".into()),
        };
        let json = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["type"], "launched");
        assert_eq!(json["pid"], 1234);
        assert_eq!(json["bundleId"], "com.apple.Safari");
        assert_eq!(json["name"], "Safari");
        assert_eq!(json["path"], "/Applications/Safari.app");
    }

    #[test]
    fn wire_format_skips_optional_fields_when_none() {
        let ev = AppEvent::Terminated {
            pid: 9,
            bundle_id: None,
            name: "Nameless".into(),
        };
        let json = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["type"], "terminated");
        assert_eq!(json["pid"], 9);
        assert_eq!(json["name"], "Nameless");
        assert!(
            json.get("bundleId").is_none(),
            "bundleId should be skipped when None, got {json:?}"
        );
    }

    #[test]
    fn wire_format_frontmost_changed_has_kebab_case_type() {
        let ev = AppEvent::FrontmostChanged {
            pid: 7,
            bundle_id: Some("com.example.foo".into()),
            name: "Foo".into(),
        };
        let json = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["type"], "frontmost-changed");
        assert_eq!(json["bundleId"], "com.example.foo");
    }

    #[test]
    fn hub_dispatches_launched_to_subscribed_extension() {
        use crate::event_hub::fake::RecordingEmitter;
        use std::collections::HashSet;

        let hub: AppEventsHub = AppEventsHub::new();
        let rec: RecordingEmitter<AppEvent> = RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        let mut want = HashSet::new();
        want.insert(AppEventKind::Launched);
        hub.subscribe("ext-a", want).unwrap();

        hub.dispatch(AppEvent::Launched {
            pid: 1,
            bundle_id: Some("com.example".into()),
            name: "Ex".into(),
            path: None,
        });

        let snap = rec.snapshot();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].0, "ext-a");
        assert!(matches!(snap[0].1, AppEvent::Launched { pid: 1, .. }));
    }

    #[test]
    fn fake_presence_query_reports_membership() {
        let q = fake::FakePresenceQuery::with_running(["com.a", "com.b"]);
        assert!(q.is_running("com.a"));
        assert!(q.is_running("com.b"));
        assert!(!q.is_running("com.c"));
    }
}
