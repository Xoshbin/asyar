use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::process::{ChildStdin, Command};
use tokio::sync::Mutex;
use tokio_util::codec::{FramedRead, LinesCodec};

pub const BUILDER_EVENT: &str = "asyar:ext-builder:event";

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
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    // Dev fallback (`tauri dev`): sidecars live at
    // `<manifest>/binaries/bun-<triple>` (with `.exe` on Windows).
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "bun-{}{}",
            env!("TARGET_TRIPLE"),
            if cfg!(windows) { ".exe" } else { "" }
        ));
    if dev.exists() {
        return Some(dev);
    }
    None
}

/// Locate the staged `ext-builder/sidecar.js` in the bundled resource dir.
/// The file is produced by `pnpm build:js` in asyar-ext-builder and staged into
/// `src-tauri/resources/ext-builder/sidecar.js` by build.rs at compile time.
fn resolve_sidecar_js<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("ext-builder").join("sidecar.js");
        if p.exists() && p.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            return Some(p);
        }
    }
    // Dev fallback (`tauri dev`): build.rs stages the bundle at
    // `<manifest>/resources/ext-builder/sidecar.js`.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("ext-builder")
        .join("sidecar.js");
    if dev.exists() && dev.metadata().map(|m| m.len() > 0).unwrap_or(false) {
        return Some(dev);
    }
    None
}

/// Locate the bundled `claude` runtime binary next to the exe or in the resource dir.
/// Mirrors `resolve_bun` — same search order, bare name `claude` (or `claude.exe` on Windows).
fn resolve_claude<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    let name = if cfg!(windows) { "claude.exe" } else { "claude" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(name);
            if p.exists() {
                return Some(p);
            }
        }
    }
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    // Dev fallback (`tauri dev`): sidecars live at
    // `<manifest>/binaries/claude-<triple>` (with `.exe` on Windows).
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "claude-{}{}",
            env!("TARGET_TRIPLE"),
            if cfg!(windows) { ".exe" } else { "" }
        ));
    if dev.exists() {
        return Some(dev);
    }
    None
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
    let bun = resolve_bun(&app)
        .ok_or_else(|| "bundled bun runtime not found".to_string())?;
    let sidecar_js = resolve_sidecar_js(&app)
        .ok_or_else(|| "ext-builder sidecar.js not found (run `pnpm build:js` in asyar-ext-builder)".to_string())?;

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
                    if line.contains("\"kind\":\"done\"") || line.contains("\"kind\":\"fail\"") {
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
