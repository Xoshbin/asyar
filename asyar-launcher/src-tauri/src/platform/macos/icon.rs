#![allow(deprecated)]
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};
use objc2::{msg_send, msg_send_id};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::path::Path;

fn get_app_icon_name(path: &Path) -> String {
    let plist_path = path.join("Contents/Info.plist");
    plist::from_file::<_, plist::Value>(&plist_path)
        .ok()
        .and_then(|v| v.into_dictionary())
        .and_then(|d| d.get("CFBundleIconFile").cloned())
        .and_then(|v| v.into_string())
        .unwrap_or_else(|| "AppIcon".to_string())
}

/// Returns a 128×128 PNG of the app's icon. Tries the discrete-`.icns` fast
/// path first (sub-ms, no AppKit dependency), then falls back to AppKit's
/// `NSWorkspace iconForFile:` for apps that ship icons via Asset Catalogs
/// (`Assets.car`) or non-`.app` paths the .icns reader can't handle.
pub fn extract_icon(path: &Path) -> Option<Vec<u8>> {
    if !path.exists() {
        return None;
    }
    extract_icon_from_icns(path).or_else(|| extract_icon_via_nsworkspace(path))
}

fn extract_icon_from_icns(path: &Path) -> Option<Vec<u8>> {
    let icon_name = get_app_icon_name(path);
    let icon_filename = if icon_name.ends_with(".icns") {
        icon_name
    } else {
        format!("{}.icns", icon_name)
    };
    let icns_path = path.join("Contents/Resources").join(&icon_filename);
    let icns_path = if icns_path.exists() {
        icns_path
    } else {
        let resources_dir = path.join("Contents/Resources");
        std::fs::read_dir(&resources_dir)
            .ok()?
            .filter_map(|e| e.ok())
            .find(|e| e.path().extension().map(|x| x == "icns").unwrap_or(false))?
            .path()
    };
    let file = std::fs::File::open(&icns_path).ok()?;
    let icon_family = icns::IconFamily::read(file).ok()?;
    let preferred = [
        icns::IconType::RGB24_32x32,
        icns::IconType::RGBA32_32x32,
        icns::IconType::RGBA32_64x64,
        icns::IconType::RGBA32_128x128,
        icns::IconType::RGB24_16x16,
    ];
    for icon_type in &preferred {
        if let Ok(image) = icon_family.get_icon_with_type(*icon_type) {
            let mut buf = std::io::Cursor::new(Vec::new());
            if image.write_png(&mut buf).is_ok() {
                return Some(buf.into_inner());
            }
        }
    }
    // Fallback: try any available icon type
    for icon_type in icon_family.available_icons() {
        if let Ok(image) = icon_family.get_icon_with_type(icon_type) {
            let mut buf = std::io::Cursor::new(Vec::new());
            if image.write_png(&mut buf).is_ok() {
                return Some(buf.into_inner());
            }
        }
    }
    None
}

/// Renders the OS-resolved icon for `path` as a 128×128 PNG using the
/// AppKit pipeline: `NSImage` → `CGImageForProposedRect:` →
/// `NSBitmapImageRep` → PNG.
///
/// SAFETY: The AppKit pipeline is main-thread only. This is called from
/// the sync `clipboard_record_capture` Tauri command and the application
/// scanner, both of which are dispatched on the main thread.
fn extract_icon_via_nsworkspace(path: &Path) -> Option<Vec<u8>> {
    use objc2::encode::{Encoding, RefEncode};
    use objc2_foundation::NSData;
    use std::ffi::CString;

    #[repr(C)]
    struct CGImageStub {
        _private: [u8; 0],
    }
    unsafe impl RefEncode for CGImageStub {
        const ENCODING_REF: Encoding = Encoding::Pointer(&Encoding::Struct("CGImage", &[]));
    }

    let path_str = path.to_str()?;
    let path_cstr = CString::new(path_str).ok()?;

    unsafe {
        let nsstring_cls = AnyClass::get("NSString")?;
        let workspace_cls = AnyClass::get("NSWorkspace")?;
        let nsbitmap_cls = AnyClass::get("NSBitmapImageRep")?;

        let ns_path: *mut AnyObject =
            msg_send![nsstring_cls, stringWithUTF8String: path_cstr.as_ptr()];

        let workspace: *mut AnyObject = msg_send![workspace_cls, sharedWorkspace];
        if workspace.is_null() {
            log::warn!("[icon] NSWorkspace sharedWorkspace returned null");
            return None;
        }

        let image: *mut AnyObject = msg_send![workspace, iconForFile: ns_path];
        if image.is_null() {
            log::warn!(
                "[icon] NSWorkspace iconForFile returned null for {}",
                path_str
            );
            return None;
        }

        // Match the .icns fast path's preferred 128px size so cached files
        // are visually consistent regardless of which branch produced them.
        let target = NSSize {
            width: 128.0,
            height: 128.0,
        };
        let _: () = msg_send![image, setSize: target];

        let mut proposed = NSRect {
            origin: NSPoint { x: 0.0, y: 0.0 },
            size: target,
        };
        let nil: *mut AnyObject = std::ptr::null_mut();
        let cg_image: *const CGImageStub = msg_send![
            image,
            CGImageForProposedRect: &mut proposed as *mut NSRect
            context: nil
            hints: nil
        ];
        if cg_image.is_null() {
            log::warn!(
                "[icon] CGImageForProposedRect returned null for {}",
                path_str
            );
            return None;
        }

        let bitmap: *mut AnyObject = msg_send![nsbitmap_cls, alloc];
        let bitmap: *mut AnyObject = msg_send![bitmap, initWithCGImage: cg_image];
        if bitmap.is_null() {
            log::warn!(
                "[icon] NSBitmapImageRep initWithCGImage returned null for {}",
                path_str
            );
            return None;
        }
        let _: () = msg_send![bitmap, setSize: target];

        // representationUsingType:4 == NSBitmapImageFileTypePNG
        let png_data: Retained<NSData> = msg_send_id![
            bitmap,
            representationUsingType: 4u64
            properties: nil
        ];
        let bytes = png_data.bytes();
        if bytes.is_empty() {
            log::warn!(
                "[icon] NSBitmapImageRep produced empty PNG payload for {}",
                path_str
            );
            return None;
        }
        Some(bytes.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Embeds the TS source at compile time and extracts
    /// `export const LAUNCHER_HEIGHT_{DEFAULT,COMPACT} = <number>;`. The
    /// Rust constants above must match — any drift in either direction
    /// breaks the compact-launcher invariant (webview pinned at MAX,
    /// window cropped to COMPACT).
    /// `extract_icon` must succeed for app paths that ship icons via
    /// Asset Catalog (`Assets.car`) instead of a discrete `.icns` —
    /// otherwise launcher search and clipboard source-app icons render
    /// the placeholder fallback for every modern macOS app. Drives the
    /// NSWorkspace fallback added alongside this test.
    ///
    /// Strategy: build a fake `.app` bundle with no `.icns` anywhere
    /// (so the fast path returns `None`) and assert `extract_icon`
    /// still returns Some PNG bytes via the AppKit fallback.
    #[cfg(target_os = "macos")]
    #[test]
    fn extract_icon_falls_back_to_nsworkspace_when_icns_missing() {
        use std::fs;

        let tmp =
            std::env::temp_dir().join(format!("asyar_test_no_icns_{}.app", std::process::id(),));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("Contents/Resources")).expect("setup: create fake app bundle");
        // Intentionally NO .icns and NO Info.plist — guarantees the
        // fast path returns None and exercises the fallback.

        let bytes = extract_icon(&tmp);

        let _ = fs::remove_dir_all(&tmp);

        let bytes = bytes.expect("NSWorkspace fallback must yield PNG bytes");
        assert!(!bytes.is_empty(), "PNG payload must be non-empty");
        // PNG magic header: 89 50 4E 47 0D 0A 1A 0A
        assert_eq!(
            &bytes[..8],
            &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
            "fallback output must be a real PNG (got non-PNG header bytes)",
        );
    }
}
