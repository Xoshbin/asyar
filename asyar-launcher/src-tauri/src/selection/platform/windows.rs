use crate::selection::error::SelectionError;

use windows::core::Interface;
use windows::Win32::System::Com::*;
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Accessibility::*;
use windows::Win32::UI::Shell::*;

pub fn get_selected_text_via_a11y() -> Option<String> {
    unsafe {
        // CoInitialize on this thread (STA) — needed for COM
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;

        let focused = automation.GetFocusedElement().ok()?;

        // Attempt TextPattern — many controls support this
        let pattern_raw = focused.GetCurrentPattern(UIA_TextPatternId).ok()?;
        let text_pattern: IUIAutomationTextPattern = pattern_raw.cast().ok()?;

        let ranges = text_pattern.GetSelection().ok()?;
        if ranges.Length().ok()? == 0 {
            return None;
        }

        let range = ranges.GetElement(0).ok()?;
        let text = range.GetText(-1).ok()?; // -1 = all text in range
        let s = text.to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }
}

pub fn is_accessibility_trusted() -> bool {
    true // Not directly applicable the same way as macOS
}

pub fn open_accessibility_prefs() {
    // No-op
}

pub fn clipboard_change_marker() -> u32 {
    #[link(name = "user32")]
    extern "system" {
        fn GetClipboardSequenceNumber() -> u32;
    }
    unsafe { GetClipboardSequenceNumber() }
}

pub fn get_selected_finder_items(target_hwnd: isize) -> Result<Vec<String>, SelectionError> {
    if target_hwnd == 0 {
        return Ok(vec![]);
    }

    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let shell_windows: IShellWindows =
            CoCreateInstance(&ShellWindows, None, CLSCTX_LOCAL_SERVER).map_err(
                |e: windows::core::Error| SelectionError::OperationFailed(e.to_string()),
            )?;

        let count = shell_windows
            .Count()
            .map_err(|e: windows::core::Error| SelectionError::OperationFailed(e.to_string()))?;

        for i in 0..count {
            let item = match shell_windows.Item(&VARIANT::from(i)) {
                Ok(it) => it,
                Err(_) => continue,
            };

            // Get IWebBrowserApp to check HWND
            let browser: IWebBrowserApp = match item.cast() {
                Ok(b) => b,
                Err(_) => continue,
            };
            let hwnd_raw = match browser.HWND() {
                Ok(h) => h,
                Err(_) => continue,
            };
            if hwnd_raw.0 as isize != target_hwnd {
                continue;
            }

            // Get the document (IShellFolderViewDual2)
            let doc = browser.Document().map_err(|e: windows::core::Error| {
                SelectionError::OperationFailed(e.to_string())
            })?;
            let folder_view: IShellFolderViewDual2 =
                doc.cast().map_err(|e: windows::core::Error| {
                    SelectionError::OperationFailed(e.to_string())
                })?;

            let selected = folder_view
                .SelectedItems()
                .map_err(|e: windows::core::Error| {
                    SelectionError::OperationFailed(e.to_string())
                })?;

            let count2 = selected.Count().map_err(|e: windows::core::Error| {
                SelectionError::OperationFailed(e.to_string())
            })?;
            let mut paths = Vec::new();
            for j in 0..count2 {
                let fi: FolderItem = match selected.Item(&VARIANT::from(j)) {
                    Ok(it) => it,
                    Err(_) => continue,
                };
                if let Ok(path) = fi.Path() {
                    paths.push(path.to_string());
                }
            }
            return Ok(paths);
        }
        Ok(vec![])
    }
}
pub use super::arboard_guard::{ClipboardGuard, ClipboardSnapshot};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_windows_clipboard_guard_type_exports() {
        let empty = ClipboardSnapshot::Empty;
        let guard = ClipboardGuard::from_snapshot(empty.clone());
        assert_eq!(guard.snapshot(), &empty);

        let text = ClipboardSnapshot::Text("windows_selection_test".to_string());
        let guard_text = ClipboardGuard::from_snapshot(text.clone());
        assert_eq!(guard_text.snapshot(), &text);
    }
}
