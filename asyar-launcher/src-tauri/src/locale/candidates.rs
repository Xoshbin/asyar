//! Candidate resolution strategies for UI text, macOS bundles, and Linux desktop entries.

use super::ParsedLocale;

impl ParsedLocale {
    /// Generates generic fallback candidates for text/UI translations (most specific to least specific).
    ///
    /// E.g. `zh-Hans-CN` -> `["zh-Hans-CN", "zh-CN", "zh-Hans", "zh"]`
    pub fn text_candidates(&self) -> Vec<String> {
        let mut candidates = Vec::new();
        let lang = &self.language;

        if let (Some(ref s), Some(ref r)) = (&self.script, &self.region) {
            candidates.push(format!("{lang}-{s}-{r}"));
            candidates.push(format!("{lang}-{r}"));
            candidates.push(format!("{lang}-{s}"));
        } else if let Some(ref r) = self.region {
            candidates.push(format!("{lang}-{r}"));
        } else if let Some(ref s) = self.script {
            candidates.push(format!("{lang}-{s}"));
        }

        candidates.push(lang.clone());
        candidates
    }

    /// macOS-specific candidate chain matching Apple's `InfoPlist.loctable` conventions:
    /// - Emits both hyphen (`-`) and underscore (`_`) variants
    /// - Drops script subtags to reach Apple's underscore-keyed regional tables (`zh_CN`, `pt_PT`, `en_GB`, `es_419`)
    /// - Resolves Chinese script-to-region mapping (`zh-Hans` -> `zh_CN`, `zh-Hant` -> `zh_TW`/`zh_HK`)
    pub fn macos_bundle_candidates(&self) -> Vec<String> {
        let mut candidates = Vec::new();
        let lang = &self.language;
        let script = self.script.as_deref();
        let region = self.region.as_deref();

        if let (Some(s), Some(r)) = (script, region) {
            push_both_separators(&mut candidates, &format!("{lang}-{s}-{r}"));
        }
        if let Some(r) = region {
            push_both_separators(&mut candidates, &format!("{lang}-{r}"));
        }
        if let Some(s) = script {
            push_both_separators(&mut candidates, &format!("{lang}-{s}"));
        }
        if let Some(r) = implied_macos_region(lang, script) {
            push_both_separators(&mut candidates, &format!("{lang}-{r}"));
        }
        push_both_separators(&mut candidates, lang);

        candidates
    }

    /// Linux XDG Desktop Entry candidate chain matching `Name[locale]` lookup:
    /// - Tries full raw tag if it had encoding / modifier (e.g. `de_DE.UTF-8`)
    /// - Tries POSIX format (`de_DE`) and BCP-47 format (`de-DE`)
    /// - Falls back to base language (`de`)
    pub fn desktop_entry_candidates(&self) -> Vec<String> {
        let mut candidates = Vec::new();

        let clean_raw = self.raw.trim();
        if !clean_raw.is_empty() && !candidates.contains(&clean_raw.to_string()) {
            candidates.push(clean_raw.to_string());
        }

        let posix = self.to_posix();
        if !candidates.contains(&posix) {
            candidates.push(posix);
        }

        let bcp47 = self.to_bcp47();
        if !candidates.contains(&bcp47) {
            candidates.push(bcp47);
        }

        let lang = self.language.clone();
        if !candidates.contains(&lang) {
            candidates.push(lang);
        }

        candidates
    }
}

/// The region Apple's tables stand in for a script. There is no `zh_Hans`/`zh_Hant`
/// key anywhere in macOS and no bare `zh` either, so Chinese resolves through a region:
/// `zh-Hans` -> `zh_CN`, `zh-Hant` -> `zh_TW`.
fn implied_macos_region(language: &str, script: Option<&str>) -> Option<&'static str> {
    match (language, script) {
        ("zh", Some("Hant")) => Some("TW"),
        ("zh", Some("Hans") | None) => Some("CN"),
        _ => None,
    }
}

/// Emits a candidate in both the hyphen and the underscore spelling, skipping duplicates.
fn push_both_separators(candidates: &mut Vec<String>, stem: &str) {
    for candidate in [stem.to_owned(), stem.replace('-', "_")] {
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_candidates_order() {
        let loc = ParsedLocale::parse("zh-Hans-CN").unwrap();
        assert_eq!(
            loc.text_candidates(),
            vec!["zh-Hans-CN", "zh-CN", "zh-Hans", "zh"]
        );

        let loc_de = ParsedLocale::parse("de-DE").unwrap();
        assert_eq!(loc_de.text_candidates(), vec!["de-DE", "de"]);

        let loc_base = ParsedLocale::parse("de").unwrap();
        assert_eq!(loc_base.text_candidates(), vec!["de"]);
    }

    #[test]
    fn macos_bundle_candidates_de_and_regions() {
        let de_de = ParsedLocale::parse("de-DE").unwrap();
        assert_eq!(
            de_de.macos_bundle_candidates(),
            vec!["de-DE", "de_DE", "de"]
        );

        let en_gb = ParsedLocale::parse("en_GB").unwrap();
        assert_eq!(
            en_gb.macos_bundle_candidates(),
            vec!["en-GB", "en_GB", "en"]
        );

        let es_419 = ParsedLocale::parse("es-419").unwrap();
        assert_eq!(
            es_419.macos_bundle_candidates(),
            vec!["es-419", "es_419", "es"]
        );
    }

    #[test]
    fn macos_bundle_candidates_chinese() {
        let loc1 = ParsedLocale::parse("zh-Hans-CN").unwrap();
        assert_eq!(
            loc1.macos_bundle_candidates(),
            vec![
                "zh-Hans-CN",
                "zh_Hans_CN",
                "zh-CN",
                "zh_CN",
                "zh-Hans",
                "zh_Hans",
                "zh"
            ]
        );

        let loc2 = ParsedLocale::parse("zh-Hant-HK").unwrap();
        assert_eq!(
            loc2.macos_bundle_candidates(),
            vec![
                "zh-Hant-HK",
                "zh_Hant_HK",
                "zh-HK",
                "zh_HK",
                "zh-Hant",
                "zh_Hant",
                "zh-TW",
                "zh_TW",
                "zh"
            ]
        );

        let loc3 = ParsedLocale::parse("zh-Hant").unwrap();
        assert_eq!(
            loc3.macos_bundle_candidates(),
            vec!["zh-Hant", "zh_Hant", "zh-TW", "zh_TW", "zh"]
        );

        let loc4 = ParsedLocale::parse("zh").unwrap();
        assert_eq!(loc4.macos_bundle_candidates(), vec!["zh-CN", "zh_CN", "zh"]);
    }

    #[test]
    fn desktop_entry_candidates_variations() {
        let loc = ParsedLocale::parse("de_DE.UTF-8").unwrap();
        assert_eq!(
            loc.desktop_entry_candidates(),
            vec!["de_DE.UTF-8", "de_DE", "de-DE", "de"]
        );

        let loc_base = ParsedLocale::parse("fr").unwrap();
        assert_eq!(loc_base.desktop_entry_candidates(), vec!["fr"]);
    }
}
