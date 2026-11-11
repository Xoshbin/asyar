#![cfg(target_os = "windows")]

pub mod calendar;
pub mod media;

use std::ffi::{OsStr, OsString};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use windows::core::{Interface, PCWSTR, PWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, BITMAPINFO, BITMAPINFOHEADER,
    DIB_RGB_COLORS,
};
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED, STGM_READ,
};
use windows::Win32::System::Environment::ExpandEnvironmentStringsW;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::{
    IShellLinkW, SHGetFileInfoW, ShellLink, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, GetForegroundWindow, GetIconInfo, GetWindowLongPtrW, GetWindowLongW,
    GetWindowTextW, GetWindowThreadProcessId, PrivateExtractIconsW, SetForegroundWindow,
    SetWindowLongPtrW, SetWindowLongW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE, HICON, ICONINFO,
    SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_LAYERED, WS_EX_TOOLWINDOW,
    WS_POPUP,
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

/// Initialises COM on the current thread for as long as the guard lives.
///
/// Icon extraction runs on pooled tokio workers and the index-watcher thread,
/// none of which are guaranteed to have COM initialised, so `extract_icon`
/// owns its own init/uninit pair. `CoUninitialize` is only balanced against a
/// successful init; `RPC_E_CHANGED_MODE` (thread already in another apartment)
/// is tolerated by simply proceeding without having initialised anything.
struct ComGuard(bool);

impl ComGuard {
    fn new() -> Self {
        // SAFETY: CoInitializeEx has no preconditions beyond being called from
        // the thread it initialises; the result is checked before pairing it
        // with CoUninitialize in Drop.
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        Self(hr.is_ok())
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.0 {
            // SAFETY: balances the successful CoInitializeEx in `new`.
            unsafe { CoUninitialize() };
        }
    }
}

fn wide_to_path(buf: &[u16]) -> PathBuf {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    PathBuf::from(OsString::from_wide(&buf[..len]))
}

/// Resolves where a `.lnk` shortcut's icon comes from: its explicit icon
/// location when set, otherwise its target. Returns `None` when the shortcut
/// cannot be resolved (e.g. advertised MSI shortcuts without a path).
fn resolve_shortcut_icon_source(lnk: &Path) -> Option<(PathBuf, i32)> {
    let wide: Vec<u16> = lnk.as_os_str().encode_wide().chain(Some(0)).collect();

    // SAFETY: COM is initialised by the caller's ComGuard; every buffer passed
    // below is a live, correctly sized stack array.
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let persist: IPersistFile = link.cast().ok()?;
        persist.Load(PCWSTR(wide.as_ptr()), STGM_READ).ok()?;

        let mut icon_buf = [0u16; 260];
        let mut index = 0i32;
        if link.GetIconLocation(&mut icon_buf, &mut index).is_ok() && icon_buf[0] != 0 {
            let mut expanded = [0u16; 520];
            let n = ExpandEnvironmentStringsW(PCWSTR(icon_buf.as_ptr()), Some(&mut expanded));
            let path = if n > 0 && (n as usize) <= expanded.len() {
                wide_to_path(&expanded)
            } else {
                wide_to_path(&icon_buf)
            };
            return Some((path, index));
        }

        let mut target_buf = [0u16; 260];
        link.GetPath(&mut target_buf, std::ptr::null_mut(), 0)
            .ok()?;
        if target_buf[0] == 0 {
            return None;
        }
        Some((wide_to_path(&target_buf), 0))
    }
}

/// Extracts the icon resource at `index` straight from an exe/dll/ico. Unlike
/// `SHGetFileInfoW`, a failure yields no icon rather than the shell's generic
/// placeholder, and no shortcut-arrow overlay is applied.
fn extract_icon_from_resource(path: &Path, index: i32) -> Option<Vec<u8>> {
    let mut wide = [0u16; 260];
    let src: Vec<u16> = path.as_os_str().encode_wide().collect();
    if src.is_empty() || src.len() >= wide.len() {
        return None;
    }
    wide[..src.len()].copy_from_slice(&src);

    let mut icons = [HICON::default(); 1];
    // SAFETY: `wide` is a NUL-terminated buffer and `icons` has room for the
    // single requested icon.
    let n = unsafe { PrivateExtractIconsW(&wide, index, 32, 32, Some(&mut icons), None, 0) };
    if n == 0 || n == u32::MAX || icons[0].is_invalid() {
        return None;
    }
    hicon_to_png(icons[0])
}

/// Extracts a PNG icon from a Windows executable or shortcut.
///
/// For `.lnk` files the icon is taken from the shortcut's real source (icon
/// location or target) so a target that is momentarily missing (a Scoop/winget
/// update swapping directories) yields `None` — a retryable miss — instead of
/// the shell's generic shortcut icon, which would otherwise be cached forever.
pub fn extract_icon(path: &Path) -> Option<Vec<u8>> {
    let _com = ComGuard::new();

    let is_lnk = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("lnk"));
    if is_lnk {
        if let Some((source, index)) = resolve_shortcut_icon_source(path) {
            if !source.exists() {
                return None;
            }
            if let Some(png) = extract_icon_from_resource(&source, index) {
                return Some(png);
            }
        }
    }

    shell_file_icon(path)
}

/// Icon the shell associates with `path` (exe resource, or a shortcut's
/// overlaid icon). Last-resort path; may return the generic placeholder.
fn shell_file_icon(path: &Path) -> Option<Vec<u8>> {
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
    hicon_to_png(hicon)
}

/// Renders an HICON to a 32px RGBA PNG and destroys the handle.
fn hicon_to_png(hicon: HICON) -> Option<Vec<u8>> {
    let mut icon_info = ICONINFO::default();
    let got_info = unsafe { GetIconInfo(hicon, &mut icon_info) };

    if got_info.is_err() {
        unsafe {
            let _ = DestroyIcon(hicon);
        }
        return None;
    }

    let size: i32 = 32;
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
            png::Encoder::new(std::io::Cursor::new(&mut buf), size as u32, size as u32);
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

    /// Writes a `.lnk` at `lnk` pointing at `target` via IShellLinkW.
    fn make_shortcut(lnk: &Path, target: &Path) {
        let _com = ComGuard::new();
        let wide = |p: &Path| -> Vec<u16> { p.as_os_str().encode_wide().chain(Some(0)).collect() };
        // SAFETY: COM is initialised by `_com`; all pointers outlive the calls.
        unsafe {
            let link: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).unwrap();
            link.SetPath(PCWSTR(wide(target).as_ptr())).unwrap();
            let persist: IPersistFile = link.cast().unwrap();
            persist.Save(PCWSTR(wide(lnk).as_ptr()), true).unwrap();
        }
    }

    #[test]
    #[ignore = "needs a Windows desktop session with shell32 icon resources"]
    fn lnk_icon_comes_from_target_and_missing_target_is_none() {
        let tmp = tempfile::tempdir().unwrap();

        let lnk = tmp.path().join("notepad.lnk");
        make_shortcut(&lnk, Path::new(r"C:\Windows\System32\notepad.exe"));
        let png = extract_icon(&lnk).expect("icon for shortcut with a valid target");
        assert!(png.starts_with(b"\x89PNG"));

        let gone = tmp.path().join("gone.lnk");
        make_shortcut(&gone, &tmp.path().join("missing").join("app.exe"));
        assert!(
            extract_icon(&gone).is_none(),
            "a missing target must be a retryable miss, not a generic icon"
        );
    }
}
