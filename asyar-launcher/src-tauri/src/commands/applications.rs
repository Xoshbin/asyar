use crate::search_engine::models::Application;
use crate::error::AppError;
use log::info;
use serde::{Deserialize, Serialize};
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
    #[cfg(target_os = "macos")]
    {
        extract_icon_macos(app_path)
    }
    #[cfg(target_os = "linux")]
    {
        extract_icon_linux(app_path)
    }
    #[cfg(target_os = "windows")]
    {
        extract_icon_windows(app_path)
    }
}

#[cfg(target_os = "macos")]
fn extract_icon_macos(app_path: &str) -> Option<Vec<u8>> {
    let app = Path::new(app_path);
    let plist_path = app.join("Contents/Info.plist");

    // Read CFBundleIconFile from Info.plist
    let icon_name: String = plist::from_file::<_, plist::Value>(&plist_path)
        .ok()
        .and_then(|v| v.into_dictionary())
        .and_then(|d| d.get("CFBundleIconFile").cloned())
        .and_then(|v| v.into_string())
        .unwrap_or_else(|| "AppIcon".to_string());

    // Add .icns extension if missing
    let icon_filename = if icon_name.ends_with(".icns") {
        icon_name
    } else {
        format!("{}.icns", icon_name)
    };

    let icns_path = app.join("Contents/Resources").join(&icon_filename);

    // Fall back to scanning Resources for any .icns file
    let icns_path = if icns_path.exists() {
        icns_path
    } else {
        let resources_dir = app.join("Contents/Resources");
        std::fs::read_dir(&resources_dir)
            .ok()?
            .filter_map(|e| e.ok())
            .find(|e| e.path().extension().map(|x| x == "icns").unwrap_or(false))
            .map(|e| e.path())?
    };

    // Parse .icns and extract a 32x32 (or best available) PNG image
    let file = std::fs::File::open(&icns_path).ok()?;
    let icon_family = icns::IconFamily::read(file).ok()?;

    // Preferred sizes in order: 32x32, 64x64, 128x128, 16x16
    let preferred = [
        icns::IconType::RGB24_32x32,
        icns::IconType::RGBA32_32x32,
        icns::IconType::RGBA32_64x64,
        icns::IconType::RGBA32_128x128,
        icns::IconType::RGB24_16x16,
    ];

    for icon_type in &preferred {
        if let Ok(image) = icon_family.get_icon_with_type(*icon_type) {
            let mut buf = std::io::Cursor::new(Vec::new());
            if image.write_png(&mut buf).is_ok() {
                return Some(buf.into_inner());
            }
        }
    }

    // If no preferred type found, try any available image in the family
    for icon_type in icon_family.available_icons() {
        if let Ok(image) = icon_family.get_icon_with_type(icon_type) {
            let mut buf = std::io::Cursor::new(Vec::new());
            if image.write_png(&mut buf).is_ok() {
                return Some(buf.into_inner());
            }
        }
    }

    None
}

#[cfg(target_os = "linux")]
fn extract_icon_linux(desktop_path: &str) -> Option<Vec<u8>> {
    use std::io::{BufRead, BufReader};

    // Parse .desktop file for Icon= entry
    let file = std::fs::File::open(desktop_path).ok()?;
    let reader = BufReader::new(file);
    let icon_value = reader
        .lines()
        .filter_map(|l| l.ok())
        .find(|l| l.starts_with("Icon="))
        .map(|l| l[5..].trim().to_string())?;

    // If it's an absolute path, read it directly
    if icon_value.starts_with('/') {
        return std::fs::read(&icon_value).ok();
    }

    // Otherwise resolve from common icon theme directories
    let sizes = ["48", "32", "256", "128", "64", "22", "16"];
    let extensions = ["png", "xpm"];

    let search_dirs = vec![
        "/usr/share/icons/hicolor",
        "/usr/share/icons/Adwaita",
        "/usr/share/icons",
        "/usr/share/pixmaps",
    ];

    for base in &search_dirs {
        for size in &sizes {
            for ext in &extensions {
                let path = format!("{}/{}/apps/{}.{}", base, size, icon_value, ext);
                if let Ok(bytes) = std::fs::read(&path) {
                    return Some(bytes);
                }
                // Also try without size subdirectory (pixmaps)
                let path2 = format!("{}/{}.{}", base, icon_value, ext);
                if let Ok(bytes) = std::fs::read(&path2) {
                    return Some(bytes);
                }
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn extract_icon_windows(exe_path: &str) -> Option<Vec<u8>> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS,
    };
    use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};
    use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;

    // Convert path to null-terminated wide string
    let wide_path: Vec<u16> = OsStr::new(exe_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut file_info = SHFILEINFOW::default();

    // Ask Windows Shell for the large (32x32) icon associated with this exe
    let result = unsafe {
        SHGetFileInfoW(
            PCWSTR(wide_path.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut file_info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };

    if result == 0 {
        return None;
    }

    let hicon = file_info.hIcon;
    if hicon.is_invalid() {
        return None;
    }

    // Retrieve the underlying bitmaps from the HICON
    let mut icon_info = ICONINFO::default();
    let got_info = unsafe { GetIconInfo(hicon, &mut icon_info) };

    if got_info.is_err() {
        unsafe { let _ = DestroyIcon(hicon); }
        return None;
    }

    let size: i32 = 32;

    // Set up a device context and BITMAPINFO for 32-bit top-down BGRA readback
    let dc = unsafe { CreateCompatibleDC(None) };

    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size,
            biHeight: -size, // negative = top-down row order
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0, // BI_RGB
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [Default::default()],
    };

    let mut pixels: Vec<u8> = vec![0u8; (size * size * 4) as usize];

    let old_obj = unsafe { SelectObject(dc, icon_info.hbmColor.into()) };

    let rows = unsafe {
        GetDIBits(
            dc,
            icon_info.hbmColor,
            0,
            size as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        )
    };

    // Clean up GDI resources
    unsafe {
        SelectObject(dc, old_obj);
        DeleteDC(dc);
        if !icon_info.hbmColor.is_invalid() { let _ = DeleteObject(icon_info.hbmColor.into()); }
        if !icon_info.hbmMask.is_invalid()  { let _ = DeleteObject(icon_info.hbmMask.into());  }
        let _ = DestroyIcon(hicon);
    }

    if rows == 0 {
        return None;
    }

    // Windows returns BGRA — swap B and R channels to produce RGBA
    for chunk in pixels.chunks_exact_mut(4) {
        chunk.swap(0, 2);
    }

    // If all alpha bytes are zero, the icon uses old-style mask transparency.
    // In that case, set every non-black pixel to fully opaque so it renders correctly.
    let all_transparent = pixels.chunks_exact(4).all(|c| c[3] == 0);
    if all_transparent {
        for chunk in pixels.chunks_exact_mut(4) {
            if chunk[0] != 0 || chunk[1] != 0 || chunk[2] != 0 {
                chunk[3] = 255;
            }
        }
    }

    // Encode raw RGBA buffer as PNG
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut buf), size as u32, size as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(&pixels).ok()?;
    }

    if buf.is_empty() {
        None
    } else {
        Some(buf)
    }
}

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

// Modified list_applications to take State and update the in-memory cache
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
        let sanitized_name = name.replace(|c: char| c == ' ' || c == '/', "_");
        let sanitized_path = path_str.replace(|c: char| c == ' ' || c == '/', "_");

        // Create the FULL object ID directly
        let full_app_id = format!("app_{}_{}", sanitized_name, sanitized_path);
        // --- End ID Generation ---

        applications.push(Application {
            id: full_app_id, // Store the FULL ID (e.g., "app_Name__Path...")
            name,
            path: path_str.clone(),
            usage_count: 0,
            icon: extract_app_icon(&path_str, &icon_cache_dir),
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
