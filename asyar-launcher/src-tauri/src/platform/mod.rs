//! Platform-specific abstractions.
//!
//! Each sub-module exposes safe wrappers around OS-level APIs,
//! with `// SAFETY:` comments on every underlying `unsafe` block.

pub mod input;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "linux")]
pub mod linux_key_resolver;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
pub mod windows_key_resolver;

// Re-export the platform icon extractor under a unified name
#[cfg(target_os = "linux")]
pub use linux::extract_icon;
#[cfg(target_os = "macos")]
pub use macos::extract_icon;
#[cfg(target_os = "windows")]
pub use windows::extract_icon;

// Likewise for the localized bundle display name.
#[cfg(target_os = "macos")]
pub use macos::localized_bundle_name;

/// Non-macOS builds have no bundle-level display-name lookup, so callers fall
/// back to the file stem. Linux `.desktop` files do carry `Name[<lang>]=`
/// entries — wiring those up is a separate change.
#[cfg(not(target_os = "macos"))]
pub fn localized_bundle_name(_path: &std::path::Path) -> Option<String> {
    None
}
