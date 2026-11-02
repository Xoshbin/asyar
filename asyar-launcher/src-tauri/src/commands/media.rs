//! Tauri command layer for native media control.
//!
//! Thin wrappers delegating to pure `*_inner` functions so the permission
//! gate is unit testable without a running Tauri app.

use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use asyar_platform::{MediaSessionInfo, MediaTransportAction};
use tauri::State;

const REQUIRED_PERMISSION: &str = "media:control";

fn platform_err(e: asyar_platform::PlatformError) -> AppError {
    AppError::Platform(e.to_string())
}

// macOS keeps these on the main thread: NSAppleScript is main-thread-only (the
// script timeout bounds the stall). Elsewhere the platform calls block on SMTC
// or D-Bus, so they run on the async runtime's pool instead.
#[cfg_attr(target_os = "macos", tauri::command)]
#[cfg_attr(not(target_os = "macos"), tauri::command(async))]
pub fn media_get_now_playing(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    player_id: Option<String>,
) -> Result<Option<MediaSessionInfo>, AppError> {
    media_get_now_playing_inner(&permissions, extension_id, player_id)
}

// macOS keeps these on the main thread: NSAppleScript is main-thread-only (the
// script timeout bounds the stall). Elsewhere the platform calls block on SMTC
// or D-Bus, so they run on the async runtime's pool instead.
#[cfg_attr(target_os = "macos", tauri::command)]
#[cfg_attr(not(target_os = "macos"), tauri::command(async))]
pub fn media_list_sessions(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
) -> Result<Vec<MediaSessionInfo>, AppError> {
    media_list_sessions_inner(&permissions, extension_id)
}

// macOS keeps these on the main thread: NSAppleScript is main-thread-only (the
// script timeout bounds the stall). Elsewhere the platform calls block on SMTC
// or D-Bus, so they run on the async runtime's pool instead.
#[cfg_attr(target_os = "macos", tauri::command)]
#[cfg_attr(not(target_os = "macos"), tauri::command(async))]
pub fn media_control(
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    action: MediaTransportAction,
    player_id: Option<String>,
) -> Result<(), AppError> {
    media_control_inner(&permissions, extension_id, action, player_id)
}

pub(crate) fn media_get_now_playing_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    player_id: Option<String>,
) -> Result<Option<MediaSessionInfo>, AppError> {
    permissions.check(&extension_id, REQUIRED_PERMISSION)?;
    asyar_platform::get_now_playing(player_id.as_deref()).map_err(platform_err)
}

pub(crate) fn media_list_sessions_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
) -> Result<Vec<MediaSessionInfo>, AppError> {
    permissions.check(&extension_id, REQUIRED_PERMISSION)?;
    asyar_platform::list_sessions().map_err(platform_err)
}

pub(crate) fn media_control_inner(
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    action: MediaTransportAction,
    player_id: Option<String>,
) -> Result<(), AppError> {
    permissions.check(&extension_id, REQUIRED_PERMISSION)?;
    asyar_platform::send_transport(action, player_id.as_deref()).map_err(platform_err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn registered_permissions(ext_id: &str) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let mut inner = reg.inner.lock().unwrap();
        let mut set = HashSet::new();
        set.insert(REQUIRED_PERMISSION.to_string());
        inner.insert(ext_id.to_string(), set);
        drop(inner);
        reg
    }

    // An unknown player id fails inside the platform layer *after* the
    // permission gate, without touching the OS or any real player — so it
    // proves the gate passed without side effects on the dev machine.
    const UNKNOWN_PLAYER: &str = "com.example.not-a-player";

    fn is_permission_denied<T: std::fmt::Debug>(r: &Result<T, AppError>) -> bool {
        matches!(r, Err(AppError::Permission(_)))
    }

    #[test]
    fn all_commands_reject_without_permission() {
        let perms = ExtensionPermissionRegistry::new();
        let ext = || Some("ext-a".to_string());
        assert!(is_permission_denied(&media_get_now_playing_inner(
            &perms,
            ext(),
            None
        )));
        assert!(is_permission_denied(&media_list_sessions_inner(
            &perms,
            ext()
        )));
        assert!(is_permission_denied(&media_control_inner(
            &perms,
            ext(),
            MediaTransportAction::Next,
            None
        )));
    }

    #[test]
    fn extension_with_other_permission_only_is_rejected() {
        let perms = ExtensionPermissionRegistry::new();
        perms
            .inner
            .lock()
            .unwrap()
            .insert("ext-a".into(), HashSet::from(["power:inhibit".to_string()]));
        let r = media_control_inner(
            &perms,
            Some("ext-a".into()),
            MediaTransportAction::Next,
            None,
        );
        assert!(is_permission_denied(&r), "got: {r:?}");
    }

    #[test]
    fn granted_extension_passes_the_gate() {
        let perms = registered_permissions("ext-a");
        let ext = || Some("ext-a".to_string());
        let r = media_get_now_playing_inner(&perms, ext(), Some(UNKNOWN_PLAYER.into()));
        assert!(!is_permission_denied(&r), "got: {r:?}");
        let r = media_control_inner(
            &perms,
            ext(),
            MediaTransportAction::Next,
            Some(UNKNOWN_PLAYER.into()),
        );
        assert!(!is_permission_denied(&r), "got: {r:?}");
    }

    #[test]
    fn host_caller_passes_the_gate() {
        let perms = ExtensionPermissionRegistry::new();
        let r = media_control_inner(
            &perms,
            None,
            MediaTransportAction::Next,
            Some(UNKNOWN_PLAYER.into()),
        );
        assert!(!is_permission_denied(&r), "got: {r:?}");
        let r = media_get_now_playing_inner(&perms, None, Some(UNKNOWN_PLAYER.into()));
        assert!(!is_permission_denied(&r), "got: {r:?}");
    }
}
