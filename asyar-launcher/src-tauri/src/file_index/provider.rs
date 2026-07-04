//! Generic search-provider abstraction. The local index (`service.rs`)
//! answers every keystroke with bounded work; deep-search providers
//! (`deep/*`) answer one explicit user action by shelling out to an
//! OS-native search tool (Spotlight, Everything, plocate) that covers the
//! whole disk and file contents — something the local index deliberately
//! does not attempt. Both shapes go through this same trait so a future
//! provider (a cloud-drive search, a remote index) has a slot to plug into
//! without the caller needing a special case.

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderMode {
    /// Answers every keystroke; must obey the query engine's work budget.
    PerKeystroke,
    /// Answers one explicit user action; may take up to a few seconds.
    OnDemand,
}

pub trait FileSearchProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn mode(&self) -> ProviderMode;
}

/// An on-demand provider that shells out to a native search tool. Only
/// registered when `probe()` succeeds (the binary exists on this machine).
pub trait DeepProvider: FileSearchProvider {
    /// Cheap availability check, called once per process and cached.
    fn probe(&self) -> bool;
    /// Runs the search, returning at most `limit` paths. `query` reaches
    /// the child process as a single argv element — never through a shell
    /// — so arbitrary user input can never be interpreted as extra flags
    /// or command separators.
    fn search(&self, query: &str, limit: usize) -> Vec<PathBuf>;
}

/// Marker implementation proving the local index fits the same generic
/// interface as a deep provider — the query path itself lives in
/// `service.rs`/`query.rs`, not duplicated here.
pub struct LocalIndexProvider;

impl FileSearchProvider for LocalIndexProvider {
    fn id(&self) -> &'static str {
        "local"
    }

    fn mode(&self) -> ProviderMode {
        ProviderMode::PerKeystroke
    }
}

/// Runs `cmd`, capturing stdout, and kills the child if it hasn't finished
/// within `timeout`. Shared by every deep provider so the kill-on-timeout
/// behavior is implemented — and tested — exactly once.
pub fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Option<String> {
    use std::io::Read;
    use std::sync::mpsc;

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());
    let mut child = cmd.spawn().ok()?;
    let mut stdout = child.stdout.take()?;

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        let _ = tx.send(buf);
    });

    match rx.recv_timeout(timeout) {
        Ok(buf) => {
            let _ = child.wait();
            Some(buf)
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

/// Splits provider stdout into non-empty, trimmed path lines, capped at
/// `limit` — the shared contract every deep provider's output follows
/// ("one path per line").
pub fn parse_path_lines(stdout: &str, limit: usize) -> Vec<PathBuf> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .take(limit)
        .map(PathBuf::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_path_lines_trims_skips_blanks_and_caps_at_limit() {
        let stdout = "/a/one.txt\n\n  /a/two.txt  \n/a/three.txt\n";
        let paths = parse_path_lines(stdout, 2);
        assert_eq!(paths, vec![PathBuf::from("/a/one.txt"), PathBuf::from("/a/two.txt")]);
    }

    #[test]
    fn parse_path_lines_empty_input_yields_empty() {
        assert!(parse_path_lines("", 10).is_empty());
        assert!(parse_path_lines("\n\n\n", 10).is_empty());
    }

    #[test]
    fn local_index_provider_reports_per_keystroke_mode() {
        let p = LocalIndexProvider;
        assert_eq!(p.id(), "local");
        assert_eq!(p.mode(), ProviderMode::PerKeystroke);
    }

    #[cfg(unix)]
    #[test]
    fn run_with_timeout_returns_output_for_fast_command() {
        let mut cmd = Command::new("printf");
        cmd.arg("hello\nworld\n");
        let out = run_with_timeout(cmd, Duration::from_secs(3)).expect("fast command completes");
        assert_eq!(out.trim(), "hello\nworld");
    }

    #[cfg(unix)]
    #[test]
    fn run_with_timeout_kills_slow_command_and_returns_none() {
        let mut cmd = Command::new("sleep");
        cmd.arg("5");
        let start = std::time::Instant::now();
        let out = run_with_timeout(cmd, Duration::from_millis(200));
        assert!(out.is_none());
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "must not wait for the full sleep"
        );
    }
}
