//! The in-memory task registry and the launch hot path.
//!
//! Task declarations arrive from the frontend, which is the only layer that
//! sees both built-in manifests (bundled into the JS) and installed Tier 2
//! manifests. That mirrors the existing command-index sync: the frontend
//! transports declarations, Rust owns every decision made about them.
//!
//! `record_item_usage` runs on every single launch in the app, so the hook it
//! calls has to be nearly free in the common case. [`Registry::is_launch_relevant`]
//! answers "could this launch possibly complete anything?" from memory alone;
//! only a `true` there costs a database read.

use super::progress::Latched;
use super::rules::{self, Probes};
use super::WalkthroughTask;
use std::sync::Mutex;

#[derive(Debug, Default)]
pub struct Registry {
    pub tasks: Vec<WalkthroughTask>,
    pub probes: Probes,
}

impl Registry {
    /// Tasks that are declared but not yet latched complete.
    pub fn pending<'a>(&'a self, latched: &Latched) -> Vec<&'a WalkthroughTask> {
        self.tasks
            .iter()
            .filter(|t| !latched.contains_key(&t.id))
            .collect()
    }

    /// Could a launch of `object_id` move any unfinished task forward?
    ///
    /// False for the overwhelming majority of launches — every launch once
    /// the walkthrough is finished, and every launch of something no task
    /// watches. Those cost one glob match per pending task and nothing else.
    pub fn is_launch_relevant(&self, latched: &Latched, object_id: &str) -> bool {
        self.pending(latched).into_iter().any(|task| {
            rules::watched_target(&task.completion)
                .is_some_and(|target| rules::target_matches(target, object_id))
        })
    }
}

/// Managed Tauri state. Replaced wholesale on every sync — extensions come
/// and go, and a stale task from an uninstalled extension must not linger.
#[derive(Debug, Default)]
pub struct WalkthroughState {
    pub registry: Mutex<Registry>,
}

impl WalkthroughState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn replace(&self, tasks: Vec<WalkthroughTask>, probes: Probes) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.tasks = tasks;
            registry.probes = probes;
        }
    }

    pub fn snapshot(&self) -> (Vec<WalkthroughTask>, Probes) {
        match self.registry.lock() {
            Ok(registry) => (registry.tasks.clone(), registry.probes.clone()),
            Err(_) => (Vec::new(), Probes::new()),
        }
    }

    /// Lock-poisoning falls back to "relevant", which costs one wasted
    /// evaluation instead of silently dropping a completion.
    pub fn is_launch_relevant(&self, latched: &Latched, object_id: &str) -> bool {
        match self.registry.lock() {
            Ok(registry) => registry.is_launch_relevant(latched, object_id),
            Err(_) => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::walkthrough::{CompletionRecord, CompletionRule, CompletionSource};

    fn task(id: &str, completion: CompletionRule) -> WalkthroughTask {
        WalkthroughTask {
            id: id.to_string(),
            extension_id: "org.asyar.test".into(),
            title: id.to_string(),
            summary: String::new(),
            body: String::new(),
            icon: None,
            image: None,
            order: 0,
            completion,
        }
    }

    fn launch_task(id: &str, target: &str) -> WalkthroughTask {
        task(
            id,
            CompletionRule::Launch {
                target: target.into(),
            },
        )
    }

    fn latched_with(ids: &[&str]) -> Latched {
        ids.iter()
            .map(|id| {
                (
                    id.to_string(),
                    CompletionRecord {
                        task_id: id.to_string(),
                        completed_at: 1,
                        source: CompletionSource::Auto,
                    },
                )
            })
            .collect()
    }

    fn registry(tasks: Vec<WalkthroughTask>) -> Registry {
        Registry {
            tasks,
            probes: Probes::new(),
        }
    }

    #[test]
    fn pending_excludes_latched_tasks() {
        let r = registry(vec![
            launch_task("wt_a", "cmd_a"),
            launch_task("wt_b", "cmd_b"),
        ]);
        let pending = r.pending(&latched_with(&["wt_a"]));
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, "wt_b");
    }

    #[test]
    fn launch_is_relevant_when_a_pending_task_watches_it() {
        let r = registry(vec![launch_task("wt_a", "cmd_org.asyar.calculator_*")]);
        assert!(r.is_launch_relevant(&Latched::new(), "cmd_org.asyar.calculator_calc"));
    }

    #[test]
    fn launch_is_irrelevant_when_nothing_watches_it() {
        let r = registry(vec![launch_task("wt_a", "cmd_org.asyar.calculator_*")]);
        assert!(!r.is_launch_relevant(&Latched::new(), "app_Safari"));
    }

    #[test]
    fn launch_is_irrelevant_once_the_watching_task_is_done() {
        // The finished-walkthrough case: every launch must skip the
        // database entirely.
        let r = registry(vec![launch_task("wt_a", "cmd_calc")]);
        assert!(!r.is_launch_relevant(&latched_with(&["wt_a"]), "cmd_calc"));
    }

    #[test]
    fn state_and_manual_tasks_never_make_a_launch_relevant() {
        let r = registry(vec![
            task(
                "wt_state",
                CompletionRule::State {
                    probe: "snippets.count".into(),
                    at_least: None,
                },
            ),
            task("wt_manual", CompletionRule::Manual),
        ]);
        assert!(!r.is_launch_relevant(&Latched::new(), "cmd_anything"));
    }

    #[test]
    fn an_empty_registry_makes_every_launch_irrelevant() {
        assert!(!registry(vec![]).is_launch_relevant(&Latched::new(), "cmd_a"));
    }

    #[test]
    fn state_replace_swaps_the_whole_registry() {
        let state = WalkthroughState::new();
        state.replace(vec![launch_task("wt_old", "cmd_a")], Probes::new());
        state.replace(vec![launch_task("wt_new", "cmd_b")], Probes::new());

        let (tasks, _) = state.snapshot();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "wt_new");
        assert!(!state.is_launch_relevant(&Latched::new(), "cmd_a"));
        assert!(state.is_launch_relevant(&Latched::new(), "cmd_b"));
    }

    #[test]
    fn state_snapshot_carries_probes() {
        let state = WalkthroughState::new();
        let mut probes = Probes::new();
        probes.insert("snippets.count".into(), 4);
        state.replace(vec![], probes);

        let (_, probes) = state.snapshot();
        assert_eq!(probes.get("snippets.count"), Some(&4));
    }
}
