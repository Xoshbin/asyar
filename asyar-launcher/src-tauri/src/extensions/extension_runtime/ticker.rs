use super::emitter::{emit_typed, EventEmitter, TauriEventEmitter};
use super::manager::ExtensionRuntimeManager;
use super::types::ContextRole;
use super::{EVENT_DEGRADED, EVENT_UNMOUNT};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;

pub(crate) fn tick_once(
    mgr: &ExtensionRuntimeManager,
    emitter: &dyn EventEmitter,
    now: Instant,
) {
    // Tick worker — produces timeouts only (keep_alive=None, never idle-evicts).
    let worker_actions = mgr.tick_worker(now);
    for (ext, token) in worker_actions.timeouts {
        let outcome = mgr.on_mount_timeout(&ext, token, ContextRole::Worker, now);
        emit_typed(
            emitter,
            EVENT_UNMOUNT,
            &serde_json::json!({
                "extensionId": ext,
                "reason": "timeout",
                "role": ContextRole::Worker,
            }),
        );
        if outcome.transition_to_degraded {
            emit_typed(
                emitter,
                EVENT_DEGRADED,
                &serde_json::json!({
                    "extensionId": ext,
                    "strikes": outcome.new_strike_count,
                    "role": ContextRole::Worker,
                }),
            );
        }
    }

    // Tick view — produces both idle_unmounts and timeouts.
    let view_actions = mgr.tick_view(now);
    for ext in view_actions.idle_unmounts {
        emit_typed(
            emitter,
            EVENT_UNMOUNT,
            &serde_json::json!({
                "extensionId": ext,
                "reason": "idle",
                "role": ContextRole::View,
            }),
        );
    }
    for (ext, token) in view_actions.timeouts {
        let outcome = mgr.on_mount_timeout(&ext, token, ContextRole::View, now);
        emit_typed(
            emitter,
            EVENT_UNMOUNT,
            &serde_json::json!({
                "extensionId": ext,
                "reason": "timeout",
                "role": ContextRole::View,
            }),
        );
        if outcome.transition_to_degraded {
            emit_typed(
                emitter,
                EVENT_DEGRADED,
                &serde_json::json!({
                    "extensionId": ext,
                    "strikes": outcome.new_strike_count,
                    "role": ContextRole::View,
                }),
            );
        }
    }
}

pub fn spawn_ticker(app: AppHandle, mgr: Arc<ExtensionRuntimeManager>, interval: Duration) {
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
            tick_once(&mgr, &emitter, Instant::now());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::extension_runtime::emitter::RecordingEmitter;
    use crate::extensions::extension_runtime::types::*;

    fn mgr() -> ExtensionRuntimeManager {
        ExtensionRuntimeManager::new(RuntimeConfig::default())
    }

    fn cmd(src: TriggerSource) -> PendingMessage {
        PendingMessage {
            kind: MessageKind::Command,
            payload: serde_json::json!({}),
            enqueued_at: Instant::now(),
            source: src,
        }
    }

    #[test]
    fn tick_emits_view_unmount_idle_after_keep_alive() {
        let mgr = mgr();
        let e = RecordingEmitter::default();
        let t0 = Instant::now();

        let outcome = mgr.enqueue_view("ext.a", cmd(TriggerSource::Search), t0);
        let token = match outcome {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        mgr.on_ready_ack("ext.a", token, ContextRole::View, t0);

        let later = t0 + Duration::from_secs(121);
        tick_once(&mgr, &e, later);

        let unmounts: Vec<_> = e
            .events()
            .into_iter()
            .filter(|(n, _)| n == EVENT_UNMOUNT)
            .collect();
        assert_eq!(unmounts.len(), 1);
        assert_eq!(unmounts[0].1["reason"], "idle");
        assert_eq!(unmounts[0].1["role"], "view");
    }

    #[test]
    fn worker_ready_extension_never_evicted_by_tick() {
        let mgr = mgr();
        let e = RecordingEmitter::default();
        let t0 = Instant::now();

        let outcome = mgr.enqueue_worker("ext.a", cmd(TriggerSource::Timer), t0);
        let token = match outcome {
            DispatchOutcome::NeedsMount { mount_token } => mount_token,
            _ => panic!(),
        };
        mgr.on_ready_ack("ext.a", token, ContextRole::Worker, t0);

        let far = t0 + Duration::from_secs(86400);
        tick_once(&mgr, &e, far);

        let unmounts: Vec<_> = e
            .events()
            .into_iter()
            .filter(|(n, _)| n == EVENT_UNMOUNT)
            .collect();
        assert!(unmounts.is_empty(), "worker must never be idle-evicted");
    }

    #[test]
    fn tick_emits_unmount_timeout_with_role_in_payload() {
        let mgr = mgr();
        let e = RecordingEmitter::default();
        let t0 = Instant::now();

        mgr.enqueue_view("ext.a", cmd(TriggerSource::Search), t0);
        // Don't ACK — let it time out
        let after_timeout = t0 + Duration::from_secs(4); // > mount_timeout(3s)
        tick_once(&mgr, &e, after_timeout);

        let unmounts: Vec<_> = e
            .events()
            .into_iter()
            .filter(|(n, _)| n == EVENT_UNMOUNT)
            .collect();
        assert_eq!(unmounts.len(), 1);
        assert_eq!(unmounts[0].1["reason"], "timeout");
        assert_eq!(unmounts[0].1["role"], "view");
    }
}
