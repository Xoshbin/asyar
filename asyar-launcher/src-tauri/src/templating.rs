use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TemplateContext {
    pub query: Option<String>,
    pub trigger: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceholderMetadata {
    pub id: String,
    pub label: String,
    pub token: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aliases: Option<Vec<String>>,
}

pub fn get_available_placeholders() -> Vec<PlaceholderMetadata> {
    vec![
        PlaceholderMetadata {
            id: "query".to_string(),
            label: "Search Query".to_string(),
            token: "query".to_string(),
            description: "The text typed in the search bar when running the portal".to_string(),
            aliases: Some(vec!["Argument".to_string()]),
        },
        PlaceholderMetadata {
            id: "trigger".to_string(),
            label: "Agent Trigger".to_string(),
            token: "trigger".to_string(),
            description: "The shortcode trigger used to invoke the agent".to_string(),
            aliases: None,
        },
        PlaceholderMetadata {
            id: "selected-text".to_string(),
            label: "Selected Text".to_string(),
            token: "Selected Text".to_string(),
            description: "The currently selected text in any app".to_string(),
            aliases: Some(vec![
                "selection".to_string(),
                "Selected Text".to_string(),
                "selected-text".to_string(),
            ]),
        },
        PlaceholderMetadata {
            id: "clipboard".to_string(),
            label: "Clipboard".to_string(),
            token: "Clipboard".to_string(),
            description: "The current text contents of your clipboard".to_string(),
            aliases: Some(vec![
                "clipboard-text".to_string(),
                "Clipboard".to_string(),
                "clipboard".to_string(),
            ]),
        },
        PlaceholderMetadata {
            id: "uuid".to_string(),
            label: "UUID".to_string(),
            token: "uuid".to_string(),
            description: "A randomly generated UUID v4".to_string(),
            aliases: None,
        },
        PlaceholderMetadata {
            id: "date".to_string(),
            label: "Date".to_string(),
            token: "date".to_string(),
            description: "Today's date (e.g. 4/7/2026)".to_string(),
            aliases: None,
        },
        PlaceholderMetadata {
            id: "time".to_string(),
            label: "Time".to_string(),
            token: "time".to_string(),
            description: "Current time (e.g. 3:45:00 PM)".to_string(),
            aliases: None,
        },
        PlaceholderMetadata {
            id: "date-time".to_string(),
            label: "Date & Time".to_string(),
            token: "date-time".to_string(),
            description: "Today's date and current time".to_string(),
            aliases: None,
        },
        PlaceholderMetadata {
            id: "weekday".to_string(),
            label: "Weekday".to_string(),
            token: "weekday".to_string(),
            description: "Current day name (e.g. Tuesday)".to_string(),
            aliases: None,
        },
    ]
}

pub async fn resolve_template(
    template: &str,
    context: &TemplateContext,
) -> Result<String, AppError> {
    if !template.contains('{') {
        return Ok(template.to_string());
    }

    let mut result = template.to_string();

    // {trigger}
    if result.contains("{trigger}") || result.contains("{Trigger}") {
        if let Some(t) = &context.trigger {
            result = result.replace("{trigger}", t).replace("{Trigger}", t);
        }
    }

    // {query}
    if result.contains("{query}") || result.contains("{Query}") || result.contains("{Argument}") {
        if let Some(q) = &context.query {
            result = result
                .replace("{query}", q)
                .replace("{Query}", q)
                .replace("{Argument}", q);
        }
    }

    // {uuid}
    if result.contains("{uuid}") || result.contains("{UUID}") {
        let uuid_val = if let Some(q) = &context.query {
            if is_uuid(q) {
                q.clone()
            } else {
                uuid::Uuid::new_v4().to_string()
            }
        } else {
            uuid::Uuid::new_v4().to_string()
        };
        result = result
            .replace("{uuid}", &uuid_val)
            .replace("{UUID}", &uuid_val);
    }

    // Time-based placeholders
    if result.contains("{date}")
        || result.contains("{Date}")
        || result.contains("{time}")
        || result.contains("{Time}")
        || result.contains("{date-time}")
        || result.contains("{Date & Time}")
        || result.contains("{weekday}")
        || result.contains("{Weekday}")
    {
        let now = chrono::Local::now();
        if result.contains("{date}") || result.contains("{Date}") {
            let formatted = now.format("%-m/%-d/%Y").to_string();
            result = result
                .replace("{date}", &formatted)
                .replace("{Date}", &formatted);
        }
        if result.contains("{time}") || result.contains("{Time}") {
            let formatted = now.format("%-I:%M:%S %p").to_string();
            result = result
                .replace("{time}", &formatted)
                .replace("{Time}", &formatted);
        }
        if result.contains("{date-time}") || result.contains("{Date & Time}") {
            let formatted = now.format("%-m/%-d/%Y, %-I:%M:%S %p").to_string();
            result = result
                .replace("{date-time}", &formatted)
                .replace("{Date & Time}", &formatted);
        }
        if result.contains("{weekday}") || result.contains("{Weekday}") {
            let formatted = now.format("%A").to_string();
            result = result
                .replace("{weekday}", &formatted)
                .replace("{Weekday}", &formatted);
        }
    }

    // {clipboard-text}, {Clipboard Text}, {clipboard}, {Clipboard}
    if result.contains("{clipboard-text}")
        || result.contains("{Clipboard Text}")
        || result.contains("{clipboard}")
        || result.contains("{Clipboard}")
    {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            if let Ok(text) = cb.get_text() {
                result = result
                    .replace("{clipboard-text}", &text)
                    .replace("{Clipboard Text}", &text)
                    .replace("{clipboard}", &text)
                    .replace("{Clipboard}", &text);
            }
        }
    }

    // {selected-text}, {Selected Text}, {selection}, {Selection}
    if result.contains("{selected-text}")
        || result.contains("{Selected Text}")
        || result.contains("{selection}")
        || result.contains("{Selection}")
    {
        if let Ok(Some(text)) = crate::selection::service::get_selected_text().await {
            result = result
                .replace("{selected-text}", &text)
                .replace("{Selected Text}", &text)
                .replace("{selection}", &text)
                .replace("{Selection}", &text);
        }
    }

    Ok(result)
}

fn is_uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok()
}
