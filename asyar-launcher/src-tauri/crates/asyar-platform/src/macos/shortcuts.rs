//! Apple Shortcuts via `/usr/bin/shortcuts`, spawned directly.

use crate::error::PlatformError;
use crate::shortcuts::{parse_shortcut_list, RunShortcutInput, ShortcutInfo};
use std::io::Write;
use std::process::{Command, Stdio};

const SHORTCUTS_BIN: &str = "/usr/bin/shortcuts";

pub fn list_shortcuts() -> Result<Vec<ShortcutInfo>, PlatformError> {
    let output = Command::new(SHORTCUTS_BIN)
        .args(["list", "--show-identifiers"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| PlatformError::OsError(format!("Failed to run shortcuts: {e}")))?;
    if !output.status.success() {
        return Err(exit_error("list", &output));
    }
    Ok(parse_shortcut_list(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

/// Input is validated by the caller (`crate::shortcuts::run_shortcut`).
pub fn run_shortcut(input: RunShortcutInput) -> Result<String, PlatformError> {
    let text = input.input.filter(|t| !t.is_empty());
    let mut cmd = Command::new(SHORTCUTS_BIN);
    cmd.arg("run").arg(input.id_or_name.trim());
    if text.is_some() {
        cmd.args(["--input-path", "-"]);
    }
    cmd.stdin(if text.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| PlatformError::OsError(format!("Failed to run shortcuts: {e}")))?;

    // Feed stdin from its own thread so a shortcut that produces output
    // before draining its input cannot deadlock against `wait_with_output`.
    let writer = text.and_then(|text| {
        child.stdin.take().map(|mut stdin| {
            std::thread::spawn(move || {
                // A shortcut may exit without reading its input; EPIPE is fine.
                let _ = stdin.write_all(text.as_bytes());
            })
        })
    });
    let output = child
        .wait_with_output()
        .map_err(|e| PlatformError::OsError(format!("Failed to wait for shortcuts: {e}")))?;
    if let Some(w) = writer {
        let _ = w.join();
    }

    if !output.status.success() {
        return Err(exit_error("run", &output));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn exit_error(verb: &str, output: &std::process::Output) -> PlatformError {
    let code = output
        .status
        .code()
        .map_or_else(|| "signal".to_string(), |c| c.to_string());
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stderr = stderr.trim();
    if stderr.is_empty() {
        PlatformError::OsError(format!("shortcuts {verb} exited with code {code}"))
    } else {
        PlatformError::OsError(format!(
            "shortcuts {verb} exited with code {code}: {stderr}"
        ))
    }
}
