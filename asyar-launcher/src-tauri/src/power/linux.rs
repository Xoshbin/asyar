//! Linux sleep-inhibitor backend.
//!
//! Primary: logind's `org.freedesktop.login1.Manager.Inhibit`. The returned
//! file descriptor keeps the inhibit active as long as it is held open;
//! dropping our [`LinuxInhibitHandle`] closes the fd and releases the
//! inhibit.
//!
//! Fallback: session-bus `org.freedesktop.ScreenSaver.Inhibit` when logind
//! isn't reachable (non-systemd distros such as Void, Alpine, Artix).
//! This is a *screensaver*-level inhibit — it keeps the display awake on
//! most desktop environments (GNOME, KDE, XFCE, MATE, Cinnamon) but does
//! not block system sleep. That's a known reduction in power compared to
//! logind and is documented in the IPowerService JSDoc.
//!
//! Both backends are acquired through `zbus`, no child-process hop. On the
//! rare system where neither bus name is reachable, the call returns
//! [`AppError::Power`] with a `PowerUnavailable:` prefix — callers that
//! check for that prefix can degrade gracefully.

use crate::error::AppError;
use crate::power::{PowerBackend, PowerHandle, ResolvedOptions};
use std::os::fd::OwnedFd;
use zbus::blocking::Connection;
use zbus::zvariant::OwnedFd as ZOwnedFd;

pub struct LinuxPowerBackend;

impl LinuxPowerBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LinuxPowerBackend {
    fn default() -> Self {
        Self::new()
    }
}

pub enum LinuxInhibitHandle {
    /// Held for its `Drop` impl — closing this fd releases the inhibit.
    Logind { _fd: OwnedFd },
    /// ScreenSaver cookie returned from `Inhibit`; passed back to `UnInhibit`
    /// on drop. Connection is kept alive so the UnInhibit call can still
    /// reach the bus.
    ScreenSaver {
        conn: Connection,
        cookie: u32,
    },
}

impl PowerHandle for LinuxInhibitHandle {}

impl Drop for LinuxInhibitHandle {
    fn drop(&mut self) {
        if let LinuxInhibitHandle::ScreenSaver { conn, cookie } = self {
            let _ = conn.call_method(
                Some("org.freedesktop.ScreenSaver"),
                "/org/freedesktop/ScreenSaver",
                Some("org.freedesktop.ScreenSaver"),
                "UnInhibit",
                &(*cookie,),
            );
        }
        // Logind variant: the OwnedFd's own Drop closes the fd, which
        // releases the inhibit server-side.
    }
}

fn what_string(opts: ResolvedOptions) -> String {
    let mut parts: Vec<&'static str> = Vec::new();
    if opts.system {
        parts.push("idle");
        parts.push("sleep");
    }
    if opts.display {
        parts.push("handle-lid-switch");
    }
    if opts.disk && !opts.system {
        parts.push("idle");
    }
    if parts.is_empty() {
        parts.push("idle");
    }
    let mut seen = std::collections::HashSet::new();
    parts
        .into_iter()
        .filter(|p| seen.insert(*p))
        .collect::<Vec<_>>()
        .join(":")
}

fn try_logind(
    options: ResolvedOptions,
    reason: &str,
) -> Result<LinuxInhibitHandle, AppError> {
    let conn = Connection::system().map_err(|e| {
        AppError::Power(format!(
            "PowerUnavailable: logind system bus unreachable: {e}"
        ))
    })?;

    let what = what_string(options);
    let reply = conn
        .call_method(
            Some("org.freedesktop.login1"),
            "/org/freedesktop/login1",
            Some("org.freedesktop.login1.Manager"),
            "Inhibit",
            &(what.as_str(), "Asyar", reason, "block"),
        )
        .map_err(|e| {
            AppError::Power(format!("PowerUnavailable: Inhibit call failed: {e}"))
        })?;
    let fd: ZOwnedFd = reply.body().deserialize::<ZOwnedFd>().map_err(|e| {
        AppError::Power(format!("Inhibit reply did not contain an fd: {e}"))
    })?;

    Ok(LinuxInhibitHandle::Logind { _fd: fd.into() })
}

fn try_screensaver(reason: &str) -> Result<LinuxInhibitHandle, AppError> {
    let conn = Connection::session().map_err(|e| {
        AppError::Power(format!(
            "PowerUnavailable: session bus unreachable: {e}"
        ))
    })?;

    let reply = conn
        .call_method(
            Some("org.freedesktop.ScreenSaver"),
            "/org/freedesktop/ScreenSaver",
            Some("org.freedesktop.ScreenSaver"),
            "Inhibit",
            &("Asyar", reason),
        )
        .map_err(|e| {
            AppError::Power(format!(
                "PowerUnavailable: ScreenSaver.Inhibit call failed: {e}"
            ))
        })?;
    let cookie: u32 = reply.body().deserialize::<u32>().map_err(|e| {
        AppError::Power(format!(
            "ScreenSaver.Inhibit reply did not contain a cookie: {e}"
        ))
    })?;

    Ok(LinuxInhibitHandle::ScreenSaver { conn, cookie })
}

impl PowerBackend for LinuxPowerBackend {
    fn inhibit(
        &self,
        _token: &str,
        options: ResolvedOptions,
        reason: &str,
    ) -> Result<Box<dyn PowerHandle>, AppError> {
        // Try logind first. On systemd systems this gives us a real system
        // sleep inhibit including lid-switch handling.
        match try_logind(options, reason) {
            Ok(h) => return Ok(Box::new(h)),
            Err(err) => {
                log::debug!(
                    "logind inhibit unavailable, falling back to ScreenSaver: {err}"
                );
            }
        }

        // Fallback: session-bus ScreenSaver. Display-awake only — system may
        // still sleep, but most non-systemd-distro users run a DE that
        // honours this interface for keep-screen-awake use cases.
        match try_screensaver(reason) {
            Ok(h) => Ok(Box::new(h)),
            Err(err) => Err(err),
        }
    }
}
