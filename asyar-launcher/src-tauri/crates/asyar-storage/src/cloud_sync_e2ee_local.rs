//! Single-row mirror of the server's `cloud_sync_e2ee_state` row.
//!
//! Refreshed on every successful pull. If lost (DB corruption), the
//! next sync re-fetches it from the server.
//!
//! Disenrolment is performed via [`clear`], not by upserting
//! `enrolled = false`. The `enrolled` column exists for forward
//! compatibility with future flows that want to keep the row but
//! pause sync; current callers should use `clear()` to fully remove.

use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct E2eeLocalState {
    pub enrolled: bool,
    pub key_version: i64,
    pub wrapped_master_seed: Option<String>,
    /// Exactly 32 bytes per the server's enrolment contract when present. Stored as
    /// `Vec<u8>` for serde flexibility; not length-validated locally
    /// because the server already enforces the bound at write time.
    pub kdf_salt: Option<Vec<u8>>,
    pub kdf_m_cost: Option<i64>,
    pub kdf_t_cost: Option<i64>,
    pub kdf_p_cost: Option<i64>,
    pub updated_at_ms: i64,
    /// "passphrase" or "device-key"
    pub mode: String,
    /// 32-byte HMAC-SHA256(S, "asyar-sync-kcv-v1") key check value for device-key mode
    pub kcv: Option<Vec<u8>>,
    /// Set true when plaintext rows need to be migrated/purged via POST /e2ee/finalize
    pub finalize_pending: bool,
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS cloud_sync_e2ee_local (
            scope                 TEXT PRIMARY KEY CHECK (scope = 'global'),
            enrolled              INTEGER NOT NULL,
            key_version           INTEGER NOT NULL,
            wrapped_master_seed   TEXT,
            kdf_salt              BLOB,
            kdf_m_cost            INTEGER,
            kdf_t_cost            INTEGER,
            kdf_p_cost            INTEGER,
            updated_at_ms         INTEGER NOT NULL,
            mode                  TEXT NOT NULL DEFAULT 'passphrase',
            kcv                   BLOB,
            finalize_pending      INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )
    .map_err(|e| AppError::Database(format!("init e2ee_local: {e}")))?;
    Ok(())
}

pub fn upsert(conn: &Connection, state: &E2eeLocalState) -> Result<(), AppError> {
    conn.execute(
        r#"
        INSERT INTO cloud_sync_e2ee_local
          (scope, enrolled, key_version, wrapped_master_seed,
           kdf_salt, kdf_m_cost, kdf_t_cost, kdf_p_cost, updated_at_ms,
           mode, kcv, finalize_pending)
        VALUES ('global', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(scope) DO UPDATE SET
          enrolled            = excluded.enrolled,
          key_version         = excluded.key_version,
          wrapped_master_seed = excluded.wrapped_master_seed,
          kdf_salt            = excluded.kdf_salt,
          kdf_m_cost          = excluded.kdf_m_cost,
          kdf_t_cost          = excluded.kdf_t_cost,
          kdf_p_cost          = excluded.kdf_p_cost,
          updated_at_ms       = excluded.updated_at_ms,
          mode                = excluded.mode,
          kcv                 = excluded.kcv,
          finalize_pending    = excluded.finalize_pending
        "#,
        params![
            if state.enrolled { 1 } else { 0 },
            state.key_version,
            state.wrapped_master_seed,
            state.kdf_salt,
            state.kdf_m_cost,
            state.kdf_t_cost,
            state.kdf_p_cost,
            state.updated_at_ms,
            state.mode,
            state.kcv,
            if state.finalize_pending { 1 } else { 0 },
        ],
    )
    .map_err(|e| AppError::Database(format!("upsert e2ee_local: {e}")))?;
    Ok(())
}

pub fn get(conn: &Connection) -> Result<Option<E2eeLocalState>, AppError> {
    conn.query_row(
        r#"
        SELECT enrolled, key_version, wrapped_master_seed,
               kdf_salt, kdf_m_cost, kdf_t_cost, kdf_p_cost, updated_at_ms,
               mode, kcv, finalize_pending
        FROM cloud_sync_e2ee_local
        WHERE scope = 'global'
        "#,
        [],
        |row| {
            Ok(E2eeLocalState {
                enrolled: row.get::<_, i64>(0)? != 0,
                key_version: row.get(1)?,
                wrapped_master_seed: row.get(2)?,
                kdf_salt: row.get(3)?,
                kdf_m_cost: row.get(4)?,
                kdf_t_cost: row.get(5)?,
                kdf_p_cost: row.get(6)?,
                updated_at_ms: row.get(7)?,
                mode: row.get(8)?,
                kcv: row.get(9)?,
                finalize_pending: row.get::<_, i64>(10)? != 0,
            })
        },
    )
    .optional()
    .map_err(|e| AppError::Database(format!("get e2ee_local: {e}")))
}

pub fn set_finalize_pending(conn: &Connection, pending: bool) -> Result<(), AppError> {
    conn.execute(
        "UPDATE cloud_sync_e2ee_local SET finalize_pending = ?1 WHERE scope = 'global'",
        params![if pending { 1 } else { 0 }],
    )
    .map_err(|e| AppError::Database(format!("set finalize_pending: {e}")))?;
    Ok(())
}

pub fn clear(conn: &Connection) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM cloud_sync_e2ee_local WHERE scope = 'global'",
        [],
    )
    .map_err(|e| AppError::Database(format!("clear e2ee_local: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::migrations::run(&c).unwrap();
        c
    }

    fn fixture() -> E2eeLocalState {
        E2eeLocalState {
            enrolled: true,
            key_version: 1,
            wrapped_master_seed: Some("enc:v1:fixture".into()),
            kdf_salt: Some(vec![0x42; 32]),
            kdf_m_cost: Some(65536),
            kdf_t_cost: Some(3),
            kdf_p_cost: Some(1),
            updated_at_ms: 1_700_000_000_000,
            mode: "passphrase".into(),
            kcv: None,
            finalize_pending: false,
        }
    }

    #[test]
    fn init_creates_table() {
        let c = fresh_conn();
        let count: i64 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='cloud_sync_e2ee_local'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn upsert_then_get_roundtrips() {
        let c = fresh_conn();
        let s = fixture();
        upsert(&c, &s).unwrap();
        let got = get(&c).unwrap().unwrap();
        assert_eq!(got, s);
    }

    #[test]
    fn upsert_replaces_existing() {
        let c = fresh_conn();
        let mut s = fixture();
        upsert(&c, &s).unwrap();
        s.key_version = 7;
        s.wrapped_master_seed = Some("enc:v1:rotated".into());
        upsert(&c, &s).unwrap();
        let got = get(&c).unwrap().unwrap();
        assert_eq!(got.key_version, 7);
        assert_eq!(got.wrapped_master_seed.as_deref(), Some("enc:v1:rotated"));
    }

    #[test]
    fn upsert_device_key_mode_allows_null_kdf() {
        let c = fresh_conn();
        let s = E2eeLocalState {
            enrolled: true,
            key_version: 2,
            wrapped_master_seed: None,
            kdf_salt: None,
            kdf_m_cost: None,
            kdf_t_cost: None,
            kdf_p_cost: None,
            updated_at_ms: 1_700_000_000_100,
            mode: "device-key".into(),
            kcv: Some(vec![0x77; 32]),
            finalize_pending: true,
        };
        upsert(&c, &s).unwrap();
        let got = get(&c).unwrap().unwrap();
        assert_eq!(got, s);
    }

    #[test]
    fn set_finalize_pending_updates_flag() {
        let c = fresh_conn();
        let s = fixture();
        upsert(&c, &s).unwrap();
        assert!(!get(&c).unwrap().unwrap().finalize_pending);

        set_finalize_pending(&c, true).unwrap();
        assert!(get(&c).unwrap().unwrap().finalize_pending);

        set_finalize_pending(&c, false).unwrap();
        assert!(!get(&c).unwrap().unwrap().finalize_pending);
    }

    #[test]
    fn get_returns_none_when_not_enrolled() {
        let c = fresh_conn();
        assert!(get(&c).unwrap().is_none());
    }

    #[test]
    fn clear_removes_row() {
        let c = fresh_conn();
        upsert(&c, &fixture()).unwrap();
        clear(&c).unwrap();
        assert!(get(&c).unwrap().is_none());
    }
}
