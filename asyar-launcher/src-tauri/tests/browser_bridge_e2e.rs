use asyar_lib::browser::bridge::{
    cache::TabSnapshotCache, connections::CompanionRegistry, pairing::PairingRegistry,
    server::start_server, token_store::InMemoryTokenStore, BridgeState,
};
use asyar_lib::browser::types::{BrowserFamily, BrowserKey, PairDecision};
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
        .get(format!("http://127.0.0.1:{}/pair-status/{}", port, pairing_id))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["status"], "approved");
    let token = status["token"].as_str().unwrap().to_string();

    // 4) Connect WS with the token.
    let url = format!("ws://127.0.0.1:{}/bridge?family=chromium&variant=chrome", port);
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
