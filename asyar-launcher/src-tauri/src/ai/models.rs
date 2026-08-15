use crate::ai::types::{ModelInfo, ProviderConfig};
use crate::error::AppError;
use serde_json::Value;
use std::collections::HashMap;

const ALL_REASONING_EFFORTS: &[&str] =
    &["none", "minimal", "low", "medium", "high", "xhigh", "max"];

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ProviderModelRequest {
    pub url: String,
    pub headers: HashMap<String, String>,
}

fn authorization_header(api_key: Option<&str>) -> HashMap<String, String> {
    let mut headers = HashMap::new();
    if let Some(key) = api_key.filter(|key| !key.is_empty()) {
        headers.insert("Authorization".into(), format!("Bearer {key}"));
    }
    headers
}

fn normalize_openai_base(raw_base: &str) -> String {
    let trimmed = raw_base.trim_end_matches('/');
    let final_segment = trimmed.rsplit('/').next().unwrap_or_default();
    let already_versioned = final_segment
        .strip_prefix('v')
        .is_some_and(|version| !version.is_empty() && version.chars().all(|c| c.is_ascii_digit()));
    if already_versioned || final_segment == "openai" {
        trimmed.to_owned()
    } else {
        format!("{trimmed}/v1")
    }
}

pub(super) fn provider_model_request(
    provider_id: &str,
    config: &ProviderConfig,
) -> Result<ProviderModelRequest, AppError> {
    let request = match provider_id {
        "openai" => {
            let base = config
                .base_url
                .as_deref()
                .unwrap_or("https://api.openai.com")
                .trim_end_matches('/');
            ProviderModelRequest {
                url: format!("{base}/v1/models"),
                headers: authorization_header(config.api_key.as_deref()),
            }
        }
        "anthropic" => ProviderModelRequest {
            url: "https://api.anthropic.com/v1/models?limit=100".into(),
            headers: HashMap::from([
                (
                    "x-api-key".into(),
                    config.api_key.clone().unwrap_or_default(),
                ),
                ("anthropic-version".into(), "2023-06-01".into()),
                (
                    "anthropic-dangerous-direct-browser-access".into(),
                    "true".into(),
                ),
            ]),
        },
        "google" => ProviderModelRequest {
            url: "https://generativelanguage.googleapis.com/v1beta/models".into(),
            headers: HashMap::from([(
                "x-goog-api-key".into(),
                config.api_key.clone().unwrap_or_default(),
            )]),
        },
        "ollama" => {
            let base = config
                .base_url
                .as_deref()
                .unwrap_or("http://localhost:11434")
                .trim_end_matches('/');
            ProviderModelRequest {
                url: format!("{base}/api/tags"),
                headers: HashMap::new(),
            }
        }
        "openrouter" => ProviderModelRequest {
            url: "https://openrouter.ai/api/v1/models".into(),
            headers: HashMap::from([
                (
                    "Authorization".into(),
                    format!("Bearer {}", config.api_key.as_deref().unwrap_or_default()),
                ),
                ("HTTP-Referer".into(), "https://asyar.app".into()),
                ("X-Title".into(), "Asyar".into()),
            ]),
        },
        "custom" => {
            let raw_base = config.base_url.as_deref().ok_or_else(|| {
                AppError::Validation("Custom AI provider requires a base URL".into())
            })?;
            let mut headers = authorization_header(config.api_key.as_deref());
            headers.insert(
                "anthropic-dangerous-direct-browser-access".into(),
                "true".into(),
            );
            ProviderModelRequest {
                url: format!("{}/models", normalize_openai_base(raw_base)),
                headers,
            }
        }
        _ => {
            return Err(AppError::Validation(format!(
                "Unknown AI provider: {provider_id}"
            )))
        }
    };
    Ok(request)
}

fn efforts(values: &[&str]) -> Option<Vec<String>> {
    Some(values.iter().map(|value| (*value).to_owned()).collect())
}

fn is_model_or_snapshot(model_id: &str, model: &str) -> bool {
    model_id == model || model_id.starts_with(&format!("{model}-20"))
}

fn openai_reasoning_efforts(model_id: &str) -> Option<Vec<String>> {
    let families: &[(&[&str], &[&str])] = &[
        (
            &["o1", "o3-mini", "o3", "o4-mini"],
            &["low", "medium", "high"],
        ),
        (&["gpt-5-pro"], &["high"]),
        (
            &["gpt-5.2-pro", "gpt-5.4-pro", "gpt-5.5-pro"],
            &["medium", "high", "xhigh"],
        ),
        (
            &["gpt-5.2-codex", "gpt-5.3-codex"],
            &["low", "medium", "high", "xhigh"],
        ),
        (
            &["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
            &["none", "low", "medium", "high", "xhigh", "max"],
        ),
        (
            &[
                "gpt-5.2",
                "gpt-5.4",
                "gpt-5.4-mini",
                "gpt-5.4-nano",
                "gpt-5.5",
            ],
            &["none", "low", "medium", "high", "xhigh"],
        ),
        (&["gpt-5.1"], &["none", "low", "medium", "high"]),
        (
            &["gpt-5", "gpt-5-mini", "gpt-5-nano"],
            &["minimal", "low", "medium", "high"],
        ),
    ];
    families
        .iter()
        .find(|(models, _)| {
            models
                .iter()
                .any(|model| is_model_or_snapshot(model_id, model))
        })
        .map(|(_, values)| values.iter().map(|value| (*value).to_owned()).collect())
        .or_else(|| efforts(&[]))
}

fn anthropic_reasoning_efforts(model_id: &str) -> Option<Vec<String>> {
    let families: &[(&[&str], &[&str])] = &[
        (
            &[
                "claude-fable-5",
                "claude-mythos-5",
                "claude-opus-4-8",
                "claude-opus-4-7",
                "claude-sonnet-5",
            ],
            &["low", "medium", "high", "xhigh", "max"],
        ),
        (
            &[
                "claude-mythos-preview",
                "claude-opus-4-6",
                "claude-sonnet-4-6",
            ],
            &["low", "medium", "high", "max"],
        ),
        (&["claude-opus-4-5"], &["low", "medium", "high"]),
    ];
    families
        .iter()
        .find(|(models, _)| {
            models
                .iter()
                .any(|model| is_model_or_snapshot(model_id, model))
        })
        .map(|(_, values)| values.iter().map(|value| (*value).to_owned()).collect())
        .or_else(|| efforts(&[]))
}

fn google_reasoning_efforts(model_id: &str) -> Option<Vec<String>> {
    if model_id.starts_with("gemini-2.5") {
        return efforts(&["minimal", "low", "medium", "high"]);
    }
    let major = model_id
        .strip_prefix("gemini-")
        .map(|value| {
            value
                .chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
        })
        .and_then(|value| value.parse::<u32>().ok());
    if major.is_none_or(|major| major < 3) {
        return efforts(&[]);
    }
    if model_id.contains("-image") {
        efforts(&["minimal", "high"])
    } else if model_id.starts_with("gemini-3-pro") {
        efforts(&["low", "high"])
    } else if model_id.contains("-pro") {
        efforts(&["low", "medium", "high"])
    } else {
        efforts(&["minimal", "low", "medium", "high"])
    }
}

fn model(id: &str, label: Option<&str>, reasoning_efforts: Option<Vec<String>>) -> ModelInfo {
    ModelInfo {
        id: id.to_owned(),
        label: label.unwrap_or(id).to_owned(),
        reasoning_efforts,
    }
}

pub(super) fn parse_provider_models(
    provider_id: &str,
    payload: Value,
) -> Result<Vec<ModelInfo>, AppError> {
    let models = match provider_id {
        "openai" => payload
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.get("id").and_then(Value::as_str))
            .filter(|id| {
                ["gpt-", "o1", "o2", "o3", "o4"]
                    .iter()
                    .any(|prefix| id.starts_with(prefix))
            })
            .map(|id| model(id, None, openai_reasoning_efforts(id)))
            .collect(),
        "anthropic" => payload
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                let id = entry.get("id")?.as_str()?;
                Some(model(
                    id,
                    entry.get("display_name").and_then(Value::as_str),
                    anthropic_reasoning_efforts(id),
                ))
            })
            .collect(),
        "google" => payload
            .get("models")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|entry| {
                entry
                    .get("supportedGenerationMethods")
                    .and_then(Value::as_array)
                    .is_some_and(|methods| methods.iter().any(|method| method == "generateContent"))
            })
            .filter_map(|entry| {
                let full_name = entry.get("name")?.as_str()?;
                let id = full_name.strip_prefix("models/").unwrap_or(full_name);
                if !id.contains("gemini") {
                    return None;
                }
                Some(model(
                    id,
                    entry.get("displayName").and_then(Value::as_str),
                    google_reasoning_efforts(id),
                ))
            })
            .collect(),
        "ollama" => payload
            .get("models")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.get("name").and_then(Value::as_str))
            .map(|id| model(id, None, None))
            .collect(),
        "openrouter" => payload
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                let id = entry.get("id")?.as_str()?;
                let supported = entry.pointer("/reasoning/supported_efforts");
                let reasoning_efforts = match supported {
                    Some(Value::Null) => efforts(ALL_REASONING_EFFORTS),
                    Some(Value::Array(values)) => Some(
                        ALL_REASONING_EFFORTS
                            .iter()
                            .filter(|effort| values.iter().any(|value| value == **effort))
                            .map(|effort| (*effort).to_owned())
                            .collect(),
                    ),
                    _ => efforts(&[]),
                };
                Some(model(
                    id,
                    entry.get("name").and_then(Value::as_str),
                    reasoning_efforts,
                ))
            })
            .collect(),
        "custom" => payload
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.get("id").and_then(Value::as_str))
            .map(|id| model(id, None, None))
            .collect(),
        _ => {
            return Err(AppError::Validation(format!(
                "Unknown AI provider: {provider_id}"
            )))
        }
    };
    Ok(models)
}

pub async fn list_models_impl(
    provider_id: &str,
    config: &ProviderConfig,
) -> Result<Vec<ModelInfo>, AppError> {
    let engine_type = config.provider_type.as_deref().unwrap_or(provider_id);
    let spec = provider_model_request(engine_type, config)?;
    let client = reqwest::Client::new();
    let mut request = client
        .get(&spec.url)
        .timeout(std::time::Duration::from_secs(30));
    for (key, value) in spec.headers {
        request = request.header(key, value);
    }
    let response = request.send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Other(if body.is_empty() {
            format!("Model discovery failed with HTTP {status}")
        } else {
            body
        }));
    }
    parse_provider_models(engine_type, response.json().await?)
}

#[tauri::command]
pub async fn ai_list_models(
    provider_id: String,
    config: ProviderConfig,
) -> Result<Vec<ModelInfo>, AppError> {
    list_models_impl(&provider_id, &config).await
}
