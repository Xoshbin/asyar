//! Application-uninstall service module.
//!
//! Moves installed application bundles to the OS Trash. macOS-only in this
//! release; Linux/Windows return `AppError::Platform` because proper uninstall
//! on those systems requires package-manager integration (see the "Out of
//! scope" notes in the launching PR).
//!
//! The Tauri command wrapper lives at `commands::applications::uninstall_application`
//! and is intentionally restricted to core callers (the Tier 1 action panel),
//! not exposed to Tier 2 extensions — uninstalling apps is a capability jump
//! beyond the `application:*` namespace's current read-only shape.

use crate::error::AppError;
use std::path::{Path, PathBuf};

/// Moves an installed application bundle to the OS Trash.
///
/// Safety gates (all must pass on every platform):
///
/// 1. Platform = macOS (other OSes return `AppError::Platform`).
/// 2. Path ends in `.app`.
/// 3. Path is absolute.
/// 4. Path exists and is a directory (`.app` bundles are directories).
/// 5. Canonicalized path does not start with `/System/`.
/// 6. Canonicalized path is not Asyar's own bundle.
pub fn uninstall_application(path: &str) -> Result<(), AppError> {
    uninstall_application_inner(path, resolve_own_bundle_path().as_deref())
}

/// Test-visible core. Accepts `own_bundle_path` explicitly so unit tests can
/// assert the self-bundle guard without spawning a real Tauri app.
pub(crate) fn uninstall_application_inner(
    path: &str,
    own_bundle_path: Option<&Path>,
) -> Result<(), AppError> {
    let canonical = validate_uninstall_path(path, own_bundle_path)?;

    #[cfg(target_os = "macos")]
    {
        trash::delete(&canonical)
            .map_err(|e| AppError::Other(format!("Failed to move app to Trash: {}", e)))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Unreachable — validate_uninstall_path already rejected non-macOS
        // platforms — but the match keeps cargo check honest on Linux/Windows.
        let _ = canonical;
        Err(AppError::Platform(
            "uninstall is only supported on macOS".to_string(),
        ))
    }
}

/// Runs every safety gate and returns the canonicalized path on success.
/// Pulled out of `uninstall_application_inner` so every rejection branch has a
/// dedicated test and the final `trash::delete` only ever sees a vetted path.
pub(crate) fn validate_uninstall_path(
    path: &str,
    own_bundle_path: Option<&Path>,
) -> Result<PathBuf, AppError> {
    if !cfg!(target_os = "macos") {
        return Err(AppError::Platform(
            "uninstall is only supported on macOS".to_string(),
        ));
    }

    if path.trim().is_empty() {
        return Err(AppError::Validation("path must be non-empty".to_string()));
    }

    let raw = Path::new(path);

    if !raw.is_absolute() {
        return Err(AppError::Validation(format!(
            "path must be absolute: {}",
            path
        )));
    }

    if raw.extension().and_then(|e| e.to_str()) != Some("app") {
        return Err(AppError::Validation(format!(
            "path must point to a .app bundle: {}",
            path
        )));
    }

    if !raw.exists() {
        return Err(AppError::NotFound(format!(
            "application does not exist: {}",
            path
        )));
    }

    if !raw.is_dir() {
        return Err(AppError::Validation(format!(
            ".app bundle must be a directory: {}",
            path
        )));
    }

    // Canonicalize before the system / own-bundle checks so symlinks can't
    // smuggle the path past the guards.
    let canonical = raw
        .canonicalize()
        .map_err(|e| AppError::Other(format!("Failed to canonicalize path '{}': {}", path, e)))?;

    if canonical.starts_with("/System/") || canonical.starts_with("/System") {
        return Err(AppError::Permission(format!(
            "cannot uninstall system-protected application: {}",
            path
        )));
    }

    if let Some(own) = own_bundle_path {
        if let Ok(own_canonical) = own.canonicalize() {
            if canonical == own_canonical {
                return Err(AppError::Permission(
                    "refusing to uninstall Asyar itself".to_string(),
                ));
            }
        }
    }

    Ok(canonical)
}

/// Best-effort: walks up from the current executable looking for the
/// containing `.app` bundle so the self-bundle guard has something to compare
/// against. Returns `None` when run outside a bundle (e.g. `cargo test` or
/// `cargo run` during development) — in that case the guard is a no-op, which
/// is safe because no user can select the dev binary in search results.
fn resolve_own_bundle_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    for ancestor in exe.ancestors() {
        if ancestor.extension().and_then(|e| e.to_str()) == Some("app") {
            return Some(ancestor.to_path_buf());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn make_fake_app(tmp: &TempDir, name: &str) -> PathBuf {
        let app_path = tmp.path().join(name);
        fs::create_dir_all(&app_path).unwrap();
        // Fake Info.plist so the bundle looks real enough to callers that peek.
        fs::create_dir_all(app_path.join("Contents")).unwrap();
        fs::write(app_path.join("Contents/Info.plist"), b"<plist/>").unwrap();
        app_path
    }

    #[test]
    fn rejects_empty_path() {
        let err = validate_uninstall_path("", None).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    fn rejects_whitespace_only_path() {
        let err = validate_uninstall_path("   ", None).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn rejects_relative_path() {
        let err = validate_uninstall_path("Applications/Foo.app", None).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn rejects_path_without_dot_app_extension() {
        let err = validate_uninstall_path("/Applications/not-an-app", None).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn rejects_nonexistent_path() {
        let err = validate_uninstall_path(
            "/tmp/__asyar_nonexistent_uninstall_test__.app",
            None,
        )
        .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn rejects_file_masquerading_as_app_bundle() {
        let tmp = TempDir::new().unwrap();
        let fake = tmp.path().join("Foo.app");
        fs::write(&fake, b"not a directory").unwrap();
        let err = validate_uninstall_path(fake.to_str().unwrap(), None).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn rejects_system_applications_path() {
        // `/System/Applications` exists on macOS CI and dev machines, but we
        // don't want to hit it for real — the guard must trigger based on the
        // path prefix regardless of whether the specific app exists.
        let candidate = "/System/Applications/Calendar.app";
        let result = validate_uninstall_path(candidate, None);
        // Either Permission (rejected by prefix guard) or NotFound if the
        // exact app is missing. Both are non-success; the important contract
        // is that we never return Ok for a /System/ path.
        assert!(result.is_err(), "must not allow /System/ path");
        if let Err(err) = result {
            assert!(
                matches!(err, AppError::Permission(_) | AppError::NotFound(_)),
                "got: {err:?}"
            );
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn rejects_asyars_own_bundle() {
        let tmp = TempDir::new().unwrap();
        let app = make_fake_app(&tmp, "Asyar.app");
        let err = validate_uninstall_path(app.to_str().unwrap(), Some(&app)).unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn accepts_valid_user_app() {
        let tmp = TempDir::new().unwrap();
        let app = make_fake_app(&tmp, "SafeApp.app");
        let canonical = validate_uninstall_path(app.to_str().unwrap(), None).unwrap();
        assert!(canonical.exists());
        assert_eq!(canonical.extension().and_then(|e| e.to_str()), Some("app"));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn own_bundle_guard_does_not_reject_other_apps() {
        let tmp = TempDir::new().unwrap();
        let app = make_fake_app(&tmp, "Other.app");
        let asyar = make_fake_app(&tmp, "Asyar.app");
        // `app` and `asyar` are siblings, not the same path — guard must pass.
        let canonical = validate_uninstall_path(app.to_str().unwrap(), Some(&asyar)).unwrap();
        assert_eq!(canonical.file_name().and_then(|n| n.to_str()), Some("Other.app"));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn uninstall_application_actually_trashes_bundle() {
        // End-to-end: valid bundle in a user directory should be moved to Trash.
        let tmp = TempDir::new().unwrap();
        let app = make_fake_app(&tmp, "TrashMe.app");
        assert!(app.exists());

        uninstall_application_inner(app.to_str().unwrap(), None).unwrap();

        assert!(
            !app.exists(),
            "bundle should no longer exist at its source path after uninstall"
        );
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn rejects_all_paths_on_non_macos() {
        let err = validate_uninstall_path("/anything", None).unwrap_err();
        assert!(matches!(err, AppError::Platform(_)), "got: {err:?}");
    }

    #[test]
    fn resolve_own_bundle_path_returns_option_without_panicking() {
        // Contract test: never panics, regardless of where the test binary
        // runs. Value may be None (dev) or Some (inside a bundle) — both ok.
        let _ = resolve_own_bundle_path();
    }
}
