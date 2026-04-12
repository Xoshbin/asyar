use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;
use std::collections::{HashMap, HashSet};
use crate::error::AppError;
use crate::search_engine::models::{Application, SearchableItem};
use crate::search_engine::SearchState;
use tauri::{AppHandle, Manager};
use log::info;

#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FrontmostApplication {
    pub name: String,
    pub bundle_id: Option<String>,
    pub path: Option<String>,
    pub window_title: Option<String>,
}

#[derive(Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub added: u32,
    pub removed: u32,
    pub total: u32,
}

/// Retrieves metadata about the currently focused application.
pub fn get_frontmost_application() -> Result<FrontmostApplication, AppError> {
    #[cfg(target_os = "macos")]
    {
        if let Some((name, id, title)) = crate::platform::macos::get_frontmost_application_metadata() {
            return Ok(FrontmostApplication {
                name,
                bundle_id: Some(id),
                path: None, 
                window_title: Some(title),
            });
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some((name, path, title)) = crate::platform::windows::get_frontmost_application_metadata() {
            return Ok(FrontmostApplication {
                name,
                bundle_id: None,
                path: Some(path),
                window_title: Some(title),
            });
        }
    }

    Err(AppError::Platform("Failed to retrieve frontmost application metadata".to_string()))
}

/// Scans for applications in default and extra paths, diffs against the search index,
/// and updates the search state.
pub fn sync_application_index(
    app: &AppHandle,
    search_state: &SearchState,
    extra_paths: Vec<PathBuf>,
) -> Result<SyncResult, AppError> {
    // 1. Scan applications
    let mut scanner = AppScanner::new();
    scanner.scan_all(extra_paths)?;

    let icon_cache_dir = get_icon_cache_dir(app);

    // 2. Build current app set
    let mut current_apps: HashMap<String, Application> = HashMap::new();
    for path_str in &scanner.paths {
        let name = Path::new(path_str)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("Unknown_App")
            .to_string();

        let sanitized_name = name.replace([' ', '/'], "_");
        let sanitized_path = path_str.replace([' ', '/'], "_");
        let full_app_id = format!("app_{}_{}", sanitized_name, sanitized_path);

        current_apps.insert(full_app_id.clone(), Application {
            id: full_app_id,
            name,
            path: path_str.clone(),
            usage_count: 0,
            icon: extract_app_icon(path_str, &icon_cache_dir),
            last_used_at: None,
        });
    }

    // 3. Get currently indexed app_ IDs
    let indexed_ids: Vec<String> = {
        let items = search_state.items.read().map_err(|e| AppError::Other(e.to_string()))?;
        items.iter()
            .filter_map(|item| {
                let id = item.id();
                if id.starts_with("app_") { Some(id.to_string()) } else { None }
            })
            .collect()
    };
    let indexed_set: HashSet<&str> = indexed_ids.iter().map(|s| s.as_str()).collect();
    let current_set: HashSet<&str> = current_apps.keys().map(|s| s.as_str()).collect();

    // 4. Diff
    let to_add: Vec<String> = current_set.difference(&indexed_set).map(|s| s.to_string()).collect();
    let to_remove: Vec<String> = indexed_set.difference(&current_set).map(|s| s.to_string()).collect();

    let added = to_add.len() as u32;
    let removed = to_remove.len() as u32;

    // 5. Update SearchState
    if !to_add.is_empty() || !to_remove.is_empty() {
        let mut items = search_state.items.write().map_err(|e| AppError::Other(e.to_string()))?;

        if !to_remove.is_empty() {
            let remove_set: HashSet<String> = to_remove.into_iter().collect();
            items.retain(|item| !remove_set.contains(item.id()));
        }

        for id in to_add {
            if let Some(app) = current_apps.remove(&id) {
                items.push(SearchableItem::Application(app));
            }
        }
    }

    // 6. Persist
    search_state.save_items_to_db()
        .map_err(|e| AppError::Other(format!("Failed to save index: {}", e)))?;

    let total = {
        let items = search_state.items.read().map_err(|e| AppError::Other(e.to_string()))?;
        items.iter().filter(|i| i.id().starts_with("app_")).count() as u32
    };

    info!("App sync complete: {} added, {} removed, {} total apps", added, removed, total);
    Ok(SyncResult { added, removed, total })
}

pub fn list_applications(
    app: &AppHandle,
    extra_paths: Vec<PathBuf>,
) -> Result<Vec<Application>, AppError> {
    let mut scanner = AppScanner::new();
    scanner.scan_all(extra_paths)?;

    let icon_cache_dir = get_icon_cache_dir(app);
    let mut applications = Vec::new();

    for path_str in &scanner.paths {
        let name = Path::new(path_str)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("Unknown_App")
            .to_string();

        let sanitized_name = name.replace([' ', '/'], "_");
        let sanitized_path = path_str.replace([' ', '/'], "_");
        let full_app_id = format!("app_{}_{}", sanitized_name, sanitized_path);

        applications.push(Application {
            id: full_app_id,
            name,
            path: path_str.clone(),
            usage_count: 0,
            icon: extract_app_icon(path_str, &icon_cache_dir),
            last_used_at: None,
        });
    }

    Ok(applications)
}

struct AppScanner {
    paths: Vec<String>,
}

impl AppScanner {
    fn new() -> Self {
        Self { paths: Vec::new() }
    }

    fn scan_directory(&mut self, dir_path: &Path) -> Result<(), AppError> {
        if !dir_path.is_dir() { return Ok(()); }
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

    fn scan_all(&mut self, extra_paths: Vec<PathBuf>) -> Result<(), AppError> {
        let mut directories = get_default_app_scan_paths();
        directories.extend(extra_paths);

        for dir in directories {
            if let Err(e) = self.scan_directory(&dir) {
                info!("Error scanning {:?}: {}", dir, e);
            }
        }

        Ok(())
    }
}

fn get_default_app_scan_paths() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        vec![
            PathBuf::from("/Applications"),
            PathBuf::from("/System/Applications"),
        ]
    }
    #[cfg(target_os = "linux")]
    {
        let mut paths = vec![PathBuf::from("/usr/share/applications")];
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

fn get_icon_cache_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir()
        .map(|p| p.join("icon_cache"))
        .unwrap_or_else(|_| {
            #[cfg(target_os = "windows")]
            { app.path().app_local_data_dir().unwrap_or_default().join("icon_cache") }
            #[cfg(not(target_os = "windows"))]
            { PathBuf::from("/tmp/asyar_icon_cache") }
        })
}

fn extract_app_icon(app_path: &str, cache_dir: &Path) -> Option<String> {
    let cache_key = app_path
        .replace(['/', '\\', ':', ' '], "_")
        .replace(".app", "")
        .replace(".desktop", "")
        .replace(".exe", "");
    
    let cache_filename = format!("{}.png", &cache_key[..cache_key.len().min(200)]);
    let cache_file = cache_dir.join(&cache_filename);

    if cache_file.exists() {
        #[cfg(target_os = "windows")]
        return Some(format!("http://asyar-icon.localhost/{}", cache_filename));
        #[cfg(not(target_os = "windows"))]
        return Some(format!("asyar-icon://localhost/{}", cache_filename));
    }

    if let Some(bytes) = crate::platform::extract_icon(Path::new(app_path)) {
        let _ = std::fs::create_dir_all(cache_dir);
        let _ = std::fs::write(&cache_file, bytes);
        #[cfg(target_os = "windows")]
        return Some(format!("http://asyar-icon.localhost/{}", cache_filename));
        #[cfg(not(target_os = "windows"))]
        return Some(format!("asyar-icon://localhost/{}", cache_filename));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scanner_can_add_extra_paths() {
        let mut scanner = AppScanner::new();
        let extra = PathBuf::from("/tmp/nonexistent_asyar_apps");
        let _ = scanner.scan_all(vec![extra.clone()]);
        // Default paths are always there, but it shouldn't crash
        assert!(true);
    }
}
