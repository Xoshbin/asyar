//! OS platform abstractions for Asyar.
//!
//! Provides isolated, safe wrappers around platform-specific OS APIs for macOS,
//! Windows, and Linux without dependencies on the desktop framework.

pub mod error;
pub mod input;
pub mod keyboard;
pub mod locale;
pub mod window;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(not(target_os = "linux"))]
pub mod linux; // compiled for test mocks / desktop entry parsing
#[cfg(target_os = "linux")]
pub mod linux_key_resolver;

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
pub mod windows_key_resolver;

pub use error::PlatformError;
pub use input::*;
pub use keyboard::*;
pub use locale::*;
pub use window::{ThemePreference, WindowStyling};

#[cfg(target_os = "linux")]
pub use linux::extract_icon;
#[cfg(target_os = "macos")]
pub use macos::extract_icon;
#[cfg(target_os = "windows")]
pub use windows::extract_icon;

#[cfg(target_os = "linux")]
pub use linux::localized_bundle_name;
#[cfg(target_os = "macos")]
pub use macos::localized_bundle_name;

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn localized_bundle_name(_path: &std::path::Path) -> Option<String> {
    None
}
