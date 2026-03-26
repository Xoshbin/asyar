use std::fs;
use crate::error::AppError;

/// Creates parent directories if they don't exist and writes binary content to a file.
#[tauri::command]
pub async fn write_binary_file_recursive(path_str: String, content: Vec<u8>) -> Result<(), AppError> {
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

#[tauri::command]
pub async fn write_text_file_absolute(path_str: String, content: String) -> Result<(), AppError> {
    let path = std::path::Path::new(&path_str);

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)?;
        }
    }

    fs::write(path, content)?;

    Ok(())
}

#[tauri::command]
pub async fn read_text_file_absolute(path_str: String) -> Result<String, AppError> {
    let path = std::path::Path::new(&path_str);
    Ok(fs::read_to_string(path)?)
}

#[tauri::command]
pub async fn mkdir_absolute(path_str: String) -> Result<(), AppError> {
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
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("hello.txt");
        let path_str = path.to_str().unwrap().to_string();

        write_text_file_absolute(path_str.clone(), "hello world".to_string())
            .await
            .unwrap();

        let content = read_text_file_absolute(path_str).await.unwrap();
        assert_eq!(content, "hello world");
    }

    #[tokio::test]
    async fn test_write_text_creates_parent_dirs() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nested/deep/dir/file.txt");
        let path_str = path.to_str().unwrap().to_string();

        write_text_file_absolute(path_str, "content".to_string())
            .await
            .unwrap();

        assert!(path.exists());
    }

    #[tokio::test]
    async fn test_write_binary_file_recursive_creates_dirs() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("bin/data/file.bin");
        let path_str = path.to_str().unwrap().to_string();
        let bytes = vec![0xDEu8, 0xAD, 0xBE, 0xEF];

        write_binary_file_recursive(path_str, bytes.clone())
            .await
            .unwrap();

        let on_disk = std::fs::read(&path).unwrap();
        assert_eq!(on_disk, bytes);
    }

    #[tokio::test]
    async fn test_mkdir_absolute_creates_directory() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("new/nested/dir");
        let dir_str = dir.to_str().unwrap().to_string();

        mkdir_absolute(dir_str).await.unwrap();

        assert!(dir.is_dir());
    }

    #[tokio::test]
    async fn test_read_nonexistent_file_returns_err() {
        let result = read_text_file_absolute("/tmp/__does_not_exist_asyar_test__".to_string()).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Io(_)));
    }

    #[tokio::test]
    async fn test_write_overwrites_existing_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("overwrite.txt");
        let path_str = path.to_str().unwrap().to_string();

        write_text_file_absolute(path_str.clone(), "first".to_string())
            .await
            .unwrap();
        write_text_file_absolute(path_str.clone(), "second".to_string())
            .await
            .unwrap();

        let content = read_text_file_absolute(path_str).await.unwrap();
        assert_eq!(content, "second");
    }
}

