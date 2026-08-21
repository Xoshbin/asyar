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
pub fn bridge_emit<S: Serialize>(app: &AppHandle, event: &str, payload: S) {
    let value = match serde_json::to_value(&payload) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("[event_bridge] failed to serialize payload for {event}: {e}");
            return;
        }
    };

    if let Some(bridge) = app.try_state::<Arc<EventBridge>>() {
        if bridge.connected.load(Ordering::Relaxed) {
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
