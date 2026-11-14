//! OS platform abstractions for Asyar.
//!
//! Provides isolated, safe wrappers around platform-specific OS APIs for macOS,
//! Windows, and Linux without dependencies on the desktop framework.

pub mod calendar;
pub mod error;
pub(crate) mod ics;
pub mod input;
pub mod keyboard;
pub mod locale;
pub mod media;
pub mod shortcuts;
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

pub use calendar::*;
pub use error::PlatformError;
pub use input::*;
pub use keyboard::*;
pub use locale::*;
pub use media::*;
pub use shortcuts::*;
pub use window::{ThemePreference, WindowStyling};

/// Result of extracting an application or file icon.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExtractedIcon {
    /// A real icon extracted from the target binary, bundle, or icon resource.
    Icon(Vec<u8>),
    /// A generic shell placeholder returned while a target is missing or locked.
    Placeholder(Vec<u8>),
}

#[cfg(target_os = "linux")]
pub use linux::extract_icon;
#[cfg(target_os = "macos")]
pub use macos::extract_icon;
#[cfg(target_os = "windows")]
pub use windows::extract_icon;

/// Extracts an icon while distinguishing real icons from generic shell placeholders.
#[cfg(target_os = "windows")]
pub fn extract_icon_outcome(path: &std::path::Path) -> Option<ExtractedIcon> {
    windows::extract_icon_outcome(path)
}

/// Extracts an icon while distinguishing real icons from generic shell placeholders.
#[cfg(not(target_os = "windows"))]
pub fn extract_icon_outcome(path: &std::path::Path) -> Option<ExtractedIcon> {
    extract_icon(path).map(ExtractedIcon::Icon)
}

#[cfg(target_os = "linux")]
pub use linux::localized_bundle_name;
#[cfg(target_os = "macos")]
pub use macos::localized_bundle_name;

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn localized_bundle_name(_path: &std::path::Path) -> Option<String> {
    None
}
