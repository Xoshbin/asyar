#![allow(deprecated)]
//! macOS platform integration, split by concern:
//! - `appearance` — theme resolution + panel appearance/material
//! - `display_name` — the localized name a bundle presents to the user
//! - `window`     — spotlight/HUD/sticky panels, geometry, resize, WebKit tuning
//! - `icon`       — app-icon extraction (.icns fast path + NSWorkspace fallback)
//! - `haptics`    — trackpad haptic feedback (drag-to-snap)
//! - `input`      — global key monitors (Cmd-Q, snippet expansion) + press-and-hold
//! - `system`     — accessibility, frontmost app, and the native Show-More bar
//!
//! Every item is re-exported here, so `crate::platform::macos::<name>` paths are
//! unchanged. `ResolvedTheme` is defined here because both `appearance` and
//! `window` depend on it.

/// The resolved (OS-actual) appearance at window creation time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolvedTheme {
    Light,
    Dark,
}

mod appearance;
mod display_name;
mod haptics;
mod icon;
mod input;
mod system;
mod window;

pub use appearance::*;
pub use display_name::*;
pub use haptics::*;
pub use icon::*;
pub use input::*;
pub use system::*;
pub use window::*;
