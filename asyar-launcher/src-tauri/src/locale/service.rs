//! LocaleService for managing runtime locale and number formatting state.

use super::{bcp47::ParsedLocale, number_format::NumberFormat};
use std::sync::RwLock;

/// A thread-safe, reactive locale state manager.
pub struct LocaleService {
    system_locale: RwLock<ParsedLocale>,
    number_format_override: RwLock<Option<NumberFormat>>,
}

impl LocaleService {
    /// Creates a new `LocaleService` initialized from the host OS locale.
    pub fn new() -> Self {
        Self {
            system_locale: RwLock::new(super::detect()),
            number_format_override: RwLock::new(None),
        }
    }

    /// Creates a new `LocaleService` with an explicitly provided system locale (useful for testing).
    pub fn with_locale(locale: ParsedLocale) -> Self {
        Self {
            system_locale: RwLock::new(locale),
            number_format_override: RwLock::new(None),
        }
    }

    /// Returns the currently active system `ParsedLocale`.
    pub fn current_locale(&self) -> ParsedLocale {
        self.system_locale.read().unwrap().clone()
    }

    /// Sets the system locale manually.
    pub fn set_system_locale(&self, locale: ParsedLocale) {
        *self.system_locale.write().unwrap() = locale;
    }

    /// Returns the active `NumberFormat` (preference override if set, else implied by locale).
    pub fn number_format(&self) -> NumberFormat {
        if let Some(override_fmt) = *self.number_format_override.read().unwrap() {
            return override_fmt;
        }
        self.system_locale.read().unwrap().number_format()
    }

    /// Sets or clears the user number format preference override.
    pub fn set_number_format_override(&self, format: Option<NumberFormat>) {
        *self.number_format_override.write().unwrap() = format;
    }

    /// Returns the raw user preference override if set.
    pub fn number_format_override(&self) -> Option<NumberFormat> {
        *self.number_format_override.read().unwrap()
    }

    /// Refreshes the system locale from the host OS via `sys_locale`.
    /// Returns `true` if the locale changed.
    pub fn refresh_from_system(&self) -> bool {
        let detected = super::detect();
        let mut guard = self.system_locale.write().unwrap();
        if *guard != detected {
            *guard = detected;
            true
        } else {
            false
        }
    }
}

impl Default for LocaleService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_detected_locale_number_format() {
        let svc = LocaleService::with_locale(ParsedLocale::parse("de-DE").unwrap());
        assert_eq!(svc.current_locale().to_bcp47(), "de-DE");
        assert_eq!(svc.number_format(), NumberFormat::Comma);
        assert_eq!(svc.number_format_override(), None);
    }

    #[test]
    fn override_wins_over_system_locale() {
        let svc = LocaleService::with_locale(ParsedLocale::parse("de-DE").unwrap());
        svc.set_number_format_override(Some(NumberFormat::Point));
        assert_eq!(svc.number_format(), NumberFormat::Point);
        assert_eq!(svc.number_format_override(), Some(NumberFormat::Point));

        svc.set_number_format_override(None);
        assert_eq!(svc.number_format(), NumberFormat::Comma);
        assert_eq!(svc.number_format_override(), None);
    }

    #[test]
    fn dynamic_system_locale_update() {
        let svc = LocaleService::with_locale(ParsedLocale::parse("en-US").unwrap());
        assert_eq!(svc.number_format(), NumberFormat::Point);

        svc.set_system_locale(ParsedLocale::parse("fr-FR").unwrap());
        assert_eq!(svc.number_format(), NumberFormat::Comma);
        assert_eq!(svc.current_locale().to_bcp47(), "fr-FR");
    }
}
