//! Locale-aware number notation for the calculator.
//!
//! Roughly half the world writes `61,78` where the other half writes
//! `61.78`. fend — like every expression parser — only understands the
//! `1,234.56` convention, so a query typed in a comma-decimal locale is
//! silently misread: `61,78*1,19` parses as `6178 * 119`.
//!
//! Two conversions fix that, and the pipeline in between stays entirely
//! in the canonical `1,234.56` notation:
//!
//! - [`canonicalize_input`] rewrites the query before evaluation
//!   (`61,78*1,19` → `61.78*1.19`, `1.234,56` → `1234.56`).
//! - [`localize_output`] rewrites the answer after evaluation
//!   (`73.5182` → `73,5182`, `1,234,567` → `1.234.567`).

/// Which convention a number is written in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NumberFormat {
    /// `1,234.56` — point decimal, comma grouping.
    #[default]
    Point,
    /// `1.234,56` — comma decimal, point grouping.
    Comma,
}

/// Regions whose CLDR decimal separator is a comma. Everything else is
/// treated as point-decimal, which is the safe default: a point-decimal
/// query needs no rewriting at all.
///
/// Deliberate exclusions: `CH`/`LI` (German- and French-speaking, but
/// point-decimal), `MX`/`PE`/`PA`/`PR`/`DO`/`GT`/`HN`/`NI`/`SV`
/// (Spanish-speaking, but point-decimal).
const COMMA_DECIMAL_REGIONS: &[&str] = &[
    "AD", "AL", "AM", "AO", "AR", "AT", "AX", "AZ", "BA", "BE", "BF", "BG", "BI", "BJ", "BO", "BR",
    "BY", "CD", "CF", "CG", "CI", "CL", "CM", "CO", "CR", "CU", "CV", "CY", "CZ", "DE", "DK", "DZ",
    "EC", "EE", "ES", "FI", "FO", "FR", "GA", "GE", "GF", "GL", "GN", "GP", "GQ", "GR", "GW", "HR",
    "HT", "HU", "ID", "IS", "IT", "KG", "KZ", "LT", "LU", "LV", "MA", "MC", "MD", "ME", "MK", "ML",
    "MN", "MQ", "MZ", "NC", "NE", "NL", "NO", "PF", "PL", "PT", "PY", "RE", "RO", "RS", "RU", "RW",
    "SE", "SI", "SK", "SM", "SN", "SR", "ST", "TD", "TG", "TJ", "TM", "TN", "TR", "UA", "UY", "UZ",
    "VA", "VE", "VN", "ZA",
];

/// Languages that write comma-decimal wherever they are spoken. Only
/// consulted when the locale tag carries no region (`"de"`, not
/// `"de-DE"`), since the region is the stronger signal — macOS reports
/// `en-DE` for an English UI set to the German region, and it is the
/// region that decides how numbers are written.
const COMMA_DECIMAL_LANGUAGES: &[&str] = &[
    "af", "az", "be", "bg", "bs", "ca", "cs", "da", "de", "el", "es", "et", "eu", "fi", "fr", "gl",
    "hr", "hu", "hy", "id", "is", "it", "ka", "kk", "ky", "lt", "lv", "mk", "mn", "nb", "nl", "nn",
    "no", "pl", "pt", "ro", "ru", "sk", "sl", "sq", "sr", "sv", "tr", "uk", "uz", "vi",
];

/// The format implied by a BCP 47-ish locale tag (`de-DE`, `en_DE`, `fr`).
pub fn from_locale_tag(tag: &str) -> NumberFormat {
    let mut parts = tag.split(['-', '_']).filter(|p| !p.is_empty());
    let language = parts.next().unwrap_or_default().to_ascii_lowercase();
    // Skip a script subtag (`zh-Hans-CN`) to reach the region.
    let region = parts
        .find(|p| p.len() == 2 && p.chars().all(|c| c.is_ascii_alphabetic()))
        .map(|p| p.to_ascii_uppercase());

    match region.as_deref() {
        // Canada is split down the language line: fr-CA writes `1 234,56`.
        Some("CA") => {
            if language == "fr" {
                NumberFormat::Comma
            } else {
                NumberFormat::Point
            }
        }
        Some(r) if COMMA_DECIMAL_REGIONS.contains(&r) => NumberFormat::Comma,
        Some(_) => NumberFormat::Point,
        None if COMMA_DECIMAL_LANGUAGES.contains(&language.as_str()) => NumberFormat::Comma,
        None => NumberFormat::Point,
    }
}

/// The format the host system is configured for.
pub fn detect() -> NumberFormat {
    sys_locale::get_locale()
        .map(|tag| from_locale_tag(&tag))
        .unwrap_or_default()
}

/// Parse the user's `numberFormat` preference. `"auto"` (and anything
/// unrecognized) yields `None`, meaning "fall back to [`detect`]".
pub fn from_preference(value: &str) -> Option<NumberFormat> {
    match value.trim().to_ascii_lowercase().as_str() {
        "point" => Some(NumberFormat::Point),
        "comma" => Some(NumberFormat::Comma),
        _ => None,
    }
}

/// Color functions are the one place where a comma between digits is a
/// list separator, not a decimal mark: `rgb(255,0,0)`.
fn is_color_function(q: &str) -> bool {
    let lower = q.to_ascii_lowercase();
    ["rgb(", "rgba(", "hsl(", "hsla("]
        .iter()
        .any(|f| lower.contains(f))
}

/// Grouped thousands written point-style, but only where the reading is
/// unambiguous: a comma decimal behind the groups (`1.234,56`) or two or
/// more groups (`1.234.567`). Every group must be exactly three digits,
/// which is what keeps dotted dates (`25.12.2026`) out of the match.
fn grouped_thousands() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(r"\b\d{1,3}(?:\.\d{3})+,\d+\b|\b\d{1,3}(?:\.\d{3}){2,}\b").unwrap()
    })
}

/// Rewrite a query written in `fmt` into the canonical `1,234.56`
/// notation the rest of the pipeline (and fend) expects.
///
/// A lone `1.234` is left alone on purpose: read as grouping it would
/// turn `3.14 * 2` into `314 * 2`, and a decimal reading is both the
/// safer and the far more common intent. Grouping is only honored once
/// it is unambiguous — two or more groups (`1.234.567`) or a comma
/// decimal behind it (`1.234,56`).
pub fn canonicalize_input(query: &str, fmt: NumberFormat) -> String {
    if fmt == NumberFormat::Point || is_color_function(query) {
        return query.to_string();
    }

    let s = grouped_thousands().replace_all(query, |c: &regex::Captures| {
        c[0].replace('.', "").replace(',', ".")
    });

    // Any remaining comma between two digits is a decimal mark.
    let chars: Vec<char> = s.chars().collect();
    chars
        .iter()
        .enumerate()
        .map(|(i, &c)| {
            if c == ',' && is_digit_at(&chars, i.wrapping_sub(1)) && is_digit_at(&chars, i + 1) {
                '.'
            } else {
                c
            }
        })
        .collect()
}

/// Rewrite a canonical `1,234.56` answer into `fmt` for display.
///
/// Only separators sitting between two digits are swapped, so list
/// commas (`rgb(255, 0, 0)`, `Fri, 25 Dec`) survive untouched.
pub fn localize_output(text: &str, fmt: NumberFormat) -> String {
    if fmt == NumberFormat::Point {
        return text.to_string();
    }
    let chars: Vec<char> = text.chars().collect();
    chars
        .iter()
        .enumerate()
        .map(|(i, &c)| {
            let between_digits =
                is_digit_at(&chars, i.wrapping_sub(1)) && is_digit_at(&chars, i + 1);
            match c {
                ',' if between_digits => '.',
                '.' if between_digits => ',',
                other => other,
            }
        })
        .collect()
}

fn is_digit_at(chars: &[char], i: usize) -> bool {
    chars.get(i).is_some_and(|c| c.is_ascii_digit())
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
