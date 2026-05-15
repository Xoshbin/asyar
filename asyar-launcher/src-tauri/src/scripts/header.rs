use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::extensions::CommandArgument;

/// Lowest legal refreshTime; Raycast parity.
pub const MIN_REFRESH_TIME_SECONDS: u64 = 10;

/// Execution mode declared by `# @asyar.mode <value>`. Mirrors Raycast's
/// `mode` script directive. `Compact` is the default when no directive is
/// present and matches today's "run-once, show subtitle on the row while
/// active" behavior. Only `Inline` is fully wired in this iteration; the
/// other variants are accepted and stored for forward compatibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ScriptMode {
    Silent,
    #[default]
    Compact,
    FullOutput,
    Inline,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedScriptHeader {
    pub title: Option<String>,
    pub icon: Option<String>,
    pub arguments: Vec<CommandArgument>,
    /// Declared execution mode. Defaults to `Compact` when the script
    /// omits `@asyar.mode`.
    #[serde(default)]
    pub mode: ScriptMode,
    /// `Some(seconds)` when the script declared a `@asyar.refreshTime`,
    /// already clamped to the 10s floor. `None` when the directive is
    /// absent — required for inline mode to actually tick.
    #[serde(default)]
    pub refresh_time_seconds: Option<u64>,
    /// True iff the declared refreshTime was below the 10s floor and got
    /// clamped on the way through the parser. The TS layer reads this to
    /// surface a one-time diagnostic to the user.
    #[serde(default)]
    pub refresh_time_clamped: bool,
}

#[derive(Debug, Error, PartialEq)]
pub enum HeaderError {
    #[error("invalid argument JSON on line {line}: {message}")]
    InvalidArgumentJson { line: usize, message: String },
    #[error("argument index {index} out of range (must be 1, 2, or 3)")]
    InvalidArgumentIndex { index: u32 },
    #[error("duplicate argument index {index}")]
    DuplicateArgumentIndex { index: u32 },
    #[error("invalid mode value '{value}' (expected silent | compact | fullOutput | inline)")]
    InvalidMode { value: String },
    #[error("invalid refreshTime '{value}' (expected <N><s|m|h|d>, e.g. 30s or 5m)")]
    InvalidRefreshTime { value: String },
}

/// Parse Raycast-compatible script metadata headers from the top of a script file.
pub fn parse_header(content: &str) -> Result<ParsedScriptHeader, HeaderError> {
    let mut header = ParsedScriptHeader::default();
    let mut seen_argument_indices: std::collections::HashSet<u32> = Default::default();
    let mut argument_pairs: Vec<(u32, CommandArgument)> = Vec::new();

    for (idx, raw_line) in content.lines().enumerate() {
        let line_no = idx + 1;
        let line = raw_line.trim_end_matches('\r').trim_start();

        // Shebang only allowed on line 1
        if line_no == 1 && line.starts_with("#!") {
            continue;
        }

        // Header section ends at the first non-shebang, non-comment line
        if !line.starts_with('#') {
            break;
        }

        // Strip leading '#' and any whitespace
        let body = line.trim_start_matches('#').trim_start();

        if let Some(value) = body.strip_prefix("@asyar.title ") {
            header.title = Some(value.trim().to_string());
        } else if let Some(value) = body.strip_prefix("@asyar.icon ") {
            header.icon = Some(value.trim().to_string());
        } else if let Some(value) = body.strip_prefix("@asyar.mode ") {
            header.mode = parse_mode(value.trim())?;
        } else if let Some(value) = body.strip_prefix("@asyar.refreshTime ") {
            let (secs, clamped) = parse_refresh_time(value.trim())?;
            header.refresh_time_seconds = Some(secs);
            header.refresh_time_clamped = clamped;
        } else if let Some(rest) = body.strip_prefix("@asyar.argument:") {
            // Read digits for the index
            let digit_end = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            let digits = &rest[..digit_end];
            let index: u32 = digits.parse().unwrap_or(0);

            if index == 0 || index > 3 {
                return Err(HeaderError::InvalidArgumentIndex { index });
            }

            if !seen_argument_indices.insert(index) {
                return Err(HeaderError::DuplicateArgumentIndex { index });
            }

            let json_str = rest[digit_end..].trim_start();
            let parsed = serde_json::from_str::<CommandArgument>(json_str).map_err(|e| {
                HeaderError::InvalidArgumentJson {
                    line: line_no,
                    message: e.to_string(),
                }
            })?;

            argument_pairs.push((index, parsed));
        }
        // Other comment content is silently ignored
    }

    argument_pairs.sort_by_key(|(i, _)| *i);
    header.arguments = argument_pairs.into_iter().map(|(_, a)| a).collect();
    Ok(header)
}

fn parse_mode(value: &str) -> Result<ScriptMode, HeaderError> {
    match value {
        "silent" => Ok(ScriptMode::Silent),
        "compact" => Ok(ScriptMode::Compact),
        "fullOutput" => Ok(ScriptMode::FullOutput),
        "inline" => Ok(ScriptMode::Inline),
        other => Err(HeaderError::InvalidMode {
            value: other.to_string(),
        }),
    }
}

/// Parse a Raycast-style refreshTime token like `30s`, `5m`, `2h`, `1d`
/// into a count of seconds. Returns `(seconds, clamped)` — `clamped` is
/// true when the original value was below the 10s floor and the result
/// was raised to 10. Returns `InvalidRefreshTime` for unparseable tokens
/// or unknown unit suffixes.
fn parse_refresh_time(value: &str) -> Result<(u64, bool), HeaderError> {
    if value.is_empty() {
        return Err(HeaderError::InvalidRefreshTime {
            value: value.to_string(),
        });
    }
    // Split into numeric prefix + single-char unit suffix
    let bytes = value.as_bytes();
    let unit = *bytes.last().ok_or_else(|| HeaderError::InvalidRefreshTime {
        value: value.to_string(),
    })?;
    let multiplier: u64 = match unit {
        b's' => 1,
        b'm' => 60,
        b'h' => 60 * 60,
        b'd' => 60 * 60 * 24,
        _ => {
            return Err(HeaderError::InvalidRefreshTime {
                value: value.to_string(),
            });
        }
    };
    let digits = &value[..value.len() - 1];
    let n: u64 = digits
        .parse()
        .map_err(|_| HeaderError::InvalidRefreshTime {
            value: value.to_string(),
        })?;
    let raw = n.saturating_mul(multiplier);
    if raw < MIN_REFRESH_TIME_SECONDS {
        Ok((MIN_REFRESH_TIME_SECONDS, true))
    } else {
        Ok((raw, false))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::CommandArgumentType;

    // ---- happy paths --------------------------------------------------------

    #[test]
    fn parses_empty_content_returns_default() {
        let result = parse_header("").unwrap();
        assert_eq!(result, ParsedScriptHeader {
            title: None,
            icon: None,
            arguments: vec![],
            mode: ScriptMode::Compact,
            refresh_time_seconds: None,
            refresh_time_clamped: false,
        });
    }

    #[test]
    fn parses_title_only() {
        let content = "# @asyar.title Hello World\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.title, Some("Hello World".to_string()));
        assert_eq!(result.icon, None);
        assert!(result.arguments.is_empty());
    }

    #[test]
    fn parses_shebang_then_title() {
        let content = "#!/bin/bash\n# @asyar.title Test\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.title, Some("Test".to_string()));
    }

    #[test]
    fn parses_title_with_extra_whitespace() {
        let content = "#  @asyar.title    Trimmed Value   \n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.title, Some("Trimmed Value".to_string()));
    }

    #[test]
    fn parses_icon() {
        let content = "# @asyar.icon icon:wave\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.icon, Some("icon:wave".to_string()));
        assert_eq!(result.title, None);
    }

    #[test]
    fn parses_one_argument() {
        let content =
            "# @asyar.argument:1 { \"name\": \"target\", \"type\": \"text\", \"required\": true }\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.arguments.len(), 1);
        let arg = &result.arguments[0];
        assert_eq!(arg.name, "target");
        assert_eq!(arg.argument_type, CommandArgumentType::Text);
        assert_eq!(arg.required, Some(true));
    }

    #[test]
    fn parses_three_arguments() {
        let content = concat!(
            "# @asyar.argument:1 { \"name\": \"first\", \"type\": \"text\", \"required\": true }\n",
            "# @asyar.argument:2 { \"name\": \"second\", \"type\": \"text\", \"required\": false }\n",
            "# @asyar.argument:3 { \"name\": \"third\", \"type\": \"number\", \"required\": false }\n",
        );
        let result = parse_header(content).unwrap();
        assert_eq!(result.arguments.len(), 3);
        assert_eq!(result.arguments[0].name, "first");
        assert_eq!(result.arguments[1].name, "second");
        assert_eq!(result.arguments[2].name, "third");
        assert_eq!(result.arguments[2].argument_type, CommandArgumentType::Number);
    }

    #[test]
    fn header_without_shebang_is_valid() {
        let content = "# @asyar.title Direct\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.title, Some("Direct".to_string()));
    }

    #[test]
    fn non_asyar_comments_ignored() {
        let content = concat!(
            "# this is just a comment\n",
            "# @asyar.title Real\n",
            "# something else\n",
        );
        let result = parse_header(content).unwrap();
        assert_eq!(result.title, Some("Real".to_string()));
        assert_eq!(result.icon, None);
        assert!(result.arguments.is_empty());
    }

    #[test]
    fn windows_line_endings_tolerated() {
        let content = "#!/bin/bash\r\n# @asyar.title Windows\r\n# @asyar.icon icon:wave\r\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.title, Some("Windows".to_string()));
        assert_eq!(result.icon, Some("icon:wave".to_string()));
    }

    #[test]
    fn body_after_header_is_ignored() {
        let content = concat!(
            "# @asyar.title T\n",
            "\n",
            "echo hello\n",
            "# @asyar.icon ignored\n",
        );
        let result = parse_header(content).unwrap();
        assert_eq!(result.title, Some("T".to_string()));
        assert_eq!(result.icon, None);
    }

    // ---- error paths --------------------------------------------------------

    #[test]
    fn argument_index_zero_rejected() {
        let content =
            "# @asyar.argument:0 { \"name\": \"x\", \"type\": \"text\", \"required\": false }\n";
        let err = parse_header(content).unwrap_err();
        assert_eq!(err, HeaderError::InvalidArgumentIndex { index: 0 });
    }

    #[test]
    fn argument_index_four_rejected() {
        let content =
            "# @asyar.argument:4 { \"name\": \"x\", \"type\": \"text\", \"required\": false }\n";
        let err = parse_header(content).unwrap_err();
        assert_eq!(err, HeaderError::InvalidArgumentIndex { index: 4 });
    }

    #[test]
    fn duplicate_argument_index_rejected() {
        let content = concat!(
            "# @asyar.argument:1 { \"name\": \"first\", \"type\": \"text\", \"required\": true }\n",
            "# @asyar.argument:1 { \"name\": \"second\", \"type\": \"text\", \"required\": false }\n",
        );
        let err = parse_header(content).unwrap_err();
        assert_eq!(err, HeaderError::DuplicateArgumentIndex { index: 1 });
    }

    #[test]
    fn malformed_argument_json_rejected() {
        let content = "# @asyar.argument:1 { not valid json\n";
        let err = parse_header(content).unwrap_err();
        assert!(
            matches!(err, HeaderError::InvalidArgumentJson { line: 1, .. }),
            "expected InvalidArgumentJson at line 1, got: {err:?}"
        );
    }

    // ---- mode --------------------------------------------------------------

    #[test]
    fn mode_defaults_to_compact_when_absent() {
        let content = "# @asyar.title Demo\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.mode, ScriptMode::Compact);
    }

    #[test]
    fn mode_inline_parsed() {
        let content = "# @asyar.title Demo\n# @asyar.mode inline\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.mode, ScriptMode::Inline);
    }

    #[test]
    fn mode_silent_parsed() {
        let content = "# @asyar.mode silent\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.mode, ScriptMode::Silent);
    }

    #[test]
    fn mode_full_output_parsed() {
        let content = "# @asyar.mode fullOutput\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.mode, ScriptMode::FullOutput);
    }

    #[test]
    fn mode_compact_parsed_explicit() {
        let content = "# @asyar.mode compact\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.mode, ScriptMode::Compact);
    }

    #[test]
    fn mode_unknown_value_rejected() {
        let content = "# @asyar.mode galaxy\n";
        let err = parse_header(content).unwrap_err();
        assert!(
            matches!(err, HeaderError::InvalidMode { .. }),
            "expected InvalidMode for unknown mode value, got: {err:?}"
        );
    }

    // ---- refreshTime -------------------------------------------------------

    #[test]
    fn refresh_time_absent_is_none() {
        let content = "# @asyar.title Demo\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.refresh_time_seconds, None);
        assert!(!result.refresh_time_clamped);
    }

    #[test]
    fn refresh_time_seconds_parsed() {
        let content = "# @asyar.refreshTime 30s\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.refresh_time_seconds, Some(30));
        assert!(!result.refresh_time_clamped);
    }

    #[test]
    fn refresh_time_minutes_parsed() {
        let content = "# @asyar.refreshTime 5m\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.refresh_time_seconds, Some(300));
    }

    #[test]
    fn refresh_time_hours_parsed() {
        let content = "# @asyar.refreshTime 2h\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.refresh_time_seconds, Some(7200));
    }

    #[test]
    fn refresh_time_days_parsed() {
        let content = "# @asyar.refreshTime 1d\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.refresh_time_seconds, Some(86400));
    }

    #[test]
    fn refresh_time_clamped_to_ten_seconds_floor() {
        let content = "# @asyar.refreshTime 5s\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.refresh_time_seconds, Some(10));
        assert!(
            result.refresh_time_clamped,
            "values below 10s must set refresh_time_clamped=true so the TS layer can surface a diagnostic"
        );
    }

    #[test]
    fn refresh_time_clamp_floor_inclusive_at_ten() {
        let content = "# @asyar.refreshTime 10s\n";
        let result = parse_header(content).unwrap();
        assert_eq!(result.refresh_time_seconds, Some(10));
        assert!(
            !result.refresh_time_clamped,
            "10s is the minimum legal value; must NOT report as clamped"
        );
    }

    #[test]
    fn refresh_time_invalid_unit_rejected() {
        let content = "# @asyar.refreshTime 5y\n";
        let err = parse_header(content).unwrap_err();
        assert!(
            matches!(err, HeaderError::InvalidRefreshTime { .. }),
            "expected InvalidRefreshTime for unsupported unit, got: {err:?}"
        );
    }

    #[test]
    fn refresh_time_invalid_number_rejected() {
        let content = "# @asyar.refreshTime abcs\n";
        let err = parse_header(content).unwrap_err();
        assert!(matches!(err, HeaderError::InvalidRefreshTime { .. }));
    }

    #[test]
    fn refresh_time_missing_unit_rejected() {
        let content = "# @asyar.refreshTime 30\n";
        let err = parse_header(content).unwrap_err();
        assert!(matches!(err, HeaderError::InvalidRefreshTime { .. }));
    }
}
