use super::models::{
    list_models_impl, ollama_reasoning_efforts_from_capabilities, parse_ollama_show_capabilities,
    parse_provider_models, provider_model_request,
};
use crate::ai::types::ProviderConfig;
use serde_json::json;

fn config(api_key: Option<&str>, base_url: Option<&str>) -> ProviderConfig {
    ProviderConfig {
        enabled: true,
        name: None,
        provider_type: None,
        api_key: api_key.map(str::to_owned),
        base_url: base_url.map(str::to_owned),
        last_model_id: None,
        open_ai_api_mode: None,
        hosted_web_search: None,
        reasoning_effort: None,
        temperature: None,
        max_tokens: None,
    }
}

#[test]
fn custom_model_request_normalizes_base_url_and_optional_key() {
    let request = provider_model_request(
        "custom",
        &config(Some("secret"), Some("https://models.example/api/")),
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
    let mut cfg = config(Some("secret"), Some("http://localhost:11434"));
    cfg.name = Some("Local Ollama".into());
    cfg.provider_type = Some("ollama".into());

    let engine = cfg.provider_type.as_deref().unwrap_or("custom_ollama");
    let request = provider_model_request(engine, &cfg).unwrap();

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
    let error = provider_model_request("missing", &config(None, None)).unwrap_err();
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

    let models = list_models_impl("ollama", &config(None, Some(&server.url())))
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
