//! Tauri commands exposed to the launcher host for the new tray model.
//!
//! The wire names (`statusBar:registerItem` etc.) live in the TS launcher
//! service; this module is the Rust landing pad.

use crate::error::AppError;
use crate::extension_tray::item::StatusBarItem;
use crate::extension_tray::manager::ExtensionTrayManager;
use tauri::State;

#[tauri::command]
pub fn tray_register_item(
    manager: State<'_, ExtensionTrayManager>,
    item: StatusBarItem,
) -> Result<(), AppError> {
    manager.register_or_update(&item)
}

#[tauri::command]
pub fn tray_update_item(
    manager: State<'_, ExtensionTrayManager>,
    item: StatusBarItem,
) -> Result<(), AppError> {
    manager.register_or_update(&item)
}

#[tauri::command]
pub fn tray_unregister_item(
    manager: State<'_, ExtensionTrayManager>,
    extension_id: String,
    id: String,
) -> Result<(), AppError> {
    manager.unregister(&extension_id, &id)
}

#[tauri::command]
pub fn tray_remove_all_for_extension(
    manager: State<'_, ExtensionTrayManager>,
    extension_id: String,
) -> Result<(), AppError> {
    manager.remove_all_for_extension(&extension_id).map(|_| ())
}
