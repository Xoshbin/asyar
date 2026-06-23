//! Pure transforms: raw processes → grouped/filtered/sorted AppGroups.

use crate::process_manager::protected::{classify, Os};
use crate::process_manager::types::{AppGroup, ProcessInfo, RawProcess, SortBy};
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;

/// Friendly app name for grouping. macOS → the `.app` bundle display name;
/// elsewhere → the process name (executables of the same app share a name).
pub fn app_name_for(os: Os, p: &RawProcess) -> String {
    if os == Os::Macos {
        if let Some(idx) = p.exe_path.find(".app/") {
            let before = &p.exe_path[..idx];
            if let Some(slash) = before.rfind('/') {
                return before[slash + 1..].to_string();
            }
        }
    }
    p.name.clone()
}

/// Group raw processes by app, summing CPU/memory and marking the group
/// protected when any child is protected.
pub fn group(os: Os, procs: &[RawProcess]) -> Vec<AppGroup> {
    use std::collections::BTreeMap;
    let mut buckets: BTreeMap<String, Vec<&RawProcess>> = BTreeMap::new();
    for p in procs {
        buckets.entry(app_name_for(os, p)).or_default().push(p);
    }
    buckets
        .into_iter()
        .map(|(app_name, members)| {
            let children: Vec<ProcessInfo> = members
                .iter()
                .map(|p| ProcessInfo {
                    pid: p.pid,
                    name: p.name.clone(),
                    cpu_percent: p.cpu_percent,
                    memory_bytes: p.memory_bytes,
                    path: p.exe_path.clone(),
                    owner: p.owner.clone(),
                    protected: classify(os, p),
                })
                .collect();
            AppGroup {
                owner: members[0].owner.clone(),
                total_cpu: children.iter().map(|c| c.cpu_percent).sum(),
                total_memory_bytes: children.iter().map(|c| c.memory_bytes).sum(),
                process_count: children.len() as u32,
                protected: children.iter().any(|c| c.protected),
                icon: None,
                children,
                app_name,
            }
        })
        .collect()
}

/// Fuzzy-filter groups by app name. Blank query → unchanged.
pub fn filter_groups(groups: Vec<AppGroup>, query: &str) -> Vec<AppGroup> {
    let q = query.trim();
    if q.is_empty() {
        return groups;
    }
    let matcher = SkimMatcherV2::default();
    groups
        .into_iter()
        .filter(|g| matcher.fuzzy_match(&g.app_name, q).is_some())
        .collect()
}

/// Sort groups in place. Cpu/Memory descending; Name ascending (case-insensitive).
pub fn sort_groups(groups: &mut [AppGroup], sort: SortBy) {
    match sort {
        SortBy::Cpu => groups.sort_by(|a, b| {
            b.total_cpu
                .partial_cmp(&a.total_cpu)
                .unwrap_or(std::cmp::Ordering::Equal)
        }),
        SortBy::Memory => groups.sort_by_key(|b| std::cmp::Reverse(b.total_memory_bytes)),
        SortBy::Name => groups.sort_by_key(|a| a.app_name.to_lowercase()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(pid: u32, name: &str, exe: &str, cpu: f32, mem: u64) -> RawProcess {
        RawProcess {
            pid,
            parent_pid: None,
            name: name.into(),
            cpu_percent: cpu,
            memory_bytes: mem,
            exe_path: exe.into(),
            owner: "alice".into(),
        }
    }

    #[test]
    fn macos_chrome_helpers_collapse_into_one_group() {
        let base = "/Applications/Google Chrome.app/Contents";
        let procs = vec![
            raw(
                1,
                "Google Chrome",
                &format!("{base}/MacOS/Google Chrome"),
                10.0,
                100,
            ),
            raw(
                2,
                "Google Chrome Helper",
                &format!("{base}/Frameworks/.../Google Chrome Helper"),
                5.0,
                50,
            ),
            raw(
                3,
                "Google Chrome Helper (GPU)",
                &format!("{base}/Frameworks/.../Helper (GPU)"),
                2.0,
                25,
            ),
        ];
        let groups = group(Os::Macos, &procs);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].app_name, "Google Chrome");
        assert_eq!(groups[0].process_count, 3);
        assert_eq!(groups[0].total_memory_bytes, 175);
        assert!((groups[0].total_cpu - 17.0).abs() < 0.01);
    }

    #[test]
    fn standalone_process_stays_single() {
        let groups = group(Os::Linux, &[raw(9, "vim", "/usr/bin/vim", 1.0, 10)]);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].process_count, 1);
    }

    #[test]
    fn group_protected_when_any_child_protected() {
        let mut p = raw(1, "WindowServer", "/System/Library/x", 1.0, 1);
        p.owner = "root".into();
        let groups = group(Os::Macos, &[p]);
        assert!(groups[0].protected);
    }

    #[test]
    fn filter_matches_app_name_fuzzy() {
        let groups = vec![mk("Google Chrome"), mk("Spotify"), mk("Slack")];
        let out = filter_groups(groups, "chrm");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].app_name, "Google Chrome");
    }

    #[test]
    fn empty_query_returns_all() {
        let groups = vec![mk("a"), mk("b")];
        assert_eq!(filter_groups(groups, "  ").len(), 2);
    }

    #[test]
    fn sort_by_cpu_desc_then_memory_then_name() {
        let mut g = vec![cpu("a", 1.0), cpu("b", 9.0), cpu("c", 5.0)];
        sort_groups(&mut g, SortBy::Cpu);
        assert_eq!(
            g.iter().map(|x| x.app_name.clone()).collect::<Vec<_>>(),
            ["b", "c", "a"]
        );
        sort_groups(&mut g, SortBy::Name);
        assert_eq!(
            g.iter().map(|x| x.app_name.clone()).collect::<Vec<_>>(),
            ["a", "b", "c"]
        );
    }

    fn mk(name: &str) -> AppGroup {
        cpu(name, 0.0)
    }
    fn cpu(name: &str, c: f32) -> AppGroup {
        AppGroup {
            app_name: name.into(),
            icon: None,
            owner: "alice".into(),
            total_cpu: c,
            total_memory_bytes: 0,
            process_count: 1,
            protected: false,
            children: vec![],
        }
    }
}
