//! Locale-aware number notation and formatting based on CLDR data.

use super::ParsedLocale;

pub use asyar_calculator::locale::{
    canonicalize_input, format_for_language_and_region, from_preference, localize_output,
    NumberFormat, COMMA_DECIMAL_LANGUAGES, COMMA_DECIMAL_REGIONS,
};

impl ParsedLocale {
    /// Determines number format using Region-First evaluation:
    /// 1. Region is the primary driver (e.g. `en-DE` writes comma decimal).
    /// 2. If region is absent, falls back to language default.
    /// 3. Special cases: Canada (`fr-CA` vs `en-CA`), Swiss (`CH`/`LI`), Latin America.
    pub fn number_format(&self) -> NumberFormat {
        format_for_language_and_region(&self.language, self.region.as_deref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_comma_locales_from_the_region() {
        for tag in [
            "de-DE", "de_DE", "fr-FR", "pt-BR", "es-ES", "tr-TR", "nl-NL",
        ] {
            let loc = ParsedLocale::parse(tag).unwrap();
            assert_eq!(loc.number_format(), NumberFormat::Comma, "{tag}");
        }
    }

    #[test]
    fn detects_point_locales_from_the_region() {
        for tag in ["en-US", "en-GB", "en-AU", "ja-JP", "zh-Hans-CN", "es-MX"] {
            let loc = ParsedLocale::parse(tag).unwrap();
            assert_eq!(loc.number_format(), NumberFormat::Point, "{tag}");
        }
    }

    #[test]
    fn region_beats_language() {
        // macOS reports `en-DE` for an English UI in the German region,
        // and it is the region that decides how numbers are written.
        assert_eq!(
            ParsedLocale::parse("en-DE").unwrap().number_format(),
            NumberFormat::Comma
        );
        // …and the other way round.
        assert_eq!(
            ParsedLocale::parse("de-US").unwrap().number_format(),
            NumberFormat::Point
        );
        // Swiss German writes `1'234.56`, not `1.234,56`.
        assert_eq!(
            ParsedLocale::parse("de-CH").unwrap().number_format(),
            NumberFormat::Point
        );
    }

    #[test]
    fn canada_is_decided_by_language() {
        assert_eq!(
            ParsedLocale::parse("fr-CA").unwrap().number_format(),
            NumberFormat::Comma
        );
        assert_eq!(
            ParsedLocale::parse("en-CA").unwrap().number_format(),
            NumberFormat::Point
        );
    }

    #[test]
    fn falls_back_to_the_language_without_a_region() {
        assert_eq!(
            ParsedLocale::parse("de").unwrap().number_format(),
            NumberFormat::Comma
        );
        assert_eq!(
            ParsedLocale::parse("en").unwrap().number_format(),
            NumberFormat::Point
        );
    }

    #[test]
    fn preference_overrides_are_parsed() {
        assert_eq!(from_preference("comma"), Some(NumberFormat::Comma));
        assert_eq!(from_preference(" Point "), Some(NumberFormat::Point));
        assert_eq!(from_preference("auto"), None);
        assert_eq!(from_preference("nonsense"), None);
    }

    #[test]
    fn canonicalization_and_localization() {
        let typed = "61,78*1,19";
        let canonical = canonicalize_input(typed, NumberFormat::Comma);
        assert_eq!(canonical, "61.78*1.19");
        assert_eq!(localize_output(&canonical, NumberFormat::Comma), typed);

        assert_eq!(
            canonicalize_input("1.234,56", NumberFormat::Comma),
            "1234.56"
        );
        assert_eq!(
            canonicalize_input("1.234.567", NumberFormat::Comma),
            "1234567"
        );
        assert_eq!(
            canonicalize_input("3.14 * 2", NumberFormat::Comma),
            "3.14 * 2"
        );
        assert_eq!(
            canonicalize_input("1,234.56 + 3.14", NumberFormat::Point),
            "1,234.56 + 3.14"
        );
    }
}
