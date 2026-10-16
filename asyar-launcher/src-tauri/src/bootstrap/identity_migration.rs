//! Identity and data directory migration module.
//!
//! Handles migrating application data from legacy bundle identifiers (e.g. `org.asyar.app`)
//! to the canonical identifier (`org.asyar`) on startup before any storage or windows initialize.
//!
//! On macOS, directory names ending in `.app` are treated by LaunchServices and Finder as
//! application bundles (`com.apple.application-bundle`), causing `~/Library/Application Support/org.asyar.app`
//! to appear as a broken application rather than a browsable folder. Renaming the identifier to
//! `org.asyar` resolves this issue. This module ensures that existing user databases, extensions,
//! and settings are seamlessly migrated without data loss.

use std::path::{Path, PathBuf};
use tauri::Manager;

/// Known legacy identifiers that should be migrated to `org.asyar`.
pub const LEGACY_IDENTIFIERS: &[&str] = &["org.asyar.app"];

/// Report produced by directory migration.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct MigrationReport {
    /// Number of entries (files or directories) successfully moved to the target directory.
    pub entries_moved: usize,
    /// Top-level entry names that could not be moved because they already existed in the target.
    pub conflicts: Vec<String>,
    /// Whether the legacy directory was completely removed after migration.
    pub legacy_removed: bool,
    /// Whether the legacy directory was archived (e.g. renamed to `.migrated`) due to remaining conflicts.
    pub legacy_archived: bool,
    /// Path of the archived legacy directory, if archived.
    pub archive_path: Option<PathBuf>,
}

/// Recursively copies a directory tree from `src` to `dst`.
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest_child = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dest_child)?;
        } else {
            std::fs::copy(entry.path(), dest_child)?;
        }
    }
    Ok(())
}

/// Migrates contents from `legacy_dir` to `target_dir`.
///
/// Fast path: If `target_dir` does not exist, atomically renames `legacy_dir` to `target_dir`.
/// Fallback path: If `target_dir` already exists (or cross-device link fails), moves top-level
/// entries from `legacy_dir` into `target_dir` without overwriting conflicting destination files.
/// Once non-conflicting entries are moved:
/// - If `legacy_dir` is empty, it is deleted.
/// - If conflicts remain, `legacy_dir` is renamed to an archive directory (with `.migrated` suffix)
///   to strip the `.app` extension and prevent Finder classification as a broken application bundle.
pub fn migrate_directory(legacy_dir: &Path, target_dir: &Path) -> std::io::Result<MigrationReport> {
    let mut report = MigrationReport::default();

    if legacy_dir == target_dir || !legacy_dir.exists() || !legacy_dir.is_dir() {
        return Ok(report);
    }

    // Fast path: if target directory does not exist, try atomic rename
    if !target_dir.exists() {
        if let Some(parent) = target_dir.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::rename(legacy_dir, target_dir) {
            Ok(()) => {
                if let Ok(entries) = std::fs::read_dir(target_dir) {
                    report.entries_moved = entries.count();
                } else {
                    report.entries_moved = 1;
                }
                report.legacy_removed = false;
                return Ok(report);
            }
            Err(e) => {
                log::warn!(
                    "[identity_migration] atomic rename {:?} -> {:?} failed ({}); falling back to per-entry migration",
                    legacy_dir,
                    target_dir,
                    e
                );
            }
        }
    }

    // Target directory exists (or atomic rename failed across filesystems)
    std::fs::create_dir_all(target_dir)?;

    let read_dir = match std::fs::read_dir(legacy_dir) {
        Ok(rd) => rd,
        Err(e) => {
            log::error!(
                "[identity_migration] failed to read legacy dir {:?}: {}",
                legacy_dir,
                e
            );
            return Err(e);
        }
    };

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                log::warn!(
                    "[identity_migration] error reading entry in legacy dir: {}",
                    e
                );
                continue;
            }
        };

        let file_name = entry.file_name();
        let target_entry_path = target_dir.join(&file_name);

        if target_entry_path.exists() {
            log::info!(
                "[identity_migration] entry {:?} already exists in target; skipping to preserve target data",
                file_name
            );
            report
                .conflicts
                .push(file_name.to_string_lossy().to_string());
            continue;
        }

        let legacy_entry_path = entry.path();
        match std::fs::rename(&legacy_entry_path, &target_entry_path) {
            Ok(()) => {
                report.entries_moved += 1;
            }
            Err(rename_err) => {
                log::warn!(
                    "[identity_migration] rename failed for {:?} ({}); falling back to copy and remove",
                    file_name,
                    rename_err
                );
                if legacy_entry_path.is_dir() {
                    if let Err(e) = copy_dir_all(&legacy_entry_path, &target_entry_path) {
                        log::error!(
                            "[identity_migration] failed to copy dir {:?} to {:?}: {}",
                            legacy_entry_path,
                            target_entry_path,
                            e
                        );
                        report
                            .conflicts
                            .push(file_name.to_string_lossy().to_string());
                        continue;
                    }
                    let _ = std::fs::remove_dir_all(&legacy_entry_path);
                    report.entries_moved += 1;
                } else {
                    if let Err(e) = std::fs::copy(&legacy_entry_path, &target_entry_path) {
                        log::error!(
                            "[identity_migration] failed to copy file {:?} to {:?}: {}",
                            legacy_entry_path,
                            target_entry_path,
                            e
                        );
                        report
                            .conflicts
                            .push(file_name.to_string_lossy().to_string());
                        continue;
                    }
                    let _ = std::fs::remove_file(&legacy_entry_path);
                    report.entries_moved += 1;
                }
            }
        }
    }

    // Post-migration cleanup of legacy_dir
    let is_empty = match std::fs::read_dir(legacy_dir) {
        Ok(mut rd) => rd.next().is_none(),
        Err(_) => false,
    };

    if is_empty {
        match std::fs::remove_dir(legacy_dir) {
            Ok(()) => {
                log::info!(
                    "[identity_migration] removed empty legacy dir {:?}",
                    legacy_dir
                );
                report.legacy_removed = true;
            }
            Err(e) => {
                log::warn!(
                    "[identity_migration] failed to remove empty legacy dir {:?}: {}",
                    legacy_dir,
                    e
                );
            }
        }
    } else {
        let legacy_name = legacy_dir.file_name().unwrap_or_default().to_string_lossy();
        let mut archive_name = format!("{}.migrated", legacy_name);
        let parent = legacy_dir.parent().unwrap_or_else(|| Path::new(""));
        let mut archive_path = parent.join(&archive_name);

        let mut counter = 1;
        while archive_path.exists() {
            archive_name = format!("{}.migrated.{}", legacy_name, counter);
            archive_path = parent.join(&archive_name);
            counter += 1;
        }

        match std::fs::rename(legacy_dir, &archive_path) {
            Ok(()) => {
                log::info!(
                    "[identity_migration] archived remaining legacy entries to {:?}",
                    archive_path
                );
                report.legacy_archived = true;
                report.archive_path = Some(archive_path);
            }
            Err(e) => {
                log::error!(
                    "[identity_migration] failed to archive legacy dir {:?} to {:?}: {}",
                    legacy_dir,
                    archive_path,
                    e
                );
            }
        }
    }

    Ok(report)
}

/// Adopts legacy application data across all standard Tauri data directories.
///
/// This function is safe to call during setup: it catches and logs all errors,
/// never panicking or aborting application boot.
pub fn adopt_legacy_data(app: &tauri::AppHandle) {
    let path_resolver = app.path();

    // Check data directory, local data directory, config directory, cache directory.
    // We intentionally omit app_log_dir because Tauri's log plugin opens the log file
    // at startup before this hook, holding an open file handle.
    let dirs = [
        ("app_data_dir", path_resolver.app_data_dir()),
        ("app_local_data_dir", path_resolver.app_local_data_dir()),
        ("app_config_dir", path_resolver.app_config_dir()),
        ("app_cache_dir", path_resolver.app_cache_dir()),
    ];

    let current_identifier = app.config().identifier.clone();

    for (name, dir_result) in dirs {
        let target_dir = match dir_result {
            Ok(d) => d,
            Err(e) => {
                log::debug!("[identity_migration] could not resolve {}: {}", name, e);
                continue;
            }
        };

        // Safety check: ensure target_dir's final component matches the current identifier
        // so we don't accidentally rename siblings if path resolution changes.
        let file_name = match target_dir.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };

        if file_name != current_identifier {
            log::debug!(
                "[identity_migration] {} directory name {:?} does not match identifier {:?}; skipping derivation",
                name,
                file_name,
                current_identifier
            );
            continue;
        }

        let parent = match target_dir.parent() {
            Some(p) => p,
            None => continue,
        };

        for &legacy_id in LEGACY_IDENTIFIERS {
            if legacy_id == current_identifier {
                continue;
            }
            let legacy_dir = parent.join(legacy_id);
            if legacy_dir.exists() {
                log::info!(
                    "[identity_migration] found legacy {} at {:?}, migrating to canonical {:?}",
                    name,
                    legacy_dir,
                    target_dir
                );
                match migrate_directory(&legacy_dir, &target_dir) {
                    Ok(report) => {
                        log::info!(
                            "[identity_migration] migrated {}: {} entries moved, {} conflicts, removed: {}, archived: {}",
                            name,
                            report.entries_moved,
                            report.conflicts.len(),
                            report.legacy_removed,
                            report.legacy_archived
                        );
                    }
                    Err(e) => {
                        log::error!(
                            "[identity_migration] error migrating legacy {} from {:?} to {:?}: {}",
                            name,
                            legacy_dir,
                            target_dir,
                            e
                        );
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    clean_legacy_launch_agent();
}

#[cfg(target_os = "macos")]
fn clean_legacy_launch_agent() {
    if let Ok(home) = std::env::var("HOME") {
        let legacy_plist = PathBuf::from(home).join("Library/LaunchAgents/org.asyar.app.plist");
        if legacy_plist.exists() {
            if let Err(e) = std::fs::remove_file(&legacy_plist) {
                log::warn!(
                    "[identity_migration] could not remove legacy launch agent {:?}: {}",
                    legacy_plist,
                    e
                );
            } else {
                log::info!(
                    "[identity_migration] removed legacy launch agent {:?}",
                    legacy_plist
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TestDirGuard {
        path: PathBuf,
    }

    impl TestDirGuard {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "asyar_test_migration_{}_{}",
                name,
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn test_migrate_directory_fast_path() {
        let guard = TestDirGuard::new("fast_path");
        let legacy = guard.path.join("org.asyar.app");
        let target = guard.path.join("org.asyar");

        fs::create_dir_all(legacy.join("extensions/test_ext")).unwrap();
        fs::write(legacy.join("asyar_data.db"), b"sqlite data").unwrap();
        fs::write(legacy.join("settings.dat"), b"settings").unwrap();

        let report = migrate_directory(&legacy, &target).expect("migration should succeed");

        assert!(target.exists(), "target directory must exist");
        assert!(target.join("asyar_data.db").exists());
        assert_eq!(
            fs::read(target.join("asyar_data.db")).unwrap(),
            b"sqlite data"
        );
        assert!(target.join("settings.dat").exists());
        assert!(target.join("extensions/test_ext").exists());
        assert!(
            !legacy.exists(),
            "legacy directory must no longer exist at original path"
        );
        assert!(report.entries_moved > 0);
        assert!(report.conflicts.is_empty());
    }

    #[test]
    fn test_migrate_directory_target_already_exists_merge() {
        let guard = TestDirGuard::new("target_exists_merge");
        let legacy = guard.path.join("org.asyar.app");
        let target = guard.path.join("org.asyar");

        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("asyar_data.db"), b"legacy db").unwrap();
        fs::create_dir_all(legacy.join("extensions/my_extension")).unwrap();

        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("pre_existing.txt"), b"fresh data").unwrap();

        let report = migrate_directory(&legacy, &target).expect("migration should succeed");

        assert!(target.join("asyar_data.db").exists());
        assert_eq!(
            fs::read(target.join("asyar_data.db")).unwrap(),
            b"legacy db"
        );
        assert!(target.join("extensions/my_extension").exists());
        assert!(target.join("pre_existing.txt").exists());
        assert_eq!(
            fs::read(target.join("pre_existing.txt")).unwrap(),
            b"fresh data"
        );
        assert!(!legacy.exists(), "empty legacy directory should be deleted");
        assert!(report.legacy_removed);
        assert!(report.conflicts.is_empty());
    }

    #[test]
    fn test_migrate_directory_conflicts_preserved_and_archived() {
        let guard = TestDirGuard::new("conflicts_archived");
        let legacy = guard.path.join("org.asyar.app");
        let target = guard.path.join("org.asyar");

        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("asyar_data.db"), b"legacy conflicting db").unwrap();
        fs::write(legacy.join("unconflicted.txt"), b"moved entry").unwrap();

        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("asyar_data.db"), b"target db that wins").unwrap();

        let report = migrate_directory(&legacy, &target).expect("migration should succeed");

        // Target file must not be overwritten
        assert_eq!(
            fs::read(target.join("asyar_data.db")).unwrap(),
            b"target db that wins"
        );
        // Non-conflicting file moved
        assert_eq!(
            fs::read(target.join("unconflicted.txt")).unwrap(),
            b"moved entry"
        );

        // Conflicts reported
        assert_eq!(report.conflicts, vec!["asyar_data.db"]);
        assert!(report.legacy_archived);
        assert!(
            !legacy.exists(),
            "original legacy path must be renamed to archive"
        );

        let archive = report.archive_path.expect("archive path must be returned");
        assert!(archive.exists());
        assert!(archive.to_string_lossy().contains(".migrated"));
        assert_eq!(
            fs::read(archive.join("asyar_data.db")).unwrap(),
            b"legacy conflicting db"
        );
    }

    #[test]
    fn test_migrate_directory_noop_when_legacy_missing_or_same() {
        let guard = TestDirGuard::new("noop");
        let non_existent = guard.path.join("does_not_exist");
        let target = guard.path.join("org.asyar");

        let report = migrate_directory(&non_existent, &target).unwrap();
        assert_eq!(report, MigrationReport::default());

        let report_same = migrate_directory(&target, &target).unwrap();
        assert_eq!(report_same, MigrationReport::default());
    }

    #[test]
    fn test_migrate_directory_preserves_factory_reset_sentinel() {
        let guard = TestDirGuard::new("sentinel");
        let legacy = guard.path.join("org.asyar.app");
        let target = guard.path.join("org.asyar");

        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join(".factory-reset-pending"), b"").unwrap();

        let _report = migrate_directory(&legacy, &target).expect("migration should succeed");
        assert!(
            target.join(".factory-reset-pending").exists(),
            "sentinel must be moved to target"
        );
    }
}
