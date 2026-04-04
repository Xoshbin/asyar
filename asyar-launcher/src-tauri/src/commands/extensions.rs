//! Extension command handlers — thin wrappers delegating to extension service modules.

use crate::error::AppError;
use crate::extensions::{self, ExtensionRegistryState, ExtensionRecord, headless::HeadlessRegistry};
use std::collections::HashMap;
use tauri::AppHandle;

#[tauri::command]
pub async fn check_path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
pub async fn uninstall_extension(
    app_handle: AppHandle,
    registry: tauri::State<'_, ExtensionRegistryState>,
    extension_id: String,
) -> Result<(), AppError> {
    extensions::lifecycle::uninstall(&app_handle, &extension_id, &registry)
}

#[tauri::command]
pub async fn install_extension_from_url(
    app_handle: AppHandle,
    download_url: String,
    extension_id: String,
    extension_name: String,
    version: String,
    checksum: Option<String>,
) -> Result<(), AppError> {
    extensions::installer::install_from_url(
        &app_handle, &download_url, &extension_id, &extension_name, &version, checksum.as_deref()
    ).await
}

#[tauri::command]
pub async fn get_extensions_dir(app_handle: AppHandle) -> Result<String, AppError> {
    extensions::get_extensions_dir(&app_handle)
}

#[tauri::command]
pub async fn list_installed_extensions(app_handle: AppHandle) -> Result<Vec<String>, AppError> {
    extensions::lifecycle::list_installed(&app_handle)
}

#[tauri::command]
pub async fn get_builtin_features_path(app_handle: AppHandle) -> Result<String, AppError> {
    extensions::get_builtin_features_path(&app_handle)
}

#[tauri::command]
pub async fn register_dev_extension(
    app_handle: AppHandle,
    extension_id: String,
    path: String,
) -> Result<(), AppError> {
    let dev_extensions_file = extensions::get_app_data_dir(&app_handle)?.join("dev_extensions.json");
    let mut dev_extensions: HashMap<String, String> = if dev_extensions_file.exists() {
        let content = std::fs::read_to_string(&dev_extensions_file)?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        HashMap::new()
    };
    dev_extensions.insert(extension_id, path);
    std::fs::write(&dev_extensions_file, serde_json::to_string_pretty(&dev_extensions)?)?;
    Ok(())
}

#[tauri::command]
pub async fn get_dev_extension_paths(app_handle: AppHandle) -> Result<HashMap<String, String>, AppError> {
    extensions::get_dev_extension_paths(&app_handle)
}

#[tauri::command]
pub async fn discover_extensions(
    app_handle: AppHandle,
    registry: tauri::State<'_, ExtensionRegistryState>,
) -> Result<Vec<ExtensionRecord>, AppError> {
    extensions::lifecycle::discover_all(&app_handle, &registry)
}

#[tauri::command]
pub async fn set_extension_enabled(
    app_handle: AppHandle,
    registry: tauri::State<'_, ExtensionRegistryState>,
    extension_id: String,
    enabled: bool,
) -> Result<(), AppError> {
    extensions::lifecycle::set_enabled(&app_handle, &registry, &extension_id, enabled)
}

#[tauri::command]
pub async fn get_extension(
    registry: tauri::State<'_, ExtensionRegistryState>,
    extension_id: String,
) -> Result<ExtensionRecord, AppError> {
    let reg = registry.extensions.lock().map_err(|_| crate::error::AppError::Lock)?;
    reg.get(&extension_id)
        .cloned()
        .ok_or_else(|| crate::error::AppError::NotFound(format!("Extension not found: {}", extension_id)))
}

#[tauri::command]
pub fn spawn_headless_extension(
    id: String,
    path: String,
    state: tauri::State<'_, HeadlessRegistry>,
) -> Result<bool, AppError> {
    extensions::headless::spawn(&id, &path, &state)
}

#[tauri::command]
pub fn kill_extension(
    id: String,
    state: tauri::State<'_, HeadlessRegistry>,
) -> Result<bool, AppError> {
    extensions::headless::kill(&id, &state)
}

#[tauri::command]
pub async fn check_extension_updates(
    registry: tauri::State<'_, ExtensionRegistryState>,
    store_api_base_url: String,
) -> Result<Vec<extensions::updater::AvailableUpdate>, AppError> {
    extensions::updater::check_for_updates(&registry, &store_api_base_url).await
}

#[tauri::command]
pub async fn update_extension(
    app_handle: AppHandle,
    update: extensions::updater::AvailableUpdate,
) -> Result<(), AppError> {
    extensions::updater::update_extension(&app_handle, &update).await
}

#[tauri::command]
pub async fn update_all_extensions(
    app_handle: AppHandle,
    updates: Vec<extensions::updater::AvailableUpdate>,
) -> Result<Vec<(String, Result<(), String>)>, AppError> {
    let results = extensions::updater::update_all(&app_handle, &updates).await;
    Ok(results.into_iter().map(|(id, r)| {
        (id, r.map_err(|e| e.to_string()))
    }).collect())
}
