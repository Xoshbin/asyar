//! Tauri command layer for the power inhibitor service.
//!
//! Thin wrappers delegating to pure `*_inner` functions so the logic is unit
//! testable without a running Tauri app.

use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use crate::power::{ActiveInhibitor, KeepAwakeOptions, PowerRegistry};
use tauri::State;

const REQUIRED_PERMISSION: &str = "power:inhibit";

#[tauri::command]
pub fn power_keep_awake(
    registry: State<'_, PowerRegistry>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    options: KeepAwakeOptions,
) -> Result<String, AppError> {
    power_keep_awake_inner(&registry, &permissions, extension_id, options)
}

#[tauri::command]
pub fn power_release(
    registry: State<'_, PowerRegistry>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
    token: String,
) -> Result<(), AppError> {
    power_release_inner(&registry, &permissions, extension_id, token)
}

#[tauri::command]
pub fn power_list(
    registry: State<'_, PowerRegistry>,
    permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: Option<String>,
) -> Result<Vec<ActiveInhibitor>, AppError> {
    power_list_inner(&registry, &permissions, extension_id)
}

pub(crate) fn power_keep_awake_inner(
    registry: &PowerRegistry,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    options: KeepAwakeOptions,
) -> Result<String, AppError> {
    permissions.check(&extension_id, REQUIRED_PERMISSION)?;
    registry.keep_awake(extension_id, options)
}

pub(crate) fn power_release_inner(
    registry: &PowerRegistry,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
    token: String,
) -> Result<(), AppError> {
    permissions.check(&extension_id, REQUIRED_PERMISSION)?;
    registry.release(&token)
}

pub(crate) fn power_list_inner(
    registry: &PowerRegistry,
    permissions: &ExtensionPermissionRegistry,
    extension_id: Option<String>,
) -> Result<Vec<ActiveInhibitor>, AppError> {
    permissions.check(&extension_id, REQUIRED_PERMISSION)?;
    registry.list(extension_id.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::power::fake::FakeBackend;
    use std::collections::HashSet;

    fn make_registry() -> PowerRegistry {
        PowerRegistry::new(Box::new(FakeBackend::new()))
    }

    fn registered_permissions(ext_id: &str) -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let mut inner = reg.inner.lock().unwrap();
        let mut set = HashSet::new();
        set.insert(REQUIRED_PERMISSION.to_string());
        inner.insert(ext_id.to_string(), set);
        drop(inner);
        reg
    }

    fn empty_permissions() -> ExtensionPermissionRegistry {
        ExtensionPermissionRegistry::new()
    }

    fn opts(reason: &str) -> KeepAwakeOptions {
        KeepAwakeOptions {
            system: None,
            display: None,
            disk: None,
            reason: reason.into(),
        }
    }

    #[test]
    fn keep_awake_without_permission_is_rejected() {
        let reg = make_registry();
        let perms = empty_permissions();
        let err = power_keep_awake_inner(&reg, &perms, Some("ext-a".into()), opts("work"))
            .expect_err("should be rejected");
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn keep_awake_with_permission_returns_uuid() {
        let reg = make_registry();
        let perms = registered_permissions("ext-a");
        let token = power_keep_awake_inner(&reg, &perms, Some("ext-a".into()), opts("work"))
            .expect("should be allowed");
        assert!(uuid::Uuid::parse_str(&token).is_ok());
    }

    #[test]
    fn release_with_permission_succeeds_for_own_token() {
        let reg = make_registry();
        let perms = registered_permissions("ext-a");
        let token =
            power_keep_awake_inner(&reg, &perms, Some("ext-a".into()), opts("work")).unwrap();
        power_release_inner(&reg, &perms, Some("ext-a".into()), token).expect("release ok");
    }

    #[test]
    fn release_of_unknown_token_returns_not_found() {
        let reg = make_registry();
        let perms = registered_permissions("ext-a");
        let err =
            power_release_inner(&reg, &perms, Some("ext-a".into()), "bogus-token".into())
                .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }

    #[test]
    fn list_returns_only_callers_inhibitors() {
        let reg = make_registry();
        let perms_a = registered_permissions("ext-a");
        let perms_b = registered_permissions("ext-b");
        let _ta =
            power_keep_awake_inner(&reg, &perms_a, Some("ext-a".into()), opts("a")).unwrap();
        let _tb =
            power_keep_awake_inner(&reg, &perms_b, Some("ext-b".into()), opts("b")).unwrap();
        let seen_by_a = power_list_inner(&reg, &perms_a, Some("ext-a".into())).unwrap();
        assert_eq!(seen_by_a.len(), 1);
        assert_eq!(seen_by_a[0].reason, "a");
    }

    #[test]
    fn core_caller_bypasses_permission_check() {
        // extension_id = None means core/system call — always allowed.
        let reg = make_registry();
        let perms = empty_permissions();
        let token = power_keep_awake_inner(&reg, &perms, None, opts("core")).unwrap();
        assert!(!token.is_empty());
    }
}
