use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateSentinel {
    pub version: String,
}

/// Returns the path to pending_update.json in the app data directory.
pub fn sentinel_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    Ok(sentinel_path_for_dir(&dir))
}

/// Helper: returns the sentinel file path within a given directory.
/// Extracted for testability without a live AppHandle.
pub fn sentinel_path_for_dir(dir: &Path) -> PathBuf {
    dir.join("pending_update.json")
}

/// Read the sentinel file. Returns None if missing or unreadable.
pub fn read_sentinel(app: &AppHandle) -> Option<UpdateSentinel> {
    let path = sentinel_path(app).ok()?;
    read_sentinel_from_path(&path)
}

/// Read sentinel from an explicit path. Used internally and in tests.
fn read_sentinel_from_path(path: &Path) -> Option<UpdateSentinel> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Write the sentinel file with the given version.
pub fn write_sentinel(app: &AppHandle, version: &str) -> Result<(), String> {
    let path = sentinel_path(app)?;
    write_sentinel_to_path(&path, version)
}

/// Write sentinel to an explicit path. Used internally and in tests.
fn write_sentinel_to_path(path: &Path, version: &str) -> Result<(), String> {
    let sentinel = UpdateSentinel {
        version: version.to_string(),
    };
    let content =
        serde_json::to_string(&sentinel).map_err(|e| format!("serialize sentinel: {}", e))?;
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create_dir_all for sentinel: {}", e))?;
    }
    std::fs::write(path, content).map_err(|e| format!("write sentinel: {}", e))
}

/// Delete the sentinel file. Silently ignores missing files.
pub fn delete_sentinel(app: &AppHandle) {
    if let Ok(path) = sentinel_path(app) {
        delete_sentinel_at_path(&path);
    }
}

/// Delete sentinel at an explicit path. Used internally and in tests.
fn delete_sentinel_at_path(path: &Path) {
    let _ = std::fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_temp_dir() -> TempDir {
        tempfile::tempdir().expect("failed to create temp dir")
    }

    #[test]
    fn test_sentinel_path_for_dir() {
        let dir = std::path::Path::new("/tmp/test_app_data");
        let path = sentinel_path_for_dir(dir);
        assert_eq!(path, dir.join("pending_update.json"));
    }

    #[test]
    fn test_write_and_read_sentinel() {
        let tmp = make_temp_dir();
        let path = sentinel_path_for_dir(tmp.path());

        write_sentinel_to_path(&path, "1.5.0").expect("write should succeed");
        let result = read_sentinel_from_path(&path);

        assert!(result.is_some());
        let sentinel = result.unwrap();
        assert_eq!(sentinel.version, "1.5.0");
    }

    #[test]
    fn test_delete_sentinel_removes_file() {
        let tmp = make_temp_dir();
        let path = sentinel_path_for_dir(tmp.path());

        write_sentinel_to_path(&path, "2.0.0").expect("write should succeed");
        assert!(path.exists(), "file should exist after write");

        delete_sentinel_at_path(&path);
        assert!(!path.exists(), "file should be gone after delete");

        let result = read_sentinel_from_path(&path);
        assert!(result.is_none(), "read after delete should return None");
    }

    #[test]
    fn test_read_missing_sentinel_returns_none() {
        let tmp = make_temp_dir();
        let path = sentinel_path_for_dir(tmp.path());
        // Don't write anything — just read
        let result = read_sentinel_from_path(&path);
        assert!(result.is_none());
    }

    #[test]
    fn test_delete_nonexistent_sentinel_is_noop() {
        let tmp = make_temp_dir();
        let path = sentinel_path_for_dir(tmp.path());
        // Deleting a file that doesn't exist should not panic
        delete_sentinel_at_path(&path);
    }

    #[test]
    fn test_write_creates_parent_dirs() {
        let tmp = make_temp_dir();
        // Use a nested path that doesn't exist yet
        let nested_dir = tmp.path().join("a").join("b").join("c");
        let path = sentinel_path_for_dir(&nested_dir);

        write_sentinel_to_path(&path, "3.1.4").expect("write to nested dir should succeed");
        let result = read_sentinel_from_path(&path);
        assert!(result.is_some());
        assert_eq!(result.unwrap().version, "3.1.4");
    }

    #[test]
    fn test_sentinel_serialize_deserialize_roundtrip() {
        let tmp = make_temp_dir();
        let path = sentinel_path_for_dir(tmp.path());

        write_sentinel_to_path(&path, "0.0.1-beta.1").unwrap();
        let result = read_sentinel_from_path(&path).unwrap();
        assert_eq!(result.version, "0.0.1-beta.1");
    }
}
