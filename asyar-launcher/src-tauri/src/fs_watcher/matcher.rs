//! Pure-function helpers for the fs:watch manifest permission.
//!
//! Kept deliberately free of I/O and Tauri types so the glob / tilde /
//! pattern-validation logic is testable in isolation.

use crate::error::AppError;
use std::path::{Path, PathBuf};

/// Expand a leading `~/` or bare `~` to the given home directory.
/// Any other leading sequence (including a tilde not at index 0) is
/// left untouched.
pub fn expand_tilde(input: &str, home: &Path) -> PathBuf {
    if input == "~" {
        return home.to_path_buf();
    }
    if let Some(rest) = input.strip_prefix("~/") {
        return home.join(rest);
    }
    PathBuf::from(input)
}

/// Validate a single `fs:watch` manifest pattern at extension load time.
/// Rejects empty strings, parent-traversal (`..`), malformed globs, and
/// any pattern whose literal prefix doesn't resolve under `$HOME` or
/// `/tmp`.
pub fn validate_manifest_pattern(pattern: &str, home: &Path) -> Result<(), AppError> {
    if pattern.is_empty() {
        return Err(AppError::Validation(
            "fs:watch pattern must not be empty".into(),
        ));
    }
    if pattern.contains("..") {
        return Err(AppError::Validation(format!(
            "fs:watch pattern must not contain '..': '{}'",
            pattern
        )));
    }
    globset::Glob::new(pattern).map_err(|e| {
        AppError::Validation(format!(
            "fs:watch pattern '{}' is not a valid glob: {}",
            pattern, e
        ))
    })?;
    let expanded = expand_tilde(pattern, home);
    let literal_prefix = literal_prefix(&expanded);
    let tmp = Path::new("/tmp");
    if literal_prefix.starts_with(home) || literal_prefix.starts_with(tmp) {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "fs:watch pattern '{}' must resolve under $HOME or /tmp",
            pattern
        )))
    }
}

/// Check that every `requested` path is matched by at least one of
/// `patterns`. Patterns are expanded via `expand_tilde` and compiled into
/// a `GlobSet` for efficient multi-pattern matching. Returns the first
/// uncovered path as an `AppError::Validation`.
pub fn paths_covered_by_patterns(
    patterns: &[String],
    requested: &[PathBuf],
    home: &Path,
) -> Result<(), AppError> {
    if patterns.is_empty() {
        return Err(AppError::Validation(
            "fs:watch: extension declared no fs:watch patterns".into(),
        ));
    }
    let mut builder = globset::GlobSetBuilder::new();
    for p in patterns {
        let expanded = expand_tilde(p, home);
        let as_str = expanded.to_string_lossy().into_owned();
        let glob = globset::Glob::new(&as_str).map_err(|e| {
            AppError::Validation(format!(
                "fs:watch pattern '{}' is not a valid glob: {}",
                p, e
            ))
        })?;
        builder.add(glob);
        // Extensions typically call watch(['<root>']) where `<root>` is
        // the bare directory. `a/**` doesn't match `a` itself in globset,
        // so when the pattern ends with `/**` also accept the bare prefix.
        if let Some(stripped) = as_str.strip_suffix("/**") {
            if !stripped.is_empty() {
                if let Ok(bare) = globset::Glob::new(stripped) {
                    builder.add(bare);
                }
            }
        }
    }
    let set = builder.build().map_err(|e| {
        AppError::Validation(format!("fs:watch: failed to build glob set: {}", e))
    })?;
    for r in requested {
        if !set.is_match(r) {
            return Err(AppError::Validation(format!(
                "fs:watch path '{}' is not covered by any declared pattern",
                r.display()
            )));
        }
    }
    Ok(())
}

/// Return the portion of `path` up to (but not including) the first
/// component that contains a glob metacharacter. The returned prefix is
/// the concrete directory the pattern is anchored under, which is what
/// we check against the `$HOME` / `/tmp` allow-list.
fn literal_prefix(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        let s = component.as_os_str().to_string_lossy();
        if s.contains(['*', '?', '[', '{']) {
            break;
        }
        out.push(component);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from("/Users/test")
    }

    #[test]
    fn leaves_absolute_path_unchanged() {
        assert_eq!(expand_tilde("/tmp/foo", &home()), PathBuf::from("/tmp/foo"));
    }

    #[test]
    fn expands_tilde_slash_prefix() {
        assert_eq!(
            expand_tilde("~/Library/Shortcuts", &home()),
            PathBuf::from("/Users/test/Library/Shortcuts")
        );
    }

    #[test]
    fn expands_bare_tilde() {
        assert_eq!(expand_tilde("~", &home()), PathBuf::from("/Users/test"));
    }

    #[test]
    fn leaves_tilde_inside_path_unchanged() {
        assert_eq!(
            expand_tilde("/tmp/~foo", &home()),
            PathBuf::from("/tmp/~foo")
        );
    }

    #[test]
    fn leaves_empty_string_as_empty() {
        assert_eq!(expand_tilde("", &home()), PathBuf::from(""));
    }

    // ---- validate_manifest_pattern ----

    #[test]
    fn accepts_pattern_under_home() {
        assert!(validate_manifest_pattern("~/Library/Shortcuts/**", &home()).is_ok());
    }

    #[test]
    fn accepts_pattern_under_tmp() {
        assert!(validate_manifest_pattern("/tmp/smoke/**", &home()).is_ok());
    }

    #[test]
    fn rejects_pattern_under_etc() {
        let err = validate_manifest_pattern("/etc/passwd", &home()).unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("must resolve"), "got: {msg}");
    }

    #[test]
    fn rejects_parent_traversal() {
        assert!(validate_manifest_pattern("~/Library/../../../etc", &home()).is_err());
    }

    #[test]
    fn rejects_empty_pattern() {
        assert!(validate_manifest_pattern("", &home()).is_err());
    }

    #[test]
    fn rejects_malformed_glob() {
        assert!(validate_manifest_pattern("~/[unclosed", &home()).is_err());
    }

    // ---- paths_covered_by_patterns ----

    #[test]
    fn accepts_exact_match() {
        let patterns = vec!["~/.ssh/config".to_string()];
        let paths = vec![PathBuf::from("/Users/test/.ssh/config")];
        assert!(paths_covered_by_patterns(&patterns, &paths, &home()).is_ok());
    }

    #[test]
    fn accepts_globstar_match() {
        let patterns = vec!["~/Library/Shortcuts/**".to_string()];
        let paths = vec![PathBuf::from("/Users/test/Library/Shortcuts")];
        assert!(paths_covered_by_patterns(&patterns, &paths, &home()).is_ok());
    }

    #[test]
    fn rejects_uncovered_path() {
        let patterns = vec!["~/Library/Shortcuts/**".to_string()];
        let paths = vec![PathBuf::from("/etc/passwd")];
        let err = paths_covered_by_patterns(&patterns, &paths, &home()).unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("not covered"), "got: {msg}");
    }

    #[test]
    fn rejects_partial_cover() {
        let patterns = vec!["~/foo/**".to_string()];
        let paths = vec![
            PathBuf::from("/Users/test/foo/a"),
            PathBuf::from("/Users/test/bar/b"),
        ];
        assert!(paths_covered_by_patterns(&patterns, &paths, &home()).is_err());
    }

    #[test]
    fn errors_on_empty_patterns() {
        let paths = vec![PathBuf::from("/Users/test/foo")];
        assert!(paths_covered_by_patterns(&[], &paths, &home()).is_err());
    }
}
