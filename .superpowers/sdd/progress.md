# Kill Process — SDD Progress Ledger

Baseline (clean main): 1f761f96
No commits per GIT BAN; diffs are working-tree scoped.

Task 1: complete (types + protected classifier, 5 tests green, review clean)
Task 2: complete (grouping/filter/sort, 6 tests green, 11/11 module, review clean)
Task 3: complete (list_from_raw/list/enumerate/pid_is_protected; sysinfo 0.31.4 API fixes via Context7; 12/12 module tests, clippy clean, review clean)
Task 4: complete (kill engine + guardrail/anti-spoofing; fixed per-pid enumeration -> single snapshot via targets_from_snapshot; 17/17 tests, clippy clean, re-review clean)
Task 5: complete (Tauri commands process_list/process_kill, thin wrappers, gate process:read/process:kill enforced before work, get_required_permission arms; 3/3 + 55/55 tests, clippy --all-targets clean; single invoke_handler registration site; review clean)
Task 6: complete (SDK: process namespace, IProcessService, ProcessServiceProxy in both bags, contracts re-exports; 580 SDK tests, tsc+build clean, version 3.1.1 unchanged; 3 exact-membership tests legitimately updated; review clean)
Task 7: complete (host processService thin wrapper, registry process: key, INJECTS_EXTENSION_ID 'process', PERMISSION_MAP mirror; 146 tests pass, zero new typecheck errors; review clean - security confirmed)
Task 8: complete (extension scaffold org.asyar.kill-process; manifest permissions+command+6 prefs all valid types; minimal worker; guard test 4/4 load-bearing; build deferred to Task 9; lockfile +35 for user to commit; review clean)
Task 9: complete (view: rust-first list, protected guardrail unskippable, Svelte5 runes, action panel via registerActionHandler; format+confirm pure helpers; 9/9 tests, build emits worker+view, tsc clean; OPEN: closeAfterKill pref unconsumed - awaiting human decision; review approved)
Task 9.5: complete (SDK ExtensionContext.hideLauncher() view-only, ungated UI affordance wrapping asyar:window:hide; closeAfterKill wired - fires on success+default-true; 581 SDK tests, ext 9/9, both dist build, version 3.1.1; review clean)
Task 9: COMPLETE (closeAfterKill resolved via 9.5)
Task 10: complete (docs process:read/process:kill in permissions.md + capabilities.json; fixed capabilities.test.ts + SDK CLI manifest.ts VALID_PERMISSIONS allowlist; FULL MATRIX GREEN: Rust 2272/2272+clippy, SDK 581, launcher 2705, ext 9; rustfmt scoped to 4 leaf files; review clean)
ALL TASKS COMPLETE — proceeding to final whole-branch review
C1 FIX: complete (action-id register-short/unregister-full; ids extracted to src/lib/actions.ts; manifest<->code seam regression test actions.test.ts; 12/12 ext tests, tsc clean, both dist build; re-review clean)
FINAL REVIEW: READY TO MERGE — all categories PASS (IPC contract, permission enforcement x6 sites, kill guardrail+anti-spoofing, rust-first, namespace/registry consistency); C1 resolved.
FEATURE COMPLETE. Uncommitted on main per GIT BAN. Full matrix green: Rust 2272 + clippy, SDK 581, launcher 2705, ext 12.

RUNTIME FIXES (post user-test):
  #1 host processService positional dispatch (router spreads Object.values(payload)) + regression test; processService 5/5.
  #2 in-view actions registerAction(EXTENSION_VIEW) not registerActionHandler+manifest CORE; manifest actions[] removed; guardrail preserved; ext 13/13.
  Re-review clean (no findings). Awaiting user re-test in running app.

KEYBOARD UX (post user-test round 2):
  - nav: ArrowUp/Down move selectedIndex over flatRows; Left/Right expand/collapse; scrollIntoView. Two keydown sources (host asyar:view:keydown + local iframe), mutually exclusive by focus.
  - kill keys: registerAction.shortcut is DISPLAY-ONLY; real keys bound in keydown via pure keyIntent → shared killSelected/reload (same fns as the ⌘K actions).
  - confirm-on-enter: while overlay open, Enter→confirmPending() (same doKill as the dialog button); arrows/refresh swallowed; Escape (local) cancels. Guardrail intact throughout.
  - tests 32/32; both dist build; tsc clean. All reviews clean.
FEATURE + KEYBOARD UX COMPLETE. Uncommitted on main per GIT BAN.
HOST SEARCH BAR: manifest searchable:true; removed local filter input; view reads asyar:view:search to drive query (tauri-docs pattern). Build emits both dist; 32/32 tests. (Edited directly — subagent hit session limit.)
