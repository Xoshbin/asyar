use std::path::{Path};
use crate::error::AppError;
use super::{ExtensionManifest, ExtensionRecord};
use log::{info, warn};

/// Scan a directory for extension subdirectories containing manifest.json.
/// Returns a Vec of (extension_id, manifest, directory_path).
pub fn scan_extensions_dir(dir: &Path, is_built_in: bool) -> Vec<ExtensionRecord> {
    let mut records = Vec::new();
    
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            warn!("Could not read extensions directory {:?}: {}", dir, e);
            return records;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        match read_manifest(&manifest_path) {
            Ok(manifest) => {
                let id = manifest.id.clone();
                records.push(ExtensionRecord {
                    manifest,
                    enabled: true, // Will be updated from settings later
                    is_built_in,
                    path: path.to_string_lossy().to_string(),
                });
                info!("Discovered extension: {} at {:?}", id, path);
            }
            Err(e) => {
                warn!("Failed to parse manifest at {:?}: {}", manifest_path, e);
            }
        }
    }

    records
}

/// Read and parse a single manifest.json file
pub fn read_manifest(path: &Path) -> Result<ExtensionManifest, AppError> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| AppError::Io(e))?;
    let manifest: ExtensionManifest = serde_json::from_str(&content)
        .map_err(|e| AppError::Json(e))?;
    Ok(manifest)
}
