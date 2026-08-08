//! Joining declared tasks with latched completion state, and summarizing it.

use super::rules::{self, LaunchHistory, Probes, TaskProgress};
use super::{CompletionRecord, TaskView, WalkthroughTask};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Headline numbers for the root-search row and the list header.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkthroughProgress {
    pub total: u32,
    pub completed: u32,
    /// 0–100, floored. 100 only when every task is genuinely done.
    pub percent: u8,
    /// First unfinished task in display order — what "Continue" opens.
    pub next_task_id: Option<String>,
}

/// Latched completions, keyed by task id.
pub type Latched = HashMap<String, CompletionRecord>;

/// Display order: declared `order` ascending, ties broken by id so the list
/// never reshuffles between runs.
pub fn sort_tasks(tasks: &mut [WalkthroughTask]) {
    tasks.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
}

/// Tasks whose rule is satisfied right now but which are not latched yet.
/// The caller persists these; evaluation itself stays side-effect free.
pub fn newly_satisfied(
    tasks: &[WalkthroughTask],
    history: &LaunchHistory,
    probes: &Probes,
    latched: &Latched,
) -> Vec<String> {
    tasks
        .iter()
        .filter(|t| !latched.contains_key(&t.id))
        .filter(|t| rules::is_satisfied(&t.completion, history, probes))
        .map(|t| t.id.clone())
        .collect()
}

/// Join tasks with their latched state and per-task progress, in display
/// order.
pub fn build_views(
    tasks: &[WalkthroughTask],
    latched: &Latched,
    history: &LaunchHistory,
    probes: &Probes,
) -> Vec<TaskView> {
    let mut ordered = tasks.to_vec();
    sort_tasks(&mut ordered);
    ordered
        .into_iter()
        .map(|task| {
            let measured = rules::progress_for(&task.completion, history, probes);
            match latched.get(&task.id) {
                Some(record) => TaskView {
                    // A latched task reads as full regardless of what the
                    // history still says — completions outlive the history
                    // that earned them, and a "done" row showing 1 of 3 would
                    // look like a bug.
                    progress: measured.map(|p| TaskProgress {
                        current: p.target,
                        ..p
                    }),
                    task,
                    completed: true,
                    completed_at: Some(record.completed_at),
                    source: Some(record.source),
                },
                None => TaskView {
                    task,
                    completed: false,
                    completed_at: None,
                    source: None,
                    progress: measured,
                },
            }
        })
        .collect()
}

pub fn summarize(views: &[TaskView]) -> WalkthroughProgress {
    let total = views.len() as u32;
    let completed = views.iter().filter(|v| v.completed).count() as u32;
    let percent = if total == 0 {
        0
    } else {
        ((completed as u64 * 100) / total as u64) as u8
    };
    WalkthroughProgress {
        total,
        completed,
        percent,
        next_task_id: views
            .iter()
            .find(|v| !v.completed)
            .map(|v| v.task.id.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::walkthrough::{CompletionRule, CompletionSource};

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

    fn manual(id: &str, order: i32) -> WalkthroughTask {
        task(id, order, CompletionRule::Manual)
    }

    fn latch(id: &str, at: i64, source: CompletionSource) -> (String, CompletionRecord) {
        (
            id.to_string(),
            CompletionRecord {
                task_id: id.to_string(),
                completed_at: at,
                source,
            },
        )
    }

    fn history(rows: &[(&str, &str, u32)]) -> LaunchHistory {
        LaunchHistory::from_rows(
            rows.iter()
                .map(|(t, d, c)| (t.to_string(), d.to_string(), *c)),
        )
    }

    #[test]
    fn tasks_sort_by_order_then_id() {
        let mut tasks = vec![manual("wt_b", 2), manual("wt_z", 1), manual("wt_a", 1)];
        sort_tasks(&mut tasks);
        let ids: Vec<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["wt_a", "wt_z", "wt_b"]);
    }

    #[test]
    fn newly_satisfied_skips_already_latched_tasks() {
        let tasks = vec![task(
            "wt_calc",
            1,
            CompletionRule::Launch {
                target: "cmd_calc".into(),
            },
        )];
        let h = history(&[("cmd_calc", "2026-08-01", 1)]);
        let probes = Probes::new();

        assert_eq!(
            newly_satisfied(&tasks, &h, &probes, &Latched::new()),
            vec!["wt_calc".to_string()]
        );

        let latched: Latched = [latch("wt_calc", 100, CompletionSource::Auto)]
            .into_iter()
            .collect();
        assert!(newly_satisfied(&tasks, &h, &probes, &latched).is_empty());
    }

    #[test]
    fn newly_satisfied_ignores_manual_tasks() {
        let tasks = vec![manual("wt_manual", 1)];
        let h = history(&[("cmd_anything", "2026-08-01", 50)]);
        assert!(newly_satisfied(&tasks, &h, &Probes::new(), &Latched::new()).is_empty());
    }

    #[test]
    fn build_views_marks_latched_tasks_done_with_their_source() {
        let tasks = vec![manual("wt_a", 1), manual("wt_b", 2)];
        let latched: Latched = [latch("wt_b", 1_700_000_000, CompletionSource::Manual)]
            .into_iter()
            .collect();

        let views = build_views(&tasks, &latched, &LaunchHistory::new(), &Probes::new());
        assert_eq!(views.len(), 2);
        assert!(!views[0].completed);
        assert_eq!(views[0].completed_at, None);
        assert_eq!(views[0].source, None);
        assert!(views[1].completed);
        assert_eq!(views[1].completed_at, Some(1_700_000_000));
        assert_eq!(views[1].source, Some(CompletionSource::Manual));
    }

    #[test]
    fn build_views_ignores_latched_ids_with_no_surviving_task() {
        // An extension that declared a task and was later uninstalled must
        // not keep inflating the denominator.
        let tasks = vec![manual("wt_a", 1)];
        let latched: Latched = [latch("wt_gone", 5, CompletionSource::Auto)]
            .into_iter()
            .collect();

        let views = build_views(&tasks, &latched, &LaunchHistory::new(), &Probes::new());
        assert_eq!(views.len(), 1);
        assert!(!views[0].completed);
    }

    #[test]
    fn summarize_counts_and_floors_percent() {
        let tasks = vec![manual("wt_a", 1), manual("wt_b", 2), manual("wt_c", 3)];
        let latched: Latched = [latch("wt_a", 1, CompletionSource::Auto)]
            .into_iter()
            .collect();

        let progress = summarize(&build_views(
            &tasks,
            &latched,
            &LaunchHistory::new(),
            &Probes::new(),
        ));
        assert_eq!(progress.total, 3);
        assert_eq!(progress.completed, 1);
        assert_eq!(progress.percent, 33);
        assert_eq!(progress.next_task_id, Some("wt_b".into()));
    }

    #[test]
    fn summarize_reports_no_next_task_when_finished() {
        let tasks = vec![manual("wt_a", 1)];
        let latched: Latched = [latch("wt_a", 1, CompletionSource::Auto)]
            .into_iter()
            .collect();

        let progress = summarize(&build_views(
            &tasks,
            &latched,
            &LaunchHistory::new(),
            &Probes::new(),
        ));
        assert_eq!(progress.percent, 100);
        assert_eq!(progress.next_task_id, None);
    }

    #[test]
    fn summarize_of_an_empty_registry_is_zero_not_a_divide_by_zero() {
        let progress = summarize(&[]);
        assert_eq!(progress.total, 0);
        assert_eq!(progress.completed, 0);
        assert_eq!(progress.percent, 0);
        assert_eq!(progress.next_task_id, None);
    }

    #[test]
    fn next_task_follows_display_order_not_declaration_order() {
        let tasks = vec![manual("wt_late", 9), manual("wt_early", 1)];
        let progress = summarize(&build_views(
            &tasks,
            &Latched::new(),
            &LaunchHistory::new(),
            &Probes::new(),
        ));
        assert_eq!(progress.next_task_id, Some("wt_early".into()));
    }
}
