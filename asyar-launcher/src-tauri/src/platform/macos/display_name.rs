use std::path::Path;

/// The name macOS shows for a bundle in Finder and Spotlight.
///
/// On a German system `/System/Applications/Photos.app` displays as "Fotos"
/// while its on-disk file stem stays "Photos". Apple ships that translation
/// inside the bundle itself:
/// - modern bundles: `Contents/Resources/InfoPlist.loctable`, one plist keyed
///   by language code, each value an Info.plist fragment;
/// - older bundles: `Contents/Resources/<lang>.lproj/InfoPlist.strings`.
///
/// Cocoa's own lookups are deliberately not used here. Both `NSFileManager
/// displayNameAtPath:` and `NSBundle localizedInfoDictionary` resolve against
/// the *calling process's* effective localization rather than the user's
/// language preference, so an unlocalized host process — which is what this
/// binary is — gets "Photos" back on a German machine. Reading the table
/// against the user's locale gives the name the user actually sees.
///
/// Returns `None` when the bundle ships no translation for the user's locale,
/// which is the common case: callers fall back to the on-disk file stem.
pub fn localized_bundle_name(path: &Path) -> Option<String> {
    localized_bundle_name_in_locale(path, &sys_locale::get_locale()?)
}

fn localized_bundle_name_in_locale(path: &Path, locale: &str) -> Option<String> {
    let resources = path.join("Contents/Resources");
    let loctable = plist::Value::from_file(resources.join("InfoPlist.loctable")).ok();
    let loctable = loctable.as_ref().and_then(plist::Value::as_dictionary);
    language_candidates(locale).into_iter().find_map(|lang| {
        name_from_loctable(loctable, &lang).or_else(|| {
            name_from_info_plist_strings(&resources.join(format!("{lang}.lproj/InfoPlist.strings")))
        })
    })
}

/// Language keys to try, most specific first — `de-DE` before `de`.
///
/// Two shapes of the same locale have to be tried, because the tag macOS
/// reports and the key a bundle uses are written differently. `sys_locale`
/// returns the user's preferred language as a BCP-47 tag with hyphens
/// (`de-DE`, `zh-Hans-CN`), while Apple keys its own tables with underscores
/// and no script subtag — every one of the 166 system `InfoPlist.loctable`s on
/// macOS 26 uses `zh_CN`, `zh_HK`, `zh_TW`, `pt_PT`, `pt_BR`, `en_GB`,
/// `es_419` and never a hyphen. Third-party bundles do use the hyphen form, so
/// both are emitted, hyphen first.
///
/// A script subtag also has to be dropped on the way down, not just truncated
/// off the end: Chinese arrives as `zh-Hans-CN`, and plain RFC 4647 truncation
/// (`zh-Hans-CN` → `zh-Hans` → `zh`) never reaches `zh_CN` — and Apple ships no
/// bare `zh` entry at all, so that chain ends in the English name. The order
/// below matches what CoreFoundation's own resolver
/// (`CFBundleCopyLocalizationsForPreferences`) picks when asked with Photos'
/// real key list: `zh-Hans-CN` → `zh_CN`, `zh-Hant-HK` → `zh_HK` then `zh_TW`,
/// `de-DE` → `de_DE` then `de`, `pt-BR` → `pt`.
///
/// What is deliberately not replicated is CoreFoundation's alias and
/// likely-subtag data: `nb-NO` → `no`, `yue-Hans-CN` → `zh_CN`, `es-MX` →
/// `es_419`. Those need a table this crate has no business shipping, and a miss
/// only costs the fallback that has always applied — the on-disk file stem.
fn language_candidates(locale: &str) -> Vec<String> {
    let mut subtags = locale.split(['-', '_']).filter(|part| !part.is_empty());
    let Some(language) = subtags.next() else {
        return Vec::new();
    };
    let (mut script, mut region) = (None, None);
    for subtag in subtags {
        match subtag {
            // A one-character subtag opens an extension ("de-DE-u-co-phonebk"),
            // and what follows it only looks like a region — "-u-ca-chinese"
            // would otherwise read as Canada.
            _ if subtag.len() == 1 => break,
            _ if script.is_none() && is_script(subtag) => script = Some(subtag),
            _ if region.is_none() && is_region(subtag) => region = Some(subtag),
            // Variants ("de-DE-1901") never key a table.
            _ => {}
        }
    }

    let mut candidates = Vec::new();
    if let (Some(script), Some(region)) = (script, region) {
        push_both_separators(&mut candidates, &format!("{language}-{script}-{region}"));
    }
    if let Some(region) = region {
        push_both_separators(&mut candidates, &format!("{language}-{region}"));
    }
    if let Some(script) = script {
        push_both_separators(&mut candidates, &format!("{language}-{script}"));
    }
    if let Some(region) = implied_region(language, script) {
        push_both_separators(&mut candidates, &format!("{language}-{region}"));
    }
    push_both_separators(&mut candidates, language);
    candidates
}

/// The region Apple's tables stand in for a script, for the one language where
/// it matters. There is no `zh_Hans`/`zh_Hant` key anywhere in macOS and no
/// bare `zh` either, so a `zh-Hans` or `zh-Hant` preference only resolves
/// through a region. CoreFoundation resolves the same way (`zh-Hans` → `zh_CN`,
/// `zh-Hant` → `zh_TW`), and it too keeps a Traditional preference away from
/// the Simplified `zh` entry — hence this runs before the bare language.
fn implied_region(language: &str, script: Option<&str>) -> Option<&'static str> {
    match (language, script) {
        ("zh", Some("Hant")) => Some("TW"),
        ("zh", Some("Hans") | None) => Some("CN"),
        _ => None,
    }
}

/// Emits a candidate in both the hyphen and the underscore spelling, skipping
/// duplicates so `zh-Hans-CN` does not try `zh_CN` twice.
fn push_both_separators(candidates: &mut Vec<String>, stem: &str) {
    for candidate in [stem.to_owned(), stem.replace('-', "_")] {
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
}

/// A script subtag is four letters (`Hans`), a region two letters (`GB`) or
/// three digits (`419`, Latin America).
fn is_script(subtag: &str) -> bool {
    subtag.len() == 4 && subtag.chars().all(|c| c.is_ascii_alphabetic())
}

fn is_region(subtag: &str) -> bool {
    (subtag.len() == 2 && subtag.chars().all(|c| c.is_ascii_alphabetic()))
        || (subtag.len() == 3 && subtag.chars().all(|c| c.is_ascii_digit()))
}

fn name_from_loctable(table: Option<&plist::Dictionary>, lang: &str) -> Option<String> {
    display_name_in(table?.get(lang)?.as_dictionary()?)
}

/// Reads a `<lang>.lproj/InfoPlist.strings`. Modern bundles ship these as
/// binary plists, which `plist` parses; the legacy UTF-16 text form is left
/// alone, since any bundle old enough to use it predates the loctable that
/// covers everything else.
fn name_from_info_plist_strings(path: &Path) -> Option<String> {
    let strings = plist::Value::from_file(path).ok()?;
    display_name_in(strings.as_dictionary()?)
}

/// `CFBundleDisplayName` is the user-facing name; `CFBundleName` is the
/// shorter menu-bar variant and stands in when no display name is translated.
fn display_name_in(dict: &plist::Dictionary) -> Option<String> {
    ["CFBundleDisplayName", "CFBundleName"]
        .into_iter()
        .filter_map(|key| dict.get(key)?.as_string())
        .map(strip_invisible_marks)
        .find(|name| !name.is_empty())
}

/// Removes zero-width typographic marks from a translated name.
///
/// Apple embeds a soft hyphen in some of them — German "System\u{ad}einstellungen"
/// is a real example — purely as a line-breaking hint. It is invisible on
/// screen, so a user never types it, and leaving it in would keep an exact
/// query from matching exactly.
fn strip_invisible_marks(name: &str) -> String {
    name.chars()
        .filter(|c| {
            !matches!(
                c,
                '\u{ad}' | '\u{200b}' | '\u{200e}' | '\u{200f}' | '\u{feff}'
            )
        })
        .collect::<String>()
        .trim()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes a bundle carrying an `InfoPlist.loctable` with the given
    /// language → display-name pairs.
    fn bundle_with_loctable(dir_name: &str, entries: &[(&str, &str)]) -> std::path::PathBuf {
        let bundle = std::env::temp_dir()
            .join("asyar_test_display_name")
            .join(dir_name);
        let _ = std::fs::remove_dir_all(&bundle);
        let resources = bundle.join("Contents/Resources");
        std::fs::create_dir_all(&resources).unwrap();

        let mut table = plist::Dictionary::new();
        for (lang, name) in entries {
            let mut fragment = plist::Dictionary::new();
            fragment.insert(
                "CFBundleDisplayName".into(),
                plist::Value::String((*name).into()),
            );
            table.insert((*lang).into(), plist::Value::Dictionary(fragment));
        }
        plist::to_file_binary(resources.join("InfoPlist.loctable"), &table).unwrap();

        bundle
    }

    #[test]
    fn reads_the_translated_name_from_the_loctable() {
        // The reported bug: on a German system Photos.app must read as "Fotos".
        let bundle = bundle_with_loctable("Photos.app", &[("de", "Fotos"), ("en", "Photos")]);
        assert_eq!(
            localized_bundle_name_in_locale(&bundle, "de-DE").as_deref(),
            Some("Fotos")
        );
        assert_eq!(
            localized_bundle_name_in_locale(&bundle, "en-US").as_deref(),
            Some("Photos")
        );
    }

    #[test]
    fn prefers_a_regional_table_over_the_base_language() {
        let bundle = bundle_with_loctable(
            "Regional.app",
            &[("pt-BR", "Brasileiro"), ("pt", "Português")],
        );
        assert_eq!(
            localized_bundle_name_in_locale(&bundle, "pt-BR").as_deref(),
            Some("Brasileiro")
        );
    }

    #[test]
    fn falls_back_from_a_regional_locale_to_the_base_language() {
        // macOS reports "de-DE" while most bundles key their table on "de".
        let bundle = bundle_with_loctable("BaseOnly.app", &[("de", "Fotos")]);
        assert_eq!(
            localized_bundle_name_in_locale(&bundle, "de-DE").as_deref(),
            Some("Fotos")
        );
        assert_eq!(
            localized_bundle_name_in_locale(&bundle, "de_DE").as_deref(),
            Some("Fotos"),
            "underscore locale forms must normalize to the same candidates"
        );
    }

    #[test]
    fn returns_none_when_the_locale_is_untranslated() {
        // No guess, no wrong-language name — the caller keeps the file stem.
        let bundle = bundle_with_loctable("Untranslated.app", &[("de", "Fotos")]);
        assert_eq!(localized_bundle_name_in_locale(&bundle, "ja-JP"), None);
    }

    #[test]
    fn returns_none_for_a_bundle_without_any_translation() {
        let bundle = std::env::temp_dir().join("asyar_test_display_name/Plain.app");
        let _ = std::fs::remove_dir_all(&bundle);
        std::fs::create_dir_all(bundle.join("Contents/Resources")).unwrap();
        assert_eq!(localized_bundle_name_in_locale(&bundle, "de-DE"), None);
    }

    #[test]
    fn returns_none_for_a_missing_path() {
        let missing = Path::new("/nonexistent/asyar/Ghost.app");
        assert_eq!(localized_bundle_name_in_locale(missing, "de-DE"), None);
    }

    #[test]
    fn language_candidates_are_ordered_most_specific_first() {
        assert_eq!(language_candidates("de-DE"), vec!["de-DE", "de_DE", "de"]);
        assert_eq!(language_candidates("de"), vec!["de"]);
        assert!(language_candidates("").is_empty());
    }

    /// Stock bundles key Chinese as `zh_CN`/`zh_HK`/`zh_TW` and ship no bare
    /// `zh` entry at all — true for every one of the 166 system
    /// `InfoPlist.loctable`s on macOS 26. macOS reports the matching user
    /// language as a script tag (`zh-Hans-CN`), so nothing lines up unless the
    /// candidate chain bridges both.
    #[test]
    fn resolves_chinese_against_apples_underscore_only_keys() {
        // Names as Photos.app actually ships them.
        let bundle = bundle_with_loctable(
            "Chinese.app",
            &[
                ("en", "Photos"),
                ("zh_CN", "照片"),
                ("zh_HK", "相片"),
                ("zh_TW", "照片"),
            ],
        );
        for (locale, expected) in [
            ("zh-Hans-CN", "照片"),
            ("zh_CN", "照片"),
            ("zh-CN", "照片"),
            ("zh-Hant-TW", "照片"),
            ("zh-Hant-HK", "相片"),
            ("zh-Hans", "照片"),
            ("zh-Hant", "照片"),
            ("zh", "照片"),
        ] {
            assert_eq!(
                localized_bundle_name_in_locale(&bundle, locale).as_deref(),
                Some(expected),
                "locale {locale}"
            );
        }
    }

    /// The other regional key shapes Apple ships: `en_GB`, `pt_PT`, `es_419`.
    #[test]
    fn resolves_underscore_keyed_regions_and_keeps_the_base_language_for_others() {
        let bundle = bundle_with_loctable(
            "Regions.app",
            &[
                ("en", "Photos"),
                ("en_GB", "Photos GB"),
                ("pt", "Fotos"),
                ("pt_PT", "Fotografias"),
                ("es", "Fotos ES"),
                ("es_419", "Fotos 419"),
            ],
        );
        for (locale, expected) in [
            ("en-GB", "Photos GB"),
            ("en_GB", "Photos GB"),
            ("en-US", "Photos"),
            ("pt-PT", "Fotografias"),
            ("pt-BR", "Fotos"),
            ("es-419", "Fotos 419"),
            ("es-ES", "Fotos ES"),
        ] {
            assert_eq!(
                localized_bundle_name_in_locale(&bundle, locale).as_deref(),
                Some(expected),
                "locale {locale}"
            );
        }
    }

    /// The synthetic bundles above prove the lookup; this proves the key shapes
    /// were read off the real thing. Apple's own translations are not pinned —
    /// only that a Chinese preference stops landing on the English name, which
    /// is the exact symptom of a missed regional key.
    #[test]
    fn resolves_a_real_stock_bundle_in_an_injected_locale() {
        let photos = Path::new("/System/Applications/Photos.app");
        if !photos.exists() {
            return; // Not a stock macOS install — nothing to check against.
        }
        let english = localized_bundle_name_in_locale(photos, "en-US");
        for locale in ["zh-Hans-CN", "zh-Hant-TW", "zh-Hant-HK", "pt-PT", "en-GB"] {
            let name = localized_bundle_name_in_locale(photos, locale);
            assert!(name.is_some(), "{locale} resolved to nothing");
            if locale.starts_with("zh") {
                assert_ne!(name, english, "{locale} fell back to the English name");
            }
        }
    }

    #[test]
    fn language_candidates_cover_both_separators_and_script_tags() {
        assert_eq!(language_candidates("en_GB"), vec!["en-GB", "en_GB", "en"]);
        assert_eq!(
            language_candidates("es-419"),
            vec!["es-419", "es_419", "es"]
        );
        assert_eq!(
            language_candidates("zh-Hans-CN"),
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
        assert_eq!(
            language_candidates("zh-Hant-HK"),
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
        assert_eq!(
            language_candidates("zh-Hant"),
            vec!["zh-Hant", "zh_Hant", "zh-TW", "zh_TW", "zh"]
        );
        assert_eq!(language_candidates("zh"), vec!["zh-CN", "zh_CN", "zh"]);
        assert_eq!(
            language_candidates("zh-Hans-CN-u-ca-chinese"),
            language_candidates("zh-Hans-CN"),
            "an extension subtag must not be mistaken for a region"
        );
        assert_eq!(
            language_candidates("de-DE-1901"),
            vec!["de-DE", "de_DE", "de"]
        );
    }

    #[test]
    fn strips_the_soft_hyphen_apple_embeds_in_translated_names() {
        // macOS ships German System Settings as "System\u{ad}einstellungen".
        // The mark is invisible, so a user typing the name never produces it —
        // keeping it would deny the query an exact-title match.
        let bundle =
            bundle_with_loctable("SystemSettings.app", &[("de", "System\u{ad}einstellungen")]);
        assert_eq!(
            localized_bundle_name_in_locale(&bundle, "de-DE").as_deref(),
            Some("Systemeinstellungen")
        );
    }

    #[test]
    fn treats_a_name_of_only_invisible_marks_as_absent() {
        let bundle = bundle_with_loctable("Blank.app", &[("de", "\u{ad}\u{200b}")]);
        assert_eq!(localized_bundle_name_in_locale(&bundle, "de-DE"), None);
    }
}
