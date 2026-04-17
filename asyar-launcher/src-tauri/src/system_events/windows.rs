//! Windows system-events watcher.
//!
//! The watcher owns a dedicated thread running a hidden message-only window
//! with a Win32 message pump. It registers for four power-setting GUIDs via
//! `RegisterPowerSettingNotification` and handles `WM_POWERBROADCAST` in its
//! window procedure:
//!
//! - `PBT_APMSUSPEND` → [`SystemEvent::Sleep`]
//! - `PBT_APMRESUMEAUTOMATIC` / `PBT_APMRESUMESUSPEND` → [`SystemEvent::Wake`]
//! - `GUID_ACDC_POWER_SOURCE` → [`SystemEvent::PowerSourceChanged`]
//!   (payload: `0` AC, `1` DC, `2` short-term → we treat only `1` as "on
//!   battery").
//! - `GUID_BATTERY_PERCENTAGE_REMAINING` → [`SystemEvent::BatteryLevelChanged`]
//!   (payload is a DWORD 0–100; deduped at integer granularity).
//! - `GUID_LIDSWITCH_STATE_CHANGE` → [`SystemEvent::LidOpen`] /
//!   [`SystemEvent::LidClose`] (payload `0` = closed, `1` = open).
//!
//! The hub [`Arc`](std::sync::Arc) is stored in `GWLP_USERDATA` on the hidden
//! window so the C-ABI `wnd_proc` trampoline can recover it without a
//! thread-local. `GWLP_USERDATA` is the canonical Win32 "per-window state"
//! slot for this pattern.
//!
//! Pure parser helpers ([`parse_power_broadcast`], [`parse_power_setting`])
//! are compiled on every platform so they can be unit-tested from the macOS
//! dev machine. The Win32-using watcher glue is gated behind
//! `#[cfg(target_os = "windows")]`.

use crate::system_events::SystemEvent;

/// GUIDs as 128-bit integers (the form accepted by
/// `windows::core::GUID::from_u128`). Keeping them here lets the pure parser
/// be tested on platforms where the `windows` crate isn't compiled.
pub const GUID_ACDC_POWER_SOURCE_U128: u128 = 0x5d3e9a59_e9d5_4b00_a6bd_ff34ff516548;
pub const GUID_BATTERY_PERCENTAGE_REMAINING_U128: u128 = 0xa7ad8041_b45a_4cae_87a3_eecbb468a9e1;
pub const GUID_LIDSWITCH_STATE_CHANGE_U128: u128 = 0xba3e0f4d_b817_4094_a2d1_d56379b6c2a3;
pub const GUID_CONSOLE_DISPLAY_STATE_U128: u128 = 0x6fe69556_704a_47a0_8f24_c28d936fda47;

/// Win32 `PBT_*` constants routed through `WM_POWERBROADCAST.wParam`.
pub const PBT_APMSUSPEND: usize = 0x04;
pub const PBT_APMRESUMESUSPEND: usize = 0x07;
pub const PBT_APMRESUMEAUTOMATIC: usize = 0x12;
pub const PBT_POWERSETTINGCHANGE: usize = 0x8013;

/// Map a `WM_POWERBROADCAST` message into a [`SystemEvent`].
///
/// Only `PBT_APMSUSPEND` / `PBT_APMRESUME*` map directly — power-setting
/// changes (`PBT_POWERSETTINGCHANGE`) are delegated to
/// [`parse_power_setting`] since they carry per-GUID payloads.
pub fn parse_power_broadcast(wparam: usize, _lparam: isize) -> Option<SystemEvent> {
    match wparam {
        PBT_APMSUSPEND => Some(SystemEvent::Sleep),
        PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND => Some(SystemEvent::Wake),
        _ => None,
    }
}

/// Map a `GUID_*` power-setting notification into a [`SystemEvent`].
///
/// `guid` is the 128-bit form of the GUID (match against the `*_U128`
/// constants in this module). `payload` is the `POWERBROADCAST_SETTING.Data`
/// field — always a DWORD in little-endian form for the GUIDs we handle.
///
/// Returns `None` for unknown GUIDs, truncated payloads, or payloads we
/// don't route to a SystemEvent (e.g. `GUID_CONSOLE_DISPLAY_STATE`).
pub fn parse_power_setting(guid: u128, payload: &[u8]) -> Option<SystemEvent> {
    let bytes: [u8; 4] = payload.get(..4)?.try_into().ok()?;
    let value = u32::from_le_bytes(bytes);
    match guid {
        GUID_ACDC_POWER_SOURCE_U128 => Some(SystemEvent::PowerSourceChanged {
            on_battery: value == 1,
        }),
        GUID_BATTERY_PERCENTAGE_REMAINING_U128 => {
            let percent = value.min(100) as u8;
            Some(SystemEvent::BatteryLevelChanged { percent })
        }
        GUID_LIDSWITCH_STATE_CHANGE_U128 => Some(if value == 0 {
            SystemEvent::LidClose
        } else {
            SystemEvent::LidOpen
        }),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Windows-only watcher glue
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
pub use watcher::WindowsWatcher;

#[cfg(target_os = "windows")]
mod watcher {
    use super::*;
    use crate::error::AppError;
    use crate::system_events::{SystemEventsHub, SystemEventsWatcher};
    use log::{info, warn};
    use std::sync::Arc;
    use ::windows::core::{w, GUID, PCWSTR};
    use ::windows::Win32::Foundation::{HANDLE, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use ::windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use ::windows::Win32::System::Power::{
        RegisterPowerSettingNotification, POWERBROADCAST_SETTING,
    };
    use ::windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetWindowLongPtrW,
        RegisterClassExW, SetWindowLongPtrW, TranslateMessage, DEVICE_NOTIFY_WINDOW_HANDLE,
        GWLP_USERDATA, HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_POWERBROADCAST,
        WNDCLASSEXW,
    };

    // GUIDs as seen by Win32. Construct from the u128 forms in the parent
    // module so the pure parser and the glue can't drift apart.
    const GUID_ACDC_POWER_SOURCE: GUID = GUID::from_u128(GUID_ACDC_POWER_SOURCE_U128);
    const GUID_BATTERY_PERCENTAGE_REMAINING: GUID =
        GUID::from_u128(GUID_BATTERY_PERCENTAGE_REMAINING_U128);
    const GUID_LIDSWITCH_STATE_CHANGE: GUID = GUID::from_u128(GUID_LIDSWITCH_STATE_CHANGE_U128);
    const GUID_CONSOLE_DISPLAY_STATE: GUID = GUID::from_u128(GUID_CONSOLE_DISPLAY_STATE_U128);

    /// Per-window state the wndproc recovers via `GWLP_USERDATA`. The hub is
    /// refcounted with Arc; `last_percent` dedupes integer percent changes,
    /// mirroring the Linux watcher's behaviour.
    struct WindowState {
        hub: Arc<SystemEventsHub>,
        last_percent: Option<u8>,
    }

    pub struct WindowsWatcher;

    impl WindowsWatcher {
        pub fn new() -> Self {
            Self
        }
    }

    impl Default for WindowsWatcher {
        fn default() -> Self {
            Self::new()
        }
    }

    impl SystemEventsWatcher for WindowsWatcher {
        fn start(&self, hub: Arc<SystemEventsHub>) -> Result<(), AppError> {
            std::thread::Builder::new()
                .name("asyar-system-events-win".into())
                .spawn(move || {
                    if let Err(e) = run_message_loop(hub) {
                        warn!("[system_events/windows] message loop ended: {e}");
                    }
                })
                .ok();
            info!("[system_events/windows] watcher started");
            Ok(())
        }
    }

    fn guid_to_u128(g: &GUID) -> u128 {
        ((g.data1 as u128) << 96)
            | ((g.data2 as u128) << 80)
            | ((g.data3 as u128) << 64)
            | (u64::from_be_bytes(g.data4) as u128)
    }

    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_POWERBROADCAST {
            let ptr = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut WindowState;
            if !ptr.is_null() {
                // Safety: the pointer was installed in run_message_loop and
                // is only cleared when the loop exits; we dereference on the
                // same thread that owns it.
                let state = unsafe { &mut *ptr };
                if wparam.0 == PBT_POWERSETTINGCHANGE {
                    if lparam.0 != 0 {
                        let setting =
                            unsafe { &*(lparam.0 as *const POWERBROADCAST_SETTING) };
                        let data_len = setting.DataLength as usize;
                        let data_ptr = setting.Data.as_ptr();
                        // Safety: `Data` is a flexible array member; Win32
                        // guarantees `DataLength` bytes are readable.
                        let payload = unsafe {
                            std::slice::from_raw_parts(data_ptr, data_len)
                        };
                        let guid_u128 = guid_to_u128(&setting.PowerSetting);
                        if let Some(ev) = parse_power_setting(guid_u128, payload) {
                            dispatch_with_dedup(state, ev);
                        }
                    }
                } else if let Some(ev) = parse_power_broadcast(wparam.0, lparam.0) {
                    state.hub.dispatch(ev);
                }
                return LRESULT(0);
            }
        }
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    fn dispatch_with_dedup(state: &mut WindowState, ev: SystemEvent) {
        if let SystemEvent::BatteryLevelChanged { percent } = ev {
            if state.last_percent == Some(percent) {
                return;
            }
            state.last_percent = Some(percent);
        }
        state.hub.dispatch(ev);
    }

    fn run_message_loop(hub: Arc<SystemEventsHub>) -> Result<(), String> {
        unsafe {
            let hinstance: HINSTANCE = GetModuleHandleW(PCWSTR::null())
                .map_err(|e| format!("GetModuleHandleW failed: {e}"))?
                .into();

            let class_name = w!("AsyarSystemEventsWindow");
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(wnd_proc),
                hInstance: hinstance,
                lpszClassName: class_name,
                ..Default::default()
            };
            if RegisterClassExW(&wc) == 0 {
                return Err("RegisterClassExW failed".into());
            }

            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                class_name,
                w!(""),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                Some(hinstance),
                None,
            )
            .map_err(|e| format!("CreateWindowExW failed: {e}"))?;

            // Install the per-window state so `wnd_proc` can find it.
            let state = Box::new(WindowState {
                hub,
                last_percent: None,
            });
            let state_ptr = Box::into_raw(state);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, state_ptr as isize);

            // Register for the four power-setting GUIDs we care about. If
            // any single registration fails we log and continue — other
            // sources still fire.
            for (guid, name) in [
                (&GUID_ACDC_POWER_SOURCE, "GUID_ACDC_POWER_SOURCE"),
                (
                    &GUID_BATTERY_PERCENTAGE_REMAINING,
                    "GUID_BATTERY_PERCENTAGE_REMAINING",
                ),
                (&GUID_LIDSWITCH_STATE_CHANGE, "GUID_LIDSWITCH_STATE_CHANGE"),
                (&GUID_CONSOLE_DISPLAY_STATE, "GUID_CONSOLE_DISPLAY_STATE"),
            ] {
                if RegisterPowerSettingNotification(
                    HANDLE(hwnd.0),
                    guid,
                    DEVICE_NOTIFY_WINDOW_HANDLE,
                )
                .is_err()
                {
                    warn!(
                        "[system_events/windows] RegisterPowerSettingNotification \
                         failed for {name} — that source will not fire"
                    );
                }
            }

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).into() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            // Pump exited — drop the state box.
            let _ = Box::from_raw(state_ptr);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- parse_power_broadcast --------------------------------------------

    #[test]
    fn apm_suspend_emits_sleep() {
        assert!(matches!(
            parse_power_broadcast(PBT_APMSUSPEND, 0),
            Some(SystemEvent::Sleep)
        ));
    }

    #[test]
    fn apm_resume_automatic_emits_wake() {
        assert!(matches!(
            parse_power_broadcast(PBT_APMRESUMEAUTOMATIC, 0),
            Some(SystemEvent::Wake)
        ));
    }

    #[test]
    fn apm_resume_suspend_emits_wake() {
        assert!(matches!(
            parse_power_broadcast(PBT_APMRESUMESUSPEND, 0),
            Some(SystemEvent::Wake)
        ));
    }

    #[test]
    fn power_setting_change_is_none_here() {
        // PBT_POWERSETTINGCHANGE must be routed through parse_power_setting,
        // so parse_power_broadcast returns None for it.
        assert!(parse_power_broadcast(PBT_POWERSETTINGCHANGE, 0).is_none());
    }

    #[test]
    fn unknown_wparam_is_none() {
        assert!(parse_power_broadcast(0x999, 0).is_none());
        assert!(parse_power_broadcast(0, 0).is_none());
    }

    // --- parse_power_setting: ACDC power source ---------------------------

    #[test]
    fn acdc_power_source_dc_emits_on_battery() {
        let payload = 1u32.to_le_bytes();
        let ev = parse_power_setting(GUID_ACDC_POWER_SOURCE_U128, &payload).unwrap();
        assert!(matches!(
            ev,
            SystemEvent::PowerSourceChanged { on_battery: true }
        ));
    }

    #[test]
    fn acdc_power_source_ac_emits_not_on_battery() {
        let payload = 0u32.to_le_bytes();
        let ev = parse_power_setting(GUID_ACDC_POWER_SOURCE_U128, &payload).unwrap();
        assert!(matches!(
            ev,
            SystemEvent::PowerSourceChanged { on_battery: false }
        ));
    }

    #[test]
    fn acdc_power_source_short_term_is_not_on_battery() {
        // 2 = short-term (UPS). Treated as not-on-battery — we only flag DC.
        let payload = 2u32.to_le_bytes();
        let ev = parse_power_setting(GUID_ACDC_POWER_SOURCE_U128, &payload).unwrap();
        assert!(matches!(
            ev,
            SystemEvent::PowerSourceChanged { on_battery: false }
        ));
    }

    // --- parse_power_setting: battery percentage --------------------------

    #[test]
    fn battery_percentage_emits_battery_level_changed() {
        let payload = 73u32.to_le_bytes();
        let ev =
            parse_power_setting(GUID_BATTERY_PERCENTAGE_REMAINING_U128, &payload).unwrap();
        assert!(matches!(
            ev,
            SystemEvent::BatteryLevelChanged { percent: 73 }
        ));
    }

    #[test]
    fn battery_percentage_clamps_above_100() {
        let payload = 150u32.to_le_bytes();
        let ev =
            parse_power_setting(GUID_BATTERY_PERCENTAGE_REMAINING_U128, &payload).unwrap();
        assert!(matches!(
            ev,
            SystemEvent::BatteryLevelChanged { percent: 100 }
        ));
    }

    #[test]
    fn battery_percentage_zero_emits() {
        let payload = 0u32.to_le_bytes();
        let ev =
            parse_power_setting(GUID_BATTERY_PERCENTAGE_REMAINING_U128, &payload).unwrap();
        assert!(matches!(
            ev,
            SystemEvent::BatteryLevelChanged { percent: 0 }
        ));
    }

    // --- parse_power_setting: lid switch ----------------------------------

    #[test]
    fn lidswitch_state_closed_emits_lid_close() {
        let payload = 0u32.to_le_bytes();
        let ev = parse_power_setting(GUID_LIDSWITCH_STATE_CHANGE_U128, &payload).unwrap();
        assert!(matches!(ev, SystemEvent::LidClose));
    }

    #[test]
    fn lidswitch_state_open_emits_lid_open() {
        let payload = 1u32.to_le_bytes();
        let ev = parse_power_setting(GUID_LIDSWITCH_STATE_CHANGE_U128, &payload).unwrap();
        assert!(matches!(ev, SystemEvent::LidOpen));
    }

    // --- parse_power_setting: unhandled / malformed ------------------------

    #[test]
    fn console_display_state_is_none() {
        // We register for GUID_CONSOLE_DISPLAY_STATE for completeness but
        // don't map it to any SystemEvent.
        let payload = 1u32.to_le_bytes();
        assert!(parse_power_setting(GUID_CONSOLE_DISPLAY_STATE_U128, &payload).is_none());
    }

    #[test]
    fn unknown_guid_is_none() {
        let payload = 1u32.to_le_bytes();
        assert!(
            parse_power_setting(0xdead_beef_cafe_f00d_0000_0000_0000_0000, &payload).is_none()
        );
    }

    #[test]
    fn truncated_payload_is_none() {
        // DWORD requires 4 bytes; shorter payload → None (not panic).
        assert!(parse_power_setting(GUID_ACDC_POWER_SOURCE_U128, &[1, 0]).is_none());
        assert!(parse_power_setting(GUID_BATTERY_PERCENTAGE_REMAINING_U128, &[]).is_none());
        assert!(parse_power_setting(GUID_LIDSWITCH_STATE_CHANGE_U128, &[0]).is_none());
    }
}
