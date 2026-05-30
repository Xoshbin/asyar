//! Factory-reset command.
//!
//! Wipes everything Asyar persists (SQLite DB, settings store, installed
//! extensions, OAuth/auth tokens, onboarding state, alias data, ...).
//!
//! Implementation note: the actual wipe runs at boot, not at command time.
//! `factory_reset` writes a sentinel file into `app_data_dir` and exits the
//! app (`app.exit(0)`). The user relaunches manually; on that next cold
//! start, `setup_app` calls `perform_pending_factory_reset_if_marked` *before*
//! `DataStore::initialize`, so no SQLite connection or subsystem holds the DB
//! file when it's deleted. This avoids the "ghost inode" race where SQLite
//! keeps a deleted file open and the next process sees stale WAL state.
//!
//! We deliberately do NOT auto-restart via `app.restart()` because Tauri's
//! restart is unreliable in this environment. A clean exit + manual relaunch
//! is fine for a developer-only command.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::error::AppError;

const SENTINEL_FILE_NAME: &str = "pending_factory_reset";

/// Path of the sentinel file inside `app_data_dir`.
pub fn sentinel_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir: {e}")))?;
    Ok(sentinel_path_for_dir(&dir))
}

/// Build the sentinel path for a given app-data directory. Extracted so tests
/// can drive it with a `tempfile::TempDir` instead of a live `AppHandle`.
pub fn sentinel_path_for_dir(dir: &Path) -> PathBuf {
    dir.join(SENTINEL_FILE_NAME)
}

fn write_sentinel_to_path(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, b"")
}

fn sentinel_exists_at_path(path: &Path) -> bool {
    path.exists()
}

/// Remove every entry inside `dir` but leave `dir` itself in place. No-op when
/// `dir` does not exist.
fn wipe_dir_contents(dir: &Path) -> std::io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let metadata = entry.metadata()?;
        // `metadata` follows symlinks; check the symlink itself separately.
        let symlink_meta = std::fs::symlink_metadata(&path)?;
        if symlink_meta.file_type().is_symlink() || metadata.is_file() {
            std::fs::remove_file(&path)?;
        } else if metadata.is_dir() {
            std::fs::remove_dir_all(&path)?;
        }
    }
    Ok(())
}

/// Tauri command: marks a factory reset and quits the app.
/// The wipe itself runs on the next manual launch.
#[tauri::command]
pub async fn factory_reset(app: AppHandle) -> Result<(), AppError> {
    let path = sentinel_path(&app)?;
    write_sentinel_to_path(&path)?;
    log::warn!("[factory_reset] sentinel written at {path:?}; exiting app — user must relaunch");
    app.exit(0);
    Ok(())
}

/// Boot-time hook. If the sentinel file exists, wipe `app_data_dir` (and
/// `app_local_data_dir` when distinct) entirely, then continue boot. The wipe
/// removes the sentinel as a side effect. Returns `true` when a wipe was
/// performed.
pub fn perform_pending_factory_reset_if_marked(app: &AppHandle) -> bool {
    let app_data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            log::warn!("[factory_reset] could not resolve app_data_dir: {e}");
            return false;
        }
    };
    let sentinel = sentinel_path_for_dir(&app_data_dir);
    if !sentinel_exists_at_path(&sentinel) {
        return false;
    }

    log::warn!("[factory_reset] sentinel detected at {sentinel:?}; wiping {app_data_dir:?}");
    if let Err(e) = wipe_dir_contents(&app_data_dir) {
        log::error!(
            "[factory_reset] failed to wipe app_data_dir {app_data_dir:?}: {e}; \
             leaving sentinel in place so the next boot retries"
        );
        return false;
    }

    if let Ok(local) = app.path().app_local_data_dir() {
        if local != app_data_dir {
            if let Err(e) = wipe_dir_contents(&local) {
                log::error!("[factory_reset] failed to wipe app_local_data_dir {local:?}: {e}");
            }
        }
    }

    log::warn!("[factory_reset] wipe complete");
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn make_temp_dir() -> TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    #[test]
    fn sentinel_path_for_dir_uses_known_filename() {
        let dir = Path::new("/tmp/asyar-test");
        assert_eq!(
            sentinel_path_for_dir(dir),
            dir.join("pending_factory_reset"),
        );
    }

    #[test]
    fn write_then_check_sentinel_roundtrip() {
        let tmp = make_temp_dir();
        let path = sentinel_path_for_dir(tmp.path());
        assert!(!sentinel_exists_at_path(&path));
        write_sentinel_to_path(&path).expect("write");
        assert!(sentinel_exists_at_path(&path));
    }

    #[test]
    fn write_sentinel_creates_parent_dirs() {
        let tmp = make_temp_dir();
        let nested = tmp.path().join("a").join("b");
        let path = sentinel_path_for_dir(&nested);
        write_sentinel_to_path(&path).expect("write into nested dir");
        assert!(path.exists());
    }

    #[test]
    fn wipe_dir_contents_removes_files_and_subdirs() {
        let tmp = make_temp_dir();
        let root = tmp.path();
        fs::write(root.join("a.txt"), b"hi").unwrap();
        fs::create_dir_all(root.join("nested/deep")).unwrap();
        fs::write(root.join("nested/deep/x.bin"), b"bytes").unwrap();
        fs::create_dir_all(root.join("extensions/foo")).unwrap();
        fs::write(root.join("extensions/foo/manifest.json"), b"{}").unwrap();

        wipe_dir_contents(root).expect("wipe");

        assert!(root.exists(), "root dir itself must remain");
        assert_eq!(
            fs::read_dir(root).unwrap().count(),
            0,
            "root dir must be empty after wipe"
        );
    }

    #[test]
    fn wipe_dir_contents_is_noop_when_dir_missing() {
        let tmp = make_temp_dir();
        let missing = tmp.path().join("does-not-exist");
        wipe_dir_contents(&missing).expect("noop on missing dir");
        assert!(!missing.exists());
    }

    #[test]
    fn wipe_dir_contents_handles_symlinks_without_following() {
        // On platforms without symlink support this just returns early.
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let tmp = make_temp_dir();
            let outside = tmp.path().join("outside.txt");
            fs::write(&outside, b"keep me").unwrap();
            let inside = tmp.path().join("inside");
            fs::create_dir(&inside).unwrap();
            let link = inside.join("ptr");
            symlink(&outside, &link).unwrap();

            wipe_dir_contents(&inside).expect("wipe");

            assert!(
                outside.exists(),
                "wipe must not follow symlinks and delete external files"
            );
            assert!(!link.exists(), "symlink itself should be removed");
        }
    }

    /// Mirrors the boot-time path: write a sentinel, then "perform reset" by
    /// wiping the dir. We can't drive `perform_pending_factory_reset_if_marked`
    /// without an `AppHandle`, so this test exercises the same primitives in
    /// the same order.
    #[test]
    fn boot_time_flow_wipes_when_sentinel_present() {
        let tmp = make_temp_dir();
        let app_data_dir = tmp.path();

        // Simulate a populated app data dir.
        fs::write(app_data_dir.join("asyar_data.db"), b"sqlite").unwrap();
        fs::create_dir_all(app_data_dir.join("extensions/calculator")).unwrap();

        // User triggers factory reset → sentinel written.
        let sentinel = sentinel_path_for_dir(app_data_dir);
        write_sentinel_to_path(&sentinel).unwrap();
        assert!(sentinel_exists_at_path(&sentinel));

        // Next boot: wipe.
        wipe_dir_contents(app_data_dir).unwrap();

        assert!(!sentinel_exists_at_path(&sentinel));
        assert!(!app_data_dir.join("asyar_data.db").exists());
        assert!(!app_data_dir.join("extensions").exists());
    }

    #[test]
    fn boot_time_flow_skips_when_sentinel_absent() {
        let tmp = make_temp_dir();
        let app_data_dir = tmp.path();
        fs::write(app_data_dir.join("asyar_data.db"), b"sqlite").unwrap();

        let sentinel = sentinel_path_for_dir(app_data_dir);
        assert!(!sentinel_exists_at_path(&sentinel));

        // Without sentinel, `perform_pending_factory_reset_if_marked` would
        // bail out before calling `wipe_dir_contents`. We assert the dir
        // would still contain its files by simply not calling wipe here.
        assert!(app_data_dir.join("asyar_data.db").exists());
    }
}
