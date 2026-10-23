//! Application "where is it / run it elevated" helpers for the ⌘K action panel.
//!
//! - **Reveal** works on every platform. On Windows the indexer stores the
//!   Start-menu `.lnk` rather than the program, so the shortcut is resolved to
//!   its target before revealing; revealing the `.lnk` itself would only show
//!   the Start-menu folder. Microsoft Store (`shell:AppsFolder\…`) entries have
//!   no folder at all and are rejected.
//! - **Run as administrator** is Windows-only (`runas` verb). macOS and Linux
//!   have no equivalent that is safe to expose, so those builds return a
//!   platform error and the frontend hides the action.
//!
//! The path validators are plain functions so they are unit-tested on any OS.

use crate::error::AppError;
use std::path::{Path, PathBuf};

const APPS_FOLDER_PREFIX: &str = "shell:AppsFolder\\";

fn is_store_app(path: &str) -> bool {
    path.starts_with(APPS_FOLDER_PREFIX)
}

/// Validates an indexed application path before it is revealed.
pub(crate) fn validate_reveal_path(path: &str) -> Result<PathBuf, AppError> {
    if path.trim().is_empty() {
        return Err(AppError::Validation("path must be non-empty".to_string()));
    }
    if is_store_app(path) {
        return Err(AppError::Platform(
            "Microsoft Store apps have no file location".to_string(),
        ));
    }
    let raw = Path::new(path);
    if !raw.is_absolute() {
        return Err(AppError::Validation(format!(
            "path must be absolute: {path}"
        )));
    }
    if !raw.exists() {
        return Err(AppError::NotFound(format!(
            "application does not exist: {path}"
        )));
    }
    Ok(raw.to_path_buf())
}

/// Validates a path before it is launched elevated: an existing, absolute
/// `.lnk` or `.exe`. Anything else (scripts, documents, Store apps) is refused.
pub(crate) fn validate_elevatable_path(path: &str) -> Result<PathBuf, AppError> {
    if is_store_app(path) {
        return Err(AppError::Platform(
            "Microsoft Store apps cannot be run as administrator".to_string(),
        ));
    }
    let resolved = validate_reveal_path(path)?;
    let ext = resolved
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("lnk") | Some("exe") => Ok(resolved),
        _ => Err(AppError::Validation(format!(
            "only .lnk and .exe can be run as administrator: {path}"
        ))),
    }
}

/// The path to reveal for an application: the shortcut's target on Windows
/// when it resolves, otherwise the path itself.
pub(crate) fn reveal_target(path: &str) -> Result<PathBuf, AppError> {
    let validated = validate_reveal_path(path)?;
    #[cfg(target_os = "windows")]
    {
        let is_lnk = validated
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("lnk"));
        if is_lnk {
            if let Some(target) = windows_impl::resolve_shortcut_target(&validated) {
                if target.exists() {
                    return Ok(target);
                }
            }
        }
    }
    Ok(validated)
}

/// Launches the application with an elevation prompt (UAC). Windows only.
///
/// Returns `Ok(())` when the user dismisses the UAC prompt: that is a choice,
/// not a failure, and surfacing an error toast for it would be noise.
pub fn run_as_administrator(path: &str) -> Result<(), AppError> {
    let validated = validate_elevatable_path(path)?;
    #[cfg(target_os = "windows")]
    {
        windows_impl::shell_execute_runas(&validated)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = validated;
        Err(AppError::Platform(
            "Run as administrator is only available on Windows".to_string(),
        ))
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::*;
    use windows::core::{Interface, HSTRING, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellExecuteW, ShellLink};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    /// `ShellExecuteW` reports failure with a value <= 32. 5 is
    /// SE_ERR_ACCESSDENIED, which is what a dismissed UAC prompt returns.
    const SE_ERR_ACCESSDENIED: isize = 5;

    /// Resolves a `.lnk` to its target path. Runs on a dedicated thread so the
    /// COM apartment it initialises never collides with the caller's.
    pub(super) fn resolve_shortcut_target(lnk: &Path) -> Option<PathBuf> {
        let lnk = lnk.to_path_buf();
        std::thread::spawn(move || unsafe {
            let initialised = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let resolved = (|| -> windows::core::Result<PathBuf> {
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                let file: IPersistFile = link.cast()?;
                file.Load(&HSTRING::from(lnk.as_os_str()), STGM_READ)?;
                let mut buf = [0u16; 1024];
                link.GetPath(&mut buf, std::ptr::null_mut(), 0)?;
                let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                Ok(PathBuf::from(String::from_utf16_lossy(&buf[..len])))
            })()
            .ok()
            .filter(|p| !p.as_os_str().is_empty());
            if initialised {
                CoUninitialize();
            }
            resolved
        })
        .join()
        .ok()
        .flatten()
    }

    pub(super) fn shell_execute_runas(path: &Path) -> Result<(), AppError> {
        let verb = HSTRING::from("runas");
        let file = HSTRING::from(path.as_os_str());
        let result = unsafe {
            ShellExecuteW(
                None,
                &verb,
                &file,
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        let code = result.0 as isize;
        if code > 32 || code == SE_ERR_ACCESSDENIED {
            return Ok(());
        }
        Err(AppError::Platform(format!(
            "Failed to run '{}' as administrator (code {code})",
            path.display()
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn touch(dir: &TempDir, name: &str) -> String {
        let p = dir.path().join(name);
        std::fs::write(&p, "").unwrap();
        p.to_string_lossy().to_string()
    }

    #[test]
    fn reveal_rejects_empty_and_relative_paths() {
        assert!(matches!(
            validate_reveal_path("  "),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            validate_reveal_path("relative/app.app"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn reveal_rejects_store_apps_with_a_platform_error() {
        let err =
            validate_reveal_path(r"shell:AppsFolder\Microsoft.Foo_8wekyb3d8bbwe!App").unwrap_err();
        assert!(matches!(err, AppError::Platform(_)), "got: {err:?}");
    }

    #[test]
    fn reveal_reports_missing_applications() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("gone.app");
        let err = validate_reveal_path(missing.to_str().unwrap()).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }

    #[test]
    fn reveal_accepts_an_existing_absolute_path() {
        let tmp = TempDir::new().unwrap();
        let path = touch(&tmp, "Zoom.lnk");
        assert_eq!(validate_reveal_path(&path).unwrap(), PathBuf::from(&path));
    }

    #[test]
    fn elevation_accepts_only_lnk_and_exe() {
        let tmp = TempDir::new().unwrap();
        assert!(validate_elevatable_path(&touch(&tmp, "Zoom.lnk")).is_ok());
        assert!(validate_elevatable_path(&touch(&tmp, "Zoom.EXE")).is_ok());
        for name in ["run.bat", "notes.txt", "Zoom.app"] {
            let err = validate_elevatable_path(&touch(&tmp, name)).unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "{name}: {err:?}");
        }
    }

    #[test]
    fn elevation_rejects_store_apps() {
        let err = validate_elevatable_path(r"shell:AppsFolder\Microsoft.Foo_8wekyb3d8bbwe!App")
            .unwrap_err();
        assert!(matches!(err, AppError::Platform(_)), "got: {err:?}");
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn run_as_administrator_is_unsupported_off_windows() {
        let tmp = TempDir::new().unwrap();
        let err = run_as_administrator(&touch(&tmp, "Zoom.exe")).unwrap_err();
        assert!(matches!(err, AppError::Platform(_)), "got: {err:?}");
    }

    #[test]
    fn reveal_target_returns_the_path_for_non_shortcuts() {
        let tmp = TempDir::new().unwrap();
        let path = touch(&tmp, "Tool.exe");
        assert_eq!(reveal_target(&path).unwrap(), PathBuf::from(&path));
    }
}
