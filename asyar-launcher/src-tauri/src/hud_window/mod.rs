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
use tauri::async_runtime::JoinHandle;

/// Tauri-managed state for the HUD window.
///
/// - `auto_hide_task` holds the in-flight auto-hide timer (if any) so that
///   a second `show_hud` call can abort a pending hide before scheduling
///   its own.
/// - `current_title` holds the most recent title so the HUD's Svelte route
///   can fetch it on mount. This handles the first-show race: the HUD
///   webview is lazy-loaded by Tauri (the window is declared with
///   `visible: false`), so its `hud:show` event listener doesn't exist
///   until after the first `show()`. Without this fallback, the title
///   emitted before mount would be lost.
#[derive(Default)]
pub struct HudState {
    pub auto_hide_task: Mutex<Option<JoinHandle<()>>>,
    pub current_title: Mutex<Option<String>>,
}
