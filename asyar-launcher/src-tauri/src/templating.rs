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
            token: "Date".to_string(),
            description: "Today's date (supports format, e.g. {Date format=\"YYYY-MM-DD\"})".to_string(),
            aliases: Some(vec!["date".to_string()]),
        },
        PlaceholderMetadata {
            id: "time".to_string(),
            label: "Time".to_string(),
            token: "Time".to_string(),
            description: "Current time (supports format, e.g. {Time format=\"HH:mm\"})".to_string(),
            aliases: Some(vec!["time".to_string()]),
        },
        PlaceholderMetadata {
            id: "date-time".to_string(),
            label: "Date & Time".to_string(),
            token: "Date & Time".to_string(),
            description: "Today's date and time (supports format, e.g. {Date & Time format=\"YYYY-MM-DD HH:mm\"})".to_string(),
            aliases: Some(vec!["date-time".to_string(), "datetime".to_string()]),
        },
        PlaceholderMetadata {
            id: "weekday".to_string(),
            label: "Weekday".to_string(),
            token: "Weekday".to_string(),
            description: "Current day name (supports format, e.g. {Weekday format=\"EEE\"})".to_string(),
            aliases: Some(vec!["weekday".to_string(), "day".to_string()]),
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
    if result.contains('{') {
        let now = chrono::Local::now();
        use std::sync::LazyLock;
        static TEMPORAL_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
            regex::Regex::new(
                r#"\{(?i:(date|time|datetime|date-time|date\s+&\s+time|weekday|day))(?:\s+format=(?:"([^"]*)"|'([^']*)'|(\S+)))?\}"#,
            )
            .expect("valid temporal regex")
        });

        result = TEMPORAL_RE
            .replace_all(&result, |caps: &regex::Captures| {
                let tag = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let format_arg = caps
                    .get(2)
                    .or_else(|| caps.get(3))
                    .or_else(|| caps.get(4))
                    .map(|m| m.as_str());

                let tag_lower = tag.to_ascii_lowercase();
                let default_fmt = match tag_lower.as_str() {
                    "date" => "%-m/%-d/%Y",
                    "time" => "%-I:%M:%S %p",
                    "date-time" | "datetime" => "%-m/%-d/%Y, %-I:%M:%S %p",
                    s if s.contains("date") && s.contains("time") => "%-m/%-d/%Y, %-I:%M:%S %p",
                    "weekday" | "day" => "%A",
                    _ => "%-m/%-d/%Y",
                };

                let chrono_fmt = match format_arg {
                    Some(fmt) if !fmt.trim().is_empty() => convert_date_format(fmt.trim()),
                    _ => default_fmt.to_string(),
                };

                now.format(&chrono_fmt).to_string()
            })
            .to_string();
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

/// Converts user-facing date-time format tokens into `chrono`'s `strftime` specifiers.
///
/// Supported tokens include standard Moment/Unicode formatting tokens:
/// - `yyyy` / `YYYY` -> `%Y`
/// - `yy` / `YY` -> `%y`
/// - `MMMM` -> `%B`
/// - `MMM` -> `%b`
/// - `MM` -> `%m`
/// - `M` -> `%-m`
/// - `dddd` / `EEEE` -> `%A`
/// - `ddd` / `EEE` -> `%a`
/// - `dd` / `DD` -> `%d`
/// - `d` / `D` -> `%-d`
/// - `HH` -> `%H`
/// - `H` -> `%-H`
/// - `hh` -> `%I`
/// - `h` -> `%-I`
/// - `mm` -> `%M`
/// - `m` -> `%-M`
/// - `ss` -> `%S`
/// - `s` -> `%-S`
/// - `a` / `A` -> `%p`
/// - `SSS` -> `%3f`
/// - `ZZ` / `Z` -> `%z`
/// - `zzz` / `z` -> `%Z`
/// - Quoted literals `'text'` -> `text`
/// - Strftime specifiers `%...` -> preserved verbatim
pub fn convert_date_format(format: &str) -> String {
    use std::sync::LazyLock;
    static TOKEN_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
            r"('([^']*)'|%[a-zA-Z%]|yyyy|YYYY|yy|YY|MMMM|MMM|MM|M|dddd|ddd|dd|DD|d|D|EEEE|EEE|HH|H|hh|h|mm|m|ss|s|SSS|ZZ|Z|zzz|z|a|A)",
        )
        .expect("valid token regex")
    });

    let mut out = String::with_capacity(format.len());
    let mut last_end = 0;

    for mat in TOKEN_RE.find_iter(format) {
        if mat.start() > last_end {
            out.push_str(&format[last_end..mat.start()]);
        }
        let matched = mat.as_str();
        if matched.starts_with('\'') && matched.ends_with('\'') && matched.len() >= 2 {
            // Quoted literal, strip outer quotes
            out.push_str(&matched[1..matched.len() - 1]);
        } else if matched.starts_with('%') {
            out.push_str(matched);
        } else {
            match matched {
                "yyyy" | "YYYY" => out.push_str("%Y"),
                "yy" | "YY" => out.push_str("%y"),
                "MMMM" => out.push_str("%B"),
                "MMM" => out.push_str("%b"),
                "MM" => out.push_str("%m"),
                "M" => out.push_str("%-m"),
                "dddd" | "EEEE" => out.push_str("%A"),
                "ddd" | "EEE" => out.push_str("%a"),
                "dd" | "DD" => out.push_str("%d"),
                "d" | "D" => out.push_str("%-d"),
                "HH" => out.push_str("%H"),
                "H" => out.push_str("%-H"),
                "hh" => out.push_str("%I"),
                "h" => out.push_str("%-I"),
                "mm" => out.push_str("%M"),
                "m" => out.push_str("%-M"),
                "ss" => out.push_str("%S"),
                "s" => out.push_str("%-S"),
                "a" | "A" => out.push_str("%p"),
                "SSS" => out.push_str("%3f"),
                "ZZ" | "Z" => out.push_str("%z"),
                "zzz" | "z" => out.push_str("%Z"),
                _ => out.push_str(matched),
            }
        }
        last_end = mat.end();
    }

    if last_end < format.len() {
        out.push_str(&format[last_end..]);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_default_date_and_time_placeholders() {
        let ctx = TemplateContext::default();
        let now = chrono::Local::now();

        let date_res = resolve_template("Today is {date}", &ctx).await.unwrap();
        assert_eq!(date_res, format!("Today is {}", now.format("%-m/%-d/%Y")));

        let date_cap_res = resolve_template("Today is {Date}", &ctx).await.unwrap();
        assert_eq!(
            date_cap_res,
            format!("Today is {}", now.format("%-m/%-d/%Y"))
        );

        let time_res = resolve_template("Time: {time}", &ctx).await.unwrap();
        assert_eq!(time_res, format!("Time: {}", now.format("%-I:%M:%S %p")));

        let weekday_res = resolve_template("Day: {weekday}", &ctx).await.unwrap();
        assert_eq!(weekday_res, format!("Day: {}", now.format("%A")));
    }

    #[tokio::test]
    async fn test_custom_date_format_placeholders() {
        let ctx = TemplateContext::default();
        let now = chrono::Local::now();

        // ISO format YYYY-MM-DD
        let res = resolve_template("ISO: {date format=\"YYYY-MM-DD\"}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, format!("ISO: {}", now.format("%Y-%m-%d")));

        // Lowercase yyyy-MM-dd
        let res = resolve_template("ISO: {date format=\"yyyy-MM-dd\"}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, format!("ISO: {}", now.format("%Y-%m-%d")));

        // MM/dd/yy with single quotes
        let res = resolve_template("Short: {date format='MM/dd/yy'}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, format!("Short: {}", now.format("%m/%d/%y")));

        // Long textual date MMMM d, yyyy
        let res = resolve_template("Long: {date format=\"MMMM d, yyyy\"}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, format!("Long: {}", now.format("%B %-d, %Y")));

        // Capitalized {Date format="YYYY-MM-DD"}
        let res = resolve_template("{Date format=\"YYYY-MM-DD\"}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, now.format("%Y-%m-%d").to_string());
    }

    #[tokio::test]
    async fn test_custom_time_format_placeholders() {
        let ctx = TemplateContext::default();
        let now = chrono::Local::now();

        let res = resolve_template("24h: {time format=\"HH:mm\"}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, format!("24h: {}", now.format("%H:%M")));

        let res = resolve_template("12h: {time format=\"hh:mm a\"}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, format!("12h: {}", now.format("%I:%M %p")));

        let res = resolve_template("With seconds: {time format=\"HH:mm:ss\"}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, format!("With seconds: {}", now.format("%H:%M:%S")));
    }

    #[tokio::test]
    async fn test_custom_datetime_format_placeholders() {
        let ctx = TemplateContext::default();
        let now = chrono::Local::now();

        let res = resolve_template("{datetime format=\"YYYY-MM-DD HH:mm:ss\"}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, now.format("%Y-%m-%d %H:%M:%S").to_string());

        let res = resolve_template("{date-time format=\"YYYY-MM-DD HH:mm:ss\"}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, now.format("%Y-%m-%d %H:%M:%S").to_string());

        let res = resolve_template("{Date & Time format=\"YYYY-MM-DD HH:mm:ss\"}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, now.format("%Y-%m-%d %H:%M:%S").to_string());
    }

    #[tokio::test]
    async fn test_custom_weekday_format_placeholders() {
        let ctx = TemplateContext::default();
        let now = chrono::Local::now();

        let res = resolve_template("Day: {weekday format=\"EEE\"}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, format!("Day: {}", now.format("%a")));

        let res = resolve_template("Day: {weekday format=\"EEEE\"}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, format!("Day: {}", now.format("%A")));
    }

    #[tokio::test]
    async fn test_direct_strftime_specifiers() {
        let ctx = TemplateContext::default();
        let now = chrono::Local::now();

        let res = resolve_template("{date format=\"%Y/%m/%d\"}", &ctx)
            .await
            .unwrap();
        assert_eq!(res, now.format("%Y/%m/%d").to_string());
    }

    #[tokio::test]
    async fn test_mixed_template_placeholders() {
        let ctx = TemplateContext {
            query: Some("rust lang".to_string()),
            trigger: Some("!g".to_string()),
        };
        let now = chrono::Local::now();

        let res = resolve_template(
            "Query: {query}, Trigger: {trigger}, Date: {date format=\"YYYY-MM-DD\"}",
            &ctx,
        )
        .await
        .unwrap();
        assert_eq!(
            res,
            format!(
                "Query: rust lang, Trigger: !g, Date: {}",
                now.format("%Y-%m-%d")
            )
        );
    }
}
