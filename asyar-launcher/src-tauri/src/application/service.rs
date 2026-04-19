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
        if let Some((name, id, path, title)) = crate::platform::macos::get_frontmost_application_metadata() {
            return Ok(FrontmostApplication {
                name,
                bundle_id: Some(id),
                path: if path.is_empty() { None } else { Some(path) },
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
            bundle_id: extract_bundle_id(Path::new(path_str)),
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
            bundle_id: extract_bundle_id(Path::new(path_str)),
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

pub fn is_default_app_location(app_path: &str) -> bool {
    let path = Path::new(app_path);
    get_default_app_scan_paths()
        .iter()
        .any(|dir| path.starts_with(dir))
}

pub fn display_path(app_path: &str) -> String {
    let path = Path::new(app_path);
    if let Some(home) = dirs::home_dir() {
        if let Ok(rest) = path.strip_prefix(&home) {
            if rest.as_os_str().is_empty() {
                return "~".to_string();
            }
            return format!("~{}{}", std::path::MAIN_SEPARATOR, rest.display());
        }
    }
    app_path.to_string()
}

pub fn normalize_scan_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.len() <= 1 {
        return trimmed.to_string();
    }
    // Preserve trailing separator on Windows drive roots (e.g. `C:\`) —
    // `C:` and `C:\` mean different things and stripping breaks the scan.
    #[cfg(target_os = "windows")]
    {
        let bytes = trimmed.as_bytes();
        if bytes.len() == 3
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/')
            && bytes[0].is_ascii_alphabetic()
        {
            return trimmed.to_string();
        }
    }
    trimmed
        .trim_end_matches(['/', std::path::MAIN_SEPARATOR])
        .to_string()
}

pub fn display_parent_dir(app_path: &str) -> String {
    let parent = Path::new(app_path)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or(app_path);
    display_path(parent)
}

pub fn get_default_app_scan_paths() -> Vec<PathBuf> {
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

/// Extract a platform-native bundle / process identifier for an installed app.
///
/// Works the same whether the path comes from a default scan location or from
/// a user-configured custom scan directory — the logic is purely
/// path-content-based (Info.plist or .desktop), no registry lookup.
pub(crate) fn extract_bundle_id(path: &Path) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        // macOS .app bundles contain Contents/Info.plist with CFBundleIdentifier.
        let plist_path = path.join("Contents/Info.plist");
        if !plist_path.is_file() { return None; }
        let value = plist::Value::from_file(&plist_path).ok()?;
        let dict = value.as_dictionary()?;
        let id = dict.get("CFBundleIdentifier")?.as_string()?;
        let trimmed = id.trim();
        if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
    }

    #[cfg(target_os = "linux")]
    {
        // Parse the .desktop file. Prefer StartupWMClass (matches X11 WM_CLASS
        // and is what process-name checks want). Fallback: basename of the
        // first arg of Exec= with format specifiers stripped.
        let contents = std::fs::read_to_string(path).ok()?;
        let mut wm_class: Option<String> = None;
        let mut exec_cmd: Option<String> = None;
        let mut in_desktop_entry = false;
        for line in contents.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                in_desktop_entry = trimmed == "[Desktop Entry]";
                continue;
            }
            if !in_desktop_entry { continue; }
            if let Some(rest) = trimmed.strip_prefix("StartupWMClass=") {
                wm_class = Some(rest.trim().to_string());
            } else if let Some(rest) = trimmed.strip_prefix("Exec=") {
                // Strip format specifiers like %U %f %F %u and surrounding quotes.
                let cleaned: String = rest
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_matches('"')
                    .to_string();
                if !cleaned.is_empty() {
                    let basename = Path::new(&cleaned)
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or(&cleaned)
                        .to_string();
                    exec_cmd = Some(basename);
                }
            }
        }
        wm_class.filter(|s| !s.is_empty()).or_else(|| exec_cmd.filter(|s| !s.is_empty()))
    }

    #[cfg(target_os = "windows")]
    {
        // .lnk shortcuts don't carry a bundle identifier. Leave None — the
        // caller falls back to `name` for isRunning() which uses process-name
        // matching on Windows.
        let _ = path;
        None
    }
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

pub(crate) fn extract_app_icon(app_path: &str, cache_dir: &Path) -> Option<String> {
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
    use std::fs;

    #[test]
    fn test_get_default_app_scan_paths_is_non_empty() {
        let paths = get_default_app_scan_paths();
        assert!(
            !paths.is_empty(),
            "get_default_app_scan_paths() must return at least one path on every platform"
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_is_default_app_location_macos_matches_applications_dir() {
        assert!(is_default_app_location("/Applications/Finder.app"));
        assert!(is_default_app_location("/System/Applications/Calendar.app"));
    }

    #[test]
    fn test_normalize_scan_path_trims_whitespace() {
        assert_eq!(normalize_scan_path("  /Applications  "), "/Applications");
    }

    #[test]
    fn test_normalize_scan_path_strips_trailing_forward_slash() {
        assert_eq!(normalize_scan_path("/Applications/"), "/Applications");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_normalize_scan_path_strips_trailing_backslash_on_windows() {
        assert_eq!(
            normalize_scan_path("C:\\Program Files\\"),
            "C:\\Program Files"
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_normalize_scan_path_preserves_windows_drive_root() {
        // `C:\` is the drive root — stripping the trailing separator would
        // give `C:` which refers to the "current directory on C:" rather than
        // the root, so the separator must stay.
        assert_eq!(normalize_scan_path("C:\\"), "C:\\");
        assert_eq!(normalize_scan_path("D:\\"), "D:\\");
    }

    #[test]
    fn test_normalize_scan_path_preserves_root_slash() {
        assert_eq!(normalize_scan_path("/"), "/");
    }

    #[test]
    fn test_normalize_scan_path_returns_empty_for_blank_input() {
        assert_eq!(normalize_scan_path("   "), "");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_is_default_app_location_rejects_user_directory() {
        assert!(!is_default_app_location("/Users/test/MyApps/Foo.app"));
        assert!(!is_default_app_location("/opt/custom/Bar.app"));
    }

    #[test]
    fn test_is_default_app_location_handles_unrelated_paths() {
        assert!(!is_default_app_location("/nonexistent/path/App.app"));
    }

    #[test]
    fn test_display_path_tildes_home_prefix() {
        let input = dirs::home_dir().unwrap().join("Applications").join("Foo.app");
        let expected = format!(
            "~{sep}Applications{sep}Foo.app",
            sep = std::path::MAIN_SEPARATOR
        );
        assert_eq!(display_path(input.to_str().unwrap()), expected);
    }

    #[test]
    fn test_display_path_passes_through_non_home_paths() {
        let outside = outside_home_path();
        assert_eq!(display_path(&outside), outside);
    }

    #[test]
    fn test_display_path_handles_bare_home() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(display_path(home.to_str().unwrap()), "~");
    }

    #[test]
    fn test_display_parent_dir_strips_app_bundle_and_tildes_home() {
        let input = dirs::home_dir().unwrap().join("Applications").join("Ice.app");
        let expected = format!("~{sep}Applications", sep = std::path::MAIN_SEPARATOR);
        assert_eq!(display_parent_dir(input.to_str().unwrap()), expected);
    }

    #[test]
    fn test_display_parent_dir_passes_through_non_home_parent() {
        let outside = outside_home_path();
        let parent = Path::new(&outside).parent().unwrap().to_str().unwrap().to_string();
        assert_eq!(display_parent_dir(&outside), parent);
    }

    /// Returns an absolute path guaranteed not to live under `$HOME` on any
    /// platform. Used by tests that need to exercise the non-home branch.
    fn outside_home_path() -> String {
        #[cfg(target_os = "windows")]
        { "C:\\ProgramData\\Asyar\\Foo.lnk".to_string() }
        #[cfg(not(target_os = "windows"))]
        { "/opt/asyar-test/Foo.app".to_string() }
    }

    #[test]
    fn test_display_path_does_not_confuse_prefix_collision() {
        // Prefix must match at a path boundary, not mid-segment — e.g. a path
        // that starts with the home string but diverges before the next
        // separator should be returned unchanged.
        let home = dirs::home_dir().unwrap();
        let sibling = format!("{}_other", home.to_str().unwrap());
        assert_eq!(display_path(&sibling), sibling);
    }

    #[test]
    fn test_is_app_bundle_no_extension_is_false() {
        assert!(!is_app_bundle(Path::new("/some/path/without_extension")));
    }

    #[test]
    fn test_is_app_bundle_wrong_extension_is_false() {
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
        assert!(is_app_bundle(Path::new("/usr/share/applications/firefox.desktop")));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_is_app_bundle_windows_dot_lnk() {
        assert!(is_app_bundle(Path::new("C:\\Users\\Public\\Desktop\\App.lnk")));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_is_app_bundle_windows_dot_exe_is_false() {
        assert!(!is_app_bundle(Path::new("C:\\Windows\\System32\\notepad.exe")));
    }

    #[test]
    fn test_scanner_new_is_empty() {
        let scanner = AppScanner::new();
        assert!(scanner.paths.is_empty());
    }

    #[test]
    fn test_scanner_scan_nonexistent_dir_does_not_crash() {
        let mut scanner = AppScanner::new();
        let result = scanner.scan_directory(Path::new("/tmp/nonexistent_asyar_apps_12345"));
        assert!(result.is_ok());
        assert!(scanner.paths.is_empty());
    }

    #[test]
    fn test_scanner_scan_all_with_extra_paths_does_not_crash() {
        let mut scanner = AppScanner::new();
        let extra = PathBuf::from("/tmp/nonexistent_asyar_apps");
        let result = scanner.scan_all(vec![extra]);
        assert!(result.is_ok());
    }

    #[test]
    fn test_scanner_discovers_app_bundles_in_temp_dir() {
        let tmp = std::env::temp_dir().join("asyar_test_scanner");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        #[cfg(target_os = "macos")]
        let app_path = tmp.join("TestApp.app");
        #[cfg(target_os = "linux")]
        let app_path = tmp.join("test.desktop");
        #[cfg(target_os = "windows")]
        let app_path = tmp.join("Test.lnk");

        // Create a fake app bundle (directory on macOS, file on others)
        #[cfg(target_os = "macos")]
        fs::create_dir_all(&app_path).unwrap();
        #[cfg(not(target_os = "macos"))]
        fs::write(&app_path, b"fake").unwrap();

        let mut scanner = AppScanner::new();
        let _ = scanner.scan_directory(&tmp);

        assert_eq!(scanner.paths.len(), 1);
        assert!(scanner.paths[0].to_lowercase().contains("test"));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_frontmost_application_struct_serializes() {
        let app = FrontmostApplication {
            name: "Safari".to_string(),
            bundle_id: Some("com.apple.Safari".to_string()),
            path: None,
            window_title: Some("Apple".to_string()),
        };
        let json = serde_json::to_string(&app).unwrap();
        assert!(json.contains("Safari"));
        assert!(json.contains("bundleId"));
        assert!(json.contains("windowTitle"));
    }

    #[test]
    fn test_sync_result_serializes() {
        let result = SyncResult { added: 5, removed: 2, total: 100 };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"added\":5"));
        assert!(json.contains("\"removed\":2"));
        assert!(json.contains("\"total\":100"));
    }
}
