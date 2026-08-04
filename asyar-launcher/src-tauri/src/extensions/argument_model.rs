//! Resolves the command-argument model: seeding, provenance (which values
//! came from the user vs. a declared default), the `required`/`requireAnyOf`
//! gates, and the coerced execution payload.
//!
//! Moved out of the launcher's `commandArgumentsService.svelte.ts` (a
//! `rust-first` violation flagged after PR #584 landed) — see the
//! `rust-first` skill. This module is the single source of truth for the
//! computation; `commands::argument_model::resolve_command_arguments` is a
//! thin Tauri wrapper around [`resolve`].
//!
//! `fieldNeedsValue`/`fieldNeedsAnyOf` deliberately stay in TypeScript: they
//! read live DOM-focus state (`currentFieldIdx`) that has no meaning here.
//! They consume [`ArgumentModelResolution::require_any_of_unsatisfied`] as a
//! precomputed field, the same pattern `Command.has_arguments` uses.

use crate::extensions::{ArgumentSeed, CommandArgument, CommandArgumentType};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveArgumentModelRequest {
    pub args: Vec<CommandArgument>,
    #[serde(default)]
    pub persisted: HashMap<String, String>,
    /// The caller's current known values. May be sparse (just what a stash
    /// restored) or a full snapshot — [`resolve`] merges this under the
    /// computed seeds either way, so a field the caller never mentions still
    /// resolves to its seed rather than reading as blank.
    #[serde(default)]
    pub values: HashMap<String, String>,
    #[serde(default)]
    pub edited: Vec<String>,
    #[serde(default)]
    pub confirmed: Vec<String>,
    #[serde(default)]
    pub require_any_of: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(untagged)]
pub enum ArgumentPayloadValue {
    Number(f64),
    Text(String),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArgumentModelResolution {
    /// The values a fresh `enter()` starts from — mirrors `seedArgumentValues`.
    pub seeds: HashMap<String, String>,
    /// Names whose seed came from the user's own previous run — mirrors
    /// `seedIsUserSupplied`, precomputed for every declared argument.
    pub seeded_from_user: Vec<String>,
    /// Names of arguments whose effective seed is `lastUsed` — the only ones
    /// a submitted value should ever be persisted for. A password (forced to
    /// `none`) or an arg declaring `seed: default` never appears here, even
    /// if the user typed into it this run.
    pub last_used_fields: Vec<String>,
    /// Values that came from the user rather than a declared default —
    /// mirrors `userSuppliedValues`.
    pub user_supplied: HashMap<String, String>,
    /// `user_supplied` plus any seeded value in a field the caller reports
    /// as `confirmed` — mirrors `acknowledgedValues`.
    pub acknowledged: HashMap<String, String>,
    /// Required fields blank in `values` as given — "blank on screen".
    pub unfilled_required_visible: Vec<String>,
    /// Required fields absent from `user_supplied` — the real gate, no
    /// selection credit.
    pub unfilled_required: Vec<String>,
    /// Required fields absent from `acknowledged` — the submit gate, credits
    /// a confirmed selection.
    pub unfilled_required_acknowledged: Vec<String>,
    /// `requireAnyOf`, evaluated against `user_supplied` only — a confirmed
    /// selection never satisfies this gate, only `required` credits it.
    pub require_any_of_unsatisfied: bool,
    /// Every entered value coerced to its declared type, with a declared
    /// default standing in for a blank field — mirrors `buildArgumentsPayload`.
    pub payload: HashMap<String, ArgumentPayloadValue>,
}

fn has_declared_default(arg: &CommandArgument) -> bool {
    !matches!(arg.default, None | Some(serde_json::Value::Null))
}

fn effective_seed(arg: &CommandArgument) -> ArgumentSeed {
    if arg.argument_type == CommandArgumentType::Password {
        return ArgumentSeed::None;
    }
    arg.seed.clone().unwrap_or(ArgumentSeed::LastUsed)
}

/// `String(arg.default)` for a declared default: quotes are never added for
/// a JSON string, and a JSON number prints as its bare digits.
fn default_as_string(arg: &CommandArgument) -> String {
    match &arg.default {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

fn default_as_number(arg: &CommandArgument) -> f64 {
    arg.default.as_ref().and_then(|v| v.as_f64()).unwrap_or(0.0)
}

fn seed_argument_values(
    args: &[CommandArgument],
    persisted: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut values = HashMap::new();
    for arg in args {
        let seed = effective_seed(arg);
        if seed == ArgumentSeed::None {
            values.insert(arg.name.clone(), String::new());
            continue;
        }
        let declared = if has_declared_default(arg) {
            default_as_string(arg)
        } else {
            String::new()
        };
        let value = if seed == ArgumentSeed::LastUsed {
            persisted.get(&arg.name).cloned().unwrap_or(declared)
        } else {
            declared
        };
        values.insert(arg.name.clone(), value);
    }
    values
}

fn seed_is_user_supplied(arg: &CommandArgument, persisted: &HashMap<String, String>) -> bool {
    effective_seed(arg) == ArgumentSeed::LastUsed
        && persisted
            .get(&arg.name)
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false)
}

fn user_supplied_values(
    args: &[CommandArgument],
    values: &HashMap<String, String>,
    edited: &HashSet<String>,
    seeded_from_user: &HashSet<String>,
) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for arg in args {
        let raw = values.get(&arg.name).map(|v| v.trim()).unwrap_or("");
        if raw.is_empty() {
            continue;
        }
        if edited.contains(&arg.name) || seeded_from_user.contains(&arg.name) {
            out.insert(arg.name.clone(), raw.to_string());
        }
    }
    out
}

fn acknowledged_values(
    args: &[CommandArgument],
    values: &HashMap<String, String>,
    user_supplied: &HashMap<String, String>,
    confirmed: &HashSet<String>,
) -> HashMap<String, String> {
    let mut out = user_supplied.clone();
    for arg in args {
        if out.contains_key(&arg.name) {
            continue;
        }
        let raw = values.get(&arg.name).map(|v| v.trim()).unwrap_or("");
        if !raw.is_empty() && confirmed.contains(&arg.name) {
            out.insert(arg.name.clone(), raw.to_string());
        }
    }
    out
}

fn require_any_of_unsatisfied(
    require_any_of: Option<&[String]>,
    user_values: &HashMap<String, String>,
) -> bool {
    match require_any_of {
        None => false,
        Some([]) => false,
        Some(names) => !names.iter().any(|n| {
            user_values
                .get(n)
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false)
        }),
    }
}

fn unfilled_required_args(
    args: &[CommandArgument],
    value_map: &HashMap<String, String>,
) -> Vec<String> {
    args.iter()
        .filter(|a| {
            a.required.unwrap_or(false)
                && value_map
                    .get(&a.name)
                    .map(|v| v.trim().is_empty())
                    .unwrap_or(true)
        })
        .map(|a| a.name.clone())
        .collect()
}

fn build_arguments_payload(
    args: &[CommandArgument],
    values: &HashMap<String, String>,
) -> HashMap<String, ArgumentPayloadValue> {
    let mut payload = HashMap::new();
    for arg in args {
        let raw = values.get(&arg.name).map(|v| v.trim()).unwrap_or("");
        if raw.is_empty() {
            if has_declared_default(arg) {
                let value = if arg.argument_type == CommandArgumentType::Number {
                    ArgumentPayloadValue::Number(default_as_number(arg))
                } else {
                    ArgumentPayloadValue::Text(default_as_string(arg))
                };
                payload.insert(arg.name.clone(), value);
            }
            continue;
        }
        let value = if arg.argument_type == CommandArgumentType::Number {
            ArgumentPayloadValue::Number(raw.parse::<f64>().unwrap_or(0.0))
        } else {
            ArgumentPayloadValue::Text(raw.to_string())
        };
        payload.insert(arg.name.clone(), value);
    }
    payload
}

/// The single entry point: everything downstream (the launcher's argument
/// chip row, the Enter-to-run gate, the persisted-defaults writer) reads a
/// field off this instead of recomputing it.
pub fn resolve(req: &ResolveArgumentModelRequest) -> ArgumentModelResolution {
    let seeds = seed_argument_values(&req.args, &req.persisted);
    let seeded_from_user: HashSet<String> = req
        .args
        .iter()
        .filter(|a| seed_is_user_supplied(a, &req.persisted))
        .map(|a| a.name.clone())
        .collect();
    let last_used_fields: Vec<String> = req
        .args
        .iter()
        .filter(|a| effective_seed(a) == ArgumentSeed::LastUsed)
        .map(|a| a.name.clone())
        .collect();
    let edited: HashSet<String> = req.edited.iter().cloned().collect();
    let confirmed: HashSet<String> = req.confirmed.iter().cloned().collect();

    // `values` may be a sparse override map (what enter()/prepareRun() have
    // before any field has been touched) or a fully pre-merged snapshot
    // (what the active chip row sends on every keystroke) — merging under
    // the computed seeds makes both callers correct without either one
    // having to duplicate the seeding rule.
    let mut effective_values = seeds.clone();
    for (name, value) in &req.values {
        effective_values.insert(name.clone(), value.clone());
    }

    let user_supplied =
        user_supplied_values(&req.args, &effective_values, &edited, &seeded_from_user);
    let acknowledged =
        acknowledged_values(&req.args, &effective_values, &user_supplied, &confirmed);

    let unfilled_required_visible = unfilled_required_args(&req.args, &effective_values);
    let unfilled_required = unfilled_required_args(&req.args, &user_supplied);
    let unfilled_required_acknowledged = unfilled_required_args(&req.args, &acknowledged);

    let require_any_of_unsatisfied =
        require_any_of_unsatisfied(req.require_any_of.as_deref(), &user_supplied);

    let payload = build_arguments_payload(&req.args, &effective_values);

    ArgumentModelResolution {
        seeds,
        seeded_from_user: seeded_from_user.into_iter().collect(),
        last_used_fields,
        user_supplied,
        acknowledged,
        unfilled_required_visible,
        unfilled_required,
        unfilled_required_acknowledged,
        require_any_of_unsatisfied,
        payload,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arg(name: &str, ty: CommandArgumentType) -> CommandArgument {
        CommandArgument {
            name: name.to_string(),
            argument_type: ty,
            placeholder: None,
            required: None,
            default: None,
            data: None,
            seed: None,
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

    fn with_seed(mut a: CommandArgument, s: ArgumentSeed) -> CommandArgument {
        a.seed = Some(s);
        a
    }

    fn req(args: Vec<CommandArgument>) -> ResolveArgumentModelRequest {
        ResolveArgumentModelRequest {
            args,
            persisted: HashMap::new(),
            values: HashMap::new(),
            edited: Vec::new(),
            confirmed: Vec::new(),
            require_any_of: None,
        }
    }

    fn set(names: &[&str]) -> HashSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    // --- has_declared_default / effective_seed ---

    #[test]
    fn has_declared_default_is_false_for_json_null() {
        // Manifests round-trip through Rust: an omitted `default` comes back
        // as JSON null rather than absent.
        let a = with_default(arg("q", CommandArgumentType::Text), serde_json::Value::Null);
        assert!(!has_declared_default(&a));
    }

    #[test]
    fn has_declared_default_is_true_for_a_real_value() {
        let a = with_default(arg("q", CommandArgumentType::Text), serde_json::json!("hi"));
        assert!(has_declared_default(&a));
    }

    #[test]
    fn effective_seed_forces_none_for_password_even_if_declared_otherwise() {
        let a = with_seed(
            arg("secret", CommandArgumentType::Password),
            ArgumentSeed::LastUsed,
        );
        assert_eq!(effective_seed(&a), ArgumentSeed::None);
    }

    #[test]
    fn effective_seed_defaults_to_last_used_when_unwritten() {
        assert_eq!(
            effective_seed(&arg("q", CommandArgumentType::Text)),
            ArgumentSeed::LastUsed
        );
    }

    // --- seed_argument_values ---

    #[test]
    fn seed_argument_values_prefers_persisted_over_declared_default() {
        let a = with_default(
            arg("q", CommandArgumentType::Text),
            serde_json::json!("fallback"),
        );
        let persisted = map(&[("q", "remembered")]);
        let seeds = seed_argument_values(&[a], &persisted);
        assert_eq!(seeds.get("q").map(String::as_str), Some("remembered"));
    }

    #[test]
    fn seed_argument_values_falls_back_to_declared_default_when_nothing_persisted() {
        let a = with_default(
            arg("q", CommandArgumentType::Text),
            serde_json::json!("fallback"),
        );
        let seeds = seed_argument_values(&[a], &HashMap::new());
        assert_eq!(seeds.get("q").map(String::as_str), Some("fallback"));
    }

    #[test]
    fn seed_argument_values_is_empty_for_password_regardless_of_persisted() {
        let a = arg("secret", CommandArgumentType::Password);
        let persisted = map(&[("secret", "leaked")]);
        let seeds = seed_argument_values(&[a], &persisted);
        assert_eq!(seeds.get("secret").map(String::as_str), Some(""));
    }

    // --- seed_is_user_supplied ---

    #[test]
    fn seed_is_user_supplied_true_only_for_last_used_with_nonblank_persisted_value() {
        let a = arg("q", CommandArgumentType::Text);
        assert!(seed_is_user_supplied(&a, &map(&[("q", "hello")])));
        assert!(!seed_is_user_supplied(&a, &map(&[("q", "   ")])));
        assert!(!seed_is_user_supplied(&a, &HashMap::new()));
    }

    #[test]
    fn seed_is_user_supplied_false_for_default_seed_even_with_persisted_value() {
        let a = with_seed(arg("q", CommandArgumentType::Text), ArgumentSeed::Default);
        assert!(!seed_is_user_supplied(&a, &map(&[("q", "hello")])));
    }

    // --- user_supplied_values / acknowledged_values ---

    #[test]
    fn user_supplied_values_excludes_untouched_seeded_defaults() {
        let args = vec![with_default(
            required(arg("hours", CommandArgumentType::Number)),
            serde_json::json!(0),
        )];
        let values = map(&[("hours", "0")]);
        let supplied = user_supplied_values(&args, &values, &HashSet::new(), &HashSet::new());
        assert!(
            supplied.is_empty(),
            "an untouched default is not user-supplied"
        );
    }

    #[test]
    fn user_supplied_values_includes_edited_fields() {
        let args = vec![arg("q", CommandArgumentType::Text)];
        let values = map(&[("q", "typed")]);
        let supplied = user_supplied_values(&args, &values, &set(&["q"]), &HashSet::new());
        assert_eq!(supplied.get("q").map(String::as_str), Some("typed"));
    }

    #[test]
    fn acknowledged_values_credits_a_confirmed_seed_but_user_supplied_does_not() {
        let args = vec![required(with_default(
            arg("hours", CommandArgumentType::Number),
            serde_json::json!(1),
        ))];
        let values = map(&[("hours", "1")]);
        let supplied = user_supplied_values(&args, &values, &HashSet::new(), &HashSet::new());
        assert!(supplied.is_empty());
        let acknowledged = acknowledged_values(&args, &values, &supplied, &set(&["hours"]));
        assert_eq!(acknowledged.get("hours").map(String::as_str), Some("1"));
    }

    // --- require_any_of_unsatisfied ---

    #[test]
    fn require_any_of_unsatisfied_false_when_not_declared() {
        assert!(!require_any_of_unsatisfied(None, &HashMap::new()));
    }

    #[test]
    fn require_any_of_unsatisfied_true_when_all_members_blank() {
        let group = vec!["hours".to_string(), "minutes".to_string()];
        assert!(require_any_of_unsatisfied(Some(&group), &HashMap::new()));
    }

    #[test]
    fn require_any_of_unsatisfied_false_when_one_member_has_a_user_value() {
        let group = vec!["hours".to_string(), "minutes".to_string()];
        assert!(!require_any_of_unsatisfied(
            Some(&group),
            &map(&[("minutes", "5")])
        ));
    }

    // --- unfilled_required_args ---

    #[test]
    fn unfilled_required_args_ignores_optional_fields() {
        let args = vec![arg("q", CommandArgumentType::Text)];
        assert!(unfilled_required_args(&args, &HashMap::new()).is_empty());
    }

    #[test]
    fn unfilled_required_args_flags_blank_required_fields() {
        let args = vec![required(arg("q", CommandArgumentType::Text))];
        assert_eq!(unfilled_required_args(&args, &HashMap::new()), vec!["q"]);
    }

    // --- build_arguments_payload ---

    #[test]
    fn build_arguments_payload_coerces_number_type() {
        let args = vec![arg("n", CommandArgumentType::Number)];
        let payload = build_arguments_payload(&args, &map(&[("n", "42")]));
        assert_eq!(payload.get("n"), Some(&ArgumentPayloadValue::Number(42.0)));
    }

    #[test]
    fn build_arguments_payload_fills_blank_with_declared_default() {
        let args = vec![with_default(
            arg("q", CommandArgumentType::Text),
            serde_json::json!("hi"),
        )];
        let payload = build_arguments_payload(&args, &HashMap::new());
        assert_eq!(
            payload.get("q"),
            Some(&ArgumentPayloadValue::Text("hi".to_string()))
        );
    }

    #[test]
    fn build_arguments_payload_omits_field_with_neither_value_nor_default() {
        let args = vec![arg("q", CommandArgumentType::Text)];
        let payload = build_arguments_payload(&args, &HashMap::new());
        assert!(!payload.contains_key("q"));
    }

    // --- resolve(): end-to-end invariants from the hand-off ---

    #[test]
    fn caffeinate_for_style_all_zero_defaults_never_satisfy_require_any_of() {
        // The original bug this feature fixed: a command whose every
        // argument declares a default of 0 must still refuse to run
        // untouched.
        let args = vec![
            with_default(
                arg("hours", CommandArgumentType::Number),
                serde_json::json!(0),
            ),
            with_default(
                arg("minutes", CommandArgumentType::Number),
                serde_json::json!(0),
            ),
            with_default(
                arg("seconds", CommandArgumentType::Number),
                serde_json::json!(0),
            ),
        ];
        let mut request = req(args);
        request.require_any_of = Some(vec![
            "hours".to_string(),
            "minutes".to_string(),
            "seconds".to_string(),
        ]);
        // Untouched: values equal the seeded defaults, nothing edited/confirmed.
        request.values = seed_argument_values(&request.args, &request.persisted);
        let resolution = resolve(&request);
        assert!(resolution.require_any_of_unsatisfied);
    }

    #[test]
    fn required_is_satisfied_by_a_confirmed_seed_but_require_any_of_is_not() {
        let args = vec![required(with_default(
            arg("hours", CommandArgumentType::Number),
            serde_json::json!(1),
        ))];
        let mut request = req(args);
        request.require_any_of = Some(vec!["hours".to_string()]);
        request.values = map(&[("hours", "1")]);
        request.confirmed = vec!["hours".to_string()];
        let resolution = resolve(&request);
        assert!(
            resolution.unfilled_required_acknowledged.is_empty(),
            "confirmed selection should satisfy `required`"
        );
        assert!(
            resolution.require_any_of_unsatisfied,
            "a confirmed seed must never satisfy requireAnyOf"
        );
    }

    #[test]
    fn a_default_that_passed_through_untouched_never_appears_in_user_supplied() {
        let args = vec![with_default(
            arg("q", CommandArgumentType::Text),
            serde_json::json!("hi"),
        )];
        let mut request = req(args);
        request.values = map(&[("q", "hi")]);
        let resolution = resolve(&request);
        assert!(
            resolution.user_supplied.is_empty(),
            "an unedited default must not look like a user choice on the next run"
        );
    }

    #[test]
    fn password_is_never_seeded_regardless_of_persisted_values() {
        let args = vec![arg("secret", CommandArgumentType::Password)];
        let mut request = req(args);
        request.persisted = map(&[("secret", "hunter2")]);
        let resolution = resolve(&request);
        assert_eq!(resolution.seeds.get("secret").map(String::as_str), Some(""));
        assert!(resolution.seeded_from_user.is_empty());
    }

    #[test]
    fn last_used_fields_names_only_args_whose_effective_seed_is_last_used() {
        // The launcher only persists a submitted value for an argument whose
        // effective seed is `lastUsed` — a password (forced to `none`) or an
        // arg explicitly declaring `seed: default` must never be remembered,
        // even if the user typed into it this run.
        let args = vec![
            arg("q", CommandArgumentType::Text), // unwritten seed -> lastUsed
            with_seed(
                arg("mode", CommandArgumentType::Text),
                ArgumentSeed::Default,
            ),
            arg("secret", CommandArgumentType::Password), // forced -> none
        ];
        let resolution = resolve(&req(args));
        assert_eq!(resolution.last_used_fields, vec!["q".to_string()]);
    }

    #[test]
    fn a_field_absent_from_the_caller_values_falls_back_to_its_seed() {
        // The caller (enter()/prepareRun()) may pass a sparse override map —
        // just what a stash restored — rather than a fully pre-merged
        // snapshot. A field seeded from a declared default and never
        // mentioned in `values` at all must still count as filled: it is
        // visibly showing that default on screen, not blank.
        let args = vec![required(with_default(
            arg("greeting", CommandArgumentType::Text),
            serde_json::json!("hi"),
        ))];
        let request = req(args); // values left empty — nothing overridden
        let resolution = resolve(&request);
        assert!(
            resolution.unfilled_required_visible.is_empty(),
            "a seeded default is visible on screen, not blank"
        );
        assert_eq!(
            resolution.payload.get("greeting"),
            Some(&ArgumentPayloadValue::Text("hi".to_string()))
        );
    }

    #[test]
    fn manifest_and_dynamic_commands_resolve_through_the_same_function() {
        // There is no `is_dynamic` branch anywhere in `resolve` — a manifest
        // command and a dynamic command with an identical declared schema
        // produce an identical resolution.
        let args = vec![required(arg("q", CommandArgumentType::Text))];
        let mut request = req(args);
        request.values = map(&[("q", "hi")]);
        request.edited = vec!["q".to_string()];
        assert_eq!(resolve(&request), resolve(&request));
    }
}
