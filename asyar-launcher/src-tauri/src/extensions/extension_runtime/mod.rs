//! Tier 2 extension context lifecycle — worker + view state machines.
//! Each extension has two independent ContextMachine instances (worker and view),
//! both parameterised by ContextRole and sharing the same state alphabet.
//! See docs/superpowers/plans/2026-04-21-tier2-worker-view-split.md

pub mod types;
pub mod emitter;
pub mod wire;
pub mod context;
pub mod manager;
pub mod ticker;

pub use types::*;
pub use manager::ExtensionRuntimeManager;

// Tauri event names shared between commands and ticker
pub const EVENT_MOUNT: &str = "asyar:iframe:mount";
pub const EVENT_UNMOUNT: &str = "asyar:iframe:unmount";
pub const EVENT_DELIVER: &str = "asyar:iframe:deliver";
pub const EVENT_DEGRADED: &str = "asyar:iframe:degraded";
pub const EVENT_RECOVERED: &str = "asyar:iframe:recovered";

#[cfg(test)]
mod proptests;
