use super::emitter::{emit_typed, EventEmitter};
use super::IframeLifecycle;
use crate::commands::iframe_lifecycle::{EVENT_DEGRADED, EVENT_UNMOUNT};
use std::sync::Mutex;
use std::time::Instant;

pub(crate) fn tick_once(
    lc: &Mutex<IframeLifecycle>,
    emitter: &dyn EventEmitter,
    now: Instant,
) {
    let actions = {
        let mut guard = lc.lock().expect("lifecycle lock");
        guard.tick(now)
    };

    for ext in actions.idle_unmounts {
        emit_typed(
            emitter,
            EVENT_UNMOUNT,
            &serde_json::json!({ "extensionId": ext, "reason": "idle" }),
        );
    }

    for (ext, token) in actions.timeouts {
        let outcome = {
            let mut guard = lc.lock().expect("lifecycle lock");
            guard.on_mount_timeout(&ext, token, now)
        };
        emit_typed(
            emitter,
            EVENT_UNMOUNT,
            &serde_json::json!({ "extensionId": ext, "reason": "timeout" }),
        );
        if outcome.transition_to_degraded {
            emit_typed(
                emitter,
                EVENT_DEGRADED,
                &serde_json::json!({
                    "extensionId": ext,
                    "strikes": outcome.new_strike_count,
                }),
            );
        }
    }
}

use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use super::emitter::TauriEventEmitter;

pub fn spawn_ticker(app: AppHandle, lc: Arc<Mutex<IframeLifecycle>>, interval: Duration) {
    // Route through Tauri's managed async runtime rather than calling
    // `tokio::spawn` directly. `setup_app` runs before any Tokio reactor
    // is attached to the current thread, so `tokio::spawn` panics with
    // "there is no reactor running". `tauri::async_runtime::spawn` uses
    // the runtime handle Tauri owns, which is always available here.
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        ticker.tick().await; // skip immediate first
        loop {
            ticker.tick().await;
            let emitter = TauriEventEmitter { app: app.clone() };
            tick_once(lc.as_ref(), &emitter, Instant::now());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::iframe_lifecycle::dispatch_to_extension_inner;
    use crate::extensions::iframe_lifecycle::emitter::RecordingEmitter;
    use crate::extensions::iframe_lifecycle::types::*;
    use crate::extensions::iframe_lifecycle::wire::{IpcDispatchOutcome, IpcPendingMessage};

    fn lc() -> Mutex<IframeLifecycle> {
        Mutex::new(IframeLifecycle::new(LifecycleConfig::default()))
    }

    #[test]
    fn tick_emits_unmount_idle_after_keep_alive() {
        let lc = lc();
        let e = RecordingEmitter::default();
        let t0 = Instant::now();

        let out = dispatch_to_extension_inner(
            &lc, &e, "ext.a".into(),
            IpcPendingMessage {
                kind: MessageKind::Command,
                payload: serde_json::json!({}),
                source: TriggerSource::Search,
            },
            t0,
        ).unwrap();
        let token = match out { IpcDispatchOutcome::NeedsMount { mount_token } => mount_token, _ => panic!() };
        {
            let mut guard = lc.lock().unwrap();
            guard.on_ready_ack("ext.a", token, t0);
        }

        let later = t0 + Duration::from_secs(421);
        tick_once(&lc, &e, later);
        let unmounts: Vec<_> = e.events().into_iter()
            .filter(|(n, _)| n == EVENT_UNMOUNT)
            .collect();
        assert_eq!(unmounts.len(), 1);
        assert_eq!(unmounts[0].1["reason"], "idle");
    }
}
