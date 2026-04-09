use crate::error::AppError;
use crate::permissions::ExtensionPermissionRegistry;
use crate::storage::{DataStore, shell::{self as shell_storage, TrustedBinary}};
use crate::shell::{self, ShellProcessRegistry};
use tauri::{AppHandle, State};

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn shell_spawn(
    app: AppHandle,
    db: State<'_, DataStore>,
    extension_permissions: State<'_, ExtensionPermissionRegistry>,
    shell_registry: State<'_, ShellProcessRegistry>,
    extension_id: String,
    spawn_id: String,
    program: String,
    args: Vec<String>,
) -> Result<(), AppError> {
    extension_permissions.check(&Some(extension_id.clone()), "asyar:service:ShellService:spawn")?;

    let conn = db.conn()?;
    let trusted = shell_storage::is_trusted(&conn, &extension_id, &program)?;
    drop(conn);

    if !trusted {
        return Err(AppError::Permission(format!(
            "Binary \"{}\" is not trusted for extension \"{}\".",
            program, extension_id
        )));
    }

    shell::spawn(app, &shell_registry, spawn_id, program, args)
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
