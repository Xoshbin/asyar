//! Application discovery and launch commands.
//!
//! Scans installed applications, extracts icons, and opens apps by path.

use crate::search_engine::models::Application;
use crate::error::AppError;
use log::info;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug)]
struct AppScanner {
    paths: Vec<String>,
}

impl AppScanner {
    fn new() -> Self {
        Self { paths: Vec::new() }
    }

    fn scan_directory(&mut self, dir_path: &Path) -> Result<(), AppError> {
        for entry in fs::read_dir(dir_path)?.filter_map(Result::ok) {
            let path = entry.path();
            if is_app_bundle(&path) {
                if let Some(path_str) = path.to_str() {
                    self.paths.push(path_str.to_string());
                }
            } else if path.is_dir() {
                let _ = self.scan_directory(&path);
            }
        }
        Ok(())
    }

    fn scan_all(&mut self) -> Result<(), AppError> {
        let directories = get_app_scan_paths();

        for dir in directories.iter() {
            if let Err(e) = self.scan_directory(Path::new(dir)) {
                info!("Error scanning {:?}: {}", dir, e);
            }
        }

        Ok(())
    }
}

fn get_app_scan_paths() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        vec![
            PathBuf::from("/Applications"),
            PathBuf::from("/System/Applications"),
        ]
    }
    #[cfg(target_os = "linux")]
    {
        let mut paths = vec![
            PathBuf::from("/usr/share/applications"),
        ];
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join(".local/share/applications"));
        }
        paths
    }
    #[cfg(target_os = "windows")]
    {
        let mut paths = vec![];
        if let Ok(appdata) = std::env::var("APPDATA") {
            paths.push(PathBuf::from(appdata).join("Microsoft\\Windows\\Start Menu\\Programs"));
        }
        if let Ok(programdata) = std::env::var("PROGRAMDATA") {
            paths.push(PathBuf::from(programdata).join("Microsoft\\Windows\\Start Menu\\Programs"));
        }
        paths
    }
}

fn is_app_bundle(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    { path.extension().map(|e| e == "app").unwrap_or(false) }

    #[cfg(target_os = "linux")]
    { path.extension().map(|e| e == "desktop").unwrap_or(false) }

    #[cfg(target_os = "windows")]
    { path.extension().map(|e| e == "lnk").unwrap_or(false) }
}

fn extract_app_icon(app_path: &str, cache_dir: &Path) -> Option<String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    // Derive a safe cache filename from the path
    let cache_key = app_path
        .replace(['/', '\\', ':', ' '], "_")
        .replace(".app", "")
        .replace(".desktop", "")
        .replace(".exe", "");
    let cache_file = cache_dir.join(format!("{}.png", &cache_key[..cache_key.len().min(200)]));

    // Return cached icon if available
    if cache_file.exists() {
        if let Ok(bytes) = std::fs::read(&cache_file) {
            return Some(format!("data:image/png;base64,{}", STANDARD.encode(&bytes)));
        }
    }

    // Extract icon — platform-specific
    let png_bytes: Option<Vec<u8>> = extract_icon_bytes(app_path);

    // Save to cache and return
    if let Some(ref bytes) = png_bytes {
        let _ = std::fs::create_dir_all(cache_dir);
        let _ = std::fs::write(&cache_file, bytes);
        return Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)));
    }

    None
}

fn extract_icon_bytes(app_path: &str) -> Option<Vec<u8>> {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        crate::platform::extract_icon(Path::new(app_path))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        None
    }
}

/// Opens an application at the given file system path.
#[tauri::command]
pub fn open_application_path(
    app_handle: AppHandle,
    path: String,
) -> Result<(), AppError> {
    use tauri_plugin_opener::OpenerExt;
    app_handle
        .opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| AppError::Platform(format!("Failed to open path '{}': {}", path, e)))
}

/// Returns all installed applications found in system scan paths.
#[tauri::command]
pub fn list_applications(
    app: AppHandle,
    state: tauri::State<'_, crate::search_engine::SearchState>,
) -> Result<Vec<Application>, AppError> {
    let mut scanner = AppScanner::new();
    scanner.scan_all().map_err(|e| AppError::Other(e.to_string()))?;

    let icon_cache_dir = app.path().app_data_dir()
        .map(|p| p.join("icon_cache"))
        .unwrap_or_else(|_| PathBuf::from("/tmp/asyar_icon_cache"));

    let mut applications = Vec::new();

    for path_str in &scanner.paths {
        let name = Path::new(path_str)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("Unknown_App")
            .to_string();

        // --- Generate Full ID from Name and Path ---
        let sanitized_name = name.replace([' ', '/'], "_");
        let sanitized_path = path_str.replace([' ', '/'], "_");

        // Create the FULL object ID directly
        let full_app_id = format!("app_{}_{}", sanitized_name, sanitized_path);
        // --- End ID Generation ---

        applications.push(Application {
            id: full_app_id, // Store the FULL ID (e.g., "app_Name__Path...")
            name,
            path: path_str.clone(),
            usage_count: 0,
            icon: extract_app_icon(path_str, &icon_cache_dir),
        });
    }

    // Update the in-memory SearchState with the newly extracted icons
    if let Ok(mut items) = state.items.lock() {
        for item in items.iter_mut() {
            if let crate::search_engine::models::SearchableItem::Application(app) = item {
                if let Some(fresh_app) = applications.iter().find(|a| a.id == app.id) {
                    app.icon = fresh_app.icon.clone();
                }
            }
        }
    }

    log::info!("Found {} applications", applications.len());
    Ok(applications)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_get_app_scan_paths_is_non_empty() {
        let paths = get_app_scan_paths();
        assert!(
            !paths.is_empty(),
            "get_app_scan_paths() must return at least one path on every platform"
        );
    }

    #[test]
    fn test_is_app_bundle_no_extension_is_false() {
        // A path with no file extension is never an app bundle on any platform
        assert!(!is_app_bundle(Path::new("/some/path/without_extension")));
    }

    #[test]
    fn test_is_app_bundle_wrong_extension_is_false() {
        // .txt is never an app bundle
        assert!(!is_app_bundle(Path::new("/tmp/somefile.txt")));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_is_app_bundle_macos_dot_app() {
        assert!(is_app_bundle(Path::new("/Applications/Finder.app")));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_is_app_bundle_macos_no_app_extension_is_false() {
        assert!(!is_app_bundle(Path::new("/Applications/Finder")));
        assert!(!is_app_bundle(Path::new("/usr/bin/ls")));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn test_is_app_bundle_linux_dot_desktop() {
        assert!(is_app_bundle(Path::new(
            "/usr/share/applications/firefox.desktop"
        )));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn test_is_app_bundle_linux_dot_app_is_false() {
        // .app is not a Linux app bundle
        assert!(!is_app_bundle(Path::new("/home/user/apps/Foo.app")));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_is_app_bundle_windows_dot_lnk() {
        assert!(is_app_bundle(Path::new("C:\\Users\\Public\\Desktop\\App.lnk")));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_is_app_bundle_windows_dot_exe_is_false() {
        // .exe is not the expected bundle type (we look for .lnk shortcuts)
        assert!(!is_app_bundle(Path::new("C:\\Windows\\System32\\notepad.exe")));
    }
}

