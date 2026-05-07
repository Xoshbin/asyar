//! Argument-schema validator shared between the manifest install path
//! and the runtime dynamic command registration path.
//!
//! The SDK CLI runs an equivalent validator at extension build time
//! (`asyar-sdk/cli/lib/manifest.ts::validateArguments`); this is the
//! host-side mirror that runs at the trust boundary. Two reasons this
//! must exist host-side:
//!
//! 1. Hand-crafted manifests installed without the SDK CLI would skip
//!    the build-time check; calling this from the manifest install
//!    path closes that gap.
//! 2. Dynamic commands carry runtime arguments from a sandboxed
//!    extension iframe over postMessage IPC — untrusted input that
//!    must be validated on the host side, never trusted from the
//!    sender.

use crate::extensions::{CommandArgument, CommandArgumentType};

pub const MAX_ARGUMENTS_PER_COMMAND: usize = 3;
pub const MAX_DYNAMIC_ID_LEN: usize = 128;

/// Validate a slice of argument declarations. Returns `Err(message)`
/// on the first failure. Mirrors the rules in the SDK CLI's
/// `validateArguments`:
///
/// - `args.len() <= MAX_ARGUMENTS_PER_COMMAND` (3)
/// - Each `name` matches `^[a-zA-Z_][a-zA-Z0-9_]*$`
/// - Names are unique within the command
/// - A required argument cannot follow an optional one
/// - Dropdowns require non-empty `data[]`
/// - Each dropdown option needs non-empty `value` and `title`
/// - When present, `default` must match the declared type
///   (number → number; text/password → string; dropdown →
///   one of `data[].value`)
pub fn validate_arguments(args: &[CommandArgument]) -> Result<(), String> {
    if args.len() > MAX_ARGUMENTS_PER_COMMAND {
        return Err(format!(
            "a command can declare at most {} arguments (got {})",
            MAX_ARGUMENTS_PER_COMMAND,
            args.len()
        ));
    }

    let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
    let mut saw_optional = false;

    for (i, a) in args.iter().enumerate() {
        let base = format!("arguments[{i}]");

        if a.name.is_empty() {
            return Err(format!("{base}.name is required"));
        }
        if !is_valid_arg_name(&a.name) {
            return Err(format!(
                "{base}.name '{}' must match /^[a-zA-Z_][a-zA-Z0-9_]*$/",
                a.name
            ));
        }
        if !seen.insert(a.name.as_str()) {
            return Err(format!("{base}.name duplicate argument name '{}'", a.name));
        }

        let is_required = a.required.unwrap_or(false);
        if saw_optional && is_required {
            return Err(format!(
                "{base} required argument '{}' cannot follow an optional argument",
                a.name
            ));
        }
        if !is_required {
            saw_optional = true;
        }

        if matches!(a.argument_type, CommandArgumentType::Dropdown) {
            let data = a
                .data
                .as_ref()
                .ok_or_else(|| format!("{base}.data dropdown requires non-empty data array"))?;
            if data.is_empty() {
                return Err(format!("{base}.data dropdown requires non-empty data array"));
            }
            for (di, opt) in data.iter().enumerate() {
                if opt.value.is_empty() || opt.title.is_empty() {
                    return Err(format!(
                        "{base}.data[{di}] each dropdown option needs value and title"
                    ));
                }
            }
            if let Some(default) = &a.default {
                let default_str = match default {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                if !data.iter().any(|d| d.value == default_str) {
                    return Err(format!(
                        "{base}.default '{default_str}' not in data[]"
                    ));
                }
            }
        }

        if let Some(default) = &a.default {
            match a.argument_type {
                CommandArgumentType::Number => {
                    if !default.is_number() {
                        return Err(format!("{base}.default number default must be a number"));
                    }
                }
                CommandArgumentType::Text | CommandArgumentType::Password => {
                    if !default.is_string() {
                        return Err(format!(
                            "{base}.default {:?} default must be a string",
                            a.argument_type
                        ));
                    }
                }
                CommandArgumentType::Dropdown => {
                    // Already checked against data[] above.
                }
            }
        }
    }

    Ok(())
}

fn is_valid_arg_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    if !is_name_start(bytes[0]) {
        return false;
    }
    bytes[1..].iter().all(|b| is_name_continue(*b))
}

fn is_name_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}

fn is_name_continue(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Validate a dynamic command's stable id. Stricter than argument
/// names: ids may include `-` (UUIDs are common id sources), but no
/// leading-digit restriction so `5fd022c8-...` UUIDs work.
pub fn validate_dynamic_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("id must not be empty".to_string());
    }
    if id.len() > MAX_DYNAMIC_ID_LEN {
        return Err(format!(
            "id length {} exceeds max {}",
            id.len(),
            MAX_DYNAMIC_ID_LEN
        ));
    }
    let ok = id
        .as_bytes()
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-');
    if !ok {
        return Err(format!(
            "id '{id}' must match /^[a-zA-Z0-9_-]+$/"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::{CommandArgument, CommandArgumentType, DropdownOption};
    use serde_json::json;

    fn arg(name: &str, ty: CommandArgumentType) -> CommandArgument {
        CommandArgument {
            name: name.to_string(),
            argument_type: ty,
            placeholder: None,
            required: None,
            default: None,
            data: None,
        }
    }

    fn required(mut a: CommandArgument) -> CommandArgument {
        a.required = Some(true);
        a
    }

    fn with_default(mut a: CommandArgument, v: serde_json::Value) -> CommandArgument {
        a.default = Some(v);
        a
    }

    fn dropdown(name: &str, options: Vec<(&str, &str)>) -> CommandArgument {
        let data = options
            .into_iter()
            .map(|(v, t)| DropdownOption {
                value: v.to_string(),
                title: t.to_string(),
            })
            .collect();
        CommandArgument {
            name: name.to_string(),
            argument_type: CommandArgumentType::Dropdown,
            placeholder: None,
            required: None,
            default: None,
            data: Some(data),
        }
    }

    #[test]
    fn empty_args_is_ok() {
        assert!(validate_arguments(&[]).is_ok());
    }

    #[test]
    fn one_text_arg_is_ok() {
        assert!(validate_arguments(&[arg("query", CommandArgumentType::Text)]).is_ok());
    }

    #[test]
    fn three_args_at_max_is_ok() {
        let args = vec![
            arg("a", CommandArgumentType::Text),
            arg("b", CommandArgumentType::Text),
            arg("c", CommandArgumentType::Text),
        ];
        assert!(validate_arguments(&args).is_ok());
    }

    #[test]
    fn four_args_rejects() {
        let args = vec![
            arg("a", CommandArgumentType::Text),
            arg("b", CommandArgumentType::Text),
            arg("c", CommandArgumentType::Text),
            arg("d", CommandArgumentType::Text),
        ];
        let err = validate_arguments(&args).unwrap_err();
        assert!(err.contains("at most 3"));
    }

    #[test]
    fn empty_name_rejects() {
        let args = vec![arg("", CommandArgumentType::Text)];
        let err = validate_arguments(&args).unwrap_err();
        assert!(err.contains("name is required"));
    }

    #[test]
    fn invalid_name_rejects() {
        let args = vec![arg("1bad", CommandArgumentType::Text)];
        let err = validate_arguments(&args).unwrap_err();
        assert!(err.contains("must match"));
    }

    #[test]
    fn name_with_hyphen_rejects() {
        // hyphens are allowed in dynamic IDs but not in argument names
        let args = vec![arg("bad-name", CommandArgumentType::Text)];
        assert!(validate_arguments(&args).is_err());
    }

    #[test]
    fn duplicate_names_rejects() {
        let args = vec![
            arg("query", CommandArgumentType::Text),
            arg("query", CommandArgumentType::Text),
        ];
        let err = validate_arguments(&args).unwrap_err();
        assert!(err.contains("Duplicate") || err.contains("duplicate"));
    }

    #[test]
    fn required_after_optional_rejects() {
        let args = vec![
            arg("opt", CommandArgumentType::Text),               // optional (default)
            required(arg("req", CommandArgumentType::Text)),     // required
        ];
        let err = validate_arguments(&args).unwrap_err();
        assert!(err.contains("cannot follow an optional"));
    }

    #[test]
    fn required_then_optional_is_ok() {
        let args = vec![
            required(arg("req", CommandArgumentType::Text)),
            arg("opt", CommandArgumentType::Text),
        ];
        assert!(validate_arguments(&args).is_ok());
    }

    #[test]
    fn dropdown_without_data_rejects() {
        let args = vec![arg("choice", CommandArgumentType::Dropdown)];
        let err = validate_arguments(&args).unwrap_err();
        assert!(err.contains("dropdown requires non-empty"));
    }

    #[test]
    fn dropdown_with_empty_data_rejects() {
        let args = vec![dropdown("choice", vec![])];
        let err = validate_arguments(&args).unwrap_err();
        assert!(err.contains("dropdown requires non-empty"));
    }

    #[test]
    fn dropdown_with_options_is_ok() {
        let args = vec![dropdown("choice", vec![("a", "Apple"), ("b", "Banana")])];
        assert!(validate_arguments(&args).is_ok());
    }

    #[test]
    fn dropdown_option_with_empty_value_rejects() {
        let args = vec![dropdown("choice", vec![("", "Apple")])];
        let err = validate_arguments(&args).unwrap_err();
        assert!(err.contains("value and title"));
    }

    #[test]
    fn dropdown_default_in_options_is_ok() {
        let args = vec![with_default(
            dropdown("choice", vec![("a", "Apple"), ("b", "Banana")]),
            json!("a"),
        )];
        assert!(validate_arguments(&args).is_ok());
    }

    #[test]
    fn dropdown_default_not_in_options_rejects() {
        let args = vec![with_default(
            dropdown("choice", vec![("a", "Apple"), ("b", "Banana")]),
            json!("z"),
        )];
        let err = validate_arguments(&args).unwrap_err();
        assert!(err.contains("not in data"));
    }

    #[test]
    fn number_default_string_rejects() {
        let args = vec![with_default(arg("n", CommandArgumentType::Number), json!("5"))];
        let err = validate_arguments(&args).unwrap_err();
        assert!(err.contains("number default must be a number"));
    }

    #[test]
    fn number_default_number_is_ok() {
        let args = vec![with_default(arg("n", CommandArgumentType::Number), json!(5))];
        assert!(validate_arguments(&args).is_ok());
    }

    #[test]
    fn text_default_number_rejects() {
        let args = vec![with_default(arg("t", CommandArgumentType::Text), json!(5))];
        let err = validate_arguments(&args).unwrap_err();
        assert!(err.contains("default must be a string"));
    }

    #[test]
    fn validate_dynamic_id_accepts_uuid() {
        assert!(validate_dynamic_id("5fd022c8-ad53-4a42-820c-36420146fa3c").is_ok());
    }

    #[test]
    fn validate_dynamic_id_accepts_alphanumeric() {
        assert!(validate_dynamic_id("shortcut_42").is_ok());
    }

    #[test]
    fn validate_dynamic_id_rejects_empty() {
        assert!(validate_dynamic_id("").is_err());
    }

    #[test]
    fn validate_dynamic_id_rejects_spaces() {
        assert!(validate_dynamic_id("with space").is_err());
    }

    #[test]
    fn validate_dynamic_id_rejects_colon() {
        // colon could collide with `dynamic:` persistence prefix
        assert!(validate_dynamic_id("a:b").is_err());
    }

    #[test]
    fn validate_dynamic_id_rejects_too_long() {
        let long = "a".repeat(MAX_DYNAMIC_ID_LEN + 1);
        assert!(validate_dynamic_id(&long).is_err());
    }

    #[test]
    fn validate_dynamic_id_accepts_at_max_length() {
        let max = "a".repeat(MAX_DYNAMIC_ID_LEN);
        assert!(validate_dynamic_id(&max).is_ok());
    }
}
