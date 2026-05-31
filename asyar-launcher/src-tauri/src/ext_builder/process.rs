use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime};
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

/// Locate the bundled `bun` runtime binary next to the exe or in the resource dir.
/// The ext-builder sidecar is a plain JS file executed by this `bun` runtime —
/// unlike a `bun --compile` binary, this allows the Agent SDK to spawn subprocess
/// `claude` and host its in-process MCP server.
fn resolve_bun<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
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
    resolve_first(&candidates, |p| p.exists())
}

/// Locate the staged `ext-builder/sidecar.js` in the bundled resource dir.
/// The file is produced by `pnpm build:js` in asyar-ext-builder and staged into
/// `src-tauri/resources/ext-builder/sidecar.js` by build.rs at compile time.
fn resolve_sidecar_js<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
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

/// Locate the bundled `claude` runtime binary next to the exe or in the resource dir.
/// Mirrors `resolve_bun` — same search order, bare name `claude` (or `claude.exe` on Windows).
fn resolve_claude<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
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
    resolve_first(&candidates, |p| p.exists())
}

/// Spawn the sidecar; stream stdout lines as Tauri events; store stdin for answers.
/// Runs as `bun <sidecar.js> --prompt ... --target-dir ... --capability-spec ...`
/// so the Agent SDK can spawn subprocess `claude` and host its in-process MCP server.
pub async fn spawn_build<R: Runtime>(
    app: AppHandle<R>,
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
}
