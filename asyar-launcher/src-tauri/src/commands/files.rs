//! File system utility commands.
//!
//! Provides absolute-path read, write, and directory creation helpers
//! callable from the frontend over Tauri IPC.

use std::fs;
use crate::error::AppError;
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
    let home_dir = app_handle.path().home_dir().map_err(|e| {
        crate::error::AppError::Other(format!("Cannot resolve home dir: {}", e))
    })?;

    let allowed_roots = [normalize_path(&app_data), normalize_path(&temp_dir), normalize_path(&home_dir)];

    if !allowed_roots.iter().any(|root| normalized.starts_with(root)) {
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

        write_text_file_absolute(app.handle().clone(), path_str.clone(), "hello world".to_string())
            .await
            .unwrap();

        let content = read_text_file_absolute(app.handle().clone(), path_str).await.unwrap();
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
        let result = read_text_file_absolute(app.handle().clone(), temp_file.to_str().unwrap().to_string()).await;
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

        let content = read_text_file_absolute(app.handle().clone(), path_str).await.unwrap();
        assert_eq!(content, "second");
    }
}

