use std::ffi::{c_void, CStr};
use std::process::Command;
use crate::selection::error::SelectionError;
use objc2_foundation::{NSString, NSArray, NSData};
use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSWorkspace, NSRunningApplication, NSPasteboardWriting};

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateSystemWide() -> *mut c_void;
    fn AXUIElementCopyAttributeValue(
        element: *mut c_void,
        attribute: *mut c_void, // CFStringRef
        value: *mut *mut c_void, // CFTypeRef out
    ) -> i32; // AXError
    fn CFRelease(cf: *mut c_void);
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringGetCStringPtr(s: *mut c_void, encoding: u32) -> *const i8;
    fn CFStringGetLength(s: *mut c_void) -> isize;
    fn CFStringGetCString(s: *mut c_void, buf: *mut i8, buf_size: isize, encoding: u32) -> bool;
}

const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;

unsafe fn cf_string_to_rust(cf: *mut c_void) -> Option<String> {
    if cf.is_null() { return None; }
    
    let ptr = CFStringGetCStringPtr(cf, K_CF_STRING_ENCODING_UTF8);
    if !ptr.is_null() {
        return Some(CStr::from_ptr(ptr).to_string_lossy().into_owned());
    }

    let len = CFStringGetLength(cf);
    if len <= 0 { return Some(String::new()); }

    let mut buf = vec![0u8; (len * 4 + 1) as usize];
    if CFStringGetCString(cf, buf.as_mut_ptr() as *mut i8, buf.len() as isize, K_CF_STRING_ENCODING_UTF8) {
        return Some(CStr::from_ptr(buf.as_ptr() as *const i8).to_string_lossy().into_owned());
    }
    None
}


pub fn get_selected_text_via_a11y() -> Option<String> {
    unsafe {
        let system_wide = AXUIElementCreateSystemWide();
        if system_wide.is_null() { return None; }

        // Hold Retained values alive until AFTER the AX call that uses them.
        let focused_attr_ns = NSString::from_str("AXFocusedUIElement");
        let focused_attr: *mut c_void = Retained::as_ptr(&focused_attr_ns) as *mut c_void;
        let mut focused: *mut c_void = std::ptr::null_mut();
        let err = AXUIElementCopyAttributeValue(system_wide, focused_attr, &mut focused);
        CFRelease(system_wide);
        drop(focused_attr_ns);           // safe: AX call is already done
        if err != 0 || focused.is_null() { return None; }

        let text_attr_ns = NSString::from_str("AXSelectedText");
        let text_attr: *mut c_void = Retained::as_ptr(&text_attr_ns) as *mut c_void;
        let mut text_val: *mut c_void = std::ptr::null_mut();
        let err2 = AXUIElementCopyAttributeValue(focused, text_attr, &mut text_val);
        CFRelease(focused);
        drop(text_attr_ns);              // safe: AX call is already done
        if err2 != 0 || text_val.is_null() { return None; }

        let result = cf_string_to_rust(text_val);
        CFRelease(text_val);
        result
    }
}

pub fn is_accessibility_trusted() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    unsafe { AXIsProcessTrusted() }
}

pub fn open_accessibility_prefs() {
    let _ = Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn();
}

pub fn clipboard_change_marker() -> i64 {
    unsafe {
        let pb = NSPasteboard::generalPasteboard();
        pb.changeCount() as i64
    }
}

const FINDER_SCRIPT: &str = r#"
    tell application "Finder"
        set sel to selection
        if (count of sel) is 0 then return ""
        set out to ""
        repeat with f in sel
            set out to out & (POSIX path of (f as alias)) & linefeed
        end repeat
        return out
    end tell
"#;

pub fn get_selected_finder_items() -> Result<Vec<String>, SelectionError> {
    if !frontmost_app_is_finder() {
        return Ok(vec![]); 
    }

    let out = Command::new("osascript")
        .arg("-e").arg(FINDER_SCRIPT)
        .output()
        .map_err(|e| SelectionError::OperationFailed(e.to_string()))?;

    if !out.status.success() { return Ok(vec![]); }
    
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text.lines().filter(|l| !l.is_empty()).map(String::from).collect())
}

fn frontmost_app_is_finder() -> bool {
    unsafe {
        let ws = NSWorkspace::sharedWorkspace();
        let app: Option<Retained<NSRunningApplication>> = ws.frontmostApplication();
        if let Some(app) = app {
            let bid: Option<Retained<NSString>> = app.bundleIdentifier();
            if let Some(bid) = bid {
                return bid.to_string() == "com.apple.finder";
            }
        }
        false
    }
}

pub struct ClipboardGuard {
    items: Vec<Vec<(String, Vec<u8>)>>,
}

impl Default for ClipboardGuard {
    fn default() -> Self {
        Self::new()
    }
}

impl ClipboardGuard {
    pub fn new() -> Self {
        unsafe {
            let pb = NSPasteboard::generalPasteboard();
            let mut items_snapshot = Vec::new();

            if let Some(pb_items) = pb.pasteboardItems() {
                for item in pb_items {
                    let mut data_pairs = Vec::new();
                    let types: Retained<NSArray<NSString>> = item.types();
                    for t in types {
                        let t: Retained<NSString> = t;
                        if let Some(data) = item.dataForType(&t) {
                            let rust_data = data.bytes().to_vec();
                            data_pairs.push((t.to_string(), rust_data));
                        }
                    }
                    items_snapshot.push(data_pairs);
                }
            }
            Self { items: items_snapshot }
        }
    }
}

impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            let pb = NSPasteboard::generalPasteboard();
            pb.clearContents();
            
            let mut pb_items = Vec::new();
            for item_snapshot in &self.items {
                let pb_item = NSPasteboardItem::new();
                for (type_str, data_bytes) in item_snapshot {
                    let ns_type = NSString::from_str(type_str);
                    let ns_data = NSData::from_vec(data_bytes.clone());
                    let _ = pb_item.setData_forType(&ns_data, &ns_type);
                }
                pb_items.push(pb_item);
            }
            
            if !pb_items.is_empty() {
                let ns_pb_items = NSArray::from_id_slice(&pb_items);
                // Safe to transmute because NSPasteboardItem implements NSPasteboardWriting
                let protocol_items: &NSArray<ProtocolObject<dyn NSPasteboardWriting>> = std::mem::transmute(&*ns_pb_items);
                let _ = pb.writeObjects(protocol_items);
            }
        }
    }
}
