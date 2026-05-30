use crate::error::AppError;
use crate::runs::output_buffer::{format_tail_output, OutputBuffer};
use crate::runs::registry::{now_millis, RunRegistry};
use crate::runs::{Run, RunKind, RunStatus};
use crate::storage::{runs_history, DataStore};
use rusqlite::Connection;
use tauri::{AppHandle, Emitter, State};

// ── Inner functions (Strategy B — pure Rust, testable without AppHandle) ─────

/// Insert a new run with `RunStatus::Running` into the registry and emit
/// `runs:state-changed`. Returns the inserted Run.
///
/// `emit` is a generic closure so tests can capture events into a Vec.
#[allow(clippy::too_many_arguments)]
pub fn runs_start_impl(
    registry: &RunRegistry,
    _buffer: &OutputBuffer,
    emit: &impl Fn(&str, &serde_json::Value) -> Result<(), tauri::Error>,
    id: String,
    kind: RunKind,
    label: String,
    extension_id: Option<String>,
    cancellable: bool,
    subject_id: Option<String>,
) -> Result<Run, AppError> {
    let run = Run {
        id,
        kind,
        label,
        status: RunStatus::Running,
        extension_id,
        started_at: now_millis(),
        ended_at: None,
        cancellable,
        error_message: None,
        subject_id,
        tail_output: None,
    };
    registry.insert(run.clone())?;
    let payload = serde_json::to_value(&run)
        .map_err(|e| AppError::Validation(format!("serialize Run: {e}")))?;
    let _ = emit("runs:state-changed", &payload);
    Ok(run)
}

/// Append `line` to the per-run output buffer and emit `runs:output`.
pub fn runs_write_impl(
    registry: &RunRegistry,
    buffer: &OutputBuffer,
    emit: &impl Fn(&str, &serde_json::Value) -> Result<(), tauri::Error>,
    id: String,
    line: String,
) -> Result<(), AppError> {
    if registry.get(&id).is_none() {
        return Err(AppError::Validation(format!("unknown run id: {}", id)));
    }
    buffer.append(&id, line.clone());
    let payload = serde_json::json!({ "id": id, "line": line });
    let _ = emit("runs:output", &payload);
    Ok(())
}

/// Shared finalization path for done/fail/cancel: capture tail, transition, persist, emit.
fn finalize_impl(
    registry: &RunRegistry,
    buffer: &OutputBuffer,
    conn: &Connection,
    emit: &impl Fn(&str, &serde_json::Value) -> Result<(), tauri::Error>,
    id: &str,
    new_status: RunStatus,
    error_message: Option<String>,
) -> Result<(), AppError> {
    let snapshot = buffer.snapshot(id);
    let tail = format_tail_output(&snapshot);
    let run = registry.transition(id, new_status, error_message, tail)?;
    runs_history::insert(conn, &run)?;
    // Buffer is kept alive for post-mortem reads by RunView and notification
    // consumers. It will be dropped by runs_dismiss (on user dismiss) and on
    // session reset.
    let payload = serde_json::to_value(&run)
        .map_err(|e| AppError::Validation(format!("serialize Run: {e}")))?;
    let _ = emit("runs:state-changed", &payload);
    Ok(())
}

/// Transition the run to `Succeeded`, persist to history, drop the buffer,
/// and emit `runs:state-changed`.
pub fn runs_done_impl(
    registry: &RunRegistry,
    buffer: &OutputBuffer,
    emit: &impl Fn(&str, &serde_json::Value) -> Result<(), tauri::Error>,
    conn: &Connection,
    id: String,
) -> Result<(), AppError> {
    finalize_impl(
        registry,
        buffer,
        conn,
        emit,
        &id,
        RunStatus::Succeeded,
        None,
    )
}

/// Transition the run to `Failed`, persist to history, drop the buffer,
/// and emit `runs:state-changed`. Returns `Ok(())` — the diagnostic for the
/// failed run is a side-effect emitted as a Tauri event, not the return value
/// (the transition itself succeeded; the run's execution failed).
pub fn runs_fail_impl(
    registry: &RunRegistry,
    buffer: &OutputBuffer,
    emit: &impl Fn(&str, &serde_json::Value) -> Result<(), tauri::Error>,
    conn: &Connection,
    id: String,
    error: String,
) -> Result<(), AppError> {
    finalize_impl(
        registry,
        buffer,
        conn,
        emit,
        &id,
        RunStatus::Failed,
        Some(error),
    )
}

/// Transition the run to `Cancelled`, persist to history, drop the buffer,
/// and emit `runs:state-changed`. No process-killing — observers react via
/// `RunHandle.onCancel` in TS.
pub fn runs_cancel_impl(
    registry: &RunRegistry,
    buffer: &OutputBuffer,
    emit: &impl Fn(&str, &serde_json::Value) -> Result<(), tauri::Error>,
    conn: &Connection,
    id: String,
) -> Result<(), AppError> {
    finalize_impl(
        registry,
        buffer,
        conn,
        emit,
        &id,
        RunStatus::Cancelled,
        None,
    )
}

// ── Read-side inner functions ─────────────────────────────────────────────────

pub fn runs_list_impl(registry: &RunRegistry) -> Vec<Run> {
    registry.list_active()
}

pub fn runs_get_impl(registry: &RunRegistry, id: &str) -> Option<Run> {
    registry.get(id)
}

pub fn runs_history_list_impl(conn: &Connection, limit: usize) -> Result<Vec<Run>, AppError> {
    runs_history::list_recent(conn, limit)
}

pub fn runs_history_clear_impl(conn: &Connection) -> Result<(), AppError> {
    runs_history::delete_all(conn)
}

pub fn runs_get_output_impl(buffer: &OutputBuffer, id: &str) -> Vec<String> {
    buffer.snapshot(id)
}

/// Drop the per-run output buffer for `id`. No-op when the id is unknown,
/// so callers can dismiss anything (active or terminal, attributed or anon)
/// without first checking existence.
pub fn runs_dismiss_impl(buffer: &OutputBuffer, id: &str) -> Result<(), AppError> {
    buffer.drop_for_run(id);
    Ok(())
}

// ── Tauri command wrappers ────────────────────────────────────────────────────

/// Start a new run; exposed as a Tauri IPC command.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn runs_start(
    app: AppHandle,
    id: String,
    kind: RunKind,
    label: String,
    extension_id: Option<String>,
    cancellable: bool,
    subject_id: Option<String>,
) -> Result<Run, AppError> {
    let registry = RunRegistry::instance();
    let buffer = OutputBuffer::instance();
    let emit = |event: &str, payload: &serde_json::Value| app.emit(event, payload);
    runs_start_impl(
        registry,
        buffer,
        &emit,
        id,
        kind,
        label,
        extension_id,
        cancellable,
        subject_id,
    )
}

#[tauri::command]
pub async fn runs_write(app: AppHandle, id: String, line: String) -> Result<(), AppError> {
    let registry = RunRegistry::instance();
    let buffer = OutputBuffer::instance();
    let emit = |event: &str, payload: &serde_json::Value| app.emit(event, payload);
    runs_write_impl(registry, buffer, &emit, id, line)
}

#[tauri::command]
pub async fn runs_done(
    app: AppHandle,
    store: State<'_, DataStore>,
    id: String,
) -> Result<(), AppError> {
    let registry = RunRegistry::instance();
    let buffer = OutputBuffer::instance();
    let conn = store.conn()?;
    let emit = |event: &str, payload: &serde_json::Value| app.emit(event, payload);
    runs_done_impl(registry, buffer, &emit, &conn, id)
}

#[tauri::command]
pub async fn runs_fail(
    app: AppHandle,
    store: State<'_, DataStore>,
    id: String,
    error: String,
) -> Result<(), AppError> {
    let registry = RunRegistry::instance();
    let buffer = OutputBuffer::instance();
    let conn = store.conn()?;
    let emit = |event: &str, payload: &serde_json::Value| app.emit(event, payload);
    runs_fail_impl(registry, buffer, &emit, &conn, id, error)
}

#[tauri::command]
pub async fn runs_cancel(
    app: AppHandle,
    store: State<'_, DataStore>,
    id: String,
) -> Result<(), AppError> {
    let registry = RunRegistry::instance();
    let buffer = OutputBuffer::instance();
    let conn = store.conn()?;
    let emit = |event: &str, payload: &serde_json::Value| app.emit(event, payload);
    runs_cancel_impl(registry, buffer, &emit, &conn, id)
}

// ── Read-side Tauri command wrappers ──────────────────────────────────────────

/// List currently-active runs (non-terminal status).
#[tauri::command]
pub async fn runs_list() -> Result<Vec<Run>, AppError> {
    Ok(runs_list_impl(RunRegistry::instance()))
}

/// Return a single run by id, or `None` if not found.
#[tauri::command]
pub async fn runs_get(id: String) -> Result<Option<Run>, AppError> {
    Ok(runs_get_impl(RunRegistry::instance(), &id))
}

/// Return up to `limit` most-recent runs from history (default 50).
#[tauri::command]
pub async fn runs_history_list(
    db: State<'_, DataStore>,
    limit: Option<usize>,
) -> Result<Vec<Run>, AppError> {
    let conn = db.conn()?;
    runs_history_list_impl(&conn, limit.unwrap_or(50))
}

/// Clear all rows from the run history table.
#[tauri::command]
pub async fn runs_history_clear(db: State<'_, DataStore>) -> Result<(), AppError> {
    let conn = db.conn()?;
    runs_history_clear_impl(&conn)
}

/// Return the buffered output lines for an active run.
#[tauri::command]
pub async fn runs_get_output(id: String) -> Result<Vec<String>, AppError> {
    Ok(runs_get_output_impl(OutputBuffer::instance(), &id))
}

/// Drop the per-run output buffer for `id`. Called when the user dismisses
/// a kept run-row from the launcher list.
#[tauri::command]
pub async fn runs_dismiss(id: String) -> Result<(), AppError> {
    runs_dismiss_impl(OutputBuffer::instance(), &id)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    // ── EventCapture ─────────────────────────────────────────────────────────

    /// Captures events emitted by the inner functions so tests can assert on
    /// which events were emitted and with what payload, without needing a real
    /// AppHandle or Tauri runtime.
    struct EventCapture {
        events: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
    }

    impl EventCapture {
        fn new() -> Self {
            Self {
                events: Arc::new(Mutex::new(Vec::new())),
            }
        }

        /// Returns a closure matching the emit signature expected by the inner
        /// functions. The closure captures a clone of the shared events Vec.
        fn as_emit_fn(&self) -> impl Fn(&str, &serde_json::Value) -> Result<(), tauri::Error> + '_ {
            let events = Arc::clone(&self.events);
            move |event: &str, payload: &serde_json::Value| {
                events
                    .lock()
                    .expect("EventCapture mutex poisoned")
                    .push((event.to_string(), payload.clone()));
                Ok(())
            }
        }

        fn captured(&self) -> Vec<(String, serde_json::Value)> {
            self.events
                .lock()
                .expect("EventCapture mutex poisoned")
                .clone()
        }
    }

    // ── Test fixture ─────────────────────────────────────────────────────────

    fn make_test_env() -> (RunRegistry, OutputBuffer, Connection, EventCapture) {
        let registry = RunRegistry::new_for_test();
        let buffer = OutputBuffer::new_for_test();
        let conn = Connection::open_in_memory().unwrap();
        runs_history::init_table(&conn).unwrap();
        let events = EventCapture::new();
        (registry, buffer, conn, events)
    }

    // ── runs_start tests ──────────────────────────────────────────────────────

    #[test]
    fn start_inserts_run_with_running_status() {
        let (registry, buffer, _conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        let run = runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "My script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();

        assert_eq!(run.id, "r1");
        assert_eq!(
            run.status,
            RunStatus::Running,
            "initial status must be Running"
        );
        assert!(run.started_at > 0, "started_at must be set");
        assert!(
            run.ended_at.is_none(),
            "ended_at must be None for a live run"
        );

        let stored = registry
            .get("r1")
            .expect("run must be in registry after start");
        assert_eq!(stored.status, RunStatus::Running);
    }

    #[test]
    fn start_emits_state_changed_event_with_run_payload() {
        let (registry, buffer, _conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::AiChat,
            "Chat".to_string(),
            Some("org.test.ext".to_string()),
            true,
            None,
        )
        .unwrap();

        let captured = events.captured();
        assert_eq!(
            captured.len(),
            1,
            "expected exactly one event after start, got {captured:?}"
        );
        assert_eq!(
            captured[0].0, "runs:state-changed",
            "event name must be runs:state-changed"
        );
        let payload = &captured[0].1;
        assert_eq!(payload["id"], "r1", "payload must contain the run id");
        assert_eq!(
            payload["status"], "running",
            "payload status must be running"
        );
    }

    #[test]
    fn start_persists_subject_id_on_the_run() {
        let (registry, buffer, _conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        let run = runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Hosts Update".to_string(),
            None,
            false,
            Some("cmd_scripts_dyn_abc".to_string()),
        )
        .unwrap();

        assert_eq!(run.subject_id.as_deref(), Some("cmd_scripts_dyn_abc"));

        let stored = registry.get("r1").unwrap();
        assert_eq!(stored.subject_id.as_deref(), Some("cmd_scripts_dyn_abc"));

        // And the emitted payload must round-trip through serde with the
        // camelCase wire format the SDK side reads.
        let payload = &events.captured()[0].1;
        assert_eq!(payload["subjectId"], "cmd_scripts_dyn_abc");
    }

    #[test]
    fn start_with_none_subject_id_round_trips_as_none() {
        let (registry, buffer, _conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        let run = runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::Custom,
            "ad-hoc".to_string(),
            None,
            false,
            None,
        )
        .unwrap();

        assert!(run.subject_id.is_none());
    }

    #[test]
    fn start_with_duplicate_id_errors() {
        let (registry, buffer, _conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::Custom,
            "First".to_string(),
            None,
            false,
            None,
        )
        .unwrap();

        let result = runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::Custom,
            "Duplicate".to_string(),
            None,
            false,
            None,
        );

        assert!(
            result.is_err(),
            "starting a second run with the same id must return Err"
        );
    }

    // ── runs_write tests ──────────────────────────────────────────────────────

    #[test]
    fn write_appends_to_output_buffer() {
        let (registry, buffer, _conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();

        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "line one".to_string(),
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "line two".to_string(),
        )
        .unwrap();

        let snap = buffer.snapshot("r1");
        assert_eq!(
            snap,
            vec!["line one", "line two"],
            "buffer must contain both lines in order"
        );
    }

    #[test]
    fn write_emits_output_event() {
        let (registry, buffer, _conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();

        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "line one".to_string(),
        )
        .unwrap();

        let captured = events.captured();
        // First event is runs:state-changed from start; second is runs:output
        let output_events: Vec<_> = captured
            .iter()
            .filter(|(name, _)| name == "runs:output")
            .collect();

        assert_eq!(
            output_events.len(),
            1,
            "expected one runs:output event, got {output_events:?}"
        );

        let payload = &output_events[0].1;
        assert_eq!(
            payload["id"], "r1",
            "output payload must contain the run id"
        );
        assert_eq!(
            payload["line"], "line one",
            "output payload must contain the line text"
        );
    }

    #[test]
    fn write_unknown_id_errors() {
        // Writing to an id that was never started is a contract violation and
        // must return Err. Silently no-oping would hide programmer mistakes
        // (wrong id passed by extension code).
        let (registry, buffer, _conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        let result = runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "never-started".to_string(),
            "orphan line".to_string(),
        );

        assert!(
            result.is_err(),
            "writing for an unknown run id must return Err (contract violation)"
        );
    }

    // ── runs_done tests ───────────────────────────────────────────────────────

    #[test]
    fn done_transitions_to_succeeded() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::AiChat,
            "Chat".to_string(),
            None,
            false,
            None,
        )
        .unwrap();

        runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let stored = registry
            .get("r1")
            .expect("run must still be accessible after done");
        assert_eq!(stored.status, RunStatus::Succeeded);
        assert!(stored.ended_at.is_some(), "ended_at must be set after done");
    }

    #[test]
    fn done_persists_to_history_and_keeps_buffer() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "some output".to_string(),
        )
        .unwrap();

        runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let history = runs_history::list_recent(&conn, 10).unwrap();
        assert_eq!(
            history.len(),
            1,
            "one row must be persisted to history after done"
        );
        assert_eq!(history[0].id, "r1");
        assert_eq!(
            history[0].status,
            RunStatus::Succeeded,
            "history row must have Succeeded status"
        );

        let snap = buffer.snapshot("r1");
        assert_eq!(snap, vec!["some output"], "buffer must survive finalize");
    }

    #[test]
    fn done_emits_state_changed_with_succeeded_run() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::Agent,
            "Agent".to_string(),
            None,
            false,
            None,
        )
        .unwrap();

        runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let state_changed: Vec<_> = events
            .captured()
            .into_iter()
            .filter(|(name, _)| name == "runs:state-changed")
            .collect();

        assert!(
            state_changed.len() >= 2,
            "expected at least 2 runs:state-changed events (start + done), got {state_changed:?}"
        );

        let last = &state_changed.last().unwrap().1;
        assert_eq!(
            last["status"], "succeeded",
            "final state-changed event must carry succeeded status"
        );
    }

    // ── runs_fail tests ───────────────────────────────────────────────────────

    #[test]
    fn fail_transitions_to_failed_with_error_message() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();

        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "some fail output".to_string(),
        )
        .unwrap();

        runs_fail_impl(
            &registry,
            &buffer,
            &emit,
            &conn,
            "r1".to_string(),
            "boom".to_string(),
        )
        .unwrap();

        let stored = registry
            .get("r1")
            .expect("run must be accessible after fail");
        assert_eq!(stored.status, RunStatus::Failed);
        assert_eq!(
            stored.error_message.as_deref(),
            Some("boom"),
            "error_message must be set to the provided error string"
        );
        assert!(stored.ended_at.is_some(), "ended_at must be set after fail");

        let history = runs_history::list_recent(&conn, 10).unwrap();
        assert_eq!(history.len(), 1, "one row must be persisted after fail");
        assert_eq!(history[0].status, RunStatus::Failed);
        assert_eq!(history[0].error_message.as_deref(), Some("boom"));

        let snap = buffer.snapshot("r1");
        assert!(
            !snap.is_empty(),
            "buffer must survive finalize for post-mortem reading"
        );
    }

    // ── runs_cancel tests ─────────────────────────────────────────────────────

    #[test]
    fn cancel_transitions_to_cancelled() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::AiChat,
            "Chat".to_string(),
            None,
            true,
            None,
        )
        .unwrap();

        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "partial work".to_string(),
        )
        .unwrap();

        runs_cancel_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let stored = registry
            .get("r1")
            .expect("run must be accessible after cancel");
        assert_eq!(stored.status, RunStatus::Cancelled);
        assert!(
            stored.ended_at.is_some(),
            "ended_at must be set after cancel"
        );
        assert!(
            stored.error_message.is_none(),
            "error_message must be None for a cancelled run"
        );

        let history = runs_history::list_recent(&conn, 10).unwrap();
        assert_eq!(history.len(), 1, "one row must be persisted after cancel");
        assert_eq!(history[0].status, RunStatus::Cancelled);

        let snap = buffer.snapshot("r1");
        assert!(
            !snap.is_empty(),
            "buffer must survive finalize for post-mortem reading"
        );
    }

    // ── terminal-state guard ──────────────────────────────────────────────────

    #[test]
    fn done_after_done_errors() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::Custom,
            "Job".to_string(),
            None,
            false,
            None,
        )
        .unwrap();

        runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let result = runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string());
        assert!(
            result.is_err(),
            "calling done on an already-Succeeded run must return Err (terminal state machine)"
        );
    }

    // ── runs_list tests ───────────────────────────────────────────────────────

    #[test]
    fn list_returns_only_active_runs() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script 1".to_string(),
            None,
            false,
            None,
        )
        .unwrap();
        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r2".to_string(),
            RunKind::AiChat,
            "Chat".to_string(),
            None,
            false,
            None,
        )
        .unwrap();

        let active = runs_list_impl(&registry);
        assert_eq!(active.len(), 2, "expected 2 active runs, got {active:?}");
        assert!(
            active.iter().all(|r| r.status == RunStatus::Running),
            "all listed runs must be Running"
        );

        runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let active = runs_list_impl(&registry);
        assert_eq!(
            active.len(),
            1,
            "after finalizing r1, expected 1 active run, got {active:?}"
        );
        assert_eq!(active[0].id, "r2", "remaining active run must be r2");
    }

    #[test]
    fn list_empty_when_no_runs() {
        let (registry, _buffer, _conn, _events) = make_test_env();

        let active = runs_list_impl(&registry);
        assert!(
            active.is_empty(),
            "fresh registry must return empty list, got {active:?}"
        );
    }

    // ── runs_get tests ────────────────────────────────────────────────────────

    #[test]
    fn get_returns_some_for_known_id() {
        let (registry, buffer, _conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::Custom,
            "Job".to_string(),
            None,
            false,
            None,
        )
        .unwrap();

        let result = runs_get_impl(&registry, "r1");
        assert!(result.is_some(), "expected Some for known id r1");
        assert_eq!(result.unwrap().id, "r1");
    }

    #[test]
    fn get_returns_none_for_unknown_id() {
        let (registry, _buffer, _conn, _events) = make_test_env();

        let result = runs_get_impl(&registry, "ghost");
        assert!(result.is_none(), "expected None for unknown id 'ghost'");
    }

    #[test]
    fn get_returns_terminal_run() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();
        runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let result = runs_get_impl(&registry, "r1");
        assert!(
            result.is_some(),
            "get must return Some even for a terminal run"
        );
        assert_eq!(
            result.unwrap().status,
            RunStatus::Succeeded,
            "terminal run must have Succeeded status"
        );
    }

    // ── runs_history_list tests ───────────────────────────────────────────────

    #[test]
    fn history_list_returns_persisted_runs() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();
        runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let history = runs_history_list_impl(&conn, 10).unwrap();
        assert_eq!(
            history.len(),
            1,
            "expected 1 run in history after done, got {history:?}"
        );
        assert_eq!(history[0].id, "r1");
    }

    #[test]
    fn history_list_respects_limit() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        for i in 1..=5 {
            let id = format!("r{i}");
            runs_start_impl(
                &registry,
                &buffer,
                &emit,
                id.clone(),
                RunKind::ShellScript,
                format!("Script {i}"),
                None,
                false,
                None,
            )
            .unwrap();
            runs_done_impl(&registry, &buffer, &emit, &conn, id).unwrap();
        }

        let history = runs_history_list_impl(&conn, 3).unwrap();
        assert_eq!(
            history.len(),
            3,
            "expected 3 most-recent runs with limit=3, got {}",
            history.len()
        );
    }

    #[test]
    fn history_list_empty_when_no_history() {
        let (_registry, _buffer, conn, _events) = make_test_env();

        let history = runs_history_list_impl(&conn, 50).unwrap();
        assert!(
            history.is_empty(),
            "fresh DB must return empty history, got {history:?}"
        );
    }

    // ── runs_history_clear tests ──────────────────────────────────────────────

    #[test]
    fn history_clear_empties_table() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        for i in 1..=3 {
            let id = format!("r{i}");
            runs_start_impl(
                &registry,
                &buffer,
                &emit,
                id.clone(),
                RunKind::Custom,
                format!("Job {i}"),
                None,
                false,
                None,
            )
            .unwrap();
            runs_done_impl(&registry, &buffer, &emit, &conn, id).unwrap();
        }

        runs_history_clear_impl(&conn).unwrap();

        let history = runs_history_list_impl(&conn, 50).unwrap();
        assert!(
            history.is_empty(),
            "history must be empty after clear, got {history:?}"
        );
    }

    // ── runs_get_output tests ─────────────────────────────────────────────────

    #[test]
    fn get_output_returns_buffer_snapshot() {
        let (registry, buffer, _conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "line one".to_string(),
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "line two".to_string(),
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "line three".to_string(),
        )
        .unwrap();

        let output = runs_get_output_impl(&buffer, "r1");
        assert_eq!(
            output,
            vec!["line one", "line two", "line three"],
            "snapshot must return all 3 lines in order"
        );
    }

    #[test]
    fn get_output_empty_for_unknown_id() {
        let (_registry, buffer, _conn, _events) = make_test_env();

        let output = runs_get_output_impl(&buffer, "ghost");
        assert!(
            output.is_empty(),
            "expected empty Vec for unknown id 'ghost', got {output:?}"
        );
    }

    // ── runs_dismiss tests ────────────────────────────────────────────────────

    #[test]
    fn dismiss_drops_buffer_for_id() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "alive".to_string(),
        )
        .unwrap();
        runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        assert_eq!(
            runs_get_output_impl(&buffer, "r1"),
            vec!["alive"],
            "buffer must still be readable before dismiss"
        );

        runs_dismiss_impl(&buffer, "r1").unwrap();

        assert!(
            runs_get_output_impl(&buffer, "r1").is_empty(),
            "buffer must be empty after dismiss"
        );
    }

    #[test]
    fn dismiss_unknown_id_is_noop() {
        let (_registry, buffer, _conn, _events) = make_test_env();

        runs_dismiss_impl(&buffer, "never-started").unwrap();
    }

    // ── tail_output capture + buffer survival tests ───────────────────────────

    #[test]
    fn finalize_captures_tail_output_into_run() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "first".to_string(),
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "middle".to_string(),
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "line three".to_string(),
        )
        .unwrap();

        runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let run = runs_get_impl(&registry, "r1").expect("run must be accessible after done");
        assert_eq!(
            run.tail_output.as_deref(),
            Some("line three"),
            "tail_output must be set to the last non-empty line after finalize"
        );
    }

    #[test]
    fn finalize_keeps_buffer_alive_for_post_mortem_read() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "hello".to_string(),
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "world".to_string(),
        )
        .unwrap();

        runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let output = runs_get_output_impl(&buffer, "r1");
        assert_eq!(
            output,
            vec!["hello", "world"],
            "buffer must survive finalize so RunView can read post-mortem"
        );
    }

    #[test]
    fn finalize_persists_tail_output_to_sqlite_history() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "persisted line".to_string(),
        )
        .unwrap();

        runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let recent = runs_history::list_recent(&conn, 10).unwrap();
        assert_eq!(
            recent[0].tail_output.as_deref(),
            Some("persisted line"),
            "tail_output must be persisted to SQLite history row"
        );
    }

    #[test]
    fn finalize_fail_captures_tail_output_and_keeps_buffer() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "warning: thing".to_string(),
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "Error: explosion".to_string(),
        )
        .unwrap();

        runs_fail_impl(
            &registry,
            &buffer,
            &emit,
            &conn,
            "r1".to_string(),
            "exit code 1".to_string(),
        )
        .unwrap();

        let run = registry
            .get("r1")
            .expect("run must be accessible after fail");
        assert_eq!(
            run.tail_output.as_deref(),
            Some("Error: explosion"),
            "tail_output must capture the last non-empty line on fail"
        );

        let output = runs_get_output_impl(&buffer, "r1");
        assert!(
            !output.is_empty(),
            "buffer must survive fail finalize for post-mortem reading"
        );
    }

    #[test]
    fn finalize_cancel_captures_tail_output_and_keeps_buffer() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::AiChat,
            "Chat".to_string(),
            None,
            true,
            None,
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "partial work".to_string(),
        )
        .unwrap();

        runs_cancel_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let run = registry
            .get("r1")
            .expect("run must be accessible after cancel");
        assert_eq!(
            run.tail_output.as_deref(),
            Some("partial work"),
            "tail_output must capture the last non-empty line on cancel"
        );

        let output = runs_get_output_impl(&buffer, "r1");
        assert!(
            !output.is_empty(),
            "buffer must survive cancel finalize for post-mortem reading"
        );
    }

    #[test]
    fn finalize_with_no_output_leaves_tail_output_none() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();

        runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let run = registry
            .get("r1")
            .expect("run must be accessible after done");
        assert!(
            run.tail_output.is_none(),
            "tail_output must be None when no lines were written, got {:?}",
            run.tail_output
        );
    }

    #[test]
    fn finalize_with_only_whitespace_output_leaves_tail_output_none() {
        let (registry, buffer, conn, events) = make_test_env();
        let emit = events.as_emit_fn();

        runs_start_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            RunKind::ShellScript,
            "Script".to_string(),
            None,
            false,
            None,
        )
        .unwrap();
        runs_write_impl(&registry, &buffer, &emit, "r1".to_string(), "".to_string()).unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "   ".to_string(),
        )
        .unwrap();
        runs_write_impl(
            &registry,
            &buffer,
            &emit,
            "r1".to_string(),
            "\t".to_string(),
        )
        .unwrap();

        runs_done_impl(&registry, &buffer, &emit, &conn, "r1".to_string()).unwrap();

        let run = registry
            .get("r1")
            .expect("run must be accessible after done");
        assert!(
            run.tail_output.is_none(),
            "tail_output must be None when all written lines are whitespace-only, got {:?}",
            run.tail_output
        );
    }
}
