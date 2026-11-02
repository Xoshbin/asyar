//! Apple Shortcuts abstraction (`shortcuts` CLI).
//!
//! - macOS: runs `/usr/bin/shortcuts` directly (`macos::shortcuts`) — not
//!   through the shell service, so there are no per-binary consent dialogs,
//!   no script `Run` entries and no notifications.
//! - Other platforms: [`PlatformError::Unsupported`].
//!
//! Output parsing and input validation live here, in front of the backend,
//! so they are testable on every platform.

use crate::error::PlatformError;
use serde::{Deserialize, Serialize};

/// Upper bound on the text piped to a shortcut's stdin.
pub const MAX_SHORTCUT_INPUT_BYTES: usize = 1024 * 1024;

/// Upper bound on the text a shortcut may return; a run that emits more is
/// stopped and reported as an error (macOS backend).
#[cfg(target_os = "macos")]
pub const MAX_SHORTCUT_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutInfo {
    /// Stable UUID; survives renames. Falls back to the name when the CLI
    /// does not emit identifiers.
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunShortcutInput {
    /// Shortcut UUID or name.
    pub id_or_name: String,
    /// Text piped to the shortcut as its Shortcut Input.
    pub input: Option<String>,
}

/// Parse `shortcuts list --show-identifiers` output. Each line is
/// `Name (UUID)`; names may themselves contain parentheses, so only the
/// trailing group is treated as the identifier.
pub fn parse_shortcut_list(output: &str) -> Vec<ShortcutInfo> {
    output
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|line| match split_trailing_id(line) {
            Some((name, id)) => ShortcutInfo {
                id: id.to_string(),
                name: name.to_string(),
            },
            None => ShortcutInfo {
                id: line.to_string(),
                name: line.to_string(),
            },
        })
        .collect()
}

fn split_trailing_id(line: &str) -> Option<(&str, &str)> {
    let body = line.strip_suffix(')')?;
    let open = body.rfind('(')?;
    let id = &body[open + 1..];
    let name = body[..open].trim_end();
    let is_id = id.len() >= 8 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    (is_id && !name.is_empty()).then_some((name, id))
}

pub fn validate_run_input(input: &RunShortcutInput) -> Result<(), PlatformError> {
    let target = input.id_or_name.trim();
    if target.is_empty() {
        return Err(PlatformError::InvalidInput(
            "Shortcut id or name must not be empty".into(),
        ));
    }
    if target.contains('\0') {
        return Err(PlatformError::InvalidInput(
            "Shortcut id or name must not contain NUL".into(),
        ));
    }
    // Would be parsed as a CLI flag rather than the shortcut to run.
    if target.starts_with('-') {
        return Err(PlatformError::InvalidInput(
            "Shortcut id or name must not start with '-'".into(),
        ));
    }
    if let Some(text) = &input.input {
        if text.len() > MAX_SHORTCUT_INPUT_BYTES {
            return Err(PlatformError::InvalidInput(format!(
                "Shortcut input exceeds {MAX_SHORTCUT_INPUT_BYTES} bytes"
            )));
        }
        if text.contains('\0') {
            return Err(PlatformError::InvalidInput(
                "Shortcut input must not contain NUL".into(),
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn list_shortcuts() -> Result<Vec<ShortcutInfo>, PlatformError> {
    crate::macos::shortcuts::list_shortcuts()
}

#[cfg(target_os = "macos")]
pub fn run_shortcut(input: RunShortcutInput) -> Result<String, PlatformError> {
    validate_run_input(&input)?;
    crate::macos::shortcuts::run_shortcut(input)
}

#[cfg(not(target_os = "macos"))]
fn unsupported<T>() -> Result<T, PlatformError> {
    Err(PlatformError::Unsupported(
        "Apple Shortcuts is only available on macOS".into(),
    ))
}

#[cfg(not(target_os = "macos"))]
pub fn list_shortcuts() -> Result<Vec<ShortcutInfo>, PlatformError> {
    unsupported()
}

#[cfg(not(target_os = "macos"))]
pub fn run_shortcut(input: RunShortcutInput) -> Result<String, PlatformError> {
    validate_run_input(&input)?;
    unsupported()
}

#[cfg(test)]
mod tests {
    use super::*;

    const UUID: &str = "3F2A9C1E-1234-4ABC-9DEF-0123456789AB";

    fn run(target: &str, input: Option<&str>) -> RunShortcutInput {
        RunShortcutInput {
            id_or_name: target.into(),
            input: input.map(Into::into),
        }
    }

    #[test]
    fn parses_name_and_uuid() {
        let out = parse_shortcut_list(&format!("Morning Routine ({UUID})\n"));
        assert_eq!(
            out,
            vec![ShortcutInfo {
                id: UUID.into(),
                name: "Morning Routine".into()
            }]
        );
    }

    #[test]
    fn name_with_parentheses_keeps_them() {
        let out = parse_shortcut_list(&format!("Resize (Large) (v2) ({UUID})"));
        assert_eq!(out[0].name, "Resize (Large) (v2)");
        assert_eq!(out[0].id, UUID);
    }

    #[test]
    fn parenthesised_name_without_uuid_falls_back_to_line() {
        let out = parse_shortcut_list("Plan (draft)");
        assert_eq!(out[0].id, "Plan (draft)");
        assert_eq!(out[0].name, "Plan (draft)");
    }

    #[test]
    fn skips_blank_lines_and_trims() {
        let out = parse_shortcut_list(&format!("\n  A ({UUID})  \n\n"));
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "A");
    }

    #[test]
    fn rejects_empty_target() {
        assert!(matches!(
            validate_run_input(&run("  ", None)),
            Err(PlatformError::InvalidInput(_))
        ));
    }

    #[test]
    fn rejects_flag_like_target_and_nul() {
        assert!(validate_run_input(&run("--output-path", None)).is_err());
        assert!(validate_run_input(&run("a\0b", None)).is_err());
        assert!(validate_run_input(&run("ok", Some("a\0b"))).is_err());
    }

    #[test]
    fn rejects_oversized_input() {
        let big = "x".repeat(MAX_SHORTCUT_INPUT_BYTES + 1);
        assert!(validate_run_input(&run("ok", Some(&big))).is_err());
    }

    #[test]
    fn accepts_valid_input() {
        assert!(validate_run_input(&run(UUID, Some("hello"))).is_ok());
        assert!(validate_run_input(&run("My Shortcut", None)).is_ok());
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn unsupported_off_macos() {
        assert!(matches!(
            list_shortcuts(),
            Err(PlatformError::Unsupported(_))
        ));
        assert!(matches!(
            run_shortcut(run("ok", None)),
            Err(PlatformError::Unsupported(_))
        ));
    }
}
