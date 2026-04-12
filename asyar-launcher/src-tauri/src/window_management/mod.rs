pub mod types;
pub use types::{WindowBounds, WindowBoundsUpdate, validate_bounds_update};

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "windows")]
pub mod windows;

pub mod linux;
