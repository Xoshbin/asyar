//! macOS backend using IOKit `IOPMAssertionCreateWithName`.
//!
//! Each call to [`PowerBackend::inhibit`] creates one IOKit power assertion
//! per requested option axis (`system`, `display`, `disk`). The returned
//! handle owns the assertion IDs; its `Drop` impl releases them via
//! `IOPMAssertionRelease`.

use crate::error::AppError;
use crate::power::{PowerBackend, PowerHandle, ResolvedOptions};
use core_foundation::base::TCFType;
use core_foundation::string::{CFString, CFStringRef};
use std::os::raw::c_int;

type IOReturn = c_int;
type IOPMAssertionID = u32;
type IOPMAssertionLevel = u32;

const K_IOPM_ASSERTION_LEVEL_ON: IOPMAssertionLevel = 255;
const K_IO_RETURN_SUCCESS: IOReturn = 0;

#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOPMAssertionCreateWithName(
        assertion_type: CFStringRef,
        assertion_level: IOPMAssertionLevel,
        assertion_name: CFStringRef,
        assertion_id: *mut IOPMAssertionID,
    ) -> IOReturn;

    fn IOPMAssertionRelease(assertion_id: IOPMAssertionID) -> IOReturn;
}

pub struct MacPowerBackend;

impl MacPowerBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MacPowerBackend {
    fn default() -> Self {
        Self::new()
    }
}

pub struct MacAssertionHandle {
    ids: Vec<IOPMAssertionID>,
}

impl PowerHandle for MacAssertionHandle {}

impl Drop for MacAssertionHandle {
    fn drop(&mut self) {
        for id in &self.ids {
            let rc = unsafe { IOPMAssertionRelease(*id) };
            if rc != K_IO_RETURN_SUCCESS {
                log::warn!("IOPMAssertionRelease({}) returned {}", id, rc);
            }
        }
    }
}

fn create_one(assertion_type: &str, reason: &str) -> Result<IOPMAssertionID, AppError> {
    let cf_type = CFString::new(assertion_type);
    let cf_name = CFString::new(reason);
    let mut id: IOPMAssertionID = 0;
    let rc = unsafe {
        IOPMAssertionCreateWithName(
            cf_type.as_concrete_TypeRef(),
            K_IOPM_ASSERTION_LEVEL_ON,
            cf_name.as_concrete_TypeRef(),
            &mut id,
        )
    };
    if rc != K_IO_RETURN_SUCCESS {
        return Err(AppError::Power(format!(
            "IOPMAssertionCreateWithName({}) failed: {}",
            assertion_type, rc
        )));
    }
    Ok(id)
}

impl PowerBackend for MacPowerBackend {
    fn inhibit(
        &self,
        _token: &str,
        options: ResolvedOptions,
        reason: &str,
    ) -> Result<Box<dyn PowerHandle>, AppError> {
        let mut ids: Vec<IOPMAssertionID> = Vec::new();
        let rollback = |ids: &mut Vec<IOPMAssertionID>| {
            for id in ids.drain(..) {
                unsafe {
                    IOPMAssertionRelease(id);
                }
            }
        };

        if options.display {
            match create_one("PreventUserIdleDisplaySleep", reason) {
                Ok(id) => ids.push(id),
                Err(e) => {
                    rollback(&mut ids);
                    return Err(e);
                }
            }
        }
        if options.system {
            match create_one("NoIdleSleepAssertion", reason) {
                Ok(id) => ids.push(id),
                Err(e) => {
                    rollback(&mut ids);
                    return Err(e);
                }
            }
        }
        if options.disk {
            match create_one("PreventDiskIdle", reason) {
                Ok(id) => ids.push(id),
                Err(e) => {
                    rollback(&mut ids);
                    return Err(e);
                }
            }
        }
        if ids.is_empty() {
            // All three axes false — fall back to a system-idle inhibitor so
            // the call is not a silent no-op.
            ids.push(create_one("NoIdleSleepAssertion", reason)?);
        }
        Ok(Box::new(MacAssertionHandle { ids }))
    }
}
