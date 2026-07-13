//! Atomic runtime installation: populate a staging directory, then promote
//! it into place with a single rename so a crash or failure mid-populate
//! never leaves a half-installed runtime at the final path.

use crate::error::AppError;
use std::path::{Path, PathBuf};

/// Populates `staging_dir` via `populate`, then atomically renames it to
/// `final_dir` on success. On failure, `staging_dir` is cleaned up and
/// `final_dir` is left untouched — the rename never happens, so there is no
/// partial state at the final path.
pub(crate) fn install_atomically(
    staging_dir: &Path,
    final_dir: &Path,
    populate: impl FnOnce(&Path) -> Result<(), AppError>,
) -> Result<(), AppError> {
    if staging_dir.exists() {
        std::fs::remove_dir_all(staging_dir)?;
    }

    if let Err(e) = populate(staging_dir) {
        let _ = std::fs::remove_dir_all(staging_dir);
        return Err(e);
    }

    commit(staging_dir, final_dir, |from, to| std::fs::rename(from, to))
}

/// Promotes `staging_dir` to `final_dir` via `rename_fn` (real
/// `std::fs::rename` in production; injectable so a rename failure can be
/// simulated in tests without relying on a real OS-level failure). If
/// `final_dir` already holds a previous install, it's backed up first and
/// restored on failure — a bare remove-then-rename would instead leave a
/// previously-working runtime uninstalled if the rename itself fails (e.g.
/// a file lock or antivirus scan holding it open on Windows).
fn commit(
    staging_dir: &Path,
    final_dir: &Path,
    rename_fn: impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), AppError> {
    if let Some(parent) = final_dir.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let backup_dir = backup_path_for(final_dir);
    let had_previous = final_dir.exists();
    if had_previous {
        std::fs::rename(final_dir, &backup_dir)?;
    }

    match rename_fn(staging_dir, final_dir) {
        Ok(()) => {
            if had_previous {
                // Best-effort: the install already succeeded, so a leftover
                // backup dir is a harmless disk-space cost, not a correctness issue.
                let _ = std::fs::remove_dir_all(&backup_dir);
            }
            Ok(())
        }
        Err(e) => {
            if had_previous {
                // Best-effort restore. If this also fails there's nothing
                // safer left to do — leave the backup dir in place (rather
                // than having already deleted it) so the failure is at
                // least diagnosable instead of silently losing the install.
                let _ = std::fs::rename(&backup_dir, final_dir);
            }
            Err(AppError::Io(e))
        }
    }
}

/// A sibling path to `final_dir` used as a temporary backup location during
/// `commit`, disambiguated by pid so a crashed prior attempt's leftover
/// backup can never collide with a fresh one.
fn backup_path_for(final_dir: &Path) -> PathBuf {
    let name = final_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    final_dir.with_file_name(format!("{name}.bak-{}", std::process::id()))
}

/// Pure decision: does this binary need an ad-hoc `codesign -s -` re-sign
/// before it can run? Only macOS enforces the "some signature, any
/// signature" requirement, and only when the binary doesn't already carry a
/// valid one. Kept side-effect-free so it's testable without shelling out —
/// the real `codesign` invocation lives in `resign_adhoc`, gated to macOS
/// and wired in only by the real install flow.
pub(crate) fn needs_resign(is_macos: bool, has_valid_signature: bool) -> bool {
    is_macos && !has_valid_signature
}

/// Checks whether `path` already carries a valid code signature, via
/// `codesign --verify --strict` (exit status 0 == valid). Side-effecting
/// (shells out) and macOS-only, structurally analogous to `resign_adhoc`
/// below — kept separate from `needs_resign` so the pure decision stays
/// unit-testable without shelling out.
#[cfg(target_os = "macos")]
pub(crate) fn has_valid_signature(path: &Path) -> bool {
    std::process::Command::new("codesign")
        .args(["--verify", "--strict"])
        .arg(path)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Ad-hoc re-signs `path` so a freshly downloaded binary can execute under
/// macOS's Gatekeeper/AMFI signature requirement. `-s -` is the ad-hoc
/// identity, no real signing key is required.
#[cfg(target_os = "macos")]
pub(crate) fn resign_adhoc(path: &Path) -> Result<(), AppError> {
    let status = std::process::Command::new("codesign")
        .args(["-s", "-", "--force"])
        .arg(path)
        .status()
        .map_err(AppError::Io)?;
    if !status.success() {
        return Err(AppError::Platform(format!(
            "codesign ad-hoc re-sign failed for {:?}",
            path
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn install_atomically_renames_staging_into_final_dir_on_success() {
        let root = TempDir::new().unwrap();
        let staging = root.path().join("staging");
        let final_dir = root.path().join("runtimes").join("bun").join("1.1.0");

        let result: Result<(), AppError> = install_atomically(&staging, &final_dir, |dir| {
            std::fs::create_dir_all(dir)?;
            std::fs::write(dir.join("bun"), b"binary-bytes")?;
            Ok(())
        });

        assert!(result.is_ok());
        assert!(final_dir.join("bun").exists());
        assert!(
            !staging.exists(),
            "the staging dir must be consumed by the atomic rename"
        );
    }

    #[test]
    fn commit_restores_previous_content_when_rename_fails() {
        let root = TempDir::new().unwrap();
        let staging = root.path().join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("bun"), b"new-version").unwrap();
        let final_dir = root.path().join("runtimes").join("bun").join("1.1.0");
        std::fs::create_dir_all(&final_dir).unwrap();
        std::fs::write(final_dir.join("bun"), b"old-version").unwrap();

        let result = commit(&staging, &final_dir, |_, _| {
            Err(std::io::Error::other("simulated rename failure"))
        });

        assert!(
            result.is_err(),
            "a failed rename must propagate as an error"
        );
        assert!(
            final_dir.join("bun").exists(),
            "a failed rename must restore the previously-installed content, not leave final_dir empty"
        );
        assert_eq!(
            std::fs::read(final_dir.join("bun")).unwrap(),
            b"old-version",
            "the restored content must be the pre-existing install, not a partial/mixed state"
        );
    }

    #[test]
    fn commit_installs_fresh_when_no_previous_final_dir_exists() {
        let root = TempDir::new().unwrap();
        let staging = root.path().join("staging");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("uv"), b"first-install").unwrap();
        let final_dir = root.path().join("runtimes").join("uv").join("0.4.9");

        let result = commit(&staging, &final_dir, |from, to| std::fs::rename(from, to));

        assert!(result.is_ok());
        assert_eq!(
            std::fs::read(final_dir.join("uv")).unwrap(),
            b"first-install"
        );
    }

    #[test]
    fn install_atomically_leaves_no_partial_state_when_populate_fails() {
        let root = TempDir::new().unwrap();
        let staging = root.path().join("staging");
        let final_dir = root.path().join("runtimes").join("uv").join("0.4.9");

        let result: Result<(), AppError> = install_atomically(&staging, &final_dir, |dir| {
            std::fs::create_dir_all(dir)?;
            std::fs::write(dir.join("uv"), b"partial-extract")?;
            Err(AppError::Extension(
                "simulated mid-extract failure".to_string(),
            ))
        });

        assert!(result.is_err());
        assert!(
            !final_dir.exists(),
            "a populate failure must never promote the staging dir to the final path (rename must not happen)"
        );
    }

    #[test]
    fn needs_resign_macos_unsigned_requires_resign() {
        assert!(needs_resign(true, false));
    }

    #[test]
    fn needs_resign_macos_signed_does_not_require_resign() {
        assert!(!needs_resign(true, true));
    }

    #[test]
    fn needs_resign_non_macos_unsigned_does_not_require_resign() {
        assert!(!needs_resign(false, false));
    }

    #[test]
    fn needs_resign_non_macos_signed_does_not_require_resign() {
        assert!(!needs_resign(false, true));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn has_valid_signature_false_for_a_path_with_no_binary() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("does-not-exist");
        assert!(!has_valid_signature(&missing));
    }
}
