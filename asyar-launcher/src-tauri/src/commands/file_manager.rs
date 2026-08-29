use crate::error::AppError;
use std::path::Path;
use std::process::Command;
use tauri::Manager;

/// Validates the path for the `show_in_file_manager` command.
/// Rejects non-absolute or non-existent paths.
fn validate_show_path(path_str: &str) -> Result<(), AppError> {
    let path = Path::new(path_str);
    if !path.is_absolute() {
        return Err(AppError::Other(format!(
            "Path must be absolute: {}",
            path_str
        )));
    }
    if !path.exists() {
        return Err(AppError::Other(format!(
            "Path does not exist: {}",
            path_str
        )));
    }
    Ok(())
}

/// Validates the path for the `trash_path` command.
/// Rejects non-absolute, non-existent, or paths outside the home directory.
fn validate_trash_path(path_str: &str, home_dir: &Path) -> Result<(), AppError> {
    let path = Path::new(path_str);
    if !path.is_absolute() {
        return Err(AppError::Other(format!(
            "Path must be absolute: {}",
            path_str
        )));
    }
    if !path.exists() {
        return Err(AppError::Other(format!(
            "Path does not exist: {}",
            path_str
        )));
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

/// Reveal a file/directory in the OS file manager (selecting it where the
/// platform supports it). No path validation — callers that just wrote the
/// file (e.g. note export) don't need it; `show_in_file_manager` validates
/// first for the untrusted-path case.
pub(crate) fn reveal_in_file_manager(path_str: &str) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(path_str)
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
        let parent_dir = Path::new(path_str)
            .parent()
            .ok_or_else(|| AppError::Other("Cannot get parent directory".to_string()))?;
        let mut cmd = Command::new("xdg-open");
        cmd.arg(parent_dir);
        crate::platform::linux::sanitize_command(&mut cmd);
        cmd.spawn().map_err(|e| {
            AppError::Other(format!("Failed to reveal path in file manager: {}", e))
        })?;
    }

    Ok(())
}

/// Reveals the specified file or directory in the OS file manager.
#[tauri::command]
pub async fn show_in_file_manager(path_str: String) -> Result<(), AppError> {
    validate_show_path(&path_str)?;
    reveal_in_file_manager(&path_str)
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

    trash::delete(&path_str)
        .map_err(|e| AppError::Other(format!("Failed to move path to trash: {}", e)))?;

    Ok(())
}

/// Resolves the directory a terminal should open in: `path_str` itself if
/// it's a directory, else its parent. Extracted so the logic is testable
/// without spawning a terminal.
fn resolve_terminal_dir(path_str: &str) -> Result<std::path::PathBuf, AppError> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(AppError::Other(format!(
            "Path does not exist: {}",
            path_str
        )));
    }
    if path.is_dir() {
        Ok(path.to_path_buf())
    } else {
        path.parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| AppError::Other("Cannot get parent directory".to_string()))
    }
}

/// Opens a terminal window at the given path (or its parent directory, if
/// the path is a file). Not home-scoped like `trash_path` — opening a
/// terminal is non-destructive.
#[tauri::command]
pub async fn open_in_terminal(path_str: String) -> Result<(), AppError> {
    let dir = resolve_terminal_dir(&path_str)?;

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-a")
            .arg("Terminal")
            .arg(&dir)
            .spawn()
            .map_err(|e| AppError::Other(format!("Failed to open Terminal: {}", e)))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "cmd", "/K", "cd", "/d"])
            .arg(&dir)
            .spawn()
            .map_err(|e| AppError::Other(format!("Failed to open terminal: {}", e)))?;
    }

    #[cfg(target_os = "linux")]
    {
        let mut cmd = Command::new("x-terminal-emulator");
        cmd.current_dir(&dir);
        crate::platform::linux::sanitize_command(&mut cmd);
        cmd.spawn()
            .map_err(|e| AppError::Other(format!("Failed to open terminal: {}", e)))?;
    }

    Ok(())
}

/// Quick Look preview via macOS's `qlmanage`. A debug tool, not a public
/// API — degrades to an error on other platforms so the frontend action
/// falls back to `open_application_path` instead.
#[tauri::command]
pub async fn quick_look_path(path_str: String) -> Result<(), AppError> {
    let path = Path::new(&path_str);
    if !path.exists() {
        return Err(AppError::Other(format!(
            "Path does not exist: {}",
            path_str
        )));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("qlmanage")
            .arg("-p")
            .arg(&path_str)
            .spawn()
            .map_err(|e| AppError::Other(format!("Failed to Quick Look: {}", e)))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err(AppError::Other(
            "Quick Look is only available on macOS".to_string(),
        ))
    }
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
        assert!(
            err_msg.contains("outside"),
            "Error should mention 'outside': {}",
            err_msg
        );
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

    // --- resolve_terminal_dir tests ---

    #[test]
    fn resolve_terminal_dir_rejects_missing_path() {
        let r = resolve_terminal_dir("/tmp/__asyar_nonexistent_terminal_test__");
        assert!(r.is_err());
    }

    #[test]
    fn resolve_terminal_dir_returns_directory_itself() {
        let tmp = TempDir::new().unwrap();
        let r = resolve_terminal_dir(tmp.path().to_str().unwrap()).unwrap();
        assert_eq!(r, tmp.path());
    }

    #[test]
    fn resolve_terminal_dir_returns_parent_for_a_file() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("a.txt");
        std::fs::write(&file, "x").unwrap();
        let r = resolve_terminal_dir(file.to_str().unwrap()).unwrap();
        assert_eq!(r, tmp.path());
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
