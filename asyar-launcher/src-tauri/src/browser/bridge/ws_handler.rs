use crate::browser::bridge::protocol::{CompanionMessage, ServerMessage};
use crate::browser::bridge::BridgeState;
use crate::browser::types::{BrowserKey, Tab};
use axum::extract::ws::{Message, WebSocket};
use tokio::sync::mpsc;

pub async fn handle_socket<R: tauri::Runtime>(
    socket: WebSocket,
    state: BridgeState<R>,
    key: BrowserKey,
) {
    let (tx, mut rx) = mpsc::channel::<ServerMessage>(32);
    state.connections.register(key.clone(), tx).await;

    use futures_util::{SinkExt, StreamExt};
    let (mut sender, mut receiver) = socket.split();

    let outbound = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let raw = match serde_json::to_string(&msg) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if sender.send(Message::Text(raw)).await.is_err() {
                break;
            }
        }
    });

    let state_inner = state.clone();
    let key_inner = key.clone();
    let inbound = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            let text = match msg {
                Message::Text(t) => t,
                Message::Close(_) => break,
                _ => continue,
            };
            let parsed: CompanionMessage = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(_) => continue,
            };
            dispatch_message(&state_inner, &key_inner, parsed).await;
        }
    });

    let _ = tokio::join!(outbound, inbound);
    state.connections.unregister(&key).await;

    use tauri::Emitter;
    let _ = state.app_handle.emit(
        "browser:companion-disconnected",
        serde_json::json!({
            "family": format!("{:?}", key.family).to_lowercase(),
            "variant": key.variant,
        }),
    );
}

async fn dispatch_message<R: tauri::Runtime>(
    state: &BridgeState<R>,
    key: &BrowserKey,
    msg: CompanionMessage,
) {
    use tauri::Emitter;
    match msg {
        CompanionMessage::Hello { .. } => {
            let _ = state.app_handle.emit(
                "browser:companion-connected",
                serde_json::json!({
                    "family": format!("{:?}", key.family).to_lowercase(),
                    "variant": key.variant,
                }),
            );
        }
        CompanionMessage::Event { name, payload } => match name.as_str() {
            "tabs.snapshot" | "tabs.changed" => {
                if let Ok(snapshot) = serde_json::from_value::<Vec<Tab>>(payload) {
                    state.cache.set(key, snapshot.clone());
                    state
                        .events
                        .dispatch(crate::browser::events::BrowserEvent::TabsChanged {
                            browser: key.clone(),
                            tabs: snapshot,
                        });
                }
            }
            "page.changed" => {
                #[derive(serde::Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct PageChangedPayload {
                    tab_id: String,
                    page: crate::browser::types::PageSnapshot,
                }
                if let Ok(pc) = serde_json::from_value::<PageChangedPayload>(payload) {
                    state
                        .events
                        .dispatch(crate::browser::events::BrowserEvent::PageChanged {
                            browser: key.clone(),
                            tab_id: pc.tab_id,
                            page: pc.page,
                        });
                }
            }
            "window.focused" => {
                if let Ok(mut guard) = state.last_active.write() {
                    *guard = Some(key.clone());
                }
            }
            _ => {}
        },
        CompanionMessage::Res {
            id,
            ok,
            result,
            error,
        } => {
            let outcome = if ok {
                Ok(result.unwrap_or(serde_json::Value::Null))
            } else {
                Err(error.unwrap_or_else(|| "unknown error".to_string()))
            };
            let _ = state.connections.deliver_response(&id, outcome).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::bridge::{
        cache::TabSnapshotCache, connections::CompanionRegistry, pairing::PairingRegistry,
        token_store::InMemoryTokenStore, BridgeState,
    };
    use crate::browser::events::{BrowserEvent, BrowserEventKind, BrowserEventsHub};
    use crate::browser::types::{BrowserFamily, BrowserKey};
    use crate::event_hub::fake::RecordingEmitter;
    use std::collections::HashSet;
    use std::sync::Arc;

    fn build_state() -> BridgeState<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        BridgeState {
            tokens: Arc::new(InMemoryTokenStore::new()),
            pairing: Arc::new(PairingRegistry::new()),
            connections: Arc::new(CompanionRegistry::new()),
            cache: Arc::new(TabSnapshotCache::new()),
            events: Arc::new(BrowserEventsHub::new()),
            last_active: Arc::new(std::sync::RwLock::new(None)),
            app_handle: app.handle().clone(),
        }
    }

    #[tokio::test]
    async fn tabs_snapshot_dispatches_to_subscribed_extension_only() {
        let state = build_state();
        let rec: RecordingEmitter<BrowserEvent> = RecordingEmitter::new();
        state.events.set_emitter(rec.clone().into_emit_fn());

        let mut kinds = HashSet::new();
        kinds.insert(BrowserEventKind::TabsChanged);
        let _ = state.events.subscribe("ext-a", kinds).unwrap();

        let key = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        let payload = serde_json::json!([{
            "id": "1",
            "browser": { "family": "chromium", "variant": "chrome", "profileId": "Default" },
            "windowId": "w", "index": 0,
            "title": "T", "url": "U",
            "isActive": true, "isPinned": false, "isAudible": false,
        }]);
        let msg = CompanionMessage::Event {
            name: "tabs.snapshot".to_string(),
            payload,
        };
        dispatch_message(&state, &key, msg).await;

        let snap = rec.snapshot();
        assert_eq!(snap.len(), 1, "exactly one dispatch expected");
        assert_eq!(snap[0].0, "ext-a");
        assert!(matches!(snap[0].1, BrowserEvent::TabsChanged { .. }));
    }

    #[tokio::test]
    async fn tabs_snapshot_with_no_subscribers_dispatches_nothing() {
        let state = build_state();
        let rec: RecordingEmitter<BrowserEvent> = RecordingEmitter::new();
        state.events.set_emitter(rec.clone().into_emit_fn());
        // No subscriber registered.

        let key = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        let payload = serde_json::json!([{
            "id": "1",
            "browser": { "family": "chromium", "variant": "chrome", "profileId": "Default" },
            "windowId": "w", "index": 0,
            "title": "T", "url": "U",
            "isActive": true, "isPinned": false, "isAudible": false,
        }]);
        dispatch_message(
            &state,
            &key,
            CompanionMessage::Event {
                name: "tabs.snapshot".to_string(),
                payload,
            },
        )
        .await;

        assert!(rec.snapshot().is_empty(), "no subscribers -> no dispatch");
    }

    #[tokio::test]
    async fn tabs_snapshot_still_populates_cache_even_without_subscribers() {
        let state = build_state();
        // No subscribers and no emitter.

        let key = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        let payload = serde_json::json!([{
            "id": "tab-cache",
            "browser": { "family": "chromium", "variant": "chrome", "profileId": "Default" },
            "windowId": "w", "index": 0,
            "title": "T", "url": "U",
            "isActive": true, "isPinned": false, "isAudible": false,
        }]);
        dispatch_message(
            &state,
            &key,
            CompanionMessage::Event {
                name: "tabs.snapshot".to_string(),
                payload,
            },
        )
        .await;

        let cached = state.cache.list_all();
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].id, "tab-cache");
    }

    #[tokio::test]
    async fn window_focused_event_updates_last_active() {
        let state = build_state();
        let key = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        let msg = CompanionMessage::Event {
            name: "window.focused".to_string(),
            payload: serde_json::json!({}),
        };
        dispatch_message(&state, &key, msg).await;
        let got = state.last_active.read().unwrap().clone();
        assert_eq!(got, Some(key));
    }

    #[tokio::test]
    async fn page_changed_event_dispatches_via_hub() {
        let state = build_state();
        let rec: RecordingEmitter<BrowserEvent> = RecordingEmitter::new();
        state.events.set_emitter(rec.clone().into_emit_fn());

        let mut kinds = HashSet::new();
        kinds.insert(BrowserEventKind::PageChanged);
        let _ = state.events.subscribe("ext-a", kinds).unwrap();

        let key = BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        };
        let msg = CompanionMessage::Event {
            name: "page.changed".to_string(),
            payload: serde_json::json!({
                "tabId": "t1",
                "page": {
                    "url": "https://x",
                    "title": "T",
                    "readableText": "body",
                    "meta": {}
                }
            }),
        };
        dispatch_message(&state, &key, msg).await;

        let got = rec.snapshot();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].0, "ext-a");
        assert!(matches!(got[0].1, BrowserEvent::PageChanged { .. }));
    }
}
