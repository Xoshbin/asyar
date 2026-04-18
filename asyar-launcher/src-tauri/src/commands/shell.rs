use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use crate::shell::{self, ShellDescriptor, ShellProcessRegistry};
use crate::storage::{
    shell::{self as shell_storage, TrustedBinary},
    DataStore,
};
use tauri::{AppHandle, Emitter, State};

const REQUIRED_PERMISSION: &str = "shell:spawn";

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn shell_spawn(
    app: AppHandle,
    db: State<'_, DataStore>,
    extension_permissions: State<'_, ExtensionPermissionRegistry>,
    shell_registry: State<'_, ShellProcessRegistry>,
    extension_id: String,
    spawn_id: String,
    program: String,
    args: Vec<String>,
) -> Result<(), AppError> {
    extension_permissions.check(&Some(extension_id.clone()), REQUIRED_PERMISSION)?;

    let conn = db.conn()?;
    let trusted = shell_storage::is_trusted(&conn, &extension_id, &program)?;
    drop(conn);

    if !trusted {
        return Err(AppError::Permission(format!(
            "Binary \"{}\" is not trusted for extension \"{}\".",
            program, extension_id
        )));
    }

    shell::spawn(app, &shell_registry, spawn_id, extension_id, program, args)
}

#[tauri::command]
pub fn shell_kill(
    shell_registry: State<'_, ShellProcessRegistry>,
    spawn_id: String,
) -> Result<(), AppError> {
    shell::kill(&shell_registry, &spawn_id)
}

#[tauri::command]
pub async fn shell_resolve_path(program: String) -> Result<String, AppError> {
    shell::resolve_path(&program).await
}

#[tauri::command]
pub fn shell_check_trust(
    db: State<'_, DataStore>,
    extension_id: String,
    binary_path: String,
) -> Result<bool, AppError> {
    let conn = db.conn()?;
    shell_storage::is_trusted(&conn, &extension_id, &binary_path)
}

#[tauri::command]
pub fn shell_grant_trust(
    db: State<'_, DataStore>,
    extension_id: String,
    binary_path: String,
) -> Result<(), AppError> {
    let conn = db.conn()?;
    shell_storage::grant_trust(&conn, &extension_id, &binary_path)
}

#[tauri::command]
pub fn shell_revoke_trust(
    db: State<'_, DataStore>,
    extension_id: String,
    binary_path: String,
) -> Result<(), AppError> {
    let conn = db.conn()?;
    shell_storage::revoke_trust(&conn, &extension_id, &binary_path)
}

#[tauri::command]
pub fn shell_list_trusted(
    db: State<'_, DataStore>,
    extension_id: String,
) -> Result<Vec<TrustedBinary>, AppError> {
    let conn = db.conn()?;
    shell_storage::list_trusted(&conn, &extension_id)
}

#[tauri::command]
pub fn shell_list(
    shell_registry: State<'_, ShellProcessRegistry>,
    extension_permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: String,
) -> Result<Vec<ShellDescriptor>, AppError> {
    shell_list_inner(&shell_registry, &extension_permissions, extension_id)
}

#[tauri::command]
pub fn shell_attach(
    app: AppHandle,
    shell_registry: State<'_, ShellProcessRegistry>,
    extension_permissions: State<'_, ExtensionPermissionRegistry>,
    extension_id: String,
    spawn_id: String,
) -> Result<ShellDescriptor, AppError> {
    let outcome = shell_attach_inner(
        &shell_registry,
        &extension_permissions,
        extension_id,
        spawn_id,
    )?;
    if let Some(terminal) = outcome.terminal {
        match terminal {
            TerminalEmit::Done {
                spawn_id,
                exit_code,
            } => {
                let _ = app.emit(
                    "asyar:shell:done",
                    shell::ShellDonePayload {
                        spawn_id,
                        exit_code,
                    },
                );
            }
        }
    }
    Ok(outcome.descriptor)
}

#[derive(Debug)]
pub(crate) struct AttachOutcome {
    pub descriptor: ShellDescriptor,
    pub terminal: Option<TerminalEmit>,
}

#[derive(Debug)]
pub(crate) enum TerminalEmit {
    Done {
        spawn_id: String,
        exit_code: Option<i32>,
    },
}

pub(crate) fn shell_list_inner(
    registry: &ShellProcessRegistry,
    permissions: &ExtensionPermissionRegistry,
    extension_id: String,
) -> Result<Vec<ShellDescriptor>, AppError> {
    permissions.check(&Some(extension_id.clone()), REQUIRED_PERMISSION)?;
    registry.list_for_extension(&extension_id)
}

pub(crate) fn shell_attach_inner(
    registry: &ShellProcessRegistry,
    permissions: &ExtensionPermissionRegistry,
    extension_id: String,
    spawn_id: String,
) -> Result<AttachOutcome, AppError> {
    permissions.check(&Some(extension_id.clone()), REQUIRED_PERMISSION)?;

    let entry = match registry.get(&spawn_id, &extension_id)? {
        Some(e) => e,
        None => {
            if registry.contains(&spawn_id)? {
                return Err(AppError::Permission(format!(
                    "spawnId \"{}\" does not belong to extension \"{}\"",
                    spawn_id, extension_id
                )));
            }
            return Err(AppError::NotFound(format!(
                "spawnId \"{}\" is not tracked",
                spawn_id
            )));
        }
    };

    let descriptor = ShellDescriptor {
        spawn_id: spawn_id.clone(),
        program: entry.program.clone(),
        args: entry.args.clone(),
        pid: entry.pid,
        started_at: entry.started_at,
    };

    let terminal = if entry.finished {
        Some(TerminalEmit::Done {
            spawn_id,
            exit_code: entry.exit_code,
        })
    } else {
        None
    };

    Ok(AttachOutcome {
        descriptor,
        terminal,
    })
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

    fn empty_permissions() -> ExtensionPermissionRegistry {
        ExtensionPermissionRegistry::new()
    }

    fn seeded_registry() -> ShellProcessRegistry {
        ShellProcessRegistry::new()
    }

    #[test]
    fn shell_list_requires_permission() {
        let registry = seeded_registry();
        registry
            .register_spawn("s1", "ext-a", "/bin/echo", &["hi".into()], 100)
            .unwrap();
        let perms = empty_permissions();
        let err = shell_list_inner(&registry, &perms, "ext-a".into()).unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn shell_list_returns_only_callers_live_spawns() {
        let registry = seeded_registry();
        registry
            .register_spawn("s1", "ext-a", "/bin/echo", &[], 100)
            .unwrap();
        registry
            .register_spawn("s2", "ext-b", "/bin/echo", &[], 101)
            .unwrap();
        registry
            .register_spawn("s3", "ext-a", "/bin/echo", &[], 102)
            .unwrap();
        registry.mark_finished("s3", Some(0)).unwrap();

        let perms = registered_permissions("ext-a");
        let list = shell_list_inner(&registry, &perms, "ext-a".into()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].spawn_id, "s1");
    }

    #[test]
    fn shell_attach_requires_permission() {
        let registry = seeded_registry();
        registry
            .register_spawn("s1", "ext-a", "/bin/echo", &[], 100)
            .unwrap();
        let perms = empty_permissions();
        let err =
            shell_attach_inner(&registry, &perms, "ext-a".into(), "s1".into()).unwrap_err();
        assert!(matches!(err, AppError::Permission(_)), "got: {err:?}");
    }

    #[test]
    fn shell_attach_live_entry_returns_descriptor_without_terminal() {
        let registry = seeded_registry();
        registry
            .register_spawn("s1", "ext-a", "/bin/echo", &["arg".into()], 100)
            .unwrap();
        let perms = registered_permissions("ext-a");
        let outcome =
            shell_attach_inner(&registry, &perms, "ext-a".into(), "s1".into()).unwrap();
        assert_eq!(outcome.descriptor.spawn_id, "s1");
        assert_eq!(outcome.descriptor.pid, 100);
        assert_eq!(outcome.descriptor.args, vec!["arg".to_string()]);
        assert!(outcome.terminal.is_none());
    }

    #[test]
    fn shell_attach_finished_entry_queues_done_emit() {
        let registry = seeded_registry();
        registry
            .register_spawn("s1", "ext-a", "/bin/echo", &[], 100)
            .unwrap();
        registry.mark_finished("s1", Some(7)).unwrap();
        let perms = registered_permissions("ext-a");
        let outcome =
            shell_attach_inner(&registry, &perms, "ext-a".into(), "s1".into()).unwrap();
        match outcome.terminal {
            Some(TerminalEmit::Done {
                spawn_id,
                exit_code,
            }) => {
                assert_eq!(spawn_id, "s1");
                assert_eq!(exit_code, Some(7));
            }
            None => panic!("expected terminal emit for finished entry"),
        }
    }

    #[test]
    fn shell_attach_cross_extension_is_permission_error_not_not_found() {
        let registry = seeded_registry();
        registry
            .register_spawn("s1", "ext-a", "/bin/echo", &[], 100)
            .unwrap();
        let perms = registered_permissions("ext-b");
        let err =
            shell_attach_inner(&registry, &perms, "ext-b".into(), "s1".into()).unwrap_err();
        assert!(
            matches!(err, AppError::Permission(_)),
            "cross-extension attach must surface as Permission, got: {err:?}"
        );
    }

    #[test]
    fn shell_attach_unknown_spawn_id_is_not_found() {
        let registry = seeded_registry();
        let perms = registered_permissions("ext-a");
        let err =
            shell_attach_inner(&registry, &perms, "ext-a".into(), "nope".into()).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }
}
