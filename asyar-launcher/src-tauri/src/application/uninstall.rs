//! Application-uninstall service module.
//!
//! Moves an installed application out of the system. macOS and Windows are
//! supported; Linux is deferred because packaging is too fragmented
//! (apt/dnf/pacman/flatpak/snap/AppImage) for a single-path first-party
//! implementation.
//!
//! - **macOS** — the `.app` bundle is moved to the OS Trash via the `trash`
//!   crate. Fully reversible from Finder's Trash.
//! - **Windows** — the scanner indexes `.lnk` shortcuts. Uninstall resolves
//!   the shortcut's display name against `…\CurrentVersion\Uninstall\*`
//!   registry keys and launches the discovered `UninstallString` via
//!   `cmd /C`. The vendor's own uninstaller UI then takes over; Asyar is
//!   fire-and-forget from that point.
//!
//! The Tauri command wrapper lives at
//! [`crate::commands::applications::uninstall_application`] and is restricted
//! to core callers (the Tier 1 action panel). It is NOT exposed to Tier 2
//! extensions — uninstalling apps is a capability jump beyond the read-only
//! `application:*` namespace.

use crate::error::AppError;
use std::path::{Path, PathBuf};

/// Uninstall the application at `path`. Dispatches to the platform-specific
/// strategy. Linux returns `AppError::Platform` (see module doc comment for
/// why Linux is deferred).
#[cfg(target_os = "macos")]
pub fn uninstall_application(path: &str) -> Result<(), AppError> {
    uninstall_macos(path, resolve_own_bundle_path().as_deref())
}

/// Uninstall the application at `path`. Dispatches to the platform-specific
/// strategy.
#[cfg(target_os = "windows")]
pub fn uninstall_application(path: &str) -> Result<(), AppError> {
    uninstall_windows(path)
}

/// Uninstall the application at `path`. Unsupported on Linux (see module doc
/// comment); returns `AppError::Platform`.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn uninstall_application(_path: &str) -> Result<(), AppError> {
    Err(AppError::Platform(
        "uninstall is only supported on macOS and Windows".to_string(),
    ))
}

// ───── macOS ──────────────────────────────────────────────────────────────

/// Test-visible macOS entrypoint. Accepts `own_bundle_path` explicitly so
/// unit tests can assert the self-bundle guard without spawning a real Tauri
/// app.
#[cfg(target_os = "macos")]
pub(crate) fn uninstall_macos(
    path: &str,
    own_bundle_path: Option<&Path>,
) -> Result<(), AppError> {
    let canonical = validate_macos_bundle_path(path, own_bundle_path)?;
    trash::delete(&canonical)
        .map_err(|e| AppError::Other(format!("Failed to move app to Trash: {}", e)))?;
    Ok(())
}

/// Runs every macOS safety gate and returns the canonicalized path on
/// success. Pulled out of the trash call so every rejection branch has a
/// dedicated test and `trash::delete` only ever sees a vetted path.
#[cfg(target_os = "macos")]
pub(crate) fn validate_macos_bundle_path(
    path: &str,
    own_bundle_path: Option<&Path>,
) -> Result<PathBuf, AppError> {
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
/// against. Returns `None` outside a bundle (e.g. `cargo test`) — safe
/// because no user can select the dev binary in search results.
#[cfg(target_os = "macos")]
fn resolve_own_bundle_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    for ancestor in exe.ancestors() {
        if ancestor.extension().and_then(|e| e.to_str()) == Some("app") {
            return Some(ancestor.to_path_buf());
        }
    }
    None
}

// ───── Windows ─────────────────────────────────────────────────────────────
//
// Pure data + logic types for the Windows flow are compiled on every target
// so their unit tests run on macOS CI too. Only the registry scan and process
// spawn are gated to `target_os = "windows"`.
//
// `#[allow(dead_code)]` is applied to each item below because `cargo clippy
// --lib` (per the project's CI matrix) lints the library in non-test mode:
// on macOS the production code has no caller, so without the allow we'd fail
// -D warnings. Tests + the Windows dispatch path are the real consumers.

/// A single row from one of the three `…\CurrentVersion\Uninstall\*`
/// registry hives. Captured shape-only (no `RegKey` handle) so the matching
/// logic is pure and testable.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WindowsUninstallEntry {
    pub display_name: String,
    pub uninstall_string: String,
    pub system_component: bool,
    pub publisher: Option<String>,
}

/// Display name used for the self-uninstall guard. Matches the Tauri
/// bundler's default installer metadata for this project (`productName` in
/// `tauri.conf.json` == `"asyar"`). Uppercase/mixed-case variants are covered
/// by the case-insensitive comparison.
#[allow(dead_code)]
pub(crate) const ASYAR_WINDOWS_DISPLAY_NAME: &str = "asyar";

/// Validates the shortcut path the user selected before touching the
/// registry. Cross-platform compilable so the logic can be unit-tested on any
/// OS; the `.lnk`-extension check is the meaningful constraint, not
/// target_os.
#[allow(dead_code)]
pub(crate) fn validate_windows_shortcut_path(path: &str) -> Result<PathBuf, AppError> {
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

    if raw.extension().and_then(|e| e.to_str()) != Some("lnk") {
        return Err(AppError::Validation(format!(
            "path must point to a .lnk shortcut: {}",
            path
        )));
    }

    if !raw.exists() {
        return Err(AppError::NotFound(format!(
            "shortcut does not exist: {}",
            path
        )));
    }

    Ok(raw.to_path_buf())
}

/// The scanner indexes `.lnk` shortcuts using the file stem as the app name
/// (see `application::service::sync_application_index`). We reverse that
/// here to recover the display-name the user saw in search, which is what
/// we'll match against the registry's `DisplayName` values.
#[allow(dead_code)]
pub(crate) fn derive_display_name_from_shortcut(lnk: &Path) -> Result<String, AppError> {
    let name = lnk
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .trim();
    if name.is_empty() {
        return Err(AppError::Validation(
            "cannot derive display name from .lnk path".to_string(),
        ));
    }
    Ok(name.to_string())
}

/// Matches the Start-menu `.lnk` display name against registry `DisplayName`
/// values. Tries, in order:
///
/// 1. **Exact case-insensitive match** (handles `Firefox.lnk` → `"Firefox"`
///    when the installer writes a plain name).
/// 2. **Unambiguous case-insensitive starts-with match** (handles
///    `Firefox.lnk` → `"Mozilla Firefox 120.0 (x64 en-US)"` where the
///    installer appends a version/locale suffix). Only wins when exactly one
///    such entry exists — if multiple entries share the prefix, we refuse to
///    guess and treat it as "no match".
///
/// Pure — drives a unit test per match shape without needing a real registry.
#[allow(dead_code)]
pub(crate) fn match_windows_entry<'a>(
    entries: &'a [WindowsUninstallEntry],
    target: &str,
) -> Option<&'a WindowsUninstallEntry> {
    if let Some(exact) = entries
        .iter()
        .find(|e| e.display_name.eq_ignore_ascii_case(target))
    {
        return Some(exact);
    }

    let target_lower = target.to_ascii_lowercase();
    let prefix_matches: Vec<&WindowsUninstallEntry> = entries
        .iter()
        .filter(|e| {
            e.display_name
                .to_ascii_lowercase()
                .starts_with(&target_lower)
        })
        .collect();
    if prefix_matches.len() == 1 {
        return Some(prefix_matches[0]);
    }
    None
}

/// Final allow-list check before spawning the uninstaller. Rejects system
/// components, Asyar's own entry, and malformed rows (empty `UninstallString`).
/// Pure so tests can construct fake entries and assert each rejection.
#[allow(dead_code)]
pub(crate) fn ensure_windows_entry_allowed(
    entry: &WindowsUninstallEntry,
    own_display_name: &str,
) -> Result<(), AppError> {
    if entry.system_component {
        return Err(AppError::Permission(format!(
            "cannot uninstall system component: {}",
            entry.display_name
        )));
    }
    if entry.display_name.eq_ignore_ascii_case(own_display_name) {
        return Err(AppError::Permission(
            "refusing to uninstall Asyar itself".to_string(),
        ));
    }
    if entry.uninstall_string.trim().is_empty() {
        return Err(AppError::Validation(format!(
            "uninstall entry for '{}' has empty UninstallString",
            entry.display_name
        )));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn uninstall_windows(path: &str) -> Result<(), AppError> {
    let lnk = validate_windows_shortcut_path(path)?;
    let display_name = derive_display_name_from_shortcut(&lnk)?;
    let entries = scan_uninstall_registry()?;
    let matched = match_windows_entry(&entries, &display_name).ok_or_else(|| {
        AppError::NotFound(format!(
            "no uninstall registry entry matches '{}'",
            display_name
        ))
    })?;
    ensure_windows_entry_allowed(matched, ASYAR_WINDOWS_DISPLAY_NAME)?;
    spawn_windows_uninstaller(&matched.uninstall_string)
}

/// Scans the three canonical Uninstall hives and returns every entry with
/// both a `DisplayName` and an `UninstallString`. Rows missing either are
/// skipped — they're not uninstallable from a UX perspective.
///
/// Sources, in scan order:
/// 1. `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall` — 64-bit
///    machine-scope installs.
/// 2. `HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`
///    — 32-bit machine-scope installs on 64-bit Windows.
/// 3. `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall` — per-user
///    installs (many modern installers target this).
#[cfg(target_os = "windows")]
fn scan_uninstall_registry() -> Result<Vec<WindowsUninstallEntry>, AppError> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut out = Vec::new();
    collect_entries_from(
        &RegKey::predef(HKEY_LOCAL_MACHINE),
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        &mut out,
    );
    collect_entries_from(
        &RegKey::predef(HKEY_LOCAL_MACHINE),
        r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        &mut out,
    );
    collect_entries_from(
        &RegKey::predef(HKEY_CURRENT_USER),
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        &mut out,
    );
    Ok(out)
}

#[cfg(target_os = "windows")]
fn collect_entries_from(
    root: &winreg::RegKey,
    subpath: &str,
    out: &mut Vec<WindowsUninstallEntry>,
) {
    let uninstall_key = match root.open_subkey(subpath) {
        Ok(k) => k,
        Err(_) => return,
    };
    for name in uninstall_key.enum_keys().flatten() {
        let entry_key = match uninstall_key.open_subkey(&name) {
            Ok(k) => k,
            Err(_) => continue,
        };
        let display_name: String = match entry_key.get_value("DisplayName") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let uninstall_string: String = match entry_key.get_value("UninstallString") {
            Ok(v) => v,
            Err(_) => continue,
        };
        let system_component: u32 = entry_key.get_value("SystemComponent").unwrap_or(0);
        let publisher: Option<String> = entry_key.get_value("Publisher").ok();
        out.push(WindowsUninstallEntry {
            display_name,
            uninstall_string,
            system_component: system_component != 0,
            publisher,
        });
    }
}

/// Spawns the vendor uninstaller via `cmd /C`. Fire-and-forget: the
/// uninstaller runs its own UI (including any UAC elevation prompt); Asyar's
/// job ends once the command is dispatched.
///
/// `cmd /C` handles the quote/space parsing inside `UninstallString` the same
/// way an Add/Remove-Programs double-click would, which is the closest we can
/// get to "behave like the OS's own entry point."
#[cfg(target_os = "windows")]
fn spawn_windows_uninstaller(uninstall_string: &str) -> Result<(), AppError> {
    use std::process::Command;
    Command::new("cmd")
        .args(["/C", uninstall_string])
        .spawn()
        .map_err(|e| {
            AppError::Other(format!(
                "failed to launch uninstaller '{}': {}",
                uninstall_string, e
            ))
        })?;
    Ok(())
}

// ───── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ─── macOS validator tests ──────────────────────────────────────────
    #[cfg(target_os = "macos")]
    mod macos {
        use super::*;
        use std::fs;
        use tempfile::TempDir;

        fn make_fake_app(tmp: &TempDir, name: &str) -> PathBuf {
            let app_path = tmp.path().join(name);
            fs::create_dir_all(&app_path).unwrap();
            fs::create_dir_all(app_path.join("Contents")).unwrap();
            fs::write(app_path.join("Contents/Info.plist"), b"<plist/>").unwrap();
            app_path
        }

        #[test]
        fn rejects_empty_path() {
            let err = validate_macos_bundle_path("", None).unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        }

        #[test]
        fn rejects_whitespace_only_path() {
            let err = validate_macos_bundle_path("   ", None).unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        }

        #[test]
        fn rejects_relative_path() {
            let err = validate_macos_bundle_path("Applications/Foo.app", None).unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        }

        #[test]
        fn rejects_path_without_dot_app_extension() {
            let err = validate_macos_bundle_path("/Applications/not-an-app", None).unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        }

        #[test]
        fn rejects_nonexistent_path() {
            let err = validate_macos_bundle_path(
                "/tmp/__asyar_nonexistent_uninstall_test__.app",
                None,
            )
            .unwrap_err();
            assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
        }

        #[test]
        fn rejects_file_masquerading_as_app_bundle() {
            let tmp = TempDir::new().unwrap();
            let fake = tmp.path().join("Foo.app");
            fs::write(&fake, b"not a directory").unwrap();
            let err = validate_macos_bundle_path(fake.to_str().unwrap(), None).unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        }

        #[test]
        fn rejects_system_applications_path() {
            let candidate = "/System/Applications/Calendar.app";
            let result = validate_macos_bundle_path(candidate, None);
            assert!(result.is_err(), "must not allow /System/ path");
            if let Err(err) = result {
                assert!(
                    matches!(err, AppError::Permission(_) | AppError::NotFound(_)),
                    "got: {err:?}"
                );
            }
        }

        #[test]
        fn rejects_asyars_own_bundle() {
            let tmp = TempDir::new().unwrap();
            let app = make_fake_app(&tmp, "Asyar.app");
            let err = validate_macos_bundle_path(app.to_str().unwrap(), Some(&app)).unwrap_err();
            assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
        }

        #[test]
        fn accepts_valid_user_app() {
            let tmp = TempDir::new().unwrap();
            let app = make_fake_app(&tmp, "SafeApp.app");
            let canonical = validate_macos_bundle_path(app.to_str().unwrap(), None).unwrap();
            assert!(canonical.exists());
            assert_eq!(canonical.extension().and_then(|e| e.to_str()), Some("app"));
        }

        #[test]
        fn own_bundle_guard_does_not_reject_other_apps() {
            let tmp = TempDir::new().unwrap();
            let app = make_fake_app(&tmp, "Other.app");
            let asyar = make_fake_app(&tmp, "Asyar.app");
            let canonical = validate_macos_bundle_path(app.to_str().unwrap(), Some(&asyar)).unwrap();
            assert_eq!(canonical.file_name().and_then(|n| n.to_str()), Some("Other.app"));
        }

        #[test]
        fn uninstall_macos_actually_trashes_bundle() {
            let tmp = TempDir::new().unwrap();
            let app = make_fake_app(&tmp, "TrashMe.app");
            assert!(app.exists());

            uninstall_macos(app.to_str().unwrap(), None).unwrap();

            assert!(
                !app.exists(),
                "bundle should no longer exist at its source path after uninstall"
            );
        }

        #[test]
        fn resolve_own_bundle_path_returns_option_without_panicking() {
            let _ = resolve_own_bundle_path();
        }
    }

    // ─── Windows pure-logic tests ────────────────────────────────────────
    // These run on every target (no cfg gate) — they only exercise in-memory
    // types and case-insensitive string comparisons. The real registry scan
    // and process spawn are gated to Windows and are intentionally not
    // unit-tested here (Windows CI / manual smoke covers them).
    mod windows_logic {
        use super::*;

        fn entry(name: &str, uninstall_string: &str) -> WindowsUninstallEntry {
            WindowsUninstallEntry {
                display_name: name.to_string(),
                uninstall_string: uninstall_string.to_string(),
                system_component: false,
                publisher: None,
            }
        }

        #[test]
        fn match_entry_finds_exact_name() {
            let entries = vec![entry("Firefox", "C:\\uninst.exe")];
            let found = match_windows_entry(&entries, "Firefox").unwrap();
            assert_eq!(found.display_name, "Firefox");
        }

        #[test]
        fn match_entry_is_case_insensitive() {
            let entries = vec![entry("Firefox", "C:\\uninst.exe")];
            assert!(match_windows_entry(&entries, "firefox").is_some());
            assert!(match_windows_entry(&entries, "FIREFOX").is_some());
            assert!(match_windows_entry(&entries, "FiReFoX").is_some());
        }

        #[test]
        fn match_entry_returns_none_for_no_match() {
            let entries = vec![entry("Firefox", "C:\\uninst.exe")];
            assert!(match_windows_entry(&entries, "Chrome").is_none());
        }

        #[test]
        fn match_entry_returns_none_for_empty_list() {
            let entries: Vec<WindowsUninstallEntry> = vec![];
            assert!(match_windows_entry(&entries, "Firefox").is_none());
        }

        #[test]
        fn match_entry_starts_with_fallback_hits_versioned_display_name() {
            // Real-world shape: the Start-menu shortcut is `Mozilla Firefox.lnk`
            // (stem == "Mozilla Firefox"), and the registry DisplayName is
            // "Mozilla Firefox (x64 en-US)" with a version/locale suffix the
            // exact-match pass doesn't catch.
            let entries = vec![entry(
                "Mozilla Firefox (x64 en-US)",
                "uninstall.exe",
            )];
            let found = match_windows_entry(&entries, "Mozilla Firefox").unwrap();
            assert_eq!(found.uninstall_string, "uninstall.exe");
        }

        #[test]
        fn match_entry_starts_with_fallback_is_case_insensitive() {
            let entries = vec![entry("MOZILLA FIREFOX 120.0", "uninstall.exe")];
            let found = match_windows_entry(&entries, "mozilla firefox").unwrap();
            assert_eq!(found.uninstall_string, "uninstall.exe");
        }

        #[test]
        fn match_entry_starts_with_fallback_rejects_substring_in_middle() {
            // Target appears inside the DisplayName but not at the start —
            // the fallback is strictly prefix to avoid matches like
            // "Firefox" → "Mozilla Firefox" that could be intentional but
            // could also collide with unrelated "Firefox Backup" or similar.
            let entries = vec![entry("Mozilla Firefox 120.0", "uninstall.exe")];
            assert!(match_windows_entry(&entries, "Firefox").is_none());
        }

        #[test]
        fn match_entry_prefers_exact_over_prefix_when_both_exist() {
            let entries = vec![
                entry("Firefox Developer Edition", "uninst-dev.exe"),
                entry("Firefox", "uninst.exe"),
            ];
            let found = match_windows_entry(&entries, "Firefox").unwrap();
            // Exact match wins — otherwise the ambiguous-prefix path would
            // refuse to pick and we'd get None.
            assert_eq!(found.display_name, "Firefox");
            assert_eq!(found.uninstall_string, "uninst.exe");
        }

        #[test]
        fn match_entry_refuses_ambiguous_prefix_match() {
            // Two DisplayNames start with "Firefox" and neither is an exact
            // match — refuse to guess; caller surfaces NotFound.
            let entries = vec![
                entry("Firefox Developer Edition", "uninst-dev.exe"),
                entry("Firefox Beta", "uninst-beta.exe"),
            ];
            assert!(match_windows_entry(&entries, "Firefox").is_none());
        }

        #[test]
        fn ensure_allowed_accepts_normal_entry() {
            assert!(ensure_windows_entry_allowed(
                &entry("Firefox", "C:\\uninst.exe"),
                ASYAR_WINDOWS_DISPLAY_NAME,
            )
            .is_ok());
        }

        #[test]
        fn ensure_allowed_rejects_system_component() {
            let mut e = entry("Windows Update", "wusa.exe /uninstall /kb:123456");
            e.system_component = true;
            let err = ensure_windows_entry_allowed(&e, ASYAR_WINDOWS_DISPLAY_NAME).unwrap_err();
            assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
        }

        #[test]
        fn ensure_allowed_rejects_asyar_self_lowercase() {
            let err = ensure_windows_entry_allowed(
                &entry("asyar", "C:\\Program Files\\asyar\\uninstall.exe"),
                ASYAR_WINDOWS_DISPLAY_NAME,
            )
            .unwrap_err();
            assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
        }

        #[test]
        fn ensure_allowed_rejects_asyar_self_capitalized() {
            let err = ensure_windows_entry_allowed(
                &entry("Asyar", "uninstall.exe"),
                ASYAR_WINDOWS_DISPLAY_NAME,
            )
            .unwrap_err();
            assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
        }

        #[test]
        fn ensure_allowed_rejects_empty_uninstall_string() {
            let err = ensure_windows_entry_allowed(&entry("SomeApp", ""), ASYAR_WINDOWS_DISPLAY_NAME)
                .unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        }

        #[test]
        fn ensure_allowed_rejects_whitespace_uninstall_string() {
            let err =
                ensure_windows_entry_allowed(&entry("SomeApp", "   "), ASYAR_WINDOWS_DISPLAY_NAME)
                    .unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        }

        // `\` is not a path separator on non-Windows, so these tests use `/`
        // which Windows' Path API accepts as well. The logic under test
        // (`file_stem()`) is identical either way.
        #[test]
        fn derive_display_name_strips_lnk_extension() {
            let name =
                derive_display_name_from_shortcut(Path::new("/Users/x/Firefox.lnk")).unwrap();
            assert_eq!(name, "Firefox");
        }

        #[test]
        fn derive_display_name_handles_spaces_in_filename() {
            let name = derive_display_name_from_shortcut(Path::new(
                "/Users/x/Visual Studio Code.lnk",
            ))
            .unwrap();
            assert_eq!(name, "Visual Studio Code");
        }

        // Path validation is cross-platform compilable, so run on any target.
        #[test]
        fn shortcut_path_rejects_empty() {
            let err = validate_windows_shortcut_path("").unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        }

        #[test]
        fn shortcut_path_rejects_whitespace_only() {
            let err = validate_windows_shortcut_path("   ").unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        }

        #[test]
        fn shortcut_path_rejects_non_lnk_extension() {
            // Use a platform-absolute path that exists on the runner so we
            // reach the extension check, not the absolute/exists checks.
            // On macOS and Linux `/tmp` exists; on Windows tests we'd hit
            // the absolute check first anyway, which is also a Validation
            // error — either way the assertion holds.
            let err = validate_windows_shortcut_path("/tmp/foo.txt").unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        }

        #[test]
        fn shortcut_path_accepts_existing_dot_lnk() {
            // Create a real file with .lnk extension in a temp dir — the
            // validator doesn't parse shortcut contents, it only checks
            // existence + absolute + extension.
            let tmp = tempfile::TempDir::new().unwrap();
            let lnk = tmp.path().join("Firefox.lnk");
            std::fs::write(&lnk, b"not a real shortcut but file exists").unwrap();
            let result = validate_windows_shortcut_path(lnk.to_str().unwrap());
            assert!(result.is_ok(), "got: {result:?}");
        }
    }

    // ─── Cross-platform dispatch ─────────────────────────────────────────
    #[test]
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn uninstall_application_unsupported_on_linux() {
        let err = uninstall_application("/anything").unwrap_err();
        assert!(matches!(err, AppError::Platform(_)), "got: {err:?}");
    }
}
