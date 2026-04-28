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
use serde::Serialize;
use std::path::{Path, PathBuf};

// ───── Data-scan types (used by both macOS runtime + cross-platform tests) ──

/// A single filesystem entry associated with an installed application, as
/// returned by the uninstall scanner. All paths are absolute; `size_bytes`
/// is the total for a directory (recursive) or the file size.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppDataPath {
    pub path: String,
    pub size_bytes: u64,
    pub category: String,
}

/// The complete scan result shown in the confirm sheet before uninstall.
/// The frontend renders `app_path` + `data_paths` as a list with per-row
/// sizes and a `total_bytes` footer.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UninstallScanResult {
    pub app_path: String,
    pub app_size_bytes: u64,
    pub data_paths: Vec<AppDataPath>,
    pub total_bytes: u64,
}

/// Uninstall the application at `path` and optionally trash a set of
/// associated `data_paths` (macOS only — typically produced by
/// [`scan_app_data`] + user confirmation). Dispatches to the platform-
/// specific strategy. Linux returns `AppError::Platform`.
///
/// Windows ignores `data_paths` because the vendor's own uninstaller
/// already handles user-data cleanup; Asyar's job there is just to launch
/// that uninstaller.
#[cfg(target_os = "macos")]
pub fn uninstall_application(path: &str, data_paths: &[String]) -> Result<(), AppError> {
    uninstall_macos(path, resolve_own_bundle_path().as_deref(), data_paths)
}

/// See [`uninstall_application`] (macOS doc above). Windows ignores
/// `data_paths`; see module doc.
#[cfg(target_os = "windows")]
pub fn uninstall_application(path: &str, _data_paths: &[String]) -> Result<(), AppError> {
    uninstall_windows(path)
}

/// Unsupported on Linux — see module doc comment.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn uninstall_application(_path: &str, _data_paths: &[String]) -> Result<(), AppError> {
    Err(AppError::Platform(
        "uninstall is only supported on macOS and Windows".to_string(),
    ))
}

// ───── macOS ──────────────────────────────────────────────────────────────

/// Test-visible macOS entrypoint. Accepts `own_bundle_path` explicitly so
/// unit tests can assert the self-bundle guard without spawning a real Tauri
/// app. `data_paths` is best-effort — a validation or trash failure on a
/// single data path logs a warning and continues; the `.app` itself is the
/// primary success criterion.
#[cfg(target_os = "macos")]
pub(crate) fn uninstall_macos(
    path: &str,
    own_bundle_path: Option<&Path>,
    data_paths: &[String],
) -> Result<(), AppError> {
    let canonical_app = validate_macos_bundle_path(path, own_bundle_path)?;

    // Validate every data path up-front before we touch anything, so a
    // bogus entry can't sneak through after the app is already in Trash.
    let home = dirs::home_dir().ok_or_else(|| {
        AppError::Other("failed to resolve home directory for data-path validation".to_string())
    })?;
    let mut validated: Vec<PathBuf> = Vec::with_capacity(data_paths.len());
    for dp in data_paths {
        match validate_data_path_under_home(dp, &home) {
            Ok(canonical) => validated.push(canonical),
            Err(e) => log::warn!(
                "skipping uninstall data path '{}': {}",
                dp,
                e
            ),
        }
    }

    trash::delete(&canonical_app)
        .map_err(|e| AppError::Other(format!("Failed to move app to Trash: {}", e)))?;

    // App already trashed; data-path failures are non-fatal from here on.
    for p in validated {
        if let Err(e) = trash::delete(&p) {
            log::warn!(
                "failed to trash data path '{}': {}",
                p.display(),
                e
            );
        }
    }

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

/// Scans macOS `~/Library/*` subfolders for data left by an application and
/// returns every hit with its on-disk size. Runs entirely off `$HOME`, so a
/// test can point it at a fake home directory via `scan_app_data_in`.
///
/// Conservative by design:
/// - Skips symlinks (they may point into shared/cloud-linked storage).
/// - Skips `~/Library/Group Containers/` (shared between multiple apps).
/// - Skips `/Library/...` system locations (would need admin to remove).
/// - Skips keychains (need the user's password to delete cleanly).
///
/// Callers should treat the result as opt-out: show the list to the user
/// and let them confirm the total before anything is moved to Trash.
#[cfg(target_os = "macos")]
pub fn scan_app_data(bundle_id: Option<&str>, app_name: &str) -> Vec<AppDataPath> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    scan_app_data_in(&home, bundle_id, app_name)
}

/// Test-visible core. Accepts the home directory explicitly so unit tests
/// can populate a temp dir with fixtures and assert what the scanner finds.
/// Defined unconditionally (not cfg'd to macOS) because its logic is pure
/// filesystem work and the tests run on every CI platform.
#[allow(dead_code)]
pub(crate) fn scan_app_data_in(
    home: &Path,
    bundle_id: Option<&str>,
    app_name: &str,
) -> Vec<AppDataPath> {
    let mut out = Vec::new();

    // Directory candidates keyed by bundle id.
    if let Some(bid) = bundle_id {
        for (subdir, category) in APPDATA_BUNDLE_DIR_CANDIDATES {
            let path = home.join(subdir).join(bid);
            push_if_exists(&path, category, &mut out);
        }
        for (subdir, ext, category) in APPDATA_BUNDLE_FILE_CANDIDATES {
            let file = home.join(subdir).join(format!("{}.{}", bid, ext));
            push_if_exists(&file, category, &mut out);
        }
        // ByHost preferences: files like `<bundle-id>.<uuid>.plist`.
        scan_byhost_preferences(&home.join("Library/Preferences/ByHost"), bid, &mut out);
    }

    // Name-keyed fallbacks — some apps write to their display name rather
    // than their bundle id (e.g. `~/Library/Application Support/Spotify`).
    for (subdir, category) in APPDATA_NAME_DIR_CANDIDATES {
        let path = home.join(subdir).join(app_name);
        // Don't double-report a path we already matched by bundle id.
        if out.iter().any(|p| p.path == path.to_string_lossy()) {
            continue;
        }
        push_if_exists(&path, category, &mut out);
    }

    out
}

#[allow(dead_code)]
const APPDATA_BUNDLE_DIR_CANDIDATES: &[(&str, &str)] = &[
    ("Library/Application Support", "Application data"),
    ("Library/Caches", "Cache"),
    ("Library/Logs", "Logs"),
    ("Library/Containers", "Sandbox container"),
    ("Library/HTTPStorages", "HTTP storage"),
    ("Library/WebKit", "WebKit storage"),
    ("Library/Application Scripts", "Application scripts"),
];

#[allow(dead_code)]
const APPDATA_BUNDLE_FILE_CANDIDATES: &[(&str, &str, &str)] = &[
    ("Library/Preferences", "plist", "Preferences"),
    ("Library/Saved Application State", "savedState", "Saved window state"),
    ("Library/LaunchAgents", "plist", "Launch agent"),
    ("Library/Cookies", "binarycookies", "Cookies"),
];

#[allow(dead_code)]
const APPDATA_NAME_DIR_CANDIDATES: &[(&str, &str)] = &[
    ("Library/Application Support", "Application data (name-keyed)"),
    ("Library/Caches", "Cache (name-keyed)"),
];

#[allow(dead_code)]
fn push_if_exists(path: &Path, category: &str, out: &mut Vec<AppDataPath>) {
    // `symlink_metadata` doesn't follow the link — we want to know if the
    // thing AT the path is itself a symlink and skip it.
    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return,
    };
    if meta.file_type().is_symlink() {
        return;
    }
    let size = if meta.is_dir() {
        dir_size_bytes(path)
    } else {
        meta.len()
    };
    out.push(AppDataPath {
        path: path.to_string_lossy().into_owned(),
        size_bytes: size,
        category: category.to_string(),
    });
}

#[allow(dead_code)]
fn scan_byhost_preferences(byhost_dir: &Path, bundle_id: &str, out: &mut Vec<AppDataPath>) {
    let entries = match std::fs::read_dir(byhost_dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    let prefix = format!("{}.", bundle_id);
    for entry in entries.flatten() {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if !name.starts_with(&prefix) || !name.ends_with(".plist") {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        out.push(AppDataPath {
            path: path.to_string_lossy().into_owned(),
            size_bytes: meta.len(),
            category: "ByHost preference".to_string(),
        });
    }
}

/// Recursive size totaller. Best-effort — unreadable subdirs and broken
/// symlinks are silently skipped. Does not follow symlinks.
#[allow(dead_code)]
pub(crate) fn dir_size_bytes(path: &Path) -> u64 {
    fn walk(path: &Path, total: &mut u64) {
        let entries = match std::fs::read_dir(path) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            // symlink_metadata (not metadata) to avoid following into the
            // linked target's size — caller wanted on-disk size of this
            // directory tree, not the world it links out to.
            let Ok(meta) = entry.file_type() else {
                continue;
            };
            if meta.is_symlink() {
                continue;
            }
            if meta.is_file() {
                if let Ok(md) = entry.metadata() {
                    *total = total.saturating_add(md.len());
                }
            } else if meta.is_dir() {
                walk(&entry.path(), total);
            }
        }
    }
    let mut total = 0u64;
    walk(path, &mut total);
    total
}

/// Validates that a candidate data path is safe for Asyar to trash on the
/// user's behalf. Pulled out of the command body so every rejection branch
/// has a dedicated unit test. Cross-platform compilable — the constraints
/// (abs + exists + under `$HOME/Library` + not a symlink) make sense on any
/// unix-family filesystem even though only macOS currently invokes it.
#[allow(dead_code)]
pub(crate) fn validate_data_path_under_home(
    path: &str,
    home: &Path,
) -> Result<PathBuf, AppError> {
    if path.trim().is_empty() {
        return Err(AppError::Validation("data path must be non-empty".to_string()));
    }
    let raw = Path::new(path);
    if !raw.is_absolute() {
        return Err(AppError::Validation(format!(
            "data path must be absolute: {}",
            path
        )));
    }
    let meta = std::fs::symlink_metadata(raw).map_err(|_| {
        AppError::NotFound(format!("data path does not exist: {}", path))
    })?;
    if meta.file_type().is_symlink() {
        return Err(AppError::Validation(format!(
            "refusing to follow symlink: {}",
            path
        )));
    }
    let canonical = raw.canonicalize().map_err(|e| {
        AppError::Other(format!(
            "failed to canonicalize data path '{}': {}",
            path, e
        ))
    })?;
    let library_root = home.join("Library");
    let canonical_library = library_root.canonicalize().unwrap_or(library_root);
    if !canonical.starts_with(&canonical_library) {
        return Err(AppError::Permission(format!(
            "data path is outside ~/Library and cannot be trashed by Asyar: {}",
            path
        )));
    }
    Ok(canonical)
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

            uninstall_macos(app.to_str().unwrap(), None, &[]).unwrap();

            assert!(
                !app.exists(),
                "bundle should no longer exist at its source path after uninstall"
            );
        }

        #[test]
        fn uninstall_macos_ignores_bogus_data_paths_but_still_trashes_app() {
            // Invalid data paths (non-existent, outside home) should be
            // dropped with a warning, not block the primary uninstall.
            let tmp = TempDir::new().unwrap();
            let app = make_fake_app(&tmp, "TrashMe2.app");

            let bogus_paths = vec![
                "/tmp/__definitely_not_real__".to_string(),
                "/etc/passwd".to_string(), // exists but outside ~/Library
                "relative/path".to_string(),
            ];

            let result = uninstall_macos(app.to_str().unwrap(), None, &bogus_paths);

            assert!(result.is_ok(), "got: {result:?}");
            assert!(!app.exists(), "app itself should still be trashed");
        }

        #[test]
        fn resolve_own_bundle_path_returns_option_without_panicking() {
            let _ = resolve_own_bundle_path();
        }
    }

    // ─── Data-scan tests (run on every target — pure filesystem logic) ──
    mod data_scan {
        use super::*;
        use std::fs;
        use tempfile::TempDir;

        /// Helper: set up a fake `$HOME/Library` tree inside a temp dir.
        fn fake_home() -> TempDir {
            let home = TempDir::new().unwrap();
            fs::create_dir_all(home.path().join("Library")).unwrap();
            home
        }

        fn write_file(path: &Path, contents: &[u8]) {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, contents).unwrap();
        }

        fn make_dir_with_file(path: &Path, contents: &[u8]) {
            fs::create_dir_all(path).unwrap();
            fs::write(path.join("data.bin"), contents).unwrap();
        }

        #[test]
        fn scan_returns_empty_when_nothing_matches() {
            let home = fake_home();
            let hits = scan_app_data_in(home.path(), Some("com.example.Nope"), "Nope");
            assert!(hits.is_empty());
        }

        #[test]
        fn scan_finds_bundle_id_keyed_application_support() {
            let home = fake_home();
            let bid = "com.example.Widget";
            let support = home
                .path()
                .join("Library/Application Support")
                .join(bid);
            make_dir_with_file(&support, b"hello world");

            let hits = scan_app_data_in(home.path(), Some(bid), "Widget");

            assert!(hits.iter().any(|h| h.path == support.to_string_lossy()));
        }

        #[test]
        fn scan_finds_bundle_id_keyed_preferences_plist() {
            let home = fake_home();
            let bid = "com.example.Widget";
            let plist = home
                .path()
                .join("Library/Preferences")
                .join(format!("{}.plist", bid));
            write_file(&plist, b"<plist></plist>");

            let hits = scan_app_data_in(home.path(), Some(bid), "Widget");

            let found = hits.iter().find(|h| h.path == plist.to_string_lossy()).unwrap();
            assert_eq!(found.category, "Preferences");
            assert!(found.size_bytes > 0);
        }

        #[test]
        fn scan_finds_byhost_preferences_matching_bundle_id_prefix() {
            let home = fake_home();
            let bid = "com.example.Widget";
            let byhost = home.path().join("Library/Preferences/ByHost");
            let f1 = byhost.join(format!("{}.ABC-123.plist", bid));
            let f2 = byhost.join(format!("{}.DEF-456.plist", bid));
            let unrelated = byhost.join("com.other.app.ABC-123.plist");
            write_file(&f1, b"1");
            write_file(&f2, b"1");
            write_file(&unrelated, b"1");

            let hits = scan_app_data_in(home.path(), Some(bid), "Widget");
            let byhost_hits: Vec<_> = hits
                .iter()
                .filter(|h| h.category == "ByHost preference")
                .collect();

            assert_eq!(byhost_hits.len(), 2, "should match both bundle-id entries only");
            assert!(byhost_hits.iter().any(|h| h.path.ends_with("ABC-123.plist")));
            assert!(byhost_hits.iter().any(|h| h.path.ends_with("DEF-456.plist")));
        }

        #[test]
        fn scan_finds_name_keyed_application_support_as_fallback() {
            let home = fake_home();
            let name = "Spotify";
            // No bundle-id-keyed dir — only name-keyed.
            let name_dir = home.path().join("Library/Application Support").join(name);
            make_dir_with_file(&name_dir, b"x");

            let hits = scan_app_data_in(home.path(), Some("com.spotify.client"), name);

            assert!(hits.iter().any(|h| h.path == name_dir.to_string_lossy()));
        }

        #[test]
        fn scan_does_not_double_count_same_path() {
            let home = fake_home();
            // Contrived: bundle id equals the app name, so bundle-keyed and
            // name-keyed scans would target the same dir. De-dup must prevent
            // duplicate entries.
            let shared = "SharedName";
            let dir = home
                .path()
                .join("Library/Application Support")
                .join(shared);
            make_dir_with_file(&dir, b"x");

            let hits = scan_app_data_in(home.path(), Some(shared), shared);
            let same: Vec<_> = hits
                .iter()
                .filter(|h| h.path == dir.to_string_lossy())
                .collect();
            assert_eq!(same.len(), 1, "path should appear exactly once: {:?}", hits);
        }

        #[test]
        fn scan_skips_symlinks() {
            // Symlinks can point into shared/cloud-backed storage; trashing
            // them could cascade into the target's contents on some
            // filesystems. Always skip.
            #[cfg(unix)]
            {
                use std::os::unix::fs::symlink;

                let home = fake_home();
                let bid = "com.example.Widget";
                let real = home.path().join("real_dir");
                fs::create_dir_all(&real).unwrap();
                let link = home
                    .path()
                    .join("Library/Application Support")
                    .join(bid);
                fs::create_dir_all(link.parent().unwrap()).unwrap();
                symlink(&real, &link).unwrap();

                let hits = scan_app_data_in(home.path(), Some(bid), "Widget");
                assert!(
                    !hits.iter().any(|h| h.path == link.to_string_lossy()),
                    "symlink entry must be skipped"
                );
            }
        }

        #[test]
        fn dir_size_bytes_sums_nested_files() {
            let tmp = TempDir::new().unwrap();
            let root = tmp.path().join("tree");
            write_file(&root.join("a.bin"), &[0u8; 100]);
            write_file(&root.join("sub/b.bin"), &[0u8; 200]);
            write_file(&root.join("sub/deep/c.bin"), &[0u8; 50]);

            let total = dir_size_bytes(&root);
            assert_eq!(total, 350);
        }

        #[test]
        fn dir_size_bytes_returns_zero_for_missing_dir() {
            let total = dir_size_bytes(Path::new("/tmp/__asyar_definitely_not_a_dir__"));
            assert_eq!(total, 0);
        }

        #[test]
        fn validate_data_path_rejects_empty() {
            let tmp = fake_home();
            let err = validate_data_path_under_home("", tmp.path()).unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        }

        #[test]
        fn validate_data_path_rejects_relative() {
            let tmp = fake_home();
            let err = validate_data_path_under_home("relative/foo", tmp.path()).unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
        }

        #[test]
        fn validate_data_path_rejects_missing() {
            let tmp = fake_home();
            let err = validate_data_path_under_home(
                "/tmp/__asyar_nonexistent_data_path__",
                tmp.path(),
            )
            .unwrap_err();
            assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
        }

        #[test]
        fn validate_data_path_rejects_outside_home_library() {
            let tmp = fake_home();
            // Create a file OUTSIDE the fake home dir — using the process
            // temp dir so it definitely exists but isn't under home.
            let outside_dir = TempDir::new().unwrap();
            let outside = outside_dir.path().join("escape.txt");
            fs::write(&outside, b"x").unwrap();

            let err =
                validate_data_path_under_home(outside.to_str().unwrap(), tmp.path()).unwrap_err();
            assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
        }

        #[test]
        fn validate_data_path_accepts_file_inside_home_library() {
            let tmp = fake_home();
            let inside = tmp.path().join("Library/Application Support/com.example.Widget");
            fs::create_dir_all(&inside).unwrap();
            fs::write(inside.join("data.bin"), b"hello").unwrap();

            let result = validate_data_path_under_home(inside.to_str().unwrap(), tmp.path());
            assert!(result.is_ok(), "got: {result:?}");
        }

        #[test]
        fn validate_data_path_rejects_symlink() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::symlink;

                let tmp = fake_home();
                let real = tmp.path().join("real.txt");
                fs::write(&real, b"x").unwrap();
                let link = tmp.path().join("Library/link.txt");
                fs::create_dir_all(link.parent().unwrap()).unwrap();
                symlink(&real, &link).unwrap();

                let err =
                    validate_data_path_under_home(link.to_str().unwrap(), tmp.path()).unwrap_err();
                assert!(matches!(err, AppError::Validation(_)), "got: {err:?}");
            }
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
        let err = uninstall_application("/anything", &[]).unwrap_err();
        assert!(matches!(err, AppError::Platform(_)), "got: {err:?}");
    }
}
