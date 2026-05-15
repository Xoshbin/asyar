//! Tauri commands for user-managed script directories and on-demand rescans.
//!
//! All heavy logic lives in `*_impl` inner functions that accept explicit
//! dependencies so tests can drive them without a Tauri runtime. The outer
//! `#[tauri::command]` wrappers are thin glue that resolves `State` and
//! dispatches.

use crate::error::AppError;
use crate::scripts::{
    InlineSchedulerState, InlineScriptSpec, ScannedScript, SetInlineScriptsOutcome,
};
use crate::storage::DataStore;
use rusqlite::Connection;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

/// App-state wrapper around a live `ScriptsWatcher`. Registered during
/// `setup_app` and resolved by the Tauri command wrappers.
pub struct ScriptsWatcherState(pub Arc<crate::scripts::watcher::ScriptsWatcher>);

// ── Inner functions (testable without Tauri runtime) ────────────────────────

/// Persist `path` and refresh the watcher's directory set.
pub(crate) fn scripts_add_directory_impl(
    conn: &Connection,
    watcher: &crate::scripts::watcher::ScriptsWatcher,
    path: String,
) -> Result<(), AppError> {
    crate::storage::script_directories::add(conn, &path)?;
    let dirs = crate::storage::script_directories::list(conn)?;
    let paths: Vec<std::path::PathBuf> = dirs.into_iter().map(std::path::PathBuf::from).collect();
    watcher.set_directories(paths)?;
    Ok(())
}

/// Remove `path` from persistence and refresh the watcher's directory set.
pub(crate) fn scripts_remove_directory_impl(
    conn: &Connection,
    watcher: &crate::scripts::watcher::ScriptsWatcher,
    path: String,
) -> Result<(), AppError> {
    crate::storage::script_directories::remove(conn, &path)?;
    let dirs = crate::storage::script_directories::list(conn)?;
    let paths: Vec<std::path::PathBuf> = dirs.into_iter().map(std::path::PathBuf::from).collect();
    watcher.set_directories(paths)?;
    Ok(())
}

/// Return all configured script directories in insertion order.
pub(crate) fn scripts_list_directories_impl(
    conn: &Connection,
) -> Result<Vec<String>, AppError> {
    crate::storage::script_directories::list(conn)
}

/// Read configured directories from SQLite and scan them for scripts.
pub(crate) fn scripts_rescan_impl(
    conn: &Connection,
) -> Result<Vec<ScannedScript>, AppError> {
    let dirs = crate::storage::script_directories::list(conn)?;
    let paths: Vec<std::path::PathBuf> = dirs.into_iter().map(std::path::PathBuf::from).collect();
    Ok(crate::scripts::scan_directories(&paths))
}

// ── Tauri command wrappers ──────────────────────────────────────────────────

/// Add a directory to the user's script search path. Emits `scripts:changed`
/// after success so the TS-side `scriptsManager` rescans immediately —
/// otherwise newly-added directories with pre-existing scripts stay invisible
/// until some FS event happens to fire inside them.
#[tauri::command]
pub async fn scripts_add_directory(
    app: AppHandle,
    path: String,
    db: State<'_, DataStore>,
    watcher: State<'_, ScriptsWatcherState>,
) -> Result<(), AppError> {
    let conn = db.conn()?;
    scripts_add_directory_impl(&conn, &watcher.0, path)?;
    let _ = app.emit("scripts:changed", ());
    Ok(())
}

/// Remove a directory from the user's script search path. Emits
/// `scripts:changed` after success so the TS-side `scriptsManager` drops the
/// removed directory's scripts from its registry immediately.
#[tauri::command]
pub async fn scripts_remove_directory(
    app: AppHandle,
    path: String,
    db: State<'_, DataStore>,
    watcher: State<'_, ScriptsWatcherState>,
) -> Result<(), AppError> {
    let conn = db.conn()?;
    scripts_remove_directory_impl(&conn, &watcher.0, path)?;
    let _ = app.emit("scripts:changed", ());
    Ok(())
}

/// Return all configured script directories in insertion order.
#[tauri::command]
pub async fn scripts_list_directories(
    db: State<'_, DataStore>,
) -> Result<Vec<String>, AppError> {
    let conn = db.conn()?;
    scripts_list_directories_impl(&conn)
}

/// Open the OS native folder picker and return the chosen path (or `None`
/// when the user dismisses the dialog).
#[tauri::command]
pub async fn scripts_pick_directory(app: tauri::AppHandle) -> Result<Option<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;
    let result = app.dialog().file().blocking_pick_folder();
    Ok(result.map(|p| p.to_string()))
}

/// Read the configured directories from SQLite and rescan them, returning
/// every discovered script.
#[tauri::command]
pub async fn scripts_rescan(
    db: State<'_, DataStore>,
) -> Result<Vec<ScannedScript>, AppError> {
    let conn = db.conn()?;
    scripts_rescan_impl(&conn)
}

/// Replace the active set of inline-mode tick timers. Called by the TS
/// `scriptsManager` after every rescan with the current list of inline-
/// mode scripts. Returns the cap policy outcome (accepted / capped /
/// dropped) so the TS layer can surface a diagnostic and clear stale
/// liveSubtitles entries.
#[tauri::command]
pub async fn scripts_set_inline_scripts(
    app: AppHandle,
    state: State<'_, InlineSchedulerState>,
    specs: Vec<InlineScriptSpec>,
) -> Result<SetInlineScriptsOutcome, AppError> {
    crate::scripts::set_inline_scripts(&app, state.inner(), specs)
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn make_test_env() -> (Connection, Arc<crate::scripts::watcher::ScriptsWatcher>) {
        let conn = Connection::open_in_memory().unwrap();
        crate::storage::script_directories::init_table(&conn).unwrap();
        let state = crate::scripts::watcher::build_directories_state(vec![]);
        let watcher = crate::scripts::watcher::ScriptsWatcher::start(state, || {}).unwrap();
        (conn, watcher)
    }

    #[cfg(unix)]
    fn write_script(dir: &Path, name: &str, content: &str, exec: bool) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        fs::write(&path, content).unwrap();
        let mut perms = fs::metadata(&path).unwrap().permissions();
        perms.set_mode(if exec { 0o755 } else { 0o644 });
        fs::set_permissions(&path, perms).unwrap();
        path
    }

    #[cfg(not(unix))]
    fn write_script(dir: &Path, name: &str, content: &str, _exec: bool) -> std::path::PathBuf {
        let path = dir.join(name);
        fs::write(&path, content).unwrap();
        path
    }

    // 1. add_directory persists to DB and updates the watcher
    #[test]
    fn add_directory_persists_and_updates_watcher() {
        let (conn, watcher) = make_test_env();
        scripts_add_directory_impl(&conn, &watcher, "/foo".into()).unwrap();

        let dirs = scripts_list_directories_impl(&conn).unwrap();
        assert_eq!(dirs, vec!["/foo".to_string()]);

        let watched = watcher.current_directories();
        assert!(
            watched.contains(&std::path::PathBuf::from("/foo")),
            "watcher must include /foo after add, got {watched:?}"
        );
    }

    // 2. adding the same path twice keeps only one entry
    #[test]
    fn add_directory_idempotent() {
        let (conn, watcher) = make_test_env();
        scripts_add_directory_impl(&conn, &watcher, "/foo".into()).unwrap();
        scripts_add_directory_impl(&conn, &watcher, "/foo".into()).unwrap();

        let dirs = scripts_list_directories_impl(&conn).unwrap();
        assert_eq!(
            dirs.len(),
            1,
            "adding same path twice must result in one entry, got {dirs:?}"
        );
        assert_eq!(dirs[0], "/foo");
    }

    // 3. remove persists deletion and updates the watcher
    #[test]
    fn remove_directory_persists_and_updates_watcher() {
        let (conn, watcher) = make_test_env();
        scripts_add_directory_impl(&conn, &watcher, "/foo".into()).unwrap();
        scripts_remove_directory_impl(&conn, &watcher, "/foo".into()).unwrap();

        let dirs = scripts_list_directories_impl(&conn).unwrap();
        assert!(dirs.is_empty(), "list must be empty after remove, got {dirs:?}");

        let watched = watcher.current_directories();
        assert!(
            !watched.contains(&std::path::PathBuf::from("/foo")),
            "watcher must not include /foo after remove, got {watched:?}"
        );
    }

    // 4. removing a path that was never added returns Ok(())
    #[test]
    fn remove_unknown_directory_no_error() {
        let (conn, watcher) = make_test_env();
        let result = scripts_remove_directory_impl(&conn, &watcher, "/never-added".into());
        assert!(result.is_ok(), "removing unknown path must return Ok, got {result:?}");
    }

    // 5. list returns empty vec when no rows in DB
    #[test]
    fn list_directories_empty_when_no_rows() {
        let (conn, _watcher) = make_test_env();
        let dirs = scripts_list_directories_impl(&conn).unwrap();
        assert!(dirs.is_empty(), "fresh DB must return empty list, got {dirs:?}");
    }

    // 6. rescan with no configured dirs returns empty vec
    #[test]
    fn rescan_with_empty_dirs_returns_empty() {
        let (conn, _watcher) = make_test_env();
        let scripts = scripts_rescan_impl(&conn).unwrap();
        assert!(
            scripts.is_empty(),
            "rescan with no dirs must return empty Vec, got {scripts:?}"
        );
    }

    // 7. rescan with one dir containing one valid script returns that script
    #[test]
    fn rescan_with_one_dir_returns_scripts() {
        let (conn, watcher) = make_test_env();
        let dir = TempDir::new().unwrap();
        write_script(
            dir.path(),
            "myscript.sh",
            "#!/bin/bash\n# @asyar.title My Script\n",
            true,
        );

        scripts_add_directory_impl(&conn, &watcher, dir.path().to_string_lossy().to_string())
            .unwrap();

        let scripts = scripts_rescan_impl(&conn).unwrap();
        assert_eq!(
            scripts.len(),
            1,
            "rescan must return 1 script, got {scripts:?}"
        );
        assert_eq!(
            scripts[0].header.title,
            Some("My Script".to_string()),
            "script title must match the @asyar.title header"
        );
    }

    // 8. rescan with multiple dirs aggregates all scripts
    #[test]
    fn rescan_with_multiple_dirs_aggregates() {
        let (conn, watcher) = make_test_env();
        let dir1 = TempDir::new().unwrap();
        let dir2 = TempDir::new().unwrap();

        write_script(
            dir1.path(),
            "alpha.sh",
            "#!/bin/bash\n# @asyar.title Alpha\n",
            true,
        );
        write_script(
            dir2.path(),
            "beta.sh",
            "#!/bin/bash\n# @asyar.title Beta\n",
            true,
        );

        scripts_add_directory_impl(&conn, &watcher, dir1.path().to_string_lossy().to_string())
            .unwrap();
        scripts_add_directory_impl(&conn, &watcher, dir2.path().to_string_lossy().to_string())
            .unwrap();

        let scripts = scripts_rescan_impl(&conn).unwrap();
        assert_eq!(
            scripts.len(),
            2,
            "rescan must aggregate scripts from both dirs, got {scripts:?}"
        );

        let titles: std::collections::HashSet<Option<String>> =
            scripts.iter().map(|s| s.header.title.clone()).collect();
        assert!(
            titles.contains(&Some("Alpha".to_string())),
            "must contain Alpha"
        );
        assert!(
            titles.contains(&Some("Beta".to_string())),
            "must contain Beta"
        );
    }
}
