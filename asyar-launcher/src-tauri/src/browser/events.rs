use crate::browser::types::{BrowserKey, Tab};
use crate::event_hub::{EventHub, HubEvent};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BrowserEventKind {
    TabsChanged,
}

impl BrowserEventKind {
    /// Parse a wire-format kind string from the SDK / Tauri command boundary.
    /// Accepts the kebab-case discriminant (`"tabs-changed"`), the dotted form
    /// (`"tabs.changed"`) used by the SDK proxy's `event_types` payload, and
    /// the camelCase alias (`"tabsChanged"`) for permissiveness — same shape
    /// `SystemEventKind::from_wire` uses.
    pub fn from_wire(s: &str) -> Option<Self> {
        match s {
            "tabs.changed" | "tabs-changed" | "tabsChanged" => Some(Self::TabsChanged),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum BrowserEvent {
    #[serde(rename_all = "camelCase")]
    TabsChanged {
        browser: BrowserKey,
        tabs: Vec<Tab>,
    },
}

impl HubEvent for BrowserEvent {
    type Kind = BrowserEventKind;

    fn kind(&self) -> Self::Kind {
        match self {
            Self::TabsChanged { .. } => BrowserEventKind::TabsChanged,
        }
    }
}

/// Concrete hub type alias. Resolves to [`EventHub<BrowserEvent>`].
pub type BrowserEventsHub = EventHub<BrowserEvent>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::types::{BrowserFamily, BrowserId};
    use crate::event_hub::fake::RecordingEmitter;
    use std::collections::HashSet;

    fn fake_tab() -> Tab {
        Tab {
            id: "1".to_string(),
            browser: BrowserId {
                family: BrowserFamily::Chromium,
                variant: "chrome".to_string(),
                profile_id: "Default".to_string(),
            },
            window_id: "w".to_string(),
            index: 0,
            title: "T".to_string(),
            url: "U".to_string(),
            favicon_url: None,
            is_active: true,
            is_pinned: false,
            is_audible: false,
            group_name: None,
        }
    }

    fn chromium_chrome() -> BrowserKey {
        BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        }
    }

    #[test]
    fn tabs_changed_event_reports_its_kind() {
        let event = BrowserEvent::TabsChanged {
            browser: chromium_chrome(),
            tabs: vec![fake_tab()],
        };
        assert_eq!(event.kind(), BrowserEventKind::TabsChanged);
    }

    #[test]
    fn hub_dispatches_to_subscribed_extension() {
        let hub = BrowserEventsHub::new();
        let rec: RecordingEmitter<BrowserEvent> = RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());

        let mut kinds = HashSet::new();
        kinds.insert(BrowserEventKind::TabsChanged);
        let _sub_id = hub.subscribe("ext-a", kinds).unwrap();

        hub.dispatch(BrowserEvent::TabsChanged {
            browser: chromium_chrome(),
            tabs: vec![fake_tab()],
        });

        let snap = rec.snapshot();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].0, "ext-a");
        assert!(matches!(snap[0].1, BrowserEvent::TabsChanged { .. }));
    }

    #[test]
    fn hub_does_not_dispatch_to_unsubscribed_extension() {
        let hub = BrowserEventsHub::new();
        let rec: RecordingEmitter<BrowserEvent> = RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());
        // No subscribers.

        hub.dispatch(BrowserEvent::TabsChanged {
            browser: chromium_chrome(),
            tabs: vec![],
        });

        assert!(rec.snapshot().is_empty());
    }

    #[test]
    fn unsubscribe_stops_dispatch() {
        let hub = BrowserEventsHub::new();
        let rec: RecordingEmitter<BrowserEvent> = RecordingEmitter::new();
        hub.set_emitter(rec.clone().into_emit_fn());

        let mut kinds = HashSet::new();
        kinds.insert(BrowserEventKind::TabsChanged);
        let sub_id = hub.subscribe("ext-a", kinds).unwrap();
        hub.unsubscribe("ext-a", &sub_id).unwrap();

        hub.dispatch(BrowserEvent::TabsChanged {
            browser: chromium_chrome(),
            tabs: vec![],
        });

        assert!(rec.snapshot().is_empty());
    }

    #[test]
    fn kind_from_wire_parses_known_strings_and_rejects_others() {
        assert_eq!(
            BrowserEventKind::from_wire("tabs.changed"),
            Some(BrowserEventKind::TabsChanged)
        );
        assert_eq!(
            BrowserEventKind::from_wire("tabs-changed"),
            Some(BrowserEventKind::TabsChanged)
        );
        assert_eq!(
            BrowserEventKind::from_wire("tabsChanged"),
            Some(BrowserEventKind::TabsChanged)
        );
        assert_eq!(BrowserEventKind::from_wire("bogus"), None);
    }

    #[test]
    fn wire_format_serializes_to_kebab_case_with_camel_fields() {
        let ev = BrowserEvent::TabsChanged {
            browser: chromium_chrome(),
            tabs: vec![],
        };
        let json = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["type"], "tabs-changed");
        // Field renames inside the variant must be camelCase, mirroring
        // SystemEvent's BatteryLevelChanged { percent } / PowerSourceChanged { onBattery } pattern.
        assert!(json.get("browser").is_some());
        assert!(json.get("tabs").is_some());
    }
}
