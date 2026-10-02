#![allow(deprecated)]
pub use asyar_platform::macos::window::*;

use objc2::msg_send;
use objc2::runtime::AnyObject;
use objc2_foundation::NSRect;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use tauri_nspanel::{panel_delegate, Panel, WebviewWindowExt as PanelWebviewWindowExt};
use window_vibrancy::apply_vibrancy;

/// Configures a window to behave as a macOS Spotlight-style search bar.
pub fn setup_spotlight_window<R: Runtime>(
    window: &WebviewWindow<R>,
    app: &AppHandle<R>,
    theme_pref: crate::ThemePreference,
) -> tauri::Result<Panel> {
    let panel = window
        .to_panel()
        .map_err(|_| tauri::Error::FailedToReceiveMessage)?;

    panel.set_level(tauri_nspanel::cocoa::appkit::NSMainMenuWindowLevel + 1);
    let ns_window = window.ns_window().unwrap() as *mut AnyObject;
    // SAFETY: ns_window() returns a valid NSWindow pointer on success.
    unsafe { asyar_platform::macos::apply_spotlight_window_styling(ns_window) };

    #[allow(non_upper_case_globals)]
    const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
    panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);
    panel.set_becomes_key_only_if_needed(true);

    let panel_delegate = panel_delegate!(SpotlightPanelDelegate {
        window_did_resign_key,
        window_did_become_key
    });

    let app_handle = app.clone();
    panel_delegate.set_listener(Box::new(move |delegate_name: String| {
        match delegate_name.as_str() {
            "window_did_resign_key" => {
                let _ = app_handle.emit(
                    &format!("{}_panel_did_resign_key", crate::SPOTLIGHT_LABEL),
                    (),
                );
            }
            "window_did_become_key" => {
                let _ = app_handle.emit(
                    &format!("{}_panel_did_become_key", crate::SPOTLIGHT_LABEL),
                    (),
                );
            }
            _ => (),
        }
    }));

    panel.set_delegate(panel_delegate);

    let resolved = asyar_platform::macos::resolve_theme_preference(theme_pref);
    let material = asyar_platform::macos::material_for_resolved_theme(resolved);
    let _ = apply_vibrancy(window, material, None, None);

    crate::platform::macos::apply_panel_appearance(window, theme_pref);
    crate::platform::macos::pin_launcher_webview(window);

    Ok(panel)
}

pub fn setup_hud_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<Panel> {
    let panel = window
        .to_panel()
        .map_err(|_| tauri::Error::FailedToReceiveMessage)?;

    panel.set_level(tauri_nspanel::cocoa::appkit::NSMainMenuWindowLevel + 2);

    let flags = asyar_platform::macos::hud_panel_flags();

    unsafe {
        let ns_window = window.ns_window().unwrap() as *mut AnyObject;
        let _: () = msg_send![
            ns_window,
            setCollectionBehavior: flags.collection_behavior_bits
        ];
    }

    panel.set_style_mask(flags.style_mask);

    Ok(panel)
}

pub fn setup_sticky_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<Panel> {
    let panel = window
        .to_panel()
        .map_err(|_| tauri::Error::FailedToReceiveMessage)?;

    let flags = asyar_platform::macos::sticky_panel_flags();

    panel.set_level(flags.level);

    unsafe {
        let ns_window = window.ns_window().unwrap() as *mut AnyObject;
        let _: () = msg_send![
            ns_window,
            setCollectionBehavior: flags.collection_behavior_bits
        ];
    }

    panel.set_style_mask(flags.style_mask);

    Ok(panel)
}

pub fn get_window_frame<R: Runtime>(window: &WebviewWindow<R>) -> NSRect {
    let ns_window = window.ns_window().unwrap() as *mut AnyObject;
    // SAFETY: ns_window() returns a valid NSWindow pointer.
    unsafe { asyar_platform::macos::get_window_frame(ns_window) }
}

pub fn set_window_frame<R: Runtime>(window: &WebviewWindow<R>, rect: NSRect) {
    let ns_window = window.ns_window().unwrap() as *mut AnyObject;
    // SAFETY: ns_window() returns a valid NSWindow pointer.
    unsafe { asyar_platform::macos::set_window_frame(ns_window, rect) };
}

pub fn set_window_alpha<R: Runtime>(window: &WebviewWindow<R>, alpha: f64) {
    if let Ok(ptr) = window.ns_window() {
        // SAFETY: ns_window() returns a valid NSWindow pointer on success.
        unsafe { asyar_platform::macos::set_window_alpha(ptr as *mut AnyObject, alpha) };
    }
}

pub fn set_ignores_mouse_events<R: Runtime>(window: &WebviewWindow<R>, ignores: bool) {
    if let Ok(ptr) = window.ns_window() {
        // SAFETY: ns_window() returns a valid NSWindow pointer on success.
        unsafe { asyar_platform::macos::set_ignores_mouse_events(ptr as *mut AnyObject, ignores) };
    }
}

pub fn is_key_window<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let ns_window = match window.ns_window() {
        Ok(ptr) => ptr as *mut AnyObject,
        Err(_) => return false,
    };
    // SAFETY: ns_window() returned a valid NSWindow pointer.
    unsafe { asyar_platform::macos::is_key_window(ns_window) }
}

pub fn park_launcher_panel<R: Runtime>(window: &WebviewWindow<R>, panel: &Panel) {
    set_window_alpha(window, 0.0);
    set_ignores_mouse_events(window, true);
    if is_key_window(window) {
        panel.order_out(None);
        panel.order_front_regardless();
    }
}

pub fn reveal_launcher_panel<R: Runtime>(window: &WebviewWindow<R>, panel: &Panel) {
    set_ignores_mouse_events(window, false);
    if let Err(e) = position_launcher(window) {
        log::warn!(
            "[launcher-reveal] position_launcher failed: {e}; revealing at previous position"
        );
    }
    panel.show();
    set_window_alpha(window, 1.0);
    reseat_first_responder(window);
}

pub fn prewarm_launcher_panel<R: Runtime>(window: &WebviewWindow<R>, panel: &Panel) {
    set_window_alpha(window, 0.0);
    set_ignores_mouse_events(window, true);
    panel.order_front_regardless();
    log::info!("[launcher-park] prewarmed at boot (ordered in, alpha 0, mouse-transparent)");
}

pub fn disable_occlusion_detection<R: Runtime>(window: &WebviewWindow<R>) {
    if let Ok(ptr) = window.ns_window() {
        // SAFETY: ns_window() returns a valid NSWindow pointer on success.
        unsafe { asyar_platform::macos::disable_occlusion_detection(ptr as *mut AnyObject) };
    }
}

pub fn configure_launcher_webkit_features<R: Runtime>(window: &WebviewWindow<R>) {
    if let Ok(ptr) = window.ns_window() {
        // SAFETY: ns_window() returns a valid NSWindow pointer on success.
        unsafe { asyar_platform::macos::configure_launcher_webkit_features(ptr as *mut AnyObject) };
    }
}

pub fn reveal_window_after_first_paint<R: Runtime + 'static>(
    window: &WebviewWindow<R>,
    fallback_ms: u64,
) {
    let ns_window = match window.ns_window() {
        Ok(ptr) => ptr as *mut AnyObject,
        Err(_) => {
            let _ = window.show();
            let _ = window.set_focus();
            return;
        }
    };

    let hooked = unsafe {
        let content_view: *mut AnyObject = msg_send![ns_window, contentView];
        let webview = asyar_platform::macos::find_webview(content_view);
        let sel_present = objc2::sel!(_doAfterNextPresentationUpdate:);
        let ok: objc2::runtime::Bool = if !webview.is_null() {
            msg_send![webview, respondsToSelector: sel_present]
        } else {
            objc2::runtime::Bool::NO
        };

        if ok.as_bool() {
            set_window_alpha(window, 0.0);
            let w = window.clone();
            let block = block2::RcBlock::new(move || {
                set_window_alpha(&w, 1.0);
                let _ = w.set_focus();
            });
            let _: () = msg_send![webview, _doAfterNextPresentationUpdate: &*block];
            let _ = window.show();
            true
        } else {
            false
        }
    };

    if !hooked {
        log::info!("[first-paint] _doAfterNextPresentationUpdate absent; showing immediately");
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let w = window.clone();
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(fallback_ms)).await;
        let _ = app.run_on_main_thread(move || {
            if window_alpha(&w) < 1.0 {
                log::warn!(
                    "[first-paint] presentation update never fired within {fallback_ms}ms; revealing '{}' via watchdog",
                    w.label()
                );
                set_window_alpha(&w, 1.0);
                let _ = w.set_focus();
            }
        });
    });
}

pub fn window_alpha<R: Runtime>(window: &WebviewWindow<R>) -> f64 {
    match window.ns_window() {
        // SAFETY: ns_window() returns a valid NSWindow pointer on success.
        Ok(ptr) => unsafe { asyar_platform::macos::get_window_alpha(ptr as *mut AnyObject) },
        Err(_) => 1.0,
    }
}

pub fn reseat_first_responder<R: Runtime>(window: &WebviewWindow<R>) {
    if let Ok(ptr) = window.ns_window() {
        // SAFETY: ns_window() returns a valid NSWindow pointer on success.
        unsafe { asyar_platform::macos::reseat_first_responder(ptr as *mut AnyObject) };
    }
}

pub fn pin_launcher_webview<R: Runtime>(window: &WebviewWindow<R>) {
    if let Ok(ptr) = window.ns_window() {
        // SAFETY: ns_window() returns a valid NSWindow pointer on success.
        unsafe { asyar_platform::macos::pin_launcher_webview(ptr as *mut AnyObject) };
    }
}

pub fn set_launcher_window_height<R: Runtime + 'static>(
    window: &WebviewWindow<R>,
    height: f64,
    mode: ResizeMode,
) {
    let Ok(ptr) = window.ns_window() else { return };
    let ns_window = ptr as *mut AnyObject;

    // SAFETY: ns_window() returned a valid NSWindow pointer.
    let watchdog_gen =
        unsafe { asyar_platform::macos::set_launcher_window_height(ns_window, height, mode) };

    if let Some(gen) = watchdog_gen {
        const GROW_WATCHDOG_MS: u64 = 250;
        let w = window.clone();
        let app = window.app_handle().clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(GROW_WATCHDOG_MS)).await;
            let _ = app.run_on_main_thread(move || {
                let Ok(ptr) = w.ns_window() else { return };
                // SAFETY: ns_window() returned a valid NSWindow pointer.
                unsafe {
                    asyar_platform::macos::force_apply_resize_if_generation_matches(
                        ptr as *mut AnyObject,
                        height,
                        gen,
                    )
                };
            });
        });
    }
}

pub fn position_launcher<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<(), crate::error::AppError> {
    crate::launcher_placement::service::apply(window.app_handle())
}
