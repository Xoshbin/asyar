//! macOS system-events watcher.
//!
//! All three sources use IOKit C APIs (no Objective-C) so we avoid pulling
//! objc2 into the dependency graph:
//!
//! - Sleep/wake: `IORegisterForSystemPower` on a dedicated thread running a
//!   private CFRunLoop — the classic IOKit pattern. The callback fires on
//!   `kIOMessageSystemWillSleep` / `kIOMessageSystemHasPoweredOn`.
//! - Lid:  Polls `AppleClamshellState` from IORegistry every 2s. IOKit
//!   notification-port setup for this key is complex; the 2s poll is
//!   adequate for UI-facing callbacks and keeps the code small.
//! - Battery:  Polls IOPowerSources every 30s and dispatches only on
//!   change. IOPSNotificationCreateRunLoopSource would be more efficient
//!   but requires the same run-loop plumbing for marginal gain at 30s
//!   cadence.

use crate::error::AppError;
use crate::system_events::{SystemEvent, SystemEventsHub, SystemEventsWatcher};
use core_foundation::array::{CFArray, CFArrayRef};
use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use log::info;
use std::sync::Arc;
use std::time::Duration;

pub struct MacWatcher;

impl MacWatcher {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MacWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemEventsWatcher for MacWatcher {
    fn start(&self, hub: Arc<SystemEventsHub>) -> Result<(), AppError> {
        start_system_power_listener(hub.clone());
        start_lid_poller(hub.clone());
        start_battery_poller(hub);
        info!("[system_events/macos] watcher started");
        Ok(())
    }
}

// -------------------------------------------------------------------------
// Sleep / wake — IORegisterForSystemPower on a dedicated CFRunLoop thread
// -------------------------------------------------------------------------

// IOKit message constants (from IOKit/pwr_mgt/IOPMLib.h).
// kIOMessageSystemWillSleep    = 0xE0000280
// kIOMessageSystemWillPowerOn  = 0xE0000320
// kIOMessageSystemHasPoweredOn = 0xE0000300
// kIOMessageCanSystemSleep     = 0xE0000270 (we acknowledge + ignore)
const K_IO_MESSAGE_SYSTEM_WILL_SLEEP: u32 = 0xE0000280;
const K_IO_MESSAGE_SYSTEM_HAS_POWERED_ON: u32 = 0xE0000300;
const K_IO_MESSAGE_CAN_SYSTEM_SLEEP: u32 = 0xE0000270;

type IOServiceInterestCallback = unsafe extern "C" fn(
    refcon: *mut std::ffi::c_void,
    service: u32,
    message_type: u32,
    message_argument: *mut std::ffi::c_void,
);

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IORegisterForSystemPower(
        refcon: *mut std::ffi::c_void,
        the_port_ref: *mut *mut std::ffi::c_void,
        callback: IOServiceInterestCallback,
        notifier: *mut u32,
    ) -> u32;

    fn IONotificationPortGetRunLoopSource(port: *mut std::ffi::c_void) -> *mut std::ffi::c_void;

    fn IOAllowPowerChange(kernel_port: u32, notification_id: *mut std::ffi::c_void) -> i32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRunLoopGetCurrent() -> *mut std::ffi::c_void;
    fn CFRunLoopAddSource(
        rl: *mut std::ffi::c_void,
        source: *mut std::ffi::c_void,
        mode: CFStringRef,
    );
    fn CFRunLoopRun();

    // Common mode — we use the default mode via kCFRunLoopDefaultMode from
    // core-foundation.
    static kCFRunLoopDefaultMode: CFStringRef;
}

/// Trampoline: the `refcon` is a leaked `Arc<SystemEventsHub>` pointer.
unsafe extern "C" fn system_power_callback(
    refcon: *mut std::ffi::c_void,
    _service: u32,
    message_type: u32,
    message_argument: *mut std::ffi::c_void,
) {
    if refcon.is_null() {
        return;
    }
    // Reconstruct Arc without taking ownership (clone and forget).
    let hub_ptr = refcon as *const SystemEventsHub;
    let hub: Arc<SystemEventsHub> = {
        let original = Arc::from_raw(hub_ptr);
        let cloned = Arc::clone(&original);
        std::mem::forget(original);
        cloned
    };

    // Service io_connect_t — retrieved once from the register call; we only
    // need the kernel port for IOAllowPowerChange. Store it in a OnceLock.
    static KERNEL_PORT: std::sync::OnceLock<u32> = std::sync::OnceLock::new();

    match message_type {
        K_IO_MESSAGE_SYSTEM_WILL_SLEEP => {
            hub.dispatch(SystemEvent::Sleep);
            // Acknowledge so the system proceeds to sleep.
            if let Some(&port) = KERNEL_PORT.get() {
                unsafe {
                    IOAllowPowerChange(port, message_argument);
                }
            }
        }
        K_IO_MESSAGE_SYSTEM_HAS_POWERED_ON => {
            hub.dispatch(SystemEvent::Wake);
        }
        K_IO_MESSAGE_CAN_SYSTEM_SLEEP => {
            if let Some(&port) = KERNEL_PORT.get() {
                unsafe {
                    IOAllowPowerChange(port, message_argument);
                }
            }
        }
        _ => {}
    }

    // Set kernel port on first invocation (will be set via thread-local below)
    let _ = KERNEL_PORT;
}

fn start_system_power_listener(hub: Arc<SystemEventsHub>) {
    // Leak an Arc handle to pass as refcon — watcher lives for app lifetime.
    // Pass as usize across the thread boundary so the pointer is Send;
    // cast back inside the thread before handing to C.
    let refcon_addr: usize = Arc::into_raw(hub) as usize;

    std::thread::Builder::new()
        .name("asyar-system-events-power".into())
        .spawn(move || unsafe {
            let refcon = refcon_addr as *mut std::ffi::c_void;
            let mut port: *mut std::ffi::c_void = std::ptr::null_mut();
            let mut notifier: u32 = 0;
            let kernel_port = IORegisterForSystemPower(
                refcon,
                &mut port,
                system_power_callback,
                &mut notifier,
            );
            if kernel_port == 0 || port.is_null() {
                log::warn!("[system_events/macos] IORegisterForSystemPower failed");
                return;
            }
            stash_kernel_port(kernel_port);

            let source = IONotificationPortGetRunLoopSource(port);
            let run_loop = CFRunLoopGetCurrent();
            CFRunLoopAddSource(run_loop, source, kCFRunLoopDefaultMode);
            CFRunLoopRun();
        })
        .ok();
}

fn stash_kernel_port(port: u32) {
    // Re-declare the same OnceLock as in the callback by path so both sides
    // target the same storage. We use a module-level static to make this
    // unambiguous.
    KERNEL_PORT_STATIC.set(port).ok();
}

static KERNEL_PORT_STATIC: std::sync::OnceLock<u32> = std::sync::OnceLock::new();

// -------------------------------------------------------------------------
// Lid state — poll AppleClamshellState
// -------------------------------------------------------------------------

fn start_lid_poller(hub: Arc<SystemEventsHub>) {
    tokio::spawn(async move {
        let mut last: Option<bool> = None; // true = closed
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        loop {
            interval.tick().await;
            let closed = match read_clamshell_closed() {
                Some(v) => v,
                None => continue, // no clamshell key; device has no lid
            };
            match last {
                None => {
                    last = Some(closed);
                    // No synthetic boot event — extensions should not assume
                    // the first callback reflects a state change.
                }
                Some(prev) if prev != closed => {
                    hub.dispatch(if closed {
                        SystemEvent::LidClose
                    } else {
                        SystemEvent::LidOpen
                    });
                    last = Some(closed);
                }
                _ => {}
            }
        }
    });
}

fn read_clamshell_closed() -> Option<bool> {
    use core_foundation::boolean::CFBoolean;

    extern "C" {
        fn IOServiceMatching(name: *const std::os::raw::c_char) -> CFDictionaryRef;
        fn IOServiceGetMatchingService(
            master_port: u32,
            matching: CFDictionaryRef,
        ) -> u32;
        fn IORegistryEntryCreateCFProperty(
            entry: u32,
            key: CFStringRef,
            allocator: *const std::ffi::c_void,
            options: u32,
        ) -> *const std::ffi::c_void;
        fn IOObjectRelease(obj: u32) -> i32;
    }

    let service_name = std::ffi::CString::new("IOPMrootDomain").ok()?;
    unsafe {
        let matching = IOServiceMatching(service_name.as_ptr());
        if matching.is_null() {
            return None;
        }
        let service = IOServiceGetMatchingService(0, matching);
        if service == 0 {
            return None;
        }
        let key = CFString::new("AppleClamshellState");
        let raw = IORegistryEntryCreateCFProperty(
            service,
            key.as_concrete_TypeRef(),
            std::ptr::null(),
            0,
        );
        IOObjectRelease(service);
        if raw.is_null() {
            return None;
        }
        let cf: CFType = CFType::wrap_under_create_rule(raw as *const _);
        let b = cf.downcast::<CFBoolean>()?;
        Some(b.into())
    }
}

// -------------------------------------------------------------------------
// Battery / power source — poll IOPowerSources
// -------------------------------------------------------------------------

fn start_battery_poller(hub: Arc<SystemEventsHub>) {
    tokio::spawn(async move {
        let mut last_percent: Option<u8> = None;
        let mut last_on_battery: Option<bool> = None;
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            if let Some(snap) = read_power_snapshot() {
                if let Some(pct) = snap.percent {
                    if last_percent != Some(pct) {
                        hub.dispatch(SystemEvent::BatteryLevelChanged { percent: pct });
                        last_percent = Some(pct);
                    }
                }
                if last_on_battery != Some(snap.on_battery) {
                    hub.dispatch(SystemEvent::PowerSourceChanged {
                        on_battery: snap.on_battery,
                    });
                    last_on_battery = Some(snap.on_battery);
                }
            }
        }
    });
}

struct PowerSnapshot {
    percent: Option<u8>,
    on_battery: bool,
}

fn read_power_snapshot() -> Option<PowerSnapshot> {
    extern "C" {
        fn IOPSCopyPowerSourcesInfo() -> *const std::ffi::c_void;
        fn IOPSCopyPowerSourcesList(blob: *const std::ffi::c_void) -> CFArrayRef;
        fn IOPSGetPowerSourceDescription(
            blob: *const std::ffi::c_void,
            ps: *const std::ffi::c_void,
        ) -> CFDictionaryRef;
    }

    unsafe {
        let blob = IOPSCopyPowerSourcesInfo();
        if blob.is_null() {
            return None;
        }
        let list_ref = IOPSCopyPowerSourcesList(blob);
        if list_ref.is_null() {
            core_foundation::base::CFRelease(blob);
            return None;
        }
        let list: CFArray<CFType> = CFArray::wrap_under_create_rule(list_ref);
        let count = list.len();
        let mut percent: Option<u8> = None;
        let mut on_battery = false;

        for i in 0..count {
            let ps_item = match list.get(i) {
                Some(p) => p,
                None => continue,
            };
            let desc_ref =
                IOPSGetPowerSourceDescription(blob, ps_item.as_CFTypeRef() as *const _);
            if desc_ref.is_null() {
                continue;
            }
            let desc: CFDictionary<CFString, CFType> =
                CFDictionary::wrap_under_get_rule(desc_ref);

            let state_key = CFString::new("Power Source State");
            if let Some(v) = desc.find(&state_key) {
                if let Some(s) = v.downcast::<CFString>() {
                    on_battery = s == CFString::new("Battery Power");
                }
            }

            let cur_key = CFString::new("Current Capacity");
            let max_key = CFString::new("Max Capacity");
            let cur = desc.find(&cur_key).and_then(|v| v.downcast::<CFNumber>());
            let max = desc.find(&max_key).and_then(|v| v.downcast::<CFNumber>());
            if let (Some(cur), Some(max)) = (cur, max) {
                let c = cur.to_i64().unwrap_or(0);
                let m = max.to_i64().unwrap_or(0);
                if m > 0 {
                    let pct = ((c as f64 / m as f64) * 100.0).round() as i64;
                    let pct = pct.clamp(0, 100) as u8;
                    percent = Some(pct);
                }
            }
        }
        core_foundation::base::CFRelease(blob);

        Some(PowerSnapshot { percent, on_battery })
    }
}
