//! Cross-platform process enumeration, app-grouping, and kill service.
//!
//! Privileged capability exposed to Tier 2 extensions via the `process:*`
//! IPC namespace. All grouping / sorting / filtering / classification is
//! pure and unit-tested here; live enumeration is a thin `sysinfo` shim.

pub mod grouping;
pub mod protected;
pub mod types;

use crate::process_manager::grouping::{filter_groups, group, sort_groups};
use crate::process_manager::protected::{classify, Os};
use crate::process_manager::types::{AppGroup, KillFailure, KillResult, RawProcess, SortBy};

#[cfg(target_os = "macos")]
const CURRENT_OS: Os = Os::Macos;
#[cfg(target_os = "windows")]
const CURRENT_OS: Os = Os::Windows;
#[cfg(any(target_os = "linux", not(any(target_os = "macos", target_os = "windows"))))]
const CURRENT_OS: Os = Os::Linux;

/// Pure pipeline: group → filter → sort. Unit-tested without a live system.
pub fn list_from_raw(raw: Vec<RawProcess>, os: Os, query: &str, sort: SortBy) -> Vec<AppGroup> {
    let mut groups = filter_groups(group(os, &raw), query);
    sort_groups(&mut groups, sort);
    groups
}

/// Live enumeration via `sysinfo`, then the pure pipeline.
pub fn list(query: &str, sort: SortBy) -> Vec<AppGroup> {
    let raw = enumerate();
    list_from_raw(raw, CURRENT_OS, query, sort)
}

/// Map a refreshed `System` into our internal `RawProcess` snapshot. Shared by
/// the list and kill enumerations so the two stay in sync.
fn raw_processes(sys: &sysinfo::System, users: &sysinfo::Users) -> Vec<RawProcess> {
    sys.processes()
        .values()
        .map(|p| {
            let owner = p
                .user_id()
                .and_then(|uid| users.get_user_by_id(uid))
                .map(|u| u.name().to_string())
                .unwrap_or_default();
            RawProcess {
                pid: p.pid().as_u32(),
                parent_pid: p.parent().map(|pp| pp.as_u32()),
                name: p.name().to_string_lossy().to_string(),
                cpu_percent: p.cpu_usage(),
                memory_bytes: p.memory(),
                exe_path: p.exe().map(|e| e.to_string_lossy().to_string()).unwrap_or_default(),
                owner,
            }
        })
        .collect()
}

/// Full enumeration for the **list** view: two refreshes plus a CPU-delta sleep
/// so `cpu_percent` is accurate. This is the slow path (~200ms) and must only
/// run off the UI thread (the command layer pushes it to a blocking pool).
fn enumerate() -> Vec<RawProcess> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, Users};
    let mut sys = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
    );
    // Two refreshes give sysinfo a delta window for accurate CPU%.
    sys.refresh_processes(ProcessesToUpdate::All);
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_processes(ProcessesToUpdate::All);

    let users = Users::new_with_refreshed_list();
    raw_processes(&sys, &users)
}

/// Lightweight single-refresh snapshot for the **kill** guardrail. The
/// server-side `protected` re-derivation only needs name/exe/owner/pid — never
/// CPU% — so this skips the second refresh and the `MINIMUM_CPU_UPDATE_INTERVAL`
/// sleep that `enumerate` pays. `cpu_percent`/`memory_bytes` come back as 0 here
/// (unused by `classify`), keeping the kill path fast without weakening the
/// guardrail.
fn enumerate_snapshot() -> Vec<RawProcess> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, Users};
    let mut sys = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
    );
    sys.refresh_processes(ProcessesToUpdate::All);
    let users = Users::new_with_refreshed_list();
    raw_processes(&sys, &users)
}

/// A pid plus its protected flag, as resolved by the caller (the command
/// layer re-derives `protected` from a fresh enumeration, never trusting the
/// client).
#[derive(Debug, Clone, Copy)]
pub struct KillTarget {
    pub pid: u32,
    pub protected: bool,
}

/// Abstracts the OS kill so the guardrail logic is unit-testable.
pub trait ProcessKiller {
    fn kill(&self, pid: u32, force: bool) -> Result<(), String>;
}

/// Real killer backed by `sysinfo`. `force` → SIGKILL; otherwise graceful
/// (SIGTERM on Unix / TerminateProcess on Windows — which is all Windows has).
pub struct SysinfoKiller;

impl ProcessKiller for SysinfoKiller {
    fn kill(&self, pid: u32, force: bool) -> Result<(), String> {
        use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, Signal, System};
        let sys = System::new_with_specifics(
            RefreshKind::new().with_processes(ProcessRefreshKind::new()),
        );
        let proc = sys
            .process(Pid::from_u32(pid))
            .ok_or_else(|| format!("process {pid} not found"))?;
        let ok = if force {
            proc.kill_with(Signal::Kill).unwrap_or_else(|| proc.kill())
        } else {
            proc.kill_with(Signal::Term).unwrap_or_else(|| proc.kill())
        };
        if ok {
            Ok(())
        } else {
            Err(format!("failed to signal process {pid}"))
        }
    }
}

/// Apply the guardrail, then kill. A protected target without
/// `confirmed_protected` is refused **before** any OS call.
pub fn kill_all(
    killer: &dyn ProcessKiller,
    targets: &[KillTarget],
    force: bool,
    confirmed_protected: bool,
) -> KillResult {
    let mut killed = vec![];
    let mut failed = vec![];
    for t in targets {
        if t.protected && !confirmed_protected {
            failed.push(KillFailure {
                pid: t.pid,
                error: "refused: protected process requires explicit confirmation".into(),
            });
            continue;
        }
        match killer.kill(t.pid, force) {
            Ok(()) => killed.push(t.pid),
            Err(e) => failed.push(KillFailure { pid: t.pid, error: e }),
        }
    }
    KillResult { killed, failed }
}

/// Pure: build kill targets from a single snapshot, deriving each pid's
/// `protected` flag server-side (a pid absent from the snapshot is already
/// gone → not protected). Takes an explicit `os` so it's unit-testable on any
/// host.
fn targets_from_snapshot(pids: Vec<u32>, snapshot: &[RawProcess], os: Os) -> Vec<KillTarget> {
    pids.into_iter()
        .map(|pid| {
            let protected = snapshot
                .iter()
                .find(|p| p.pid == pid)
                .map(|p| classify(os, p))
                .unwrap_or(false);
            KillTarget { pid, protected }
        })
        .collect()
}

/// Live kill: re-derive `protected` per pid from a single fresh snapshot
/// (never trust the client), then enforce + kill.
pub fn kill(pids: Vec<u32>, force: bool, confirmed_protected: bool) -> KillResult {
    let snapshot = enumerate_snapshot();
    let targets = targets_from_snapshot(pids, &snapshot, CURRENT_OS);
    kill_all(&SysinfoKiller, &targets, force, confirmed_protected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process_manager::protected::Os;
    use crate::process_manager::types::{RawProcess, SortBy};
    use std::cell::RefCell;

    fn raw(pid: u32, name: &str, cpu: f32) -> RawProcess {
        RawProcess {
            pid,
            parent_pid: None,
            name: name.into(),
            cpu_percent: cpu,
            memory_bytes: 0,
            exe_path: format!("/usr/bin/{name}"),
            owner: "alice".into(),
        }
    }

    #[test]
    fn list_from_raw_filters_then_sorts() {
        let procs = vec![raw(1, "alpha", 2.0), raw(2, "beta", 9.0), raw(3, "alps", 5.0)];
        let groups = list_from_raw(procs, Os::Linux, "alp", SortBy::Cpu);
        // "beta" filtered out; "alps" (5.0) before "alpha" (2.0)
        assert_eq!(groups.iter().map(|g| g.app_name.clone()).collect::<Vec<_>>(), ["alps", "alpha"]);
    }

    struct FakeKiller {
        calls: RefCell<Vec<(u32, bool)>>,
    }
    impl FakeKiller {
        fn new() -> Self {
            Self { calls: RefCell::new(vec![]) }
        }
    }
    impl ProcessKiller for FakeKiller {
        fn kill(&self, pid: u32, force: bool) -> Result<(), String> {
            self.calls.borrow_mut().push((pid, force));
            if pid == 666 {
                Err("permission denied".into())
            } else {
                Ok(())
            }
        }
    }

    fn target(pid: u32, protected: bool) -> KillTarget {
        KillTarget { pid, protected }
    }

    #[test]
    fn refuses_protected_without_confirmation() {
        let k = FakeKiller::new();
        let res = kill_all(&k, &[target(1, true)], false, false);
        assert!(res.killed.is_empty());
        assert_eq!(res.failed.len(), 1);
        assert!(res.failed[0].error.contains("protected"));
        assert!(k.calls.borrow().is_empty(), "must not touch the OS");
    }

    #[test]
    fn kills_protected_when_confirmed() {
        let k = FakeKiller::new();
        let res = kill_all(&k, &[target(1, true)], false, true);
        assert_eq!(res.killed, vec![1]);
    }

    #[test]
    fn force_flag_is_passed_through() {
        let k = FakeKiller::new();
        kill_all(&k, &[target(7, false)], true, false);
        assert_eq!(k.calls.borrow()[0], (7, true));
    }

    #[test]
    fn collects_per_pid_failures() {
        let k = FakeKiller::new();
        let res = kill_all(&k, &[target(5, false), target(666, false)], false, false);
        assert_eq!(res.killed, vec![5]);
        assert_eq!(res.failed.len(), 1);
        assert_eq!(res.failed[0].pid, 666);
    }

    #[test]
    fn kill_all_empty_targets_is_noop() {
        let k = FakeKiller::new();
        let res = kill_all(&k, &[], false, false);
        assert!(res.killed.is_empty() && res.failed.is_empty());
        assert!(k.calls.borrow().is_empty(), "must not touch the OS for an empty target list");
    }

    // Integration: the live `kill()` path (real `sysinfo` enumerate + signal)
    // must actually terminate a process we own. Guards against a regression
    // where the snapshot fails to find the pid or the signal isn't delivered.
    #[cfg(unix)]
    #[test]
    fn real_kill_terminates_owned_child() {
        let mut child = std::process::Command::new("sleep")
            .arg("300")
            .spawn()
            .expect("spawn sleep");
        let pid = child.id();
        assert!(
            child.try_wait().unwrap().is_none(),
            "child should be alive before kill"
        );

        let res = kill(vec![pid], true, false);

        // Give the OS a moment to deliver the signal and reap.
        std::thread::sleep(std::time::Duration::from_millis(300));
        let status = child.try_wait().unwrap();
        let _ = child.kill();
        let _ = child.wait();

        assert_eq!(
            res.killed,
            vec![pid],
            "kill() should report the pid killed; failed={:?}",
            res.failed
        );
        assert!(status.is_some(), "child should have exited after force kill");
    }

    #[test]
    fn targets_from_snapshot_derives_protected_server_side() {
        // pid 1 is in the snapshot and protected (linux init); pid 1234 is in
        // the snapshot and not protected; pid 9999 is absent → not protected.
        let mut init = raw(1, "systemd", 0.0);
        init.exe_path = "/usr/lib/systemd/systemd".into();
        init.owner = "root".into();
        let user = raw(1234, "code", 0.0);
        let snapshot = vec![init, user];

        let targets = targets_from_snapshot(vec![1, 1234, 9999], &snapshot, Os::Linux);

        assert_eq!(targets.len(), 3);
        assert_eq!((targets[0].pid, targets[0].protected), (1, true));
        assert_eq!((targets[1].pid, targets[1].protected), (1234, false));
        assert_eq!((targets[2].pid, targets[2].protected), (9999, false));
    }
}
