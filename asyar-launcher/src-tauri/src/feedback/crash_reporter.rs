use std::fs;
use std::path::{Path, PathBuf};

/// File names inside the app data dir.
pub const MARKER_FILE: &str = "running.marker";
pub const CRASH_FILE: &str = "last_crash.json";

pub fn marker_path(data_dir: &Path) -> PathBuf {
    data_dir.join(MARKER_FILE)
}

pub fn crash_file_path(data_dir: &Path) -> PathBuf {
    data_dir.join(CRASH_FILE)
}

/// A crash is inferred when the previous run left its marker behind.
pub fn crashed_last_run(marker_exists: bool) -> bool {
    marker_exists
}

/// Serialize panic info to the JSON we persist for next launch.
pub fn encode_crash(panic: &str, backtrace: &str) -> String {
    serde_json::json!({ "panic": panic, "backtrace": backtrace }).to_string()
}

pub fn write_marker(data_dir: &Path) {
    let _ = fs::write(marker_path(data_dir), b"1");
}

pub fn remove_marker(data_dir: &Path) {
    let _ = fs::remove_file(marker_path(data_dir));
}

pub fn read_and_clear_crash(data_dir: &Path) -> Option<(String, String)> {
    let path = crash_file_path(data_dir);
    let raw = fs::read_to_string(&path).ok()?;
    let _ = fs::remove_file(&path);
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    Some((
        v["panic"].as_str().unwrap_or_default().to_string(),
        v["backtrace"].as_str().unwrap_or_default().to_string(),
    ))
}

/// Install a panic hook that persists panic info next to the marker.
pub fn install_panic_hook(data_dir: PathBuf) {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = info.to_string();
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        let _ = fs::write(crash_file_path(&data_dir), encode_crash(&msg, &backtrace));
        default_hook(info);
    }));
}

/// Read the tail of the app log file.
pub fn read_log_tail(log_path: &Path, max_bytes: usize) -> String {
    use std::io::{Read, Seek, SeekFrom};
    // Only read the last `max_bytes` of the file — never slurp the whole log
    // into memory (it can grow large, and a crash report only needs the tail).
    let mut file = match fs::File::open(log_path) {
        Ok(f) => f,
        Err(_) => return String::new(),
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let seek_pos = len.saturating_sub(max_bytes as u64);
    if file.seek(SeekFrom::Start(seek_pos)).is_err() {
        return String::new();
    }
    let mut buf = Vec::new();
    if file.read_to_end(&mut buf).is_err() {
        return String::new();
    }
    // Seeking to a byte offset can land mid-UTF-8-char; lossy-decode, then snap
    // to a clean char boundary / size cap via the shared helper.
    super::trim_log_tail(&String::from_utf8_lossy(&buf), max_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn marker_path_is_under_data_dir() {
        let dir = PathBuf::from("/tmp/asyar");
        assert_eq!(marker_path(&dir), PathBuf::from("/tmp/asyar/running.marker"));
    }

    #[test]
    fn crashed_when_marker_present() {
        assert!(crashed_last_run(true));
        assert!(!crashed_last_run(false));
    }

    #[test]
    fn encodes_crash_as_json() {
        let s = encode_crash("oops", "frame0\nframe1");
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["panic"], "oops");
        assert_eq!(v["backtrace"], "frame0\nframe1");
    }
}
