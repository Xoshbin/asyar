//! Apple Shortcuts via `/usr/bin/shortcuts`, spawned directly.

use crate::error::PlatformError;
use crate::shortcuts::{
    parse_shortcut_list, RunShortcutInput, ShortcutInfo, MAX_SHORTCUT_OUTPUT_BYTES,
};
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const SHORTCUTS_BIN: &str = "/usr/bin/shortcuts";
/// Only the start of stderr is kept for error messages.
const MAX_STDERR_BYTES: usize = 64 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(20);
/// Upper bound on one run. Keep at or above the SDK's `RUN_TIMEOUT_MS` so the
/// host never stops a run the caller is still waiting for; it also frees the
/// child and blocking-pool thread of a shortcut stuck on a prompt.
const RUN_DEADLINE: Duration = Duration::from_secs(300);

#[derive(Debug)]
struct Captured {
    success: bool,
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

pub fn list_shortcuts() -> Result<Vec<ShortcutInfo>, PlatformError> {
    let mut cmd = Command::new(SHORTCUTS_BIN);
    cmd.args(["list", "--show-identifiers"]);
    let out = run_capped(cmd, None)?;
    if !out.success {
        return Err(exit_error("list", &out));
    }
    Ok(parse_shortcut_list(&String::from_utf8_lossy(&out.stdout)))
}

/// Input is validated by the caller (`crate::shortcuts::run_shortcut`).
pub fn run_shortcut(input: RunShortcutInput) -> Result<String, PlatformError> {
    let text = input.input.filter(|t| !t.is_empty());
    let mut cmd = Command::new(SHORTCUTS_BIN);
    cmd.arg("run").arg(input.id_or_name.trim());
    if text.is_some() {
        cmd.args(["--input-path", "-"]);
    }
    let out = run_capped(cmd, text)?;
    if !out.success {
        return Err(exit_error("run", &out));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Run `cmd` to completion with stdout capped at [`MAX_SHORTCUT_OUTPUT_BYTES`].
/// A shortcut that emits more is killed and reported as an error, so a
/// media-producing shortcut cannot exhaust launcher memory.
fn run_capped(mut cmd: Command, stdin_text: Option<String>) -> Result<Captured, PlatformError> {
    cmd.stdin(if stdin_text.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| PlatformError::OsError(format!("Failed to run shortcuts: {e}")))?;

    // Every pipe gets its own thread so none can fill up and stall the child.
    let writer = stdin_text.and_then(|text| {
        child.stdin.take().map(|mut stdin| {
            std::thread::spawn(move || {
                // A shortcut may exit without reading its input; EPIPE is fine.
                let _ = stdin.write_all(text.as_bytes());
            })
        })
    });
    let exceeded = Arc::new(AtomicBool::new(false));
    let stdout = child
        .stdout
        .take()
        .map(|r| read_capped(r, MAX_SHORTCUT_OUTPUT_BYTES, Some(exceeded.clone())));
    let stderr = child
        .stderr
        .take()
        .map(|r| read_capped(r, MAX_STDERR_BYTES, None));

    let status = wait_or_kill(&mut child, &exceeded)?;
    if let Some(w) = writer {
        let _ = w.join();
    }
    let stdout = stdout.map(join_bytes).unwrap_or_default();
    let stderr = stderr.map(join_bytes).unwrap_or_default();

    if exceeded.load(Ordering::SeqCst) {
        return Err(PlatformError::OsError(format!(
            "Shortcut output exceeded {MAX_SHORTCUT_OUTPUT_BYTES} bytes and was stopped"
        )));
    }
    Ok(Captured {
        success: status.success(),
        code: status.code(),
        stdout,
        stderr,
    })
}

/// Wait for exit, killing the child as soon as a reader reports overflow.
fn wait_or_kill(
    child: &mut Child,
    exceeded: &AtomicBool,
) -> Result<std::process::ExitStatus, PlatformError> {
    let wait_err = |e| PlatformError::OsError(format!("Failed to wait for shortcuts: {e}"));
    let deadline = Instant::now() + RUN_DEADLINE;
    loop {
        if let Some(status) = child.try_wait().map_err(wait_err)? {
            return Ok(status);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(PlatformError::OsError(format!(
                "Shortcut did not finish within {} seconds and was stopped",
                RUN_DEADLINE.as_secs()
            )));
        }
        if exceeded.load(Ordering::SeqCst) {
            let _ = child.kill();
            return child.wait().map_err(wait_err);
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Keep the first `limit` bytes. Past that, stdout (`on_overflow` set) flags
/// overflow and stops reading; stderr just discards the rest so the child
/// never blocks on a full pipe.
fn read_capped<R: Read + Send + 'static>(
    reader: R,
    limit: usize,
    on_overflow: Option<Arc<AtomicBool>>,
) -> JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let mut reader = reader;
        let _ = (&mut reader).take(limit as u64).read_to_end(&mut buf);
        if buf.len() == limit {
            let mut probe = [0u8; 1];
            if matches!(reader.read(&mut probe), Ok(n) if n > 0) {
                match on_overflow {
                    Some(flag) => flag.store(true, Ordering::SeqCst),
                    None => {
                        let _ = std::io::copy(&mut reader, &mut std::io::sink());
                    }
                }
            }
        }
        buf
    })
}

fn join_bytes(h: JoinHandle<Vec<u8>>) -> Vec<u8> {
    h.join().unwrap_or_default()
}

fn exit_error(verb: &str, out: &Captured) -> PlatformError {
    let code = out
        .code
        .map_or_else(|| "signal".to_string(), |c| c.to_string());
    let stderr = String::from_utf8_lossy(&out.stderr);
    let stderr = stderr.trim();
    if stderr.is_empty() {
        PlatformError::OsError(format!("shortcuts {verb} exited with code {code}"))
    } else {
        PlatformError::OsError(format!(
            "shortcuts {verb} exited with code {code}: {stderr}"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sh(script: &str) -> Command {
        let mut c = Command::new("/bin/sh");
        c.args(["-c", script]);
        c
    }

    #[test]
    fn captures_stdout_and_pipes_stdin() {
        let out = run_capped(sh("cat"), Some("hello".into())).unwrap();
        assert!(out.success);
        assert_eq!(out.stdout, b"hello");
    }

    #[test]
    fn reports_exit_code_and_stderr() {
        let out = run_capped(sh("echo boom >&2; exit 3"), None).unwrap();
        assert!(!out.success);
        assert_eq!(out.code, Some(3));
        let msg = exit_error("run", &out).to_string();
        assert!(msg.contains("code 3") && msg.contains("boom"));
    }

    #[test]
    fn oversized_stdout_kills_the_child_and_errors() {
        // `yes` never exits on its own; only the cap can stop it.
        let err = run_capped(sh("yes"), None).unwrap_err();
        assert!(err.to_string().contains("exceeded"));
    }

    #[test]
    fn huge_stderr_is_truncated_not_fatal() {
        let out = run_capped(sh("head -c 300000 /dev/zero >&2"), None).unwrap();
        assert!(out.success);
        assert_eq!(out.stderr.len(), MAX_STDERR_BYTES);
    }
}
