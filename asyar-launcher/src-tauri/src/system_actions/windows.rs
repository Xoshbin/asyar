//! Windows backend.
//!
//! - Sleep / Hibernate: `SetSuspendState` (powrprof). Hibernate is offered
//!   only when `IsPwrHibernateAllowed()` says the OS has it enabled.
//! - Lock: `LockWorkStation`.
//! - Log out / Restart / Shut down: `ExitWindowsEx` with the matching flag.
//!
//! Suspend, restart, and shutdown require the `SeShutdownPrivilege` to be
//! enabled on the process token — it is present but disabled by default for
//! interactive sessions, so [`enable_shutdown_privilege`] flips it on before
//! those calls. All calls are graceful (no `EWX_FORCE`): applications get
//! their normal chance to prompt for unsaved work.

use crate::error::AppError;
use crate::system_actions::{SystemAction, SystemActionsBackend};
use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_NOT_ALL_ASSIGNED, HANDLE, LUID};
use windows::Win32::Security::{
    AdjustTokenPrivileges, LookupPrivilegeValueW, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED,
    SE_SHUTDOWN_NAME, TOKEN_ADJUST_PRIVILEGES, TOKEN_PRIVILEGES, TOKEN_QUERY,
};
use windows::Win32::System::Power::{IsPwrHibernateAllowed, SetSuspendState};
use windows::Win32::System::Shutdown::{
    ExitWindowsEx, LockWorkStation, EWX_LOGOFF, EWX_POWEROFF, EWX_REBOOT, EXIT_WINDOWS_FLAGS,
    SHTDN_REASON_FLAG_PLANNED, SHTDN_REASON_MAJOR_OTHER, SHTDN_REASON_MINOR_OTHER,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

pub struct WindowsSystemActionsBackend;

impl WindowsSystemActionsBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for WindowsSystemActionsBackend {
    fn default() -> Self {
        Self::new()
    }
}

/// Enables `SeShutdownPrivilege` on the current process token. Required by
/// `SetSuspendState` and `ExitWindowsEx`; idempotent, so calling it before
/// every action is fine.
fn enable_shutdown_privilege() -> Result<(), AppError> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
            &mut token,
        )
        .map_err(|e| AppError::Platform(format!("OpenProcessToken failed: {e}")))?;

        let result = (|| {
            let mut luid = LUID::default();
            LookupPrivilegeValueW(None, SE_SHUTDOWN_NAME, &mut luid)
                .map_err(|e| AppError::Platform(format!("LookupPrivilegeValueW failed: {e}")))?;

            let privileges = TOKEN_PRIVILEGES {
                PrivilegeCount: 1,
                Privileges: [LUID_AND_ATTRIBUTES {
                    Luid: luid,
                    Attributes: SE_PRIVILEGE_ENABLED,
                }],
            };
            AdjustTokenPrivileges(token, false, Some(&privileges as *const _), 0, None, None)
                .map_err(|e| AppError::Platform(format!("AdjustTokenPrivileges failed: {e}")))?;

            // AdjustTokenPrivileges reports success even when it assigned
            // nothing — the real outcome is in the thread's last error.
            if GetLastError() == ERROR_NOT_ALL_ASSIGNED {
                return Err(AppError::Platform(
                    "SeShutdownPrivilege is not held by this process".into(),
                ));
            }
            Ok(())
        })();

        let _ = CloseHandle(token);
        result
    }
}

fn exit_windows(flags: EXIT_WINDOWS_FLAGS) -> Result<(), AppError> {
    unsafe {
        ExitWindowsEx(
            flags,
            SHTDN_REASON_MAJOR_OTHER | SHTDN_REASON_MINOR_OTHER | SHTDN_REASON_FLAG_PLANNED,
        )
        .map_err(|e| AppError::Platform(format!("ExitWindowsEx failed: {e}")))
    }
}

fn suspend(hibernate: bool) -> Result<(), AppError> {
    enable_shutdown_privilege()?;
    // bForce is ignored since Windows XP; wake events stay enabled.
    let ok = unsafe { SetSuspendState(hibernate, false, false) };
    if !ok {
        return Err(AppError::Platform(format!(
            "SetSuspendState(hibernate={hibernate}) failed: {}",
            std::io::Error::last_os_error()
        )));
    }
    Ok(())
}

impl SystemActionsBackend for WindowsSystemActionsBackend {
    fn supported(&self) -> Vec<SystemAction> {
        let mut actions = vec![
            SystemAction::Sleep,
            SystemAction::LockScreen,
            SystemAction::LogOut,
            SystemAction::Restart,
            SystemAction::ShutDown,
        ];
        if unsafe { IsPwrHibernateAllowed() } {
            actions.insert(1, SystemAction::Hibernate);
        }
        actions
    }

    fn run(&self, action: SystemAction) -> Result<(), AppError> {
        match action {
            SystemAction::Sleep => suspend(false),
            SystemAction::Hibernate => suspend(true),
            SystemAction::LockScreen => unsafe {
                LockWorkStation()
                    .map_err(|e| AppError::Platform(format!("LockWorkStation failed: {e}")))
            },
            SystemAction::LogOut => exit_windows(EWX_LOGOFF),
            SystemAction::Restart => {
                enable_shutdown_privilege()?;
                exit_windows(EWX_REBOOT)
            }
            SystemAction::ShutDown => {
                enable_shutdown_privilege()?;
                exit_windows(EWX_POWEROFF)
            }
        }
    }
}
