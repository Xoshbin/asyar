//! Locale-aware number notation for the calculator.
//!
//! Re-exports number format definitions and formatting routines from
//! `crate::locale::number_format`.

pub use crate::locale::number_format::{
    canonicalize_input, from_preference, localize_output, NumberFormat,
};

/// The format implied by a BCP 47-ish locale tag (`de-DE`, `en_DE`, `fr`).
pub fn from_locale_tag(tag: &str) -> NumberFormat {
    crate::locale::ParsedLocale::parse(tag)
        .map(|l| l.number_format())
        .unwrap_or_default()
}

/// The format the host system is configured for.
pub fn detect() -> NumberFormat {
    crate::locale::detect().number_format()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_comma_locales_from_the_region() {
        for tag in [
            "de-DE", "de_DE", "fr-FR", "pt-BR", "es-ES", "tr-TR", "nl-NL",
        ] {
            assert_eq!(from_locale_tag(tag), NumberFormat::Comma, "{tag}");
        }
    }

    #[test]
    fn detects_point_locales_from_the_region() {
        for tag in ["en-US", "en-GB", "en-AU", "ja-JP", "zh-Hans-CN", "es-MX"] {
            assert_eq!(from_locale_tag(tag), NumberFormat::Point, "{tag}");
        }
    }

    #[test]
    fn region_beats_language() {
        // macOS reports `en-DE` for an English UI in the German region,
        // and it is the region that decides how numbers are written.
        assert_eq!(from_locale_tag("en-DE"), NumberFormat::Comma);
        // …and the other way round.
        assert_eq!(from_locale_tag("de-US"), NumberFormat::Point);
        // Swiss German writes `1'234.56`, not `1.234,56`.
        assert_eq!(from_locale_tag("de-CH"), NumberFormat::Point);
    }

    #[test]
    fn canada_is_decided_by_language() {
        assert_eq!(from_locale_tag("fr-CA"), NumberFormat::Comma);
        assert_eq!(from_locale_tag("en-CA"), NumberFormat::Point);
    }

    #[test]
    fn falls_back_to_the_language_without_a_region() {
        assert_eq!(from_locale_tag("de"), NumberFormat::Comma);
        assert_eq!(from_locale_tag("en"), NumberFormat::Point);
        assert_eq!(from_locale_tag(""), NumberFormat::Point);
    }

    #[test]
    fn preference_overrides_are_parsed() {
        assert_eq!(from_preference("comma"), Some(NumberFormat::Comma));
        assert_eq!(from_preference(" Point "), Some(NumberFormat::Point));
        assert_eq!(from_preference("auto"), None);
        assert_eq!(from_preference("nonsense"), None);
    }

    fn canon(q: &str) -> String {
        canonicalize_input(q, NumberFormat::Comma)
    }

    #[test]
    fn reads_comma_as_the_decimal_mark() {
        assert_eq!(canon("61,78*1,19"), "61.78*1.19");
        assert_eq!(canon("0,5 + 0,25"), "0.5 + 0.25");
        // Three digits behind the comma are still decimals here.
        assert_eq!(canon("1,234"), "1.234");
    }

    #[test]
    fn reads_unambiguous_point_grouping() {
        assert_eq!(canon("1.234,56"), "1234.56");
        assert_eq!(canon("1.234.567"), "1234567");
        assert_eq!(canon("1.234.567,89 EUR in USD"), "1234567.89 EUR in USD");
    }

    #[test]
    fn leaves_a_lone_dotted_number_as_a_decimal() {
        // Reading `3.14` as grouping would silently turn it into 314.
        assert_eq!(canon("3.14 * 2"), "3.14 * 2");
        assert_eq!(canon("1.234 * 2"), "1.234 * 2");
    }

    #[test]
    fn leaves_dotted_dates_alone() {
        // Groups are not three digits wide, so this is not grouping.
        assert_eq!(canon("25.12.2026"), "25.12.2026");
    }

    #[test]
    fn leaves_color_list_commas_alone() {
        assert_eq!(canon("rgb(255,0,0)"), "rgb(255,0,0)");
        assert_eq!(canon("hsl(210,50%,50%) to hex"), "hsl(210,50%,50%) to hex");
    }

    #[test]
    fn leaves_list_commas_with_spaces_alone() {
        assert_eq!(canon("days until dec 25, 2026"), "days until dec 25, 2026");
    }

    #[test]
    fn point_format_never_rewrites_the_query() {
        assert_eq!(
            canonicalize_input("1,234.56 + 3.14", NumberFormat::Point),
            "1,234.56 + 3.14"
        );
    }

    fn local(s: &str) -> String {
        localize_output(s, NumberFormat::Comma)
    }

    #[test]
    fn swaps_separators_for_display() {
        assert_eq!(local("73.5182"), "73,5182");
        assert_eq!(local("1,234,567"), "1.234.567");
        assert_eq!(local("1,234.5678"), "1.234,5678");
        assert_eq!(local("≈ 3.1415926536"), "≈ 3,1415926536");
        assert_eq!(local("6.32 GBP/hour"), "6,32 GBP/hour");
    }

    #[test]
    fn leaves_non_numeric_separators_alone() {
        assert_eq!(local("rgb(255, 0, 0)"), "rgb(255, 0, 0)");
        assert_eq!(local("Fri, 25 Dec 2026"), "Fri, 25 Dec 2026");
        assert_eq!(local("0x11111"), "0x11111");
        assert_eq!(local("17:30"), "17:30");
    }

    #[test]
    fn point_format_never_rewrites_the_answer() {
        assert_eq!(localize_output("1,234.56", NumberFormat::Point), "1,234.56");
    }

    #[test]
    fn input_and_output_round_trip() {
        let typed = "61,78*1,19";
        let canonical = canon(typed);
        assert_eq!(canonical, "61.78*1.19");
        assert_eq!(local(&canonical), typed);
    }
}
