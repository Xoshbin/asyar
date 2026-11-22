use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TemplateContext {
    pub query: Option<String>,
    pub trigger: Option<String>,
    #[serde(default)]
    pub args: Option<std::collections::HashMap<String, String>>,
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
    resolve_portal_template(template, context, false).await
}

/// Percent-encodes a single placeholder value for safe insertion into a URL
/// (unreserved RFC 3986 characters `A-Z a-z 0-9 - _ . ~` are preserved).
pub fn percent_encode_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char);
            }
            _ => {
                out.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    out
}

/// Sanitize an argument display name into a valid identifier matching
/// `/^[a-zA-Z_][a-zA-Z0-9_]*$/` for `CommandArgument.name` alignment.
pub fn sanitize_arg_name(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() || out.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        format!("arg_{out}")
    } else {
        out
    }
}

#[derive(Debug, Default)]
struct PlaceholderSpec {
    name: String,
    params: std::collections::HashMap<String, String>,
    modifiers: Vec<String>,
}

fn parse_placeholder_spec(raw: &str) -> Option<PlaceholderSpec> {
    let parts: Vec<&str> = split_unquoted_pipes(raw);
    let head = parts.first()?.trim();
    if head.is_empty() {
        return None;
    }

    // Extract key=value params; everything before the first param is the name
    // (supporting multi-word names like `Selected Text`, `Clipboard Text`, `Date & Time`).
    use std::sync::LazyLock;
    static PARAM_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r#"([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))"#)
            .expect("valid param regex")
    });

    let mut params = std::collections::HashMap::new();
    let mut first_param_start = head.len();
    for caps in PARAM_RE.captures_iter(head) {
        if let Some(m) = caps.get(0) {
            if m.start() < first_param_start {
                first_param_start = m.start();
            }
        }
        let key = caps[1].to_ascii_lowercase();
        let val = caps
            .get(2)
            .or_else(|| caps.get(3))
            .or_else(|| caps.get(4))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();
        params.insert(key, val);
    }

    let name = head[..first_param_start].trim().to_string();
    if name.is_empty() {
        return None;
    }

    let modifiers = parts[1..]
        .iter()
        .map(|m| m.trim().to_ascii_lowercase())
        .filter(|m| !m.is_empty())
        .collect();

    Some(PlaceholderSpec {
        name,
        params,
        modifiers,
    })
}

fn split_unquoted_pipes(input: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut quote: Option<char> = None;
    for (idx, ch) in input.char_indices() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => {}
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch == '|' => {
                parts.push(&input[start..idx]);
                start = idx + 1;
            }
            None => {}
        }
    }
    parts.push(&input[start..]);
    parts
}

fn apply_date_offset(
    base: chrono::DateTime<chrono::Local>,
    offset_str: &str,
) -> Option<chrono::DateTime<chrono::Local>> {
    use chrono::{Duration, Months};
    let mut current = base;
    for token in offset_str.split_whitespace() {
        let sign = match token.chars().next()? {
            '+' => 1i32,
            '-' => -1i32,
            _ => return None,
        };
        let rest = &token[1..];
        if rest.len() < 2 {
            return None;
        }
        let unit = rest.chars().last()?;
        let amount: u32 = rest[..rest.len() - unit.len_utf8()].parse().ok()?;
        match unit {
            'm' => {
                let delta = Duration::minutes(i64::from(amount) * i64::from(sign));
                current = current.checked_add_signed(delta)?;
            }
            'h' => {
                let delta = Duration::hours(i64::from(amount) * i64::from(sign));
                current = current.checked_add_signed(delta)?;
            }
            'd' => {
                let delta = Duration::days(i64::from(amount) * i64::from(sign));
                current = current.checked_add_signed(delta)?;
            }
            'M' => {
                let months = Months::new(amount);
                current = if sign > 0 {
                    current.checked_add_months(months)?
                } else {
                    current.checked_sub_months(months)?
                };
            }
            'y' => {
                let months = Months::new(amount.checked_mul(12)?);
                current = if sign > 0 {
                    current.checked_add_months(months)?
                } else {
                    current.checked_sub_months(months)?
                };
            }
            _ => return None,
        }
    }
    Some(current)
}

fn apply_modifiers(mut value: String, modifiers: &[String], encode_values: bool) -> String {
    let mut is_raw = false;
    let mut already_encoded = false;
    for m in modifiers {
        match m.as_str() {
            "raw" => is_raw = true,
            "uppercase" => value = value.to_uppercase(),
            "lowercase" => value = value.to_lowercase(),
            "trim" => value = value.trim().to_string(),
            "json-stringify" => {
                if let Ok(s) = serde_json::to_string(&value) {
                    value = s;
                }
            }
            "percent-encode" => {
                value = percent_encode_component(&value);
                already_encoded = true;
            }
            _ => {}
        }
    }
    if encode_values && !is_raw && !already_encoded {
        percent_encode_component(&value)
    } else {
        value
    }
}

/// Resolves a Portal URL/path/deeplink template with Raycast-compatible
/// `{argument ...}`, `{clipboard}`, `{selection}`, `{date ...}`, `{uuid}`,
/// modifiers (`| raw`, `| uppercase`, `| lowercase`, `| trim`, `| percent-encode`),
/// and per-placeholder URL percent-encoding.
pub async fn resolve_portal_template(
    template: &str,
    context: &TemplateContext,
    encode_values: bool,
) -> Result<String, AppError> {
    if !template.contains('{') {
        return Ok(template.to_string());
    }

    let args_map = context.args.as_ref();
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    let mut cached_clipboard: Option<Option<String>> = None;
    let mut cached_selection: Option<Option<String>> = None;
    let now = chrono::Local::now();

    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else {
            out.push_str(&rest[start..]);
            rest = "";
            break;
        };
        if let Some(nested_open) = after[..end].find('{') {
            out.push('{');
            out.push_str(&after[..nested_open]);
            rest = &after[nested_open..];
            continue;
        }
        let raw_inner = &after[..end];
        let full_token = &rest[start..start + 1 + end + 1];

        let mut replaced: Option<String> = None;
        if let Some(spec) = parse_placeholder_spec(raw_inner) {
            let name_lower = spec.name.to_ascii_lowercase();
            let raw_val: Option<String> = match name_lower.as_str() {
                "argument" | "query" => {
                    let arg_name = spec.params.get("name").map(String::as_str);
                    let from_args = args_map.and_then(|map| {
                        if let Some(n) = arg_name {
                            map.get(n)
                                .or_else(|| map.get(&sanitize_arg_name(n)))
                                .cloned()
                        } else {
                            map.get("argument")
                                .or_else(|| map.get("query"))
                                .or_else(|| map.get("Argument"))
                                .or_else(|| map.get("Query"))
                                .cloned()
                        }
                    });
                    let from_query = if arg_name.is_none() {
                        context.query.clone().filter(|v| !v.is_empty())
                    } else {
                        None
                    };
                    let from_default = spec.params.get("default").cloned();
                    from_args
                        .filter(|v| !v.is_empty())
                        .or(from_query)
                        .or(from_default)
                        .or_else(|| args_map.is_some().then(String::new))
                }
                "trigger" => context.trigger.clone(),
                "uuid" => Some(
                    context
                        .query
                        .as_ref()
                        .filter(|q| is_uuid(q))
                        .cloned()
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                ),
                "date" | "time" | "datetime" | "date-time" | "date & time" | "weekday" | "day" => {
                    let has_format = spec.params.contains_key("format");
                    let has_locale = spec.params.contains_key("locale");
                    if has_format && has_locale {
                        None
                    } else {
                        let target_dt = match spec.params.get("offset") {
                            Some(off) => apply_date_offset(now, off),
                            None => Some(now),
                        };
                        target_dt.map(|dt| {
                            format_datetime_with_locale(
                                dt,
                                &name_lower,
                                spec.params.get("locale").map(String::as_str),
                                spec.params.get("format").map(String::as_str),
                            )
                        })
                    }
                }
                "clipboard" | "clipboard-text" | "clipboard text" => {
                    if cached_clipboard.is_none() {
                        let text = arboard::Clipboard::new()
                            .ok()
                            .and_then(|mut cb| cb.get_text().ok());
                        cached_clipboard = Some(text);
                    }
                    cached_clipboard.clone().flatten()
                }
                "selection" | "selected-text" | "selected text" => {
                    if cached_selection.is_none() {
                        let text = crate::selection::service::get_selected_text()
                            .await
                            .ok()
                            .flatten();
                        cached_selection = Some(text);
                    }
                    cached_selection.clone().flatten()
                }
                _ => None,
            };

            if let Some(val) = raw_val {
                replaced = Some(apply_modifiers(val, &spec.modifiers, encode_values));
            }
        }

        match replaced {
            Some(val) => out.push_str(&val),
            None => out.push_str(full_token),
        }

        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
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

fn format_datetime_with_locale(
    dt: chrono::DateTime<chrono::Local>,
    name_lower: &str,
    locale: Option<&str>,
    format: Option<&str>,
) -> String {
    if let Some(f) = format.map(str::trim).filter(|f| !f.is_empty()) {
        return dt.format(&convert_date_format(f)).to_string();
    }

    let normalized = locale
        .map(|l| l.trim().replace('_', "-").to_ascii_lowercase())
        .filter(|l| !l.is_empty());

    if matches!(name_lower, "weekday" | "day") {
        if let Some(ref tag) = normalized {
            if let Some(localized) = localized_weekday(dt, tag) {
                return localized.to_string();
            }
        }
        return dt.format("%A").to_string();
    }

    let (date_fmt, time_fmt) = locale_date_time_patterns(normalized.as_deref());
    let fmt = match name_lower {
        "date" => date_fmt.to_string(),
        "time" => time_fmt.to_string(),
        "date-time" | "datetime" | "date & time" => format!("{date_fmt}, {time_fmt}"),
        _ => date_fmt.to_string(),
    };
    dt.format(&fmt).to_string()
}

fn locale_date_time_patterns(locale: Option<&str>) -> (&'static str, &'static str) {
    let Some(tag) = locale else {
        return ("%-m/%-d/%Y", "%-I:%M:%S %p");
    };
    let lang = tag.split('-').next().unwrap_or(tag);
    match tag {
        "en-us" | "en" => ("%-m/%-d/%Y", "%-I:%M:%S %p"),
        "en-ca" => ("%Y-%m-%d", "%-I:%M:%S %p"),
        "en-au" => ("%d/%m/%Y", "%-I:%M:%S %p"),
        "en-gb" | "en-ie" | "en-nz" | "en-in" => ("%d/%m/%Y", "%H:%M:%S"),
        _ => match lang {
            "de" | "ru" | "pl" | "cs" | "tr" | "fi" | "no" | "nb" | "nn" => {
                ("%d.%m.%Y", "%H:%M:%S")
            }
            "sv" | "lt" => ("%Y-%m-%d", "%H:%M:%S"),
            "ja" | "zh" | "ko" => ("%Y/%-m/%-d", "%H:%M:%S"),
            "fr" | "es" | "it" | "pt" | "nl" | "ar" | "fa" => ("%d/%m/%Y", "%H:%M:%S"),
            _ => ("%-m/%-d/%Y", "%-I:%M:%S %p"),
        },
    }
}

fn localized_weekday(dt: chrono::DateTime<chrono::Local>, tag: &str) -> Option<&'static str> {
    use chrono::Datelike;
    let idx = dt.weekday().num_days_from_monday() as usize;
    let lang = tag.split('-').next().unwrap_or(tag);
    let names: [&'static str; 7] = match lang {
        "fr" => [
            "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
        ],
        "de" => [
            "Montag",
            "Dienstag",
            "Mittwoch",
            "Donnerstag",
            "Freitag",
            "Samstag",
            "Sonntag",
        ],
        "es" => [
            "lunes",
            "martes",
            "miércoles",
            "jueves",
            "viernes",
            "sábado",
            "domingo",
        ],
        "pt" => [
            "segunda-feira",
            "terça-feira",
            "quarta-feira",
            "quinta-feira",
            "sexta-feira",
            "sábado",
            "domingo",
        ],
        "it" => [
            "lunedì",
            "martedì",
            "mercoledì",
            "giovedì",
            "venerdì",
            "sabato",
            "domenica",
        ],
        "nl" => [
            "maandag",
            "dinsdag",
            "woensdag",
            "donderdag",
            "vrijdag",
            "zaterdag",
            "zondag",
        ],
        "ja" => [
            "月曜日",
            "火曜日",
            "水曜日",
            "木曜日",
            "金曜日",
            "土曜日",
            "日曜日",
        ],
        "zh" => [
            "星期一",
            "星期二",
            "星期三",
            "星期四",
            "星期五",
            "星期六",
            "星期日",
        ],
        "ko" => [
            "월요일",
            "화요일",
            "수요일",
            "목요일",
            "금요일",
            "토요일",
            "일요일",
        ],
        "ru" => [
            "понедельник",
            "вторник",
            "среда",
            "четверг",
            "пятница",
            "суббота",
            "воскресенье",
        ],
        _ => return None,
    };
    Some(names[idx])
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, Local};

    /// `resolve_template` samples the clock itself, so a rendered timestamp can
    /// land on the far side of a second (or minute, or day) boundary that the
    /// call happens to cross. Bracket the call and accept either reading rather
    /// than comparing against a single `now` taken beforehand — the latter
    /// fails roughly once per thousand runs and blocks the release workflow,
    /// whose build jobs all gate on this suite.
    async fn assert_renders(
        template: &str,
        ctx: &TemplateContext,
        expected: impl Fn(&DateTime<Local>) -> String,
    ) {
        let before = Local::now();
        let got = resolve_template(template, ctx).await.unwrap();
        let after = Local::now();
        let (from_before, from_after) = (expected(&before), expected(&after));
        assert!(
            got == from_before || got == from_after,
            "got {got:?}; expected {from_before:?} or {from_after:?}",
        );
    }

    #[tokio::test]
    async fn test_default_date_and_time_placeholders() {
        let ctx = TemplateContext::default();

        assert_renders("Today is {date}", &ctx, |t| {
            format!("Today is {}", t.format("%-m/%-d/%Y"))
        })
        .await;
        assert_renders("Today is {Date}", &ctx, |t| {
            format!("Today is {}", t.format("%-m/%-d/%Y"))
        })
        .await;
        assert_renders("Time: {time}", &ctx, |t| {
            format!("Time: {}", t.format("%-I:%M:%S %p"))
        })
        .await;
        assert_renders("Day: {weekday}", &ctx, |t| {
            format!("Day: {}", t.format("%A"))
        })
        .await;
    }

    #[tokio::test]
    async fn test_custom_date_format_placeholders() {
        let ctx = TemplateContext::default();

        // Both `YYYY-MM-DD` and `yyyy-MM-dd` spellings map to the same output.
        assert_renders("ISO: {date format=\"YYYY-MM-DD\"}", &ctx, |t| {
            format!("ISO: {}", t.format("%Y-%m-%d"))
        })
        .await;
        assert_renders("ISO: {date format=\"yyyy-MM-dd\"}", &ctx, |t| {
            format!("ISO: {}", t.format("%Y-%m-%d"))
        })
        .await;
        assert_renders("Short: {date format='MM/dd/yy'}", &ctx, |t| {
            format!("Short: {}", t.format("%m/%d/%y"))
        })
        .await;
        assert_renders("Long: {date format=\"MMMM d, yyyy\"}", &ctx, |t| {
            format!("Long: {}", t.format("%B %-d, %Y"))
        })
        .await;
        assert_renders("{Date format=\"YYYY-MM-DD\"}", &ctx, |t| {
            t.format("%Y-%m-%d").to_string()
        })
        .await;
    }

    #[tokio::test]
    async fn test_custom_time_format_placeholders() {
        let ctx = TemplateContext::default();

        assert_renders("24h: {time format=\"HH:mm\"}", &ctx, |t| {
            format!("24h: {}", t.format("%H:%M"))
        })
        .await;
        assert_renders("12h: {time format=\"hh:mm a\"}", &ctx, |t| {
            format!("12h: {}", t.format("%I:%M %p"))
        })
        .await;
        assert_renders("With seconds: {time format=\"HH:mm:ss\"}", &ctx, |t| {
            format!("With seconds: {}", t.format("%H:%M:%S"))
        })
        .await;
    }

    #[tokio::test]
    async fn test_custom_datetime_format_placeholders() {
        let ctx = TemplateContext::default();

        // `datetime`, `date-time` and `Date & Time` are aliases of one another.
        for template in [
            "{datetime format=\"YYYY-MM-DD HH:mm:ss\"}",
            "{date-time format=\"YYYY-MM-DD HH:mm:ss\"}",
            "{Date & Time format=\"YYYY-MM-DD HH:mm:ss\"}",
        ] {
            assert_renders(template, &ctx, |t| {
                t.format("%Y-%m-%d %H:%M:%S").to_string()
            })
            .await;
        }
    }

    #[tokio::test]
    async fn test_custom_weekday_format_placeholders() {
        let ctx = TemplateContext::default();

        assert_renders("Day: {weekday format=\"EEE\"}", &ctx, |t| {
            format!("Day: {}", t.format("%a"))
        })
        .await;
        assert_renders("Day: {weekday format=\"EEEE\"}", &ctx, |t| {
            format!("Day: {}", t.format("%A"))
        })
        .await;
    }

    #[tokio::test]
    async fn test_direct_strftime_specifiers() {
        let ctx = TemplateContext::default();

        assert_renders("{date format=\"%Y/%m/%d\"}", &ctx, |t| {
            t.format("%Y/%m/%d").to_string()
        })
        .await;
    }

    #[tokio::test]
    async fn test_mixed_template_placeholders() {
        let ctx = TemplateContext {
            query: Some("rust lang".to_string()),
            trigger: Some("!g".to_string()),
            args: None,
        };

        assert_renders(
            "Query: {query}, Trigger: {trigger}, Date: {date format=\"YYYY-MM-DD\"}",
            &ctx,
            |t| {
                format!(
                    "Query: rust lang, Trigger: !g, Date: {}",
                    t.format("%Y-%m-%d")
                )
            },
        )
        .await;
    }

    #[tokio::test]
    async fn test_portal_template_arguments_encoding_and_modifiers() {
        let mut args = std::collections::HashMap::new();
        args.insert("Query".to_string(), "hello world & more".to_string());
        args.insert("tone".to_string(), "happy".to_string());

        let ctx = TemplateContext {
            query: None,
            trigger: None,
            args: Some(args),
        };

        let out = resolve_portal_template(
            "https://example.com/search?q={argument name=\"Query\"}&t={argument name=\"tone\" | uppercase}&d={argument name=\"missing\" default=\"fallback val\"}",
            &ctx,
            true,
        )
        .await
        .unwrap();
        assert_eq!(
            out,
            "https://example.com/search?q=hello%20world%20%26%20more&t=HAPPY&d=fallback%20val"
        );

        let mut raw_args = std::collections::HashMap::new();
        raw_args.insert("path".to_string(), "foo/bar".to_string());
        let raw_ctx = TemplateContext {
            args: Some(raw_args),
            ..Default::default()
        };
        let raw_out = resolve_portal_template(
            "https://github.com/{argument name=\"path\" | raw}",
            &raw_ctx,
            true,
        )
        .await
        .unwrap();
        assert_eq!(raw_out, "https://github.com/foo/bar");
    }

    #[tokio::test]
    async fn test_portal_template_date_offset_and_format_locale_guard() {
        let ctx = TemplateContext::default();
        let out = resolve_portal_template(
            "https://example.com/?d={date format=\"yyyy-MM-dd\" offset=\"+1d\"}",
            &ctx,
            true,
        )
        .await
        .unwrap();
        let tomorrow = (chrono::Local::now() + chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string();
        assert_eq!(out, format!("https://example.com/?d={tomorrow}"));

        // Combining format and locale is rejected (left unexpanded)
        let bad =
            resolve_portal_template("{date format=\"yyyy-MM-dd\" locale=\"fr-FR\"}", &ctx, false)
                .await
                .unwrap();
        assert_eq!(bad, "{date format=\"yyyy-MM-dd\" locale=\"fr-FR\"}");
    }

    #[tokio::test]
    async fn test_nested_literal_braces_preserve_inner_placeholders() {
        let mut args = std::collections::HashMap::new();
        args.insert("Q".to_string(), "rust".to_string());
        let ctx = TemplateContext {
            args: Some(args),
            ..Default::default()
        };
        let out = resolve_portal_template(r#"{"q":"{argument name='Q'}","ok":true}"#, &ctx, false)
            .await
            .unwrap();
        assert_eq!(out, r#"{"q":"rust","ok":true}"#);
    }

    #[tokio::test]
    async fn test_date_time_locale_formatting() {
        let ctx = TemplateContext::default();
        assert_renders("{date locale=\"en-GB\"}", &ctx, |t| {
            t.format("%d/%m/%Y").to_string()
        })
        .await;
        assert_renders("{time locale=\"de-DE\"}", &ctx, |t| {
            t.format("%H:%M:%S").to_string()
        })
        .await;
        assert_renders("{date locale=\"ja-JP\"}", &ctx, |t| {
            t.format("%Y/%-m/%-d").to_string()
        })
        .await;
    }
}
