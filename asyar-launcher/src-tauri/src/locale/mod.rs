//! Centralized locale subsystem for Asyar.
//!
//! Provides BCP-47 / POSIX locale parsing, candidate resolution chains for
//! UI and bundle assets, CLDR-based number formatting, and reactive `LocaleService`.

pub mod bcp47;
pub mod candidates;
pub mod number_format;
pub mod service;

pub use bcp47::ParsedLocale;
pub use number_format::NumberFormat;
pub use service::LocaleService;

/// The locale detected from the host system.
pub fn detect() -> ParsedLocale {
    sys_locale::get_locale()
        .and_then(|tag| ParsedLocale::parse(&tag))
        .unwrap_or_else(|| ParsedLocale {
            language: "en".to_string(),
            script: None,
            region: Some("US".to_string()),
            variant: None,
            raw: "en-US".to_string(),
        })
}
