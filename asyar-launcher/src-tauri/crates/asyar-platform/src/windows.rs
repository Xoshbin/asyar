#![cfg(target_os = "windows")]

pub mod calendar;
pub mod media;

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
    BITMAPINFOHEADER, DIB_RGB_COLORS,
};
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, GetForegroundWindow, GetIconInfo, GetWindowLongPtrW, GetWindowLongW,
    GetWindowTextW, GetWindowThreadProcessId, SetForegroundWindow, SetWindowLongPtrW,
    SetWindowLongW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE, ICONINFO, SWP_FRAMECHANGED, SWP_NOMOVE,
    SWP_NOSIZE, SWP_NOZORDER, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_POPUP,
};

/// Configures a window handle with Windows-specific Spotlight styling: DWM polish
/// (system backdrop + rounded corners) plus taskbar/Alt+Tab exclusion.
pub fn setup_spotlight_window(hwnd: HWND) {
    apply_dwm_polish(hwnd);
    apply_taskbar_exclusion(hwnd);
}

/// Prepares a window for native Win32 polish: DWM-painted system
/// backdrop and DWM-rounded corners on Windows 11.
pub fn apply_dwm_polish(hwnd: HWND) {
    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style & !(WS_EX_LAYERED.0 as isize));

        let style = GetWindowLongW(hwnd, GWL_STYLE);
        SetWindowLongW(hwnd, GWL_STYLE, style | WS_POPUP.0 as i32);

        let corner_pref = DWMWCP_ROUND;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &corner_pref as *const _ as *const _,
            std::mem::size_of_val(&corner_pref) as u32,
        );

        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        );
    }
}

/// Adds `WS_EX_TOOLWINDOW` so the window is excluded from the taskbar and Alt+Tab.
pub fn apply_taskbar_exclusion(hwnd: HWND) {
    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_TOOLWINDOW.0 as isize);
    }
}

/// Captures the currently active foreground window handle.
pub fn capture_foreground_window() -> isize {
    unsafe { GetForegroundWindow().0 as isize }
}

/// Restores focus to a previously captured foreground window.
pub fn restore_foreground_window(hwnd: isize) {
    if hwnd == 0 {
        return;
    }
    unsafe {
        let _ = SetForegroundWindow(HWND(hwnd as *mut _));
    }
}

/// Validates positive icon bitmap dimensions within a safe ceiling (max 1024px per side).
fn icon_bitmap_dimensions(width: i32, height: i32) -> Option<(i32, i32)> {
    const MAX_ICON_SIDE: i32 = 1024;
    if width <= 0 || height <= 0 || width > MAX_ICON_SIDE || height > MAX_ICON_SIDE {
        return None;
    }
    Some((width, height))
}

/// Extracts a high-resolution PNG icon from a Windows executable or shortcut.
pub fn extract_icon(path: &Path) -> Option<Vec<u8>> {
    let exe_path = path.to_str()?;

    let wide_path: Vec<u16> = OsStr::new(exe_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut file_info = SHFILEINFOW::default();

    let result = unsafe {
        SHGetFileInfoW(
            PCWSTR(wide_path.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut file_info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };

    if result == 0 {
        return None;
    }

    let hicon = file_info.hIcon;
    if hicon.is_invalid() {
        return None;
    }

    let mut icon_info = ICONINFO::default();
    let got_info = unsafe { GetIconInfo(hicon, &mut icon_info) };

    if got_info.is_err() {
        unsafe {
            let _ = DestroyIcon(hicon);
        }
        return None;
    }

    // Query the icon bitmap's native DPI-scaled dimensions instead of hardcoding 32x32,
    // which otherwise crops HiDPI Windows 11 icons (40x40, 48x48, 64x64) to their top-left corner.
    let mut bmp = BITMAP::default();
    let (width, height) = if !icon_info.hbmColor.is_invalid()
        && unsafe {
            GetObjectW(
                icon_info.hbmColor.into(),
                std::mem::size_of::<BITMAP>() as i32,
                Some(&mut bmp as *mut BITMAP as *mut _),
            )
        } > 0
    {
        icon_bitmap_dimensions(bmp.bmWidth, bmp.bmHeight).unwrap_or((32, 32))
    } else {
        (32, 32)
    };

    let pixel_bytes = (width as usize)
        .checked_mul(height as usize)
        .and_then(|px| px.checked_mul(4))?;

    let dc = unsafe { CreateCompatibleDC(None) };

    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [Default::default()],
    };

    let mut pixels: Vec<u8> = vec![0u8; pixel_bytes];

    // hbmColor must NOT be selected into the DC when calling GetDIBits.
    let rows = unsafe {
        GetDIBits(
            dc,
            icon_info.hbmColor,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        )
    };

    unsafe {
        let _ = DeleteDC(dc);
        if !icon_info.hbmColor.is_invalid() {
            let _ = DeleteObject(icon_info.hbmColor.into());
        }
        if !icon_info.hbmMask.is_invalid() {
            let _ = DeleteObject(icon_info.hbmMask.into());
        }
        let _ = DestroyIcon(hicon);
    }

    if rows == 0 {
        return None;
    }

    // Convert BGRA to RGBA
    for chunk in pixels.chunks_exact_mut(4) {
        chunk.swap(0, 2);
    }

    let all_transparent = pixels.chunks_exact(4).all(|c| c[3] == 0);
    if all_transparent {
        for chunk in pixels.chunks_exact_mut(4) {
            if chunk[0] != 0 || chunk[1] != 0 || chunk[2] != 0 {
                chunk[3] = 255;
            }
        }
    }

    let mut buf = Vec::new();
    {
        let mut encoder =
            png::Encoder::new(std::io::Cursor::new(&mut buf), width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(&pixels).ok()?;
    }

    if buf.is_empty() {
        None
    } else {
        Some(buf)
    }
}

/// Retrieves metadata about the current foreground window.
pub fn get_frontmost_application_metadata() -> Option<(String, String, String)> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return None;
        }

        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        let process_handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut path_buf = [0u16; 1024];
        let mut path_len = path_buf.len() as u32;
        let _ = QueryFullProcessImageNameW(
            process_handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(path_buf.as_mut_ptr()),
            &mut path_len,
        );
        let _ = windows::Win32::Foundation::CloseHandle(process_handle);
        let path = String::from_utf16_lossy(&path_buf[..path_len as usize]);

        let name = Path::new(&path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string();

        Some((name, path, title))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_bitmap_dimensions_accepts_hidpi_sizes_and_rejects_invalid() {
        assert_eq!(icon_bitmap_dimensions(32, 32), Some((32, 32)));
        assert_eq!(icon_bitmap_dimensions(48, 48), Some((48, 48)));
        assert_eq!(icon_bitmap_dimensions(64, 64), Some((64, 64)));
        assert_eq!(icon_bitmap_dimensions(0, 32), None);
        assert_eq!(icon_bitmap_dimensions(-16, 32), None);
    }
}
