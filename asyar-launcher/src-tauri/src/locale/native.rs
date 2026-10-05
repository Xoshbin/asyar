//! Translations for the few strings Rust renders natively (tray menu, window
//! titles). Everything else is localised in the frontend catalogs under
//! `src/locales/`; keep these tables in sync with the languages shipped there.

use super::ParsedLocale;

/// Languages with a native-string table. Mirrors the frontend catalogs
/// (`en`, `pt-BR`, `zh-CN`, `zh-Hant`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeLang {
    En,
    PtBr,
    ZhHans,
    ZhHant,
}

/// Strings Rust shows to the user without going through the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeText {
    TrayQuit,
    TrayCheckUpdates,
    TraySettings,
    SettingsWindowTitle,
    StickyNoteTitle,
    OnboardingTitle,
}

impl NativeLang {
    /// Picks the table for a locale. Chinese is script-split: an explicit script
    /// wins, otherwise the Traditional regions (TW/HK/MO) map to `ZhHant`, and
    /// everything else to `ZhHans`. Unknown languages fall back to English.
    pub fn from_locale(locale: &ParsedLocale) -> Self {
        match locale.language.as_str() {
            "pt" => Self::PtBr,
            "zh" => match (locale.script.as_deref(), locale.region.as_deref()) {
                (Some("Hant"), _) => Self::ZhHant,
                (Some(_), _) => Self::ZhHans,
                (None, Some("TW" | "HK" | "MO")) => Self::ZhHant,
                _ => Self::ZhHans,
            },
            _ => Self::En,
        }
    }
}

/// Returns the translated string for `key` in the locale's language.
pub fn native_text(locale: &ParsedLocale, key: NativeText) -> &'static str {
    let lang = NativeLang::from_locale(locale);
    match (key, lang) {
        (NativeText::TrayQuit, NativeLang::En) => "Quit Asyar",
        (NativeText::TrayQuit, NativeLang::PtBr) => "Sair do Asyar",
        (NativeText::TrayQuit, NativeLang::ZhHans) => "退出 Asyar",
        (NativeText::TrayQuit, NativeLang::ZhHant) => "結束 Asyar",

        (NativeText::TrayCheckUpdates, NativeLang::En) => "Check for Updates",
        (NativeText::TrayCheckUpdates, NativeLang::PtBr) => "Verificar atualizações",
        (NativeText::TrayCheckUpdates, NativeLang::ZhHans) => "检查更新",
        (NativeText::TrayCheckUpdates, NativeLang::ZhHant) => "檢查更新",

        (NativeText::TraySettings, NativeLang::En) => "Settings",
        (NativeText::TraySettings, NativeLang::PtBr) => "Configurações",
        (NativeText::TraySettings, NativeLang::ZhHans) => "设置",
        (NativeText::TraySettings, NativeLang::ZhHant) => "設定",

        (NativeText::SettingsWindowTitle, NativeLang::En) => "Asyar Settings",
        (NativeText::SettingsWindowTitle, NativeLang::PtBr) => "Configurações do Asyar",
        (NativeText::SettingsWindowTitle, NativeLang::ZhHans) => "Asyar 设置",
        (NativeText::SettingsWindowTitle, NativeLang::ZhHant) => "Asyar 設定",

        (NativeText::StickyNoteTitle, NativeLang::En) => "Sticky Note",
        (NativeText::StickyNoteTitle, NativeLang::PtBr) => "Nota adesiva",
        (NativeText::StickyNoteTitle, NativeLang::ZhHans) => "便笺",
        (NativeText::StickyNoteTitle, NativeLang::ZhHant) => "便利貼",

        (NativeText::OnboardingTitle, NativeLang::En) => "Welcome to Asyar",
        (NativeText::OnboardingTitle, NativeLang::PtBr) => "Boas-vindas ao Asyar",
        (NativeText::OnboardingTitle, NativeLang::ZhHans) => "欢迎使用 Asyar",
        (NativeText::OnboardingTitle, NativeLang::ZhHant) => "歡迎使用 Asyar",
    }
}

/// Looks up `key` using the app's managed `LocaleService`, falling back to the
/// host locale when the service is not registered yet (early boot, tests).
pub fn app_native_text<R: tauri::Runtime, M: tauri::Manager<R>>(
    manager: &M,
    key: NativeText,
) -> &'static str {
    let locale = manager
        .try_state::<super::LocaleService>()
        .map(|svc| svc.current_locale())
        .unwrap_or_else(super::detect);
    native_text(&locale, key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lang(tag: &str) -> NativeLang {
        NativeLang::from_locale(&ParsedLocale::parse(tag).unwrap())
    }

    #[test]
    fn picks_language_tables() {
        assert_eq!(lang("en-US"), NativeLang::En);
        assert_eq!(lang("de-DE"), NativeLang::En);
        assert_eq!(lang("pt-BR"), NativeLang::PtBr);
        assert_eq!(lang("pt-PT"), NativeLang::PtBr);
    }

    #[test]
    fn chinese_is_split_by_script_then_region() {
        assert_eq!(lang("zh-CN"), NativeLang::ZhHans);
        assert_eq!(lang("zh"), NativeLang::ZhHans);
        assert_eq!(lang("zh-Hans-CN"), NativeLang::ZhHans);
        assert_eq!(lang("zh-Hant"), NativeLang::ZhHant);
        assert_eq!(lang("zh-Hant-TW"), NativeLang::ZhHant);
        assert_eq!(lang("zh-TW"), NativeLang::ZhHant);
        assert_eq!(lang("zh-HK"), NativeLang::ZhHant);
        // An explicit Simplified script beats a Traditional-leaning region.
        assert_eq!(lang("zh-Hans-TW"), NativeLang::ZhHans);
    }

    #[test]
    fn every_key_is_translated_and_non_empty_in_every_language() {
        let keys = [
            NativeText::TrayQuit,
            NativeText::TrayCheckUpdates,
            NativeText::TraySettings,
            NativeText::SettingsWindowTitle,
            NativeText::StickyNoteTitle,
            NativeText::OnboardingTitle,
        ];
        for tag in ["en-US", "pt-BR", "zh-CN", "zh-Hant"] {
            let locale = ParsedLocale::parse(tag).unwrap();
            for key in keys {
                assert!(!native_text(&locale, key).is_empty(), "{tag} {key:?}");
            }
        }
    }

    #[test]
    fn english_matches_the_previous_hardcoded_strings() {
        let en = ParsedLocale::parse("en-US").unwrap();
        assert_eq!(native_text(&en, NativeText::TrayQuit), "Quit Asyar");
        assert_eq!(
            native_text(&en, NativeText::TrayCheckUpdates),
            "Check for Updates"
        );
        assert_eq!(native_text(&en, NativeText::TraySettings), "Settings");
        assert_eq!(native_text(&en, NativeText::StickyNoteTitle), "Sticky Note");
        assert_eq!(
            native_text(&en, NativeText::OnboardingTitle),
            "Welcome to Asyar"
        );
    }
}
