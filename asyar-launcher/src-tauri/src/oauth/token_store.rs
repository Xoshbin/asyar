use crate::error::AppError;
use crate::oauth::OAuthToken;
use crate::profile::encryption;
use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager};

const SALT: &[u8] = b"asyar-oauth-salt-v1";

fn machine_key(app: &AppHandle) -> String {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "asyar-fallback".to_string())
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS oauth_tokens (
            composite_key TEXT PRIMARY KEY,
            extension_id  TEXT NOT NULL,
            provider_id   TEXT NOT NULL,
            access_token_enc  TEXT NOT NULL,
            refresh_token_enc TEXT,
            token_type    TEXT NOT NULL DEFAULT 'Bearer',
            scopes        TEXT NOT NULL,
            expires_at    INTEGER,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_oauth_tokens_ext_id
            ON oauth_tokens(extension_id);",
    )
    .map_err(|e| AppError::Database(format!("Failed to init oauth_tokens table: {e}")))?;
    Ok(())
}

fn now_secs() -> i64 {
    crate::oauth::service::now_secs()
}

/// Persist an OAuth token for an extension+provider (upsert).
/// access_token and refresh_token are AES-256-GCM encrypted.
pub fn store_token(
    app: &AppHandle,
    conn: &Connection,
    extension_id: &str,
    provider_id: &str,
    token: &OAuthToken,
) -> Result<(), AppError> {
    let password = machine_key(app);
    let composite_key = format!("{extension_id}:{provider_id}");
    let now = now_secs();

    let access_enc = encryption::encrypt_value(&token.access_token, &password, SALT)?;
    let refresh_enc = token
        .refresh_token
        .as_deref()
        .map(|rt| encryption::encrypt_value(rt, &password, SALT))
        .transpose()?;

    let scopes_json = serde_json::to_string(&token.scopes)
        .map_err(|e| AppError::Database(format!("Failed to serialize scopes: {e}")))?;

    conn.execute(
        "INSERT OR REPLACE INTO oauth_tokens
            (composite_key, extension_id, provider_id,
             access_token_enc, refresh_token_enc,
             token_type, scopes, expires_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
             COALESCE(
                 (SELECT created_at FROM oauth_tokens WHERE composite_key = ?1),
                 ?9
             ),
             ?9)",
        params![
            composite_key,
            extension_id,
            provider_id,
            access_enc,
            refresh_enc,
            token.token_type,
            scopes_json,
            token.expires_at,
            now,
        ],
    )
    .map_err(|e| AppError::Database(format!("Failed to store oauth token: {e}")))?;

    Ok(())
}

/// Retrieve a stored token for an extension+provider. Returns None if not found.
pub fn get_token(
    app: &AppHandle,
    conn: &Connection,
    extension_id: &str,
    provider_id: &str,
) -> Result<Option<OAuthToken>, AppError> {
    let composite_key = format!("{extension_id}:{provider_id}");

    let result = conn.query_row(
        "SELECT access_token_enc, refresh_token_enc, token_type, scopes, expires_at
         FROM oauth_tokens
         WHERE composite_key = ?1",
        params![composite_key],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<i64>>(4)?,
            ))
        },
    );

    match result {
        Ok((access_enc, refresh_enc, token_type, scopes_json, expires_at)) => {
            let password = machine_key(app);
            let access_token = encryption::decrypt_value(&access_enc, &password, SALT)?;
            let refresh_token = refresh_enc
                .map(|enc| encryption::decrypt_value(&enc, &password, SALT))
                .transpose()?;
            let scopes: Vec<String> = serde_json::from_str(&scopes_json)
                .map_err(|e| AppError::Database(format!("Failed to parse scopes: {e}")))?;
            Ok(Some(OAuthToken {
                access_token,
                refresh_token,
                token_type,
                scopes,
                expires_at,
            }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(format!("Failed to get oauth token: {e}"))),
    }
}

/// Delete the stored token for a specific extension+provider.
pub fn delete_token(
    conn: &Connection,
    extension_id: &str,
    provider_id: &str,
) -> Result<(), AppError> {
    let composite_key = format!("{extension_id}:{provider_id}");
    conn.execute(
        "DELETE FROM oauth_tokens WHERE composite_key = ?1",
        params![composite_key],
    )
    .map_err(|e| AppError::Database(format!("Failed to delete oauth token: {e}")))?;
    Ok(())
}

/// Delete all stored tokens for an extension (called during uninstall).
/// Returns the number of rows deleted.
pub fn delete_all_for_extension(conn: &Connection, extension_id: &str) -> Result<u64, AppError> {
    let count = conn
        .execute(
            "DELETE FROM oauth_tokens WHERE extension_id = ?1",
            params![extension_id],
        )
        .map_err(|e| AppError::Database(format!("Failed to delete oauth tokens: {e}")))?;
    Ok(count as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create an in-memory DB with the oauth_tokens table.
    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_table(&conn).unwrap();
        conn
    }

    // Tests that don't need encryption (no AppHandle) test the SQL logic.
    // Encryption round-trip is tested via encryption module directly.
    // Here we test store/get/delete using raw SQL inserts for non-encrypted fields.

    #[test]
    fn init_table_is_idempotent() {
        let conn = setup();
        // Calling a second time should not fail
        init_table(&conn).unwrap();
    }

    #[test]
    fn delete_token_on_missing_row_is_ok() {
        let conn = setup();
        // Should succeed even if nothing to delete
        delete_token(&conn, "ext.a", "github").unwrap();
    }

    #[test]
    fn delete_all_for_extension_returns_zero_when_none() {
        let conn = setup();
        let count = delete_all_for_extension(&conn, "ext.nobody").unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn delete_all_for_extension_removes_only_target() {
        let conn = setup();
        let now = now_secs();

        // Insert two rows for ext.a, one for ext.b
        conn.execute(
            "INSERT INTO oauth_tokens
             (composite_key, extension_id, provider_id, access_token_enc,
              token_type, scopes, created_at, updated_at)
             VALUES ('ext.a:github', 'ext.a', 'github', 'enc:aes256gcm:dummy',
                     'Bearer', '[]', ?1, ?1)",
            params![now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO oauth_tokens
             (composite_key, extension_id, provider_id, access_token_enc,
              token_type, scopes, created_at, updated_at)
             VALUES ('ext.a:notion', 'ext.a', 'notion', 'enc:aes256gcm:dummy2',
                     'Bearer', '[]', ?1, ?1)",
            params![now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO oauth_tokens
             (composite_key, extension_id, provider_id, access_token_enc,
              token_type, scopes, created_at, updated_at)
             VALUES ('ext.b:github', 'ext.b', 'github', 'enc:aes256gcm:dummy3',
                     'Bearer', '[]', ?1, ?1)",
            params![now],
        )
        .unwrap();

        let deleted = delete_all_for_extension(&conn, "ext.a").unwrap();
        assert_eq!(deleted, 2);

        // ext.b row must still exist
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM oauth_tokens WHERE extension_id = 'ext.b'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn upsert_replaces_existing_row() {
        let conn = setup();
        let now = now_secs();

        // Insert original
        conn.execute(
            "INSERT INTO oauth_tokens
             (composite_key, extension_id, provider_id, access_token_enc,
              token_type, scopes, created_at, updated_at)
             VALUES ('ext.a:gh', 'ext.a', 'gh', 'enc:aes256gcm:first',
                     'Bearer', '[]', ?1, ?1)",
            params![now],
        )
        .unwrap();

        // Replace
        conn.execute(
            "INSERT OR REPLACE INTO oauth_tokens
             (composite_key, extension_id, provider_id, access_token_enc,
              token_type, scopes, created_at, updated_at)
             VALUES ('ext.a:gh', 'ext.a', 'gh', 'enc:aes256gcm:second',
                     'Bearer', '[]', ?1, ?1)",
            params![now],
        )
        .unwrap();

        let enc: String = conn
            .query_row(
                "SELECT access_token_enc FROM oauth_tokens WHERE composite_key = 'ext.a:gh'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(enc, "enc:aes256gcm:second");
    }

    #[test]
    fn get_token_returns_none_for_missing_row() {
        // We can test the SQL logic by checking the no-rows case directly
        let conn = setup();

        let result = conn.query_row(
            "SELECT access_token_enc FROM oauth_tokens WHERE composite_key = 'missing'",
            [],
            |r| r.get::<_, String>(0),
        );
        assert!(matches!(result, Err(rusqlite::Error::QueryReturnedNoRows)));
    }

    #[test]
    fn scopes_json_round_trip() {
        let scopes = vec!["repo".to_string(), "user:email".to_string()];
        let json = serde_json::to_string(&scopes).unwrap();
        let parsed: Vec<String> = serde_json::from_str(&json).unwrap();
        assert_eq!(scopes, parsed);
    }
}
