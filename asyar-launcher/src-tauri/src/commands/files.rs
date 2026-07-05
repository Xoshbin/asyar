//! File system utility commands.
//!
//! Provides absolute-path read, write, and directory creation helpers
//! callable from the frontend over Tauri IPC.

use crate::error::AppError;
use std::fs;
use tauri::Manager;

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
    use std::io::Read;

    validate_path_allowed(&path_str, &app_handle)?;
    let path = std::path::Path::new(&path_str);
    let cap = max_bytes.unwrap_or(50_000) as u64;

    let file = fs::File::open(path)?;
    let mut buf = Vec::with_capacity(cap.min(64 * 1024) as usize);
    file.take(cap).read_to_end(&mut buf)?;

    Ok(String::from_utf8_lossy(&buf).into_owned())
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

        let content = read_text_preview(app.handle().clone(), path.to_str().unwrap().to_string(), None)
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
        let result = read_text_preview(
            app.handle().clone(),
            "/etc/hosts".to_string(),
            None,
        )
        .await;
        assert!(result.is_err());
    }
}
