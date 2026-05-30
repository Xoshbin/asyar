use asyar_lib::browser::bridge::{
    cache::TabSnapshotCache, connections::CompanionRegistry, pairing::PairingRegistry,
    rate_limit::ConnectionRateLimiter, server::start_server, token_store::InMemoryTokenStore,
    BridgeState,
};
use asyar_lib::browser::service::BrowserService;
use asyar_lib::browser::types::{BrowserFamily, BrowserId, BrowserKey, PairDecision};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

fn build_state() -> BridgeState<tauri::test::MockRuntime> {
    let app = tauri::test::mock_app();
    BridgeState {
        tokens: Arc::new(InMemoryTokenStore::new()),
        pairing: Arc::new(PairingRegistry::new()),
        connections: Arc::new(CompanionRegistry::new()),
        cache: Arc::new(TabSnapshotCache::new()),
        events: Arc::new(asyar_lib::browser::events::BrowserEventsHub::new()),
        last_active: Arc::new(std::sync::RwLock::new(None)),
        // High capacity so the throttle never interferes with the multi-step
        // pairing/round-trip flows exercised here.
        rate_limiter: Arc::new(ConnectionRateLimiter::new(10_000.0, 10_000.0)),
        app_handle: app.handle().clone(),
    }
}

#[tokio::test]
async fn full_pairing_then_tabs_round_trip() {
    let state = build_state();
    let server = start_server(state.clone()).await.unwrap();
    let port = server.port();
    let http = reqwest::Client::new();

    // 1) Discover.
    let disc: serde_json::Value = http
        .get(format!("http://127.0.0.1:{}/discover", port))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(disc["name"], "asyar");

    // 2) Pair request.
    let req: serde_json::Value = http
        .post(format!("http://127.0.0.1:{}/pair-request", port))
        .json(&serde_json::json!({ "family": "chromium", "variant": "chrome" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let pairing_id = req["pairing_id"].as_str().unwrap().to_string();

    // 3) Simulate user clicking Allow.
    let state2 = state.clone();
    let id = pairing_id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let token = "issued-token".to_string();
        state2
            .tokens
            .set(
                &BrowserKey {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                },
                &token,
            )
            .unwrap();
        state2
            .pairing
            .resolve(&id, PairDecision::Allow, Some(token))
            .await
            .unwrap();
    });

    let status: serde_json::Value = http
        .get(format!(
            "http://127.0.0.1:{}/pair-status/{}",
            port, pairing_id
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["status"], "approved");
    let token = status["token"].as_str().unwrap().to_string();

    // 4) Connect WS with the token.
    let url = format!(
        "ws://127.0.0.1:{}/bridge?family=chromium&variant=chrome",
        port
    );
    let mut wreq = url.into_client_request().unwrap();
    wreq.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
    );
    let (mut ws, _) = tokio_tungstenite::connect_async(wreq).await.unwrap();

    // 5) Send hello.
    ws.send(Message::Text(
        r#"{"type":"hello","version":1,"browser":{"family":"chromium","variant":"chrome","profiles":["Default"]}}"#.to_string(),
    ))
    .await
    .unwrap();

    // 6) Send a tab snapshot.
    let snapshot = serde_json::json!({
        "type": "event",
        "name": "tabs.snapshot",
        "payload": [{
            "id": "tab-1",
            "browser": { "family": "chromium", "variant": "chrome", "profileId": "Default" },
            "windowId": "w1",
            "index": 0,
            "title": "Test",
            "url": "https://test.com",
            "isActive": true,
            "isPinned": false,
            "isAudible": false,
        }]
    });
    ws.send(Message::Text(snapshot.to_string())).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let tabs = state.cache.list_all();
    assert_eq!(tabs.len(), 1, "snapshot did not populate cache");
    assert_eq!(tabs[0].id, "tab-1");

    // 7) Server-initiated RPC: send tabs.activate, expect mock to receive and respond.
    let key = BrowserKey {
        family: BrowserFamily::Chromium,
        variant: "chrome".to_string(),
    };
    let state_clone = state.clone();
    let rpc_task = tokio::spawn(async move {
        state_clone
            .connections
            .send_req(
                &key,
                "tabs.activate".to_string(),
                serde_json::json!({ "tabId": "tab-1" }),
                std::time::Duration::from_secs(3),
            )
            .await
    });

    // Mock companion: read the Req, respond with Res.
    let msg = ws.next().await.unwrap().unwrap();
    let parsed: serde_json::Value = match msg {
        Message::Text(s) => serde_json::from_str(&s).unwrap(),
        other => panic!("unexpected ws message: {:?}", other),
    };
    assert_eq!(parsed["type"], "req");
    assert_eq!(parsed["method"], "tabs.activate");
    let req_id = parsed["id"].as_str().unwrap();
    let res = serde_json::json!({
        "type": "res",
        "id": req_id,
        "ok": true,
        "result": { "activated": true },
    });
    ws.send(Message::Text(res.to_string())).await.unwrap();

    let rpc_result = rpc_task.await.unwrap().unwrap();
    assert_eq!(rpc_result, serde_json::json!({ "activated": true }));

    // 8) Clean up.
    ws.close(None).await.unwrap();
    drop(ws);
    server.shutdown().await;
}

#[tokio::test]
async fn full_pairing_then_page_methods_round_trip() {
    let state = build_state();
    let server = start_server(state.clone()).await.unwrap();
    let port = server.port();
    let http = reqwest::Client::new();

    let req: serde_json::Value = http
        .post(format!("http://127.0.0.1:{}/pair-request", port))
        .json(&serde_json::json!({ "family": "chromium", "variant": "chrome" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let pairing_id = req["pairing_id"].as_str().unwrap().to_string();

    let state2 = state.clone();
    let id = pairing_id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let token = "tok-page".to_string();
        state2
            .tokens
            .set(
                &BrowserKey {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                },
                &token,
            )
            .unwrap();
        state2
            .pairing
            .resolve(&id, PairDecision::Allow, Some(token))
            .await
            .unwrap();
    });

    let status: serde_json::Value = http
        .get(format!(
            "http://127.0.0.1:{}/pair-status/{}",
            port, pairing_id
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let token = status["token"].as_str().unwrap().to_string();

    let url = format!(
        "ws://127.0.0.1:{}/bridge?family=chromium&variant=chrome",
        port
    );
    let mut wreq = url.into_client_request().unwrap();
    wreq.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
    );
    let (mut ws, _) = tokio_tungstenite::connect_async(wreq).await.unwrap();

    ws.send(Message::Text(r#"{"type":"hello","version":1,"browser":{"family":"chromium","variant":"chrome","profiles":["Default"]}}"#.to_string())).await.unwrap();

    // Send a page.changed event and verify the Hub receives it.
    use asyar_lib::browser::events::{BrowserEvent, BrowserEventKind};
    use asyar_lib::event_hub::fake::RecordingEmitter;
    use std::collections::HashSet;
    let rec: RecordingEmitter<BrowserEvent> = RecordingEmitter::new();
    state.events.set_emitter(rec.clone().into_emit_fn());
    let mut kinds = HashSet::new();
    kinds.insert(BrowserEventKind::PageChanged);
    state.events.subscribe("ext-page", kinds).unwrap();

    let page_event = serde_json::json!({
        "type": "event",
        "name": "page.changed",
        "payload": {
            "tabId": "t1",
            "page": { "url": "https://x", "title": "T", "readableText": "body", "meta": {} }
        }
    });
    ws.send(Message::Text(page_event.to_string()))
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let got = rec.snapshot();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].0, "ext-page");
    assert!(matches!(got[0].1, BrowserEvent::PageChanged { .. }));

    // Server-initiated page.snapshot RPC
    let key = BrowserKey {
        family: BrowserFamily::Chromium,
        variant: "chrome".to_string(),
    };
    let state_clone = state.clone();
    let rpc_task = tokio::spawn(async move {
        state_clone
            .connections
            .send_req(
                &key,
                "page.snapshot".to_string(),
                serde_json::json!({ "tabId": "t1" }),
                std::time::Duration::from_secs(3),
            )
            .await
    });

    let msg = ws.next().await.unwrap().unwrap();
    let parsed: serde_json::Value = match msg {
        Message::Text(s) => serde_json::from_str(&s).unwrap(),
        _ => panic!("unexpected ws message"),
    };
    assert_eq!(parsed["type"], "req");
    assert_eq!(parsed["method"], "page.snapshot");
    let req_id = parsed["id"].as_str().unwrap();
    let res = serde_json::json!({
        "type": "res",
        "id": req_id,
        "ok": true,
        "result": { "url": "https://x", "title": "T", "readableText": "body", "meta": {} },
    });
    ws.send(Message::Text(res.to_string())).await.unwrap();

    let rpc_result = rpc_task.await.unwrap().unwrap();
    assert_eq!(rpc_result["url"], "https://x");

    ws.close(None).await.unwrap();
    server.shutdown().await;
}

#[tokio::test]
async fn subscribed_extension_receives_dispatched_event() {
    use asyar_lib::browser::events::{BrowserEvent, BrowserEventKind};
    use asyar_lib::event_hub::fake::RecordingEmitter;
    use std::collections::HashSet;

    let state = build_state();
    let rec: RecordingEmitter<BrowserEvent> = RecordingEmitter::new();
    state.events.set_emitter(rec.clone().into_emit_fn());

    // Subscribe one extension.
    let mut kinds = HashSet::new();
    kinds.insert(BrowserEventKind::TabsChanged);
    let _sub_id = state.events.subscribe("ext-a", kinds).unwrap();

    // Pair + connect + send a tabs.snapshot — same flow as
    // `full_pairing_then_tabs_round_trip` but trimmed to the part we need.
    let server = start_server(state.clone()).await.unwrap();
    let port = server.port();
    let http = reqwest::Client::new();
    let req: serde_json::Value = http
        .post(format!("http://127.0.0.1:{}/pair-request", port))
        .json(&serde_json::json!({ "family": "chromium", "variant": "chrome" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let pairing_id = req["pairing_id"].as_str().unwrap().to_string();

    let state2 = state.clone();
    let id = pairing_id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let token = "tok".to_string();
        state2
            .tokens
            .set(
                &BrowserKey {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                },
                &token,
            )
            .unwrap();
        state2
            .pairing
            .resolve(&id, PairDecision::Allow, Some(token))
            .await
            .unwrap();
    });

    let status: serde_json::Value = http
        .get(format!(
            "http://127.0.0.1:{}/pair-status/{}",
            port, pairing_id
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let token = status["token"].as_str().unwrap().to_string();

    let url = format!(
        "ws://127.0.0.1:{}/bridge?family=chromium&variant=chrome",
        port
    );
    let mut wreq = url.into_client_request().unwrap();
    wreq.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
    );
    let (mut ws, _) = tokio_tungstenite::connect_async(wreq).await.unwrap();
    ws.send(Message::Text(
        r#"{"type":"hello","version":1,"browser":{"family":"chromium","variant":"chrome","profiles":["Default"]}}"#.to_string(),
    )).await.unwrap();

    let snapshot = serde_json::json!({
        "type": "event",
        "name": "tabs.snapshot",
        "payload": [{
            "id": "tab-1",
            "browser": { "family": "chromium", "variant": "chrome", "profileId": "Default" },
            "windowId": "w1", "index": 0,
            "title": "Test", "url": "https://test.com",
            "isActive": true, "isPinned": false, "isAudible": false,
        }]
    });
    ws.send(Message::Text(snapshot.to_string())).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let snap = rec.snapshot();
    assert_eq!(
        snap.len(),
        1,
        "exactly one dispatch expected, got {:?}",
        snap
    );
    assert_eq!(snap[0].0, "ext-a");
    assert!(matches!(snap[0].1, BrowserEvent::TabsChanged { .. }));

    ws.close(None).await.unwrap();
    server.shutdown().await;
}

#[tokio::test]
async fn unsubscribed_extension_receives_nothing() {
    use asyar_lib::browser::events::BrowserEvent;
    use asyar_lib::event_hub::fake::RecordingEmitter;

    let state = build_state();
    let rec: RecordingEmitter<BrowserEvent> = RecordingEmitter::new();
    state.events.set_emitter(rec.clone().into_emit_fn());
    // Intentionally no subscriber.

    let server = start_server(state.clone()).await.unwrap();
    let port = server.port();
    let http = reqwest::Client::new();
    let req: serde_json::Value = http
        .post(format!("http://127.0.0.1:{}/pair-request", port))
        .json(&serde_json::json!({ "family": "chromium", "variant": "chrome" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let pairing_id = req["pairing_id"].as_str().unwrap().to_string();

    let state2 = state.clone();
    let id = pairing_id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let token = "tok2".to_string();
        state2
            .tokens
            .set(
                &BrowserKey {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                },
                &token,
            )
            .unwrap();
        state2
            .pairing
            .resolve(&id, PairDecision::Allow, Some(token))
            .await
            .unwrap();
    });
    let status: serde_json::Value = http
        .get(format!(
            "http://127.0.0.1:{}/pair-status/{}",
            port, pairing_id
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let token = status["token"].as_str().unwrap().to_string();

    let url = format!(
        "ws://127.0.0.1:{}/bridge?family=chromium&variant=chrome",
        port
    );
    let mut wreq = url.into_client_request().unwrap();
    wreq.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
    );
    let (mut ws, _) = tokio_tungstenite::connect_async(wreq).await.unwrap();
    ws.send(Message::Text(
        r#"{"type":"hello","version":1,"browser":{"family":"chromium","variant":"chrome","profiles":["Default"]}}"#.to_string(),
    )).await.unwrap();
    ws.send(Message::Text(
        serde_json::json!({
            "type": "event", "name": "tabs.snapshot",
            "payload": [{
                "id": "x",
                "browser": { "family": "chromium", "variant": "chrome", "profileId": "Default" },
                "windowId": "w", "index": 0,
                "title": "T", "url": "U",
                "isActive": true, "isPinned": false, "isAudible": false,
            }]
        })
        .to_string(),
    ))
    .await
    .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    assert!(
        rec.snapshot().is_empty(),
        "no subscribers → no dispatches, got {:?}",
        rec.snapshot()
    );

    ws.close(None).await.unwrap();
    server.shutdown().await;
}

#[tokio::test]
async fn search_web_and_focus_round_trip() {
    let state = build_state();
    let server = start_server(state.clone()).await.unwrap();
    let port = server.port();
    let http = reqwest::Client::new();

    // 1) Discover.
    let disc: serde_json::Value = http
        .get(format!("http://127.0.0.1:{}/discover", port))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(disc["name"], "asyar");

    // 2) Pair request.
    let req: serde_json::Value = http
        .post(format!("http://127.0.0.1:{}/pair-request", port))
        .json(&serde_json::json!({ "family": "chromium", "variant": "chrome" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let pairing_id = req["pairing_id"].as_str().unwrap().to_string();

    // 3) Simulate user clicking Allow.
    let state2 = state.clone();
    let id = pairing_id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let token = "tok-search-focus".to_string();
        state2
            .tokens
            .set(
                &BrowserKey {
                    family: BrowserFamily::Chromium,
                    variant: "chrome".to_string(),
                },
                &token,
            )
            .unwrap();
        state2
            .pairing
            .resolve(&id, PairDecision::Allow, Some(token))
            .await
            .unwrap();
    });

    // 4) Poll pair-status.
    let status: serde_json::Value = http
        .get(format!(
            "http://127.0.0.1:{}/pair-status/{}",
            port, pairing_id
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["status"], "approved");
    let token = status["token"].as_str().unwrap().to_string();

    // 5) Connect WS with the token.
    let url = format!(
        "ws://127.0.0.1:{}/bridge?family=chromium&variant=chrome",
        port
    );
    let mut wreq = url.into_client_request().unwrap();
    wreq.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {}", token)).unwrap(),
    );
    let (mut ws, _) = tokio_tungstenite::connect_async(wreq).await.unwrap();

    // 6) Send hello.
    ws.send(Message::Text(
        r#"{"type":"hello","version":1,"browser":{"family":"chromium","variant":"chrome","profiles":["Default"]}}"#.to_string(),
    ))
    .await
    .unwrap();

    // --- Assertion 1: window.focused → last_active tracking ---
    let focus_event = serde_json::json!({
        "type": "event",
        "name": "window.focused",
        "payload": {}
    });
    ws.send(Message::Text(focus_event.to_string()))
        .await
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    let last = state.last_active.read().unwrap().clone();
    assert_eq!(
        last,
        Some(BrowserKey {
            family: BrowserFamily::Chromium,
            variant: "chrome".to_string(),
        })
    );

    // --- Assertion 2: search.web RPC round-trip via BrowserService ---
    let svc = BrowserService::new();
    let state_clone = state.clone();
    let rpc_task = tokio::spawn(async move {
        svc.search_web(
            &state_clone,
            "react".to_string(),
            Some(BrowserId {
                family: BrowserFamily::Chromium,
                variant: "chrome".to_string(),
                profile_id: "Default".to_string(),
            }),
        )
        .await
    });

    let msg = ws.next().await.unwrap().unwrap();
    let parsed: serde_json::Value = match msg {
        Message::Text(s) => serde_json::from_str(&s).unwrap(),
        other => panic!("unexpected ws message: {:?}", other),
    };
    assert_eq!(parsed["type"], "req");
    assert_eq!(parsed["method"], "search.web");
    assert_eq!(parsed["params"]["text"], "react");
    let req_id = parsed["id"].as_str().unwrap();
    let res = serde_json::json!({ "type": "res", "id": req_id, "ok": true, "result": { "searched": true } });
    ws.send(Message::Text(res.to_string())).await.unwrap();
    rpc_task.await.unwrap().unwrap();

    ws.close(None).await.unwrap();
    server.shutdown().await;
}
