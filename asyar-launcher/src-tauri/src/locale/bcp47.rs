//! RFC 5646 / BCP-47 and POSIX locale tag parser.

use serde::{Deserialize, Serialize};

/// A normalized, structured locale representation.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ParsedLocale {
    /// 2- or 3-letter ISO 639 language code (always lowercase, e.g. "en", "zh", "de")
    pub language: String,
    /// 4-letter ISO 15924 script subtag (Titlecase, e.g. "Hans", "Hant", "Latn")
    pub script: Option<String>,
    /// 2-letter ISO 3166-1 country code or 3-digit UN M.49 region code (e.g. "US", "DE", "419")
    pub region: Option<String>,
    /// Variant subtag if present (e.g. "1901")
    pub variant: Option<String>,
    /// Original raw tag
    pub raw: String,
}

impl ParsedLocale {
    /// Parses a BCP-47 or POSIX locale tag.
    ///
    /// Normalizes casing:
    /// - Language: lowercase (`en`, `zh`, `de`)
    /// - Script: Titlecase (`Hans`, `Hant`, `Latn`)
    /// - Region: UPPERCASE (`US`, `DE`, `CN`, `419`)
    ///
    /// Handles:
    /// - Separators: `-` and `_`
    /// - POSIX encodings: `de_DE.UTF-8` -> language `de`, region `DE`
    /// - POSIX modifiers: `sr_RS.UTF-8@latin` -> language `sr`, script `Latn`, region `RS`
    /// - BCP-47 extensions: `de-DE-u-co-phonebk` -> language `de`, region `DE` (extensions skipped)
    pub fn parse(tag: &str) -> Option<Self> {
        let raw = tag.trim();
        if raw.is_empty() {
            return None;
        }

        // 1. Separate POSIX modifier if present (e.g. @latin, @euro)
        let (base_and_encoding, modifier) = match raw.split_once('@') {
            Some((b, m)) => (b, Some(m.trim())),
            None => (raw, None),
        };

        // 2. Strip POSIX encoding (e.g. .UTF-8, .iso88591)
        let base_tag = match base_and_encoding.split_once('.') {
            Some((b, _)) => b,
            None => base_and_encoding,
        };

        let mut subtags = base_tag.split(['-', '_']).filter(|p| !p.is_empty());
        let language = subtags.next()?;

        // Language must be 2-3 ascii alphabetic characters
        if language.len() < 2
            || language.len() > 3
            || !language.chars().all(|c| c.is_ascii_alphabetic())
        {
            return None;
        }
        let language = language.to_ascii_lowercase();

        let mut script = None;
        let mut region = None;
        let mut variant = None;

        for subtag in subtags {
            // Extension singleton (e.g. "-u-", "-t-", "-x-"): stop parsing base locale
            if subtag.len() == 1 {
                break;
            }

            if script.is_none() && is_script_subtag(subtag) {
                script = Some(to_titlecase(subtag));
            } else if region.is_none() && is_region_subtag(subtag) {
                region = Some(subtag.to_ascii_uppercase());
            } else if variant.is_none() && is_variant_subtag(subtag) {
                variant = Some(subtag.to_ascii_lowercase());
            }
        }

        // If no script found in subtags, check POSIX modifier (e.g. @latin -> Latn, @cyrillic -> Cyrl)
        if script.is_none() {
            if let Some(m) = modifier {
                script = script_from_posix_modifier(m);
            }
        }

        Some(Self {
            language,
            script,
            region,
            variant,
            raw: raw.to_string(),
        })
    }

    /// Returns canonical BCP-47 tag with hyphens (e.g. `zh-Hans-CN`, `en-US`, `de-DE-1901`).
    pub fn to_bcp47(&self) -> String {
        let mut parts = vec![self.language.clone()];
        if let Some(ref s) = self.script {
            parts.push(s.clone());
        }
        if let Some(ref r) = self.region {
            parts.push(r.clone());
        }
        if let Some(ref v) = self.variant {
            parts.push(v.clone());
        }
        parts.join("-")
    }

    /// Returns POSIX-style tag with underscores (e.g. `zh_CN`, `en_US`, `es_419`).
    pub fn to_posix(&self) -> String {
        let mut parts = vec![self.language.clone()];
        if let Some(ref s) = self.script {
            parts.push(s.clone());
        }
        if let Some(ref r) = self.region {
            parts.push(r.clone());
        }
        if let Some(ref v) = self.variant {
            parts.push(v.clone());
        }
        parts.join("_")
    }
}

fn is_script_subtag(s: &str) -> bool {
    s.len() == 4 && s.chars().all(|c| c.is_ascii_alphabetic())
}

fn is_region_subtag(s: &str) -> bool {
    (s.len() == 2 && s.chars().all(|c| c.is_ascii_alphabetic()))
        || (s.len() == 3 && s.chars().all(|c| c.is_ascii_digit()))
}

fn is_variant_subtag(s: &str) -> bool {
    (s.len() >= 5 && s.chars().all(|c| c.is_ascii_alphanumeric()))
        || (s.len() == 4 && s.chars().next().is_some_and(|c| c.is_ascii_digit()))
}

fn to_titlecase(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => {
            let mut res = first.to_ascii_uppercase().to_string();
            res.extend(chars.map(|c| c.to_ascii_lowercase()));
            res
        }
        None => String::new(),
    }
}

fn script_from_posix_modifier(modifier: &str) -> Option<String> {
    match modifier.trim().to_ascii_lowercase().as_str() {
        "latin" => Some("Latn".to_string()),
        "cyrillic" => Some("Cyrl".to_string()),
        "devanagari" => Some("Deva".to_string()),
        "arabic" => Some("Arab".to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_language() {
        let loc = ParsedLocale::parse("de").expect("should parse de");
        assert_eq!(loc.language, "de");
        assert_eq!(loc.script, None);
        assert_eq!(loc.region, None);
        assert_eq!(loc.to_bcp47(), "de");
        assert_eq!(loc.to_posix(), "de");
    }

    #[test]
    fn parses_language_and_region_hyphen_and_underscore() {
        let loc1 = ParsedLocale::parse("en-US").expect("en-US");
        assert_eq!(loc1.language, "en");
        assert_eq!(loc1.region.as_deref(), Some("US"));
        assert_eq!(loc1.to_bcp47(), "en-US");
        assert_eq!(loc1.to_posix(), "en_US");

        let loc2 = ParsedLocale::parse("de_de").expect("de_de");
        assert_eq!(loc2.language, "de");
        assert_eq!(loc2.region.as_deref(), Some("DE"));
        assert_eq!(loc2.to_bcp47(), "de-DE");
        assert_eq!(loc2.to_posix(), "de_DE");
    }

    #[test]
    fn parses_un_m49_numeric_region() {
        let loc = ParsedLocale::parse("es-419").expect("es-419");
        assert_eq!(loc.language, "es");
        assert_eq!(loc.region.as_deref(), Some("419"));
        assert_eq!(loc.to_bcp47(), "es-419");
        assert_eq!(loc.to_posix(), "es_419");
    }

    #[test]
    fn parses_script_subtag() {
        let loc = ParsedLocale::parse("zh-Hans-CN").expect("zh-Hans-CN");
        assert_eq!(loc.language, "zh");
        assert_eq!(loc.script.as_deref(), Some("Hans"));
        assert_eq!(loc.region.as_deref(), Some("CN"));
        assert_eq!(loc.to_bcp47(), "zh-Hans-CN");
        assert_eq!(loc.to_posix(), "zh_Hans_CN");

        let loc_tw = ParsedLocale::parse("zh_Hant_TW").expect("zh_Hant_TW");
        assert_eq!(loc_tw.language, "zh");
        assert_eq!(loc_tw.script.as_deref(), Some("Hant"));
        assert_eq!(loc_tw.region.as_deref(), Some("TW"));
    }

    #[test]
    fn parses_posix_encoding_and_modifiers() {
        let loc = ParsedLocale::parse("de_DE.UTF-8").expect("de_DE.UTF-8");
        assert_eq!(loc.language, "de");
        assert_eq!(loc.region.as_deref(), Some("DE"));

        let loc_mod = ParsedLocale::parse("sr_RS.UTF-8@latin").expect("sr_RS.UTF-8@latin");
        assert_eq!(loc_mod.language, "sr");
        assert_eq!(loc_mod.script.as_deref(), Some("Latn"));
        assert_eq!(loc_mod.region.as_deref(), Some("RS"));

        let loc_cyrl = ParsedLocale::parse("sr_RS@cyrillic").expect("sr_RS@cyrillic");
        assert_eq!(loc_cyrl.language, "sr");
        assert_eq!(loc_cyrl.script.as_deref(), Some("Cyrl"));
        assert_eq!(loc_cyrl.region.as_deref(), Some("RS"));
    }

    #[test]
    fn ignores_bcp47_extensions_and_preserves_variant() {
        let loc = ParsedLocale::parse("zh-Hans-CN-u-ca-chinese").expect("extension tag");
        assert_eq!(loc.language, "zh");
        assert_eq!(loc.script.as_deref(), Some("Hans"));
        assert_eq!(loc.region.as_deref(), Some("CN"));

        let loc_var = ParsedLocale::parse("de-DE-1901").expect("variant tag");
        assert_eq!(loc_var.language, "de");
        assert_eq!(loc_var.region.as_deref(), Some("DE"));
        assert_eq!(loc_var.variant.as_deref(), Some("1901"));
    }

    #[test]
    fn rejects_empty_or_invalid_tags() {
        assert!(ParsedLocale::parse("").is_none());
        assert!(ParsedLocale::parse("   ").is_none());
        assert!(ParsedLocale::parse("123").is_none());
    }
}
