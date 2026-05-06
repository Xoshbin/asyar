//! Tauri command wrapping `platform::macos::sf_symbols`. Off-macOS the stub
//! errors — the frontend never invokes it there, but `generate_handler!`
//! needs the symbol to exist at compile time.

#[cfg(target_os = "macos")]
pub use crate::platform::macos::sf_symbols::SymbolMask;

#[cfg(not(target_os = "macos"))]
#[derive(serde::Serialize)]
pub struct SymbolMask {
    pub png_b64: String,
    pub width: f64,
    pub height: f64,
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn render_sf_symbol_mask(
    name: String,
    size: f64,
    weight: Option<String>,
) -> Result<SymbolMask, String> {
    crate::platform::macos::sf_symbols::render_sf_symbol_mask(name, size, weight)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn render_sf_symbol_mask(
    _name: String,
    _size: f64,
    _weight: Option<String>,
) -> Result<SymbolMask, String> {
    Err("SF Symbols only available on macOS".into())
}
