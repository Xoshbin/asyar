//! Tauri commands for locale information and candidate resolution.

use crate::locale::{LocaleService, ParsedLocale};
use tauri::State;

/// Retrieves the current effective system locale.
#[tauri::command]
pub fn get_system_locale(service: State<'_, LocaleService>) -> ParsedLocale {
    service.current_locale()
}

/// Computes text fallback candidates for a locale tag.
#[tauri::command]
pub fn get_locale_candidates(locale: String) -> Vec<String> {
    ParsedLocale::parse(&locale)
        .map(|l| l.text_candidates())
        .unwrap_or_default()
}
