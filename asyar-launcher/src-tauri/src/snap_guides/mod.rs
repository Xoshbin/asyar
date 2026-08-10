//! The full-screen dashed guide lines shown while dragging the launcher near
//! a snap point.
//!
//! Modeled directly on [`crate::hud_window`]: a pre-declared Tauri window
//! (label `"snap-guides"`, `tauri.conf.json`), transparent, click-through,
//! always-on-top, `visible: false` at startup. [`launcher_placement::service`]
//! drives it from the registered [`crate::window_drag`] move-adjuster —
//! nothing here calls into `window_drag` or `launcher_placement`; this
//! module only knows how to show/hide/paint itself.

pub mod service;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// One frame of guide-line state, in logical px **local to the guide
/// window** (which is sized and positioned to exactly cover the monitor the
/// drag is on, so these are also monitor-local). `left_x`/`right_x` are the
/// launcher's left and right edges when horizontally centered — two
/// renderings of the same single x snap condition, always sharing
/// `snapped_x`'s opacity. `y` is the default vertical position,
/// independently gated by `snapped_y`.
///
/// Deliberately **not** `specta::Type` — like [`crate::hud_window::HudContent`],
/// this is an event payload and a command return value, not part of the
/// generated-bindings surface. Its TS shape is hand-declared in
/// `windowCommands.ts`, same as `HudContent`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapGuideState {
    pub left_x: f64,
    pub right_x: f64,
    pub y: f64,
    pub snapped_x: bool,
    pub snapped_y: bool,
}

/// Tauri-managed state: the most recently set guide state, so the route can
/// recover it on mount if it attaches its listener after the first
/// `snap-guides:state` event — the same race `HudState` guards against.
#[derive(Default)]
pub struct SnapGuidesState {
    pub current: Mutex<Option<SnapGuideState>>,
}
