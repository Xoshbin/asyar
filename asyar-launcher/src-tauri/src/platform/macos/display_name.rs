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
    language_candidates(locale).into_iter().find_map(|lang| {
        name_from_loctable(&resources.join("InfoPlist.loctable"), &lang).or_else(|| {
            name_from_info_plist_strings(&resources.join(format!("{lang}.lproj/InfoPlist.strings")))
        })
    })
}

/// Language keys to try, most specific first — `de-DE` before `de`. Bundles key
/// their tables either way, and macOS itself falls back along the same chain.
fn language_candidates(locale: &str) -> Vec<String> {
    let regional = locale.replace('_', "-");
    let base = regional.split('-').next().unwrap_or_default().to_string();
    match () {
        _ if base.is_empty() => Vec::new(),
        _ if base == regional => vec![base],
        _ => vec![regional, base],
    }
}

fn name_from_loctable(path: &Path, lang: &str) -> Option<String> {
    let table = plist::Value::from_file(path).ok()?;
    display_name_in(table.as_dictionary()?.get(lang)?.as_dictionary()?)
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
        assert_eq!(language_candidates("de-DE"), vec!["de-DE", "de"]);
        assert_eq!(language_candidates("de"), vec!["de"]);
        assert!(language_candidates("").is_empty());
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
