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
    pub wrapped_master_seed: String,
    /// Exactly 32 bytes per the server's enrolment contract. Stored as
    /// `Vec<u8>` for serde flexibility; not length-validated locally
    /// because the server already enforces the bound at write time.
    pub kdf_salt: Vec<u8>,
    pub kdf_m_cost: i64,
    pub kdf_t_cost: i64,
    pub kdf_p_cost: i64,
    pub updated_at_ms: i64,
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS cloud_sync_e2ee_local (
            scope                 TEXT PRIMARY KEY CHECK (scope = 'global'),
            enrolled              INTEGER NOT NULL,
            key_version           INTEGER NOT NULL,
            wrapped_master_seed   TEXT NOT NULL,
            kdf_salt              BLOB NOT NULL,
            kdf_m_cost            INTEGER NOT NULL,
            kdf_t_cost            INTEGER NOT NULL,
            kdf_p_cost            INTEGER NOT NULL,
            updated_at_ms         INTEGER NOT NULL
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
           kdf_salt, kdf_m_cost, kdf_t_cost, kdf_p_cost, updated_at_ms)
        VALUES ('global', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(scope) DO UPDATE SET
          enrolled            = excluded.enrolled,
          key_version         = excluded.key_version,
          wrapped_master_seed = excluded.wrapped_master_seed,
          kdf_salt            = excluded.kdf_salt,
          kdf_m_cost          = excluded.kdf_m_cost,
          kdf_t_cost          = excluded.kdf_t_cost,
          kdf_p_cost          = excluded.kdf_p_cost,
          updated_at_ms       = excluded.updated_at_ms
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
        ],
    )
    .map_err(|e| AppError::Database(format!("upsert e2ee_local: {e}")))?;
    Ok(())
}

pub fn get(conn: &Connection) -> Result<Option<E2eeLocalState>, AppError> {
    conn.query_row(
        r#"
        SELECT enrolled, key_version, wrapped_master_seed,
               kdf_salt, kdf_m_cost, kdf_t_cost, kdf_p_cost, updated_at_ms
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
            })
        },
    )
    .optional()
    .map_err(|e| AppError::Database(format!("get e2ee_local: {e}")))
}

pub fn clear(conn: &Connection) -> Result<(), AppError> {
    conn.execute("DELETE FROM cloud_sync_e2ee_local WHERE scope = 'global'", [])
        .map_err(|e| AppError::Database(format!("clear e2ee_local: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_table(&c).unwrap();
        c
    }

    fn fixture() -> E2eeLocalState {
        E2eeLocalState {
            enrolled: true,
            key_version: 1,
            wrapped_master_seed: "enc:v1:fixture".into(),
            kdf_salt: vec![0x42; 32],
            kdf_m_cost: 65536,
            kdf_t_cost: 3,
            kdf_p_cost: 1,
            updated_at_ms: 1_700_000_000_000,
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
        s.wrapped_master_seed = "enc:v1:rotated".into();
        upsert(&c, &s).unwrap();
        let got = get(&c).unwrap().unwrap();
        assert_eq!(got.key_version, 7);
        assert_eq!(got.wrapped_master_seed, "enc:v1:rotated");
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
