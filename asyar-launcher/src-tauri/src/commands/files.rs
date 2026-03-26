use std::fs;

/// Creates parent directories if they don't exist and writes binary content to a file.
#[tauri::command]
pub async fn write_binary_file_recursive(path_str: String, content: Vec<u8>) -> Result<(), String> {
    let path = std::path::Path::new(&path_str);

    // Create parent directories if they don't exist
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories for {}: {}", path_str, e))?;
        }
    }

    // Write the file content
    fs::write(path, &content)
         .map_err(|e| format!("Failed to write file {}: {}", path_str, e))?;

    Ok(())
}

#[tauri::command]
pub async fn write_text_file_absolute(path_str: String, content: String) -> Result<(), String> {
    let path = std::path::Path::new(&path_str);

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories for {}: {}", path_str, e))?;
        }
    }

    fs::write(path, content)
         .map_err(|e| format!("Failed to write file {}: {}", path_str, e))?;

    Ok(())
}

#[tauri::command]
pub async fn read_text_file_absolute(path_str: String) -> Result<String, String> {
    let path = std::path::Path::new(&path_str);
    fs::read_to_string(path).map_err(|e| format!("Failed to read file {}: {}", path_str, e))
}

#[tauri::command]
pub async fn mkdir_absolute(path_str: String) -> Result<(), String> {
    let path = std::path::Path::new(&path_str);
    fs::create_dir_all(path)
        .map_err(|e| format!("Failed to create directory {}: {}", path_str, e))?;
    Ok(())
}
