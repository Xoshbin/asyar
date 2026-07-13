use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::process::{ChildStdin, Command};
use tokio::sync::Mutex;
use tokio_util::codec::{FramedRead, LinesCodec};

pub const BUILDER_EVENT: &str = "asyar:ext-builder:event";

/// Build the ordered candidate paths for a bundled binary: next-to-exe first,
/// then the resource dir, then the `tauri dev` fallback. Missing dirs are
/// skipped. Pure + injectable so resolution priority is unit-testable.
fn binary_candidates(
    exe_dir: Option<&std::path::Path>,
    resource_dir: Option<&std::path::Path>,
    dev_path: PathBuf,
    name: &str,
) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(dir) = exe_dir {
        out.push(dir.join(name));
    }
    if let Some(dir) = resource_dir {
        out.push(dir.join(name));
    }
    out.push(dev_path);
    out
}

/// Build the ordered candidate paths for the staged `ext-builder/sidecar.js`:
/// resource dir first, then the `tauri dev` fallback.
fn sidecar_candidates(resource_dir: Option<&std::path::Path>, dev_path: PathBuf) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(dir) = resource_dir {
        out.push(dir.join("ext-builder").join("sidecar.js"));
    }
    out.push(dev_path);
    out
}

/// Return the first candidate that passes `accept`. Injectable acceptance test
/// so binaries (exists) and the sidecar (exists && non-empty) share one path.
fn resolve_first<F: Fn(&std::path::Path) -> bool>(
    candidates: &[PathBuf],
    accept: F,
) -> Option<PathBuf> {
    candidates.iter().find(|p| accept(p)).cloned()
}

/// Tries the exe/resource/dev candidates first (via `resolve_first`), and
/// only if none match, falls back to a caller-supplied runtime lookup.
/// Injectable so this priority ordering — bundled tiers before the
/// downloaded-runtime tier — is unit-testable without a real AppHandle.
fn resolve_first_or_runtime<F: Fn(&std::path::Path) -> bool>(
    candidates: &[PathBuf],
    accept: F,
    runtime_fallback: impl Fn() -> Option<PathBuf>,
) -> Option<PathBuf> {
    resolve_first(candidates, accept).or_else(runtime_fallback)
}

/// True when `line` is a terminal builder event (`kind` is `done` or `fail`).
/// Parses the JSON rather than substring-matching so a payload that merely
/// mentions the word in another field can't be mistaken for a terminal event.
fn is_terminal_event(line: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(line)
        .ok()
        .and_then(|v| {
            v.get("kind")
                .and_then(|k| k.as_str())
                .map(|s| s == "done" || s == "fail")
        })
        .unwrap_or(false)
}

/// Handle to a running build: lets us write answers/cancel to the sidecar stdin.
pub struct BuildHandle {
    stdin: BufWriter<ChildStdin>,
    child: tokio::process::Child,
}

#[derive(Default)]
pub struct ExtBuilderState {
    pub current: Arc<Mutex<Option<BuildHandle>>>,
}

/// Locate the bundled `bun` runtime binary next to the exe, in the resource
/// dir, or (last resort) via the on-demand `RuntimeManager` download tier.
/// The ext-builder sidecar is a plain JS file executed by this `bun` runtime —
/// unlike a `bun --compile` binary, this allows the Agent SDK to spawn subprocess
/// `claude` and host its in-process MCP server.
fn resolve_bun(app: &AppHandle) -> Option<std::path::PathBuf> {
    let name = if cfg!(windows) { "bun.exe" } else { "bun" };
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()));
    let resource_dir = app.path().resource_dir().ok();
    // Dev fallback (`tauri dev`): sidecars live at
    // `<manifest>/binaries/bun-<triple>` (with `.exe` on Windows).
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "bun-{}{}",
            env!("TARGET_TRIPLE"),
            if cfg!(windows) { ".exe" } else { "" }
        ));
    let candidates = binary_candidates(exe_dir.as_deref(), resource_dir.as_deref(), dev, name);
    resolve_first_or_runtime(
        &candidates,
        |p| p.exists(),
        || {
            app.try_state::<crate::runtimes::RuntimeManager>()
                .and_then(|rm| rm.resolve(app, "bun"))
        },
    )
}

/// Locate the staged `ext-builder/sidecar.js` in the bundled resource dir.
/// The file is produced by `pnpm build:js` in asyar-ext-builder and staged into
/// `src-tauri/resources/ext-builder/sidecar.js` by build.rs at compile time.
fn resolve_sidecar_js(app: &AppHandle) -> Option<std::path::PathBuf> {
    let resource_dir = app.path().resource_dir().ok();
    // Dev fallback (`tauri dev`): build.rs stages the bundle at
    // `<manifest>/resources/ext-builder/sidecar.js`.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("ext-builder")
        .join("sidecar.js");
    let candidates = sidecar_candidates(resource_dir.as_deref(), dev);
    resolve_first(&candidates, |p| {
        p.exists() && p.metadata().map(|m| m.len() > 0).unwrap_or(false)
    })
}

/// Locate the bundled `claude` runtime binary next to the exe, in the
/// resource dir, or (last resort) via the on-demand `RuntimeManager`
/// download tier. Mirrors `resolve_bun` — same search order, bare name
/// `claude` (or `claude.exe` on Windows).
fn resolve_claude(app: &AppHandle) -> Option<std::path::PathBuf> {
    let name = if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    };
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()));
    let resource_dir = app.path().resource_dir().ok();
    // Dev fallback (`tauri dev`): sidecars live at
    // `<manifest>/binaries/claude-<triple>` (with `.exe` on Windows).
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "claude-{}{}",
            env!("TARGET_TRIPLE"),
            if cfg!(windows) { ".exe" } else { "" }
        ));
    let candidates = binary_candidates(exe_dir.as_deref(), resource_dir.as_deref(), dev, name);
    resolve_first_or_runtime(
        &candidates,
        |p| p.exists(),
        || {
            app.try_state::<crate::runtimes::RuntimeManager>()
                .and_then(|rm| rm.resolve(app, "claude"))
        },
    )
}

// ── Combined pre-flight runtime check ───────────────────────────────────────
//
// Delegates to the shared `runtimes::missing_of_with` core (same "cheap
// local resolve, pay network cost only for what's actually missing"
// pattern used for an extension manifest's arbitrary `runtimes` list) —
// this module only supplies its own bundled-binary-tier resolve closures
// for the fixed `["bun", "claude"]` build-tool pair.

pub(crate) use crate::runtimes::{MissingRuntime, RuntimeSizeLookup};

/// Testable core: given already-resolved lookups for bun/claude and an
/// injected size lookup, returns the list of runtimes that still need
/// downloading. `size_lookup` is only ever consulted for a name whose
/// resolve closure returned `None` — never pay the network cost for a
/// runtime that's already resolvable.
pub(crate) async fn missing_runtimes_with(
    resolve_bun: impl Fn() -> Option<PathBuf>,
    resolve_claude: impl Fn() -> Option<PathBuf>,
    size_lookup: &dyn RuntimeSizeLookup,
) -> Result<Vec<MissingRuntime>, crate::error::AppError> {
    let names = vec!["bun".to_string(), "claude".to_string()];
    crate::runtimes::missing_of_with(
        &names,
        |name| match name {
            "bun" => resolve_bun(),
            "claude" => resolve_claude(),
            _ => None,
        },
        size_lookup,
    )
    .await
}

/// Production entry point: checks `resolve_bun`/`resolve_claude` (cheap, local,
/// includes the downloaded-runtime tier) and only for whichever is still
/// unresolved, makes a single `RuntimeManager::ensure` network call.
pub(crate) async fn missing_runtimes(
    app: &AppHandle,
    manager: &crate::runtimes::RuntimeManager,
) -> Result<Vec<MissingRuntime>, crate::error::AppError> {
    let lookup = crate::runtimes::RuntimeManagerSizeLookup { app, manager };
    missing_runtimes_with(|| resolve_bun(app), || resolve_claude(app), &lookup).await
}

/// Spawn the sidecar; stream stdout lines as Tauri events; store stdin for answers.
/// Runs as `bun <sidecar.js> --prompt ... --target-dir ... --capability-spec ...`
/// so the Agent SDK can spawn subprocess `claude` and host its in-process MCP server.
pub async fn spawn_build(
    app: AppHandle,
    state: Arc<Mutex<Option<BuildHandle>>>,
    prompt: String,
    target_dir: String,
    capability_spec_dir: String,
    anthropic_key: String,
) -> Result<(), String> {
    let bun = resolve_bun(&app).ok_or_else(|| "bundled bun runtime not found".to_string())?;
    let sidecar_js = resolve_sidecar_js(&app).ok_or_else(|| {
        "ext-builder sidecar.js not found (run `pnpm build:js` in asyar-ext-builder)".to_string()
    })?;

    let claude_path = resolve_claude(&app);
    if claude_path.is_none() {
        log::warn!("resolve_claude: bundled claude runtime not found; the build will fail at SDK binary resolution");
    }

    let mut cmd = Command::new(&bun);
    cmd.arg(&sidecar_js)
        .arg("--prompt")
        .arg(&prompt)
        .arg("--target-dir")
        .arg(&target_dir)
        .arg("--capability-spec")
        .arg(&capability_spec_dir)
        .env("ANTHROPIC_API_KEY", &anthropic_key);

    if let Some(ref claude) = claude_path {
        cmd.env("CLAUDE_CODE_EXECUTABLE_PATH", claude);
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;

    // Drain stderr in its own task so a full pipe buffer can't block the
    // sidecar; log lines so they're not silently lost.
    if let Some(stderr) = child.stderr.take() {
        tauri::async_runtime::spawn(async move {
            use futures_util::StreamExt;
            let mut err_lines =
                FramedRead::new(tokio::io::BufReader::new(stderr), LinesCodec::new());
            while let Some(Ok(line)) = err_lines.next().await {
                log::debug!("[ext-builder stderr] {line}");
            }
        });
    }

    let stdout = child.stdout.take().ok_or("no stdout")?;

    // Stream stdout lines -> frontend events.
    let app_for_stream = app.clone();
    tauri::async_runtime::spawn(async move {
        use futures_util::StreamExt;
        let mut lines = FramedRead::new(tokio::io::BufReader::new(stdout), LinesCodec::new());
        let mut terminal_seen = false;
        while let Some(next) = lines.next().await {
            match next {
                Ok(line) => {
                    if is_terminal_event(&line) {
                        terminal_seen = true;
                    }
                    // Forward the raw JSON line; the frontend parses it with parseSidecarEvent.
                    let _ = app_for_stream.emit(BUILDER_EVENT, line);
                }
                Err(_) => break,
            }
        }
        // Stdout closed: emit a terminal fail only if the job never reported a
        // terminal event, so a successful build doesn't fire a spurious failure.
        if !terminal_seen {
            let _ = app_for_stream.emit(
                BUILDER_EVENT,
                "{\"kind\":\"fail\",\"step\":\"process\",\"error\":\"builder exited\",\"log\":\"sidecar stdout closed\"}".to_string(),
            );
        }
    });

    let mut guard = state.lock().await;
    *guard = Some(BuildHandle {
        stdin: BufWriter::new(stdin),
        child,
    });
    Ok(())
}

// ── Command-layer decision logic (kept out of the #[tauri::command] body) ──

/// Outcome of the `ext_builder_start` command's core decision.
#[derive(Debug)]
pub(crate) enum StartOutcome {
    NeedsRuntimes(Vec<MissingRuntime>),
    Started,
}

/// Testable core of `ext_builder_start`: given an already-computed missing-
/// runtime list, either short-circuits with `NeedsRuntimes` (build state
/// untouched, nothing spawned) or kills any in-flight build and delegates to
/// `spawn`. `spawn` is injectable so tests never launch a real `bun`
/// subprocess — production passes a closure wrapping `spawn_build`.
///
/// Once both runtimes are confirmed resolvable (`missing` is empty),
/// registers `"builtin:ext-builder"` as a permanent consumer of both `bun`
/// and `claude` — there's no "uninstall the builder" event to release it
/// later, so once used, Settings should always warn before removing either
/// runtime. Registered here (decoupled from whether `spawn` itself
/// succeeds) rather than in `start_checking_runtimes_ensuring`, since
/// `RuntimeManager` needs no `AppHandle` and this keeps the registration
/// unit-testable without spawning a real subprocess.
pub(crate) async fn start_checking_runtimes<F, Fut>(
    state: Arc<Mutex<Option<BuildHandle>>>,
    missing: Vec<MissingRuntime>,
    runtime_manager: &crate::runtimes::RuntimeManager,
    spawn: F,
) -> Result<StartOutcome, String>
where
    F: FnOnce(Arc<Mutex<Option<BuildHandle>>>) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    if !missing.is_empty() {
        return Ok(StartOutcome::NeedsRuntimes(missing));
    }

    runtime_manager.add_consumer("bun", "builtin:ext-builder");
    runtime_manager.add_consumer("claude", "builtin:ext-builder");

    {
        let mut guard = state.lock().await;
        if let Some(h) = guard.as_mut() {
            h.kill().await;
        }
        *guard = None;
    }

    spawn(state).await?;
    Ok(StartOutcome::Started)
}

/// Production entry point for the `ext_builder_start` command: computes the
/// missing-runtime list (the one network-backed call) then delegates to
/// `start_checking_runtimes` with the real `spawn_build`. Business logic
/// lives here so the Tauri command body stays a thin wrapper.
pub(crate) async fn start_checking_runtimes_ensuring(
    app: AppHandle,
    runtime_manager: &crate::runtimes::RuntimeManager,
    state: Arc<Mutex<Option<BuildHandle>>>,
    prompt: String,
    target_dir: String,
    capability_spec_dir: String,
    anthropic_key: String,
) -> Result<StartOutcome, String> {
    let missing = missing_runtimes(&app, runtime_manager)
        .await
        .map_err(|e| e.to_string())?;
    start_checking_runtimes(state, missing, runtime_manager, move |state| {
        spawn_build(
            app,
            state,
            prompt,
            target_dir,
            capability_spec_dir,
            anthropic_key,
        )
    })
    .await
}

impl BuildHandle {
    pub async fn write_line(&mut self, line: &str) -> Result<(), String> {
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        self.stdin
            .write_all(b"\n")
            .await
            .map_err(|e| e.to_string())?;
        self.stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn kill(&mut self) {
        let _ = self.child.start_kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_first_returns_first_accepted_candidate() {
        let a = PathBuf::from("/exe/bun");
        let b = PathBuf::from("/resource/bun");
        let c = PathBuf::from("/dev/bun");
        let candidates = vec![a.clone(), b.clone(), c.clone()];
        // Only the resource + dev candidates "exist"; first existing wins.
        let got = resolve_first(&candidates, |p| p == b || p == c);
        assert_eq!(got, Some(b));
    }

    #[test]
    fn resolve_first_returns_none_when_nothing_accepted() {
        let candidates = vec![PathBuf::from("/x/bun"), PathBuf::from("/y/bun")];
        assert_eq!(resolve_first(&candidates, |_| false), None);
    }

    #[test]
    fn binary_candidates_are_ordered_exe_then_resource_then_dev() {
        let exe = PathBuf::from("/exe");
        let res = PathBuf::from("/res");
        let dev = PathBuf::from("/dev/bun-triple");
        let got = binary_candidates(Some(&exe), Some(&res), dev.clone(), "bun");
        assert_eq!(
            got,
            vec![PathBuf::from("/exe/bun"), PathBuf::from("/res/bun"), dev]
        );
    }

    #[test]
    fn binary_candidates_skip_missing_dirs() {
        let dev = PathBuf::from("/dev/bun-triple");
        // No exe dir, no resource dir: only the dev fallback remains.
        let got = binary_candidates(None, None, dev.clone(), "bun");
        assert_eq!(got, vec![dev]);
    }

    #[test]
    fn sidecar_candidates_are_ordered_resource_then_dev() {
        let res = PathBuf::from("/res");
        let dev = PathBuf::from("/dev/resources/ext-builder/sidecar.js");
        let got = sidecar_candidates(Some(&res), dev.clone());
        assert_eq!(
            got,
            vec![
                PathBuf::from("/res").join("ext-builder").join("sidecar.js"),
                dev
            ]
        );
    }

    #[test]
    fn is_terminal_event_true_for_done_and_fail() {
        assert!(is_terminal_event(r#"{"kind":"done","extensionId":"x"}"#));
        assert!(is_terminal_event(
            r#"{"kind":"fail","step":"build","error":"boom"}"#
        ));
    }

    #[test]
    fn is_terminal_event_false_for_progress_and_non_json() {
        assert!(!is_terminal_event(
            r#"{"kind":"step","label":"Scaffolding"}"#
        ));
        assert!(!is_terminal_event("not json at all"));
        assert!(!is_terminal_event(""));
    }

    #[test]
    fn is_terminal_event_ignores_done_mentioned_in_a_string_field() {
        // Substring matching on `"kind":"done"` would mis-fire here; JSON parsing
        // correctly reads kind = "log" and returns false.
        let line = r#"{"kind":"log","message":"emitted \"kind\":\"done\" earlier"}"#;
        assert!(!is_terminal_event(line));
    }

    #[test]
    fn clean_close_after_done_suppresses_synthetic_failure() {
        // The stdout loop sets terminal_seen via is_terminal_event; a clean close
        // then emits a synthetic failure only when no terminal event was seen.
        let lines = [
            r#"{"kind":"step","label":"Scaffolding"}"#,
            r#"{"kind":"done","extensionId":"x"}"#,
        ];
        let terminal_seen = lines.iter().any(|l| is_terminal_event(l));
        assert!(terminal_seen, "done event must mark the stream terminal");
        // The synthetic "builder exited" failure fires only when !terminal_seen.
        let emits_synthetic_failure = !terminal_seen;
        assert!(!emits_synthetic_failure);
    }

    #[test]
    fn clean_close_without_terminal_event_requires_synthetic_failure() {
        let lines = [r#"{"kind":"step","label":"Scaffolding"}"#];
        let terminal_seen = lines.iter().any(|l| is_terminal_event(l));
        assert!(!terminal_seen);
    }

    // ── RED: resolve_first_or_runtime doesn't exist yet — production
    // code must add it. The crate fails to compile until then; that is the
    // expected RED state for these three tests.

    #[test]
    fn resolve_first_or_runtime_falls_back_when_no_candidate_accepted() {
        let candidates = vec![PathBuf::from("/a/bun"), PathBuf::from("/b/bun")];
        let got = resolve_first_or_runtime(
            &candidates,
            |_| false,
            || Some(PathBuf::from("/runtimes/bun/1.2.0/bun")),
        );
        assert_eq!(got, Some(PathBuf::from("/runtimes/bun/1.2.0/bun")));
    }

    #[test]
    fn resolve_first_or_runtime_returns_none_when_fallback_also_none() {
        let candidates = vec![PathBuf::from("/a/bun")];
        let got = resolve_first_or_runtime(&candidates, |_| false, || None);
        assert_eq!(got, None);
    }

    #[test]
    fn resolve_first_or_runtime_never_calls_fallback_when_a_candidate_is_accepted() {
        let a = PathBuf::from("/a/bun");
        let b = PathBuf::from("/b/bun");
        let candidates = vec![a.clone(), b.clone()];
        let fallback_called = std::cell::Cell::new(false);
        let got = resolve_first_or_runtime(
            &candidates,
            |p| p == a,
            || {
                fallback_called.set(true);
                Some(PathBuf::from("/should/not/be/used"))
            },
        );
        assert_eq!(got, Some(a));
        assert!(
            !fallback_called.get(),
            "runtime_fallback must not be invoked when a bundled candidate resolves"
        );
    }

    // ── RED: MissingRuntime / RuntimeSizeLookup / missing_runtimes_with
    // don't exist yet — production code must add them. The crate fails to
    // compile until then; that is the expected RED state for these tests.

    struct RecordingSizeLookup {
        calls: std::sync::Mutex<Vec<String>>,
        sizes: std::collections::HashMap<&'static str, Option<u64>>,
    }

    impl RecordingSizeLookup {
        fn new(sizes: &[(&'static str, Option<u64>)]) -> Self {
            Self {
                calls: std::sync::Mutex::new(Vec::new()),
                sizes: sizes.iter().cloned().collect(),
            }
        }
    }

    #[async_trait::async_trait]
    impl super::RuntimeSizeLookup for RecordingSizeLookup {
        async fn needs_download(&self, name: &str) -> Result<Option<u64>, crate::error::AppError> {
            self.calls.lock().unwrap().push(name.to_string());
            Ok(self.sizes.get(name).copied().flatten())
        }
    }

    #[tokio::test]
    async fn missing_runtimes_with_reports_both_when_both_unresolved() {
        let lookup = RecordingSizeLookup::new(&[("bun", Some(10)), ("claude", Some(20))]);
        let result = missing_runtimes_with(|| None, || None, &lookup)
            .await
            .unwrap();
        assert_eq!(
            result,
            vec![
                MissingRuntime {
                    name: "bun".to_string(),
                    size_bytes: 10
                },
                MissingRuntime {
                    name: "claude".to_string(),
                    size_bytes: 20
                },
            ]
        );
    }

    #[tokio::test]
    async fn missing_runtimes_with_reports_only_the_unresolved_one() {
        let lookup = RecordingSizeLookup::new(&[("claude", Some(20))]);
        let result = missing_runtimes_with(|| Some(PathBuf::from("/bin/bun")), || None, &lookup)
            .await
            .unwrap();
        assert_eq!(
            result,
            vec![MissingRuntime {
                name: "claude".to_string(),
                size_bytes: 20
            }]
        );
    }

    #[tokio::test]
    async fn missing_runtimes_with_never_queries_size_lookup_when_both_resolved() {
        let lookup = RecordingSizeLookup::new(&[]);
        let result = missing_runtimes_with(
            || Some(PathBuf::from("/bin/bun")),
            || Some(PathBuf::from("/bin/claude")),
            &lookup,
        )
        .await
        .unwrap();
        assert_eq!(result, Vec::new());
        assert_eq!(
            lookup.calls.lock().unwrap().len(),
            0,
            "size lookup must never be consulted when nothing is missing"
        );
    }

    #[tokio::test]
    async fn missing_runtimes_with_excludes_a_name_the_size_lookup_reports_as_already_installed() {
        // resolve closure says missing, but the network-backed size lookup
        // finds it's actually already installed (Ok(None)) — must be excluded.
        let lookup = RecordingSizeLookup::new(&[("bun", None), ("claude", Some(5))]);
        let result = missing_runtimes_with(|| None, || None, &lookup)
            .await
            .unwrap();
        assert_eq!(
            result,
            vec![MissingRuntime {
                name: "claude".to_string(),
                size_bytes: 5
            }]
        );
    }

    // ── RED: StartOutcome / start_checking_runtimes don't exist yet —
    // production code must add them. The crate fails to compile until then;
    // that is the expected RED state for these two tests. `spawn` is
    // injected so neither test launches a real `bun` subprocess even though
    // this dev machine has real bundled binaries on disk.

    #[tokio::test]
    async fn start_checking_runtimes_short_circuits_when_missing_is_non_empty() {
        let state: Arc<Mutex<Option<BuildHandle>>> = Arc::new(Mutex::new(None));
        let runtime_manager = crate::runtimes::RuntimeManager::new();
        let missing = vec![MissingRuntime {
            name: "bun".to_string(),
            size_bytes: 10,
        }];
        let spawn_called = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let spawn_called_inner = spawn_called.clone();

        let outcome = start_checking_runtimes(
            state.clone(),
            missing.clone(),
            &runtime_manager,
            move |_state| {
                spawn_called_inner.store(true, std::sync::atomic::Ordering::SeqCst);
                async { Ok(()) }
            },
        )
        .await
        .expect("must produce a success-shaped outcome, not a hard error");

        match outcome {
            StartOutcome::NeedsRuntimes(got) => assert_eq!(got, missing),
            StartOutcome::Started => panic!("must not spawn when runtimes are missing"),
        }
        assert!(
            !spawn_called.load(std::sync::atomic::Ordering::SeqCst),
            "spawn must never be invoked when runtimes are missing"
        );
        assert!(
            state.lock().await.is_none(),
            "build state must be untouched when short-circuiting"
        );
    }

    #[tokio::test]
    async fn start_checking_runtimes_kills_old_handle_and_spawns_when_nothing_is_missing() {
        let state: Arc<Mutex<Option<BuildHandle>>> = Arc::new(Mutex::new(None));
        let runtime_manager = crate::runtimes::RuntimeManager::new();
        let spawn_called = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let spawn_called_inner = spawn_called.clone();

        let outcome = start_checking_runtimes(state, Vec::new(), &runtime_manager, move |_state| {
            spawn_called_inner.store(true, std::sync::atomic::Ordering::SeqCst);
            async { Ok(()) }
        })
        .await
        .expect("must succeed when nothing is missing");

        assert!(matches!(outcome, StartOutcome::Started));
        assert!(
            spawn_called.load(std::sync::atomic::Ordering::SeqCst),
            "spawn must be attempted when nothing is missing"
        );
    }

    // ── RED: once both runtimes resolve (missing is empty), the AI Extension
    // Builder must register "builtin:ext-builder" as a permanent consumer of
    // both bun and claude — there's no "uninstall the builder" lifecycle
    // event to release it later (by design: the builder can be reused, so
    // Settings should always warn before removing either runtime once it's
    // been used).

    #[tokio::test]
    async fn start_checking_runtimes_registers_builtin_ext_builder_consumer_for_bun_and_claude_when_nothing_missing(
    ) {
        let state: Arc<Mutex<Option<BuildHandle>>> = Arc::new(Mutex::new(None));
        let runtime_manager = crate::runtimes::RuntimeManager::new();

        let outcome =
            start_checking_runtimes(state, Vec::new(), &runtime_manager, |_state| async {
                Ok(())
            })
            .await
            .expect("must succeed when nothing is missing");

        assert!(matches!(outcome, StartOutcome::Started));
        assert_eq!(
            runtime_manager.consumers_of("bun"),
            vec!["builtin:ext-builder".to_string()]
        );
        assert_eq!(
            runtime_manager.consumers_of("claude"),
            vec!["builtin:ext-builder".to_string()]
        );
    }

    #[tokio::test]
    async fn start_checking_runtimes_does_not_register_consumer_when_runtimes_are_missing() {
        let state: Arc<Mutex<Option<BuildHandle>>> = Arc::new(Mutex::new(None));
        let runtime_manager = crate::runtimes::RuntimeManager::new();
        let missing = vec![MissingRuntime {
            name: "bun".to_string(),
            size_bytes: 10,
        }];

        let _ =
            start_checking_runtimes(state, missing, &runtime_manager, |_state| async { Ok(()) })
                .await;

        assert!(
            runtime_manager.consumers_of("bun").is_empty(),
            "must not register a consumer while short-circuiting on missing runtimes"
        );
        assert!(runtime_manager.consumers_of("claude").is_empty());
    }
}
