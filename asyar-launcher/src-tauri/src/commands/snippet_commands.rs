use crate::AppState;
use std::sync::atomic::Ordering;
use tauri::AppHandle;

/// Replaces the Rust active_snippets map. Call after every add/update/delete.
#[tauri::command]
pub fn sync_snippets_to_rust(
    snippets: Vec<(String, String)>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut map = state.active_snippets.lock().map_err(|e| e.to_string())?;
    map.clear();
    for (keyword, expansion) in snippets {
        map.insert(keyword, expansion);
    }
    Ok(())
}

/// Enables or disables the background expansion listener.
#[tauri::command]
pub fn set_snippets_enabled(
    enabled: bool,
    state: tauri::State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<(), String> {
    if enabled {
        if !check_snippet_permission() {
            return Err(
                "Background expansion requires Accessibility permission. Open System Settings → Privacy & Security → Accessibility and add Asyar, then try again.".to_string(),
            );
        }
        // Start the listener thread exactly once (rdev::listen is not restartable)
        if !state.listener_started.swap(true, Ordering::Relaxed) {
            crate::snippets::start_listener(app_handle);
        }
    }
    state.snippets_enabled.store(enabled, Ordering::Relaxed);
    Ok(())
}

/// Returns true if the Accessibility permission required by rdev is granted.
#[tauri::command]
pub fn check_snippet_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }
        unsafe { AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Opens macOS System Settings > Privacy & Security > Accessibility.
#[tauri::command]
pub fn open_accessibility_preferences() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
    }
}
