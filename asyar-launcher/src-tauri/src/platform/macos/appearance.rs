#![allow(deprecated)]
use super::window::find_vibrancy_view;
use super::*;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};
use objc2::{msg_send, msg_send_id};
use objc2_foundation::NSString;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use window_vibrancy::NSVisualEffectMaterial;

/// HudWindow is the only material that stays uniformly translucent across
/// both modes — Sidebar in light made the launcher look nearly opaque while
/// dark stayed vibrant, breaking visual parity.
pub fn material_for_resolved_theme(_theme: ResolvedTheme) -> NSVisualEffectMaterial {
    NSVisualEffectMaterial::HudWindow
}

/// Resolves a `ThemePreference` to the actual appearance at call time.
/// For `System`, inspects `NSApp.effectiveAppearance` via the Objective-C
/// runtime; defaults to `Dark` on any inspection failure (preserves the
/// pre-existing HudWindow behavior on edge cases).
pub fn resolve_theme_preference(pref: crate::ThemePreference) -> ResolvedTheme {
    use crate::ThemePreference as TP;
    match pref {
        TP::Light => ResolvedTheme::Light,
        TP::Dark => ResolvedTheme::Dark,
        TP::System => detect_system_appearance(),
    }
}

fn detect_system_appearance() -> ResolvedTheme {
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

        // +[NSArray arrayWithObjects:count:] — simplest way without importing NSArray.
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

/// Sets the NSWindow's NSAppearance and the NSVisualEffectView material to
/// match `pref`. Both operations are needed: the material's tint is
/// determined by `effectiveAppearance`, so without the appearance override
/// even `HudWindow` material renders light-tinted when the OS is in light
/// mode, producing the washed-out panel the user sees when Asyar=Dark but
/// OS=Light.
///
/// NSAppearance mapping:
/// - `Light`  → `NSAppearanceNameAqua`   (explicit light appearance)
/// - `Dark`   → `NSAppearanceNameDarkAqua` (explicit dark appearance)
/// - `System` → `nil` (AppKit auto-tracks the OS; idiomatic pattern)
///
/// The material switch is idempotent — reads the current value and skips
/// `setMaterial:` if unchanged. The appearance override is always applied
/// because nil vs non-nil can't be compared cheaply via objc2.
///
/// Must be called on the main thread. Returns silently if the window or
/// vibrancy view cannot be located.
pub fn apply_panel_appearance<R: Runtime>(window: &WebviewWindow<R>, pref: crate::ThemePreference) {
    let ns_window = match window.ns_window() {
        Ok(ptr) => ptr as *mut AnyObject,
        Err(_) => {
            log::warn!("[apply_panel_appearance] ns_window() failed");
            return;
        }
    };

    unsafe {
        // Set the window's NSAppearance so the blur material tints correctly
        // regardless of the OS appearance. nil means "follow the OS".
        let appearance: *mut AnyObject = match pref {
            crate::ThemePreference::Light => {
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
            crate::ThemePreference::Dark => {
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
            crate::ThemePreference::System => std::ptr::null_mut(),
        };
        let _: () = msg_send![ns_window, setAppearance: appearance];

        // Update the vibrancy material to match the resolved appearance.
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

/// Registers a `NSDistributedNotificationCenter` observer for
/// `AppleInterfaceThemeChangedNotification`. When the OS appearance changes,
/// the block re-reads the managed `Mutex<ThemePreference>`. If the preference
/// is `System`, it re-applies both the NSWindow appearance and the vibrancy
/// material — if the user chose Light or Dark explicitly, the OS toggle is
/// ignored (user's explicit choice wins; the appearance was already pinned via
/// setAppearance: at preference-set time).
///
/// Delivers on the main queue so AppKit calls are safe without a further
/// thread hop.
///
/// The observer is leaked intentionally: it must live for the entire app
/// lifetime, and `NSDistributedNotificationCenter` retains it internally.
pub fn install_appearance_observer<R: Runtime + 'static>(app: &AppHandle<R>) {
    use objc2::rc::Retained;
    use objc2_foundation::{NSNotification, NSString};

    let app_handle = app.clone();

    let block = block2::RcBlock::new(move |_note: std::ptr::NonNull<NSNotification>| {
        let pref = {
            let state = app_handle.try_state::<std::sync::Mutex<crate::ThemePreference>>();
            match state {
                Some(s) => *s.lock().unwrap_or_else(|p| p.into_inner()),
                None => crate::ThemePreference::System,
            }
        };

        // Only act on OS flips when the user chose System. For Light/Dark,
        // setAppearance: already pinned the window appearance — skipping
        // here avoids a redundant AppKit call and keeps intent clear.
        if pref == crate::ThemePreference::System {
            if let Some(window) = app_handle.get_webview_window(crate::SPOTLIGHT_LABEL) {
                apply_panel_appearance(&window, pref);
            }
        }
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
                // Intentional leak: observer must live for the app lifetime.
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
