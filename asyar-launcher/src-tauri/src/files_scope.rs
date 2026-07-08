//! Pure-function helpers for the `files:read` manifest permission.
//!
//! Mirrors `fs_watcher/matcher.rs` in shape (I/O-free, testable in
//! isolation) but deliberately diverges in policy: `files:read` patterns
//! may anchor anywhere — outside `$HOME`, on another drive, or nowhere at
//! all (`**/steamapps/appmanifest_*.acf`) — because a one-shot bounded
//! read is a different risk profile than a standing watch. The
//! counterweights are that the declared patterns are the ONLY readable
//! scope (the fixed home/app-data/temp roots of `validate_path_allowed`
//! are never unioned in), and a hard deny-list of credential and OS paths
//! that wins even over user-consented patterns.

use crate::error::AppError;
use crate::fs_watcher::matcher::expand_tilde;
use std::path::{Path, PathBuf};

/// Credential stores resolved relative to the user's home directory.
/// Entries for other platforms are inert (the prefix never matches).
const HOME_RELATIVE_DENY: &[&str] = &[
    ".ssh",
    ".aws",
    ".gnupg",
    ".kube",
    ".azure",
    ".docker",
    ".netrc",
    ".git-credentials",
    ".password-store",
    ".config/gcloud",
    // macOS keychains.
    "Library/Keychains",
    // Windows DPAPI master keys and Credential Manager blobs.
    "AppData/Roaming/Microsoft/Protect",
    "AppData/Roaming/Microsoft/Credentials",
    "AppData/Local/Microsoft/Credentials",
];

/// OS locations denied outright. Unix-style entries are inert on Windows
/// and vice versa.
const ABSOLUTE_DENY: &[&str] = &[
    "/etc",
    "/proc",
    "/sys",
    "/dev",
    "/root",
    "/boot",
    "/System",
    "/Library/Keychains",
    "/private/etc",
];

/// Validate a single `files:read` manifest pattern at extension load time.
/// Rejects empty strings, parent-traversal (`..`), and malformed globs —
/// but intentionally NOT patterns anchored outside `$HOME` (unlike
/// `fs:watch`'s `validate_manifest_pattern`): reading e.g.
/// `C:\Program Files (x86)\Steam\**` is the point of the permission.
pub fn validate_files_read_pattern(pattern: &str) -> Result<(), AppError> {
    if pattern.is_empty() {
        return Err(AppError::Validation(
            "files:read pattern must not be empty".into(),
        ));
    }
    if pattern.contains("..") {
        return Err(AppError::Validation(format!(
            "files:read pattern must not contain '..': '{}'",
            pattern
        )));
    }
    globset::Glob::new(pattern).map_err(|e| {
        AppError::Validation(format!(
            "files:read pattern '{}' is not a valid glob: {}",
            pattern, e
        ))
    })?;
    Ok(())
}

/// Compile a single already-tilde-expanded pattern with the platform's
/// case semantics (`original` only feeds the error message). Shared by the
/// coverage check below and `files:glob`'s requested-pattern matcher so
/// both surfaces match identically.
pub fn compile_expanded_glob(expanded: &str, original: &str) -> Result<globset::Glob, AppError> {
    globset::GlobBuilder::new(expanded)
        .case_insensitive(CASE_INSENSITIVE_FS)
        .build()
        .map_err(|e| {
            AppError::Validation(format!(
                "files:read pattern '{}' is not a valid glob: {}",
                original, e
            ))
        })
}

/// Check that `requested` is matched by at least one declared pattern.
/// Patterns are tilde-expanded and compiled into a `GlobSet`; on Windows
/// and macOS they match case-insensitively (NTFS and default-APFS path
/// semantics — a pattern of `D:/SteamLibrary/**` must cover
/// `d:/steamlibrary/...`), keeping coverage consistent with the deny-list
/// comparison below.
pub fn path_covered_by_patterns(
    patterns: &[String],
    requested: &Path,
    home: &Path,
) -> Result<(), AppError> {
    if patterns.is_empty() {
        return Err(AppError::Validation(
            "files:read: extension declared no files:read patterns".into(),
        ));
    }
    let mut builder = globset::GlobSetBuilder::new();
    for p in patterns {
        let expanded = expand_tilde(p, home);
        let as_str = expanded.to_string_lossy().into_owned();
        builder.add(compile_expanded_glob(&as_str, p)?);
    }
    let set = builder.build().map_err(|e| {
        AppError::Validation(format!("files:read: failed to build glob set: {}", e))
    })?;
    if set.is_match(requested) {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "files:read path '{}' is not covered by any declared pattern",
            requested.display()
        )))
    }
}

/// The longest leading run of components containing no glob
/// metacharacters — the concrete directory a scoped enumeration
/// (`files:glob`) can walk from. `C:/Steam/appcache/**/*.jpg` →
/// `C:/Steam/appcache`; a pattern starting with a wildcard
/// (`**/steamapps/...`) yields an empty path, which callers reject —
/// there is no finite root to enumerate.
pub fn glob_literal_prefix(expanded: &Path) -> PathBuf {
    let mut prefix = PathBuf::new();
    for comp in expanded.components() {
        let s = comp.as_os_str().to_string_lossy();
        if s.contains(['*', '?', '[', '{']) {
            break;
        }
        prefix.push(comp);
    }
    prefix
}

/// Cheap pre-walk pruning for `files:glob`: a walk root is plausible when
/// some declared pattern could match files under it — the pattern's own
/// literal prefix contains, or is contained by, the walk root (or the
/// pattern is unanchored and could match anywhere). Per-result coverage
/// still gates every returned path; this exists only so an obviously
/// out-of-scope request (`C:/**` against a `C:/Steam/**` scope) fails fast
/// instead of walking a whole tree to return nothing.
pub fn glob_prefix_plausibly_in_scope(prefix: &Path, patterns: &[String], home: &Path) -> bool {
    patterns.iter().any(|p| {
        let expanded = expand_tilde(p, home);
        let declared_prefix = glob_literal_prefix(&expanded);
        if declared_prefix.as_os_str().is_empty() {
            return true;
        }
        starts_with_case_aware(prefix, &declared_prefix)
            || starts_with_case_aware(&declared_prefix, prefix)
    })
}

/// The full deny-list for a given home directory. Callers append any
/// runtime-only roots (e.g. the launcher's own app-data dir) themselves.
pub fn deny_roots(home: &Path) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = HOME_RELATIVE_DENY
        .iter()
        .map(|rel| home.join(rel))
        .collect();
    roots.extend(ABSOLUTE_DENY.iter().map(PathBuf::from));
    #[cfg(windows)]
    roots.push(PathBuf::from(
        std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into()),
    ));
    roots
}

/// Deny the read if `path` sits under any protected root — even when a
/// declared (and user-consented) pattern covers it. `path` must already be
/// normalized (no `.`/`..` components).
pub fn check_path_denied(path: &Path, home: &Path, extra_deny: &[PathBuf]) -> Result<(), AppError> {
    for root in deny_roots(home).iter().chain(extra_deny.iter()) {
        if starts_with_case_aware(path, root) {
            return Err(AppError::Permission(format!(
                "files:read: path '{}' is inside the protected location '{}'",
                path.display(),
                root.display()
            )));
        }
    }
    Ok(())
}

/// Platforms whose default filesystems compare paths case-insensitively
/// (NTFS; APFS/HFS+ as shipped). The deny-list fails OPEN on a case
/// mismatch, so both the glob coverage and the prefix check below must
/// follow the filesystem's semantics.
const CASE_INSENSITIVE_FS: bool = cfg!(any(windows, target_os = "macos"));

/// Component-wise prefix check, case-insensitive on Windows and macOS so
/// `c:\windows\...` or `~/library/keychains/...` can't sidestep a
/// protected root.
fn starts_with_case_aware(path: &Path, root: &Path) -> bool {
    if path.starts_with(root) {
        return true;
    }
    if CASE_INSENSITIVE_FS {
        let p = path.to_string_lossy().to_lowercase();
        let r = root.to_string_lossy().to_lowercase();
        return Path::new(&p).starts_with(Path::new(&r));
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from("/Users/test")
    }

    // ---- validate_files_read_pattern ----

    #[test]
    fn accepts_pattern_under_home() {
        assert!(validate_files_read_pattern("~/Documents/**").is_ok());
    }

    #[test]
    fn accepts_pattern_outside_home() {
        // The deliberate divergence from fs:watch — absolute anchors
        // anywhere are fine at load time.
        assert!(validate_files_read_pattern("C:/Program Files (x86)/Steam/**").is_ok());
        assert!(validate_files_read_pattern("/opt/some-app/config.toml").is_ok());
    }

    #[test]
    fn accepts_unanchored_pattern() {
        assert!(validate_files_read_pattern("**/steamapps/appmanifest_*.acf").is_ok());
    }

    #[test]
    fn rejects_empty_pattern() {
        assert!(validate_files_read_pattern("").is_err());
    }

    #[test]
    fn rejects_parent_traversal() {
        assert!(validate_files_read_pattern("~/Documents/../../etc/**").is_err());
    }

    #[test]
    fn rejects_malformed_glob() {
        assert!(validate_files_read_pattern("~/[unclosed").is_err());
    }

    // ---- path_covered_by_patterns ----

    #[test]
    fn covers_exact_match() {
        let patterns = vec!["/opt/app/config.toml".to_string()];
        assert!(
            path_covered_by_patterns(&patterns, Path::new("/opt/app/config.toml"), &home()).is_ok()
        );
    }

    #[test]
    fn covers_tilde_expanded_pattern() {
        let patterns = vec!["~/Documents/**".to_string()];
        assert!(path_covered_by_patterns(
            &patterns,
            Path::new("/Users/test/Documents/notes/a.txt"),
            &home()
        )
        .is_ok());
    }

    #[test]
    fn unanchored_pattern_covers_any_drive() {
        // The motivating Steam case: appmanifest files live on arbitrary,
        // user-configured library drives. A leading `**/` matches any
        // absolute prefix, so one static manifest pattern covers them all.
        let patterns = vec!["**/steamapps/appmanifest_*.acf".to_string()];
        for p in [
            "C:/Program Files (x86)/Steam/steamapps/appmanifest_105600.acf",
            "D:/SteamLibrary/steamapps/appmanifest_1245620.acf",
            "B:/Games/Steam/steamapps/appmanifest_400.acf",
        ] {
            assert!(
                path_covered_by_patterns(&patterns, Path::new(p), &home()).is_ok(),
                "expected coverage for {p}"
            );
        }
    }

    #[test]
    fn rejects_uncovered_path() {
        let patterns = vec!["**/steamapps/appmanifest_*.acf".to_string()];
        let err =
            path_covered_by_patterns(&patterns, Path::new("/Users/test/.ssh/id_rsa"), &home())
                .unwrap_err();
        assert!(format!("{err}").contains("not covered"), "got: {err}");
    }

    #[test]
    fn errors_on_empty_patterns() {
        let err = path_covered_by_patterns(&[], Path::new("/Users/test/foo"), &home()).unwrap_err();
        assert!(
            format!("{err}").contains("no files:read patterns"),
            "got: {err}"
        );
    }

    // ---- check_path_denied ----

    #[test]
    fn denies_ssh_under_home() {
        let err =
            check_path_denied(Path::new("/Users/test/.ssh/id_rsa"), &home(), &[]).unwrap_err();
        assert!(
            format!("{err}").contains("protected location"),
            "got: {err}"
        );
    }

    #[test]
    fn denies_etc() {
        assert!(check_path_denied(Path::new("/etc/shadow"), &home(), &[]).is_err());
    }

    #[test]
    fn deny_is_component_wise_not_string_prefix() {
        // `/etcetera` must not be caught by the `/etc` root, and a
        // `.ssh-backup` dir is not `.ssh`.
        assert!(check_path_denied(Path::new("/etcetera/notes.txt"), &home(), &[]).is_ok());
        assert!(check_path_denied(Path::new("/Users/test/.ssh-backup/key"), &home(), &[]).is_ok());
    }

    #[test]
    fn allows_ordinary_paths() {
        assert!(
            check_path_denied(Path::new("/Users/test/Documents/notes.txt"), &home(), &[]).is_ok()
        );
        assert!(check_path_denied(
            Path::new("D:/SteamLibrary/steamapps/appmanifest_400.acf"),
            &home(),
            &[]
        )
        .is_ok());
    }

    #[test]
    fn extra_deny_roots_are_enforced() {
        let extra = vec![PathBuf::from("/Users/test/AppData/Roaming/org.asyar.app")];
        let err = check_path_denied(
            Path::new("/Users/test/AppData/Roaming/org.asyar.app/settings.dat"),
            &home(),
            &extra,
        )
        .unwrap_err();
        assert!(
            format!("{err}").contains("protected location"),
            "got: {err}"
        );
    }

    // ---- glob_literal_prefix ----

    #[test]
    fn literal_prefix_stops_at_first_metacharacter() {
        assert_eq!(
            glob_literal_prefix(Path::new("/opt/steam/appcache/**/*.jpg")),
            PathBuf::from("/opt/steam/appcache")
        );
        assert_eq!(
            glob_literal_prefix(Path::new("/opt/steam/appcache/1?5/icon.jpg")),
            PathBuf::from("/opt/steam/appcache")
        );
    }

    #[test]
    fn literal_prefix_of_unanchored_pattern_is_empty() {
        assert_eq!(
            glob_literal_prefix(Path::new("**/steamapps/appmanifest_*.acf")),
            PathBuf::new()
        );
    }

    #[test]
    fn literal_prefix_of_fully_literal_path_is_the_path() {
        assert_eq!(
            glob_literal_prefix(Path::new("/opt/app/config.toml")),
            PathBuf::from("/opt/app/config.toml")
        );
    }

    // ---- glob_prefix_plausibly_in_scope ----

    #[test]
    fn prefix_inside_declared_scope_is_plausible() {
        let patterns = vec!["/opt/steam/**".to_string()];
        assert!(glob_prefix_plausibly_in_scope(
            Path::new("/opt/steam/appcache"),
            &patterns,
            &home()
        ));
    }

    #[test]
    fn prefix_above_declared_scope_is_plausible() {
        // Walking /opt/steam with a deeper declared scope is fine — the
        // per-result coverage filter keeps only in-scope hits.
        let patterns = vec!["/opt/steam/appcache/**".to_string()];
        assert!(glob_prefix_plausibly_in_scope(
            Path::new("/opt/steam"),
            &patterns,
            &home()
        ));
    }

    #[test]
    fn disjoint_prefix_is_not_plausible() {
        let patterns = vec!["/opt/steam/**".to_string()];
        assert!(!glob_prefix_plausibly_in_scope(
            Path::new("/var/log"),
            &patterns,
            &home()
        ));
    }

    #[test]
    fn unanchored_declared_pattern_makes_any_prefix_plausible() {
        let patterns = vec!["**/steamapps/appmanifest_*.acf".to_string()];
        assert!(glob_prefix_plausibly_in_scope(
            Path::new("/var/log"),
            &patterns,
            &home()
        ));
    }

    #[test]
    fn empty_declared_patterns_are_never_plausible() {
        assert!(!glob_prefix_plausibly_in_scope(
            Path::new("/opt/steam"),
            &[],
            &home()
        ));
    }

    #[test]
    fn tilde_declared_pattern_is_expanded_before_prefix_comparison() {
        let patterns = vec!["~/steam/**".to_string()];
        assert!(glob_prefix_plausibly_in_scope(
            Path::new("/Users/test/steam/appcache"),
            &patterns,
            &home()
        ));
        assert!(!glob_prefix_plausibly_in_scope(
            Path::new("/Users/other/steam"),
            &patterns,
            &home()
        ));
    }

    #[test]
    fn deny_beats_covering_pattern() {
        // The exact scenario the deny-list exists for: a broad consented
        // glob must not quietly cover credentials.
        let patterns = vec!["~/**".to_string()];
        let requested = Path::new("/Users/test/.aws/credentials");
        assert!(path_covered_by_patterns(&patterns, requested, &home()).is_ok());
        assert!(check_path_denied(requested, &home(), &[]).is_err());
    }
}
