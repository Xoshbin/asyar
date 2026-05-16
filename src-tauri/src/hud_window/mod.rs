//! Heads-up display (HUD) — a small transient window pinned to the bottom
//! of the active monitor that shows a brief confirmation message.
//!
//! The HUD lives in its own Tauri webview window (label `"hud"`), which is
//! pre-declared in `tauri.conf.json` with `visible: false`. The frontend
//! requests a HUD via the `show_hud` command; this module positions the
//! window, emits the title to the HUD's Svelte route via the `hud:show`
//! event, shows the window, and schedules an auto-hide.
//!
//! Both Tier 1 built-in features and Tier 2 sandboxed extensions invoke
//! this through the SDK `FeedbackServiceProxy.showHUD(title)` call which
//! routes through `ExtensionIpcRouter` → host `feedbackService.showHUD` →
//! `commands.showHud` (TS wrapper) → `show_hud` (Rust command) → here.

pub mod service;

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::async_runtime::JoinHandle;

/// Latest state of the HUD window. Held by `HudState.current` so the HUD's
/// Svelte route can fetch it on mount via `get_hud_state` (the lazy-loaded
/// HUD route may attach its `hud:show` listener after the first emit).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudContent {
    pub title: String,
    /// When true, the HUD route renders a spinner alongside the title and
    /// no auto-hide is scheduled — the HUD stays visible until an explicit
    /// `hide_hud` or a follow-up `show_hud` call with `spinning=false`.
    pub spinning: bool,
}

/// Tauri-managed state for the HUD window.
///
/// - `auto_hide_task` holds the in-flight auto-hide timer (if any) so that
///   a second `show_hud` call can abort a pending hide before scheduling
///   its own.
/// - `current` holds the most recent {title, spinning} pair so the HUD's
///   Svelte route can recover it on mount.
#[derive(Default)]
pub struct HudState {
    pub auto_hide_task: Mutex<Option<JoinHandle<()>>>,
    pub current: Mutex<Option<HudContent>>,
}
