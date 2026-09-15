//! Native Quick Look preview panel hosting.
//!
//! Presents the shared `QLPreviewPanel` — the same panel Finder uses — for a
//! file, replacing the old `qlmanage -p` debug spawn whose window titles
//! began with "[Debug]" and whose lifecycle Asyar could not manage. Escape
//! closes the panel natively once it is key; calling `quick_look_toggle`
//! again with the same path dismisses it.
//!
//! `QLPreviewPanel` lives in the Quartz framework, which is not loaded by
//! default — the empty `#[link]` below forces it into the binary so the
//! ObjC class and the `QLPreviewPanelDataSource` protocol are registered in
//! the runtime before `AnyClass::get` / `Protocol::get` need them.
//!
//! The data source is a tiny class built once at runtime (the repo's objc
//! style is runtime lookup + `msg_send!`, not generated bindings); it serves
//! a single `NSURL` preview item backed by [`CURRENT_PATH`]. `NSURL`
//! conforms to `QLPreviewItem`, so no preview-item wrapper class is needed.
#![allow(clippy::missing_safety_doc)]

use objc2::declare::ClassBuilder;
use objc2::runtime::{AnyClass, AnyObject, Bool, Protocol, Sel};
use objc2::{msg_send, sel};
use objc2_foundation::NSString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

#[link(name = "Quartz", kind = "framework")]
extern "C" {}

/// The file the data source currently serves. The panel is dismissed when
/// `quick_look_toggle` is called again with this same path; any other path
/// swaps the preview in place.
static CURRENT_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Raw retained pointer to the lazily-built data source singleton. Leaked by
/// design: the panel holds its own retain and the class must outlive every
/// presentation for the app's lifetime.
static DATA_SOURCE: OnceLock<usize> = OnceLock::new();

extern "C" fn num_preview_items_imp(
    _this: *mut AnyObject,
    _cmd: Sel,
    _panel: *mut AnyObject,
) -> isize {
    1
}

extern "C" fn preview_item_at_index_imp(
    _this: *mut AnyObject,
    _cmd: Sel,
    _panel: *mut AnyObject,
    _index: isize,
) -> *mut AnyObject {
    let Some(path) = CURRENT_PATH
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
    else {
        return std::ptr::null_mut();
    };
    unsafe {
        let Some(url_cls) = AnyClass::get("NSURL") else {
            return std::ptr::null_mut();
        };
        let ns_path = NSString::from_str(&path.to_string_lossy());
        msg_send![url_cls, fileURLWithPath: &*ns_path isDirectory: false]
    }
}

/// Builds (once) and returns the data source singleton.
fn ensure_data_source() -> *mut AnyObject {
    let ptr = *DATA_SOURCE.get_or_init(|| unsafe {
        let Some(nsobject) = AnyClass::get("NSObject") else {
            return 0;
        };
        let Some(mut builder) = ClassBuilder::new("AsyarQLDataSource", nsobject) else {
            return 0;
        };
        builder.add_method(
            sel!(numberOfPreviewItemsInPreviewPanel:),
            num_preview_items_imp as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject) -> isize,
        );
        builder.add_method(
            sel!(previewPanel:previewItemAtIndex:),
            preview_item_at_index_imp
                as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject, isize) -> *mut AnyObject,
        );
        // `setDataSource:` asserts conformance on debug macOS builds; adopt
        // the protocol explicitly rather than relying on selector presence.
        if let Some(protocol) = Protocol::get("QLPreviewPanelDataSource") {
            builder.add_protocol(protocol);
        }
        let cls: &'static AnyClass = builder.register();
        let obj: *mut AnyObject = msg_send![cls, new];
        obj as usize
    });
    ptr as *mut AnyObject
}

/// Shows the Quick Look panel for `path`, or dismisses it when it is already
/// showing that exact path. Returns `false` when Quick Look is unavailable
/// (framework not loaded) so callers can fall back to opening the file.
///
/// Must run on the main thread — `sharedPreviewPanel` and panel ordering are
/// main-thread-only AppKit work.
pub fn quick_look_toggle(path: &Path) -> bool {
    unsafe {
        let Some(panel_cls) = AnyClass::get("QLPreviewPanel") else {
            log::warn!("[quicklook] QLPreviewPanel class unavailable (Quartz not loaded)");
            return false;
        };
        let panel: *mut AnyObject = msg_send![panel_cls, sharedPreviewPanel];
        if panel.is_null() {
            return false;
        }

        // Toggle: same path showing → dismiss. `unwrap_or_else(into_inner)`
        // recovers from a poisoned lock instead of panicking the launcher.
        let visible: Bool = msg_send![panel, isVisible];
        if visible.as_bool()
            && CURRENT_PATH
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .as_deref()
                == Some(path)
        {
            let _: () = msg_send![panel, orderOut: std::ptr::null::<AnyObject>()];
            return true;
        }

        *CURRENT_PATH.lock().unwrap_or_else(|p| p.into_inner()) = Some(path.to_path_buf());
        let data_source = ensure_data_source();
        if data_source.is_null() {
            return false;
        }
        let _: () = msg_send![panel, setDataSource: data_source];
        let _: () = msg_send![panel, reloadData];

        // The launcher panel is non-activating, so the app may not be active;
        // a panel can only become key while its app is active. NOTE: the
        // selector returns `void` (tao's NSApplication subclass overrides it
        // that way) — typing it as `Bool` makes objc2 panic at runtime.
        if let Some(app_cls) = AnyClass::get("NSApplication") {
            let app: *mut AnyObject = msg_send![app_cls, sharedApplication];
            if !app.is_null() {
                let _: () = msg_send![app, activateIgnoringOtherApps: true];
            }
        }
        let _: () = msg_send![panel, makeKeyAndOrderFront: std::ptr::null::<AnyObject>()];
        true
    }
}

/// Whether the panel is currently on screen. Used by tests and debugging.
pub fn quick_look_visible() -> bool {
    unsafe {
        let Some(panel_cls) = AnyClass::get("QLPreviewPanel") else {
            return false;
        };
        let panel: *mut AnyObject = msg_send![panel_cls, sharedPreviewPanel];
        if panel.is_null() {
            return false;
        }
        let visible: Bool = msg_send![panel, isVisible];
        visible.as_bool()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Manual smoke test — presents the real shared `QLPreviewPanel` on
    /// screen, then dismisses it. Panel ordering is AppKit work, so run it
    /// alone and expect the panel to flash open and closed; CI never
    /// executes ignored tests:
    ///
    /// ```sh
    /// cargo test quick_look_panel_smoke -- --ignored
    /// ```
    #[test]
    #[ignore = "presents the real Quick Look panel; run manually with --ignored"]
    fn quick_look_panel_smoke_present_and_dismiss() {
        let tmp = std::env::temp_dir().join("__asyar_ql_smoke__.txt");
        std::fs::write(&tmp, "quick look smoke").unwrap();

        assert!(
            quick_look_toggle(&tmp),
            "first toggle must present the panel"
        );
        assert!(
            quick_look_visible(),
            "panel must report visible after present"
        );

        assert!(
            quick_look_toggle(&tmp),
            "second toggle with the same path must dismiss the panel"
        );
        assert!(!quick_look_visible(), "panel must be hidden after dismiss");

        let _ = std::fs::remove_file(&tmp);
    }
}
