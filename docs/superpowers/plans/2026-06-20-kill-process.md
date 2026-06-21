# Kill Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a cross-platform "Kill Process" feature: a generic `process` platform service in the host (Rust + SDK) consumed by a first-party Tier 2 extension that lists running processes grouped by app, sorted by CPU/memory, with graceful/force kill and smart guardrails for OS-critical processes.

**Architecture:** Killing OS processes is privileged, so the capability lives in Rust (`process_manager` module, `sysinfo` crate) behind thin Tauri commands. It is exposed to extensions over permission-gated IPC as a new `process` SDK namespace (`process:list` / `process:kill`). The Tier 2 extension is a pure presenter — it forwards `query` + `sortBy` and renders the pre-grouped/sorted/filtered result. Models the existing `power` namespace end-to-end.

**Tech Stack:** Rust (`sysinfo`, `fuzzy-matcher` — already a dep, `specta`), Tauri 2, TypeScript SDK proxies, Svelte 5 (runes) extension view, Vitest, `cargo test`.

**Design spec:** [docs/superpowers/specs/2026-06-20-kill-process-design.md](../specs/2026-06-20-kill-process-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **GIT BAN (ABSOLUTE).** Do **not** run any git mutation (`add`/`commit`/`push`/`stash`/`checkout`/`reset`/`rebase`/`merge`/`tag`). Read-only git (`status`/`diff`/`log`) only. This applies to **every subagent** too — repeat this ban verbatim in any spawn prompt. Where this plan says "Checkpoint", it means *stop and report to the user*; the **user** commits. Replace the writing-plans "Commit" step accordingly everywhere.
- **No SDK version bump.** The SDK is workspace-linked (`pnpm.overrides: asyar-sdk: workspace:*`), so source edits are picked up live. Do **not** bump `asyar-sdk/package.json` version or run `pnpm release:sdk`. The user owns release cadence.
- **rust-first.** All filtering, grouping, sorting, ranking, and the protected classifier live in Rust. The extension TS/Svelte is display-only.
- **Permission gate is Rust-real.** Enforcement is `ExtensionPermissionRegistry::check(&extension_id, "<perm>")` inside each Tauri command (defense-in-depth) **and** the `get_required_permission` map in `permissions.rs`. The JS `PERMISSION_MAP` in `permissionGate.ts` is a mirror — update it too, but Rust is the real gate.
- **Module singletons.** One `export class XxxService` + `export const xxxService = new XxxService()` in the same file. No `getInstance()`, no `private constructor`. Registry key = canonical lowercase wire namespace.
- **Svelte 5 runes + Tauri 2 APIs only** in any frontend code (`$state`, `$derived`, `$props`, `mount()`).
- **Manifest preference `type`** must be a valid lowercase `PreferenceType` value: `textfield` / `password` / `number` / `checkbox` / `dropdown` / `appPicker` / `file` / `directory`. Never `"text"`. A wrong value makes discovery silently skip the whole extension.
- **No `cargo fmt` crate-wide.** This crate is not fmt-enforced and has drift. Format only the leaf files you create with `rustfmt --skip-children --edition 2021 <file.rs>`, and only **after** CI is green. Never format `mod.rs`/`lib.rs` (recurses into submodules).
- **No process/role comments** in source (`// added by worker`, `// TODO reviewer`, "Phase N").
- **Diagnostics.** Surface failures via `diagnosticsService.report(...)` (frontend) — never silent `.catch`. Some kills fail without elevation; report per-pid, never swallow.

### Extension location note (read once)

`/extensions/` is git-ignored — dogfood extensions live in their own repos and `setup.mjs` clones them. For this plan, develop the extension in-tree at `extensions/kill-process/` (it works locally because `extensions/*` is in the pnpm workspace). Extracting it to its own GitHub repo and adding it to `setup.mjs`'s clone list is a **user-owned git follow-up** — out of scope here (GIT BAN).

### Verification commands (run from monorepo root unless noted)

```bash
# Rust (run inside asyar-launcher/src-tauri)
cargo test process_manager
cargo test --lib commands::process
cargo clean && cargo clippy --all-targets -- -D warnings   # clean first; --all-targets lints test code

# SDK
pnpm --filter asyar-sdk test

# Launcher TS
pnpm --filter asyar-launcher test

# Extension
pnpm --filter org.asyar.kill-process test
```

---

## File Structure

**Rust (`asyar-launcher/src-tauri/src/`):**
- Create `process_manager/mod.rs` — module root: `list_from_raw` (pure), `list` (live via sysinfo), `kill_all` (pure), `ProcessKiller` trait + real impl.
- Create `process_manager/types.rs` — `ProcessInfo`, `AppGroup`, `KillResult`, `KillFailure`, `SortBy`, internal `RawProcess`.
- Create `process_manager/protected.rs` — `Os` enum, `classify(os, &RawProcess) -> bool`, `is_protected(&RawProcess)`.
- Create `process_manager/grouping.rs` — `app_name_for`, `group`, `filter_groups`, `sort_groups`.
- Create `commands/process.rs` — `process_list`, `process_kill` Tauri commands + `*_inner` + tests.
- Modify `lib.rs` — `pub mod process_manager;`, register two commands in `invoke_handler`.
- Modify `permissions.rs` — add `process:read`/`process:kill` to `get_required_permission`.
- Modify `Cargo.toml` — add `sysinfo`.

**SDK (`asyar-sdk/src/`):**
- Create `services/IProcessService.ts` — interface + data types.
- Create `services/ProcessServiceProxy.ts` + `services/ProcessServiceProxy.test.ts`.
- Modify `services/index.ts` — export proxy.
- Modify `ipc/namespaces.ts` — add `'process'`.
- Modify `ExtensionContext.ts` (view bag) and `worker.ts` (worker bag) — `process: new ProcessServiceProxy()`.

**Host (`asyar-launcher/src/services/`):**
- Create `process/processService.ts` + `process/processService.test.ts` — thin invoke wrapper.
- Modify `extension/buildServiceRegistry.ts` — `process: processService`.
- Modify `extension/ExtensionIpcRouter.ts` — add `'process'` to `INJECTS_EXTENSION_ID`.
- Modify `permissionGate.ts` (+ `permissionGate.test.ts`) — map the two type strings.

**Extension (`extensions/kill-process/`):**
- Create scaffold: `package.json`, `manifest.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `view.html`, `worker.html`.
- Create `src/worker.ts` (minimal), `src/view.ts`, `src/views/KillProcessView.svelte`.
- Create `src/lib/format.ts` (display helpers — pure) + `src/manifest.test.ts` + `src/lib/format.test.ts`.

**Docs:**
- Modify `docs/reference/permissions.md` and `built-in-features/create-extension/ai-builder/capabilitySpec/capabilities.json` — document `process:read`/`process:kill`.

---

## Task 1: Rust process types + protected classifier

**Files:**
- Modify: `asyar-launcher/src-tauri/Cargo.toml` (add `sysinfo`)
- Create: `asyar-launcher/src-tauri/src/process_manager/mod.rs` (skeleton + module decls)
- Create: `asyar-launcher/src-tauri/src/process_manager/types.rs`
- Create: `asyar-launcher/src-tauri/src/process_manager/protected.rs`
- Modify: `asyar-launcher/src-tauri/src/lib.rs` (add `pub mod process_manager;` after `pub mod power;`)

**Interfaces:**
- Produces: `process_manager::types::{RawProcess, ProcessInfo, AppGroup, KillResult, KillFailure, SortBy}`; `process_manager::protected::{Os, classify, is_protected}`.

- [ ] **Step 1: Add the `sysinfo` dependency**

In `Cargo.toml` `[dependencies]`, add after the `fuzzy-matcher` line:
```toml
sysinfo = "0.31" # cross-platform process enumeration + kill
```

- [ ] **Step 2: Create the module skeleton so `lib.rs` compiles**

`process_manager/mod.rs`:
```rust
//! Cross-platform process enumeration, app-grouping, and kill service.
//!
//! Privileged capability exposed to Tier 2 extensions via the `process:*`
//! IPC namespace. All grouping / sorting / filtering / classification is
//! pure and unit-tested here; live enumeration is a thin `sysinfo` shim.

pub mod grouping;
pub mod protected;
pub mod types;
```

In `lib.rs`, add `pub mod process_manager;` immediately after `pub mod power;` (alphabetical-ish, matches existing ordering).

> NOTE: `grouping` is declared now but created in Task 2. Add a temporary empty `grouping.rs` (`//! see Task 2`) so this task compiles; Task 2 fills it.

- [ ] **Step 3: Write the failing test for the protected classifier**

`process_manager/protected.rs`:
```rust
//! Cross-platform "is this an OS-critical process?" classifier.
//!
//! `classify` takes an explicit `Os` so every platform's rules are unit
//! testable on any CI host. `is_protected` applies the current platform's
//! rules.

use crate::process_manager::types::RawProcess;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Macos,
    Windows,
    Linux,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(name: &str, owner: &str, exe: &str, ppid: Option<u32>) -> RawProcess {
        RawProcess {
            pid: 100,
            parent_pid: ppid,
            name: name.into(),
            cpu_percent: 0.0,
            memory_bytes: 0,
            exe_path: exe.into(),
            owner: owner.into(),
        }
    }

    #[test]
    fn macos_system_paths_and_core_names_are_protected() {
        assert!(classify(Os::Macos, &raw("WindowServer", "root", "/System/Library/...", None)));
        assert!(classify(Os::Macos, &raw("launchd", "root", "/sbin/launchd", None)));
        assert!(classify(Os::Macos, &raw("x", "root", "/usr/libexec/x", None)));
    }

    #[test]
    fn macos_user_app_is_not_protected() {
        assert!(!classify(
            Os::Macos,
            &raw("Google Chrome", "alice", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", None)
        ));
    }

    #[test]
    fn windows_core_names_are_protected() {
        for n in ["System", "csrss.exe", "wininit.exe", "services.exe", "lsass.exe", "winlogon.exe", "smss.exe"] {
            assert!(classify(Os::Windows, &raw(n, "SYSTEM", "C:\\Windows\\System32", None)), "{n}");
        }
    }

    #[test]
    fn linux_init_and_kernel_threads_are_protected() {
        let mut init = raw("systemd", "root", "/usr/lib/systemd/systemd", None);
        init.pid = 1;
        assert!(classify(Os::Linux, &init));
        assert!(classify(Os::Linux, &raw("kworker/0:1", "root", "", Some(2)))); // ppid 2 = kthreadd
    }

    #[test]
    fn linux_user_app_is_not_protected() {
        let mut p = raw("code", "alice", "/usr/share/code/code", Some(1234));
        p.pid = 1234;
        assert!(!classify(Os::Linux, &p));
    }
}
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cd asyar-launcher/src-tauri && cargo test process_manager::protected`
Expected: FAIL — `cannot find function classify` and `RawProcess` not defined yet.

- [ ] **Step 5: Define the types**

`process_manager/types.rs`:
```rust
//! Serializable contract types for the `process` service (camelCase to TS)
//! plus the internal `RawProcess` used by the pure transforms.

use serde::{Deserialize, Serialize};

/// Internal, pre-grouping snapshot of one OS process. Not sent over IPC.
#[derive(Debug, Clone)]
pub struct RawProcess {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub name: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub exe_path: String,
    pub owner: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
    pub path: String,
    pub owner: String,
    pub protected: bool,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppGroup {
    pub app_name: String,
    pub icon: Option<String>,
    pub owner: String,
    pub total_cpu: f32,
    pub total_memory_bytes: u64,
    pub process_count: u32,
    pub protected: bool,
    pub children: Vec<ProcessInfo>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct KillFailure {
    pub pid: u32,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct KillResult {
    pub killed: Vec<u32>,
    pub failed: Vec<KillFailure>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum SortBy {
    Cpu,
    Memory,
    Name,
}
```

- [ ] **Step 6: Implement the classifier**

Append to `protected.rs` (above the `#[cfg(test)]`):
```rust
/// Apply `os`'s rules to a single process.
pub fn classify(os: Os, p: &RawProcess) -> bool {
    match os {
        Os::Macos => macos_rule(p),
        Os::Windows => windows_rule(p),
        Os::Linux => linux_rule(p),
    }
}

/// Apply the current platform's rules.
pub fn is_protected(p: &RawProcess) -> bool {
    #[cfg(target_os = "macos")]
    {
        classify(Os::Macos, p)
    }
    #[cfg(target_os = "windows")]
    {
        classify(Os::Windows, p)
    }
    #[cfg(target_os = "linux")]
    {
        classify(Os::Linux, p)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = p;
        false
    }
}

fn macos_rule(p: &RawProcess) -> bool {
    const CORE: &[&str] = &[
        "kernel_task", "launchd", "WindowServer", "loginwindow", "Dock", "Finder",
    ];
    if CORE.contains(&p.name.as_str()) {
        return true;
    }
    let root = p.owner == "root" || p.owner.is_empty();
    let sys_path = p.exe_path.starts_with("/System/")
        || p.exe_path.starts_with("/usr/libexec/")
        || p.exe_path.starts_with("/sbin/")
        || p.exe_path.starts_with("/usr/sbin/");
    root && sys_path
}

fn windows_rule(p: &RawProcess) -> bool {
    const CORE: &[&str] = &[
        "System", "smss.exe", "csrss.exe", "wininit.exe", "services.exe",
        "lsass.exe", "winlogon.exe",
    ];
    let name = p.name.to_ascii_lowercase();
    CORE.iter().any(|c| c.to_ascii_lowercase() == name)
        || (p.owner.eq_ignore_ascii_case("SYSTEM") && p.exe_path.to_ascii_lowercase().contains("\\windows\\system32"))
}

fn linux_rule(p: &RawProcess) -> bool {
    if p.pid == 1 {
        return true; // init / systemd
    }
    if p.parent_pid == Some(2) || p.pid == 2 {
        return true; // kernel threads (kthreadd is pid 2)
    }
    let root = p.owner == "root" || p.owner.is_empty();
    root && (p.exe_path.starts_with("/usr/sbin/") || p.exe_path.starts_with("/sbin/"))
}
```

- [ ] **Step 7: Run tests, expect pass**

Run: `cargo test process_manager::protected`
Expected: PASS (5 tests).

- [ ] **Step 8: Checkpoint** — report to user (GIT BAN: do not commit). Summarize: types + classifier landed, tests green.

---

## Task 2: App grouping + filter + sort (pure)

**Files:**
- Modify: `asyar-launcher/src-tauri/src/process_manager/grouping.rs` (replace the Task-1 stub)
- Test: same file (`#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `types::{RawProcess, AppGroup, ProcessInfo, SortBy}`, `protected::{Os, classify}`.
- Produces: `grouping::{app_name_for(os, &RawProcess) -> String, group(os, &[RawProcess]) -> Vec<AppGroup>, filter_groups(Vec<AppGroup>, &str) -> Vec<AppGroup>, sort_groups(&mut Vec<AppGroup>, SortBy)}`.

- [ ] **Step 1: Write the failing tests**

`grouping.rs`:
```rust
//! Pure transforms: raw processes → grouped/filtered/sorted AppGroups.

use crate::process_manager::protected::{classify, Os};
use crate::process_manager::types::{AppGroup, ProcessInfo, RawProcess, SortBy};
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;

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
            raw(1, "Google Chrome", &format!("{base}/MacOS/Google Chrome"), 10.0, 100),
            raw(2, "Google Chrome Helper", &format!("{base}/Frameworks/.../Google Chrome Helper"), 5.0, 50),
            raw(3, "Google Chrome Helper (GPU)", &format!("{base}/Frameworks/.../Helper (GPU)"), 2.0, 25),
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
        assert_eq!(g.iter().map(|x| x.app_name.clone()).collect::<Vec<_>>(), ["b", "c", "a"]);
        sort_groups(&mut g, SortBy::Name);
        assert_eq!(g.iter().map(|x| x.app_name.clone()).collect::<Vec<_>>(), ["a", "b", "c"]);
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
```

- [ ] **Step 2: Run, watch fail**

Run: `cargo test process_manager::grouping`
Expected: FAIL — `group`, `filter_groups`, `sort_groups`, `app_name_for` not found.

- [ ] **Step 3: Implement the transforms**

Append to `grouping.rs` (above `#[cfg(test)]`):
```rust
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
        SortBy::Memory => groups.sort_by(|a, b| b.total_memory_bytes.cmp(&a.total_memory_bytes)),
        SortBy::Name => groups.sort_by(|a, b| a.app_name.to_lowercase().cmp(&b.app_name.to_lowercase())),
    }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cargo test process_manager::grouping`
Expected: PASS (6 tests).

- [ ] **Step 5: Checkpoint** — report to user (no commit).

---

## Task 3: List orchestration + live enumeration

**Files:**
- Modify: `asyar-launcher/src-tauri/src/process_manager/mod.rs`

**Interfaces:**
- Consumes: `grouping::*`, `protected::Os`, `types::*`.
- Produces: `process_manager::list_from_raw(Vec<RawProcess>, Os, query: &str, SortBy) -> Vec<AppGroup>` (pure); `process_manager::list(query: &str, SortBy) -> Vec<AppGroup>` (live).

- [ ] **Step 1: Write the failing test**

In `mod.rs` add:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::process_manager::protected::Os;
    use crate::process_manager::types::{RawProcess, SortBy};

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
}
```

- [ ] **Step 2: Run, watch fail**

Run: `cargo test process_manager::tests::list_from_raw_filters_then_sorts`
Expected: FAIL — `list_from_raw` not found.

- [ ] **Step 3: Implement orchestration + live enumeration**

Add to `mod.rs` (below the `pub mod` lines, above `#[cfg(test)]`):
```rust
use crate::process_manager::grouping::{filter_groups, group, sort_groups};
use crate::process_manager::protected::{is_protected, Os};
use crate::process_manager::types::{AppGroup, RawProcess, SortBy};

#[cfg(target_os = "macos")]
const CURRENT_OS: Os = Os::Macos;
#[cfg(target_os = "windows")]
const CURRENT_OS: Os = Os::Windows;
#[cfg(any(
    target_os = "linux",
    not(any(target_os = "macos", target_os = "windows"))
))]
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

fn enumerate() -> Vec<RawProcess> {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System, Users};
    let mut sys = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::everything()),
    );
    // Two refreshes give sysinfo a delta window for accurate CPU%.
    sys.refresh_processes();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_processes();

    let users = Users::new_with_refreshed_list();
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
                name: p.name().to_string(),
                cpu_percent: p.cpu_usage(),
                memory_bytes: p.memory(),
                exe_path: p.exe().map(|e| e.to_string_lossy().to_string()).unwrap_or_default(),
                owner,
            }
        })
        .collect()
}

/// Look up whether a single pid is currently a protected process (used by
/// `kill` to enforce the guardrail server-side).
pub fn pid_is_protected(pid: u32) -> bool {
    enumerate().into_iter().find(|p| p.pid == pid).map(|p| is_protected(&p)).unwrap_or(false)
}
```

> NOTE: `sysinfo` 0.31 APIs (`refresh_processes`, `MINIMUM_CPU_UPDATE_INTERVAL`, `Users::new_with_refreshed_list`, `pid().as_u32()`). If a method name differs in the resolved patch version, fetch the exact API via Context7 (`/guillaumegomez/sysinfo`) and adjust — do not guess.

- [ ] **Step 4: Run, expect pass**

Run: `cargo test process_manager`
Expected: PASS (all process_manager tests).

- [ ] **Step 5: Checkpoint** — report to user (no commit).

---

## Task 4: Kill engine (guardrail-enforced, pure + live)

**Files:**
- Modify: `asyar-launcher/src-tauri/src/process_manager/mod.rs`

**Interfaces:**
- Consumes: `types::{KillResult, KillFailure}`.
- Produces: `process_manager::{ProcessKiller (trait), SysinfoKiller, KillTarget, kill_all(&dyn ProcessKiller, &[KillTarget], force: bool, confirmed_protected: bool) -> KillResult, kill(pids: Vec<u32>, force: bool, confirmed_protected: bool) -> KillResult}`.

- [ ] **Step 1: Write the failing test**

Add to `mod.rs` `#[cfg(test)] mod tests`:
```rust
    use std::cell::RefCell;

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
```

- [ ] **Step 2: Run, watch fail**

Run: `cargo test process_manager::tests`
Expected: FAIL — `ProcessKiller`, `kill_all`, `KillTarget` not found.

- [ ] **Step 3: Implement the kill engine**

Add to `mod.rs` (above `#[cfg(test)]`):
```rust
use crate::process_manager::types::{KillFailure, KillResult};

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
        let proc = sys.process(Pid::from_u32(pid)).ok_or_else(|| format!("process {pid} not found"))?;
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

/// Live kill: re-derive `protected` per pid from a fresh snapshot (never trust
/// the client), then enforce + kill.
pub fn kill(pids: Vec<u32>, force: bool, confirmed_protected: bool) -> KillResult {
    let targets: Vec<KillTarget> = pids
        .into_iter()
        .map(|pid| KillTarget { pid, protected: pid_is_protected(pid) })
        .collect();
    kill_all(&SysinfoKiller, &targets, force, confirmed_protected)
}
```

> NOTE: `sysinfo::Process::kill_with` returns `Option<bool>` (None when the signal isn't supported on the platform — fall back to `kill()`). Confirm in the resolved version via Context7 if the signature differs.

- [ ] **Step 4: Run, expect pass**

Run: `cargo test process_manager`
Expected: PASS (all process_manager tests, incl. 4 new kill tests).

- [ ] **Step 5: Checkpoint** — report to user (no commit).

---

## Task 5: Tauri command layer + wiring

**Files:**
- Create: `asyar-launcher/src-tauri/src/commands/process.rs`
- Modify: `asyar-launcher/src-tauri/src/commands/mod.rs` (add `pub mod process;` — match existing pattern)
- Modify: `asyar-launcher/src-tauri/src/lib.rs` (register `commands::process::process_list`, `commands::process::process_kill` in `invoke_handler`)
- Modify: `asyar-launcher/src-tauri/src/permissions.rs` (add two `get_required_permission` arms + a test)

**Interfaces:**
- Consumes: `process_manager::{list, kill}`, `types::{AppGroup, KillResult, SortBy}`, `permissions::ExtensionPermissionRegistry`.
- Produces: Tauri commands `process_list(extension_id, query, sort_by) -> Vec<AppGroup>`, `process_kill(extension_id, pids, force, confirmed_protected) -> KillResult`.

- [ ] **Step 1: Write the failing command tests**

`commands/process.rs`:
```rust
//! Tauri command layer for the process service. Thin wrappers over
//! `process_manager`, gated by the extension permission registry.

use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use crate::process_manager::types::{AppGroup, KillResult, SortBy};
use tauri::State;

const READ_PERMISSION: &str = "process:read";
const KILL_PERMISSION: &str = "process:kill";

#[tauri::command]
pub fn process_list(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    query: Option<String>,
    sort_by: SortBy,
) -> Result<Vec<AppGroup>, AppError> {
    process_list_inner(&permissions, extension_id, query, sort_by)
}

#[tauri::command]
pub fn process_kill(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    pids: Vec<u32>,
    force: bool,
    confirmed_protected: bool,
) -> Result<KillResult, AppError> {
    process_kill_inner(&permissions, extension_id, pids, force, confirmed_protected)
}

pub(crate) fn process_list_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    query: Option<String>,
    sort_by: SortBy,
) -> Result<Vec<AppGroup>, AppError> {
    permissions.check(&extension_id, READ_PERMISSION)?;
    Ok(crate::process_manager::list(query.as_deref().unwrap_or(""), sort_by))
}

pub(crate) fn process_kill_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    pids: Vec<u32>,
    force: bool,
    confirmed_protected: bool,
) -> Result<KillResult, AppError> {
    permissions.check(&extension_id, KILL_PERMISSION)?;
    Ok(crate::process_manager::kill(pids, force, confirmed_protected))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn perms_with(ext: &str, perm: &str) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let mut inner = reg.inner.lock().unwrap();
        let mut set = HashSet::new();
        set.insert(perm.to_string());
        inner.insert(ext.to_string(), set);
        drop(inner);
        reg
    }

    #[test]
    fn list_without_permission_is_rejected() {
        let perms = ExtensionPermissionRegistry::new();
        let err = process_list_inner(&perms, Some("ext-a".into()), None, SortBy::Cpu).unwrap_err();
        assert!(matches!(err, AppError::Permission(_)));
    }

    #[test]
    fn kill_without_permission_is_rejected() {
        let perms = perms_with("ext-a", "process:read"); // has read, not kill
        let err = process_kill_inner(&perms, Some("ext-a".into()), vec![1], false, false).unwrap_err();
        assert!(matches!(err, AppError::Permission(_)));
    }

    #[test]
    fn kill_empty_pid_list_is_allowed_and_noop() {
        let perms = perms_with("ext-a", "process:kill");
        let res = process_kill_inner(&perms, Some("ext-a".into()), vec![], false, false).unwrap();
        assert!(res.killed.is_empty() && res.failed.is_empty());
    }
}
```

- [ ] **Step 2: Run, watch fail**

Run: `cargo test commands::process`
Expected: FAIL — module not registered (`commands/mod.rs` lacks `pub mod process;`).

- [ ] **Step 3: Register the module + commands + gate**

1. In `commands/mod.rs`, add `pub mod process;` (alphabetical with siblings).
2. In `lib.rs` `invoke_handler![...]`, add next to the `power_*` commands:
```rust
            commands::process::process_list,
            commands::process::process_kill,
```
3. In `permissions.rs` `get_required_permission`, add after the `power:*` arms:
```rust
        "asyar:api:process:list" => Some("process:read"),
        "asyar:api:process:kill" => Some("process:kill"),
```
4. In `permissions.rs` tests, add:
```rust
    #[test]
    fn test_get_required_permission_process() {
        assert_eq!(get_required_permission("asyar:api:process:list"), Some("process:read"));
        assert_eq!(get_required_permission("asyar:api:process:kill"), Some("process:kill"));
    }
```

- [ ] **Step 4: Run, expect pass**

Run: `cargo test commands::process && cargo test permissions::`
Expected: PASS.

- [ ] **Step 5: Full Rust gate**

Run: `cargo clean && cargo clippy --all-targets -- -D warnings`
Expected: no warnings. (`cargo clean` first per the stale-incremental gotcha.)

- [ ] **Step 6: Checkpoint** — report to user (no commit). Note: this completes the Rust backend.

---

## Task 6: SDK — interface, proxy, namespace, bags

**Files:**
- Create: `asyar-sdk/src/services/IProcessService.ts`
- Create: `asyar-sdk/src/services/ProcessServiceProxy.ts`
- Create: `asyar-sdk/src/services/ProcessServiceProxy.test.ts`
- Modify: `asyar-sdk/src/services/index.ts` (export proxy)
- Modify: `asyar-sdk/src/ipc/namespaces.ts` (add `'process'`)
- Modify: `asyar-sdk/src/ExtensionContext.ts` (view bag: `process: new ProcessServiceProxy()`)
- Modify: `asyar-sdk/src/worker.ts` (worker bag: `process: new ProcessServiceProxy()`)

**Interfaces:**
- Produces: `IProcessService`, `AppGroup`, `ProcessInfo`, `KillResult`, `ProcessSortBy`, `ProcessServiceProxy`.

- [ ] **Step 1: Write the failing proxy test** (mirror `PowerServiceProxy.test.ts`)

`ProcessServiceProxy.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessServiceProxy } from './ProcessServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

describe('ProcessServiceProxy', () => {
  let proxy: ProcessServiceProxy;
  beforeEach(() => {
    proxy = new ProcessServiceProxy();
    proxy.setExtensionId('ext-test');
  });

  it('list() invokes process:list with query + sortBy', async () => {
    const spy = vi.spyOn(messageBroker, 'invoke').mockResolvedValue([]);
    await proxy.list({ query: 'chrome', sortBy: 'cpu' });
    expect(spy).toHaveBeenCalledWith('process:list', { query: 'chrome', sortBy: 'cpu' }, 'ext-test', undefined);
  });

  it('kill() invokes process:kill with pids/force/confirmedProtected', async () => {
    const spy = vi.spyOn(messageBroker, 'invoke').mockResolvedValue({ killed: [1], failed: [] });
    await proxy.kill({ pids: [1, 2], force: true, confirmedProtected: false });
    expect(spy).toHaveBeenCalledWith(
      'process:kill',
      { pids: [1, 2], force: true, confirmedProtected: false },
      'ext-test',
      undefined,
    );
  });
});
```

> NOTE: the 3rd/4th args (`'ext-test'`, `undefined`) come from the `setExtensionId` invoke-patch in `BaseServiceProxy`. Confirm the exact assertion shape against `PowerServiceProxy.test.ts` and match it.

- [ ] **Step 2: Run, watch fail**

Run: `pnpm --filter asyar-sdk test ProcessServiceProxy`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the interface + proxy**

`IProcessService.ts`:
```typescript
export type ProcessSortBy = 'cpu' | 'memory' | 'name';

export interface ProcessInfo {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryBytes: number;
  path: string;
  owner: string;
  protected: boolean;
}

export interface AppGroup {
  appName: string;
  icon?: string | null;
  owner: string;
  totalCpu: number;
  totalMemoryBytes: number;
  processCount: number;
  protected: boolean;
  children: ProcessInfo[];
}

export interface KillFailure {
  pid: number;
  error: string;
}

export interface KillResult {
  killed: number[];
  failed: KillFailure[];
}

export interface ListProcessesOptions {
  query?: string;
  sortBy: ProcessSortBy;
}

export interface KillProcessesOptions {
  /** App-group kill = all child pids. */
  pids: number[];
  /** true → SIGKILL; false → graceful (SIGTERM / TerminateProcess). */
  force: boolean;
  /** Must be true to kill a process the host flagged `protected`. */
  confirmedProtected?: boolean;
}

/**
 * Lists and kills OS processes. Requires `process:read` (list) and
 * `process:kill` (kill) manifest permissions. The host re-derives the
 * protected flag from a live snapshot and refuses protected kills unless
 * `confirmedProtected` is true.
 */
export interface IProcessService {
  list(options: ListProcessesOptions): Promise<AppGroup[]>;
  kill(options: KillProcessesOptions): Promise<KillResult>;
}
```

`ProcessServiceProxy.ts`:
```typescript
import type {
  IProcessService,
  AppGroup,
  KillResult,
  ListProcessesOptions,
  KillProcessesOptions,
} from './IProcessService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK proxy for the host process service. The IPC router injects the calling
 * extension's id; the host gates `process:read` / `process:kill`.
 */
export class ProcessServiceProxy extends BaseServiceProxy implements IProcessService {
  async list(options: ListProcessesOptions): Promise<AppGroup[]> {
    return this.broker.invoke<AppGroup[]>('process:list', {
      query: options.query,
      sortBy: options.sortBy,
    });
  }

  async kill(options: KillProcessesOptions): Promise<KillResult> {
    return this.broker.invoke<KillResult>('process:kill', {
      pids: options.pids,
      force: options.force,
      confirmedProtected: options.confirmedProtected ?? false,
    });
  }
}
```

- [ ] **Step 4: Wire the namespace, exports, and both bags**

1. `ipc/namespaces.ts`: add `'process',` to the `NAMESPACES` array (e.g. after `'power'`).
2. `services/index.ts`: add `export { ProcessServiceProxy } from './ProcessServiceProxy';` and `export type { IProcessService, AppGroup, ProcessInfo, KillResult, ProcessSortBy } from './IProcessService';` (match how `IPowerService` types are re-exported, if they are).
3. `ExtensionContext.ts`: import `ProcessServiceProxy`, add `process: new ProcessServiceProxy(),` to the view proxy bag (next to `power:`).
4. `worker.ts`: same import + `process: new ProcessServiceProxy(),` in the worker bag.
5. Ensure `contracts.ts` re-exports the new types if extensions import them from `asyar-sdk/contracts` (grep how `IPowerService` is surfaced in `contracts.ts` and mirror it).

- [ ] **Step 5: Run, expect pass**

Run: `pnpm --filter asyar-sdk test`
Expected: PASS (new proxy test + existing suite green).

- [ ] **Step 6: Checkpoint** — report to user (no commit). **Do NOT bump the SDK version.**

---

## Task 7: Host service + registry + router + JS gate mirror

**Files:**
- Create: `asyar-launcher/src/services/process/processService.ts`
- Create: `asyar-launcher/src/services/process/processService.test.ts`
- Modify: `asyar-launcher/src/services/extension/buildServiceRegistry.ts` (`process: processService`)
- Modify: `asyar-launcher/src/services/extension/ExtensionIpcRouter.ts` (add `'process'` to `INJECTS_EXTENSION_ID`)
- Modify: `asyar-launcher/src/services/permissionGate.ts` (map two type strings)
- Modify: `asyar-launcher/src/services/permissionGate.test.ts` (assert the two map entries)

**Interfaces:**
- Consumes: SDK types (`AppGroup`, `KillResult` from `asyar-sdk/contracts`).
- Produces: `processService` with `list(extensionId, options)` / `kill(extensionId, options)` matching the router's auto-injected-id convention.

- [ ] **Step 1: Write the failing host-service test** (mirror `powerService.test.ts`)

`process/processService.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { processService } from './processService';

describe('processService', () => {
  beforeEach(() => invoke.mockReset());

  it('list forwards extensionId + camelCase args to process_list', async () => {
    invoke.mockResolvedValue([]);
    await processService.list('ext-a', { query: 'chrome', sortBy: 'cpu' });
    expect(invoke).toHaveBeenCalledWith('process_list', {
      extensionId: 'ext-a',
      query: 'chrome',
      sortBy: 'cpu',
    });
  });

  it('kill forwards args to process_kill', async () => {
    invoke.mockResolvedValue({ killed: [1], failed: [] });
    await processService.kill('ext-a', { pids: [1], force: false, confirmedProtected: true });
    expect(invoke).toHaveBeenCalledWith('process_kill', {
      extensionId: 'ext-a',
      pids: [1],
      force: false,
      confirmedProtected: true,
    });
  });
});
```

- [ ] **Step 2: Run, watch fail**

Run: `pnpm --filter asyar-launcher test processService`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the host service** (thin wrapper, object-literal style like `powerService`)

`process/processService.ts`:
```typescript
import { invoke } from '@tauri-apps/api/core';
import type { AppGroup, KillResult, ListProcessesOptions, KillProcessesOptions } from 'asyar-sdk/contracts';

/**
 * Host-side thin wrapper over the Rust `process_*` Tauri commands. The
 * ExtensionIpcRouter auto-injects the caller's `extensionId` as the first arg
 * (see `INJECTS_EXTENSION_ID`); privileged host calls pass `null`.
 */
export const processService = {
  async list(extensionId: string | null, options: ListProcessesOptions): Promise<AppGroup[]> {
    return invoke<AppGroup[]>('process_list', {
      extensionId,
      query: options.query,
      sortBy: options.sortBy,
    });
  },
  async kill(extensionId: string | null, options: KillProcessesOptions): Promise<KillResult> {
    return invoke<KillResult>('process_kill', {
      extensionId,
      pids: options.pids,
      force: options.force,
      confirmedProtected: options.confirmedProtected ?? false,
    });
  },
};
```

> NOTE: confirm `ListProcessesOptions`/`KillProcessesOptions` are exported from `asyar-sdk/contracts`; if not, add them to the contracts re-export in Task 6 Step 4.

- [ ] **Step 4: Wire registry, router injection, and JS gate mirror**

1. `buildServiceRegistry.ts`: `import { processService } from '../process/processService';` and add `process: processService,` (next to `power: powerService,`).
2. `ExtensionIpcRouter.ts`: add `'process'` to the `INJECTS_EXTENSION_ID` set.
3. `permissionGate.ts` `PERMISSION_MAP`: add
```typescript
  'asyar:api:process:list': 'process:read',
  'asyar:api:process:kill': 'process:kill',
```
4. `permissionGate.test.ts`: add an assertion that those two keys map to `process:read` / `process:kill` (match the existing power-entry test shape).

- [ ] **Step 5: Run, expect pass**

Run: `pnpm --filter asyar-launcher test processService permissionGate buildServiceRegistry`
Expected: PASS.

- [ ] **Step 6: Checkpoint** — report to user (no commit). The platform `process` service is now reachable end-to-end by any permitted extension.

---

## Task 8: Extension scaffold + manifest guard

**Files (all under `extensions/kill-process/`):**
- Create: `package.json`, `manifest.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `view.html`, `worker.html`
- Create: `src/worker.ts` (minimal), `src/manifest.test.ts`

**Interfaces:**
- Produces: a discoverable Tier 2 extension `org.asyar.kill-process` with one `view` command and the `process:read`/`process:kill` permissions.

> Copy `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `view.html`, `worker.html`, and `.gitignore` **verbatim** from `extensions/asyar-worldcup-extension/` — the build setup is identical (worker + view entries, Svelte plugin, css-only). Only the files below differ.

- [ ] **Step 1: Write `package.json`**
```json
{
  "name": "org.asyar.kill-process",
  "version": "1.0.0",
  "description": "List running processes by CPU or memory and (force) kill them, with guardrails for OS-critical processes.",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest",
    "test:run": "vitest run",
    "publish": "asyar publish",
    "link": "asyar link",
    "package": "npm run build && zip -r extension.zip dist manifest.json"
  },
  "dependencies": { "svelte": "^5.0.0" },
  "devDependencies": {
    "asyar-sdk": "workspace:*",
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
    "@types/rollup-plugin-css-only": "^3.1.2",
    "typescript": "^5.0.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0",
    "@vitest/coverage-v8": "^2.1.0",
    "rollup-plugin-css-only": "^4.5.2"
  },
  "optionalDependencies": { "@rollup/rollup-win32-arm64-msvc": "*" }
}
```

- [ ] **Step 2: Write `manifest.json`**
```json
{
  "id": "org.asyar.kill-process",
  "name": "Kill Process",
  "version": "1.0.0",
  "description": "Lists running processes by CPU or memory usage and (force) kills one. Cross-platform, with guardrails for OS-critical processes.",
  "author": "Asyar",
  "icon": "💀",
  "type": "extension",
  "asyarSdk": "^3.0.1",
  "background": { "main": "dist/worker.js" },
  "permissions": ["process:read", "process:kill"],
  "preferences": [
    { "name": "sortBy", "type": "dropdown", "title": "Default sort", "default": "cpu",
      "data": [
        { "value": "cpu", "title": "CPU usage" },
        { "value": "memory", "title": "Memory usage" },
        { "value": "name", "title": "Name" }
      ] },
    { "name": "autoRefreshMs", "type": "number", "title": "Auto-refresh interval (ms)", "default": 3000 },
    { "name": "showPid", "type": "checkbox", "title": "Show process IDs", "default": false },
    { "name": "showPath", "type": "checkbox", "title": "Show executable paths", "default": false },
    { "name": "skipConfirmation", "type": "checkbox", "title": "Skip confirmation for normal apps", "default": false },
    { "name": "closeAfterKill", "type": "checkbox", "title": "Close launcher after killing", "default": true }
  ],
  "commands": [
    { "id": "kill-process", "name": "Kill Process",
      "description": "Lists running processes by CPU or memory usage and (force) kills one",
      "icon": "💀", "mode": "view", "component": "KillProcessView" }
  ]
}
```

> `asyarSdk` value: match the version the other in-tree extensions declare (worldcup uses `^3.0.1`). Verify against the current `asyar-sdk/package.json` major and use the same string the other extensions use — do not bump anything.

- [ ] **Step 3: Write the failing manifest guard test**

`src/manifest.test.ts` (copy the structure of `asyar-worldcup-extension/src/manifest.test.ts`, then assert our specifics):
```typescript
import { describe, it, expect } from 'vitest';
import manifest from '../manifest.json';

const VALID_PREF_TYPES = ['textfield', 'password', 'number', 'checkbox', 'dropdown', 'appPicker', 'file', 'directory'];

describe('kill-process manifest', () => {
  it('declares the process permissions', () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(['process:read', 'process:kill']));
  });

  it('has a single view command named "Kill Process"', () => {
    expect(manifest.commands).toHaveLength(1);
    expect(manifest.commands[0]).toMatchObject({ id: 'kill-process', name: 'Kill Process', mode: 'view' });
  });

  it('every preference uses a valid PreferenceType', () => {
    for (const p of manifest.preferences) {
      expect(VALID_PREF_TYPES).toContain(p.type);
    }
  });

  it('dropdown defaults reference a real option value', () => {
    const sort = manifest.preferences.find((p: any) => p.name === 'sortBy') as any;
    expect(sort.data.map((o: any) => o.value)).toContain(sort.default);
  });
});
```

- [ ] **Step 4: Install + run, watch fail then pass**

Run: `cd /Users/khoshbin/develop/Asyar-Project && pnpm install` (picks up the new workspace package), then `pnpm --filter org.asyar.kill-process test manifest`
Expected: after writing the manifest the guard test PASSES. (If `pnpm install` reports a lockfile change, that's expected — the **user** commits the lockfile per the GIT BAN.)

- [ ] **Step 5: Write the minimal worker**

`src/worker.ts` (no background work — just register so the extension loads; mirror worldcup's worker shell but empty):
```typescript
import { ExtensionContext as WorkerExtensionContext, extensionBridge } from 'asyar-sdk/worker';
import type { Extension, ExtensionContext, ExtensionResult } from 'asyar-sdk/contracts';
import manifest from '../manifest.json';

const extensionId = resolveExtensionId();
const ctx = new WorkerExtensionContext();
ctx.setExtensionId(extensionId);

class KillProcessExt implements Extension {
  async initialize(_c: ExtensionContext): Promise<void> {}
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async executeCommand(_id: string, _args?: Record<string, unknown>): Promise<unknown> {
    return undefined;
  }
  async search(_query: string): Promise<ExtensionResult[]> {
    return [];
  }
}

extensionBridge.registerManifest(manifest as unknown as Parameters<typeof extensionBridge.registerManifest>[0]);
extensionBridge.registerExtensionImplementation(extensionId, new KillProcessExt());
window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId, role: 'worker' }, '*');

function resolveExtensionId(): string {
  const fallback = 'org.asyar.kill-process';
  if (window.location.hostname === 'localhost' || window.location.hostname === 'asyar-extension.localhost') {
    return window.location.pathname.split('/').filter(Boolean)[0] || fallback;
  }
  return window.location.hostname || fallback;
}
```

- [ ] **Step 6: Build to verify the scaffold compiles**

Run: `pnpm --filter org.asyar.kill-process build`
Expected: `dist/worker.js` + `dist/view.js` produced (view entry exists once Task 9 lands; if build needs `src/view.ts` first, do Step 5 of Task 9 then re-run). It's fine to defer the full build to Task 9.

- [ ] **Step 7: Checkpoint** — report to user (no commit).

---

## Task 9: Extension view — list, sort, expand, kill, guardrail confirm

**Files (under `extensions/kill-process/`):**
- Create: `src/lib/format.ts` + `src/lib/format.test.ts` (pure display helpers)
- Create: `src/view.ts` (mounts the Svelte view; copy worldcup's `view.ts` error-reporter + mount pattern)
- Create: `src/views/KillProcessView.svelte`

**Interfaces:**
- Consumes: `context.getService<IProcessService>('process')`, `AppGroup`/`ProcessInfo` types.
- Produces: the rendered "Kill Process" view.

- [ ] **Step 1: Write failing tests for the pure display helpers**

`src/lib/format.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { formatBytes, formatCpu } from './format';

describe('format', () => {
  it('formats bytes to human units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(2_576_980_377)).toBe('2.4 GB');
  });
  it('formats cpu percent to one decimal', () => {
    expect(formatCpu(58.234)).toBe('58.2%');
    expect(formatCpu(0)).toBe('0.0%');
  });
});
```

- [ ] **Step 2: Run, watch fail**

Run: `pnpm --filter org.asyar.kill-process test format`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

`src/lib/format.ts`:
```typescript
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return i === 0 ? `${value} B` : `${value.toFixed(1)} ${units[i]}`;
}

export function formatCpu(percent: number): string {
  return `${percent.toFixed(1)}%`;
}
```

- [ ] **Step 4: Run, expect pass**

Run: `pnpm --filter org.asyar.kill-process test format`
Expected: PASS.

- [ ] **Step 5: Write `src/view.ts`**

Copy `extensions/asyar-worldcup-extension/src/view.ts` verbatim, then: replace the views map with `{ KillProcessView }`, the fallback id with `org.asyar.kill-process`, and the default view name with `KillProcessView`. Keep the `window.addEventListener('error' | 'unhandledrejection')` on-screen reporter (per the worker-error gotcha — surface failures visibly).

- [ ] **Step 6: Write `KillProcessView.svelte`** (Svelte 5 runes; design-language tokens; actions in panel, key hints in bottom bar)

```svelte
<script lang="ts">
  import type { IProcessService, AppGroup } from 'asyar-sdk/contracts';
  import { formatBytes, formatCpu } from '../lib/format';

  type SortBy = 'cpu' | 'memory' | 'name';

  const { context } = $props<{ context: { getService: <T>(n: string) => T; preferences: { values?: Record<string, unknown> } } }>();
  const processSvc = context.getService<IProcessService>('process');

  let query = $state('');
  let sortBy = $state<SortBy>(((context.preferences?.values?.sortBy as SortBy) ?? 'cpu'));
  let groups = $state<AppGroup[]>([]);
  let expanded = $state<Set<string>>(new Set());
  let pending = $state<{ group: AppGroup; force: boolean } | null>(null);
  let error = $state<string | null>(null);

  const skipConfirm = () => context.preferences?.values?.skipConfirmation === true;
  const autoRefreshMs = () => Number(context.preferences?.values?.autoRefreshMs ?? 3000);

  async function reload() {
    try {
      groups = await processSvc.list({ query: query.trim() || undefined, sortBy });
      error = null;
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }

  // Initial load + query/sort changes re-query Rust (rust-first: no client filtering).
  $effect(() => {
    query; sortBy;
    void reload();
  });

  // Auto-refresh poll.
  $effect(() => {
    const ms = autoRefreshMs();
    if (!Number.isFinite(ms) || ms <= 0) return;
    const t = setInterval(() => void reload(), ms);
    return () => clearInterval(t);
  });

  function toggle(name: string) {
    const next = new Set(expanded);
    next.has(name) ? next.delete(name) : next.add(name);
    expanded = next;
  }

  function requestKill(group: AppGroup, force: boolean) {
    if (group.protected || !skipConfirm()) {
      pending = { group, force }; // protected ALWAYS confirms, ignoring skipConfirm
    } else {
      void doKill(group, force, false);
    }
  }

  async function doKill(group: AppGroup, force: boolean, confirmedProtected: boolean) {
    pending = null;
    try {
      const res = await processSvc.kill({
        pids: group.children.map((c) => c.pid),
        force,
        confirmedProtected,
      });
      if (res.failed.length) {
        error = `Failed to kill ${res.failed.length} process(es): ${res.failed[0].error}`;
      }
      await reload();
    } catch (e: any) {
      error = e?.message ?? String(e);
    }
  }
</script>

<div class="kp">
  <header class="kp-bar">
    <input class="kp-search" placeholder="Filter processes…" bind:value={query} autofocus />
    <select class="kp-sort" bind:value={sortBy}>
      <option value="cpu">CPU</option>
      <option value="memory">Memory</option>
      <option value="name">Name</option>
    </select>
  </header>

  {#if error}<p class="kp-error">{error}</p>{/if}

  <ul class="kp-list">
    {#each groups as g (g.appName)}
      <li class="kp-row" class:protected={g.protected}>
        <button class="kp-main" onclick={() => toggle(g.appName)}>
          <span class="kp-name">{g.protected ? '⚠ ' : ''}{g.appName}</span>
          <span class="kp-stat">{formatCpu(g.totalCpu)}</span>
          <span class="kp-stat">{formatBytes(g.totalMemoryBytes)}</span>
          <span class="kp-count">{g.processCount} {g.processCount === 1 ? 'proc' : 'procs'}</span>
        </button>
        {#if expanded.has(g.appName)}
          <ul class="kp-children">
            {#each g.children as c (c.pid)}
              <li class="kp-child">
                <span>{c.name}</span>
                {#if context.preferences?.values?.showPid}<span class="kp-pid">{c.pid}</span>{/if}
                <span class="kp-stat">{formatCpu(c.cpuPercent)}</span>
                <span class="kp-stat">{formatBytes(c.memoryBytes)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>

  <footer class="kp-hints">⏎ Kill · ⌘⏎ Force Kill · → Expand · ⌃R Refresh</footer>

  {#if pending}
    <div class="kp-confirm" role="dialog">
      <p>
        {pending.group.protected
          ? `⚠ "${pending.group.appName}" is a protected system process. Killing it can crash your session.`
          : `Kill "${pending.group.appName}" (${pending.group.processCount} process(es))?`}
      </p>
      <div class="kp-confirm-actions">
        <button onclick={() => doKill(pending!.group, pending!.force, pending!.group.protected)}>
          {pending.group.protected ? 'Kill anyway' : 'Kill'}
        </button>
        <button onclick={() => (pending = null)}>Cancel</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .kp { display: flex; flex-direction: column; height: 100%; color: var(--text-primary); }
  .kp-bar { display: flex; gap: var(--space-2); padding: var(--space-2); }
  .kp-search { flex: 1; padding: var(--space-2) var(--space-3); border-radius: var(--radius-md);
    border: 1px solid var(--border-color); background: var(--bg-tertiary); color: inherit; font: inherit; }
  .kp-search:focus { outline: none; box-shadow: var(--shadow-focus); }
  .kp-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
  .kp-main { display: grid; grid-template-columns: 1fr auto auto auto; gap: var(--space-3);
    width: 100%; padding: var(--space-2) var(--space-3); background: none; border: none; color: inherit;
    font: inherit; text-align: left; cursor: pointer; }
  .kp-main:hover { background: var(--bg-hover); }
  .kp-row.protected .kp-name { color: var(--color-warning, #e0a800); }
  .kp-stat { font-variant-numeric: tabular-nums; color: var(--text-secondary); }
  .kp-children { list-style: none; margin: 0; padding: 0 0 0 var(--space-5); }
  .kp-child { display: grid; grid-template-columns: 1fr auto auto auto; gap: var(--space-3);
    padding: var(--space-1) var(--space-3); color: var(--text-secondary); }
  .kp-hints { padding: var(--space-2) var(--space-3); border-top: 1px solid var(--border-color);
    color: var(--text-tertiary); font-size: var(--font-size-sm); }
  .kp-error { color: var(--color-error, #ff6b6b); padding: 0 var(--space-3); margin: var(--space-1) 0; }
  .kp-confirm { position: absolute; inset: 0; display: flex; flex-direction: column; gap: var(--space-3);
    align-items: center; justify-content: center; padding: var(--space-5);
    background: color-mix(in srgb, var(--bg-primary) 92%, transparent); text-align: center; }
  .kp-confirm-actions { display: flex; gap: var(--space-3); }
  .kp-confirm-actions button { padding: var(--space-2) var(--space-4); border-radius: var(--radius-md);
    border: 1px solid var(--border-color); background: var(--bg-tertiary); color: inherit; cursor: pointer; }
</style>
```

> NOTE: this view renders keyboard shortcuts in the footer but the actual key bindings (⏎ kill the highlighted row, ⌘⏎ force, → expand, ⌃R refresh, ↑/↓ navigation) must be wired via the launcher's keyboard/action system. Before implementing key handling, **invoke the `design-language` and `tech-versions` skills** and look at how `window-management/ManageView.svelte` and a worldcup view register actions (`actionService` / action panel) and handle keydown. Keep guidance text in the bottom bar, real buttons in the action panel — per the actions-panel convention. The confirm overlay above is a placeholder for the interaction; align it with the design-language modal/confirm pattern.

- [ ] **Step 7: Write the view behavior test**

`src/views/KillProcessView.test.ts` — use `@testing-library/svelte` if present in the worldcup setup; otherwise test the pure decision functions by extracting `shouldConfirm(group, skip)` into `src/lib/confirm.ts` and unit-testing it:
```typescript
import { describe, it, expect } from 'vitest';
import { shouldConfirm } from './confirm';

describe('shouldConfirm', () => {
  it('protected always confirms, even when skip is on', () => {
    expect(shouldConfirm({ protected: true } as any, true)).toBe(true);
  });
  it('normal app skips when skip is on', () => {
    expect(shouldConfirm({ protected: false } as any, true)).toBe(false);
  });
  it('normal app confirms when skip is off', () => {
    expect(shouldConfirm({ protected: false } as any, false)).toBe(true);
  });
});
```
Then extract `src/lib/confirm.ts`:
```typescript
import type { AppGroup } from 'asyar-sdk/contracts';
export function shouldConfirm(group: Pick<AppGroup, 'protected'>, skipConfirmation: boolean): boolean {
  return group.protected || !skipConfirmation;
}
```
and use `shouldConfirm(group, skipConfirm())` inside `requestKill`. This makes the guardrail logic unit-testable without mounting Svelte.

- [ ] **Step 8: Run extension tests + build**

Run: `pnpm --filter org.asyar.kill-process test && pnpm --filter org.asyar.kill-process build`
Expected: PASS; `dist/worker.js` + `dist/view.js` produced.

- [ ] **Step 9: Checkpoint** — report to user (no commit).

---

## Task 10: Docs + full-matrix verification + format

**Files:**
- Modify: `docs/reference/permissions.md` (document `process:read`, `process:kill`)
- Modify: `asyar-launcher/src/built-in-features/create-extension/ai-builder/capabilitySpec/capabilities.json` (add the two permissions so the AI builder knows them)

- [ ] **Step 1: Document the permissions** — add `process:read` ("List running processes grouped by app, with CPU/memory") and `process:kill` ("Terminate or force-kill processes; OS-critical processes require explicit confirmation") to `docs/reference/permissions.md`, matching the existing entry format. Add matching entries to `capabilities.json` (mirror how `power:inhibit` is listed there).

- [ ] **Step 2: Run the full CI matrix locally** (per run-CI-locally rule; CI green BEFORE formatting)
```bash
cd /Users/khoshbin/develop/Asyar-Project/asyar-launcher/src-tauri
cargo clean && cargo clippy --all-targets -- -D warnings
cargo test
cd /Users/khoshbin/develop/Asyar-Project
pnpm --filter asyar-sdk test
pnpm --filter asyar-launcher test
pnpm --filter org.asyar.kill-process test
```
Expected: all green. If any pre-existing failures appear unrelated to this work, note them to the user — do not "fix" unrelated tests.

- [ ] **Step 3: Format only the new/changed Rust leaf files** (per the no-crate-wide-fmt rule; AFTER CI green)
```bash
cd asyar-launcher/src-tauri
rustfmt --skip-children --edition 2021 \
  src/process_manager/types.rs \
  src/process_manager/protected.rs \
  src/process_manager/grouping.rs \
  src/commands/process.rs
```
Do **not** run `rustfmt` on `process_manager/mod.rs`, `lib.rs`, `commands/mod.rs`, or `permissions.rs` (mod files recurse / are shared). Hand-format the small edits you made to those.

- [ ] **Step 4: Re-run the gate after formatting**

Run: `cd asyar-launcher/src-tauri && cargo clippy --all-targets -- -D warnings && cargo test process_manager commands::process`
Expected: still green.

- [ ] **Step 5: Final checkpoint** — report to user: full matrix green, feature complete end-to-end. The user reviews and commits (GIT BAN). Mention the two remaining user-owned follow-ups: (a) `pnpm install` lockfile change to commit, (b) extracting `extensions/kill-process/` to its own repo + adding it to `setup.mjs` if it should ship as a dogfood extension.

---

## Self-Review (completed during planning)

- **Spec coverage:** grouped-by-app (Tasks 2–3) · dedicated view + "Kill Process" name (Tasks 8–9) · CPU/memory/name sort (Tasks 2,9) · graceful + force kill (Task 4) · smart guardrails / protected classifier (Tasks 1,4,9) · Raycast-parity preferences (Task 8) · `process` platform service + IPC + permissions (Tasks 5–7) · cross-platform (per-OS classifier, sysinfo) · tests at every layer. All spec sections map to a task.
- **Placeholder scan:** no TBD/TODO; every code step shows real code; key-binding wiring in Task 9 Step 6 explicitly defers to design-language/tech-versions skills with a concrete reference component (not a placeholder — a scoped sub-investigation).
- **Type consistency:** `AppGroup`/`ProcessInfo`/`KillResult`/`SortBy` names identical across Rust (camelCase serde), SDK, host service, and view. `process:read`/`process:kill` identical across Rust gate, JS mirror, manifest, docs. `confirmedProtected` consistent end-to-end.
- **Known version-sensitive spots:** `sysinfo` 0.31 API names (Tasks 3–4) — verify via Context7 `/guillaumegomez/sysinfo` if a method signature differs; do not guess.
