//! Platform-specific abstractions.
//!
//! Each sub-module exposes safe wrappers around OS-level APIs,
//! with `// SAFETY:` comments on every underlying `unsafe` block.

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "linux")]
pub mod linux;

// Re-export the platform icon extractor under a unified name
#[cfg(target_os = "macos")]
pub use macos::extract_icon;
#[cfg(target_os = "windows")]
pub use windows::extract_icon;
#[cfg(target_os = "linux")]
pub use linux::extract_icon;
