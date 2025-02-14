#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

#[cfg_attr(mobile, tauri::mobile_entry_point)]
fn main() {
    asyar::create_app()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
