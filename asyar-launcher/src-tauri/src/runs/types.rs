use serde::{Deserialize, Serialize};

/// Lifecycle state of a tracked run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl RunStatus {
    /// Returns `true` for terminal states from which no further transition is allowed.
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            RunStatus::Succeeded | RunStatus::Failed | RunStatus::Cancelled
        )
    }
}

/// The category of work a run represents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunKind {
    /// Preserved for deserializing historical SQLite rows; never written by new code.
    AiChat,
    ShellScript,
    Agent,
    Custom,
}

/// A single tracked execution unit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub kind: RunKind,
    pub label: String,
    pub status: RunStatus,
    pub extension_id: Option<String>,
    /// Unix milliseconds — set when the run is inserted.
    pub started_at: i64,
    /// Unix milliseconds — set when the run reaches a terminal status.
    pub ended_at: Option<i64>,
    pub cancellable: bool,
    pub error_message: Option<String>,
    /// Stable join key linking a run back to its dynamic command's `object_id`
    /// — `cmd_scripts_dyn_<dynamicId>` for a script, `cmd_agents_dyn_<agentId>`
    /// for an agent. `None` for ad-hoc runs (Tier 2 RunService.start, custom
    /// kinds, label-only runs).
    pub subject_id: Option<String>,
    /// Last captured lines from the script's stdout/stderr, surfaced to the
    /// user in the run response. `None` until Phase 3 wires the capture logic.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tail_output: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Test helpers -------------------------------------------------------

    fn make_test_run(id: &str) -> Run {
        Run {
            id: id.to_string(),
            kind: RunKind::AiChat,
            label: "Test run".to_string(),
            status: RunStatus::Pending,
            extension_id: None,
            started_at: 1_700_000_000_000,
            ended_at: None,
            cancellable: false,
            error_message: None,
            subject_id: None,
            tail_output: None,
        }
    }

    // ---- RunStatus serde ----------------------------------------------------

    /// RunStatus::Running must serialize to the JSON string "running".
    /// This will FAIL until the worker adds #[serde(rename_all = "lowercase")]
    /// (or equivalent per-variant renames) to RunStatus.
    #[test]
    fn run_status_serializes_to_lowercase_string() {
        let json = serde_json::to_string(&RunStatus::Running).unwrap();
        assert_eq!(json, r#""running""#);

        assert_eq!(
            serde_json::to_string(&RunStatus::Pending).unwrap(),
            r#""pending""#
        );
        assert_eq!(
            serde_json::to_string(&RunStatus::Succeeded).unwrap(),
            r#""succeeded""#
        );
        assert_eq!(
            serde_json::to_string(&RunStatus::Failed).unwrap(),
            r#""failed""#
        );
        assert_eq!(
            serde_json::to_string(&RunStatus::Cancelled).unwrap(),
            r#""cancelled""#
        );
    }

    // ---- RunKind serde ------------------------------------------------------

    /// RunKind variants must serialize to kebab-case strings matching the TS
    /// discriminated union: 'ai-chat' | 'shell-script' | 'agent' | 'custom'.
    /// This will FAIL until the worker adds kebab-case serde renames on RunKind.
    #[test]
    fn run_kind_serializes_kebab_case() {
        assert_eq!(
            serde_json::to_string(&RunKind::AiChat).unwrap(),
            r#""ai-chat""#
        );
        assert_eq!(
            serde_json::to_string(&RunKind::ShellScript).unwrap(),
            r#""shell-script""#
        );
        assert_eq!(
            serde_json::to_string(&RunKind::Agent).unwrap(),
            r#""agent""#
        );
        assert_eq!(
            serde_json::to_string(&RunKind::Custom).unwrap(),
            r#""custom""#
        );
    }

    // ---- Run serde ----------------------------------------------------------

    /// Run must serialize with camelCase field names for TS interop.
    /// This will FAIL until the worker adds #[serde(rename_all = "camelCase")]
    /// to the Run struct.
    #[test]
    fn run_serializes_camelcase() {
        let mut run = make_test_run("r1");
        run.extension_id = Some("org.test.ext".to_string());
        run.ended_at = Some(1_700_000_001_000);
        run.error_message = Some("oops".to_string());
        run.cancellable = true;
        run.subject_id = Some("cmd_scripts_dyn_abc".to_string());

        let v: serde_json::Value = serde_json::to_value(&run).unwrap();

        // camelCase keys that differ from Rust snake_case
        assert!(
            v.get("extensionId").is_some(),
            "expected extensionId key, got {v}"
        );
        assert!(
            v.get("startedAt").is_some(),
            "expected startedAt key, got {v}"
        );
        assert!(v.get("endedAt").is_some(), "expected endedAt key, got {v}");
        assert!(
            v.get("errorMessage").is_some(),
            "expected errorMessage key, got {v}"
        );
        assert!(
            v.get("subjectId").is_some(),
            "expected subjectId key, got {v}"
        );
        assert_eq!(
            v.get("subjectId").and_then(|x| x.as_str()),
            Some("cmd_scripts_dyn_abc")
        );

        // snake_case keys must NOT appear
        assert!(
            v.get("extension_id").is_none(),
            "snake_case extension_id must not appear"
        );
        assert!(
            v.get("started_at").is_none(),
            "snake_case started_at must not appear"
        );
        assert!(
            v.get("ended_at").is_none(),
            "snake_case ended_at must not appear"
        );
        assert!(
            v.get("error_message").is_none(),
            "snake_case error_message must not appear"
        );
        assert!(
            v.get("subject_id").is_none(),
            "snake_case subject_id must not appear"
        );
    }

    #[test]
    fn run_serializes_tail_output_as_camel_case() {
        let mut run = make_test_run("r1");
        run.tail_output = Some("last output line".to_string());
        let json = serde_json::to_value(&run).unwrap();
        assert_eq!(
            json["tailOutput"],
            serde_json::json!("last output line"),
            "expected tailOutput key with value, got {json}"
        );
        assert!(
            json.get("tail_output").is_none(),
            "snake_case tail_output must not appear in JSON"
        );
    }

    #[test]
    fn run_serializes_tail_output_absent_when_none() {
        let run = make_test_run("r1");
        // tail_output defaults to None; skip_serializing_if means key must be absent
        let json = serde_json::to_value(&run).unwrap();
        assert!(
            json.get("tailOutput").is_none(),
            "tailOutput key must be absent when None (skip_serializing_if), got {json}"
        );
    }
}
