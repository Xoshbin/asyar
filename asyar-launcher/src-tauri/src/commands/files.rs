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
    let home = app_handle
        .path()
        .home_dir()
        .map_err(|e| AppError::Other(format!("Cannot resolve home dir: {}", e)))?;
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("Cannot resolve app data dir: {}", e)))?;
    // The launcher's own app-data dir (settings.dat, consent records, MCP
    // config) joins the deny-list — a broad consented glob like `~/**`
    // must not read the launcher's internal state.
    files_read_text_inner(
        &permissions,
        &ext,
        &path_str,
        max_bytes,
        &home,
        &[normalize_path(&app_data)],
    )
}

pub(crate) fn files_read_text_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: &str,
    path_str: &str,
    max_bytes: Option<u32>,
    home: &Path,
    extra_deny: &[PathBuf],
) -> Result<String, AppError> {
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
    // Canonicalize to resolve symlinks, then re-check the deny-list on the
    // real location: a covered path must not launder a read out of a
    // protected one through a symlink.
    let canonical = normalized.canonicalize().map_err(|e| {
        AppError::Validation(format!(
            "files:read path '{}' does not exist or is not accessible: {}",
            normalized.display(),
            e
        ))
    })?;
    files_scope::check_path_denied(&canonical, home, extra_deny)?;
    let cap = max_bytes
        .map(u64::from)
        .unwrap_or(50_000)
        .min(EXTENSION_READ_MAX_BYTES);
    read_bounded(&canonical, cap)
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
        let root = tmp.path().canonicalize().unwrap();
        let perms = ExtensionPermissionRegistry::default();
        let mut args = HashMap::new();
        args.insert(
            "files:read".to_string(),
            serde_json::json!([format!("{}/**", root.to_string_lossy())]),
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
        let target = outside.path().canonicalize().unwrap().join("a.txt");
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
        let outside_root = outside.path().canonicalize().unwrap();
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
        let home = tmp.path().canonicalize().unwrap();
        let perms = ExtensionPermissionRegistry::default();
        let mut args = HashMap::new();
        args.insert(
            "files:read".to_string(),
            serde_json::json!([format!("{}/docs/**", home.to_string_lossy())]),
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
}
