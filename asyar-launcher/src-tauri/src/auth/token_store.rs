use crate::error::AppError;
use crate::profile::encryption;
use crate::auth::state::AuthUser;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

const AUTH_STORE_FILE: &str = "auth.dat";
const KEY_TOKEN: &str = "token";
const KEY_USER: &str = "user";
const KEY_ENTITLEMENTS: &str = "entitlements";
const KEY_CACHED_AT: &str = "entitlements_cached_at";

/// The full auth payload stored in auth.dat.
#[derive(Debug, Serialize, Deserialize)]
pub struct StoredAuth {
    pub token: String,
    pub user: AuthUser,
    pub entitlements: Vec<String>,
    pub cached_at: i64,
}

/// Derive a stable "machine password" from the app data dir path.
/// Not a cryptographic secret — provides defense-in-depth against
/// casual file reading. Uses the path string as a password with a
/// fixed salt so the key is deterministic per installation.
fn machine_key(app: &AppHandle) -> (String, Vec<u8>) {
    let path = app
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "asyar-fallback".to_string());
    let salt = b"asyar-auth-salt-v1".to_vec();
    (path, salt)
}

/// Persist auth data to auth.dat. The token is encrypted; user and
/// entitlements are stored as plain JSON (not sensitive on their own).
pub fn save_auth(
    app: &AppHandle,
    token: &str,
    user: &AuthUser,
    entitlements: &[String],
) -> Result<(), AppError> {
    let store = app
        .store(AUTH_STORE_FILE)
        .map_err(|e| AppError::Other(format!("Failed to open auth store: {}", e)))?;

    let (password, salt) = machine_key(app);
    let encrypted_token = encryption::encrypt_value(token, &password, &salt)?;

    let cached_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    store.set(KEY_TOKEN, serde_json::json!(encrypted_token));
    store.set(KEY_USER, serde_json::to_value(user)?);
    store.set(KEY_ENTITLEMENTS, serde_json::to_value(entitlements)?);
    store.set(KEY_CACHED_AT, serde_json::json!(cached_at));
    store.save().map_err(|e| AppError::Other(format!("Failed to save auth store: {}", e)))?;

    Ok(())
}

/// Load auth data from auth.dat. Returns None if not logged in.
pub fn load_auth(app: &AppHandle) -> Result<Option<StoredAuth>, AppError> {
    let store = app
        .store(AUTH_STORE_FILE)
        .map_err(|e| AppError::Other(format!("Failed to open auth store: {}", e)))?;

    let encrypted_token = match store.get(KEY_TOKEN) {
        Some(v) => v.as_str().unwrap_or("").to_string(),
        None => return Ok(None),
    };

    if encrypted_token.is_empty() {
        return Ok(None);
    }

    let (password, salt) = machine_key(app);
    let token = encryption::decrypt_value(&encrypted_token, &password, &salt)?;

    let user: AuthUser = store
        .get(KEY_USER)
        .and_then(|v| serde_json::from_value(v).ok())
        .ok_or_else(|| AppError::Other("Missing user in auth store".into()))?;

    let entitlements: Vec<String> = store
        .get(KEY_ENTITLEMENTS)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let cached_at: i64 = store
        .get(KEY_CACHED_AT)
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    Ok(Some(StoredAuth { token, user, entitlements, cached_at }))
}

/// Clear all auth data from auth.dat.
pub fn clear_auth(app: &AppHandle) -> Result<(), AppError> {
    let store = app
        .store(AUTH_STORE_FILE)
        .map_err(|e| AppError::Other(format!("Failed to open auth store: {}", e)))?;

    store.delete(KEY_TOKEN);
    store.delete(KEY_USER);
    store.delete(KEY_ENTITLEMENTS);
    store.delete(KEY_CACHED_AT);
    store.save().map_err(|e| AppError::Other(format!("Failed to save auth store: {}", e)))?;

    Ok(())
}

/// Update cached entitlements without touching the token or user.
pub fn update_entitlements(
    app: &AppHandle,
    entitlements: &[String],
) -> Result<(), AppError> {
    let store = app
        .store(AUTH_STORE_FILE)
        .map_err(|e| AppError::Other(format!("Failed to open auth store: {}", e)))?;

    let cached_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    store.set(KEY_ENTITLEMENTS, serde_json::to_value(entitlements)?);
    store.set(KEY_CACHED_AT, serde_json::json!(cached_at));
    store.save().map_err(|e| AppError::Other(format!("Failed to save auth store: {}", e)))?;

    Ok(())
}
