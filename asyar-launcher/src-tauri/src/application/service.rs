use crate::error::AppError;
use crate::search_engine::models::{Application, SearchableItem};
use crate::search_engine::SearchState;
use log::info;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

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
        if let Some((name, id, path, title)) =
            crate::platform::macos::get_frontmost_application_metadata()
        {
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
        if let Some((name, path, title)) =
            crate::platform::windows::get_frontmost_application_metadata()
        {
            return Ok(FrontmostApplication {
                name,
                bundle_id: None,
                path: Some(path),
                window_title: Some(title),
            });
        }
    }

    Err(AppError::Platform(
        "Failed to retrieve frontmost application metadata".to_string(),
    ))
}

/// Scans for applications in default and extra paths, diffs against the search index,
/// and updates the search state.
pub fn sync_application_index<R: tauri::Runtime>(
    app: &AppHandle<R>,
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

        current_apps.insert(
            full_app_id.clone(),
            Application {
                id: full_app_id,
                name,
                path: path_str.clone(),
                usage_count: 0,
                icon: extract_app_icon(path_str, &icon_cache_dir),
                last_used_at: None,
                bundle_id: extract_bundle_id(Path::new(path_str)),
            },
        );
    }

    #[cfg(target_os = "windows")]
    for uwp in &scanner.uwp_apps {
        let sanitized_name = uwp.name.replace([' ', '/'], "_");
        let sanitized_aumid = uwp.aumid.replace([' ', '/'], "_");
        let full_app_id = format!("app_{}_{}", sanitized_name, sanitized_aumid);
        let path = format!("shell:AppsFolder\\{}", uwp.aumid);

        current_apps.insert(
            full_app_id.clone(),
            Application {
                id: full_app_id,
                name: uwp.name.clone(),
                path: path.clone(),
                usage_count: 0,
                icon: extract_uwp_app_icon(&uwp.aumid, &uwp.install_location, &icon_cache_dir),
                last_used_at: None,
                bundle_id: Some(uwp.aumid.clone()),
            },
        );
    }

    // 3. Get currently indexed app_ IDs
    let indexed_ids: Vec<String> = {
        let items = search_state
            .items
            .read()
            .map_err(|e| AppError::Other(e.to_string()))?;
        items
            .iter()
            .filter_map(|item| {
                let id = item.id();
                if id.starts_with("app_") {
                    Some(id.to_string())
                } else {
                    None
                }
            })
            .collect()
    };
    let indexed_set: HashSet<&str> = indexed_ids.iter().map(|s| s.as_str()).collect();
    let current_set: HashSet<&str> = current_apps.keys().map(|s| s.as_str()).collect();

    // 4. Diff
    let to_add: Vec<String> = current_set
        .difference(&indexed_set)
        .map(|s| s.to_string())
        .collect();
    let to_remove: Vec<String> = indexed_set
        .difference(&current_set)
        .map(|s| s.to_string())
        .collect();

    let added = to_add.len() as u32;
    let removed = to_remove.len() as u32;

    // 5. Update SearchState
    if !to_add.is_empty() || !to_remove.is_empty() {
        let mut items = search_state
            .items
            .write()
            .map_err(|e| AppError::Other(e.to_string()))?;

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
    search_state
        .save_items_to_db()
        .map_err(|e| AppError::Other(format!("Failed to save index: {}", e)))?;

    let total = {
        let items = search_state
            .items
            .read()
            .map_err(|e| AppError::Other(e.to_string()))?;
        items.iter().filter(|i| i.id().starts_with("app_")).count() as u32
    };

    info!(
        "App sync complete: {} added, {} removed, {} total apps",
        added, removed, total
    );
    Ok(SyncResult {
        added,
        removed,
        total,
    })
}

pub fn list_applications<R: tauri::Runtime>(
    app: &AppHandle<R>,
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

    #[cfg(target_os = "windows")]
    for uwp in &scanner.uwp_apps {
        let sanitized_name = uwp.name.replace([' ', '/'], "_");
        let sanitized_aumid = uwp.aumid.replace([' ', '/'], "_");
        let full_app_id = format!("app_{}_{}", sanitized_name, sanitized_aumid);
        let path = format!("shell:AppsFolder\\{}", uwp.aumid);

        applications.push(Application {
            id: full_app_id,
            name: uwp.name.clone(),
            path: path.clone(),
            usage_count: 0,
            icon: extract_uwp_app_icon(&uwp.aumid, &uwp.install_location, &icon_cache_dir),
            last_used_at: None,
            bundle_id: Some(uwp.aumid.clone()),
        });
    }

    Ok(applications)
}

// `any(windows, test)` so the deserialization-contract test compiles on every
// platform — the PascalCase mismatch below was a Windows-only runtime failure
// that a host-platform unit test now guards against.
#[cfg(any(target_os = "windows", test))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct UwpApp {
    pub name: String,
    pub aumid: String,
    pub install_location: String,
}

struct AppScanner {
    paths: Vec<String>,
    /// Paths already recorded, to skip duplicates when scan roots overlap
    /// (e.g. a custom scan path that is an ancestor of a default one — #410).
    seen: HashSet<String>,
    #[cfg(target_os = "windows")]
    uwp_apps: Vec<UwpApp>,
}

impl AppScanner {
    fn new() -> Self {
        Self {
            paths: Vec::new(),
            seen: HashSet::new(),
            #[cfg(target_os = "windows")]
            uwp_apps: Vec::new(),
        }
    }

    fn scan_directory(&mut self, dir_path: &Path) -> Result<(), AppError> {
        if !dir_path.is_dir() {
            return Ok(());
        }
        for entry in fs::read_dir(dir_path)?.filter_map(Result::ok) {
            let path = entry.path();
            if is_app_bundle(&path) {
                if let Some(path_str) = path.to_str() {
                    if self.seen.insert(path_str.to_string()) {
                        self.paths.push(path_str.to_string());
                    }
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

        #[cfg(target_os = "windows")]
        {
            if let Err(e) = self.scan_uwp_apps() {
                info!("Error scanning UWP apps: {}", e);
            }
        }

        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn scan_uwp_apps(&mut self) -> Result<(), AppError> {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        // CREATE_NO_WINDOW — keep the console-subsystem `powershell` child from
        // briefly flashing a black console window when our GUI process spawns it
        // (happens during the startup index, #411).
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let output = Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                uwp_scan_powershell_script(),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let output = match output {
            Ok(out) => out,
            Err(e) => {
                info!("Failed to run PowerShell for UWP apps: {}", e);
                return Ok(());
            }
        };

        if !output.status.success() {
            let err_msg = String::from_utf8_lossy(&output.stderr);
            info!("PowerShell UWP scan failed: {}", err_msg);
            return Ok(());
        }

        let json_str = String::from_utf8_lossy(&output.stdout);
        let trimmed = json_str.trim();
        if trimmed.is_empty() {
            return Ok(());
        }

        let raw_apps: Vec<UwpApp> = if trimmed.starts_with('[') {
            serde_json::from_str(trimmed).unwrap_or_default()
        } else {
            serde_json::from_str::<UwpApp>(trimmed)
                .map(|app| vec![app])
                .unwrap_or_default()
        };

        for app in raw_apps {
            if self.seen.insert(app.aumid.clone()) {
                self.uwp_apps.push(app);
            }
        }

        Ok(())
    }
}

/// PowerShell that enumerates launchable packaged (UWP/MSIX) apps via
/// `Get-StartApps` — the authoritative list the Start menu itself uses — and
/// best-effort resolves each one's on-disk `InstallLocation` (used only to find
/// an icon). Gated to `windows`/`test` so the regression test can assert its
/// shape on every platform without a dead-code warning elsewhere.
#[cfg(any(target_os = "windows", test))]
fn uwp_scan_powershell_script() -> &'static str {
    r#"
            $OutputEncoding = [System.Text.Encoding]::UTF8
            [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
            $packages = @{}
            Get-AppxPackage | ForEach-Object {
                if ($_.InstallLocation) {
                    $packages[$_.PackageFamilyName] = $_.InstallLocation
                }
            }
            $result = Get-StartApps | Where-Object { $_.AppID -like '*!*' } | ForEach-Object {
                $aumid = $_.AppID
                $family = $aumid.Split('!')[0]
                $loc = $packages[$family]
                if (-not $loc) { $loc = '' }
                [PSCustomObject]@{
                    Name = $_.Name
                    Aumid = $aumid
                    InstallLocation = $loc
                }
            }
            if ($result) {
                $result | ConvertTo-Json -Compress
            }
        "#
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
    {
        path.extension().map(|e| e == "app").unwrap_or(false)
    }

    #[cfg(target_os = "linux")]
    {
        path.extension().map(|e| e == "desktop").unwrap_or(false)
    }

    #[cfg(target_os = "windows")]
    {
        path.extension().map(|e| e == "lnk").unwrap_or(false)
    }
}

#[allow(dead_code)]
fn find_uwp_icon_path_from_manifest_content(content: &str) -> Option<String> {
    if let Some(caps) = Regex::new(r#"Square44x44Logo\s*=\s*"([^"]+)""#)
        .ok()?
        .captures(content)
    {
        Some(caps.get(1)?.as_str().to_string())
    } else if let Some(caps) = Regex::new(r#"Square150x150Logo\s*=\s*"([^"]+)""#)
        .ok()?
        .captures(content)
    {
        Some(caps.get(1)?.as_str().to_string())
    } else if let Some(caps) = Regex::new(r#"Logo\s*=\s*"([^"]+)""#)
        .ok()?
        .captures(content)
    {
        Some(caps.get(1)?.as_str().to_string())
    } else {
        None
    }
}

#[allow(dead_code)]
fn score_candidate(filename: &str) -> i32 {
    let mut score = 0;
    if filename.contains("targetsize-48") {
        score += 100;
    } else if filename.contains("targetsize-32") {
        score += 90;
    } else if filename.contains("targetsize-256") {
        score += 85;
    } else if filename.contains("scale-200") {
        score += 80;
    } else if filename.contains("scale-150") {
        score += 70;
    } else if filename.contains("scale-100") {
        score += 60;
    } else if !filename.contains("scale-") && !filename.contains("targetsize-") {
        score += 50;
    }

    if filename.contains("altform-unplated") {
        score += 10;
    }

    score
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
        if !plist_path.is_file() {
            return None;
        }
        let value = plist::Value::from_file(&plist_path).ok()?;
        let dict = value.as_dictionary()?;
        let id = dict.get("CFBundleIdentifier")?.as_string()?;
        let trimmed = id.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
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
            if !in_desktop_entry {
                continue;
            }
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
        wm_class
            .filter(|s| !s.is_empty())
            .or_else(|| exec_cmd.filter(|s| !s.is_empty()))
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

fn get_icon_cache_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|p| p.join("icon_cache"))
        .unwrap_or_else(|_| {
            #[cfg(target_os = "windows")]
            {
                app.path()
                    .app_local_data_dir()
                    .unwrap_or_default()
                    .join("icon_cache")
            }
            #[cfg(not(target_os = "windows"))]
            {
                PathBuf::from("/tmp/asyar_icon_cache")
            }
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

#[cfg(target_os = "windows")]
pub(crate) fn extract_uwp_app_icon(
    aumid: &str,
    install_location: &str,
    cache_dir: &Path,
) -> Option<String> {
    let cache_key = format!("uwp_{}", aumid.replace(['/', '\\', ':', ' ', '!'], "_"));
    let cache_filename = format!("{}.png", &cache_key[..cache_key.len().min(200)]);
    let cache_file = cache_dir.join(&cache_filename);

    if cache_file.exists() {
        return Some(format!("http://asyar-icon.localhost/{}", cache_filename));
    }

    if let Some(bytes) = find_uwp_icon_bytes(install_location) {
        let _ = std::fs::create_dir_all(cache_dir);
        if std::fs::write(&cache_file, bytes).is_ok() {
            return Some(format!("http://asyar-icon.localhost/{}", cache_filename));
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn find_uwp_icon_bytes(install_location: &str) -> Option<Vec<u8>> {
    // An app indexed without a resolvable install location has no manifest to
    // read. Bail early so `Path::new("").join(...)` doesn't probe the process
    // CWD for a stray `AppxManifest.xml`.
    if install_location.is_empty() {
        return None;
    }
    let manifest_path = Path::new(install_location).join("AppxManifest.xml");
    if !manifest_path.is_file() {
        return None;
    }

    let content = std::fs::read_to_string(&manifest_path).ok()?;
    let logo_path = find_uwp_icon_path_from_manifest_content(&content)?;

    let logo_path_clean = if logo_path.starts_with("ms-resource:") {
        logo_path.strip_prefix("ms-resource:").unwrap().to_string()
    } else {
        logo_path
    };

    let logo_path_normalized = logo_path_clean.replace('\\', "/");
    let full_logo_path = Path::new(install_location).join(&logo_path_normalized);

    let parent_dir = full_logo_path.parent()?;
    if !parent_dir.is_dir() {
        return None;
    }

    let stem = full_logo_path.file_stem()?.to_str()?;
    let stem_lower = stem.to_lowercase();

    let mut best_candidate: Option<PathBuf> = None;
    let mut best_score = -1;

    if let Ok(entries) = std::fs::read_dir(parent_dir) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_file() {
                if let Some(filename) = path.file_name().and_then(|s| s.to_str()) {
                    let filename_lower = filename.to_lowercase();
                    if filename_lower.starts_with(&stem_lower) {
                        let score = score_candidate(&filename_lower);
                        if score > best_score {
                            best_score = score;
                            best_candidate = Some(path);
                        }
                    }
                }
            }
        }
    }

    if let Some(cand) = best_candidate {
        std::fs::read(cand).ok()
    } else {
        std::fs::read(full_logo_path).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_uwp_scan_script_indexes_apps_without_install_location() {
        // #411: launchable packaged apps (e.g. Codex) were dropped when their
        // InstallLocation couldn't be resolved from Get-AppxPackage. The script
        // must emit every Get-StartApps AUMID entry; InstallLocation is only an
        // icon hint and may be blank.
        let script = uwp_scan_powershell_script();

        // Still drives off the authoritative launchable list, AUMID-only.
        assert!(script.contains("Get-StartApps"));
        assert!(script.contains("$_.AppID -like '*!*'"));

        // Must NOT gate emission on a resolved install location.
        assert!(
            !script.contains("if ($loc) {"),
            "script still drops apps whose InstallLocation is unresolved"
        );
        // Must fall back to an empty location instead of dropping the app.
        assert!(
            script.contains("if (-not $loc) { $loc = '' }"),
            "script must keep launchable apps even without an InstallLocation"
        );
    }

    #[test]
    fn test_uwp_app_deserializes_pascalcase_powershell_json() {
        // The scan PowerShell emits PascalCase keys (Name/Aumid/InstallLocation);
        // UwpApp's fields are snake_case. Without a rename the deserialize fails
        // and every AppX app is silently dropped (#411). This is the JSON->struct
        // seam the string-shape tests don't cover.
        let json = r#"{"Name":"Calculator","Aumid":"Microsoft.WindowsCalculator_8wekyb3d8bbwe!App","InstallLocation":"C:\\Program Files\\WindowsApps\\Calc"}"#;
        let app: UwpApp = serde_json::from_str(json).expect("PascalCase JSON must deserialize");
        assert_eq!(app.name, "Calculator");
        assert_eq!(app.aumid, "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App");
        assert_eq!(app.install_location, "C:\\Program Files\\WindowsApps\\Calc");

        // Array form (the common multi-app case) must work too.
        let arr = r#"[{"Name":"A","Aumid":"a!b","InstallLocation":""}]"#;
        let apps: Vec<UwpApp> = serde_json::from_str(arr).expect("array form must deserialize");
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].install_location, "");
    }

    #[test]
    fn test_uwp_scan_script_forces_utf8_output() {
        // Windows PowerShell 5.1 writes redirected stdout in the legacy OEM code
        // page; without forcing UTF-8, non-ASCII app names are corrupted when
        // Rust reads the captured bytes as UTF-8.
        let script = uwp_scan_powershell_script();
        assert!(
            script.contains("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8"),
            "script must force UTF-8 stdout so non-ASCII app names survive"
        );
    }

    #[test]
    fn test_uwp_scan_script_avoids_quadratic_array_growth() {
        // `$x += ` inside a loop reallocates the whole array every iteration
        // (O(n^2)); accumulate via direct pipeline assignment instead.
        let script = uwp_scan_powershell_script();
        assert!(
            !script.contains("+="),
            "accumulate UWP apps via pipeline assignment, not array +="
        );
    }

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
        let input = dirs::home_dir()
            .unwrap()
            .join("Applications")
            .join("Foo.app");
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
        let input = dirs::home_dir()
            .unwrap()
            .join("Applications")
            .join("Ice.app");
        let expected = format!("~{sep}Applications", sep = std::path::MAIN_SEPARATOR);
        assert_eq!(display_parent_dir(input.to_str().unwrap()), expected);
    }

    #[test]
    fn test_display_parent_dir_passes_through_non_home_parent() {
        let outside = outside_home_path();
        let parent = Path::new(&outside)
            .parent()
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert_eq!(display_parent_dir(&outside), parent);
    }

    /// Returns an absolute path guaranteed not to live under `$HOME` on any
    /// platform. Used by tests that need to exercise the non-home branch.
    fn outside_home_path() -> String {
        #[cfg(target_os = "windows")]
        {
            "C:\\ProgramData\\Asyar\\Foo.lnk".to_string()
        }
        #[cfg(not(target_os = "windows"))]
        {
            "/opt/asyar-test/Foo.app".to_string()
        }
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
        assert!(is_app_bundle(Path::new(
            "/usr/share/applications/firefox.desktop"
        )));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_is_app_bundle_windows_dot_lnk() {
        assert!(is_app_bundle(Path::new(
            "C:\\Users\\Public\\Desktop\\App.lnk"
        )));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_is_app_bundle_windows_dot_exe_is_false() {
        assert!(!is_app_bundle(Path::new(
            "C:\\Windows\\System32\\notepad.exe"
        )));
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
    fn test_scanner_dedupes_overlapping_scan_dirs() {
        // Reproduces #410: a custom scan path that is an ancestor of a default
        // scan path makes the same app bundle reachable through two scan roots.
        // The scanner must return each path exactly once — duplicate paths
        // produce duplicate app IDs downstream, which crashes the keyed list
        // in the Applications settings tab.
        let tmp = std::env::temp_dir().join("asyar_test_overlap_scan");
        let _ = fs::remove_dir_all(&tmp);
        let child = tmp.join("child");
        fs::create_dir_all(&child).unwrap();

        #[cfg(target_os = "macos")]
        let app_path = child.join("Overlap.app");
        #[cfg(target_os = "linux")]
        let app_path = child.join("overlap.desktop");
        #[cfg(target_os = "windows")]
        let app_path = child.join("Overlap.lnk");

        #[cfg(target_os = "macos")]
        fs::create_dir_all(&app_path).unwrap();
        #[cfg(not(target_os = "macos"))]
        fs::write(&app_path, b"fake").unwrap();

        let mut scanner = AppScanner::new();
        // Simulate scan_all visiting both an ancestor (custom path) and the
        // nested default path. The ancestor scan recurses into `child`.
        scanner.scan_directory(&tmp).unwrap();
        scanner.scan_directory(&child).unwrap();

        assert_eq!(
            scanner.paths.len(),
            1,
            "overlapping scan roots must not yield duplicate paths, got {:?}",
            scanner.paths
        );

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
        let result = SyncResult {
            added: 5,
            removed: 2,
            total: 100,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"added\":5"));
        assert!(json.contains("\"removed\":2"));
        assert!(json.contains("\"total\":100"));
    }

    #[test]
    fn test_find_uwp_icon_path_from_manifest_content() {
        let manifest = r#"
            <Applications>
              <Application Id="App" Executable="YourApp.exe" EntryPoint="YourApp.App">
                <uap:VisualElements 
                    DisplayName="Your App Name" 
                    Square150x150Logo="Assets\Square150x150Logo.png" 
                    Square44x44Logo="Assets\Square44x44Logo.png" 
                    Description="A brief description" 
                    BackgroundColor="transparent">
                </uap:VisualElements>
              </Application>
            </Applications>
        "#;
        assert_eq!(
            find_uwp_icon_path_from_manifest_content(manifest),
            Some("Assets\\Square44x44Logo.png".to_string())
        );

        let manifest_logo_only = r#"
            <Applications>
              <Application Id="App" Executable="YourApp.exe" EntryPoint="YourApp.App">
                <VisualElements 
                    Logo="Assets\Logo.png">
                </VisualElements>
              </Application>
            </Applications>
        "#;
        assert_eq!(
            find_uwp_icon_path_from_manifest_content(manifest_logo_only),
            Some("Assets\\Logo.png".to_string())
        );
    }

    #[test]
    fn test_score_candidate() {
        assert_eq!(
            score_candidate("CalculatorSdkLogo.targetsize-48_altform-unplated.png"),
            110
        );
        assert_eq!(score_candidate("CalculatorSdkLogo.targetsize-48.png"), 100);
        assert_eq!(score_candidate("CalculatorSdkLogo.scale-200.png"), 80);
        assert_eq!(score_candidate("CalculatorSdkLogo.png"), 50);
    }
}
