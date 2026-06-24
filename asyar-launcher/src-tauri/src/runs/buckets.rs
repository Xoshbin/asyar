use serde::{Deserialize, Serialize};

use super::types::Run;

/// Which capped "kept run" bucket a terminal run should be folded into, and
/// the de-dup key policy specific to it. Mirrors the per-bucket rules the
/// launcher applies when a terminal `runs:state-changed` event arrives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunBucketKind {
    /// De-dupe strictly by run id — guards against the same state-changed
    /// event being delivered twice, not against re-running the same script.
    Failure,
    /// De-dupe by subjectId — one "Done" row per agent thread.
    KeptAgent,
    /// De-dupe by subjectId when present, else by id (anonymous runs).
    ScriptResult,
}

fn is_same_bucket_entry(existing: &Run, incoming: &Run, kind: RunBucketKind) -> bool {
    match kind {
        RunBucketKind::Failure => existing.id == incoming.id,
        RunBucketKind::KeptAgent => existing.subject_id == incoming.subject_id,
        RunBucketKind::ScriptResult => match &incoming.subject_id {
            Some(_) => existing.subject_id == incoming.subject_id,
            None => existing.id == incoming.id,
        },
    }
}

/// Insert `run` at the front of `bucket`, removing any existing entry that
/// matches `run` under `kind`'s de-dup key, then cap the result to `cap`
/// entries (oldest dropped first).
pub fn upsert_run_bucket(bucket: &[Run], run: Run, kind: RunBucketKind, cap: usize) -> Vec<Run> {
    let mut next: Vec<Run> = Vec::with_capacity(bucket.len() + 1);
    next.push(run.clone());
    next.extend(
        bucket
            .iter()
            .filter(|existing| !is_same_bucket_entry(existing, &run, kind))
            .cloned(),
    );
    next.truncate(cap);
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runs::types::{RunKind, RunStatus};

    fn make_run(id: &str, subject_id: Option<&str>) -> Run {
        Run {
            id: id.to_string(),
            kind: RunKind::ShellScript,
            label: "Test".to_string(),
            status: RunStatus::Succeeded,
            extension_id: None,
            started_at: 1,
            ended_at: Some(2),
            cancellable: false,
            error_message: None,
            subject_id: subject_id.map(|s| s.to_string()),
            tail_output: None,
        }
    }

    // ---- empty bucket -------------------------------------------------------

    #[test]
    fn upsert_into_empty_bucket_adds_the_run() {
        let run = make_run("r1", None);
        let result = upsert_run_bucket(&[], run.clone(), RunBucketKind::Failure, 5);
        assert_eq!(result, vec![run]);
    }

    // ---- Failure: dedupe strictly by id -------------------------------------

    #[test]
    fn failure_dedupes_by_id_replacing_existing_entry() {
        let old = make_run("r1", Some("subj-a"));
        let fresh = make_run("r1", Some("subj-a"));
        let bucket = vec![old];

        let result = upsert_run_bucket(&bucket, fresh.clone(), RunBucketKind::Failure, 5);

        assert_eq!(result, vec![fresh], "same id must replace, not duplicate");
    }

    #[test]
    fn failure_keeps_separate_entries_for_distinct_ids_even_with_same_subject() {
        // Two distinct failed runs of the same subject (e.g. re-running the
        // same script twice) must remain separate rows for inspection.
        let first = make_run("r1", Some("subj-a"));
        let second = make_run("r2", Some("subj-a"));
        let bucket = vec![first.clone()];

        let result = upsert_run_bucket(&bucket, second.clone(), RunBucketKind::Failure, 5);

        assert_eq!(result, vec![second, first]);
    }

    // ---- KeptAgent: dedupe by subjectId --------------------------------------

    #[test]
    fn kept_agent_dedupes_by_subject_id_keeping_newest() {
        let old = make_run("r1", Some("agent-a"));
        let fresh = make_run("r2", Some("agent-a"));
        let bucket = vec![old];

        let result = upsert_run_bucket(&bucket, fresh.clone(), RunBucketKind::KeptAgent, 5);

        assert_eq!(result, vec![fresh]);
    }

    #[test]
    fn kept_agent_keeps_separate_entries_per_distinct_subject_id() {
        let a1 = make_run("r1", Some("agent-a"));
        let a2 = make_run("r2", Some("agent-b"));
        let bucket = vec![a1.clone()];

        let result = upsert_run_bucket(&bucket, a2.clone(), RunBucketKind::KeptAgent, 5);

        assert_eq!(result, vec![a2, a1]);
    }

    // ---- ScriptResult: subjectId when present, else id -----------------------

    #[test]
    fn script_result_dedupes_by_subject_id_when_present() {
        let old = make_run("r1", Some("script-a"));
        let fresh = make_run("r2", Some("script-a"));
        let bucket = vec![old];

        let result = upsert_run_bucket(&bucket, fresh.clone(), RunBucketKind::ScriptResult, 5);

        assert_eq!(result, vec![fresh]);
    }

    #[test]
    fn script_result_dedupes_by_id_when_subject_id_is_none() {
        let old = make_run("r1", None);
        let same_id_fresh = make_run("r1", None);
        let bucket = vec![old];

        let result = upsert_run_bucket(
            &bucket,
            same_id_fresh.clone(),
            RunBucketKind::ScriptResult,
            5,
        );

        assert_eq!(result, vec![same_id_fresh]);
    }

    #[test]
    fn script_result_anonymous_run_does_not_collide_with_subject_id_entries() {
        let attributed = make_run("r1", Some("script-a"));
        let anonymous = make_run("r2", None);
        let bucket = vec![attributed.clone()];

        let result = upsert_run_bucket(&bucket, anonymous.clone(), RunBucketKind::ScriptResult, 5);

        assert_eq!(result, vec![anonymous, attributed]);
    }

    // ---- cap -------------------------------------------------------------

    #[test]
    fn cap_truncates_oldest_entries() {
        let bucket = vec![
            make_run("r1", None),
            make_run("r2", None),
            make_run("r3", None),
        ];
        let incoming = make_run("r4", None);

        let result = upsert_run_bucket(&bucket, incoming.clone(), RunBucketKind::Failure, 2);

        assert_eq!(result.len(), 2, "result must be capped to 2 entries");
        assert_eq!(result[0].id, "r4", "newest entry must be first");
        assert_eq!(result[1].id, "r1", "oldest surviving entry must be r1");
    }
}
