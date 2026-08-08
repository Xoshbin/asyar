//! Orchestration: read history, evaluate, latch, report.
//!
//! Every Tauri command in `commands/walkthrough.rs` is a one-line delegation
//! to a function here, so the same flows are reachable from a test, another
//! Rust module, or a future non-Tauri front end.

use super::progress::{self, Latched, WalkthroughProgress};
use super::registry::WalkthroughState;
use super::rules::{LaunchHistory, Probes};
use super::{CompletionSource, TaskView, WalkthroughTask};
use crate::error::AppError;
use crate::storage::{walkthrough as store, DataStore};
use crate::usage::UsageState;
use serde::{Deserialize, Serialize};

/// Everything the walkthrough UI needs in one round trip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkthroughSnapshot {
    pub tasks: Vec<TaskView>,
    pub progress: WalkthroughProgress,
    /// The user hid the root-search progress row. The command itself stays
    /// reachable — dismissing is not the same as opting out.
    pub dismissed: bool,
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn history_from(usage: &UsageState) -> LaunchHistory {
    // A usage-database hiccup must not break the walkthrough; an empty
    // history simply completes nothing new this pass.
    match usage.all_launches() {
        Ok(rows) => LaunchHistory::from_rows(rows),
        Err(e) => {
            log::warn!("walkthrough: could not read launch history: {e}");
            LaunchHistory::new()
        }
    }
}

/// Latch every task whose rule is now satisfied. Returns the ids that
/// newly completed, so the caller can decide whether to notify anyone.
pub fn evaluate(
    data: &DataStore,
    usage: &UsageState,
    state: &WalkthroughState,
) -> Result<Vec<String>, AppError> {
    let (tasks, probes) = state.snapshot();
    if tasks.is_empty() {
        return Ok(Vec::new());
    }

    let conn = data.conn()?;
    let latched = store::latched(&conn)?;
    let history = history_from(usage);

    let newly = progress::newly_satisfied(&tasks, &history, &probes, &latched);
    let completed_at = now_seconds();
    for id in &newly {
        store::mark_complete(&conn, id, CompletionSource::Auto, completed_at)?;
    }
    Ok(newly)
}

/// The launch hot path. Returns the ids that newly completed — empty for
/// almost every launch, and reached without touching the database at all
/// unless some pending task actually watches `object_id`.
pub fn on_item_launched(
    data: &DataStore,
    usage: &UsageState,
    state: &WalkthroughState,
    object_id: &str,
) -> Result<Vec<String>, AppError> {
    let conn = data.conn()?;
    let latched = store::latched(&conn)?;
    drop(conn);

    if !state.is_launch_relevant(&latched, object_id) {
        return Ok(Vec::new());
    }
    evaluate(data, usage, state)
}

/// Current tasks joined with completion state, per-task progress, and
/// headline numbers.
///
/// Reads launch history because per-task progress needs it. That is one extra
/// query per snapshot — snapshots happen on user actions, never on the launch
/// hot path, which still short-circuits in `on_item_launched`.
pub fn snapshot(
    data: &DataStore,
    usage: &UsageState,
    state: &WalkthroughState,
) -> Result<WalkthroughSnapshot, AppError> {
    let (tasks, probes) = state.snapshot();
    let conn = data.conn()?;
    let latched = store::latched(&conn)?;
    let dismissed = store::is_dismissed(&conn)?;
    drop(conn);

    let history = history_from(usage);
    Ok(build_snapshot(
        &tasks, &latched, &history, &probes, dismissed,
    ))
}

fn build_snapshot(
    tasks: &[WalkthroughTask],
    latched: &Latched,
    history: &LaunchHistory,
    probes: &Probes,
    dismissed: bool,
) -> WalkthroughSnapshot {
    let views = progress::build_views(tasks, latched, history, probes);
    let progress = progress::summarize(&views);
    WalkthroughSnapshot {
        tasks: views,
        progress,
        dismissed,
    }
}

/// Replace the registry with a freshly-collected set of declarations, then
/// immediately evaluate — which is what makes completions retroactive: a
/// task shipped today is measured against history recorded long before it.
pub fn sync(
    data: &DataStore,
    usage: &UsageState,
    state: &WalkthroughState,
    tasks: Vec<WalkthroughTask>,
    probes: Probes,
) -> Result<WalkthroughSnapshot, AppError> {
    state.replace(tasks, probes);
    evaluate(data, usage, state)?;
    snapshot(data, usage, state)
}

/// Tick a task by hand. Latching means this is a no-op on an already
/// completed task rather than an overwrite of how it was earned.
pub fn complete_manually(
    data: &DataStore,
    usage: &UsageState,
    state: &WalkthroughState,
    task_id: &str,
) -> Result<WalkthroughSnapshot, AppError> {
    let conn = data.conn()?;
    store::mark_complete(&conn, task_id, CompletionSource::Manual, now_seconds())?;
    drop(conn);
    snapshot(data, usage, state)
}

/// Un-tick a task. Only meaningful for one the user ticked by hand — an
/// auto-completed task would re-latch on the next evaluation, so this
/// refuses it rather than pretending.
pub fn uncomplete(
    data: &DataStore,
    usage: &UsageState,
    state: &WalkthroughState,
    task_id: &str,
) -> Result<WalkthroughSnapshot, AppError> {
    let conn = data.conn()?;
    let latched = store::latched(&conn)?;
    if let Some(record) = latched.get(task_id) {
        if record.source == CompletionSource::Manual {
            store::clear(&conn, task_id)?;
        }
    }
    drop(conn);
    snapshot(data, usage, state)
}

/// "I already know all this" — tick everything still outstanding.
pub fn complete_all(
    data: &DataStore,
    usage: &UsageState,
    state: &WalkthroughState,
) -> Result<WalkthroughSnapshot, AppError> {
    let (tasks, _) = state.snapshot();
    let conn = data.conn()?;
    let completed_at = now_seconds();
    for task in &tasks {
        store::mark_complete(&conn, &task.id, CompletionSource::Manual, completed_at)?;
    }
    drop(conn);
    snapshot(data, usage, state)
}

pub fn set_dismissed(
    data: &DataStore,
    usage: &UsageState,
    state: &WalkthroughState,
    dismissed: bool,
) -> Result<WalkthroughSnapshot, AppError> {
    let conn = data.conn()?;
    store::set_dismissed(&conn, dismissed)?;
    drop(conn);
    snapshot(data, usage, state)
}

/// Start over: forget every completion and un-dismiss. Auto rules will
/// immediately re-latch anything the usage history still justifies, which is
/// the honest outcome — you cannot un-learn the calculator by asking.
pub fn reset(
    data: &DataStore,
    usage: &UsageState,
    state: &WalkthroughState,
) -> Result<WalkthroughSnapshot, AppError> {
    let conn = data.conn()?;
    store::reset(&conn)?;
    drop(conn);
    evaluate(data, usage, state)?;
    snapshot(data, usage, state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::create_test_store;
    use crate::usage::UsageState;
    use crate::walkthrough::CompletionRule;

    fn usage_state() -> UsageState {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::usage::init_schema(&conn).unwrap();
        UsageState {
            db: std::sync::Mutex::new(conn),
        }
    }

    fn task(id: &str, order: i32, completion: CompletionRule) -> WalkthroughTask {
        WalkthroughTask {
            id: id.to_string(),
            extension_id: "org.asyar.test".into(),
            title: id.to_string(),
            summary: String::new(),
            body: String::new(),
            icon: None,
            image: None,
            order,
            completion,
        }
    }

    fn launch_task(id: &str, target: &str) -> WalkthroughTask {
        task(
            id,
            0,
            CompletionRule::Launch {
                target: target.into(),
            },
        )
    }

    #[test]
    fn sync_completes_a_task_retroactively_from_existing_history() {
        // The whole point of deriving from usage: a task declared today is
        // credited against a feature the user adopted long ago.
        let data = create_test_store();
        let usage = usage_state();
        usage
            .record_launch("cmd_org.asyar.calculator_x", "2026-01-01")
            .unwrap();

        let state = WalkthroughState::new();
        let snap = sync(
            &data,
            &usage,
            &state,
            vec![launch_task("wt_calc", "cmd_org.asyar.calculator_*")],
            Probes::new(),
        )
        .unwrap();

        assert_eq!(snap.progress.completed, 1);
        assert!(snap.tasks[0].completed);
        assert_eq!(snap.tasks[0].source, Some(CompletionSource::Auto));
    }

    #[test]
    fn sync_leaves_unearned_tasks_outstanding() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();

        let snap = sync(
            &data,
            &usage,
            &state,
            vec![launch_task("wt_calc", "cmd_calc")],
            Probes::new(),
        )
        .unwrap();

        assert_eq!(snap.progress.completed, 0);
        assert_eq!(snap.progress.total, 1);
        assert_eq!(snap.progress.next_task_id, Some("wt_calc".into()));
    }

    #[test]
    fn sync_replaces_tasks_from_an_uninstalled_extension() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();

        sync(
            &data,
            &usage,
            &state,
            vec![launch_task("wt_gone", "cmd_a")],
            Probes::new(),
        )
        .unwrap();
        let snap = sync(
            &data,
            &usage,
            &state,
            vec![launch_task("wt_kept", "cmd_b")],
            Probes::new(),
        )
        .unwrap();

        assert_eq!(snap.progress.total, 1);
        assert_eq!(snap.tasks[0].task.id, "wt_kept");
    }

    #[test]
    fn a_launch_completes_the_task_that_watches_it() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();
        sync(
            &data,
            &usage,
            &state,
            vec![launch_task("wt_calc", "cmd_calc")],
            Probes::new(),
        )
        .unwrap();

        usage.record_launch("cmd_calc", "2026-08-01").unwrap();
        let newly = on_item_launched(&data, &usage, &state, "cmd_calc").unwrap();

        assert_eq!(newly, vec!["wt_calc".to_string()]);
        assert!(snapshot(&data, &usage, &state).unwrap().tasks[0].completed);
    }

    #[test]
    fn an_unwatched_launch_completes_nothing() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();
        sync(
            &data,
            &usage,
            &state,
            vec![launch_task("wt_calc", "cmd_calc")],
            Probes::new(),
        )
        .unwrap();

        usage.record_launch("app_Safari", "2026-08-01").unwrap();
        assert!(on_item_launched(&data, &usage, &state, "app_Safari")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_repeat_launch_does_not_re_report_a_completed_task() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();
        sync(
            &data,
            &usage,
            &state,
            vec![launch_task("wt_calc", "cmd_calc")],
            Probes::new(),
        )
        .unwrap();

        usage.record_launch("cmd_calc", "2026-08-01").unwrap();
        assert_eq!(
            on_item_launched(&data, &usage, &state, "cmd_calc")
                .unwrap()
                .len(),
            1
        );

        usage.record_launch("cmd_calc", "2026-08-02").unwrap();
        assert!(on_item_launched(&data, &usage, &state, "cmd_calc")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_habit_task_needs_every_declared_day() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();
        sync(
            &data,
            &usage,
            &state,
            vec![task(
                "wt_habit",
                0,
                CompletionRule::Count {
                    target: "cmd_clip_*".into(),
                    times: None,
                    distinct_days: Some(3),
                },
            )],
            Probes::new(),
        )
        .unwrap();

        for day in ["2026-08-01", "2026-08-02"] {
            usage.record_launch("cmd_clip_a", day).unwrap();
            assert!(on_item_launched(&data, &usage, &state, "cmd_clip_a")
                .unwrap()
                .is_empty());
        }

        usage.record_launch("cmd_clip_a", "2026-08-03").unwrap();
        assert_eq!(
            on_item_launched(&data, &usage, &state, "cmd_clip_a").unwrap(),
            vec!["wt_habit".to_string()]
        );
    }

    #[test]
    fn a_state_rule_completes_from_a_reported_probe() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();

        let declared = vec![task(
            "wt_snippet",
            0,
            CompletionRule::State {
                probe: "snippets.count".into(),
                at_least: Some(1),
            },
        )];

        let snap = sync(&data, &usage, &state, declared.clone(), Probes::new()).unwrap();
        assert_eq!(snap.progress.completed, 0);

        let probes: Probes = [("snippets.count".to_string(), 1)].into_iter().collect();
        let snap = sync(&data, &usage, &state, declared, probes).unwrap();
        assert_eq!(snap.progress.completed, 1);
    }

    #[test]
    fn clearing_usage_history_cannot_un_complete_a_task() {
        // Latching is the guarantee that makes derived completion safe.
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();
        usage.record_launch("cmd_calc", "2026-08-01").unwrap();

        let tasks = vec![launch_task("wt_calc", "cmd_calc")];
        sync(&data, &usage, &state, tasks.clone(), Probes::new()).unwrap();

        // Wipe usage.db the way a privacy-minded user would.
        usage
            .db
            .lock()
            .unwrap()
            .execute("DELETE FROM usage_events", [])
            .unwrap();

        let snap = sync(&data, &usage, &state, tasks, Probes::new()).unwrap();
        assert!(snap.tasks[0].completed);
    }

    #[test]
    fn manual_completion_records_a_manual_source() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();
        sync(
            &data,
            &usage,
            &state,
            vec![task("wt_m", 0, CompletionRule::Manual)],
            Probes::new(),
        )
        .unwrap();

        let snap = complete_manually(&data, &usage, &state, "wt_m").unwrap();
        assert!(snap.tasks[0].completed);
        assert_eq!(snap.tasks[0].source, Some(CompletionSource::Manual));
        assert_eq!(snap.progress.percent, 100);
    }

    #[test]
    fn uncomplete_reverses_a_manual_tick() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();
        sync(
            &data,
            &usage,
            &state,
            vec![task("wt_m", 0, CompletionRule::Manual)],
            Probes::new(),
        )
        .unwrap();

        complete_manually(&data, &usage, &state, "wt_m").unwrap();
        let snap = uncomplete(&data, &usage, &state, "wt_m").unwrap();
        assert!(!snap.tasks[0].completed);
    }

    #[test]
    fn uncomplete_refuses_an_auto_completed_task() {
        // It would re-latch on the next launch anyway; pretending otherwise
        // would show the user a tick that reappears on its own.
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();
        usage.record_launch("cmd_calc", "2026-08-01").unwrap();
        sync(
            &data,
            &usage,
            &state,
            vec![launch_task("wt_calc", "cmd_calc")],
            Probes::new(),
        )
        .unwrap();

        let snap = uncomplete(&data, &usage, &state, "wt_calc").unwrap();
        assert!(snap.tasks[0].completed);
    }

    #[test]
    fn complete_all_finishes_everything_outstanding() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();
        sync(
            &data,
            &usage,
            &state,
            vec![
                task("wt_a", 0, CompletionRule::Manual),
                task("wt_b", 1, CompletionRule::Manual),
            ],
            Probes::new(),
        )
        .unwrap();

        let snap = complete_all(&data, &usage, &state).unwrap();
        assert_eq!(snap.progress.completed, 2);
        assert_eq!(snap.progress.percent, 100);
        assert_eq!(snap.progress.next_task_id, None);
    }

    #[test]
    fn dismissal_round_trips_through_the_snapshot() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();
        sync(&data, &usage, &state, vec![], Probes::new()).unwrap();

        assert!(!snapshot(&data, &usage, &state).unwrap().dismissed);
        assert!(
            set_dismissed(&data, &usage, &state, true)
                .unwrap()
                .dismissed
        );
        assert!(
            !set_dismissed(&data, &usage, &state, false)
                .unwrap()
                .dismissed
        );
    }

    #[test]
    fn reset_clears_manual_ticks_but_re_earns_what_usage_still_proves() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();
        usage.record_launch("cmd_calc", "2026-08-01").unwrap();

        sync(
            &data,
            &usage,
            &state,
            vec![
                launch_task("wt_auto", "cmd_calc"),
                task("wt_manual", 1, CompletionRule::Manual),
            ],
            Probes::new(),
        )
        .unwrap();
        complete_manually(&data, &usage, &state, "wt_manual").unwrap();
        set_dismissed(&data, &usage, &state, true).unwrap();

        let snap = reset(&data, &usage, &state).unwrap();
        assert!(!snap.dismissed);
        let by_id = |id: &str| {
            snap.tasks
                .iter()
                .find(|v| v.task.id == id)
                .unwrap()
                .completed
        };
        assert!(by_id("wt_auto"), "usage still proves this one");
        assert!(!by_id("wt_manual"), "a hand tick should be forgotten");
    }

    #[test]
    fn a_snapshot_reports_partial_progress_on_a_habit_task() {
        use crate::walkthrough::rules::ProgressUnit;

        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();

        usage.record_launch("cmd_clip_a", "2026-08-01").unwrap();
        usage.record_launch("cmd_clip_a", "2026-08-02").unwrap();

        let snap = sync(
            &data,
            &usage,
            &state,
            vec![task(
                "wt_habit",
                0,
                CompletionRule::Count {
                    target: "cmd_clip_*".into(),
                    times: None,
                    distinct_days: Some(3),
                },
            )],
            Probes::new(),
        )
        .unwrap();

        let progress = snap.tasks[0].progress.unwrap();
        assert!(!snap.tasks[0].completed);
        assert_eq!(progress.current, 2);
        assert_eq!(progress.target, 3);
        assert_eq!(progress.unit, ProgressUnit::Days);
    }

    #[test]
    fn a_completed_task_reports_full_progress_even_with_no_history_left() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();
        usage.record_launch("cmd_calc", "2026-08-01").unwrap();

        let tasks = vec![launch_task("wt_calc", "cmd_calc")];
        sync(&data, &usage, &state, tasks.clone(), Probes::new()).unwrap();

        usage
            .db
            .lock()
            .unwrap()
            .execute("DELETE FROM usage_events", [])
            .unwrap();

        let snap = sync(&data, &usage, &state, tasks, Probes::new()).unwrap();
        let progress = snap.tasks[0].progress.unwrap();
        assert!(snap.tasks[0].completed);
        assert_eq!(
            (progress.current, progress.target),
            (1, 1),
            "a done task must not read as 0 of 1 once its history is gone"
        );
    }

    #[test]
    fn a_manual_task_reports_no_progress_bar() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();

        let snap = sync(
            &data,
            &usage,
            &state,
            vec![task("wt_m", 0, CompletionRule::Manual)],
            Probes::new(),
        )
        .unwrap();

        assert_eq!(snap.tasks[0].progress, None);
    }

    #[test]
    fn a_state_task_reports_progress_from_its_probe() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();

        let probes: Probes = [("snippets.count".to_string(), 1)].into_iter().collect();
        let snap = sync(
            &data,
            &usage,
            &state,
            vec![task(
                "wt_snip",
                0,
                CompletionRule::State {
                    probe: "snippets.count".into(),
                    at_least: Some(3),
                },
            )],
            probes,
        )
        .unwrap();

        let progress = snap.tasks[0].progress.unwrap();
        assert_eq!((progress.current, progress.target), (1, 3));
    }

    #[test]
    fn an_empty_registry_evaluates_without_touching_the_database() {
        let data = create_test_store();
        let usage = usage_state();
        let state = WalkthroughState::new();
        assert!(evaluate(&data, &usage, &state).unwrap().is_empty());
    }
}
