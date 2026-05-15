use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::extensions::CommandArgument;

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParsedScriptHeader {
    pub title: Option<String>,
    pub icon: Option<String>,
    pub arguments: Vec<CommandArgument>,
}

#[derive(Debug, Error, PartialEq)]
pub enum HeaderError {
    #[error("invalid argument JSON on line {line}: {message}")]
    InvalidArgumentJson { line: usize, message: String },
    #[error("argument index {index} out of range (must be 1, 2, or 3)")]
    InvalidArgumentIndex { index: u32 },
    #[error("duplicate argument index {index}")]
    DuplicateArgumentIndex { index: u32 },
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
}
