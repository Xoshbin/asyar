//! Linux backend using logind's `org.freedesktop.login1.Manager.Inhibit`.
//!
//! The returned file descriptor keeps the inhibit active as long as it is
//! held open; dropping our [`LinuxInhibitHandle`] closes the fd and releases
//! the inhibit. Non-systemd systems (no logind on the session bus) cause
//! [`PowerBackend::inhibit`] to return [`AppError::Power`] with
//! `PowerUnavailable:` — we deliberately do NOT fall back to shelling out to
//! `systemd-inhibit`.

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

pub struct LinuxInhibitHandle {
    /// Held for its `Drop` impl — closing this fd releases the inhibit.
    _fd: OwnedFd,
}

impl PowerHandle for LinuxInhibitHandle {}

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

impl PowerBackend for LinuxPowerBackend {
    fn inhibit(
        &self,
        _token: &str,
        options: ResolvedOptions,
        reason: &str,
    ) -> Result<Box<dyn PowerHandle>, AppError> {
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

        Ok(Box::new(LinuxInhibitHandle { _fd: fd.into() }))
    }
}
