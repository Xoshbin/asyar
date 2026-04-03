use crate::error::AppError;
use crate::profile::archive::{self, ArchiveContents, AssetEntry, CategoryEntry};
use crate::profile::encryption;
use serde_json::Value;
use tauri::AppHandle;
use zeroize::Zeroizing;

/// Walk a JSON value and encrypt fields at the given dot-notation paths.
fn encrypt_sensitive_fields(
    value: &mut Value,
    paths: &[String],
    password: &str,
    salt: &[u8],
) -> Result<(), AppError> {
    for path in paths {
        let parts: Vec<&str> = path.split('.').collect();
        if let Some(target) = navigate_to_field(value, &parts) {
            if let Some(plaintext) = target.as_str().map(|s| s.to_owned()) {
                let encrypted = encryption::encrypt_value(&plaintext, password, salt)?;
                *target = Value::String(encrypted);
            }
        }
    }
    Ok(())
}

/// Walk a JSON value and decrypt fields that start with the `enc:` prefix.
fn decrypt_sensitive_fields(
    value: &mut Value,
    password: &str,
    salt: &[u8],
) -> Result<(), AppError> {
    match value {
        Value::String(s) if encryption::is_encrypted(s) => {
            let decrypted = encryption::decrypt_value(s, password, salt)?;
            *s = decrypted;
        }
        Value::Object(map) => {
            for (_key, val) in map.iter_mut() {
                decrypt_sensitive_fields(val, password, salt)?;
            }
        }
        Value::Array(arr) => {
            for val in arr.iter_mut() {
                decrypt_sensitive_fields(val, password, salt)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Strip (nullify) fields at the given dot-notation paths.
fn strip_sensitive_fields(value: &mut Value, paths: &[String]) {
    for path in paths {
        let parts: Vec<&str> = path.split('.').collect();
        if let Some(target) = navigate_to_field(value, &parts) {
            *target = Value::Null;
        }
    }
}

/// Navigate into a nested JSON value by dot-notation path parts.
fn navigate_to_field<'a>(value: &'a mut Value, parts: &[&str]) -> Option<&'a mut Value> {
    let mut current = value;
    for part in parts {
        current = current.get_mut(*part)?;
    }
    Some(current)
}

#[tauri::command]
pub async fn export_profile(
    _app_handle: AppHandle,
    manifest_json: String,
    categories: Vec<CategoryEntry>,
    binary_assets: Vec<AssetEntry>,
    password: Option<String>,
    destination: String,
) -> Result<String, AppError> {
    // Wrap password immediately so it's zeroed on all exit paths (including errors)
    let password: Option<Zeroizing<String>> = password.map(Zeroizing::new);

    // Parse manifest to get the salt
    let manifest: Value = serde_json::from_str(&manifest_json)?;
    let salt_b64 = manifest
        .get("encryptionSalt")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let salt = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        salt_b64,
    )
    .unwrap_or_default();

    // Process each category: encrypt or strip sensitive fields
    let mut processed_categories = Vec::new();
    for cat in &categories {
        let mut json_value: Value = serde_json::from_str(&cat.json_content)?;

        if !cat.sensitive_field_paths.is_empty() {
            match &password {
                Some(pw) if !pw.is_empty() => {
                    encrypt_sensitive_fields(
                        &mut json_value,
                        &cat.sensitive_field_paths,
                        pw,
                        &salt,
                    )?;
                }
                _ => {
                    strip_sensitive_fields(&mut json_value, &cat.sensitive_field_paths);
                }
            }
        }

        processed_categories.push(CategoryEntry {
            filename: cat.filename.clone(),
            json_content: serde_json::to_string_pretty(&json_value)?,
            sensitive_field_paths: cat.sensitive_field_paths.clone(),
        });
    }

    archive::pack_archive(&manifest_json, &processed_categories, &binary_assets, &destination)
        .await?;

    // password (Zeroizing<String>) is dropped and zeroed here automatically

    Ok(destination)
}

#[tauri::command]
pub async fn import_profile(
    file_path: String,
    password: Option<String>,
) -> Result<ArchiveContents, AppError> {
    // Wrap password immediately so it's zeroed on all exit paths (including errors)
    let password: Option<Zeroizing<String>> = password.map(Zeroizing::new);

    let mut contents = archive::unpack_archive(&file_path).await?;

    // If password provided, decrypt sensitive fields in all category files
    if let Some(ref pw) = password {
        if !pw.is_empty() {
            let manifest: Value = serde_json::from_str(&contents.manifest_json)?;
            let salt_b64 = manifest
                .get("encryptionSalt")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let salt = base64::Engine::decode(
                &base64::engine::general_purpose::STANDARD,
                salt_b64,
            )
            .unwrap_or_default();

            for (_filename, json_str) in contents.category_files.iter_mut() {
                let mut value: Value = serde_json::from_str(json_str)?;
                decrypt_sensitive_fields(&mut value, pw, &salt)?;
                *json_str = serde_json::to_string_pretty(&value)?;
            }
        }
    }

    // password (Zeroizing<String>) is dropped and zeroed here automatically

    Ok(contents)
}

#[tauri::command]
pub async fn show_save_profile_dialog(
    app_handle: AppHandle,
    default_filename: String,
) -> Result<Option<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;
    let result = app_handle
        .dialog()
        .file()
        .set_file_name(&default_filename)
        .add_filter("Asyar Profile", &["asyar"])
        .blocking_save_file();
    Ok(result.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn show_open_profile_dialog(
    app_handle: AppHandle,
) -> Result<Option<String>, AppError> {
    use tauri_plugin_dialog::DialogExt;
    let result = app_handle
        .dialog()
        .file()
        .add_filter("Asyar Profile", &["asyar"])
        .blocking_pick_file();
    Ok(result.map(|p| p.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_sensitive_fields_at_top_level() {
        let mut value = serde_json::json!({
            "provider": "openai",
            "apiKey": "sk-secret-123",
            "temperature": 0.7
        });
        let paths = vec!["apiKey".to_string()];
        encrypt_sensitive_fields(&mut value, &paths, "pw", b"salt-1234567890a").unwrap();

        assert!(value["apiKey"].as_str().unwrap().starts_with("enc:aes256gcm:"));
        assert_eq!(value["provider"], "openai");
        assert_eq!(value["temperature"], 0.7);
    }

    #[test]
    fn encrypt_nested_field() {
        let mut value = serde_json::json!({
            "auth": { "token": "my-secret-token" }
        });
        let paths = vec!["auth.token".to_string()];
        encrypt_sensitive_fields(&mut value, &paths, "pw", b"salt-1234567890a").unwrap();

        assert!(value["auth"]["token"]
            .as_str()
            .unwrap()
            .starts_with("enc:aes256gcm:"));
    }

    #[test]
    fn strip_sensitive_fields_nullifies() {
        let mut value = serde_json::json!({
            "provider": "openai",
            "apiKey": "sk-secret",
        });
        strip_sensitive_fields(&mut value, &["apiKey".to_string()]);
        assert!(value["apiKey"].is_null());
        assert_eq!(value["provider"], "openai");
    }

    #[test]
    fn decrypt_walks_object_tree() {
        let mut value = serde_json::json!({
            "provider": "openai",
            "apiKey": "plain-text",
        });
        // First encrypt
        let paths = vec!["apiKey".to_string()];
        encrypt_sensitive_fields(&mut value, &paths, "pw", b"salt-1234567890a").unwrap();

        // Then decrypt
        decrypt_sensitive_fields(&mut value, "pw", b"salt-1234567890a").unwrap();
        assert_eq!(value["apiKey"], "plain-text");
    }

    #[test]
    fn nonexistent_path_is_silently_skipped() {
        let mut value = serde_json::json!({"key": "val"});
        let paths = vec!["nonexistent.deeply.nested".to_string()];
        // Should not panic
        encrypt_sensitive_fields(&mut value, &paths, "pw", b"salt-1234567890a").unwrap();
        assert_eq!(value["key"], "val");
    }
}
