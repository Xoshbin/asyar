use crate::auth::state::AuthUser;
use crate::error::AppError;
use crate::profile::encryption;
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
/// casual file reading. Uses the path string as key material with a
/// dynamic hash salt so the key is deterministic per installation.
fn machine_key(app: &AppHandle) -> Result<(String, Vec<u8>), AppError> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("Failed to resolve app data directory: {e}")))?
        .to_string_lossy()
        .to_string();

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update(b":auth-token-salt");
    let salt = hasher.finalize().to_vec();

    Ok((path, salt))
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

    let (password, salt) = machine_key(app)?;
    let encrypted_token = encryption::encrypt_value(token, &password, &salt)?;

    let cached_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    store.set(KEY_TOKEN, serde_json::json!(encrypted_token));
    store.set(KEY_USER, serde_json::to_value(user)?);
    store.set(KEY_ENTITLEMENTS, serde_json::to_value(entitlements)?);
    store.set(KEY_CACHED_AT, serde_json::json!(cached_at));
    store
        .save()
        .map_err(|e| AppError::Other(format!("Failed to save auth store: {}", e)))?;

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

    let (password, salt) = match machine_key(app) {
        Ok(res) => res,
        Err(e) => {
            log::warn!("Failed to resolve machine key: {e}");
            return Ok(None);
        }
    };
    let token = match encryption::decrypt_value(&encrypted_token, &password, &salt) {
        Ok(t) => t,
        Err(e) => {
            log::warn!("Failed to decrypt auth token, clearing auth store: {e}");
            let _ = clear_auth(app);
            return Ok(None);
        }
    };

    let user: AuthUser = match store
        .get(KEY_USER)
        .and_then(|v| serde_json::from_value(v).ok())
    {
        Some(u) => u,
        None => {
            log::warn!("Missing or invalid user in auth store, clearing auth store");
            let _ = clear_auth(app);
            return Ok(None);
        }
    };

    let entitlements: Vec<String> = store
        .get(KEY_ENTITLEMENTS)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let cached_at: i64 = store
        .get(KEY_CACHED_AT)
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    Ok(Some(StoredAuth {
        token,
        user,
        entitlements,
        cached_at,
    }))
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
    store
        .save()
        .map_err(|e| AppError::Other(format!("Failed to save auth store: {}", e)))?;

    Ok(())
}

/// Update cached entitlements without touching the token or user.
pub fn update_entitlements(app: &AppHandle, entitlements: &[String]) -> Result<(), AppError> {
    let store = app
        .store(AUTH_STORE_FILE)
        .map_err(|e| AppError::Other(format!("Failed to open auth store: {}", e)))?;

    let cached_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    store.set(KEY_ENTITLEMENTS, serde_json::to_value(entitlements)?);
    store.set(KEY_CACHED_AT, serde_json::json!(cached_at));
    store
        .save()
        .map_err(|e| AppError::Other(format!("Failed to save auth store: {}", e)))?;

    Ok(())
}
