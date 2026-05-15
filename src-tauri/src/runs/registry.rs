use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::AppError;
use super::types::{Run, RunStatus};

/// In-memory registry of active Runs. Singleton via `instance()`; tests
/// should construct isolated instances with `new_for_test()`.
pub struct RunRegistry {
    runs: Mutex<HashMap<String, Run>>,
}

static INSTANCE: OnceLock<RunRegistry> = OnceLock::new();

impl RunRegistry {
    /// Returns the global singleton instance.
    pub fn instance() -> &'static RunRegistry {
        INSTANCE.get_or_init(|| RunRegistry {
            runs: Mutex::new(HashMap::new()),
        })
    }

    /// Insert a new run. Errors if the run is already in a terminal status,
    /// or if a run with the same id already exists.
    pub fn insert(&self, run: Run) -> Result<(), AppError> {
        if run.status.is_terminal() {
            return Err(AppError::Validation(format!(
                "cannot insert run in terminal status: {:?}",
                run.status
            )));
        }
        let mut guard = self.runs.lock().expect("RunRegistry mutex poisoned");
        if guard.contains_key(&run.id) {
            return Err(AppError::Validation(format!("duplicate run id: {}", run.id)));
        }
        guard.insert(run.id.clone(), run);
        Ok(())
    }

    /// Transition `id` to `status`, recording `error` and `tail_output` when provided.
    /// Returns the updated `Run` on success.
    ///
    /// State-machine contract: once a run is in a terminal status
    /// (Succeeded, Failed, Cancelled), any further transition must return Err.
    pub fn transition(
        &self,
        id: &str,
        status: RunStatus,
        error: Option<String>,
        tail_output: Option<String>,
    ) -> Result<Run, AppError> {
        let mut guard = self.runs.lock().expect("RunRegistry mutex poisoned");
        let run = guard
            .get_mut(id)
            .ok_or_else(|| AppError::Validation(format!("unknown run id: {id}")))?;
        if run.status.is_terminal() {
            return Err(AppError::Validation(format!(
                "cannot transition terminal run: {id}"
            )));
        }
        run.status = status;
        run.error_message = error;
        run.tail_output = tail_output;
        if status.is_terminal() {
            run.ended_at = Some(now_millis());
        }
        Ok(run.clone())
    }

    /// Return a clone of the run with `id`, or `None` if not found.
    pub fn get(&self, id: &str) -> Option<Run> {
        let guard = self.runs.lock().expect("RunRegistry mutex poisoned");
        guard.get(id).cloned()
    }

    /// Return all runs that are not in a terminal status
    /// (i.e. status is Pending or Running).
    pub fn list_active(&self) -> Vec<Run> {
        let guard = self.runs.lock().expect("RunRegistry mutex poisoned");
        guard
            .values()
            .filter(|r| !r.status.is_terminal())
            .cloned()
            .collect()
    }
}

pub(crate) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before UNIX epoch")
        .as_millis() as i64
}

#[cfg(test)]
impl RunRegistry {
    /// Construct a fresh, isolated registry for unit tests.
    /// Never shares state with the global `instance()`.
    pub fn new_for_test() -> RunRegistry {
        RunRegistry {
            runs: Mutex::new(HashMap::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runs::types::{Run, RunKind, RunStatus};

    // ---- Test helpers -------------------------------------------------------

    fn make_test_run(id: &str) -> Run {
        Run {
            id: id.to_string(),
            kind: RunKind::AiChat,
            label: "Test".to_string(),
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

    // ---- insert / get -------------------------------------------------------

    /// Happy path: after inserting a run, get(id) returns Some with matching fields.
    #[test]
    fn insert_then_get_returns_run() {
        let reg = RunRegistry::new_for_test();
        let run = make_test_run("run-1");

        reg.insert(run.clone()).unwrap();

        let got = reg.get("run-1").expect("run not found after insert");
        assert_eq!(got.id, "run-1");
        assert_eq!(got.label, "Test");
        assert_eq!(got.status, RunStatus::Pending);
        assert_eq!(got.kind, RunKind::AiChat);
    }

    /// Inserting a run whose id is already in the registry returns Err.
    #[test]
    fn insert_duplicate_id_errors() {
        let reg = RunRegistry::new_for_test();
        reg.insert(make_test_run("dup-1")).unwrap();

        let result = reg.insert(make_test_run("dup-1"));
        assert!(result.is_err(), "expected Err on duplicate id, got Ok");
    }

    // ---- transition happy paths ---------------------------------------------

    /// Pending → Running → Succeeded: each step returns the new Run, and a
    /// subsequent get() reflects the latest status.
    #[test]
    fn transition_running_to_succeeded_ok() {
        let reg = RunRegistry::new_for_test();
        reg.insert(make_test_run("r1")).unwrap();

        let after_running = reg.transition("r1", RunStatus::Running, None, None).unwrap();
        assert_eq!(after_running.status, RunStatus::Running);

        let after_succeeded = reg.transition("r1", RunStatus::Succeeded, None, None).unwrap();
        assert_eq!(after_succeeded.status, RunStatus::Succeeded);

        // get() must also reflect the final status
        let stored = reg.get("r1").unwrap();
        assert_eq!(stored.status, RunStatus::Succeeded);
    }

    /// Transitioning to Failed with an error message records both the
    /// error_message and a non-None ended_at.
    #[test]
    fn transition_pending_to_failed_with_error_message() {
        let reg = RunRegistry::new_for_test();
        reg.insert(make_test_run("r2")).unwrap();

        let result = reg
            .transition("r2", RunStatus::Failed, Some("boom".to_string()), None)
            .unwrap();

        assert_eq!(result.status, RunStatus::Failed);
        assert_eq!(result.error_message.as_deref(), Some("boom"));
        assert!(
            result.ended_at.is_some(),
            "ended_at must be set when transitioning to a terminal status"
        );
    }

    // ---- transition error paths ---------------------------------------------

    /// Once a run reaches a terminal status (Succeeded), any further transition
    /// must be rejected with an Err (the state-machine guarantee).
    #[test]
    fn transition_succeeded_to_running_rejected() {
        let reg = RunRegistry::new_for_test();
        reg.insert(make_test_run("r3")).unwrap();
        reg.transition("r3", RunStatus::Succeeded, None, None).unwrap();

        let result = reg.transition("r3", RunStatus::Running, None, None);
        assert!(
            result.is_err(),
            "expected Err when transitioning out of terminal Succeeded"
        );
    }

    /// Transitioning an id that was never inserted returns Err.
    #[test]
    fn transition_unknown_id_errors() {
        let reg = RunRegistry::new_for_test();
        let result = reg.transition("ghost", RunStatus::Running, None, None);
        assert!(result.is_err(), "expected Err for unknown run id");
    }

    // ---- list_active --------------------------------------------------------

    /// list_active returns only Pending and Running; terminal runs are excluded.
    #[test]
    fn list_active_excludes_terminal() {
        let reg = RunRegistry::new_for_test();

        // Insert one run in each status
        let mut pending = make_test_run("pending-1");
        pending.status = RunStatus::Pending;
        reg.insert(pending).unwrap();

        let mut running = make_test_run("running-1");
        running.status = RunStatus::Running;
        reg.insert(running).unwrap();

        // Insert Succeeded via transition
        reg.insert(make_test_run("succeeded-1")).unwrap();
        reg.transition("succeeded-1", RunStatus::Succeeded, None, None).unwrap();

        // Insert Failed via transition
        reg.insert(make_test_run("failed-1")).unwrap();
        reg.transition("failed-1", RunStatus::Failed, None, None).unwrap();

        // Insert Cancelled via transition
        reg.insert(make_test_run("cancelled-1")).unwrap();
        reg.transition("cancelled-1", RunStatus::Cancelled, None, None).unwrap();

        let active = reg.list_active();
        assert_eq!(active.len(), 2, "expected exactly 2 active runs, got {active:?}");

        let ids: Vec<&str> = active.iter().map(|r| r.id.as_str()).collect();
        assert!(ids.contains(&"pending-1"), "pending-1 should be active");
        assert!(ids.contains(&"running-1"), "running-1 should be active");
    }

    /// An empty registry produces an empty list_active result.
    #[test]
    fn list_active_empty_when_registry_empty() {
        let reg = RunRegistry::new_for_test();
        assert!(reg.list_active().is_empty());
    }

    // ---- field round-trips --------------------------------------------------

    /// A run inserted with cancellable=true must come back with cancellable=true.
    #[test]
    fn cancellable_field_round_trips() {
        let reg = RunRegistry::new_for_test();
        let mut run = make_test_run("can-1");
        run.cancellable = true;

        reg.insert(run).unwrap();

        let got = reg.get("can-1").unwrap();
        assert!(got.cancellable, "cancellable field not preserved after insert+get");
    }

    // ---- ended_at semantics -------------------------------------------------

    #[test]
    fn pending_to_running_leaves_ended_at_none() {
        let registry = RunRegistry::new_for_test();
        registry.insert(make_test_run("r1")).unwrap();
        let run = registry.transition("r1", RunStatus::Running, None, None).unwrap();
        assert!(run.ended_at.is_none(), "Running is non-terminal; ended_at must remain None");
    }

    #[test]
    fn running_to_succeeded_sets_ended_at() {
        let registry = RunRegistry::new_for_test();
        registry.insert(make_test_run("r1")).unwrap();
        registry.transition("r1", RunStatus::Running, None, None).unwrap();
        let run = registry.transition("r1", RunStatus::Succeeded, None, None).unwrap();
        assert!(run.ended_at.is_some(), "Succeeded is terminal; ended_at must be set");
    }

    #[test]
    fn running_to_cancelled_sets_ended_at() {
        let registry = RunRegistry::new_for_test();
        registry.insert(make_test_run("r1")).unwrap();
        registry.transition("r1", RunStatus::Running, None, None).unwrap();
        let run = registry.transition("r1", RunStatus::Cancelled, None, None).unwrap();
        assert!(run.ended_at.is_some(), "Cancelled is terminal; ended_at must be set");
    }

    // ---- insert terminal guard ----------------------------------------------

    #[test]
    fn insert_terminal_status_rejected() {
        let registry = RunRegistry::new_for_test();
        let mut run = make_test_run("r1");
        run.status = RunStatus::Succeeded;
        let result = registry.insert(run);
        assert!(result.is_err(), "registry must reject inserts in terminal status");
    }
}
