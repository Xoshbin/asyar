use super::models::{
    list_models, ollama_reasoning_efforts_from_capabilities, parse_ollama_show_capabilities,
    parse_provider_models, provider_model_request,
};
use crate::ai::types::ProviderConfig;
use serde_json::json;

fn config(base_url: Option<&str>) -> ProviderConfig {
    ProviderConfig {
        enabled: true,
        base_url: base_url.map(str::to_owned),
        ..Default::default()
    }
}

#[test]
fn custom_model_request_normalizes_base_url_and_optional_key() {
    let request = provider_model_request(
        "custom",
        &config(Some("https://models.example/api/")),
        Some("secret"),
    )
    .unwrap();

    assert_eq!(request.url, "https://models.example/api/v1/models");
    assert_eq!(
        request.headers.get("Authorization").map(String::as_str),
        Some("Bearer secret")
    );
}

#[test]
fn custom_model_request_resolves_via_provider_type() {
    let mut cfg = config(Some("http://localhost:11434"));
    cfg.name = Some("Local Ollama".into());
    cfg.provider_type = Some("ollama".into());

    let engine = cfg.provider_type.as_deref().unwrap_or("custom_ollama");
    let request = provider_model_request(engine, &cfg, Some("secret")).unwrap();

    assert_eq!(request.url, "http://localhost:11434/api/tags");
}

#[test]
fn openai_models_are_filtered_and_receive_rust_owned_reasoning_metadata() {
    let models = parse_provider_models(
        "openai",
        json!({ "data": [
            { "id": "gpt-4o" },
            { "id": "gpt-5.6-sol" },
            { "id": "whisper-1" }
        ] }),
    )
    .unwrap();

    assert_eq!(models.len(), 2);
    assert_eq!(models[0].id, "gpt-4o");
    assert_eq!(models[0].reasoning_efforts, Some(vec![]));
    assert_eq!(
        models[1].reasoning_efforts,
        Some(vec![
            "none".into(),
            "low".into(),
            "medium".into(),
            "high".into(),
            "xhigh".into(),
            "max".into(),
        ])
    );
}

#[test]
fn google_models_are_filtered_to_gemini_generation_models() {
    let models = parse_provider_models(
        "google",
        json!({ "models": [
            {
                "name": "models/gemini-3.1-pro-preview",
                "displayName": "Gemini 3.1 Pro",
                "supportedGenerationMethods": ["generateContent"]
            },
            {
                "name": "models/text-embedding-004",
                "supportedGenerationMethods": ["embedContent"]
            }
        ] }),
    )
    .unwrap();

    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "gemini-3.1-pro-preview");
    assert_eq!(models[0].label, "Gemini 3.1 Pro");
    assert_eq!(
        models[0].reasoning_efforts,
        Some(vec!["low".into(), "medium".into(), "high".into()])
    );
}

#[test]
fn openrouter_uses_model_specific_supported_efforts() {
    let models = parse_provider_models(
        "openrouter",
        json!({ "data": [{
            "id": "vendor/reasoning",
            "name": "Reasoning",
            "reasoning": { "supported_efforts": ["high", "future", "low"] }
        }] }),
    )
    .unwrap();

    assert_eq!(
        models[0].reasoning_efforts,
        Some(vec!["low".into(), "high".into()])
    );
}

#[test]
fn unknown_provider_is_rejected() {
    let error = provider_model_request("missing", &config(None), None).unwrap_err();
    assert!(error.to_string().contains("Unknown AI provider"));
}

#[test]
fn ollama_models_have_no_reasoning_efforts_from_tags_alone() {
    // /api/tags carries no capability data, so the pure parser can't know
    // yet whether a given model supports thinking.
    let models = parse_provider_models(
        "ollama",
        json!({ "models": [{ "name": "qwen2.5:latest" }] }),
    )
    .unwrap();

    assert_eq!(models[0].reasoning_efforts, None);
}

#[test]
fn ollama_show_capabilities_are_extracted_from_payload() {
    let capabilities =
        parse_ollama_show_capabilities(&json!({ "capabilities": ["completion", "thinking"] }));
    assert_eq!(
        capabilities,
        vec!["completion".to_string(), "thinking".to_string()]
    );
}

#[test]
fn ollama_show_capabilities_default_to_empty_when_field_missing() {
    let capabilities = parse_ollama_show_capabilities(&json!({}));
    assert!(capabilities.is_empty());
}

#[test]
fn ollama_reasoning_efforts_are_offered_only_when_thinking_capability_present() {
    let with_thinking = vec!["completion".to_string(), "thinking".to_string()];
    let without_thinking = vec!["completion".to_string(), "tools".to_string()];

    assert_eq!(
        ollama_reasoning_efforts_from_capabilities(&with_thinking),
        Some(vec!["low".into(), "medium".into(), "high".into()])
    );
    // Must be `Some(vec![])`, not `None` — the frontend contract collapses a
    // Rust `None` into "capability unknown, fall back to the connection-wide
    // default", so a confirmed "no" has to be an explicit empty list or the
    // Reasoning selector reappears for models that just rejected it.
    assert_eq!(
        ollama_reasoning_efforts_from_capabilities(&without_thinking),
        Some(vec![])
    );
}

#[tokio::test]
async fn list_models_impl_only_offers_reasoning_effort_for_thinking_capable_ollama_models() {
    let mut server = mockito::Server::new_async().await;

    let _tags = server
        .mock("GET", "/api/tags")
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(
            json!({ "models": [{ "name": "qwen2.5:latest" }, { "name": "qwen3:latest" }] })
                .to_string(),
        )
        .create_async()
        .await;

    let _show_qwen25 = server
        .mock("POST", "/api/show")
        .match_body(mockito::Matcher::PartialJson(
            json!({ "model": "qwen2.5:latest" }),
        ))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json!({ "capabilities": ["completion", "tools"] }).to_string())
        .create_async()
        .await;

    let _show_qwen3 = server
        .mock("POST", "/api/show")
        .match_body(mockito::Matcher::PartialJson(
            json!({ "model": "qwen3:latest" }),
        ))
        .with_status(200)
        .with_header("content-type", "application/json")
        .with_body(json!({ "capabilities": ["completion", "tools", "thinking"] }).to_string())
        .create_async()
        .await;

    let models = list_models("ollama", &config(Some(&server.url())), None)
        .await
        .unwrap();

    let qwen25 = models.iter().find(|m| m.id == "qwen2.5:latest").unwrap();
    let qwen3 = models.iter().find(|m| m.id == "qwen3:latest").unwrap();

    assert_eq!(qwen25.reasoning_efforts, Some(vec![]));
    assert_eq!(
        qwen3.reasoning_efforts,
        Some(vec!["low".into(), "medium".into(), "high".into()])
    );
}

#[test]
fn cli_models_lists_claude_aliases() {
    let ids: Vec<String> = super::models::cli_models("anthropic_16782567")
        .into_iter()
        .map(|m| m.id)
        .collect();
    assert_eq!(ids, ["opus", "sonnet", "haiku"]);
}

#[test]
fn cli_models_claude_offers_effort_only_where_supported() {
    let models = super::models::cli_models("anthropic_1");
    let efforts = |id: &str| {
        models
            .iter()
            .find(|m| m.id == id)
            .unwrap()
            .reasoning_efforts
            .clone()
    };
    assert_eq!(efforts("opus").unwrap(), ["low", "medium", "high"]);
    assert_eq!(efforts("sonnet").unwrap(), ["low", "medium", "high"]);
    assert!(efforts("haiku").is_none());
}

#[tokio::test]
async fn list_models_impl_returns_claude_models_in_cli_mode() {
    let mut cfg = config(None);
    cfg.provider_type = Some("anthropic".to_string());
    cfg.connection_mode = Some("cli".to_string());
    let models = list_models("anthropic_1", &cfg, None).await.unwrap();
    assert_eq!(
        models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
        ["opus", "sonnet", "haiku"]
    );
}

fn credential_conn() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::storage::migrations::run(&conn).unwrap();
    conn
}

#[test]
fn model_listing_reads_the_key_stored_under_the_connection_instance_id() {
    let master = crate::crypto::test_master_key();
    let conn = credential_conn();
    crate::storage::ai_credentials::set(&conn, "provider:custom_60f9a975", "sk-custom", &master)
        .unwrap();
    crate::storage::ai_credentials::set(&conn, "provider:custom", "sk-other-connection", &master)
        .unwrap();

    let key = super::models::resolve_model_listing_key_in(
        &conn,
        &master,
        "custom_60f9a975",
        &config(None),
    )
    .unwrap()
    .expect("the instance's own key");

    assert_eq!(key.as_str(), "sk-custom");
}

#[test]
fn model_listing_does_not_fall_back_to_another_connections_key() {
    let master = crate::crypto::test_master_key();
    let conn = credential_conn();
    crate::storage::ai_credentials::set(&conn, "provider:custom", "sk-other-connection", &master)
        .unwrap();

    let key = super::models::resolve_model_listing_key_in(
        &conn,
        &master,
        "custom_60f9a975",
        &config(None),
    )
    .unwrap();

    assert!(key.is_none());
}

#[test]
fn model_listing_in_cli_mode_ignores_an_unreadable_key_row() {
    let conn = credential_conn();
    let old_master_key = crate::crypto::test_master_key();
    let new_master_key = crate::crypto::test_master_key();
    crate::storage::ai_credentials::set(&conn, "provider:openai", "sk-old", &old_master_key)
        .unwrap();
    let mut cli = config(None);
    cli.connection_mode = Some("cli".into());

    // The keychain master key changed, so the stored row can no longer be decrypted.
    let key = super::models::resolve_model_listing_key_in(&conn, &new_master_key, "openai", &cli)
        .expect("a CLI-mode listing never reads the stored key");

    assert!(key.is_none());
}

#[test]
fn model_listing_in_api_mode_still_reports_an_unreadable_key_row() {
    let conn = credential_conn();
    let old_master_key = crate::crypto::test_master_key();
    let new_master_key = crate::crypto::test_master_key();
    crate::storage::ai_credentials::set(&conn, "provider:openai", "sk-old", &old_master_key)
        .unwrap();

    let err = super::models::resolve_model_listing_key_in(
        &conn,
        &new_master_key,
        "openai",
        &config(None),
    )
    .expect_err("API mode needs the key");

    let message = err.to_string();
    assert!(
        message.contains("cannot be decrypted") && message.contains("re-enter your key"),
        "{message}"
    );
}
