//! File system utility commands.
//!
//! Provides absolute-path read, write, and directory creation helpers
//! callable from the frontend over Tauri IPC.

use crate::error::AppError;
use crate::files_scope;
use crate::permissions::ExtensionPermissionRegistry;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Permission string gating extension file-content reads
/// (`asyar:api:files:read`).
pub const FILES_READ_PERMISSION: &str = "files:read";

/// Hard ceiling for extension-initiated reads, regardless of the
/// `max_bytes` the caller asks for. Config/manifest parsing (the use case
/// the permission exists for) fits comfortably; anything larger belongs in
/// a purpose-built API.
const EXTENSION_READ_MAX_BYTES: u64 = 1_048_576;

/// Normalizes a path by resolving `.` and `..` components without requiring the path to exist on disk.
pub(crate) fn normalize_path(path: &std::path::Path) -> std::path::PathBuf {
    use std::path::Component;
    let mut components: Vec<Component> = Vec::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                // Only pop non-root, non-prefix components
                if matches!(components.last(), Some(Component::Normal(_))) {
                    components.pop();
                }
            }
            Component::CurDir => {} // skip `.`
            c => components.push(c),
        }
    }
    components.iter().collect()
}

/// Validates that a path is within the app data directory or the OS temp directory.
/// Prevents path traversal attacks and access to system files.
fn validate_path_allowed<R: tauri::Runtime>(
    path_str: &str,
    app_handle: &tauri::AppHandle<R>,
) -> Result<(), crate::error::AppError> {
    let path = std::path::Path::new(path_str);

    // Must be absolute — reject relative paths
    if !path.is_absolute() {
        return Err(crate::error::AppError::Other(format!(
            "Path must be absolute, got: '{}'",
            path_str
        )));
    }

    // Normalize the requested path (removes any `..` traversal)
    let normalized = normalize_path(path);

    // Get allowed roots
    let app_data = app_handle.path().app_data_dir().map_err(|e| {
        crate::error::AppError::Other(format!("Cannot resolve app data dir: {}", e))
    })?;
    let temp_dir = std::env::temp_dir();
    let home_dir = app_handle
        .path()
        .home_dir()
        .map_err(|e| crate::error::AppError::Other(format!("Cannot resolve home dir: {}", e)))?;

    let allowed_roots = [
        normalize_path(&app_data),
        normalize_path(&temp_dir),
        normalize_path(&home_dir),
    ];

    if !allowed_roots
        .iter()
        .any(|root| normalized.starts_with(root))
    {
        return Err(crate::error::AppError::Other(format!(
            "Access denied: '{}' is outside the allowed directories (home, app data, or temp)",
            path_str
        )));
    }

    Ok(())
}

/// Writes binary data to a file, creating all parent directories as needed.
#[tauri::command]
pub async fn write_binary_file_recursive<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    path_str: String,
    content: Vec<u8>,
) -> Result<(), AppError> {
    validate_path_allowed(&path_str, &app_handle)?;
    let path = std::path::Path::new(&path_str);

    // Create parent directories if they don't exist
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)?;
        }
    }

    // Write the file content
    fs::write(path, &content)?;

    Ok(())
}

/// Writes UTF-8 text to an absolute path, creating parent directories as needed.
#[tauri::command]
pub async fn write_text_file_absolute<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    path_str: String,
    content: String,
) -> Result<(), AppError> {
    validate_path_allowed(&path_str, &app_handle)?;
    let path = std::path::Path::new(&path_str);

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)?;
        }
    }

    fs::write(path, content)?;

    Ok(())
}

/// Reads the full contents of a file at an absolute path as UTF-8 text.
#[tauri::command]
pub async fn read_text_file_absolute<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    path_str: String,
) -> Result<String, AppError> {
    validate_path_allowed(&path_str, &app_handle)?;
    let path = std::path::Path::new(&path_str);
    Ok(fs::read_to_string(path)?)
}

/// Reads at most `max_bytes` of a file as UTF-8 (lossy), for preview
/// purposes — never loads the whole file into memory first, unlike
/// `read_text_file_absolute`. Truncation lands mid-codepoint only for
/// pathological inputs; `from_utf8_lossy` degrades those to `U+FFFD`
/// rather than erroring.
#[tauri::command]
pub async fn read_text_preview<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    path_str: String,
    max_bytes: Option<u32>,
) -> Result<String, AppError> {
    validate_path_allowed(&path_str, &app_handle)?;
    read_bounded(Path::new(&path_str), max_bytes.unwrap_or(50_000) as u64)
}

/// The shared bounded-read primitive behind `read_text_preview` and
/// `files_read_text` — never loads more than `cap` bytes.
fn read_bounded(path: &Path, cap: u64) -> Result<String, AppError> {
    use std::io::Read;

    let file = fs::File::open(path)?;
    let mut buf = Vec::with_capacity(cap.min(64 * 1024) as usize);
    file.take(cap).read_to_end(&mut buf)?;

    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Permission-gated bounded file read for extensions
/// (`asyar:api:files:read`). Unlike the host-only `read_text_preview`, the
/// readable scope is the calling extension's declared (and user-consented)
/// `permissionArgs["files:read"]` globs — the fixed home/app-data/temp
/// roots are deliberately NOT unioned in — minus the hard deny-list in
/// `files_scope`. Callers without an extension identity (privileged host
/// context) get `read_text_preview` semantics instead.
#[tauri::command]
pub async fn files_read_text<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    permissions: tauri::State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    path_str: String,
    max_bytes: Option<u32>,
) -> Result<String, AppError> {
    let Some(ext) = extension_id else {
        validate_path_allowed(&path_str, &app_handle)?;
        return read_bounded(Path::new(&path_str), max_bytes.unwrap_or(50_000) as u64);
    };
    let (home, extra_deny) = extension_scope_env(&app_handle)?;
    files_read_text_inner(&permissions, &ext, &path_str, max_bytes, &home, &extra_deny)
}

/// Home dir + runtime deny roots for the extension-scoped file commands.
/// The launcher's own app-data dir (settings.dat, consent records, MCP
/// config) joins the deny-list — a broad consented glob like `~/**` must
/// not read the launcher's internal state.
fn extension_scope_env<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<(PathBuf, Vec<PathBuf>), AppError> {
    let home = app_handle
        .path()
        .home_dir()
        .map_err(|e| AppError::Other(format!("Cannot resolve home dir: {}", e)))?;
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("Cannot resolve app data dir: {}", e)))?;
    Ok((home, vec![normalize_path(&app_data)]))
}

pub(crate) fn files_read_text_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: &str,
    path_str: &str,
    max_bytes: Option<u32>,
    home: &Path,
    extra_deny: &[PathBuf],
) -> Result<String, AppError> {
    let canonical = validate_scoped_path(permissions, extension_id, path_str, home, extra_deny)?;
    let cap = max_bytes
        .map(u64::from)
        .unwrap_or(50_000)
        .min(EXTENSION_READ_MAX_BYTES);
    read_bounded(&canonical, cap)
}

/// The full `files:read` scope check shared by every extension-facing
/// command that touches file contents (`files:read`, `files:thumbnail`) —
/// permission, absolute-path, declared-glob coverage, deny-list, and the
/// canonical re-check. Returns the canonical path to operate on.
pub(crate) fn validate_scoped_path(
    permissions: &ExtensionPermissionRegistry,
    extension_id: &str,
    path_str: &str,
    home: &Path,
    extra_deny: &[PathBuf],
) -> Result<PathBuf, AppError> {
    permissions.check(&Some(extension_id.to_string()), FILES_READ_PERMISSION)?;
    let path = Path::new(path_str);
    if !path.is_absolute() {
        return Err(AppError::Validation(format!(
            "files:read path must be absolute, got: '{}'",
            path_str
        )));
    }
    let normalized = normalize_path(path);
    let patterns = permissions.files_read_patterns(extension_id)?;
    // Coverage runs against the requested (normalized, non-canonical) form
    // so declared patterns match user-style paths verbatim — same
    // reasoning as fs:watch's coverage check.
    files_scope::path_covered_by_patterns(&patterns, &normalized, home)?;
    files_scope::check_path_denied(&normalized, home, extra_deny)?;
    // Canonicalize to resolve symlinks, then re-run BOTH checks against the
    // real location: a covered path must not launder a read out of scope —
    // neither into a protected root nor into an arbitrary uncovered file —
    // through a symlink or junction. `dunce` (not `Path::canonicalize`)
    // because Windows canonicalization yields verbatim `\\?\C:\...` paths,
    // whose prefix component never `starts_with`-matches a normal-form
    // root and never glob-matches an anchored pattern. The comparison
    // anchors (home, deny roots) are canonicalized too, so a symlinked
    // home or app-data dir can't skew the re-check; entries that don't
    // exist keep their literal form.
    let canonical = dunce::canonicalize(&normalized).map_err(|e| {
        AppError::Validation(format!(
            "files:read path '{}' does not exist or is not accessible: {}",
            normalized.display(),
            e
        ))
    })?;
    let canonical_home = dunce::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    let canonical_extra_deny: Vec<PathBuf> = extra_deny
        .iter()
        .map(|p| dunce::canonicalize(p).unwrap_or_else(|_| p.clone()))
        .collect();
    // Deny first so laundering into a protected root reports the specific
    // "protected location" error rather than the generic coverage miss.
    files_scope::check_path_denied(&canonical, &canonical_home, &canonical_extra_deny)?;
    files_scope::path_covered_by_patterns(&patterns, &canonical, &canonical_home)?;
    // Regular files only: on Unix a covered FIFO would pass every scope
    // check and then block `File::open` (or an image decode plus one of
    // the thumbnail semaphore's three permits) indefinitely — an
    // extension-triggered hang. Directories get a clear rejection here
    // instead of a platform-worded open error.
    let meta = fs::metadata(&canonical).map_err(|e| {
        AppError::Validation(format!(
            "files:read path '{}' is not accessible: {}",
            canonical.display(),
            e
        ))
    })?;
    if !meta.is_file() {
        return Err(AppError::Validation(format!(
            "files:read path '{}' is not a regular file",
            canonical.display()
        )));
    }
    Ok(canonical)
}

/// Results cap for `files:glob` — plenty for any per-directory artwork
/// lookup while keeping the IPC payload bounded. Also the ceiling for the
/// caller-supplied `max_results`.
const GLOB_MAX_RESULTS: usize = 256;

/// Directory-entry budget for one `files:glob` walk. Exhausting it is an
/// error rather than a silent truncation — which entries a cut-off walk
/// would have covered is filesystem-order nondeterministic, so the caller
/// must narrow the pattern's literal prefix instead.
const GLOB_MAX_VISITS: usize = 10_000;

/// Scoped filename enumeration for extensions (`asyar:api:files:glob`).
/// Complements `files:read`/`files:thumbnail`, which take exact paths the
/// caller must already know — but names in Steam-style caches are
/// content-addressed (`librarycache/<appid>/<sha1>.jpg`), unknowable in
/// advance, and extensions cannot list directories. Returns the absolute
/// paths of existing regular files (never directories) matching `pattern`,
/// filtered to the caller's declared `permissionArgs["files:read"]` scope
/// minus the deny-list — out-of-scope names never leave the host. Symlinks
/// are neither followed nor reported. Extension identity is required: host
/// code has the file index and unscoped reads already.
#[tauri::command]
pub async fn files_glob<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    permissions: tauri::State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    pattern: String,
    max_results: Option<u32>,
) -> Result<Vec<String>, AppError> {
    let Some(ext) = extension_id else {
        return Err(AppError::Validation(
            "files:glob requires an extension caller".into(),
        ));
    };
    let (home, extra_deny) = extension_scope_env(&app_handle)?;
    files_glob_inner(
        &permissions,
        &ext,
        &pattern,
        max_results,
        &home,
        &extra_deny,
    )
}

pub(crate) fn files_glob_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: &str,
    pattern_str: &str,
    max_results: Option<u32>,
    home: &Path,
    extra_deny: &[PathBuf],
) -> Result<Vec<String>, AppError> {
    permissions.check(&Some(extension_id.to_string()), FILES_READ_PERMISSION)?;
    // Same load-time rules as declared patterns: non-empty, no `..`, valid
    // glob syntax.
    files_scope::validate_files_read_pattern(pattern_str)?;
    let expanded = crate::fs_watcher::matcher::expand_tilde(pattern_str, home);
    let prefix = files_scope::glob_literal_prefix(&expanded);
    if prefix.as_os_str().is_empty() || !prefix.is_absolute() {
        return Err(AppError::Validation(format!(
            "files:glob pattern must begin with an absolute literal prefix to enumerate from \
             (e.g. 'C:/Steam/appcache/**'), got: '{}'",
            pattern_str
        )));
    }
    let patterns = permissions.files_read_patterns(extension_id)?;
    // A wildcard-free pattern IS its own literal prefix — a file, not a
    // directory to walk. Enumerate its parent and let the matcher select
    // it, so an existing exact path resolves to itself instead of lying
    // with an empty result. (A symlink at that exact path stays hidden:
    // the parent walk drops symlinks like everywhere else.)
    let walk_root = if prefix.is_file() {
        prefix.parent().unwrap_or(&prefix).to_path_buf()
    } else {
        prefix.clone()
    };
    // A walk root that doesn't exist enumerates to nothing — normal for
    // the multi-drive Steam case, where a configured library drive may be
    // absent. Canonicalizing it also resolves the one symlink the walk
    // itself can't skip: one sitting inside the literal prefix.
    let canonical_prefix = match dunce::canonicalize(&walk_root) {
        Ok(p) => p,
        Err(_) => return Ok(Vec::new()),
    };
    let canonical_home = dunce::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    let canonical_extra_deny: Vec<PathBuf> = extra_deny
        .iter()
        .map(|p| dunce::canonicalize(p).unwrap_or_else(|_| p.clone()))
        .collect();
    // A walk root inside a protected location is an explicit denial (the
    // same "protected location" error files:read gives), not an empty
    // enumeration — and the walk below never even opens such a directory.
    files_scope::check_path_denied(&walk_root, home, extra_deny)?;
    files_scope::check_path_denied(&canonical_prefix, &canonical_home, &canonical_extra_deny)?;
    // Fail fast when no declared pattern could match anything under the
    // walk root. The per-result coverage filter below would return nothing
    // anyway — but only after walking a whole out-of-scope tree.
    if !files_scope::glob_prefix_plausibly_in_scope(&walk_root, &patterns, home)
        && !files_scope::glob_prefix_plausibly_in_scope(
            &canonical_prefix,
            &patterns,
            &canonical_home,
        )
    {
        return Err(AppError::Validation(format!(
            "files:glob pattern '{}' is outside the declared files:read scope",
            pattern_str
        )));
    }
    let matcher = files_scope::compile_expanded_glob(&expanded.to_string_lossy(), pattern_str)?
        .compile_matcher();
    // Candidates exist in two spellings when the walk root canonicalized
    // to something else: the caller's requested form and the canonical
    // (walked) form.
    let requested_form_of =
        |canonical_path: &Path| match canonical_path.strip_prefix(&canonical_prefix) {
            Ok(rel) => walk_root.join(rel),
            Err(_) => canonical_path.to_path_buf(),
        };

    let mut visited: usize = 0;
    let mut results: Vec<String> = Vec::new();
    let mut stack: Vec<PathBuf> = vec![canonical_prefix.clone()];
    while let Some(dir) = stack.pop() {
        // Unreadable directories are skipped, not fatal — a broad glob may
        // legitimately brush against permission-denied subtrees.
        let Ok(read_dir) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in read_dir.flatten() {
            visited += 1;
            if visited > GLOB_MAX_VISITS {
                return Err(AppError::Validation(format!(
                    "files:glob visited more than {} entries under '{}' — narrow the pattern's \
                     literal prefix",
                    GLOB_MAX_VISITS,
                    walk_root.display()
                )));
            }
            // `DirEntry::file_type` does not traverse symlinks, so links —
            // to directories or files — are dropped here, never followed.
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let canonical_path = entry.path();
            if file_type.is_dir() {
                // Prune before descending: a denied directory's entries are
                // never even enumerated (defense in depth — the per-file
                // filter already keeps them out of results), and a subtree
                // no declared pattern could match doesn't get to burn the
                // visit budget.
                let requested_dir = requested_form_of(&canonical_path);
                if files_scope::check_path_denied(&requested_dir, home, extra_deny).is_err()
                    || files_scope::check_path_denied(
                        &canonical_path,
                        &canonical_home,
                        &canonical_extra_deny,
                    )
                    .is_err()
                {
                    continue;
                }
                if !files_scope::glob_prefix_plausibly_in_scope(&requested_dir, &patterns, home)
                    && !files_scope::glob_prefix_plausibly_in_scope(
                        &canonical_path,
                        &patterns,
                        &canonical_home,
                    )
                {
                    continue;
                }
                stack.push(canonical_path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            // Match the requested glob against either spelling; require
            // declared coverage and the deny-list to hold for BOTH — the
            // same double check `files:read` runs — so every returned path
            // is guaranteed consumable by `files:read`/`files:thumbnail`.
            let requested_form = requested_form_of(&canonical_path);
            if !matcher.is_match(&requested_form) && !matcher.is_match(&canonical_path) {
                continue;
            }
            if files_scope::path_covered_by_patterns(&patterns, &requested_form, home).is_err()
                || files_scope::check_path_denied(&requested_form, home, extra_deny).is_err()
                || files_scope::path_covered_by_patterns(
                    &patterns,
                    &canonical_path,
                    &canonical_home,
                )
                .is_err()
                || files_scope::check_path_denied(
                    &canonical_path,
                    &canonical_home,
                    &canonical_extra_deny,
                )
                .is_err()
            {
                continue;
            }
            results.push(canonical_path.to_string_lossy().into_owned());
        }
    }
    // Deterministic order and a deterministic first-N under the cap.
    results.sort();
    let cap = max_results
        .map(|n| n as usize)
        .unwrap_or(GLOB_MAX_RESULTS)
        .clamp(1, GLOB_MAX_RESULTS);
    results.truncate(cap);
    Ok(results)
}

/// Default edge for extension thumbnails — matches the host previews'
/// `DEFAULT_MAX_DIM`.
const THUMB_DEFAULT_MAX_DIM: u32 = 256;

/// Ceiling for the caller-supplied `max_dim`, so an extension can't turn
/// the shared thumbnail cache into a full-resolution image store.
const EXTENSION_THUMB_MAX_DIM: u32 = 512;

/// Permission-gated thumbnail for extensions (`asyar:api:files:thumbnail`).
/// Same declared-glob scope and deny-list as `files:read` — a thumbnail is
/// strictly less information than the byte read that permission already
/// grants — feeding the same content-addressed cache and `asyar-thumb://`
/// scheme the host's file previews use, so the returned URL renders
/// anywhere the frontend accepts an image icon, dynamic command rows
/// included. `None` when the file type has no thumbnail strategy on this
/// platform. Callers without an extension identity (privileged host
/// context) get `validate_path_allowed` semantics, like `files_read_text`.
#[tauri::command]
pub async fn files_thumbnail<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    permissions: tauri::State<'_, ExtensionPermissionRegistry>,
    thumb_state: tauri::State<'_, std::sync::Arc<crate::thumbnail::ThumbnailState>>,
    extension_id: Option<String>,
    path_str: String,
    max_dim: Option<u32>,
) -> Result<Option<String>, AppError> {
    let max_dim = max_dim
        .unwrap_or(THUMB_DEFAULT_MAX_DIM)
        .clamp(16, EXTENSION_THUMB_MAX_DIM);
    let source = match extension_id {
        Some(ext) => {
            let (home, extra_deny) = extension_scope_env(&app_handle)?;
            let source = validate_scoped_path(&permissions, &ext, &path_str, &home, &extra_deny)?;
            // Extension thumbnails are image-only on EVERY platform: the
            // per-OS strategies differ (macOS falls back to a `qlmanage`
            // subprocess, Windows/Linux have no non-image provider yet),
            // and neither platform-dependent results nor an
            // extension-triggerable subprocess belongs behind files:read.
            // Same "no strategy" signal as an unsupported type.
            if !crate::thumbnail::image_thumb::is_supported_image(&source) {
                return Ok(None);
            }
            source
        }
        None => {
            validate_path_allowed(&path_str, &app_handle)?;
            PathBuf::from(&path_str)
        }
    };
    let cache_dir = crate::thumbnail::cache::get_thumbnail_cache_dir(&app_handle);
    let Some(cached) =
        crate::thumbnail::get_or_generate(&thumb_state, &cache_dir, &source, max_dim).await
    else {
        return Ok(None);
    };
    crate::thumbnail::thumb_url(&cached)
        .map(Some)
        .map_err(AppError::Other)
}

/// Creates a directory and all required parent directories at an absolute path.
#[tauri::command]
pub async fn mkdir_absolute<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    path_str: String,
) -> Result<(), AppError> {
    validate_path_allowed(&path_str, &app_handle)?;
    let path = std::path::Path::new(&path_str);
    fs::create_dir_all(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Forward-slash string form of a path, for building *declared* glob
    /// patterns. Extensions declare `files:read` globs with forward slashes
    /// (the documented convention, e.g. `C:/Steam/**`), and globset treats
    /// `\` as an escape — so a pattern built from a Windows path's native
    /// backslashes would never match. Requested paths (not patterns) stay
    /// native; the product normalizes those itself.
    ///
    /// Roots feeding patterns are canonicalized with `dunce`, not
    /// `std::fs::canonicalize`, elsewhere in these tests: the latter yields a
    /// verbatim `\\?\C:\…` prefix on Windows whose `?` is a glob
    /// metacharacter, which breaks both pattern matching and the
    /// literal-prefix parse `files:glob` relies on.
    fn slashes(p: &std::path::Path) -> String {
        p.to_string_lossy().replace('\\', "/")
    }

    #[tokio::test]
    async fn test_write_and_read_roundtrip() {
        let app = tauri::test::mock_app();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("hello.txt");
        let path_str = path.to_str().unwrap().to_string();

        write_text_file_absolute(
            app.handle().clone(),
            path_str.clone(),
            "hello world".to_string(),
        )
        .await
        .unwrap();

        let content = read_text_file_absolute(app.handle().clone(), path_str)
            .await
            .unwrap();
        assert_eq!(content, "hello world");
    }

    #[tokio::test]
    async fn test_write_text_creates_parent_dirs() {
        let app = tauri::test::mock_app();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nested/deep/dir/file.txt");
        let path_str = path.to_str().unwrap().to_string();

        write_text_file_absolute(app.handle().clone(), path_str, "content".to_string())
            .await
            .unwrap();

        assert!(path.exists());
    }

    #[tokio::test]
    async fn test_write_binary_file_recursive_creates_dirs() {
        let app = tauri::test::mock_app();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("bin/data/file.bin");
        let path_str = path.to_str().unwrap().to_string();
        let bytes = vec![0xDEu8, 0xAD, 0xBE, 0xEF];

        write_binary_file_recursive(app.handle().clone(), path_str, bytes.clone())
            .await
            .unwrap();

        let on_disk = std::fs::read(&path).unwrap();
        assert_eq!(on_disk, bytes);
    }

    #[tokio::test]
    async fn test_mkdir_absolute_creates_directory() {
        let app = tauri::test::mock_app();
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("new/nested/dir");
        let dir_str = dir.to_str().unwrap().to_string();

        mkdir_absolute(app.handle().clone(), dir_str).await.unwrap();

        assert!(dir.is_dir());
    }

    #[tokio::test]
    async fn test_read_nonexistent_file_returns_err() {
        let app = tauri::test::mock_app();
        // Use a path in the OS temp dir to satisfy validation
        let temp_file = std::env::temp_dir().join("__does_not_exist_asyar_test__");
        let result = read_text_file_absolute(
            app.handle().clone(),
            temp_file.to_str().unwrap().to_string(),
        )
        .await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Io(_)));
    }

    #[tokio::test]
    async fn test_write_overwrites_existing_file() {
        let app = tauri::test::mock_app();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("overwrite.txt");
        let path_str = path.to_str().unwrap().to_string();

        write_text_file_absolute(app.handle().clone(), path_str.clone(), "first".to_string())
            .await
            .unwrap();
        write_text_file_absolute(app.handle().clone(), path_str.clone(), "second".to_string())
            .await
            .unwrap();

        let content = read_text_file_absolute(app.handle().clone(), path_str)
            .await
            .unwrap();
        assert_eq!(content, "second");
    }

    #[tokio::test]
    async fn test_read_text_preview_returns_full_content_under_cap() {
        let app = tauri::test::mock_app();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("small.txt");
        std::fs::write(&path, "hello world").unwrap();

        let content = read_text_preview(
            app.handle().clone(),
            path.to_str().unwrap().to_string(),
            Some(50_000),
        )
        .await
        .unwrap();

        assert_eq!(content, "hello world");
    }

    #[tokio::test]
    async fn test_read_text_preview_truncates_to_max_bytes() {
        let app = tauri::test::mock_app();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("big.txt");
        std::fs::write(&path, "a".repeat(10_000)).unwrap();

        let content = read_text_preview(
            app.handle().clone(),
            path.to_str().unwrap().to_string(),
            Some(100),
        )
        .await
        .unwrap();

        assert_eq!(content.len(), 100);
    }

    #[tokio::test]
    async fn test_read_text_preview_defaults_max_bytes_when_none() {
        let app = tauri::test::mock_app();
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("default_cap.txt");
        std::fs::write(&path, "a".repeat(60_000)).unwrap();

        let content = read_text_preview(
            app.handle().clone(),
            path.to_str().unwrap().to_string(),
            None,
        )
        .await
        .unwrap();

        assert_eq!(content.len(), 50_000, "default cap must be 50,000 bytes");
    }

    #[tokio::test]
    async fn test_read_text_preview_nonexistent_file_returns_err() {
        let app = tauri::test::mock_app();
        let temp_file = std::env::temp_dir().join("__does_not_exist_asyar_preview_test__");
        let result = read_text_preview(
            app.handle().clone(),
            temp_file.to_str().unwrap().to_string(),
            None,
        )
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_read_text_preview_rejects_disallowed_path() {
        let app = tauri::test::mock_app();
        let result = read_text_preview(app.handle().clone(), "/etc/hosts".to_string(), None).await;
        assert!(result.is_err());
    }

    // ---- files_read_text (extension-scoped read) ----

    use std::collections::{HashMap, HashSet};

    /// Registry granting `ext.a` files:read over `<root>/**`. Returns the
    /// canonicalized root so macOS `/var` → `/private/var` tempdir
    /// indirection can't skew starts_with / glob comparisons.
    fn files_read_setup(tmp: &TempDir) -> (ExtensionPermissionRegistry, PathBuf) {
        let root = dunce::canonicalize(tmp.path()).unwrap();
        let perms = ExtensionPermissionRegistry::default();
        let mut args = HashMap::new();
        args.insert(
            "files:read".to_string(),
            serde_json::json!([format!("{}/**", slashes(&root))]),
        );
        perms.register("ext.a", HashSet::from(["files:read".to_string()]), args);
        (perms, root)
    }

    #[test]
    fn files_read_inner_rejects_without_permission() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = files_read_setup(&tmp);
        let target = root.join("a.txt");
        std::fs::write(&target, "hi").unwrap();
        let err = files_read_text_inner(
            &perms,
            "ext.other",
            target.to_str().unwrap(),
            None,
            &root,
            &[],
        )
        .unwrap_err();
        assert!(
            format!("{err}").to_lowercase().contains("permission")
                || format!("{err}").contains("not registered"),
            "got: {err}"
        );
    }

    #[test]
    fn files_read_inner_rejects_path_outside_declared_patterns() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = files_read_setup(&tmp);
        let outside = TempDir::new().unwrap();
        let target = dunce::canonicalize(outside.path()).unwrap().join("a.txt");
        std::fs::write(&target, "hi").unwrap();
        let err =
            files_read_text_inner(&perms, "ext.a", target.to_str().unwrap(), None, &root, &[])
                .unwrap_err();
        assert!(format!("{err}").contains("not covered"), "got: {err}");
    }

    #[test]
    fn files_read_inner_rejects_relative_path() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = files_read_setup(&tmp);
        let err =
            files_read_text_inner(&perms, "ext.a", "relative/a.txt", None, &root, &[]).unwrap_err();
        assert!(format!("{err}").contains("absolute"), "got: {err}");
    }

    #[test]
    fn files_read_inner_happy_path_reads_content() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = files_read_setup(&tmp);
        let target = root.join("config.vdf");
        std::fs::write(&target, "\"libraryfolders\" {}").unwrap();
        let content =
            files_read_text_inner(&perms, "ext.a", target.to_str().unwrap(), None, &root, &[])
                .unwrap();
        assert_eq!(content, "\"libraryfolders\" {}");
    }

    #[test]
    fn files_read_inner_normalizes_dotdot_before_coverage() {
        // `<root>/sub/../a.txt` normalizes to `<root>/a.txt`, which the
        // declared pattern covers — and, more importantly, a `..` escape
        // out of the covered root is evaluated post-normalization.
        let tmp = TempDir::new().unwrap();
        let (perms, root) = files_read_setup(&tmp);
        let outside = TempDir::new().unwrap();
        let outside_root = dunce::canonicalize(outside.path()).unwrap();
        let secret = outside_root.join("secret.txt");
        std::fs::write(&secret, "secret").unwrap();
        // `<root>/../<outside-basename>/secret.txt` — textually starts
        // inside the covered root but normalizes to the sibling tempdir
        // (both tempdirs share the same OS temp parent).
        let sneaky = root
            .join("..")
            .join(outside_root.file_name().unwrap())
            .join("secret.txt");
        let err =
            files_read_text_inner(&perms, "ext.a", sneaky.to_str().unwrap(), None, &root, &[])
                .unwrap_err();
        assert!(format!("{err}").contains("not covered"), "got: {err}");
    }

    #[test]
    fn files_read_inner_errors_on_missing_file() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = files_read_setup(&tmp);
        let missing = root.join("nope.txt");
        let err =
            files_read_text_inner(&perms, "ext.a", missing.to_str().unwrap(), None, &root, &[])
                .unwrap_err();
        assert!(format!("{err}").contains("does not exist"), "got: {err}");
    }

    #[test]
    fn files_read_inner_deny_list_beats_covering_pattern() {
        // Home = tempdir, pattern = `<home>/**` (user consented to a broad
        // glob) — reading `<home>/.ssh/id_rsa` must still be denied.
        let tmp = TempDir::new().unwrap();
        let (perms, home) = files_read_setup(&tmp);
        let ssh = home.join(".ssh");
        std::fs::create_dir_all(&ssh).unwrap();
        let key = ssh.join("id_rsa");
        std::fs::write(&key, "PRIVATE KEY").unwrap();
        let err = files_read_text_inner(&perms, "ext.a", key.to_str().unwrap(), None, &home, &[])
            .unwrap_err();
        assert!(
            format!("{err}").contains("protected location"),
            "got: {err}"
        );
    }

    #[test]
    fn files_read_inner_extra_deny_roots_are_enforced() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = files_read_setup(&tmp);
        let app_data = root.join("app-data");
        std::fs::create_dir_all(&app_data).unwrap();
        let settings = app_data.join("settings.dat");
        std::fs::write(&settings, "{}").unwrap();
        let err = files_read_text_inner(
            &perms,
            "ext.a",
            settings.to_str().unwrap(),
            None,
            &root,
            &[app_data],
        )
        .unwrap_err();
        assert!(
            format!("{err}").contains("protected location"),
            "got: {err}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn files_read_inner_denies_symlink_into_protected_location() {
        // A covered path must not launder a read out of a protected one:
        // `<home>/docs/link` → `<home>/.ssh/secret` is caught by the
        // post-canonicalization deny re-check.
        let tmp = TempDir::new().unwrap();
        let home = dunce::canonicalize(tmp.path()).unwrap();
        let perms = ExtensionPermissionRegistry::default();
        let mut args = HashMap::new();
        args.insert(
            "files:read".to_string(),
            serde_json::json!([format!("{}/docs/**", slashes(&home))]),
        );
        perms.register("ext.a", HashSet::from(["files:read".to_string()]), args);

        let ssh = home.join(".ssh");
        std::fs::create_dir_all(&ssh).unwrap();
        std::fs::write(ssh.join("secret"), "PRIVATE").unwrap();
        let docs = home.join("docs");
        std::fs::create_dir_all(&docs).unwrap();
        let link = docs.join("link");
        std::os::unix::fs::symlink(ssh.join("secret"), &link).unwrap();

        let err = files_read_text_inner(&perms, "ext.a", link.to_str().unwrap(), None, &home, &[])
            .unwrap_err();
        assert!(
            format!("{err}").contains("protected location"),
            "got: {err}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn files_read_inner_denies_symlink_out_of_declared_scope() {
        // A symlink inside a covered glob must not read an arbitrary file
        // that is neither covered nor deny-listed: coverage is re-checked
        // against the canonical (resolved) path.
        let tmp = TempDir::new().unwrap();
        let (perms, root) = files_read_setup(&tmp);
        let outside = TempDir::new().unwrap();
        let secret = dunce::canonicalize(outside.path())
            .unwrap()
            .join("private.txt");
        std::fs::write(&secret, "private").unwrap();
        let link = root.join("innocent.txt");
        std::os::unix::fs::symlink(&secret, &link).unwrap();

        let err = files_read_text_inner(&perms, "ext.a", link.to_str().unwrap(), None, &root, &[])
            .unwrap_err();
        assert!(format!("{err}").contains("not covered"), "got: {err}");
    }

    #[cfg(unix)]
    #[test]
    fn files_read_inner_deny_roots_hold_under_symlinked_home() {
        // Home itself is reached through a symlink. A covered symlink into
        // `<real home>/.ssh` must still be denied: the deny roots are
        // rebuilt from the CANONICAL home for the post-resolution check.
        let tmp = TempDir::new().unwrap();
        let base = dunce::canonicalize(tmp.path()).unwrap();
        let real_home = base.join("real-home");
        std::fs::create_dir_all(real_home.join(".ssh")).unwrap();
        std::fs::write(real_home.join(".ssh/secret"), "PRIVATE").unwrap();
        std::fs::create_dir_all(real_home.join("docs")).unwrap();
        let link_home = base.join("link-home");
        std::os::unix::fs::symlink(&real_home, &link_home).unwrap();
        let laundered = real_home.join("docs/launder");
        std::os::unix::fs::symlink(real_home.join(".ssh/secret"), &laundered).unwrap();

        let perms = ExtensionPermissionRegistry::default();
        let mut args = HashMap::new();
        args.insert(
            "files:read".to_string(),
            serde_json::json!(["~/docs/**", format!("{}/docs/**", slashes(&real_home))]),
        );
        perms.register("ext.a", HashSet::from(["files:read".to_string()]), args);

        // `home` is passed in its symlinked form; without canonicalizing it,
        // deny roots would anchor under link-home and never match the
        // canonical secret path under real-home.
        let err = files_read_text_inner(
            &perms,
            "ext.a",
            laundered.to_str().unwrap(),
            None,
            &link_home,
            &[],
        )
        .unwrap_err();
        assert!(
            format!("{err}").contains("protected location"),
            "got: {err}"
        );
    }

    #[test]
    fn files_read_inner_caps_read_size() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = files_read_setup(&tmp);
        let target = root.join("big.txt");
        std::fs::write(&target, "a".repeat(2 * 1024 * 1024)).unwrap();
        // Caller asks for more than the extension ceiling — clamped.
        let content = files_read_text_inner(
            &perms,
            "ext.a",
            target.to_str().unwrap(),
            Some(u32::MAX),
            &root,
            &[],
        )
        .unwrap();
        assert_eq!(content.len() as u64, EXTENSION_READ_MAX_BYTES);
        // Default (no max_bytes) stays at the preview default.
        let content =
            files_read_text_inner(&perms, "ext.a", target.to_str().unwrap(), None, &root, &[])
                .unwrap();
        assert_eq!(content.len(), 50_000);
    }

    // ---- files_glob (scoped enumeration) ----

    /// The motivating layout: content-addressed artwork under a per-app
    /// cache directory, unknowable in advance.
    fn glob_setup(tmp: &TempDir) -> (ExtensionPermissionRegistry, PathBuf) {
        let (perms, root) = files_read_setup(tmp);
        let lib = root.join("appcache/librarycache/105600");
        std::fs::create_dir_all(&lib).unwrap();
        std::fs::write(
            lib.join("dca288f5304172c39b7fa683273a5b6e6ce16f6b.jpg"),
            "jpg",
        )
        .unwrap();
        std::fs::write(lib.join("logo.png"), "png").unwrap();
        (perms, root)
    }

    #[test]
    fn files_glob_finds_sha1_named_artwork() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = glob_setup(&tmp);
        // The exact pattern the Steam extension will use: 40 `?`s match
        // the hex name precisely.
        let pattern = format!(
            "{}/appcache/librarycache/105600/{}.jpg",
            slashes(&root),
            "?".repeat(40)
        );
        let hits = files_glob_inner(&perms, "ext.a", &pattern, None, &root, &[]).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].ends_with("dca288f5304172c39b7fa683273a5b6e6ce16f6b.jpg"));
    }

    #[test]
    fn files_glob_results_are_sorted_and_capped() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = glob_setup(&tmp);
        let pattern = format!("{}/appcache/**", slashes(&root));
        let hits = files_glob_inner(&perms, "ext.a", &pattern, None, &root, &[]).unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits[0] < hits[1], "expected sorted results: {hits:?}");
        let capped = files_glob_inner(&perms, "ext.a", &pattern, Some(1), &root, &[]).unwrap();
        assert_eq!(capped, hits[..1]);
    }

    #[test]
    fn files_glob_rejects_without_permission() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = glob_setup(&tmp);
        let pattern = format!("{}/**", slashes(&root));
        let err = files_glob_inner(&perms, "ext.other", &pattern, None, &root, &[]).unwrap_err();
        assert!(
            format!("{err}").to_lowercase().contains("permission")
                || format!("{err}").contains("not registered"),
            "got: {err}"
        );
    }

    #[test]
    fn files_glob_rejects_unanchored_pattern() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = glob_setup(&tmp);
        let err = files_glob_inner(&perms, "ext.a", "**/librarycache/*.jpg", None, &root, &[])
            .unwrap_err();
        assert!(format!("{err}").contains("literal prefix"), "got: {err}");
    }

    #[test]
    fn files_glob_rejects_traversal_pattern() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = glob_setup(&tmp);
        let pattern = format!("{}/sub/../**", slashes(&root));
        let err = files_glob_inner(&perms, "ext.a", &pattern, None, &root, &[]).unwrap_err();
        assert!(format!("{err}").contains(".."), "got: {err}");
    }

    #[test]
    fn files_glob_rejects_out_of_scope_prefix_without_walking() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = glob_setup(&tmp);
        let outside_tmp = TempDir::new().unwrap();
        let outside = dunce::canonicalize(outside_tmp.path()).unwrap();
        let pattern = format!("{}/**", slashes(&outside));
        let err = files_glob_inner(&perms, "ext.a", &pattern, None, &root, &[]).unwrap_err();
        assert!(
            format!("{err}").contains("outside the declared"),
            "got: {err}"
        );
    }

    #[test]
    fn files_glob_missing_prefix_enumerates_to_empty() {
        // A configured-but-absent library drive is normal, not an error.
        let tmp = TempDir::new().unwrap();
        let (perms, root) = glob_setup(&tmp);
        let pattern = format!("{}/not-mounted/**", slashes(&root));
        let hits = files_glob_inner(&perms, "ext.a", &pattern, None, &root, &[]).unwrap();
        assert!(hits.is_empty());
    }

    #[test]
    fn files_glob_deny_list_filters_covered_results() {
        // `home` is the tempdir root here, so `<root>/.ssh` is a protected
        // root — a broad in-scope glob must not enumerate its contents.
        let tmp = TempDir::new().unwrap();
        let (perms, root) = glob_setup(&tmp);
        let ssh = root.join(".ssh");
        std::fs::create_dir_all(&ssh).unwrap();
        std::fs::write(ssh.join("id_rsa.jpg"), "not really art").unwrap();
        let pattern = format!("{}/**/*.jpg", slashes(&root));
        let hits = files_glob_inner(&perms, "ext.a", &pattern, None, &root, &[]).unwrap();
        assert_eq!(hits.len(), 1, "got: {hits:?}");
        assert!(!hits[0].contains(".ssh"));
    }

    #[test]
    fn files_glob_filters_results_outside_declared_scope() {
        // Declared scope narrower than the walked glob: only in-scope
        // names may leave the host.
        let tmp = TempDir::new().unwrap();
        let root = dunce::canonicalize(tmp.path()).unwrap();
        let perms = ExtensionPermissionRegistry::default();
        let mut args = HashMap::new();
        args.insert(
            "files:read".to_string(),
            serde_json::json!([format!("{}/appcache/**", slashes(&root))]),
        );
        perms.register("ext.a", HashSet::from(["files:read".to_string()]), args);
        let lib = root.join("appcache");
        std::fs::create_dir_all(&lib).unwrap();
        std::fs::write(lib.join("in-scope.jpg"), "jpg").unwrap();
        std::fs::write(root.join("out-of-scope.jpg"), "jpg").unwrap();

        let pattern = format!("{}/**/*.jpg", slashes(&root));
        let hits = files_glob_inner(&perms, "ext.a", &pattern, None, &root, &[]).unwrap();
        assert_eq!(hits.len(), 1, "got: {hits:?}");
        assert!(hits[0].ends_with("in-scope.jpg"));
    }

    #[cfg(unix)]
    #[test]
    fn files_glob_does_not_follow_symlinked_directories() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = glob_setup(&tmp);
        let outside = TempDir::new().unwrap();
        let secret_dir = dunce::canonicalize(outside.path()).unwrap();
        std::fs::write(secret_dir.join("secret.jpg"), "jpg").unwrap();
        std::os::unix::fs::symlink(&secret_dir, root.join("linked")).unwrap();

        let pattern = format!("{}/**/*.jpg", slashes(&root));
        let hits = files_glob_inner(&perms, "ext.a", &pattern, None, &root, &[]).unwrap();
        assert_eq!(hits.len(), 1, "got: {hits:?}");
        assert!(!hits[0].contains("secret"));
    }

    #[test]
    fn files_glob_literal_pattern_returns_the_exact_file() {
        // A wildcard-free pattern must resolve to the file itself, not
        // enumerate to empty because the literal prefix isn't a directory.
        let tmp = TempDir::new().unwrap();
        let (perms, root) = glob_setup(&tmp);
        // Join components separately so `target` uses the native separator —
        // the product returns native paths, so a mixed-separator expected
        // (backslash root + forward-slash suffix) would spuriously differ on
        // Windows.
        let target = root
            .join("appcache")
            .join("librarycache")
            .join("105600")
            .join("logo.png");
        let hits =
            files_glob_inner(&perms, "ext.a", &target.to_string_lossy(), None, &root, &[]).unwrap();
        assert_eq!(hits, vec![target.to_string_lossy().into_owned()]);
    }

    #[cfg(unix)]
    #[test]
    fn files_glob_literal_symlink_is_not_reported() {
        // The no-symlink policy holds for exact-path patterns too: the
        // parent walk drops the link like everywhere else.
        let tmp = TempDir::new().unwrap();
        let (perms, root) = glob_setup(&tmp);
        let outside = TempDir::new().unwrap();
        let secret = dunce::canonicalize(outside.path())
            .unwrap()
            .join("secret.jpg");
        std::fs::write(&secret, "jpg").unwrap();
        let link = root.join("linked.jpg");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        let hits =
            files_glob_inner(&perms, "ext.a", &link.to_string_lossy(), None, &root, &[]).unwrap();
        assert!(hits.is_empty(), "got: {hits:?}");
    }

    #[test]
    fn files_glob_denied_walk_root_errors_as_protected() {
        // Enumerating from inside a protected root is an explicit denial,
        // not an empty result — and the walk never opens the directory.
        let tmp = TempDir::new().unwrap();
        let (perms, root) = glob_setup(&tmp);
        let ssh = root.join(".ssh");
        std::fs::create_dir_all(&ssh).unwrap();
        std::fs::write(ssh.join("id_rsa.jpg"), "not art").unwrap();
        let pattern = format!("{}/.ssh/**", slashes(&root));
        let err = files_glob_inner(&perms, "ext.a", &pattern, None, &root, &[]).unwrap_err();
        assert!(
            format!("{err}").contains("protected location"),
            "got: {err}"
        );
    }

    // ---- files_thumbnail (extension-scoped) ----

    fn write_test_png(path: &Path) {
        let img = image::RgbImage::from_pixel(50, 50, image::Rgb([1, 2, 3]));
        image::DynamicImage::ImageRgb8(img)
            .save_with_format(path, image::ImageFormat::Png)
            .unwrap();
    }

    fn mock_app_with_thumb_state() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(std::sync::Arc::new(
            crate::thumbnail::ThumbnailState::default(),
        ));
        app
    }

    #[tokio::test]
    async fn files_thumbnail_extension_in_scope_returns_url() {
        let tmp = TempDir::new().unwrap();
        let (perms, root) = files_read_setup(&tmp);
        let app = mock_app_with_thumb_state();
        app.manage(perms);
        let src = root.join("art.png");
        write_test_png(&src);

        let url = files_thumbnail(
            app.handle().clone(),
            app.state(),
            app.state(),
            Some("ext.a".to_string()),
            src.to_string_lossy().into_owned(),
            Some(64),
        )
        .await
        .unwrap();
        assert!(url.is_some());
        assert!(url.unwrap().ends_with(".png"));
    }

    #[test]
    fn files_read_inner_rejects_directory() {
        // Regular files only — a covered directory (or, on Unix, a FIFO,
        // which would block the open forever) is rejected up front.
        let tmp = TempDir::new().unwrap();
        let (perms, root) = files_read_setup(&tmp);
        let dir = root.join("subdir");
        std::fs::create_dir_all(&dir).unwrap();
        let err = files_read_text_inner(&perms, "ext.a", dir.to_str().unwrap(), None, &root, &[])
            .unwrap_err();
        assert!(
            format!("{err}").contains("not a regular file"),
            "got: {err}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn files_read_inner_rejects_non_regular_file() {
        // A unix socket stands in for any non-regular covered path (FIFOs
        // behave the same and are the ones that would hang an open).
        let tmp = TempDir::new().unwrap();
        let (perms, root) = files_read_setup(&tmp);
        let sock = root.join("art.jpg");
        let _listener = std::os::unix::net::UnixListener::bind(&sock).unwrap();
        let err = files_read_text_inner(&perms, "ext.a", sock.to_str().unwrap(), None, &root, &[])
            .unwrap_err();
        assert!(
            format!("{err}").contains("not a regular file"),
            "got: {err}"
        );
    }

    #[tokio::test]
    async fn files_thumbnail_extension_non_image_resolves_none() {
        // Image-only for extensions on every platform — a covered text
        // file yields the "no strategy" None, never a platform-dependent
        // result or a qlmanage subprocess on macOS.
        let tmp = TempDir::new().unwrap();
        let (perms, root) = files_read_setup(&tmp);
        let app = mock_app_with_thumb_state();
        app.manage(perms);
        let src = root.join("notes.txt");
        std::fs::write(&src, "not an image").unwrap();

        let url = files_thumbnail(
            app.handle().clone(),
            app.state(),
            app.state(),
            Some("ext.a".to_string()),
            src.to_string_lossy().into_owned(),
            None,
        )
        .await
        .unwrap();
        assert!(url.is_none());
    }

    #[tokio::test]
    async fn files_thumbnail_extension_out_of_scope_is_rejected() {
        let tmp = TempDir::new().unwrap();
        let (perms, _root) = files_read_setup(&tmp);
        let app = mock_app_with_thumb_state();
        app.manage(perms);
        let outside = TempDir::new().unwrap();
        let src = dunce::canonicalize(outside.path()).unwrap().join("art.png");
        write_test_png(&src);

        let err = files_thumbnail(
            app.handle().clone(),
            app.state(),
            app.state(),
            Some("ext.a".to_string()),
            src.to_string_lossy().into_owned(),
            None,
        )
        .await
        .unwrap_err();
        assert!(format!("{err}").contains("not covered"), "got: {err}");
    }
}
