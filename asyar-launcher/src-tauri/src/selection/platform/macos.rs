use crate::selection::error::SelectionError;
use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_app_kit::{
    NSPasteboard, NSPasteboardItem, NSPasteboardWriting, NSRunningApplication, NSWorkspace,
};
use objc2_foundation::{NSArray, NSData, NSString};
use std::ffi::{c_void, CStr};
use std::process::Command;
use std::sync::atomic::{AtomicI32, Ordering};

/// Pid of the most recent non-Asyar application to become frontmost, fed by
/// the existing `NSWorkspaceDidActivateApplication` observer
/// (`app_events/macos.rs`). The launcher is revealed without touching this, so
/// the reveal path pays nothing; the selection service reads it only when the
/// launcher itself has focus.
static LAST_EXTERNAL_FRONTMOST_PID: AtomicI32 = AtomicI32::new(0);

/// Records an app-activation. Ignores Asyar's own activations so the value
/// always names the app the user was in before opening the launcher.
pub fn note_frontmost_activated(pid: i32) {
    if pid > 0 && pid != std::process::id() as i32 {
        LAST_EXTERNAL_FRONTMOST_PID.store(pid, Ordering::Relaxed);
    }
}

/// The application whose selection should be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectionTarget {
    pub pid: i32,
    pub bundle_id: Option<String>,
}

/// Pure decision: prefer the live frontmost app unless it is Asyar itself, in
/// which case fall back to the remembered external app.
fn pick_target_pid(frontmost: Option<i32>, remembered: i32, self_pid: i32) -> Option<i32> {
    match frontmost {
        Some(pid) if pid > 0 && pid != self_pid => Some(pid),
        _ if remembered > 0 && remembered != self_pid => Some(remembered),
        _ => None,
    }
}

/// Resolves the app to read from, or `None` when the launcher is focused and
/// no external app is known (or the remembered one has quit).
pub fn resolve_selection_target() -> Option<SelectionTarget> {
    unsafe {
        let ws = NSWorkspace::sharedWorkspace();
        let front = ws.frontmostApplication().map(|a| a.processIdentifier());
        let pid = pick_target_pid(
            front,
            LAST_EXTERNAL_FRONTMOST_PID.load(Ordering::Relaxed),
            std::process::id() as i32,
        )?;
        let app = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)?;
        if app.isTerminated() {
            return None;
        }
        Some(SelectionTarget {
            pid,
            bundle_id: app.bundleIdentifier().map(|b| b.to_string()),
        })
    }
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> *mut c_void;
    fn AXUIElementSetAttributeValue(
        element: *mut c_void,
        attribute: *mut c_void, // CFStringRef
        value: *mut c_void,     // CFTypeRef
    ) -> i32; // AXError
    static kCFBooleanTrue: *mut c_void;
    fn AXUIElementCopyAttributeValue(
        element: *mut c_void,
        attribute: *mut c_void,  // CFStringRef
        value: *mut *mut c_void, // CFTypeRef out
    ) -> i32; // AXError
    fn CFRelease(cf: *mut c_void);
    fn CFRetain(cf: *mut c_void) -> *mut c_void;
    fn CFArrayGetCount(array: *mut c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *mut c_void, idx: isize) -> *const c_void;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringGetCStringPtr(s: *mut c_void, encoding: u32) -> *const i8;
    fn CFStringGetLength(s: *mut c_void) -> isize;
    fn CFStringGetCString(s: *mut c_void, buf: *mut i8, buf_size: isize, encoding: u32) -> bool;
}

const K_CF_STRING_ENCODING_UTF8: u32 = 0x08000100;

unsafe fn cf_string_to_rust(cf: *mut c_void) -> Option<String> {
    if cf.is_null() {
        return None;
    }

    let ptr = CFStringGetCStringPtr(cf, K_CF_STRING_ENCODING_UTF8);
    if !ptr.is_null() {
        return Some(CStr::from_ptr(ptr).to_string_lossy().into_owned());
    }

    let len = CFStringGetLength(cf);
    if len <= 0 {
        return Some(String::new());
    }

    let mut buf = vec![0u8; (len * 4 + 1) as usize];
    if CFStringGetCString(
        cf,
        buf.as_mut_ptr() as *mut i8,
        buf.len() as isize,
        K_CF_STRING_ENCODING_UTF8,
    ) {
        return Some(
            CStr::from_ptr(buf.as_ptr() as *const i8)
                .to_string_lossy()
                .into_owned(),
        );
    }
    None
}

/// Copies an AX attribute; the caller owns (must `CFRelease`) the result.
unsafe fn ax_copy(element: *mut c_void, name: &str) -> Result<*mut c_void, i32> {
    let ns = NSString::from_str(name);
    let mut out: *mut c_void = std::ptr::null_mut();
    let err =
        AXUIElementCopyAttributeValue(element, Retained::as_ptr(&ns) as *mut c_void, &mut out);
    if err != 0 || out.is_null() {
        Err(if err != 0 { err } else { -1 })
    } else {
        Ok(out)
    }
}

unsafe fn ax_selected_text(element: *mut c_void) -> Option<String> {
    let v = ax_copy(element, "AXSelectedText").ok()?;
    let s = cf_string_to_rust(v);
    CFRelease(v);
    s.filter(|t| !t.is_empty())
}

/// Upper bound on elements inspected by the tree walk, and its time budget.
const AX_WALK_MAX_NODES: usize = 1500;
const AX_WALK_BUDGET: std::time::Duration = std::time::Duration::from_millis(250);

/// Breadth-first search of `roots` (consumed) for the first element exposing a
/// non-empty `AXSelectedText`. An inactive app has no `AXFocusedUIElement`
/// (error `kAXErrorNoValue`), but its windows' elements still answer
/// `AXSelectedText`, so this recovers the selection without activating it.
unsafe fn walk_for_selection(roots: Vec<*mut c_void>) -> Option<String> {
    let deadline = std::time::Instant::now() + AX_WALK_BUDGET;
    let mut queue: std::collections::VecDeque<*mut c_void> = roots.into();
    let mut visited = 0usize;
    let mut found = None;
    while let Some(el) = queue.pop_front() {
        if found.is_none() && visited < AX_WALK_MAX_NODES && std::time::Instant::now() < deadline {
            visited += 1;
            found = ax_selected_text(el);
            if found.is_none() {
                if let Ok(children) = ax_copy(el, "AXChildren") {
                    let n = CFArrayGetCount(children);
                    for i in 0..n {
                        let child = CFArrayGetValueAtIndex(children, i) as *mut c_void;
                        if !child.is_null() {
                            CFRetain(child);
                            queue.push_back(child);
                        }
                    }
                    CFRelease(children);
                }
            }
        }
        CFRelease(el);
    }
    found
}

pub fn get_selected_text_via_a11y(pid: i32) -> Option<String> {
    unsafe {
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() {
            return None;
        }

        // Chromium/Electron apps only build their accessibility tree on
        // request; this is the documented opt-in and is harmless for native
        // apps (they return an error we ignore).
        let manual_ns = NSString::from_str("AXManualAccessibility");
        let _ = AXUIElementSetAttributeValue(
            app,
            Retained::as_ptr(&manual_ns) as *mut c_void,
            kCFBooleanTrue,
        );
        drop(manual_ns);

        // Fast path: the app's own focused element.
        match ax_copy(app, "AXFocusedUIElement") {
            Ok(focused) => {
                let text = ax_selected_text(focused);
                CFRelease(focused);
                if text.is_some() {
                    CFRelease(app);
                    return text;
                }
            }
            Err(e) => {
                log::info!("[selection] AX focused element unavailable for pid {pid} (AXError {e}); walking windows");
            }
        }

        // The app is not key (the launcher is), so search its windows.
        let mut roots = Vec::new();
        for attr in ["AXFocusedWindow", "AXMainWindow"] {
            if let Ok(w) = ax_copy(app, attr) {
                roots.push(w);
            }
        }
        if let Ok(windows) = ax_copy(app, "AXWindows") {
            for i in 0..CFArrayGetCount(windows) {
                let w = CFArrayGetValueAtIndex(windows, i) as *mut c_void;
                if !w.is_null() {
                    CFRetain(w);
                    roots.push(w);
                }
            }
            CFRelease(windows);
        }
        CFRelease(app);
        if roots.is_empty() {
            log::info!("[selection] AX exposes no windows for pid {pid}");
            return None;
        }
        let found = walk_for_selection(roots);
        if found.is_none() {
            log::info!("[selection] AX window walk found no selected text for pid {pid}");
        }
        found
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
    let target = resolve_selection_target().ok_or(SelectionError::LauncherFocused)?;
    if target.bundle_id.as_deref() != Some("com.apple.finder") {
        return Ok(vec![]);
    }

    let out = Command::new("osascript")
        .arg("-e")
        .arg(FINDER_SCRIPT)
        .output()
        .map_err(|e| SelectionError::OperationFailed(e.to_string()))?;

    if !out.status.success() {
        return Ok(vec![]);
    }

    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text
        .lines()
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect())
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
            Self {
                items: items_snapshot,
            }
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
                let protocol_items: &NSArray<ProtocolObject<dyn NSPasteboardWriting>> =
                    std::mem::transmute(&*ns_pb_items);
                let _ = pb.writeObjects(protocol_items);
            }
        }
    }
}

#[cfg(test)]
mod target_tests {
    use super::pick_target_pid;

    #[test]
    fn uses_live_frontmost_when_not_self() {
        assert_eq!(pick_target_pid(Some(10), 20, 99), Some(10));
    }

    #[test]
    fn falls_back_to_remembered_when_self_is_frontmost() {
        assert_eq!(pick_target_pid(Some(99), 20, 99), Some(20));
        assert_eq!(pick_target_pid(None, 20, 99), Some(20));
    }

    #[test]
    fn none_when_nothing_known() {
        assert_eq!(pick_target_pid(Some(99), 0, 99), None);
        assert_eq!(pick_target_pid(Some(99), 99, 99), None);
    }
}
