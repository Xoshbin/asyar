use std::path::{Path};
use crate::error::AppError;
use super::{ExtensionManifest, ExtensionRecord, CompatibilityStatus};
use log::{info, warn};
use semver::{Version, VersionReq};

/// The SDK version supported by this build of the app.
/// Automatically updated by the release script (scripts/release.js).
const SUPPORTED_SDK_VERSION: &str = "1.3.4";

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
                    manifest: manifest.clone(),
                    enabled: true, // Will be updated from settings later
                    is_built_in,
                    path: path.to_string_lossy().to_string(),
                    compatibility: if is_built_in {
                        CompatibilityStatus::Compatible
                    } else {
                        validate_compatibility(&manifest)
                    },
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
        .map_err(AppError::Io)?;
    let manifest: ExtensionManifest = serde_json::from_str(&content)
        .map_err(AppError::Json)?;
    Ok(manifest)
}

/// Check if an extension's declared requirements are compatible with this app.
pub fn validate_compatibility(manifest: &ExtensionManifest) -> CompatibilityStatus {
    // Platform check — most fundamental gate, evaluated first
    if let Some(ref platforms) = manifest.platforms {
        let current_os = std::env::consts::OS;
        if !platforms.iter().any(|p| p.as_str() == current_os) {
            return CompatibilityStatus::PlatformNotSupported {
                platform: current_os.to_string(),
                supported: platforms.clone(),
            };
        }
    }

    let app_version_str = env!("CARGO_PKG_VERSION");

    // Check asyarSdk requirement
    if let Some(ref sdk_req_str) = manifest.asyar_sdk {
        match VersionReq::parse(sdk_req_str) {
            Ok(req) => {
                match Version::parse(SUPPORTED_SDK_VERSION) {
                    Ok(supported) => {
                        if !req.matches(&supported) {
                            return CompatibilityStatus::SdkMismatch {
                                required: sdk_req_str.clone(),
                                supported: SUPPORTED_SDK_VERSION.to_string(),
                            };
                        }
                    }
                    Err(_) => {
                        // Our own version string is invalid — shouldn't happen, treat as compatible
                        warn!("Failed to parse SUPPORTED_SDK_VERSION: {}", SUPPORTED_SDK_VERSION);
                    }
                }
            }
            Err(_) => {
                warn!(
                    "Extension {} has invalid asyarSdk requirement: {}",
                    manifest.id, sdk_req_str
                );
                // Invalid semver range — treat as unknown rather than blocking
                return CompatibilityStatus::Unknown;
            }
        }
    }

    // Check minAppVersion requirement
    if let Some(ref min_app_str) = manifest.min_app_version {
        match (Version::parse(min_app_str), Version::parse(app_version_str)) {
            (Ok(required), Ok(current)) => {
                if current < required {
                    return CompatibilityStatus::AppVersionTooOld {
                        required: min_app_str.clone(),
                        current: app_version_str.to_string(),
                    };
                }
            }
            _ => {
                warn!(
                    "Failed to parse version strings for minAppVersion check: min={}, current={}",
                    min_app_str, app_version_str
                );
            }
        }
    }

    // If asyarSdk was declared and passed, it's Compatible
    // If neither field was set, it's Unknown
    if manifest.asyar_sdk.is_some() {
        CompatibilityStatus::Compatible
    } else {
        CompatibilityStatus::Unknown
    }
}

#[cfg(test)]
mod compatibility_tests {
    use super::*;
    use crate::extensions::{ExtensionManifest, CompatibilityStatus};

    fn test_manifest(asyar_sdk: Option<&str>, min_app_version: Option<&str>) -> ExtensionManifest {
        ExtensionManifest {
            id: "test.extension".to_string(),
            name: "Test".to_string(),
            version: "1.0.0".to_string(),
            description: "Test extension".to_string(),
            author: None,
            extension_type: None,
            default_view: None,
            searchable: None,
            icon: None,
            main: None,
            commands: vec![],
            permissions: None,
            min_app_version: min_app_version.map(String::from),
            asyar_sdk: asyar_sdk.map(String::from),
            platforms: None,
        }
    }

    fn make_manifest_with_platforms(platforms: Option<Vec<String>>) -> ExtensionManifest {
        let mut m = test_manifest(Some("^1.0.0"), None);
        m.platforms = platforms;
        m
    }

    #[test]
    fn test_no_version_fields_returns_unknown() {
        let manifest = test_manifest(None, None);
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Unknown);
    }

    #[test]
    fn test_compatible_sdk_range() {
        let manifest = test_manifest(Some("^1.0.0"), None);
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Compatible);
    }

    #[test]
    fn test_compatible_exact_sdk() {
        let manifest = test_manifest(Some("1.3.4"), None);
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Compatible);
    }

    #[test]
    fn test_incompatible_sdk_major() {
        let manifest = test_manifest(Some("^2.0.0"), None);
        match validate_compatibility(&manifest) {
            CompatibilityStatus::SdkMismatch { required, supported } => {
                assert_eq!(required, "^2.0.0");
                assert_eq!(supported, SUPPORTED_SDK_VERSION);
            }
            other => panic!("Expected SdkMismatch, got {:?}", other),
        }
    }

    #[test]
    fn test_incompatible_sdk_minor() {
        // ^1.4.0 requires at least 1.4.0, but we support 1.3.4
        let manifest = test_manifest(Some("^1.4.0"), None);
        match validate_compatibility(&manifest) {
            CompatibilityStatus::SdkMismatch { required, supported: _ } => {
                assert_eq!(required, "^1.4.0");
            }
            other => panic!("Expected SdkMismatch, got {:?}", other),
        }
    }

    #[test]
    fn test_app_version_satisfied() {
        // Use "0.0.1" which should always be <= current app version
        let manifest = test_manifest(None, Some("0.0.1"));
        // No asyarSdk field, so result is Unknown (minAppVersion passed but doesn't upgrade to Compatible)
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Unknown);
    }

    #[test]
    fn test_app_version_too_old() {
        let manifest = test_manifest(None, Some("99.0.0"));
        match validate_compatibility(&manifest) {
            CompatibilityStatus::AppVersionTooOld { required, current: _ } => {
                assert_eq!(required, "99.0.0");
            }
            other => panic!("Expected AppVersionTooOld, got {:?}", other),
        }
    }

    #[test]
    fn test_both_fields_compatible() {
        let manifest = test_manifest(Some("^1.0.0"), Some("0.0.1"));
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Compatible);
    }

    #[test]
    fn test_invalid_sdk_range_returns_unknown() {
        let manifest = test_manifest(Some("not-semver"), None);
        assert_eq!(validate_compatibility(&manifest), CompatibilityStatus::Unknown);
    }

    #[test]
    fn test_platforms_absent_allows_any_os() {
        let manifest = make_manifest_with_platforms(None);
        let result = validate_compatibility(&manifest);
        assert!(!matches!(result, CompatibilityStatus::PlatformNotSupported { .. }));
    }

    #[test]
    fn test_current_os_in_platforms_list_is_allowed() {
        let os = std::env::consts::OS;
        let manifest = make_manifest_with_platforms(Some(vec![os.to_string()]));
        assert!(!matches!(validate_compatibility(&manifest), CompatibilityStatus::PlatformNotSupported { .. }));
    }

    #[test]
    fn test_os_not_in_platforms_list_returns_not_supported() {
        let others: Vec<String> = ["macos", "windows", "linux"]
            .iter()
            .filter(|&&p| p != std::env::consts::OS)
            .map(|s| s.to_string())
            .collect();
        if others.is_empty() { return; }
        let manifest = make_manifest_with_platforms(Some(others.clone()));
        match validate_compatibility(&manifest) {
            CompatibilityStatus::PlatformNotSupported { platform, supported } => {
                assert_eq!(platform, std::env::consts::OS);
                assert_eq!(supported, others);
            }
            other => panic!("Expected PlatformNotSupported, got {:?}", other),
        }
    }

    #[test]
    fn test_empty_platforms_list_returns_not_supported() {
        let manifest = make_manifest_with_platforms(Some(vec![]));
        assert!(matches!(validate_compatibility(&manifest), CompatibilityStatus::PlatformNotSupported { .. }));
    }
}
