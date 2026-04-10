use crate::error::AppError;
use std::path::Path;
use std::process::Command;
use tauri::Manager;

/// Validates the path for the `show_in_file_manager` command.
/// Rejects non-absolute or non-existent paths.
fn validate_show_path(path_str: &str) -> Result<(), AppError> {
    let path = Path::new(path_str);
    if !path.is_absolute() {
        return Err(AppError::Other(format!("Path must be absolute: {}", path_str)));
    }
    if !path.exists() {
        return Err(AppError::Other(format!("Path does not exist: {}", path_str)));
    }
    Ok(())
}

/// Validates the path for the `trash_path` command.
/// Rejects non-absolute, non-existent, or paths outside the home directory.
fn validate_trash_path(path_str: &str, home_dir: &Path) -> Result<(), AppError> {
    let path = Path::new(path_str);
    if !path.is_absolute() {
        return Err(AppError::Other(format!("Path must be absolute: {}", path_str)));
    }
    if !path.exists() {
        return Err(AppError::Other(format!("Path does not exist: {}", path_str)));
    }

    // Normalize using the helper from the files module
    let normalized = super::files::normalize_path(path);
    if !normalized.starts_with(home_dir) {
        return Err(AppError::Other(format!(
            "Access denied: path '{}' is outside home directory",
            path_str
        )));
    }
    Ok(())
}

/// Reveals the specified file or directory in the OS file manager.
#[tauri::command]
pub async fn show_in_file_manager(path_str: String) -> Result<(), AppError> {
    validate_show_path(&path_str)?;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path_str)
            .spawn()
            .map_err(|e| AppError::Other(format!("Failed to reveal path in Finder: {}", e)))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", path_str))
            .spawn()
            .map_err(|e| AppError::Other(format!("Failed to reveal path in Explorer: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        let parent_dir = Path::new(&path_str)
            .parent()
            .ok_or_else(|| AppError::Other("Cannot get parent directory".to_string()))?;
        Command::new("xdg-open")
            .arg(parent_dir)
            .spawn()
            .map_err(|e| AppError::Other(format!("Failed to reveal path in file manager: {}", e)))?;
    }

    Ok(())
}

/// Moves the specified file or directory to the OS trash.
/// Requires the path to be within the user's home directory.
#[tauri::command]
pub async fn trash_path<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    path_str: String,
) -> Result<(), AppError> {
    let home_dir = app_handle
        .path()
        .home_dir()
        .map_err(|e| AppError::Other(format!("Could not resolve home directory: {}", e)))?;

    validate_trash_path(&path_str, &home_dir)?;

    trash::delete(&path_str).map_err(|e| AppError::Other(format!("Failed to move path to trash: {}", e)))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // --- show_in_file_manager validation tests ---

    #[test]
    fn test_show_rejects_relative_path() {
        let result = validate_show_path("relative/path/file.txt");
        assert!(result.is_err());
    }

    #[test]
    fn test_show_rejects_nonexistent_path() {
        let result = validate_show_path("/tmp/__asyar_nonexistent_test_file__");
        assert!(result.is_err());
    }

    #[test]
    fn test_show_accepts_existing_file() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("test.txt");
        std::fs::write(&file, "hello").unwrap();
        let result = validate_show_path(file.to_str().unwrap());
        assert!(result.is_ok());
    }

    #[test]
    fn test_show_accepts_existing_directory() {
        let tmp = TempDir::new().unwrap();
        let result = validate_show_path(tmp.path().to_str().unwrap());
        assert!(result.is_ok());
    }

    // --- trash_path validation tests ---

    #[test]
    fn test_trash_rejects_relative_path() {
        let home = std::env::temp_dir(); // stand-in for home
        let result = validate_trash_path("relative/file.txt", &home);
        assert!(result.is_err());
    }

    #[test]
    fn test_trash_rejects_nonexistent_path() {
        let home = std::env::temp_dir();
        let result = validate_trash_path("/tmp/__asyar_nonexistent_trash_test__", &home);
        assert!(result.is_err());
    }

    #[test]
    fn test_trash_rejects_path_outside_home() {
        // Create a real temp file but use a different "home" directory
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("outside.txt");
        std::fs::write(&file, "data").unwrap();
        
        // Use a fake home that doesn't contain the temp file
        let fake_home = TempDir::new().unwrap();
        let result = validate_trash_path(file.to_str().unwrap(), fake_home.path());
        assert!(result.is_err());
        let err_msg = format!("{}", result.unwrap_err());
        assert!(err_msg.contains("outside"), "Error should mention 'outside': {}", err_msg);
    }

    #[test]
    fn test_trash_blocks_traversal() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("legit.txt");
        std::fs::write(&file, "data").unwrap();
        
        // Construct a path with traversal that normalizes outside home
        let traversal_path = format!("{}/../../../etc/hosts", tmp.path().display());
        let result = validate_trash_path(&traversal_path, tmp.path());
        assert!(result.is_err());
    }

    #[test]
    fn test_trash_validates_path_in_home() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("valid.txt");
        std::fs::write(&file, "data").unwrap();

        // Use the temp dir itself as "home" — file is inside it
        let result = validate_trash_path(file.to_str().unwrap(), tmp.path());
        assert!(result.is_ok());
    }

    // Integration test: actually trash a file
    #[test]
    fn test_trash_actually_deletes_file() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("to_trash.txt");
        std::fs::write(&file, "delete me").unwrap();
        assert!(file.exists());

        // Call trash::delete directly (bypasses Tauri command wrapper)
        trash::delete(&file).unwrap();
        assert!(!file.exists(), "File should no longer exist after trash");
    }
}
