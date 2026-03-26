use std::path::Path;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use tauri::{Runtime, WebviewWindow};
use windows::core::PCWSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS,
};
use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, GetIconInfo, GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TOOLWINDOW, WS_EX_LAYERED,
    GetWindowLongW, SetWindowLongW, GWL_STYLE, WS_POPUP, SetWindowPos,
    SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    GetForegroundWindow, SetForegroundWindow, ICONINFO,
};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
};
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;

/// Configures a window with Windows-specific Spotlight styling (no taskbar, rounded corners).
pub fn setup_spotlight_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    let hwnd = window.hwnd()?;
    apply_spotlight_style(hwnd);
    Ok(())
}

/// Applies spotlight visual styles to a Windows HWND.
pub fn apply_spotlight_style(hwnd: HWND) {
    // SAFETY: hwnd is a valid window handle obtained from Tauri's platform handle.
    // All Win32 calls operate on this handle with well-defined inputs and no aliasing.
    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        
        // Remove WS_EX_LAYERED to allow DWM to apply rounded corners
        let new_style = (ex_style & !(WS_EX_LAYERED.0 as isize)) | WS_EX_TOOLWINDOW.0 as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);

        // Add WS_POPUP to standard style for better DWM cooperation
        let style = GetWindowLongW(hwnd, GWL_STYLE);
        SetWindowLongW(hwnd, GWL_STYLE, style | WS_POPUP.0 as i32);

        let corner_pref = DWMWCP_ROUND;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &corner_pref as *const _ as *const _,
            std::mem::size_of_val(&corner_pref) as u32,
        );

        // Force DWM to recalculate the window frame
        let _ = SetWindowPos(
            hwnd,
            None,
            0, 0, 0, 0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        );
    }
}

/// Captures the currently active foreground window handle.
pub fn capture_foreground_window() -> isize {
    // SAFETY: GetForegroundWindow() has no preconditions; it queries the OS for
    // the current foreground window and always returns a valid or null HWND.
    unsafe { GetForegroundWindow().0 as isize }
}

/// Restores focus to a previously captured foreground window.
pub fn restore_foreground_window(hwnd: isize) {
    if hwnd == 0 { return; }
    // SAFETY: hwnd was previously returned by GetForegroundWindow() and has not
    // been destroyed (the launcher was just shown/hidden, not the target window).
    unsafe { 
        let _ = SetForegroundWindow(HWND(hwnd as *mut _)); 
    }
}

/// Extracts a high-resolution PNG icon from a Windows executable or shortcut.
pub fn extract_icon(path: &Path) -> Option<Vec<u8>> {
    let exe_path = path.to_str()?;
    
    // Convert path to null-terminated wide string
    let wide_path: Vec<u16> = OsStr::new(exe_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut file_info = SHFILEINFOW::default();

    // SAFETY: wide_path is a valid null-terminated UTF-16 string; SHGetFileInfoW
    // writes into file_info which is properly initialized and sized.
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

    // SAFETY: hicon is a valid HICON returned by SHGetFileInfoW.
    let mut icon_info = ICONINFO::default();
    let got_info = unsafe { GetIconInfo(hicon, &mut icon_info) };

    if got_info.is_err() {
        unsafe { let _ = DestroyIcon(hicon); }
        return None;
    }

    let size: i32 = 32;

    // SAFETY: CreateCompatibleDC(None) creates a memory DC compatible with the screen.
    let dc = unsafe { CreateCompatibleDC(None) };

    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size,
            biHeight: -size, // top-down
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

    let mut pixels: Vec<u8> = vec![0u8; (size * size * 4) as usize];

    // SAFETY: dc and icon_info.hbmColor are valid GDI handles.
    let old_obj = unsafe { SelectObject(dc, icon_info.hbmColor.into()) };

    // SAFETY: GetDIBits reads the bitmap pixels into the provided buffer.
    let rows = unsafe {
        GetDIBits(
            dc,
            icon_info.hbmColor,
            0,
            size as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        )
    };

    // SAFETY: Cleaning up all allocated GDI resources and the original icon handle.
    unsafe {
        SelectObject(dc, old_obj);
        DeleteDC(dc);
        if !icon_info.hbmColor.is_invalid() { let _ = DeleteObject(icon_info.hbmColor.into()); }
        if !icon_info.hbmMask.is_invalid()  { let _ = DeleteObject(icon_info.hbmMask.into());  }
        let _ = DestroyIcon(hicon);
    }

    if rows == 0 {
        return None;
    }

    // Convert BGRA to RGBA
    for chunk in pixels.chunks_exact_mut(4) {
        chunk.swap(0, 2);
    }

    // Handle mask transparency if alpha is missing
    let all_transparent = pixels.chunks_exact(4).all(|c| c[3] == 0);
    if all_transparent {
        for chunk in pixels.chunks_exact_mut(4) {
            if chunk[0] != 0 || chunk[1] != 0 || chunk[2] != 0 {
                chunk[3] = 255;
            }
        }
    }

    // Encode as PNG
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut buf), size as u32, size as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(&pixels).ok()?;
    }

    if buf.is_empty() { None } else { Some(buf) }
}
