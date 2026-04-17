//! Linux system-events watcher (zbus / DBus).
//!
//! Three DBus sources, each running on a dedicated blocking thread so the
//! main async runtime stays free of `zbus::blocking::Connection`:
//!
//! - `org.freedesktop.login1.Manager.PrepareForSleep(bool)` — fires with
//!   `true` just before sleep, `false` right after wake. Maps to
//!   [`SystemEvent::Sleep`] / [`SystemEvent::Wake`].
//! - `org.freedesktop.UPower` properties `LidIsClosed` and `OnBattery` —
//!   watched via `PropertiesChanged` on the UPower root object. Transitions
//!   produce [`SystemEvent::LidOpen`] / [`SystemEvent::LidClose`] and
//!   [`SystemEvent::PowerSourceChanged`].
//! - `org.freedesktop.UPower.Device` for the display battery (the device
//!   whose `Type` is `2`, i.e. "Battery") — `Percentage` watched via
//!   `PropertiesChanged`. Integer-percent changes produce
//!   [`SystemEvent::BatteryLevelChanged`]; fractional noise is suppressed.
//!
//! Pure parser helpers ([`parse_lid_transition`], [`parse_on_battery_change`],
//! [`parse_percent_change`]) are compiled on every platform so they can be
//! unit-tested from the macOS dev machine. The zbus-using watcher glue is
//! gated behind `#[cfg(target_os = "linux")]`.
//!
//! Graceful degradation: each source is started independently. A missing
//! logind / UPower / device-enumeration step logs a single warning and is
//! skipped — the other sources keep running.

use crate::system_events::SystemEvent;

/// Map a lid-closed boolean transition to a [`SystemEvent`].
///
/// - `(false -> true)` = lid just closed → `LidClose`
/// - `(true -> false)` = lid just opened → `LidOpen`
/// - No change → `None`
pub fn parse_lid_transition(old: bool, new: bool) -> Option<SystemEvent> {
    match (old, new) {
        (false, true) => Some(SystemEvent::LidClose),
        (true, false) => Some(SystemEvent::LidOpen),
        _ => None,
    }
}

/// Map an `OnBattery` boolean transition to a [`SystemEvent`].
///
/// Returns `None` when the new value equals the last-observed one. The first
/// observation (`old = None`) always produces an event so subscribers know
/// the initial power source.
pub fn parse_on_battery_change(old: Option<bool>, new: bool) -> Option<SystemEvent> {
    if old == Some(new) {
        None
    } else {
        Some(SystemEvent::PowerSourceChanged { on_battery: new })
    }
}

/// Map a fractional battery percentage to a [`SystemEvent`], deduplicating
/// at integer granularity.
///
/// UPower reports `Percentage` as an `f64` that can update on fractional
/// boundaries (e.g. 42.1 → 42.2). We round to the nearest integer, clamp to
/// `0..=100`, and only emit when that integer differs from the last-observed
/// value.
pub fn parse_percent_change(old: Option<u8>, new_fractional: f64) -> Option<SystemEvent> {
    let clamped = new_fractional.round().clamp(0.0, 100.0) as u8;
    if old == Some(clamped) {
        None
    } else {
        Some(SystemEvent::BatteryLevelChanged { percent: clamped })
    }
}

// ---------------------------------------------------------------------------
// Linux-only watcher glue
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
pub use watcher::LinuxWatcher;

#[cfg(target_os = "linux")]
mod watcher {
    use super::{parse_lid_transition, parse_on_battery_change, parse_percent_change};
    use crate::error::AppError;
    use crate::system_events::{SystemEvent, SystemEventsHub, SystemEventsWatcher};
    use log::{info, warn};
    use std::collections::HashMap;
    use std::sync::Arc;
    use zbus::blocking::{Connection, MessageIterator};
    use zbus::zvariant::{OwnedObjectPath, OwnedValue};
    use zbus::{proxy, MatchRule, MessageType};

    pub struct LinuxWatcher;

    impl LinuxWatcher {
        pub fn new() -> Self {
            Self
        }
    }

    impl Default for LinuxWatcher {
        fn default() -> Self {
            Self::new()
        }
    }

    impl SystemEventsWatcher for LinuxWatcher {
        fn start(&self, hub: Arc<SystemEventsHub>) -> Result<(), AppError> {
            // Each source owns its own blocking connection + thread. Failure
            // in any one source logs a warning and skips that source; the
            // other sources still get their chance.
            spawn_logind_thread(hub.clone());
            spawn_upower_root_thread(hub.clone());
            spawn_upower_device_thread(hub);
            info!("[system_events/linux] watcher started");
            Ok(())
        }
    }

    // -- logind: PrepareForSleep --------------------------------------------

    fn spawn_logind_thread(hub: Arc<SystemEventsHub>) {
        std::thread::Builder::new()
            .name("asyar-system-events-logind".into())
            .spawn(move || {
                if let Err(e) = run_logind_loop(hub) {
                    warn!("[system_events/linux] logind source failed: {e}");
                }
            })
            .ok();
        // If the thread couldn't be spawned we silently skip — nothing to
        // recover. Other sources still start.
    }

    fn run_logind_loop(hub: Arc<SystemEventsHub>) -> zbus::Result<()> {
        let conn = Connection::system()?;
        let rule = MatchRule::builder()
            .msg_type(MessageType::Signal)
            .sender("org.freedesktop.login1")?
            .path("/org/freedesktop/login1")?
            .interface("org.freedesktop.login1.Manager")?
            .member("PrepareForSleep")?
            .build();
        let iter = MessageIterator::for_match_rule(rule, &conn, None)?;
        for msg in iter {
            let msg = match msg {
                Ok(m) => m,
                Err(e) => {
                    warn!("[system_events/linux] logind stream error: {e}");
                    continue;
                }
            };
            if let Ok(entering_sleep) = msg.body().deserialize::<bool>() {
                if entering_sleep {
                    hub.dispatch(SystemEvent::Sleep);
                } else {
                    hub.dispatch(SystemEvent::Wake);
                }
            }
        }
        Ok(())
    }

    // -- UPower root: LidIsClosed, OnBattery --------------------------------

    #[proxy(
        interface = "org.freedesktop.UPower",
        default_service = "org.freedesktop.UPower",
        default_path = "/org/freedesktop/UPower"
    )]
    trait UPowerRoot {
        #[zbus(property)]
        fn lid_is_closed(&self) -> zbus::Result<bool>;
        #[zbus(property)]
        fn on_battery(&self) -> zbus::Result<bool>;
        fn enumerate_devices(&self) -> zbus::Result<Vec<OwnedObjectPath>>;
    }

    fn spawn_upower_root_thread(hub: Arc<SystemEventsHub>) {
        std::thread::Builder::new()
            .name("asyar-system-events-upower-root".into())
            .spawn(move || {
                if let Err(e) = run_upower_root_loop(hub) {
                    warn!("[system_events/linux] UPower root source failed: {e}");
                }
            })
            .ok();
    }

    fn run_upower_root_loop(hub: Arc<SystemEventsHub>) -> zbus::Result<()> {
        let conn = Connection::system()?;
        let proxy = UPowerRootProxyBlocking::new(&conn)?;

        // Seed with current state so the first transition produces a correct
        // event (PrepareForSleep doesn't need this; properties do).
        let mut last_lid: Option<bool> = proxy.lid_is_closed().ok();
        let mut last_on_battery: Option<bool> = proxy.on_battery().ok();

        let rule = MatchRule::builder()
            .msg_type(MessageType::Signal)
            .sender("org.freedesktop.UPower")?
            .path("/org/freedesktop/UPower")?
            .interface("org.freedesktop.DBus.Properties")?
            .member("PropertiesChanged")?
            .build();
        let iter = MessageIterator::for_match_rule(rule, &conn, None)?;
        for msg in iter {
            let msg = match msg {
                Ok(m) => m,
                Err(e) => {
                    warn!("[system_events/linux] UPower root stream error: {e}");
                    continue;
                }
            };
            let body = msg.body();
            let (_iface, changed, _invalidated): (
                String,
                HashMap<String, OwnedValue>,
                Vec<String>,
            ) = match body.deserialize() {
                Ok(t) => t,
                Err(_) => continue,
            };

            if let Some(v) = changed.get("LidIsClosed") {
                if let Ok(new_closed) = bool::try_from(v) {
                    let prev = last_lid.unwrap_or(new_closed);
                    if let Some(ev) = parse_lid_transition(prev, new_closed) {
                        hub.dispatch(ev);
                    }
                    last_lid = Some(new_closed);
                }
            }

            if let Some(v) = changed.get("OnBattery") {
                if let Ok(new_on) = bool::try_from(v) {
                    if let Some(ev) = parse_on_battery_change(last_on_battery, new_on) {
                        hub.dispatch(ev);
                    }
                    last_on_battery = Some(new_on);
                }
            }
        }
        Ok(())
    }

    // -- UPower display device: Percentage ----------------------------------

    #[proxy(
        interface = "org.freedesktop.UPower.Device",
        default_service = "org.freedesktop.UPower"
    )]
    trait UPowerDevice {
        #[zbus(property)]
        fn type_(&self) -> zbus::Result<u32>;
        #[zbus(property)]
        fn percentage(&self) -> zbus::Result<f64>;
    }

    fn spawn_upower_device_thread(hub: Arc<SystemEventsHub>) {
        std::thread::Builder::new()
            .name("asyar-system-events-upower-device".into())
            .spawn(move || {
                if let Err(e) = run_upower_device_loop(hub) {
                    warn!("[system_events/linux] UPower device source failed: {e}");
                }
            })
            .ok();
    }

    fn run_upower_device_loop(hub: Arc<SystemEventsHub>) -> zbus::Result<()> {
        let conn = Connection::system()?;
        let root = UPowerRootProxyBlocking::new(&conn)?;
        let devices = root.enumerate_devices()?;

        // Pick the first Battery device (Type == 2).
        let battery_path = devices.into_iter().find(|p| {
            UPowerDeviceProxyBlocking::builder(&conn)
                .path(p.as_str())
                .and_then(|b| b.build())
                .and_then(|proxy| proxy.type_())
                .map(|t| t == 2)
                .unwrap_or(false)
        });
        let Some(battery_path) = battery_path else {
            warn!(
                "[system_events/linux] no UPower Battery device found — \
                 battery-level-changed events will not fire"
            );
            return Ok(());
        };

        let proxy = UPowerDeviceProxyBlocking::builder(&conn)
            .path(battery_path.as_str())?
            .build()?;
        let mut last_percent: Option<u8> = proxy
            .percentage()
            .ok()
            .map(|p: f64| p.round().clamp(0.0, 100.0) as u8);

        let rule = MatchRule::builder()
            .msg_type(MessageType::Signal)
            .sender("org.freedesktop.UPower")?
            .path(battery_path.as_str().to_owned())?
            .interface("org.freedesktop.DBus.Properties")?
            .member("PropertiesChanged")?
            .build();
        let iter = MessageIterator::for_match_rule(rule, &conn, None)?;
        for msg in iter {
            let msg = match msg {
                Ok(m) => m,
                Err(e) => {
                    warn!("[system_events/linux] UPower device stream error: {e}");
                    continue;
                }
            };
            let body = msg.body();
            let (_iface, changed, _invalidated): (
                String,
                HashMap<String, OwnedValue>,
                Vec<String>,
            ) = match body.deserialize() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if let Some(v) = changed.get("Percentage") {
                if let Ok(pct) = f64::try_from(v) {
                    if let Some(ev) = parse_percent_change(last_percent, pct) {
                        if let SystemEvent::BatteryLevelChanged { percent } = ev {
                            last_percent = Some(percent);
                        }
                        hub.dispatch(ev);
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- parse_lid_transition ---------------------------------------------

    #[test]
    fn lid_open_to_closed_emits_lid_close() {
        assert!(matches!(
            parse_lid_transition(false, true),
            Some(SystemEvent::LidClose)
        ));
    }

    #[test]
    fn lid_closed_to_open_emits_lid_open() {
        assert!(matches!(
            parse_lid_transition(true, false),
            Some(SystemEvent::LidOpen)
        ));
    }

    #[test]
    fn lid_same_state_emits_nothing() {
        assert!(parse_lid_transition(false, false).is_none());
        assert!(parse_lid_transition(true, true).is_none());
    }

    // --- parse_on_battery_change ------------------------------------------

    #[test]
    fn on_battery_first_observation_always_emits() {
        let ev = parse_on_battery_change(None, true).expect("first obs should emit");
        assert!(matches!(
            ev,
            SystemEvent::PowerSourceChanged { on_battery: true }
        ));
        let ev = parse_on_battery_change(None, false).expect("first obs should emit");
        assert!(matches!(
            ev,
            SystemEvent::PowerSourceChanged { on_battery: false }
        ));
    }

    #[test]
    fn on_battery_change_true_to_false_emits_not_on_battery() {
        let ev = parse_on_battery_change(Some(true), false).unwrap();
        assert!(matches!(
            ev,
            SystemEvent::PowerSourceChanged { on_battery: false }
        ));
    }

    #[test]
    fn on_battery_change_false_to_true_emits_on_battery() {
        let ev = parse_on_battery_change(Some(false), true).unwrap();
        assert!(matches!(
            ev,
            SystemEvent::PowerSourceChanged { on_battery: true }
        ));
    }

    #[test]
    fn on_battery_no_change_emits_nothing() {
        assert!(parse_on_battery_change(Some(true), true).is_none());
        assert!(parse_on_battery_change(Some(false), false).is_none());
    }

    // --- parse_percent_change ---------------------------------------------

    #[test]
    fn percent_first_observation_emits() {
        let ev = parse_percent_change(None, 87.3).unwrap();
        assert!(matches!(
            ev,
            SystemEvent::BatteryLevelChanged { percent: 87 }
        ));
    }

    #[test]
    fn percent_fractional_noise_under_rounding_threshold_is_suppressed() {
        // 42.1 rounded = 42; last was 42; should not emit.
        assert!(parse_percent_change(Some(42), 42.1).is_none());
        assert!(parse_percent_change(Some(42), 41.5).is_none()); // 41.5 rounds to 42 (banker's? f64::round rounds half-away-from-zero -> 42)
    }

    #[test]
    fn percent_fractional_crossing_integer_boundary_emits() {
        // last = 42, new = 42.6 -> rounds to 43 -> emit.
        let ev = parse_percent_change(Some(42), 42.6).unwrap();
        assert!(matches!(
            ev,
            SystemEvent::BatteryLevelChanged { percent: 43 }
        ));
    }

    #[test]
    fn percent_clamps_above_100() {
        let ev = parse_percent_change(Some(99), 150.0).unwrap();
        assert!(matches!(
            ev,
            SystemEvent::BatteryLevelChanged { percent: 100 }
        ));
    }

    #[test]
    fn percent_clamps_below_0() {
        let ev = parse_percent_change(Some(5), -10.0).unwrap();
        assert!(matches!(
            ev,
            SystemEvent::BatteryLevelChanged { percent: 0 }
        ));
    }

    #[test]
    fn percent_exact_integer_match_suppressed() {
        assert!(parse_percent_change(Some(80), 80.0).is_none());
        assert!(parse_percent_change(Some(0), 0.0).is_none());
        assert!(parse_percent_change(Some(100), 100.0).is_none());
    }
}
