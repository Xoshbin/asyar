//! OS-level activation of the browser application that owns a tab.
//!
//! Switching a tab over the companion bridge (`chrome.tabs.update` +
//! `chrome.windows.update({ focused: true })`) brings *most* Chromium
//! browsers to the macOS foreground on its own. Arc is the exception: it
//! reimplements window management, so the companion's focus call only
//! changes the active tab *inside* Arc and never raises Arc.app. When the
//! launcher then hides itself, focus falls to whatever sat behind it.
//!
//! The launcher — the only party that can perform OS-level app activation —
//! brings the owning browser to the foreground after dispatching the
//! companion request. Two rules keep this safe:
//!
//! 1. **Never launch.** Only an *already-running* browser is activated. A
//!    live companion connection proves the browser is running, so there is
//!    never a reason to launch one — and launching a quit browser (e.g. when
//!    the reported variant is wrong) is exactly the bug this avoids.
//! 2. **Self-correct a wrong variant.** Arc masks its User-Agent as Chrome,
//!    so a companion may report `chrome` for an Arc tab. If the reported
//!    variant's app is not running but exactly one browser of the same
//!    family *is*, that one owns the connection — activate it instead.

use crate::browser::types::{BrowserFamily, BrowserKey};

/// macOS bundle identifier for the browser a [`BrowserKey`] refers to, or
/// `None` when the variant has no known bundle id.
pub fn macos_bundle_id(key: &BrowserKey) -> Option<&'static str> {
    match key.family {
        BrowserFamily::Chromium => match key.variant.as_str() {
            "chrome" => Some("com.google.Chrome"),
            "brave" => Some("com.brave.Browser"),
            "edge" => Some("com.microsoft.edgemac"),
            "vivaldi" => Some("com.vivaldi.Vivaldi"),
            "opera" => Some("com.operasoftware.Opera"),
            "arc" => Some("company.thebrowser.Browser"),
            _ => None,
        },
        BrowserFamily::Firefox => match key.variant.as_str() {
            "firefox" => Some("org.mozilla.firefox"),
            "librewolf" => Some("io.gitlab.librewolf-community"),
            _ => None,
        },
        BrowserFamily::Safari => Some("com.apple.Safari"),
    }
}

/// Every macOS bundle id we know for a browser family. Used by the
/// wrong-variant fallback to find which sibling browser is actually running.
pub fn family_bundle_ids(family: BrowserFamily) -> &'static [&'static str] {
    match family {
        BrowserFamily::Chromium => &[
            "com.google.Chrome",
            "com.brave.Browser",
            "com.microsoft.edgemac",
            "com.vivaldi.Vivaldi",
            "com.operasoftware.Opera",
            "company.thebrowser.Browser",
        ],
        BrowserFamily::Firefox => &["org.mozilla.firefox", "io.gitlab.librewolf-community"],
        BrowserFamily::Safari => &["com.apple.Safari"],
    }
}

/// Pure activation decision — kept free of any OS calls so the policy is
/// unit-testable. Returns the bundle id to bring forward, or `None` to do
/// nothing (which guarantees we never launch a quit app).
///
/// - `preferred`: bundle id of the companion-reported variant (may be wrong).
/// - `family_ids`: all bundle ids in the same family (the fallback search set).
/// - `is_running`: predicate for whether a bundle id has a running instance.
pub fn choose_app_to_activate(
    preferred: Option<&'static str>,
    family_ids: &[&'static str],
    is_running: impl Fn(&str) -> bool,
) -> Option<&'static str> {
    // 1. The reported variant's app, if it is actually running.
    if let Some(bundle_id) = preferred {
        if is_running(bundle_id) {
            return Some(bundle_id);
        }
    }
    // 2. The reported variant is wrong or its app isn't running. The live
    //    companion proves one browser of this family is up — if exactly one
    //    sibling is running, it owns the connection. Two or more is ambiguous,
    //    so activate nothing rather than focus the wrong browser (and never
    //    launch a quit one).
    let mut running = family_ids.iter().copied().filter(|id| is_running(id));
    match (running.next(), running.next()) {
        (Some(only), None) => Some(only),
        _ => None,
    }
}

/// Best-effort: bring the owning browser application to the macOS foreground.
/// Never fails the calling operation and never launches a browser.
pub fn activate(key: &BrowserKey) {
    #[cfg(target_os = "macos")]
    {
        let chosen = choose_app_to_activate(
            macos_bundle_id(key),
            family_bundle_ids(key.family),
            crate::platform::macos::is_app_running,
        );
        if let Some(bundle_id) = chosen {
            crate::platform::macos::activate_running_app(bundle_id);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = key;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chromium(variant: &str) -> BrowserKey {
        BrowserKey {
            family: BrowserFamily::Chromium,
            variant: variant.to_string(),
        }
    }

    #[test]
    fn arc_maps_to_the_browser_company_bundle_id() {
        assert_eq!(
            macos_bundle_id(&chromium("arc")),
            Some("company.thebrowser.Browser")
        );
    }

    #[test]
    fn chrome_maps_to_google_chrome_bundle_id() {
        assert_eq!(
            macos_bundle_id(&chromium("chrome")),
            Some("com.google.Chrome")
        );
    }

    #[test]
    fn known_chromium_variants_all_resolve() {
        for (variant, expected) in [
            ("brave", "com.brave.Browser"),
            ("edge", "com.microsoft.edgemac"),
            ("vivaldi", "com.vivaldi.Vivaldi"),
            ("opera", "com.operasoftware.Opera"),
        ] {
            assert_eq!(macos_bundle_id(&chromium(variant)), Some(expected));
        }
    }

    #[test]
    fn unknown_variant_has_no_bundle_id() {
        assert_eq!(macos_bundle_id(&chromium("nonexistent-browser")), None);
    }

    #[test]
    fn family_bundle_ids_include_arc_and_chrome_for_chromium() {
        let ids = family_bundle_ids(BrowserFamily::Chromium);
        assert!(ids.contains(&"company.thebrowser.Browser"));
        assert!(ids.contains(&"com.google.Chrome"));
    }

    // ---- choose_app_to_activate ----

    #[test]
    fn prefers_the_reported_variant_when_it_is_running() {
        let chosen = choose_app_to_activate(
            Some("com.google.Chrome"),
            family_bundle_ids(BrowserFamily::Chromium),
            |b| b == "com.google.Chrome" || b == "company.thebrowser.Browser",
        );
        assert_eq!(chosen, Some("com.google.Chrome"));
    }

    #[test]
    fn falls_back_to_sole_running_family_member_when_variant_is_wrong() {
        // Arc masked as Chrome: reported chrome is NOT running, only Arc is.
        let chosen = choose_app_to_activate(
            Some("com.google.Chrome"),
            family_bundle_ids(BrowserFamily::Chromium),
            |b| b == "company.thebrowser.Browser",
        );
        assert_eq!(chosen, Some("company.thebrowser.Browser"));
    }

    #[test]
    fn never_launches_when_nothing_is_running() {
        let chosen = choose_app_to_activate(
            Some("com.google.Chrome"),
            family_bundle_ids(BrowserFamily::Chromium),
            |_| false,
        );
        assert_eq!(chosen, None);
    }

    #[test]
    fn does_not_guess_when_multiple_family_members_run_and_variant_is_wrong() {
        // Reported variant unknown/not running, and both Chrome and Arc run —
        // ambiguous, so activate nothing rather than focus the wrong browser.
        let chosen =
            choose_app_to_activate(None, family_bundle_ids(BrowserFamily::Chromium), |b| {
                b == "com.google.Chrome" || b == "company.thebrowser.Browser"
            });
        assert_eq!(chosen, None);
    }

    #[test]
    fn no_preferred_but_single_running_member_is_chosen() {
        let chosen =
            choose_app_to_activate(None, family_bundle_ids(BrowserFamily::Chromium), |b| {
                b == "company.thebrowser.Browser"
            });
        assert_eq!(chosen, Some("company.thebrowser.Browser"));
    }
}
