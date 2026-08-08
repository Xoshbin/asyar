//! Completion-rule evaluation.
//!
//! Pure functions over a snapshot of launch history plus host probes. No
//! database, no Tauri state — so the interesting logic is testable without
//! either.

use super::CompletionRule;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

/// What a task's progress is counted in, so the UI can say "2 of 3 days"
/// rather than a bare fraction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProgressUnit {
    Launches,
    Days,
    Items,
}

/// How far along a single task is. `current` is clamped to `target`, so a
/// feature used fifty times against a three-day rule reads "3 of 3", never
/// "50 of 3".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub current: u32,
    pub target: u32,
    pub unit: ProgressUnit,
}

impl TaskProgress {
    fn new(current: u32, target: u32, unit: ProgressUnit) -> Self {
        let target = target.max(1);
        Self {
            current: current.min(target),
            target,
            unit,
        }
    }

    /// Completion fraction, used to pick which of a `count` rule's two
    /// thresholds is the one actually holding the task back.
    fn ratio(&self) -> f32 {
        self.current as f32 / self.target as f32
    }
}

/// Aggregated launches for one target id.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LaunchStat {
    pub total: u32,
    /// `YYYY-MM-DD` local days on which this target was launched.
    pub days: BTreeSet<String>,
}

/// A snapshot of `usage.db`'s launch table, keyed by target object id.
#[derive(Debug, Clone, Default)]
pub struct LaunchHistory {
    entries: HashMap<String, LaunchStat>,
}

/// Counters the frontend reports that launch history cannot express — how
/// many snippets exist, whether a hotkey is bound, and so on.
pub type Probes = HashMap<String, u32>;

impl LaunchHistory {
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one `usage_events` row in.
    pub fn record(&mut self, target: &str, day: &str, count: u32) {
        let entry = self.entries.entry(target.to_string()).or_default();
        entry.total = entry.total.saturating_add(count);
        entry.days.insert(day.to_string());
    }

    pub fn from_rows<I>(rows: I) -> Self
    where
        I: IntoIterator<Item = (String, String, u32)>,
    {
        let mut history = Self::new();
        for (target, day, count) in rows {
            history.record(&target, &day, count);
        }
        history
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Total launches and distinct active days across every target matching
    /// `pattern`. A task about "the clipboard" spans several command ids, so
    /// counts sum and day sets union rather than being read per-id.
    pub fn totals_matching(&self, pattern: &str) -> (u32, u32) {
        let matcher = match compile(pattern) {
            Some(m) => m,
            // An unparseable pattern matches nothing. A malformed manifest
            // must leave its own task stuck, never crash the evaluator or
            // silently complete every task.
            None => return (0, 0),
        };

        let mut total = 0u32;
        let mut days: BTreeSet<&str> = BTreeSet::new();
        for (target, stat) in &self.entries {
            if matcher.is_match(target.as_str()) {
                total = total.saturating_add(stat.total);
                days.extend(stat.days.iter().map(String::as_str));
            }
        }
        (total, days.len() as u32)
    }
}

fn compile(pattern: &str) -> Option<globset::GlobMatcher> {
    globset::Glob::new(pattern)
        .ok()
        .map(|g| g.compile_matcher())
}

/// Does `object_id` fall under `pattern`? Used on the launch hot path to
/// decide whether a launch could possibly move any task forward, before
/// paying for a database read.
pub fn target_matches(pattern: &str, object_id: &str) -> bool {
    compile(pattern)
        .map(|m| m.is_match(object_id))
        .unwrap_or(false)
}

/// How far along this rule is, or `None` when there is nothing meaningful to
/// count — a `manual` task is done or not done, and showing "0 of 1" for it
/// would imply the app is measuring something it isn't.
///
/// A `count` rule can declare two thresholds and needs both, so this reports
/// whichever one is furthest from being met: that is the number that actually
/// tells the user what is left to do.
pub fn progress_for(
    rule: &CompletionRule,
    history: &LaunchHistory,
    probes: &Probes,
) -> Option<TaskProgress> {
    match rule {
        CompletionRule::Launch { target } => {
            let (total, _) = history.totals_matching(target);
            Some(TaskProgress::new(total, 1, ProgressUnit::Launches))
        }

        CompletionRule::Count {
            target,
            times,
            distinct_days,
        } => {
            let (total, days) = history.totals_matching(target);
            let by_launches = TaskProgress::new(total, times.unwrap_or(1), ProgressUnit::Launches);
            let by_days = TaskProgress::new(days, distinct_days.unwrap_or(1), ProgressUnit::Days);

            // Only one threshold declared → report that one. Both declared →
            // the binding constraint. Ties go to days, the harder ask.
            Some(match (times, distinct_days) {
                (Some(_), None) => by_launches,
                (None, Some(_)) => by_days,
                _ if by_days.ratio() <= by_launches.ratio() => by_days,
                _ => by_launches,
            })
        }

        CompletionRule::State { probe, at_least } => Some(TaskProgress::new(
            probes.get(probe).copied().unwrap_or(0),
            at_least.unwrap_or(1),
            ProgressUnit::Items,
        )),

        CompletionRule::Manual => None,
    }
}

/// The launch target a rule watches, if it watches one at all.
/// `state` and `manual` rules are unaffected by launches.
pub fn watched_target(rule: &CompletionRule) -> Option<&str> {
    match rule {
        CompletionRule::Launch { target } | CompletionRule::Count { target, .. } => {
            Some(target.as_str())
        }
        CompletionRule::State { .. } | CompletionRule::Manual => None,
    }
}

/// Does this rule consider itself done, given what the user has actually
/// done? [`CompletionRule::Manual`] is never satisfied automatically — that
/// is the whole point of it.
pub fn is_satisfied(rule: &CompletionRule, history: &LaunchHistory, probes: &Probes) -> bool {
    match rule {
        CompletionRule::Launch { target } => history.totals_matching(target).0 >= 1,

        CompletionRule::Count {
            target,
            times,
            distinct_days,
        } => {
            let (total, days) = history.totals_matching(target);
            total >= times.unwrap_or(1).max(1) && days >= distinct_days.unwrap_or(1).max(1)
        }

        CompletionRule::State { probe, at_least } => {
            probes.get(probe).copied().unwrap_or(0) >= at_least.unwrap_or(1).max(1)
        }

        CompletionRule::Manual => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn history(rows: &[(&str, &str, u32)]) -> LaunchHistory {
        LaunchHistory::from_rows(
            rows.iter()
                .map(|(t, d, c)| (t.to_string(), d.to_string(), *c)),
        )
    }

    fn no_probes() -> Probes {
        Probes::new()
    }

    #[test]
    fn launch_rule_is_satisfied_by_one_matching_launch() {
        let h = history(&[("cmd_org.asyar.calculator_calc", "2026-08-01", 1)]);
        let rule = CompletionRule::Launch {
            target: "cmd_org.asyar.calculator_calc".into(),
        };
        assert!(is_satisfied(&rule, &h, &no_probes()));
    }

    #[test]
    fn launch_rule_is_unsatisfied_when_nothing_matches() {
        let h = history(&[("cmd_org.asyar.notes_new", "2026-08-01", 9)]);
        let rule = CompletionRule::Launch {
            target: "cmd_org.asyar.calculator_calc".into(),
        };
        assert!(!is_satisfied(&rule, &h, &no_probes()));
    }

    #[test]
    fn empty_history_satisfies_nothing() {
        let rule = CompletionRule::Launch {
            target: "cmd_a_b".into(),
        };
        assert!(!is_satisfied(&rule, &LaunchHistory::new(), &no_probes()));
    }

    #[test]
    fn glob_star_matches_every_command_of_an_extension() {
        let h = history(&[("cmd_org.asyar.clipboard_paste", "2026-08-01", 1)]);
        let rule = CompletionRule::Launch {
            target: "cmd_org.asyar.clipboard_*".into(),
        };
        assert!(is_satisfied(&rule, &h, &no_probes()));
    }

    #[test]
    fn glob_does_not_leak_across_extensions() {
        let h = history(&[("cmd_org.asyar.clipboardx_paste", "2026-08-01", 1)]);
        let rule = CompletionRule::Launch {
            target: "cmd_org.asyar.clipboard_*".into(),
        };
        assert!(!is_satisfied(&rule, &h, &no_probes()));
    }

    #[test]
    fn malformed_glob_matches_nothing_instead_of_panicking() {
        let h = history(&[("cmd_a_b", "2026-08-01", 5)]);
        let rule = CompletionRule::Launch {
            target: "cmd_[a".into(), // unclosed class
        };
        assert!(!is_satisfied(&rule, &h, &no_probes()));
    }

    #[test]
    fn count_rule_requires_the_declared_number_of_launches() {
        let h = history(&[("cmd_a_b", "2026-08-01", 2)]);
        let rule = CompletionRule::Count {
            target: "cmd_a_b".into(),
            times: Some(3),
            distinct_days: None,
        };
        assert!(!is_satisfied(&rule, &h, &no_probes()));

        let h = history(&[("cmd_a_b", "2026-08-01", 3)]);
        assert!(is_satisfied(&rule, &h, &no_probes()));
    }

    #[test]
    fn count_rule_requires_distinct_days_not_just_repetition() {
        // Twenty launches, all on one day, must not satisfy a 3-day habit.
        let h = history(&[("cmd_a_b", "2026-08-01", 20)]);
        let rule = CompletionRule::Count {
            target: "cmd_a_b".into(),
            times: None,
            distinct_days: Some(3),
        };
        assert!(!is_satisfied(&rule, &h, &no_probes()));

        let h = history(&[
            ("cmd_a_b", "2026-08-01", 1),
            ("cmd_a_b", "2026-08-02", 1),
            ("cmd_a_b", "2026-08-03", 1),
        ]);
        assert!(is_satisfied(&rule, &h, &no_probes()));
    }

    #[test]
    fn count_rule_unions_days_across_matching_targets() {
        // Two different clipboard commands on two different days is a
        // two-day clipboard habit, not two one-day habits.
        let h = history(&[
            ("cmd_org.asyar.clipboard_paste", "2026-08-01", 1),
            ("cmd_org.asyar.clipboard_history", "2026-08-02", 1),
        ]);
        let rule = CompletionRule::Count {
            target: "cmd_org.asyar.clipboard_*".into(),
            times: Some(2),
            distinct_days: Some(2),
        };
        assert!(is_satisfied(&rule, &h, &no_probes()));
    }

    #[test]
    fn count_rule_with_no_thresholds_behaves_like_launch() {
        let h = history(&[("cmd_a_b", "2026-08-01", 1)]);
        let rule = CompletionRule::Count {
            target: "cmd_a_b".into(),
            times: None,
            distinct_days: None,
        };
        assert!(is_satisfied(&rule, &h, &no_probes()));
    }

    #[test]
    fn count_rule_treats_zero_thresholds_as_one() {
        // A manifest asking for `times: 0` must still require real usage,
        // otherwise it ships a task that is born complete.
        let rule = CompletionRule::Count {
            target: "cmd_a_b".into(),
            times: Some(0),
            distinct_days: Some(0),
        };
        assert!(!is_satisfied(&rule, &LaunchHistory::new(), &no_probes()));

        let h = history(&[("cmd_a_b", "2026-08-01", 1)]);
        assert!(is_satisfied(&rule, &h, &no_probes()));
    }

    #[test]
    fn state_rule_reads_the_probe_threshold() {
        let mut probes = no_probes();
        probes.insert("snippets.count".into(), 2);

        let rule = CompletionRule::State {
            probe: "snippets.count".into(),
            at_least: Some(3),
        };
        assert!(!is_satisfied(&rule, &LaunchHistory::new(), &probes));

        probes.insert("snippets.count".into(), 3);
        assert!(is_satisfied(&rule, &LaunchHistory::new(), &probes));
    }

    #[test]
    fn state_rule_defaults_to_at_least_one() {
        let mut probes = no_probes();
        probes.insert("aliases.count".into(), 1);
        let rule = CompletionRule::State {
            probe: "aliases.count".into(),
            at_least: None,
        };
        assert!(is_satisfied(&rule, &LaunchHistory::new(), &probes));
    }

    #[test]
    fn state_rule_with_unknown_probe_is_unsatisfied() {
        let rule = CompletionRule::State {
            probe: "never.reported".into(),
            at_least: None,
        };
        assert!(!is_satisfied(&rule, &LaunchHistory::new(), &no_probes()));
    }

    #[test]
    fn manual_rule_is_never_satisfied_automatically() {
        let h = history(&[("cmd_a_b", "2026-08-01", 999)]);
        let mut probes = no_probes();
        probes.insert("anything".into(), 999);
        assert!(!is_satisfied(&CompletionRule::Manual, &h, &probes));
    }

    #[test]
    fn history_sums_repeat_launches_of_the_same_target_and_day() {
        let h = history(&[("cmd_a_b", "2026-08-01", 2), ("cmd_a_b", "2026-08-01", 3)]);
        assert_eq!(h.totals_matching("cmd_a_b"), (5, 1));
    }

    #[test]
    fn progress_for_launch_is_binary() {
        let rule = CompletionRule::Launch {
            target: "cmd_a_b".into(),
        };
        assert_eq!(
            progress_for(&rule, &LaunchHistory::new(), &no_probes()),
            Some(TaskProgress {
                current: 0,
                target: 1,
                unit: ProgressUnit::Launches
            })
        );

        let h = history(&[("cmd_a_b", "2026-08-01", 9)]);
        assert_eq!(
            progress_for(&rule, &h, &no_probes()),
            Some(TaskProgress {
                current: 1,
                target: 1,
                unit: ProgressUnit::Launches
            }),
            "nine launches of a one-launch rule is still 1 of 1"
        );
    }

    #[test]
    fn progress_for_a_habit_rule_counts_days() {
        let rule = CompletionRule::Count {
            target: "cmd_clip_*".into(),
            times: None,
            distinct_days: Some(3),
        };
        let h = history(&[
            ("cmd_clip_a", "2026-08-01", 5),
            ("cmd_clip_b", "2026-08-02", 5),
        ]);

        assert_eq!(
            progress_for(&rule, &h, &no_probes()),
            Some(TaskProgress {
                current: 2,
                target: 3,
                unit: ProgressUnit::Days
            })
        );
    }

    #[test]
    fn progress_for_a_repetition_rule_counts_launches() {
        let rule = CompletionRule::Count {
            target: "cmd_a_b".into(),
            times: Some(5),
            distinct_days: None,
        };
        let h = history(&[("cmd_a_b", "2026-08-01", 2)]);

        assert_eq!(
            progress_for(&rule, &h, &no_probes()),
            Some(TaskProgress {
                current: 2,
                target: 5,
                unit: ProgressUnit::Launches
            })
        );
    }

    #[test]
    fn progress_for_two_thresholds_reports_the_binding_one() {
        // 4 launches of 5 (80%) but only 1 day of 3 (33%) — the days are
        // what is actually holding the task back, so days is what to show.
        let rule = CompletionRule::Count {
            target: "cmd_a_b".into(),
            times: Some(5),
            distinct_days: Some(3),
        };
        let h = history(&[("cmd_a_b", "2026-08-01", 4)]);

        assert_eq!(
            progress_for(&rule, &h, &no_probes()),
            Some(TaskProgress {
                current: 1,
                target: 3,
                unit: ProgressUnit::Days
            })
        );

        // Flip it: 3 days of 3 met, but only 3 launches of 10.
        let rule = CompletionRule::Count {
            target: "cmd_a_b".into(),
            times: Some(10),
            distinct_days: Some(3),
        };
        let h = history(&[
            ("cmd_a_b", "2026-08-01", 1),
            ("cmd_a_b", "2026-08-02", 1),
            ("cmd_a_b", "2026-08-03", 1),
        ]);
        assert_eq!(
            progress_for(&rule, &h, &no_probes()),
            Some(TaskProgress {
                current: 3,
                target: 10,
                unit: ProgressUnit::Launches
            })
        );
    }

    #[test]
    fn progress_for_state_counts_items() {
        let mut probes = no_probes();
        probes.insert("snippets.count".into(), 2);
        let rule = CompletionRule::State {
            probe: "snippets.count".into(),
            at_least: Some(3),
        };
        assert_eq!(
            progress_for(&rule, &LaunchHistory::new(), &probes),
            Some(TaskProgress {
                current: 2,
                target: 3,
                unit: ProgressUnit::Items
            })
        );
    }

    #[test]
    fn progress_for_an_unreported_probe_is_zero_not_missing() {
        let rule = CompletionRule::State {
            probe: "never.reported".into(),
            at_least: Some(2),
        };
        assert_eq!(
            progress_for(&rule, &LaunchHistory::new(), &no_probes()),
            Some(TaskProgress {
                current: 0,
                target: 2,
                unit: ProgressUnit::Items
            })
        );
    }

    #[test]
    fn progress_for_manual_is_none() {
        assert_eq!(
            progress_for(&CompletionRule::Manual, &LaunchHistory::new(), &no_probes()),
            None,
            "a manual task measures nothing, so it must not fake a bar"
        );
    }

    #[test]
    fn progress_never_exceeds_its_target() {
        let rule = CompletionRule::Count {
            target: "cmd_a_b".into(),
            times: Some(2),
            distinct_days: None,
        };
        let h = history(&[("cmd_a_b", "2026-08-01", 99)]);
        let p = progress_for(&rule, &h, &no_probes()).unwrap();
        assert_eq!(p.current, 2);
        assert_eq!(p.target, 2);
    }

    #[test]
    fn progress_target_of_zero_is_treated_as_one() {
        let rule = CompletionRule::Count {
            target: "cmd_a_b".into(),
            times: Some(0),
            distinct_days: None,
        };
        let p = progress_for(&rule, &LaunchHistory::new(), &no_probes()).unwrap();
        assert_eq!(p.target, 1, "a zero target would divide by zero in the UI");
    }

    #[test]
    fn progress_wire_format_is_camel_case() {
        let p = TaskProgress {
            current: 2,
            target: 3,
            unit: ProgressUnit::Days,
        };
        assert_eq!(
            serde_json::to_string(&p).unwrap(),
            r#"{"current":2,"target":3,"unit":"days"}"#
        );
    }

    #[test]
    fn target_matches_handles_exact_and_glob_patterns() {
        assert!(target_matches("cmd_a_b", "cmd_a_b"));
        assert!(target_matches("cmd_a_*", "cmd_a_b"));
        assert!(!target_matches("cmd_a_*", "cmd_z_b"));
        assert!(!target_matches("cmd_[a", "cmd_a"));
    }

    #[test]
    fn watched_target_is_none_for_rules_launches_cannot_affect() {
        assert_eq!(
            watched_target(&CompletionRule::Launch {
                target: "cmd_a".into()
            }),
            Some("cmd_a")
        );
        assert_eq!(
            watched_target(&CompletionRule::Count {
                target: "cmd_b".into(),
                times: None,
                distinct_days: None,
            }),
            Some("cmd_b")
        );
        assert_eq!(
            watched_target(&CompletionRule::State {
                probe: "p".into(),
                at_least: None
            }),
            None
        );
        assert_eq!(watched_target(&CompletionRule::Manual), None);
    }

    #[test]
    fn wire_format_uses_camel_case_thresholds() {
        // The manifest is authored by extension developers — assert the
        // literal JSON they will type, not the Rust field names.
        let json = r#"{"type":"count","target":"cmd_a_*","times":3,"distinctDays":2}"#;
        let rule: CompletionRule = serde_json::from_str(json).unwrap();
        assert_eq!(
            rule,
            CompletionRule::Count {
                target: "cmd_a_*".into(),
                times: Some(3),
                distinct_days: Some(2),
            }
        );
        assert_eq!(serde_json::to_string(&rule).unwrap(), json);
    }

    #[test]
    fn wire_format_parses_state_and_manual() {
        let state: CompletionRule =
            serde_json::from_str(r#"{"type":"state","probe":"snippets.count","atLeast":1}"#)
                .unwrap();
        assert_eq!(
            state,
            CompletionRule::State {
                probe: "snippets.count".into(),
                at_least: Some(1),
            }
        );

        let manual: CompletionRule = serde_json::from_str(r#"{"type":"manual"}"#).unwrap();
        assert_eq!(manual, CompletionRule::Manual);
    }
}
