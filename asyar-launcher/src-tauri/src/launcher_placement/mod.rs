//! Where the launcher window appears, and how the user changes it.
//!
//! Before #596 the position was recomputed on every reveal from a formula
//! hardcoded in two platform-specific places, so there was nothing to drag and
//! nothing to configure. This module owns that decision instead:
//!
//! ```text
//! reveal ─▶ service::apply()
//!            ├─ store::load()        the persisted LauncherPlacement
//!            ├─ pick_monitor()       cursor or primary
//!            ├─ resolve::resolve_origin()   PURE — the only copy of the maths
//!            └─ platform conversion  AppKit bottom-left ⇆ Tauri top-left
//! ```
//!
//! Dragging goes the other way: [`crate::window_drag`] moves the window, and
//! on drop [`service::persist_dragged`] turns the landing spot back into
//! monitor fractions.

pub mod commands;
pub mod resolve;
pub mod service;
pub mod store;
pub mod types;

pub use types::{LauncherAnchor, LauncherMonitorChoice, LauncherPlacement, DEFAULT_TOP_BIAS};

/// The tallest the launcher ever gets. Positions reserve this much room below
/// the top edge so an expanded launcher is never clipped — see
/// [`resolve::resolve_origin`].
///
/// macOS keeps its own copy in `platform::macos::window` because the NSPanel
/// geometry code is written against it; `matches_macos_constant` below holds
/// the two together.
pub const LAUNCHER_MAX_HEIGHT: f64 = 480.0;

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    #[test]
    fn matches_macos_constant() {
        assert_eq!(
            super::LAUNCHER_MAX_HEIGHT,
            crate::platform::macos::LAUNCHER_MAX_HEIGHT,
            "the placement resolver reserves the same height the NSPanel resize code uses"
        );
    }
}
