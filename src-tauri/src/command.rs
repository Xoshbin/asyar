use enigo::{Enigo, KeyboardControllable};
use log::info;
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use tauri_nspanel::ManagerExt;

use crate::SPOTLIGHT_LABEL;

#[tauri::command]
pub fn show(app_handle: AppHandle) {
    let panel = app_handle.get_webview_panel(SPOTLIGHT_LABEL).unwrap();

    panel.show();
}

#[tauri::command]
pub fn hide(app_handle: AppHandle) {
    let panel = app_handle.get_webview_panel(SPOTLIGHT_LABEL).unwrap();

    if panel.is_visible() {
        panel.order_out(None);
    }
}

#[tauri::command]
pub fn simulate_paste() {
    let mut enigo = Enigo::new();
    // Simulate CMD+V (⌘+V) on macOS
    enigo.key_down(enigo::Key::Meta);
    enigo.key_click(enigo::Key::Layout('v'));
    enigo.key_up(enigo::Key::Meta);
}

#[derive(Debug)]
struct AppScanner {
    paths: Vec<String>,
}

impl AppScanner {
    fn new() -> Self {
        Self { paths: Vec::new() }
    }

    fn scan_directory(&mut self, dir_path: &Path) -> Result<(), String> {
        if !dir_path.exists() {
            return Ok(());
        }

        match fs::read_dir(dir_path) {
            Ok(entries) => {
                for entry in entries.filter_map(Result::ok) {
                    if let Ok(file_type) = entry.file_type() {
                        if file_type.is_dir() {
                            if let Some(path_str) = entry.path().to_str() {
                                if path_str.ends_with(".app") {
                                    self.paths.push(path_str.to_string());
                                }
                            }
                        }
                    }
                }
                Ok(())
            }
            Err(err) => Err(format!("Error reading directory: {}", err)),
        }
    }

    fn scan_all(&mut self) -> Result<(), String> {
        let directories = ["/Applications", "/System/Applications"];

        for dir in directories.iter() {
            if let Err(e) = self.scan_directory(Path::new(dir)) {
                info!("Error scanning {}: {}", dir, e);
            }
        }

        Ok(())
    }
}

#[tauri::command]
pub fn list_applications() -> Result<Vec<String>, String> {
    let mut scanner = AppScanner::new();
    scanner.scan_all()?;
    Ok(scanner.paths)
}
