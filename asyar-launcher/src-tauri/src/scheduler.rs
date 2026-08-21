//! Central scheduler for long-lived background jobs.
//!
//! Replaces the per-feature copy-pasted spawn-loop daemons (app-update check,
//! shell/notification GC, extension auto-update) with one registry. A job is a
//! stable id + a [`Cadence`] strategy + a command closure; the registry owns one
//! supervisor task per job so they can be enumerated and cancelled from a single
//! place. Adding a periodic job is one [`Scheduler::register`] call.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;
use std::time::Duration;

use tauri::async_runtime::{self, JoinHandle};

/// How often a job runs. A strategy — extend with cron/one-shot variants as
/// new cadences are needed without touching the supervisor loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cadence {
    /// Wait `startup_delay` after launch, then run every `period`.
    FixedInterval {
        startup_delay: Duration,
        period: Duration,
    },
}

type BoxFuture = Pin<Box<dyn Future<Output = ()> + Send>>;
type JobFn = Box<dyn Fn() -> BoxFuture + Send + Sync>;

/// A registered background job: a stable id, a cadence, and the work to run
/// each tick.
pub struct Job {
    id: &'static str,
    cadence: Cadence,
    run: JobFn,
}

impl Job {
    /// Build a fixed-interval job. `run` is invoked once per tick; it captures
    /// whatever state the work needs (an `AppHandle`, a registry clone, …).
    pub fn fixed_interval<F, Fut>(
        id: &'static str,
        startup_delay: Duration,
        period: Duration,
        run: F,
    ) -> Self
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        Self {
            id,
            cadence: Cadence::FixedInterval {
                startup_delay,
                period,
            },
            run: Box::new(move || Box::pin(run())),
        }
    }
}

/// Registry of background jobs. One supervisor task per job, tracked by id.
#[derive(Default)]
pub struct Scheduler {
    tasks: Mutex<HashMap<&'static str, JoinHandle<()>>>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawn a job's supervisor. Idempotent per id: re-registering the same id
    /// aborts the previous supervisor first.
    pub fn register(&self, job: Job) {
        let Job { id, cadence, run } = job;
        let handle = match cadence {
            Cadence::FixedInterval {
                startup_delay,
                period,
            } => {
                // tauri's runtime (not raw tokio::spawn): setup_app can run
                // before a Tokio reactor is attached.
                //
                // macOS App Nap coalesces long tokio sleeps once the app sits
                // idle and hidden; a period of minutes or hours can stretch
                // far past nominal until the next app wakeup. Acceptable for
                // every current job (update checks, GC): each is periodic
                // best-effort housekeeping that simply runs on wake. A job
                // that needs punctual firing while the app is napping must
                // not use this loop as-is; it needs OS-scheduled timing
                // (NSBackgroundActivityScheduler or an explicit-tolerance
                // timer).
                async_runtime::spawn(async move {
                    tokio::time::sleep(startup_delay).await;
                    loop {
                        run().await;
                        tokio::time::sleep(period).await;
                    }
                })
            }
        };
        if let Ok(mut tasks) = self.tasks.lock() {
            if let Some(previous) = tasks.insert(id, handle) {
                previous.abort();
            }
        }
    }

    /// Sorted ids of all currently-registered jobs (observability / tests).
    pub fn snapshot(&self) -> Vec<&'static str> {
        match self.tasks.lock() {
            Ok(tasks) => {
                let mut ids: Vec<&'static str> = tasks.keys().copied().collect();
                ids.sort_unstable();
                ids
            }
            Err(_) => Vec::new(),
        }
    }
}

/// Debug/observability command: the ids of all registered background jobs.
#[tauri::command]
pub fn get_scheduler_snapshot(scheduler: tauri::State<'_, Scheduler>) -> Vec<String> {
    scheduler.snapshot().into_iter().map(String::from).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A job whose first tick is an hour out, so the work never runs during a
    /// unit test — we only assert the registry bookkeeping.
    fn idle_job(id: &'static str) -> Job {
        Job::fixed_interval(
            id,
            Duration::from_secs(3600),
            Duration::from_secs(3600),
            || async {},
        )
    }

    #[test]
    fn register_tracks_job_ids_sorted() {
        let scheduler = Scheduler::new();
        scheduler.register(idle_job("b-job"));
        scheduler.register(idle_job("a-job"));
        assert_eq!(scheduler.snapshot(), vec!["a-job", "b-job"]);
    }

    #[test]
    fn re_registering_same_id_keeps_one_entry() {
        let scheduler = Scheduler::new();
        scheduler.register(idle_job("dup"));
        scheduler.register(idle_job("dup"));
        assert_eq!(scheduler.snapshot(), vec!["dup"]);
    }
}
