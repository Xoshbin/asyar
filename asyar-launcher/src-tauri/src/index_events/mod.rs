//! Application-index push-event service.
//!
//! Fires when the on-disk set of installed applications changes — either
//! because the user installed/uninstalled an app in a watched default
//! directory (`/Applications`, `/System/Applications`, `~/Applications`
//! equivalents) or because they edited a user-configured scan directory
//! in `settings.search.additionalScanPaths`.
//!
//! Structurally identical to [`crate::app_events`]: a single event enum,
//! a single `Kind` discriminant, and a [`crate::event_hub::EventHub`]
//! alias that supplies subscribe / unsubscribe / dispatch. The concrete
//! watcher lives in `crate::application::index_watcher` and dispatches
//! through this hub after every debounced rescan.
//!
//! Wire contract:
//!
//! - Tauri event name: `asyar:application-index`
//! - Iframe push type: `asyar:event:application-index:push`
//! - SDK namespace:    `applicationIndex:subscribe` / `:unsubscribe`
//! - Required permission: `application:read` (same data class as
//!   `listApplications`; no new permission string)

use crate::event_hub::{EventHub, HubEvent};
use serde::{Deserialize, Serialize};

/// Discriminant used on the wire (kebab-case) and as registry keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum IndexEventKind {
    /// The set of indexed applications changed (added, removed, or both).
    ApplicationsChanged,
}

impl IndexEventKind {
    pub fn from_wire(s: &str) -> Option<Self> {
        match s {
            "applications-changed" => Some(Self::ApplicationsChanged),
            _ => None,
        }
    }
}

/// Event payload delivered to subscribers. `type` is the kebab-case wire
/// discriminant; the remaining fields are camelCase and mirror the
/// [`crate::application::service::SyncResult`] shape so existing UI code
/// can consume either without adapter logic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum IndexEvent {
    #[serde(rename_all = "camelCase")]
    ApplicationsChanged {
        added: u32,
        removed: u32,
        total: u32,
    },
}

impl IndexEvent {
    pub fn kind(&self) -> IndexEventKind {
        match self {
            Self::ApplicationsChanged { .. } => IndexEventKind::ApplicationsChanged,
        }
    }
}

impl HubEvent for IndexEvent {
    type Kind = IndexEventKind;
    fn kind(&self) -> Self::Kind {
        IndexEvent::kind(self)
    }
}

pub type IndexEventsHub = EventHub<IndexEvent>;

pub mod fake {
    /// Re-export of the generic recording emitter, specialized to
    /// [`super::IndexEvent`]. Use in watcher / command tests to assert the
    /// hub fanned out correctly.
    pub type RecordingEmitter = crate::event_hub::fake::RecordingEmitter<super::IndexEvent>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn kind_from_wire_roundtrips_for_applications_changed() {
        assert_eq!(
            IndexEventKind::from_wire("applications-changed"),
            Some(IndexEventKind::ApplicationsChanged),
        );
    }

    #[test]
    fn kind_from_wire_rejects_unknown() {
        assert_eq!(IndexEventKind::from_wire("bogus"), None);
        // Non-matching-but-close cases must not bleed through.
        assert_eq!(IndexEventKind::from_wire("applications_changed"), None);
        assert_eq!(IndexEventKind::from_wire("ApplicationsChanged"), None);
        assert_eq!(IndexEventKind::from_wire(""), None);
    }

    #[test]
    fn event_kind_extracts_variant_discriminant() {
        let ev = IndexEvent::ApplicationsChanged {
            added: 1,
            removed: 0,
            total: 42,
        };
        assert_eq!(ev.kind(), IndexEventKind::ApplicationsChanged);
    }

    #[test]
    fn wire_format_serializes_with_kebab_type_and_camel_fields() {
        let ev = IndexEvent::ApplicationsChanged {
            added: 3,
            removed: 1,
            total: 128,
        };
        let json = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["type"], "applications-changed");
        assert_eq!(json["added"], 3);
        assert_eq!(json["removed"], 1);
        assert_eq!(json["total"], 128);
    }

    #[test]
    fn hub_dispatches_applications_changed_to_subscribed_extension() {
        let hub: IndexEventsHub = IndexEventsHub::new();
        let rec = fake::RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());

        let mut want = HashSet::new();
        want.insert(IndexEventKind::ApplicationsChanged);
        hub.subscribe("ext-a", want).unwrap();

        hub.dispatch(IndexEvent::ApplicationsChanged {
            added: 2,
            removed: 0,
            total: 10,
        });

        let snap = rec.snapshot();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].0, "ext-a");
        assert_eq!(
            snap[0].1,
            IndexEvent::ApplicationsChanged {
                added: 2,
                removed: 0,
                total: 10,
            }
        );
    }
}
