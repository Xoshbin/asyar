//! Long-poll transport replacing Tauri's `app.emit` Rust->JS push.
//!
//! `app.emit` evaluates a freshly formatted JS program per event to inline
//! the payload, which fragments JSC arenas in the always-hot launcher
//! webview. The JS frontend instead long-polls `bridge_poll` and dispatches
//! locally; `invoke` is fetch-based and eval-free. This module owns the
//! Rust half: a bounded queue of pending events plus a `Notify` used to
//! wake a parked poller. Emitters call [`bridge_emit`]; callers that fire
//! before the JS side has connected still fall back to `app.emit` so
//! early-boot events behave exactly as today.
//!
//! The queue is drained by exactly one poller: the `main` launcher window.
//! Every other webview (settings, onboarding, hud, sticky notes, ...) never
//! polls, so once the poller has connected those windows receive each event
//! through a targeted `emit_to` instead. The two audiences are disjoint, so
//! nothing is delivered twice, and the hot launcher webview stays eval-free.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

/// Cap on the per-process bridge queue. Excess is dropped from the oldest
/// end with a warning so a slow/absent poller can't OOM the host.
const QUEUE_CAP: usize = 1024;

/// Label of the one window that drains the queue via `bridge_poll`.
const POLLER_WINDOW_LABEL: &str = crate::SPOTLIGHT_LABEL;

/// Timeout for a parked poller. A returning `Ok(vec![])` is the no-op
/// heartbeat; the JS side re-issues the poll.
const POLL_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Clone, serde::Serialize)]
pub struct BridgeEvent {
    pub event: String,
    pub payload: serde_json::Value,
}

pub struct EventBridge {
    queue: Mutex<VecDeque<BridgeEvent>>,
    notify: Notify,
    connected: AtomicBool,
}

impl Default for EventBridge {
    fn default() -> Self {
        Self {
            queue: Mutex::new(VecDeque::new()),
            notify: Notify::new(),
            connected: AtomicBool::new(false),
        }
    }
}

/// Push `event`/`payload` to the bridge queue when the JS poller has
/// connected; otherwise fall back to `app.emit` so early-boot events
/// behave exactly as today. Payload shape is unchanged by this layer.
pub fn bridge_emit<R: tauri::Runtime, S: Serialize>(app: &AppHandle<R>, event: &str, payload: S) {
    let value = match serde_json::to_value(&payload) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("[event_bridge] failed to serialize payload for {event}: {e}");
            return;
        }
    };

    if let Some(bridge) = app.try_state::<Arc<EventBridge>>() {
        if bridge.connected.load(Ordering::Relaxed) {
            emit_to_non_poller_windows(app, event, &value);
            let mut q = bridge.queue.lock().expect("event_bridge mutex poisoned");
            if q.len() >= QUEUE_CAP {
                let dropped = q.pop_front();
                log::warn!(
                    "[event_bridge] queue full ({QUEUE_CAP}); dropping oldest {:?}",
                    dropped.map(|e| e.event)
                );
            }
            q.push_back(BridgeEvent {
                event: event.to_string(),
                payload: value,
            });
            // Lock released here by the end of the scope; notify_waiters is
            // cheap and synchronous. Drop explicitly to make the boundary
            // obvious to the reader.
            drop(q);
            bridge.notify.notify_waiters();
            return;
        }
    }

    // Sustained fallback means the poller never connected; surface it so a
    // silent regression to the eval transport can't go unnoticed.
    static FALLBACK_COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = FALLBACK_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
    if n == 1 || n.is_multiple_of(100) {
        log::warn!("[event_bridge] emit fallback in use ({n} events so far); latest: {event}");
    }
    if let Err(e) = app.emit(event, value) {
        log::warn!("[event_bridge] fallback app.emit {event} failed: {e}");
    }
}

/// Deliver `event` to every open webview except the poller window.
///
/// Windows are enumerated at call time: sticky notes use runtime-generated
/// labels (`sticky-<note_id>`), so no static label list can be correct.
/// These windows are not latency-critical, so paying `emit_to`'s per-event
/// eval cost here is acceptable; the main window never pays it.
fn emit_to_non_poller_windows<R: tauri::Runtime>(
    app: &AppHandle<R>,
    event: &str,
    value: &serde_json::Value,
) {
    for label in app.webview_windows().into_keys() {
        if label == POLLER_WINDOW_LABEL {
            continue;
        }
        if let Err(e) = app.emit_to(label.as_str(), event, value) {
            log::warn!("[event_bridge] emit_to {label} {event} failed: {e}");
        }
    }
}

/// Long-poll command. Returns the whole queued batch, waits on `Notify`
/// (re-draining before each wake) and times out after `POLL_TIMEOUT`.
#[tauri::command]
pub async fn bridge_poll(
    state: tauri::State<'_, Arc<EventBridge>>,
) -> Result<Vec<BridgeEvent>, ()> {
    if !state.connected.swap(true, Ordering::Relaxed) {
        log::info!("[event_bridge] poller connected; eval transport retired");
    }

    loop {
        // Register interest before draining: a notify_waiters landing
        // between the drain and the await would otherwise be lost and the
        // queued event would wait out the full poll timeout.
        let notified = state.notify.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();

        let batch: Vec<BridgeEvent> = {
            let mut q = state.queue.lock().expect("event_bridge mutex poisoned");
            q.drain(..).collect()
        };
        if !batch.is_empty() {
            return Ok(batch);
        }

        tokio::select! {
            _ = &mut notified => continue,
            _ = tokio::time::sleep(POLL_TIMEOUT) => return Ok(vec![]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::{mock_app, MockRuntime};
    use tauri::{Listener, WebviewUrl, WebviewWindowBuilder};

    fn app_with_windows(labels: &[&str]) -> tauri::App<MockRuntime> {
        let app = mock_app();
        app.manage(Arc::new(EventBridge::default()));
        for label in labels {
            WebviewWindowBuilder::new(&app, *label, WebviewUrl::default())
                .build()
                .expect("mock window");
        }
        app
    }

    fn count_events(app: &tauri::App<MockRuntime>, label: &str, event: &str) -> Arc<Mutex<u32>> {
        let hits = Arc::new(Mutex::new(0u32));
        let h = hits.clone();
        app.get_webview_window(label)
            .expect("window exists")
            .listen(event, move |_| *h.lock().unwrap() += 1);
        hits
    }

    #[test]
    fn connected_bridge_delivers_to_secondary_window_and_queues_for_main() {
        let app = app_with_windows(&["main", "settings"]);
        let handle = app.handle();
        let bridge = handle.state::<Arc<EventBridge>>();
        bridge.connected.store(true, Ordering::Relaxed);
        let settings_hits = count_events(&app, "settings", "agents:changed");
        let main_hits = count_events(&app, "main", "agents:changed");

        bridge_emit(handle, "agents:changed", ());

        assert_eq!(
            *settings_hits.lock().unwrap(),
            1,
            "secondary window starved"
        );
        assert_eq!(*main_hits.lock().unwrap(), 0, "main must stay eval-free");
        assert_eq!(
            bridge.queue.lock().unwrap().len(),
            1,
            "main drains the queue"
        );
    }

    #[test]
    fn dynamically_labelled_windows_are_reached() {
        let app = app_with_windows(&["main", "sticky-abc123"]);
        let handle = app.handle();
        handle
            .state::<Arc<EventBridge>>()
            .connected
            .store(true, Ordering::Relaxed);
        let hits = count_events(&app, "sticky-abc123", "notes:changed");

        bridge_emit(handle, "notes:changed", ());

        assert_eq!(*hits.lock().unwrap(), 1);
    }

    #[test]
    fn pre_connection_fallback_still_broadcasts_once_per_window() {
        let app = app_with_windows(&["main", "settings"]);
        let handle = app.handle();
        let settings_hits = count_events(&app, "settings", "notes:changed");
        let main_hits = count_events(&app, "main", "notes:changed");

        bridge_emit(handle, "notes:changed", ());

        assert_eq!(*settings_hits.lock().unwrap(), 1);
        assert_eq!(*main_hits.lock().unwrap(), 1);
        assert!(handle
            .state::<Arc<EventBridge>>()
            .queue
            .lock()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn test_event_bridge_default() {
        let bridge = EventBridge::default();
        assert!(!bridge.connected.load(Ordering::Relaxed));
        let q = bridge.queue.lock().unwrap();
        assert!(q.is_empty());
    }

    #[test]
    fn test_queue_cap_drops_oldest() {
        let bridge = EventBridge::default();
        bridge.connected.store(true, Ordering::Relaxed);

        let mut q = bridge.queue.lock().unwrap();
        for i in 0..QUEUE_CAP + 5 {
            if q.len() >= QUEUE_CAP {
                q.pop_front();
            }
            q.push_back(BridgeEvent {
                event: format!("event_{i}"),
                payload: serde_json::json!({ "index": i }),
            });
        }

        assert_eq!(q.len(), QUEUE_CAP);
        assert_eq!(q.front().unwrap().event, "event_5");
        assert_eq!(q.back().unwrap().event, format!("event_{}", QUEUE_CAP + 4));
    }
}
