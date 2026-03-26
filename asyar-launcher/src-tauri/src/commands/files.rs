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
