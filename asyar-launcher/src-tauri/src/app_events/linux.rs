//! Linux app-events watcher.
//!
//! Baseline strategy:
//!
//! - Poll `/proc` on a dedicated thread at 1s cadence using the `procfs`
//!   crate. Diff PID sets across ticks → `AppEvent::Launched` /
//!   `AppEvent::Terminated`. Imperfect for GUI apps (all processes, not
//!   just GUI), but the pragmatic choice Linux has available without
//!   compositor cooperation. The user-facing docs flag this.
//! - Listen for `org.freedesktop.DBus.NameOwnerChanged` to catch GUI apps
//!   that register well-known bus names (Spotify, Slack, Discord, etc.).
//!   Only augments the procfs feed — a launch is always emitted by procfs
//!   first.
//! - X11 `_NET_ACTIVE_WINDOW` property changes surface frontmost changes.
//!   On Wayland there is no portable equivalent; we log once and skip.
//!
//! Pure parser helpers are compiled on every platform so they can be
//! exercised from the macOS dev machine's test suite. The DBus/procfs glue
//! is gated behind `#[cfg(target_os = "linux")]`.

use std::collections::HashSet;

/// Diff two snapshots of PID sets. Returns `(newly_launched, newly_terminated)`.
/// Pure; no I/O. Callable on every platform so the delta logic is covered
/// by unit tests from macOS.
pub fn diff_pids(old: &HashSet<u32>, new: &HashSet<u32>) -> (Vec<u32>, Vec<u32>) {
    let launched: Vec<u32> = new.difference(old).copied().collect();
    let terminated: Vec<u32> = old.difference(new).copied().collect();
    (launched, terminated)
}

/// Normalise the contents of `/proc/<pid>/comm` into a process name. The
/// kernel appends a newline; the comm field is also capped at 15 chars so
/// truncation is pre-applied by the kernel — nothing else to do here.
pub fn parse_proc_comm(content: &str) -> String {
    content.trim().to_string()
}

/// Heuristic: does this DBus well-known-name plausibly correspond to a
/// GUI application? The NameOwnerChanged signal fires for every name
/// registration, including short-lived CLI helpers — filter them out.
pub fn dbus_name_looks_like_gui_app(name: &str) -> bool {
    // Filter system/service namespaces.
    if name.starts_with("org.freedesktop.")
        || name.starts_with("org.gnome.SettingsDaemon")
        || name.starts_with("org.a11y.")
        || name.starts_with(":") // unique names like :1.42
    {
        return false;
    }
    // Must be a reverse-dns style well-known name.
    name.contains('.')
}

// ---------------------------------------------------------------------------
// Linux-only watcher glue
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
pub use watcher::{LinuxAppWatcher, LinuxPresenceQuery};

#[cfg(target_os = "linux")]
mod watcher {
    use super::*;
    use crate::app_events::{AppEvent, AppEventsHub, AppEventsWatcher, AppPresenceQuery};
    use crate::error::AppError;
    use log::{info, warn};
    use std::sync::Arc;
    use std::time::Duration;

    pub struct LinuxAppWatcher;

    impl LinuxAppWatcher {
        pub fn new() -> Self {
            Self
        }
    }

    impl Default for LinuxAppWatcher {
        fn default() -> Self {
            Self::new()
        }
    }

    impl AppEventsWatcher for LinuxAppWatcher {
        fn start(&self, hub: Arc<AppEventsHub>) -> Result<(), AppError> {
            spawn_procfs_poller(hub.clone());
            spawn_dbus_name_owner_thread(hub.clone());
            spawn_x11_frontmost_thread(hub);
            info!("[app_events/linux] watcher started");
            Ok(())
        }
    }

    fn spawn_procfs_poller(hub: Arc<AppEventsHub>) {
        std::thread::Builder::new()
            .name("asyar-app-events-procfs".into())
            .spawn(move || {
                if let Err(e) = run_procfs_loop(hub) {
                    warn!("[app_events/linux] procfs source failed: {e}");
                }
            })
            .ok();
    }

    fn run_procfs_loop(hub: Arc<AppEventsHub>) -> Result<(), String> {
        use procfs::process::all_processes;

        let mut last_pids: HashSet<u32> = HashSet::new();
        let mut names: std::collections::HashMap<u32, String> =
            std::collections::HashMap::new();

        loop {
            std::thread::sleep(Duration::from_secs(1));

            let current = match all_processes() {
                Ok(iter) => iter,
                Err(e) => {
                    warn!("[app_events/linux] procfs read failed: {e}");
                    continue;
                }
            };

            let mut now_pids: HashSet<u32> = HashSet::new();
            let mut now_names: std::collections::HashMap<u32, String> =
                std::collections::HashMap::new();
            for proc_res in current {
                let proc = match proc_res {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                let pid = proc.pid() as u32;
                now_pids.insert(pid);
                if let Ok(status) = proc.status() {
                    now_names.insert(pid, status.name);
                }
            }

            let (launched, terminated) = diff_pids(&last_pids, &now_pids);
            for pid in launched {
                let name = now_names
                    .get(&pid)
                    .cloned()
                    .unwrap_or_else(|| format!("pid-{pid}"));
                hub.dispatch(AppEvent::Launched {
                    pid,
                    bundle_id: None,
                    name,
                    path: None,
                });
            }
            for pid in terminated {
                let name = names
                    .remove(&pid)
                    .unwrap_or_else(|| format!("pid-{pid}"));
                hub.dispatch(AppEvent::Terminated {
                    pid,
                    bundle_id: None,
                    name,
                });
            }

            last_pids = now_pids;
            names = now_names;
        }
    }

    fn spawn_dbus_name_owner_thread(hub: Arc<AppEventsHub>) {
        std::thread::Builder::new()
            .name("asyar-app-events-dbus".into())
            .spawn(move || {
                if let Err(e) = run_dbus_loop(hub) {
                    warn!("[app_events/linux] dbus source failed: {e}");
                }
            })
            .ok();
    }

    fn run_dbus_loop(hub: Arc<AppEventsHub>) -> zbus::Result<()> {
        use zbus::blocking::{Connection, MessageIterator};
        use zbus::{MatchRule, MessageType};

        let conn = Connection::session()?;
        let rule = MatchRule::builder()
            .msg_type(MessageType::Signal)
            .sender("org.freedesktop.DBus")?
            .path("/org/freedesktop/DBus")?
            .interface("org.freedesktop.DBus")?
            .member("NameOwnerChanged")?
            .build();
        let iter = MessageIterator::for_match_rule(rule, &conn, None)?;
        for msg in iter {
            let msg = match msg {
                Ok(m) => m,
                Err(_) => continue,
            };
            let body = msg.body();
            let (name, old_owner, new_owner): (String, String, String) =
                match body.deserialize() {
                    Ok(t) => t,
                    Err(_) => continue,
                };
            if !dbus_name_looks_like_gui_app(&name) {
                continue;
            }
            // name-appeared: old_owner empty, new_owner set → app started registering
            // name-disappeared: old_owner set, new_owner empty → app stopped
            if old_owner.is_empty() && !new_owner.is_empty() {
                hub.dispatch(AppEvent::Launched {
                    pid: 0,
                    bundle_id: Some(name.clone()),
                    name,
                    path: None,
                });
            } else if !old_owner.is_empty() && new_owner.is_empty() {
                hub.dispatch(AppEvent::Terminated {
                    pid: 0,
                    bundle_id: Some(name.clone()),
                    name,
                });
            }
        }
        Ok(())
    }

    fn spawn_x11_frontmost_thread(hub: Arc<AppEventsHub>) {
        std::thread::Builder::new()
            .name("asyar-app-events-x11".into())
            .spawn(move || {
                if let Err(e) = run_x11_loop(hub) {
                    warn!(
                        "[app_events/linux] X11 frontmost source failed (Wayland? unset \
                         DISPLAY?): {e} — frontmost-changed will not fire on this session"
                    );
                }
            })
            .ok();
    }

    fn run_x11_loop(hub: Arc<AppEventsHub>) -> Result<(), String> {
        use x11rb::connection::Connection as _;
        use x11rb::protocol::xproto::{
            AtomEnum, ChangeWindowAttributesAux, ConnectionExt as _, EventMask,
        };
        use x11rb::protocol::Event;

        let (conn, screen_num) =
            x11rb::connect(None).map_err(|e| format!("x11 connect failed: {e}"))?;
        let root = conn.setup().roots[screen_num].root;

        let net_active = conn
            .intern_atom(false, b"_NET_ACTIVE_WINDOW")
            .map_err(|e| format!("{e}"))?
            .reply()
            .map_err(|e| format!("{e}"))?
            .atom;
        let net_wm_name = conn
            .intern_atom(false, b"_NET_WM_NAME")
            .map_err(|e| format!("{e}"))?
            .reply()
            .map_err(|e| format!("{e}"))?
            .atom;
        let utf8_string = conn
            .intern_atom(false, b"UTF8_STRING")
            .map_err(|e| format!("{e}"))?
            .reply()
            .map_err(|e| format!("{e}"))?
            .atom;

        conn.change_window_attributes(
            root,
            &ChangeWindowAttributesAux::new().event_mask(EventMask::PROPERTY_CHANGE),
        )
        .map_err(|e| format!("{e}"))?;
        conn.flush().map_err(|e| format!("{e}"))?;

        let mut last_window: u32 = 0;
        loop {
            let event = conn.wait_for_event().map_err(|e| format!("{e}"))?;
            if let Event::PropertyNotify(ev) = event {
                if ev.atom != net_active {
                    continue;
                }
                // Read _NET_ACTIVE_WINDOW property from the root.
                let active = match conn.get_property(
                    false,
                    root,
                    net_active,
                    AtomEnum::WINDOW,
                    0,
                    1,
                ) {
                    Ok(c) => match c.reply() {
                        Ok(r) => r,
                        Err(_) => continue,
                    },
                    Err(_) => continue,
                };
                let win = active
                    .value32()
                    .and_then(|mut it| it.next())
                    .unwrap_or(0);
                if win == 0 || win == last_window {
                    continue;
                }
                last_window = win;
                // Read window name.
                let name = match conn
                    .get_property(false, win, net_wm_name, utf8_string, 0, 256)
                {
                    Ok(c) => match c.reply() {
                        Ok(r) => String::from_utf8(r.value).unwrap_or_default(),
                        Err(_) => String::new(),
                    },
                    Err(_) => String::new(),
                };
                hub.dispatch(AppEvent::FrontmostChanged {
                    pid: 0,
                    bundle_id: None,
                    name,
                });
            }
        }
    }

    pub struct LinuxPresenceQuery;

    impl AppPresenceQuery for LinuxPresenceQuery {
        fn is_running(&self, bundle_id: &str) -> bool {
            // No real bundle IDs on Linux — we treat the argument as either:
            // - a /proc comm name (exe basename, max 15 chars), or
            // - a DBus well-known name.
            use procfs::process::all_processes;
            if let Ok(iter) = all_processes() {
                for proc_res in iter {
                    let proc = match proc_res {
                        Ok(p) => p,
                        Err(_) => continue,
                    };
                    if let Ok(status) = proc.status() {
                        if status.name == bundle_id {
                            return true;
                        }
                    }
                }
            }
            // DBus NameHasOwner fallback.
            if let Ok(conn) = zbus::blocking::Connection::session() {
                if let Ok(proxy) = zbus::blocking::fdo::DBusProxy::new(&conn) {
                    let name: Result<zbus::names::BusName<'_>, _> = bundle_id.try_into();
                    if let Ok(name) = name {
                        if let Ok(has) = proxy.name_has_owner(name) {
                            return has;
                        }
                    }
                }
            }
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- diff_pids ----

    #[test]
    fn diff_pids_empty_old_means_all_new_are_launched() {
        let old = HashSet::new();
        let new: HashSet<u32> = [1u32, 2, 3].into_iter().collect();
        let (launched, terminated) = diff_pids(&old, &new);
        let mut l = launched;
        l.sort();
        assert_eq!(l, vec![1, 2, 3]);
        assert!(terminated.is_empty());
    }

    #[test]
    fn diff_pids_empty_new_means_all_old_terminated() {
        let old: HashSet<u32> = [10u32, 20].into_iter().collect();
        let new = HashSet::new();
        let (launched, terminated) = diff_pids(&old, &new);
        assert!(launched.is_empty());
        let mut t = terminated;
        t.sort();
        assert_eq!(t, vec![10, 20]);
    }

    #[test]
    fn diff_pids_partial_overlap() {
        let old: HashSet<u32> = [1u32, 2, 3].into_iter().collect();
        let new: HashSet<u32> = [2u32, 3, 4].into_iter().collect();
        let (mut launched, mut terminated) = diff_pids(&old, &new);
        launched.sort();
        terminated.sort();
        assert_eq!(launched, vec![4]);
        assert_eq!(terminated, vec![1]);
    }

    #[test]
    fn diff_pids_same_set_yields_no_events() {
        let old: HashSet<u32> = [1u32, 2, 3].into_iter().collect();
        let new = old.clone();
        let (launched, terminated) = diff_pids(&old, &new);
        assert!(launched.is_empty());
        assert!(terminated.is_empty());
    }

    // ---- parse_proc_comm ----

    #[test]
    fn parse_proc_comm_strips_trailing_newline() {
        assert_eq!(parse_proc_comm("firefox\n"), "firefox");
    }

    #[test]
    fn parse_proc_comm_trims_whitespace() {
        assert_eq!(parse_proc_comm("  slack\n"), "slack");
    }

    // ---- dbus_name_looks_like_gui_app ----

    #[test]
    fn dbus_name_filters_out_unique_names() {
        assert!(!dbus_name_looks_like_gui_app(":1.42"));
        assert!(!dbus_name_looks_like_gui_app(":1.0"));
    }

    #[test]
    fn dbus_name_filters_out_system_namespaces() {
        assert!(!dbus_name_looks_like_gui_app("org.freedesktop.DBus"));
        assert!(!dbus_name_looks_like_gui_app("org.freedesktop.UPower"));
        assert!(!dbus_name_looks_like_gui_app("org.a11y.Bus"));
        assert!(!dbus_name_looks_like_gui_app(
            "org.gnome.SettingsDaemon.MediaKeys"
        ));
    }

    #[test]
    fn dbus_name_accepts_typical_gui_app_names() {
        assert!(dbus_name_looks_like_gui_app("com.spotify.Client"));
        assert!(dbus_name_looks_like_gui_app("com.slack.Slack"));
        assert!(dbus_name_looks_like_gui_app("com.discordapp.Discord"));
    }

    #[test]
    fn dbus_name_rejects_bare_identifiers() {
        assert!(!dbus_name_looks_like_gui_app("notadotname"));
        assert!(!dbus_name_looks_like_gui_app(""));
    }
}
