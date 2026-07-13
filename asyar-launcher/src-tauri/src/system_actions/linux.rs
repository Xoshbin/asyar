//! Linux backend, via logind over D-Bus (`zbus`, blocking — same transport
//! as `power::linux`).
//!
//! - Sleep / Hibernate / Restart / Shut down: `org.freedesktop.login1.Manager`
//!   `Suspend` / `Hibernate` / `Reboot` / `PowerOff`, offered only when the
//!   matching `Can*` probe answers `"yes"` or `"challenge"` (`interactive =
//!   true`, so polkit may prompt instead of the call failing outright).
//! - Lock: `Lock` on the caller's own session (`/session/auto`), which the
//!   desktop environment translates to its lock screen. Falls back to
//!   session-bus `org.freedesktop.ScreenSaver.Lock` on non-systemd setups.
//! - Log out: `Terminate` on the caller's own session. Note this ends the
//!   session at the logind level — it does not run the desktop's graceful
//!   logout flow with save prompts.

use crate::error::AppError;
use crate::system_actions::{SystemAction, SystemActionsBackend};
use zbus::blocking::Connection;

const LOGIND_DEST: &str = "org.freedesktop.login1";
const LOGIND_PATH: &str = "/org/freedesktop/login1";
const LOGIND_MANAGER: &str = "org.freedesktop.login1.Manager";
const SESSION_AUTO_PATH: &str = "/org/freedesktop/login1/session/auto";
const LOGIND_SESSION: &str = "org.freedesktop.login1.Session";

pub struct LinuxSystemActionsBackend;

impl LinuxSystemActionsBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LinuxSystemActionsBackend {
    fn default() -> Self {
        Self::new()
    }
}

fn system_bus() -> Result<Connection, AppError> {
    Connection::system()
        .map_err(|e| AppError::Platform(format!("logind system bus unreachable: {e}")))
}

/// `CanSuspend` & co. return `"yes"`, `"no"`, `"challenge"` (needs polkit
/// auth) or `"na"`. With `interactive = true` a challenge becomes a polkit
/// prompt, so both `"yes"` and `"challenge"` count as available.
fn logind_can(conn: &Connection, method: &str) -> bool {
    conn.call_method(
        Some(LOGIND_DEST),
        LOGIND_PATH,
        Some(LOGIND_MANAGER),
        method,
        &(),
    )
    .ok()
    .and_then(|reply| reply.body().deserialize::<String>().ok())
    .map(|answer| answer == "yes" || answer == "challenge")
    .unwrap_or(false)
}

fn logind_manager_call(method: &str) -> Result<(), AppError> {
    let conn = system_bus()?;
    conn.call_method(
        Some(LOGIND_DEST),
        LOGIND_PATH,
        Some(LOGIND_MANAGER),
        method,
        &(true,), // interactive: let polkit prompt when authorization is needed
    )
    .map_err(|e| AppError::Platform(format!("login1.Manager.{method} failed: {e}")))?;
    Ok(())
}

fn logind_session_call(method: &str) -> Result<(), AppError> {
    let conn = system_bus()?;
    conn.call_method(
        Some(LOGIND_DEST),
        SESSION_AUTO_PATH,
        Some(LOGIND_SESSION),
        method,
        &(),
    )
    .map_err(|e| AppError::Platform(format!("login1.Session.{method} failed: {e}")))?;
    Ok(())
}

fn screensaver_lock() -> Result<(), AppError> {
    let conn = Connection::session()
        .map_err(|e| AppError::Platform(format!("session bus unreachable: {e}")))?;
    conn.call_method(
        Some("org.freedesktop.ScreenSaver"),
        "/org/freedesktop/ScreenSaver",
        Some("org.freedesktop.ScreenSaver"),
        "Lock",
        &(),
    )
    .map_err(|e| AppError::Platform(format!("ScreenSaver.Lock failed: {e}")))?;
    Ok(())
}

impl SystemActionsBackend for LinuxSystemActionsBackend {
    fn supported(&self) -> Vec<SystemAction> {
        let mut actions = Vec::new();
        match Connection::system() {
            Ok(conn) => {
                if logind_can(&conn, "CanSuspend") {
                    actions.push(SystemAction::Sleep);
                }
                if logind_can(&conn, "CanHibernate") {
                    actions.push(SystemAction::Hibernate);
                }
                // Session-scoped actions need no polkit authorization.
                actions.push(SystemAction::LockScreen);
                actions.push(SystemAction::LogOut);
                if logind_can(&conn, "CanReboot") {
                    actions.push(SystemAction::Restart);
                }
                if logind_can(&conn, "CanPowerOff") {
                    actions.push(SystemAction::ShutDown);
                }
            }
            Err(_) => {
                // Non-systemd setup: the ScreenSaver interface is the only
                // action we can still offer.
                if Connection::session().is_ok() {
                    actions.push(SystemAction::LockScreen);
                }
            }
        }
        actions
    }

    fn run(&self, action: SystemAction) -> Result<(), AppError> {
        match action {
            SystemAction::Sleep => logind_manager_call("Suspend"),
            SystemAction::Hibernate => logind_manager_call("Hibernate"),
            SystemAction::Restart => logind_manager_call("Reboot"),
            SystemAction::ShutDown => logind_manager_call("PowerOff"),
            SystemAction::LockScreen => logind_session_call("Lock").or_else(|logind_err| {
                screensaver_lock().map_err(|ss_err| {
                    AppError::Platform(format!("{logind_err}; fallback {ss_err}"))
                })
            }),
            SystemAction::LogOut => logind_session_call("Terminate"),
        }
    }
}
