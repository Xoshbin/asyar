//! Windows eyedropper: low-level mouse + keyboard hooks on a dedicated
//! message-pump thread. The next left-click is swallowed and its screen
//! pixel sampled via `GetDC(None)` + `GetPixel`; Esc cancels. v1 has no
//! magnifier overlay — a loupe window can be layered on later without
//! changing this pick mechanic.

use crate::color_sampler::PickedColor;
use crate::error::AppError;
use ::windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use ::windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC, CLR_INVALID};
use ::windows::Win32::UI::Input::KeyboardAndMouse::VK_ESCAPE;
use ::windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, PostQuitMessage, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT, WH_KEYBOARD_LL,
    WH_MOUSE_LL, WM_KEYDOWN, WM_LBUTTONDOWN, WM_SYSKEYDOWN,
};
use std::cell::Cell;
use std::sync::atomic::{AtomicBool, Ordering};

static PICK_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

thread_local! {
    // LL hook procs run on the thread that installed them (inside its
    // message pump), so a thread_local is enough to hand back the click.
    static PICKED_POINT: Cell<Option<(i32, i32)>> = const { Cell::new(None) };
}

unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && wparam.0 as u32 == WM_LBUTTONDOWN {
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        PICKED_POINT.with(|p| p.set(Some((info.pt.x, info.pt.y))));
        PostQuitMessage(0);
        // Non-zero swallows the click so the app under the cursor never sees it.
        return LRESULT(1);
    }
    CallNextHookEx(None, code, wparam, lparam)
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && (wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN) {
        let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        if info.vkCode == VK_ESCAPE.0 as u32 {
            PostQuitMessage(0);
            return LRESULT(1);
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

pub fn pick_color_blocking() -> Result<Option<PickedColor>, AppError> {
    if PICK_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return Err(AppError::Platform(
            "a screen color pick is already in progress".into(),
        ));
    }
    let result = run_pick_loop();
    PICK_IN_PROGRESS.store(false, Ordering::SeqCst);
    result
}

fn run_pick_loop() -> Result<Option<PickedColor>, AppError> {
    PICKED_POINT.with(|p| p.set(None));

    let mouse = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), None, 0) }
        .map_err(|e| AppError::Platform(format!("failed to install mouse hook: {e}")))?;
    let keyboard = match unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), None, 0) }
    {
        Ok(h) => h,
        Err(e) => {
            let _ = unsafe { UnhookWindowsHookEx(mouse) };
            return Err(AppError::Platform(format!(
                "failed to install keyboard hook: {e}"
            )));
        }
    };

    unsafe {
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).into() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        let _ = UnhookWindowsHookEx(mouse);
        let _ = UnhookWindowsHookEx(keyboard);
    }

    match PICKED_POINT.with(|p| p.take()) {
        Some((x, y)) => sample_pixel(x, y).map(Some),
        None => Ok(None), // Esc — user cancelled
    }
}

fn sample_pixel(x: i32, y: i32) -> Result<PickedColor, AppError> {
    unsafe {
        let hdc = GetDC(None);
        if hdc.is_invalid() {
            return Err(AppError::Platform("GetDC(screen) failed".into()));
        }
        let color = GetPixel(hdc, x, y);
        ReleaseDC(None, hdc);
        if color.0 == CLR_INVALID {
            return Err(AppError::Platform(format!("GetPixel failed at ({x}, {y})")));
        }
        Ok(PickedColor::from_colorref(color.0))
    }
}
