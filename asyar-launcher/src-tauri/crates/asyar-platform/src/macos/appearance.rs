#![allow(deprecated)]
use super::window::find_vibrancy_view;
use super::*;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};
use objc2::{msg_send, msg_send_id};
use objc2_foundation::NSString;
use window_vibrancy::NSVisualEffectMaterial;

pub use crate::window::ThemePreference;

/// HudWindow is the only material that stays uniformly translucent across
/// both modes — Sidebar in light made the launcher look nearly opaque while
/// dark stayed vibrant, breaking visual parity.
pub fn material_for_resolved_theme(_theme: ResolvedTheme) -> NSVisualEffectMaterial {
    NSVisualEffectMaterial::HudWindow
}

/// Resolves a `ThemePreference` to the actual appearance at call time.
pub fn resolve_theme_preference(pref: ThemePreference) -> ResolvedTheme {
    match pref {
        ThemePreference::Light => ResolvedTheme::Light,
        ThemePreference::Dark => ResolvedTheme::Dark,
        ThemePreference::System => detect_system_appearance(),
    }
}

pub fn detect_system_appearance() -> ResolvedTheme {
    unsafe {
        let app_cls = match AnyClass::get("NSApplication") {
            Some(c) => c,
            None => return ResolvedTheme::Dark,
        };
        let ns_app: *mut AnyObject = msg_send![app_cls, sharedApplication];
        if ns_app.is_null() {
            return ResolvedTheme::Dark;
        }

        let appearance: *mut AnyObject = msg_send![ns_app, effectiveAppearance];
        if appearance.is_null() {
            return ResolvedTheme::Dark;
        }

        // Ask the appearance to choose the best match from [DarkAqua, Aqua].
        let dark_name = NSString::from_str("NSAppearanceNameDarkAqua");
        let light_name = NSString::from_str("NSAppearanceNameAqua");

        let arr_cls = match AnyClass::get("NSArray") {
            Some(c) => c,
            None => return ResolvedTheme::Dark,
        };
        let names: [*const AnyObject; 2] = [
            Retained::as_ptr(&dark_name) as *const AnyObject,
            Retained::as_ptr(&light_name) as *const AnyObject,
        ];
        let name_array: *mut AnyObject = msg_send![
            arr_cls,
            arrayWithObjects: names.as_ptr()
            count: 2usize
        ];

        let best: *mut AnyObject =
            msg_send![appearance, bestMatchFromAppearancesWithNames: name_array];
        if best.is_null() {
            return ResolvedTheme::Dark;
        }

        let best_name: Option<Retained<NSString>> = msg_send_id![best, description];
        match best_name.map(|s| s.to_string()) {
            Some(ref s) if s.contains("Dark") => ResolvedTheme::Dark,
            Some(_) => ResolvedTheme::Light,
            None => ResolvedTheme::Dark,
        }
    }
}

/// Sets the NSWindow's NSAppearance and the NSVisualEffectView material to match `pref`.
///
/// # Safety
/// `ns_window` must be either null or a valid pointer to an `NSWindow` instance.
pub unsafe fn apply_panel_appearance(ns_window: *mut AnyObject, pref: ThemePreference) {
    if ns_window.is_null() {
        log::warn!("[apply_panel_appearance] null ns_window pointer");
        return;
    }

    {
        let appearance: *mut AnyObject = match pref {
            ThemePreference::Light => {
                let cls = match AnyClass::get("NSAppearance") {
                    Some(c) => c,
                    None => {
                        log::warn!("[apply_panel_appearance] NSAppearance class not found");
                        return;
                    }
                };
                let name = NSString::from_str("NSAppearanceNameAqua");
                msg_send![cls, appearanceNamed: Retained::as_ptr(&name)]
            }
            ThemePreference::Dark => {
                let cls = match AnyClass::get("NSAppearance") {
                    Some(c) => c,
                    None => {
                        log::warn!("[apply_panel_appearance] NSAppearance class not found");
                        return;
                    }
                };
                let name = NSString::from_str("NSAppearanceNameDarkAqua");
                msg_send![cls, appearanceNamed: Retained::as_ptr(&name)]
            }
            ThemePreference::System => std::ptr::null_mut(),
        };
        let _: () = msg_send![ns_window, setAppearance: appearance];

        let resolved = resolve_theme_preference(pref);
        let target_material = material_for_resolved_theme(resolved);
        let target_raw = target_material as i64;

        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        let vibrancy = find_vibrancy_view(content_view);
        if vibrancy.is_null() {
            log::warn!("[apply_panel_appearance] vibrancy view not found");
            return;
        }

        let current_raw: i64 = msg_send![vibrancy, material];
        if current_raw != target_raw {
            let _: () = msg_send![vibrancy, setMaterial: target_raw];
        }
    }
}

/// Registers an observer for `AppleInterfaceThemeChangedNotification`.
/// Executes `callback` on the main queue when the system appearance toggles.
pub fn install_appearance_observer<F: Fn() + Send + Sync + 'static>(callback: F) {
    use objc2_foundation::{NSNotification, NSString};

    let block = block2::RcBlock::new(move |_note: std::ptr::NonNull<NSNotification>| {
        callback();
    });

    unsafe {
        let center_cls = match AnyClass::get("NSDistributedNotificationCenter") {
            Some(c) => c,
            None => {
                log::error!(
                    "[install_appearance_observer] NSDistributedNotificationCenter class not found"
                );
                return;
            }
        };
        let center: *mut AnyObject = msg_send![center_cls, defaultCenter];
        if center.is_null() {
            log::error!("[install_appearance_observer] defaultCenter returned null");
            return;
        }

        let notif_name = NSString::from_str("AppleInterfaceThemeChangedNotification");
        let main_queue_cls = match AnyClass::get("NSOperationQueue") {
            Some(c) => c,
            None => {
                log::error!("[install_appearance_observer] NSOperationQueue class not found");
                return;
            }
        };
        let main_queue: *mut AnyObject = msg_send![main_queue_cls, mainQueue];

        let nil: *const AnyObject = std::ptr::null();
        let observer: Option<Retained<AnyObject>> = msg_send_id![
            center,
            addObserverForName: Retained::as_ptr(&notif_name)
            object: nil
            queue: main_queue
            usingBlock: &*block as &block2::Block<dyn Fn(std::ptr::NonNull<NSNotification>)>
        ];

        match observer {
            Some(obs) => {
                std::mem::forget(obs);
            }
            None => {
                log::error!("[install_appearance_observer] addObserverForName returned nil");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn light_theme_maps_to_hud_window_material() {
        let material = material_for_resolved_theme(ResolvedTheme::Light);
        assert_eq!(material, NSVisualEffectMaterial::HudWindow);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn dark_theme_maps_to_hud_window_material() {
        let material = material_for_resolved_theme(ResolvedTheme::Dark);
        assert_eq!(material, NSVisualEffectMaterial::HudWindow);
    }
}
