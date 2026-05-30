pub mod types;
pub use types::{validate_bounds_update, WindowBounds, WindowBoundsUpdate};

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "windows")]
pub mod windows;

pub mod linux;
