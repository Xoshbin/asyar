//! Extension tray subsystem.
//!
//! Each top-level `StatusBarItem` an extension registers becomes an
//! independent tray icon owned by the host. Asyar's own tray is untouched —
//! its setup stays in `crate::tray`.

pub mod backend;
pub mod commands;
pub mod extension_lookup;
pub mod icon;
pub mod item;
pub mod manager;
pub mod path;
pub mod validation;

pub use manager::ExtensionTrayManager;
