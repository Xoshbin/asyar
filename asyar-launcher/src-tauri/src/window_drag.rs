//! Dragging a borderless window by a region of its own content.
//!
//! `data-tauri-drag-region` is not an option here. Both windows that need this
//! — the launcher and sticky notes — are converted to `NSPanel`s on macOS, and
//! the native `startDragging` path (`performWindowDragWithEvent:`) is not
//! something we can rely on there. So the frontend sends screen-space deltas
//! and this module applies them as an **absolute offset from an anchor**
//! captured at pointerdown. Absolute-from-anchor rather than per-frame deltas:
//! deltas accumulate rounding error and the window drifts away from the
//! cursor over a long drag.
//!
//! Windows opt into "do something once the drag ends" by registering a drop
//! handler at startup, rather than this module knowing which windows care —
//! the launcher persists its new position that way
//! ([`crate::launcher_placement::service::persist_dragged`]), while sticky
//! notes need nothing here because their `WindowEvent::Moved` listener already
//! schedules a debounced geometry save.

use crate::error::AppError;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager};

/// Runs once when a drag on the given window label finishes. It captures its
/// own `AppHandle` at registration time, which keeps this module free of
/// runtime generics and keeps the registry unit-testable. `Arc` rather than
/// `Box` so [`run_drop_handler`] can clone the handler out and invoke it with
/// the registry lock released.
type DropHandler = Arc<dyn Fn() + Send + Sync>;

/// Window origin (logical, top-left) captured at pointerdown, keyed by label.
fn drag_anchors() -> &'static Mutex<HashMap<String, (f64, f64)>> {
    static STATE: OnceLock<Mutex<HashMap<String, (f64, f64)>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn drop_handlers() -> &'static Mutex<HashMap<String, DropHandler>> {
    static STATE: OnceLock<Mutex<HashMap<String, DropHandler>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Registers `handler` to run after a drag of `label` ends. Call from setup.
/// Registering twice for the same label replaces the first handler.
pub fn register_drop_handler(label: impl Into<String>, handler: impl Fn() + Send + Sync + 'static) {
    if let Ok(mut map) = drop_handlers().lock() {
        map.insert(label.into(), Arc::new(handler));
    }
}

/// Where the window should sit for a drag that has moved `(dx, dy)` since it
/// started at `anchor`.
fn target_origin(anchor: (f64, f64), dx: f64, dy: f64) -> Option<(f64, f64)> {
    let (x, y) = (anchor.0 + dx, anchor.1 + dy);
    (x.is_finite() && y.is_finite()).then_some((x, y))
}

fn set_anchor(label: &str, origin: (f64, f64)) {
    if let Ok(mut map) = drag_anchors().lock() {
        map.insert(label.to_string(), origin);
    }
}

fn peek_anchor(label: &str) -> Option<(f64, f64)> {
    drag_anchors().lock().ok()?.get(label).copied()
}

fn take_anchor(label: &str) -> Option<(f64, f64)> {
    drag_anchors().lock().ok()?.remove(label)
}

fn run_drop_handler(label: &str) {
    // Cloned out and invoked with the lock released: the handler calls back
    // into window code (the launcher's reads geometry and writes the store)
    // and must not be holding the registry while it does.
    let handler = drop_handlers()
        .lock()
        .ok()
        .and_then(|map| map.get(label).cloned());
    if let Some(handler) = handler {
        handler();
    }
}

/// Begin a drag: remember where the window currently is.
#[tauri::command]
pub fn window_drag_start(label: String, app: AppHandle) -> Result<(), AppError> {
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(());
    };
    let (Ok(scale), Ok(pos)) = (window.scale_factor(), window.outer_position()) else {
        return Ok(());
    };
    let pos = pos.to_logical::<f64>(scale);
    set_anchor(&label, (pos.x, pos.y));
    Ok(())
}

/// Move the window to `anchor + (dx, dy)`, where the deltas are screen-space
/// pixels accumulated since [`window_drag_start`]. A move with no live anchor
/// (the drag was never started, or already ended) is a no-op.
#[tauri::command]
pub fn window_drag_move(label: String, dx: f64, dy: f64, app: AppHandle) -> Result<(), AppError> {
    let Some(anchor) = peek_anchor(&label) else {
        return Ok(());
    };
    let Some((x, y)) = target_origin(anchor, dx, dy) else {
        return Ok(());
    };
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(());
    };
    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    Ok(())
}

/// Drop the anchor and let the window's registered drop handler react.
#[tauri::command]
pub fn window_drag_end(label: String) -> Result<(), AppError> {
    if take_anchor(&label).is_some() {
        run_drop_handler(&label);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    // The registries are process-wide statics and tests run in parallel, so
    // every test uses a label of its own.

    #[test]
    fn target_is_the_anchor_plus_the_delta() {
        assert_eq!(
            target_origin((100.0, 50.0), 20.0, -10.0),
            Some((120.0, 40.0))
        );
    }

    #[test]
    fn target_does_not_drift_across_a_long_drag() {
        // The same total delta must give the same result however it was
        // accumulated — the reason anchors exist instead of per-frame deltas.
        let anchor = (100.0, 50.0);
        let one_shot = target_origin(anchor, 300.0, 200.0);
        let stepwise = (1..=300).fold(anchor, |_, i| {
            target_origin(anchor, i as f64, (i as f64) * 2.0 / 3.0).unwrap()
        });
        assert_eq!(one_shot, Some(stepwise));
    }

    #[test]
    fn target_rejects_a_non_finite_delta() {
        assert_eq!(target_origin((0.0, 0.0), f64::NAN, 0.0), None);
        assert_eq!(target_origin((0.0, 0.0), 0.0, f64::INFINITY), None);
    }

    #[test]
    fn anchor_round_trips_and_is_consumed_once() {
        let label = "test-anchor-round-trip";
        assert_eq!(peek_anchor(label), None);
        set_anchor(label, (12.0, 34.0));
        assert_eq!(peek_anchor(label), Some((12.0, 34.0)));
        assert_eq!(take_anchor(label), Some((12.0, 34.0)));
        assert_eq!(take_anchor(label), None, "a second end must be a no-op");
    }

    #[test]
    fn drop_handler_runs_for_its_own_label_only() {
        let mine = Arc::new(AtomicUsize::new(0));
        let theirs = Arc::new(AtomicUsize::new(0));

        let m = mine.clone();
        register_drop_handler("test-drop-mine", move || {
            m.fetch_add(1, Ordering::SeqCst);
        });
        let t = theirs.clone();
        register_drop_handler("test-drop-theirs", move || {
            t.fetch_add(1, Ordering::SeqCst);
        });

        run_drop_handler("test-drop-mine");

        assert_eq!(mine.load(Ordering::SeqCst), 1);
        assert_eq!(theirs.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn drop_handler_for_an_unregistered_label_is_a_no_op() {
        run_drop_handler("test-drop-nobody-registered");
    }

    #[test]
    fn ending_a_drag_that_never_started_does_not_fire_the_handler() {
        let count = Arc::new(AtomicUsize::new(0));
        let c = count.clone();
        register_drop_handler("test-drop-never-started", move || {
            c.fetch_add(1, Ordering::SeqCst);
        });

        window_drag_end("test-drop-never-started".to_string()).unwrap();

        assert_eq!(count.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn ending_a_started_drag_fires_the_handler_exactly_once() {
        let count = Arc::new(AtomicUsize::new(0));
        let c = count.clone();
        register_drop_handler("test-drop-once", move || {
            c.fetch_add(1, Ordering::SeqCst);
        });

        set_anchor("test-drop-once", (0.0, 0.0));
        window_drag_end("test-drop-once".to_string()).unwrap();
        window_drag_end("test-drop-once".to_string()).unwrap();

        assert_eq!(count.load(Ordering::SeqCst), 1);
    }
}
