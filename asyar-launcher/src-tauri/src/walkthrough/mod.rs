//! Walkthrough — the long-lived task list that teaches Asyar after the
//! one-shot onboarding tour is over.
//!
//! Tasks are *declared*, never hardcoded: any extension (Tier 1 built-in or
//! Tier 2 from the Store) contributes them through a `walkthrough` array in
//! its `manifest.json`, exactly the way it contributes `commands` or
//! `actions`. The frontend collects those declarations and pushes them here
//! via `sync_walkthrough_tasks`, mirroring the existing command-index sync.
//!
//! Completion is decided here, not in the frontend, and it needs no
//! cooperation from the feature being taught: every launch in the app already
//! funnels through `record_item_usage`, which writes to `usage.db`. A task
//! declares a rule over that history ([`CompletionRule`]) and this module
//! evaluates it. Adding a task therefore touches zero lines of the feature it
//! teaches.
//!
//! Auto-completions **latch**: once satisfied they are written to
//! `walkthrough_state` and stay done, so clearing usage history or wiping the
//! search index can never un-tick a task the user genuinely finished.

use serde::{Deserialize, Serialize};

pub mod progress;
pub mod registry;
pub mod rules;
pub mod service;

/// How a task decides it is done.
///
/// Serialized internally-tagged so a manifest reads naturally:
/// `{ "type": "count", "target": "cmd_org.asyar.clipboard_*", "distinctDays": 3 }`
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CompletionRule {
    /// Done the first time any launch matches `target` (glob).
    Launch { target: String },
    /// Done after `times` launches matching `target`, and/or launches on
    /// `distinct_days` separate days. Both default to 1 when absent, so
    /// `count` with neither is equivalent to `launch`.
    Count {
        target: String,
        #[serde(default)]
        times: Option<u32>,
        #[serde(default, rename = "distinctDays")]
        distinct_days: Option<u32>,
    },
    /// Done when a host-reported counter reaches `at_least` (default 1).
    /// Probes are pushed from the frontend with the task sync — they answer
    /// "how many snippets exist", which no launch history can express.
    State {
        probe: String,
        #[serde(default, rename = "atLeast")]
        at_least: Option<u32>,
    },
    /// No automatic detection. The user ticks it themselves.
    Manual,
}

/// A task as declared in a manifest, once qualified with its owning
/// extension. `id` is the fully-qualified `wt_<extensionId>_<localId>` —
/// the same shape as `cmd_<extensionId>_<commandId>` in the search index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkthroughTask {
    pub id: String,
    pub extension_id: String,
    pub title: String,
    /// One line, shown in the list.
    #[serde(default)]
    pub summary: String,
    /// Markdown detail body, shown when the task is opened.
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub icon: Option<String>,
    /// Static asset path for the detail preview, resolved by the frontend.
    /// Local by design — a walkthrough that needs the network is a
    /// walkthrough that breaks on a plane.
    #[serde(default)]
    pub image: Option<String>,
    /// Ascending sort key within the list. Ties break on `id`.
    #[serde(default)]
    pub order: i32,
    pub completion: CompletionRule,
}

/// A task exactly as authored in `manifest.json`, before it is qualified
/// with its owning extension. `id` here is local to the manifest, the same
/// way a command's `id` is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WalkthroughTaskDecl {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub order: i32,
    pub completion: CompletionRule,
}

/// Prefix for fully-qualified task ids, mirroring `cmd_` in the search index
/// and `act_` in the action registry.
pub const TASK_ID_PREFIX: &str = "wt";

/// `wt_<extensionId>_<localId>`.
pub fn qualified_task_id(extension_id: &str, local_id: &str) -> String {
    format!("{TASK_ID_PREFIX}_{extension_id}_{local_id}")
}

impl WalkthroughTaskDecl {
    /// Bind this declaration to the extension that shipped it.
    pub fn qualify(&self, extension_id: &str) -> WalkthroughTask {
        WalkthroughTask {
            id: qualified_task_id(extension_id, &self.id),
            extension_id: extension_id.to_string(),
            title: self.title.clone(),
            summary: self.summary.clone(),
            body: self.body.clone(),
            icon: self.icon.clone(),
            image: self.image.clone(),
            order: self.order,
            completion: self.completion.clone(),
        }
    }
}

/// Why a task is marked done. Surfaced so the UI can distinguish "you did
/// this" from "you ticked this off".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompletionSource {
    /// A rule matched real usage.
    Auto,
    /// The user ticked it by hand.
    Manual,
}

/// A latched completion record, as persisted in `walkthrough_state`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRecord {
    pub task_id: String,
    /// Unix seconds.
    pub completed_at: i64,
    pub source: CompletionSource,
}

/// A task joined with its completion state — the shape the UI renders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    #[serde(flatten)]
    pub task: WalkthroughTask,
    pub completed: bool,
    #[serde(default)]
    pub completed_at: Option<i64>,
    #[serde(default)]
    pub source: Option<CompletionSource>,
    /// How far along an unfinished task is. `None` for `manual` tasks, which
    /// measure nothing. A completed task always reads as full, even if the
    /// usage history that earned it has since been cleared.
    #[serde(default)]
    pub progress: Option<rules::TaskProgress>,
}

/// Structural rules for a manifest's `walkthrough` array, beyond what serde
/// expresses. Returns a human-readable reason on the first violation, for
/// the caller to wrap in its own error type.
pub fn validate_declarations(tasks: &[WalkthroughTaskDecl]) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();

    for task in tasks {
        if task.id.trim().is_empty() {
            return Err("a walkthrough task has an empty `id`".to_string());
        }
        if !task
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        {
            return Err(format!(
                "walkthrough task id '{}' may only contain letters, digits, '-', '_' and '.'",
                task.id
            ));
        }
        if task.title.trim().is_empty() {
            return Err(format!(
                "walkthrough task '{}' has an empty `title`",
                task.id
            ));
        }
        if !seen.insert(task.id.as_str()) {
            return Err(format!("duplicate walkthrough task id '{}'", task.id));
        }

        match &task.completion {
            CompletionRule::Launch { target } | CompletionRule::Count { target, .. } => {
                if target.trim().is_empty() {
                    return Err(format!(
                        "walkthrough task '{}' has an empty completion `target`",
                        task.id
                    ));
                }
            }
            CompletionRule::State { probe, .. } => {
                if probe.trim().is_empty() {
                    return Err(format!(
                        "walkthrough task '{}' has an empty completion `probe`",
                        task.id
                    ));
                }
            }
            CompletionRule::Manual => {}
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decl(id: &str, completion: CompletionRule) -> WalkthroughTaskDecl {
        WalkthroughTaskDecl {
            id: id.to_string(),
            title: "A task".into(),
            summary: String::new(),
            body: String::new(),
            icon: None,
            image: None,
            order: 0,
            completion,
        }
    }

    fn manual(id: &str) -> WalkthroughTaskDecl {
        decl(id, CompletionRule::Manual)
    }

    #[test]
    fn qualify_namespaces_the_id_by_extension() {
        let task = manual("use-calculator").qualify("org.asyar.calculator");
        assert_eq!(task.id, "wt_org.asyar.calculator_use-calculator");
        assert_eq!(task.extension_id, "org.asyar.calculator");
    }

    #[test]
    fn qualify_keeps_two_extensions_using_the_same_local_id_apart() {
        let a = manual("start").qualify("org.asyar.a");
        let b = manual("start").qualify("org.asyar.b");
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn qualify_carries_every_authored_field_through() {
        let mut d = decl(
            "t",
            CompletionRule::Launch {
                target: "cmd_x_*".into(),
            },
        );
        d.title = "Title".into();
        d.summary = "Summary".into();
        d.body = "# Body".into();
        d.icon = Some("icon:zap".into());
        d.image = Some("walkthrough/t.png".into());
        d.order = 7;

        let task = d.qualify("org.asyar.x");
        assert_eq!(task.title, "Title");
        assert_eq!(task.summary, "Summary");
        assert_eq!(task.body, "# Body");
        assert_eq!(task.icon.as_deref(), Some("icon:zap"));
        assert_eq!(task.image.as_deref(), Some("walkthrough/t.png"));
        assert_eq!(task.order, 7);
        assert_eq!(
            task.completion,
            CompletionRule::Launch {
                target: "cmd_x_*".into()
            }
        );
    }

    #[test]
    fn validation_accepts_an_empty_array() {
        assert!(validate_declarations(&[]).is_ok());
    }

    #[test]
    fn validation_accepts_a_well_formed_set() {
        let tasks = vec![
            manual("a"),
            decl(
                "b.c-d_e",
                CompletionRule::Launch {
                    target: "cmd_*".into(),
                },
            ),
        ];
        assert!(validate_declarations(&tasks).is_ok());
    }

    #[test]
    fn validation_rejects_duplicate_ids() {
        let err = validate_declarations(&[manual("dup"), manual("dup")]).unwrap_err();
        assert!(err.contains("duplicate"), "unexpected message: {err}");
    }

    #[test]
    fn validation_rejects_an_empty_id() {
        assert!(validate_declarations(&[manual("  ")]).is_err());
    }

    #[test]
    fn validation_rejects_ids_that_would_break_the_qualified_form() {
        // Spaces and slashes would make `wt_<ext>_<id>` ambiguous to parse.
        assert!(validate_declarations(&[manual("has space")]).is_err());
        assert!(validate_declarations(&[manual("has/slash")]).is_err());
    }

    #[test]
    fn validation_rejects_an_empty_title() {
        let mut task = manual("a");
        task.title = "   ".into();
        assert!(validate_declarations(&[task]).is_err());
    }

    #[test]
    fn validation_rejects_an_empty_completion_target() {
        let task = decl("a", CompletionRule::Launch { target: "".into() });
        assert!(validate_declarations(&[task]).is_err());

        let task = decl(
            "b",
            CompletionRule::Count {
                target: " ".into(),
                times: Some(2),
                distinct_days: None,
            },
        );
        assert!(validate_declarations(&[task]).is_err());
    }

    #[test]
    fn validation_rejects_an_empty_probe() {
        let task = decl(
            "a",
            CompletionRule::State {
                probe: "".into(),
                at_least: None,
            },
        );
        assert!(validate_declarations(&[task]).is_err());
    }

    #[test]
    fn declaration_rejects_unknown_fields() {
        // A typo'd key must fail loudly at parse time rather than silently
        // shipping a task with a default value.
        let json = r#"{"id":"a","title":"A","complete":{"type":"manual"}}"#;
        assert!(serde_json::from_str::<WalkthroughTaskDecl>(json).is_err());
    }

    #[test]
    fn declaration_parses_a_realistic_manifest_entry() {
        let json = r###"{
            "id": "clipboard-habit",
            "title": "Never lose what you copied",
            "summary": "Open clipboard history on three separate days",
            "body": "## To complete\n1. Copy something.\n2. Open Clipboard History.",
            "icon": "icon:clipboard",
            "order": 20,
            "completion": {
                "type": "count",
                "target": "cmd_org.asyar.clipboard_*",
                "distinctDays": 3
            }
        }"###;
        let decl: WalkthroughTaskDecl = serde_json::from_str(json).unwrap();
        assert_eq!(decl.id, "clipboard-habit");
        assert_eq!(decl.order, 20);
        assert_eq!(
            decl.completion,
            CompletionRule::Count {
                target: "cmd_org.asyar.clipboard_*".into(),
                times: None,
                distinct_days: Some(3),
            }
        );
    }
}
