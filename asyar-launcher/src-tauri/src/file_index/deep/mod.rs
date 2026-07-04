//! Deep-search: on-demand delegation to the OS-native search tool, run
//! exactly once per explicit user action (never per keystroke). Whichever
//! provider exists on this machine wins; if none does, the feature simply
//! isn't offered — no cross-platform shim, no degraded fallback.

#[cfg(target_os = "macos")]
pub mod mdfind;
#[cfg(target_os = "windows")]
pub mod everything;
#[cfg(target_os = "linux")]
pub mod plocate;

use std::sync::OnceLock;

use super::provider::DeepProvider;

fn platform_provider() -> Box<dyn DeepProvider> {
    #[cfg(target_os = "macos")]
    {
        Box::new(mdfind::MdfindProvider)
    }
    #[cfg(target_os = "windows")]
    {
        Box::new(everything::EverythingProvider)
    }
    #[cfg(target_os = "linux")]
    {
        Box::new(plocate::PlocateProvider)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        compile_error!("file_index::deep needs a provider for this target_os");
    }
}

static AVAILABLE: OnceLock<bool> = OnceLock::new();

/// Returns this platform's deep-search provider if it's actually usable on
/// this machine (probed once, cached for the process lifetime — deep
/// search availability cannot change mid-session).
pub fn provider_for_platform() -> Option<Box<dyn DeepProvider>> {
    let provider = platform_provider();
    let available = *AVAILABLE.get_or_init(|| provider.probe());
    available.then_some(provider)
}
