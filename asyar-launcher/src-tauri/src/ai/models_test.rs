use super::models::{parse_provider_models, provider_model_request};
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
