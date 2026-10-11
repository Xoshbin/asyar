//! Local-only, content-free accounting for requests made by Asyar's AI runner.
use crate::error::AppError;
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageRecord {
    pub ts: i64,
    pub provider_id: String,
    pub provider_type: String,
    pub connection_mode: String,
    pub model_id: String,
    pub agent_id: String,
    pub source: String,
    pub thread_id: Option<String>,
    pub run_id: Option<String>,
    pub extension_id: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageTotals {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageModelRow {
    pub provider_id: String,
    pub model_id: String,
    pub totals: AiUsageTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageSummary {
    pub totals: AiUsageTotals,
    pub by_model: Vec<AiUsageModelRow>,
}

fn db(error: rusqlite::Error) -> AppError {
    AppError::Database(error.to_string())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn init_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS ai_usage (
        id INTEGER PRIMARY KEY, ts INTEGER NOT NULL,
        provider_id TEXT NOT NULL, provider_type TEXT NOT NULL,
        connection_mode TEXT NOT NULL CHECK(connection_mode IN ('api','cli')),
        model_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('thread','silent','extension')),
        thread_id TEXT, run_id TEXT, extension_id TEXT,
        input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER, cache_write_tokens INTEGER, reasoning_tokens INTEGER, cost_usd REAL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_usage_ts ON ai_usage(ts);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_model_ts ON ai_usage(provider_id, model_id, ts);") .map_err(db)
}

pub fn insert(conn: &Connection, record: &AiUsageRecord) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction().map_err(db)?;
    tx.execute("INSERT INTO ai_usage (ts,provider_id,provider_type,connection_mode,model_id,agent_id,source,thread_id,run_id,extension_id,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,reasoning_tokens,cost_usd)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        params![record.ts,record.provider_id,record.provider_type,record.connection_mode,record.model_id,record.agent_id,record.source,record.thread_id,record.run_id,record.extension_id,record.input_tokens,record.output_tokens,record.cache_read_tokens,record.cache_write_tokens,record.reasoning_tokens,record.cost_usd]).map_err(db)?;
    prune_older_than(&tx, now_ms() - 365 * 86_400_000)?;
    tx.commit().map_err(db)
}

pub fn prune_older_than(conn: &Connection, before_ms: i64) -> Result<usize, AppError> {
    conn.execute("DELETE FROM ai_usage WHERE ts < ?1", [before_ms])
        .map_err(db)
}

fn totals(row: &Row<'_>, offset: usize) -> rusqlite::Result<AiUsageTotals> {
    Ok(AiUsageTotals {
        input_tokens: row.get(offset)?,
        output_tokens: row.get(offset + 1)?,
        cache_read_tokens: row.get(offset + 2)?,
        cache_write_tokens: row.get(offset + 3)?,
        reasoning_tokens: row.get(offset + 4)?,
        cost_usd: row.get(offset + 5)?,
    })
}

pub fn summary(conn: &Connection, since_ms: i64) -> Result<AiUsageSummary, AppError> {
    // One read transaction keeps totals and model rows on the same snapshot.
    let tx = conn.unchecked_transaction().map_err(db)?;
    let sums = "COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), SUM(cache_read_tokens), SUM(cache_write_tokens), SUM(reasoning_tokens), SUM(cost_usd)";
    let total = tx
        .query_row(
            &format!("SELECT {sums} FROM ai_usage WHERE ts >= ?1"),
            [since_ms],
            |row| totals(row, 0),
        )
        .map_err(db)?;
    let by_model = {
        let mut stmt = tx.prepare(&format!("SELECT provider_id, model_id, {sums} FROM ai_usage WHERE ts >= ?1 GROUP BY provider_id, model_id ORDER BY SUM(input_tokens) + SUM(output_tokens) DESC, provider_id, model_id")).map_err(db)?;
        let rows = stmt
            .query_map([since_ms], |row| {
                Ok(AiUsageModelRow {
                    provider_id: row.get(0)?,
                    model_id: row.get(1)?,
                    totals: totals(row, 2)?,
                })
            })
            .map_err(db)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(db)?
    };
    tx.commit().map_err(db)?;
    Ok(AiUsageSummary {
        totals: total,
        by_model,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(ts: i64, provider: &str, model: &str, input: u64) -> AiUsageRecord {
        AiUsageRecord {
            ts,
            provider_id: provider.into(),
            provider_type: "openai".into(),
            connection_mode: "api".into(),
            model_id: model.into(),
            agent_id: "agent".into(),
            source: "silent".into(),
            thread_id: None,
            run_id: None,
            extension_id: None,
            input_tokens: input,
            output_tokens: 5,
            cache_read_tokens: Some(3),
            cache_write_tokens: Some(2),
            reasoning_tokens: Some(1),
            cost_usd: Some(0.01),
        }
    }

    #[test]
    fn insert_then_summary_totals() {
        let store = crate::create_test_store();
        let conn = store.conn().unwrap();
        insert(&conn, &record(now_ms(), "p", "m", 10)).unwrap();
        let result = summary(&conn, 0).unwrap();
        assert_eq!(result.totals.input_tokens, 10);
        assert_eq!(result.totals.output_tokens, 5);
        assert_eq!(result.totals.cache_read_tokens, Some(3));
        assert_eq!(result.totals.cache_write_tokens, Some(2));
        assert_eq!(result.totals.reasoning_tokens, Some(1));
        assert_eq!(result.totals.cost_usd, Some(0.01));
    }

    #[test]
    fn summary_respects_since() {
        let store = crate::create_test_store();
        let conn = store.conn().unwrap();
        let now = now_ms();
        insert(&conn, &record(now - 10, "p", "m", 10)).unwrap();
        insert(&conn, &record(now, "p", "m", 20)).unwrap();
        assert_eq!(summary(&conn, now).unwrap().totals.input_tokens, 20);
        let empty = summary(&conn, now + 1).unwrap();
        assert_eq!(empty.totals.input_tokens, 0);
        assert_eq!(empty.totals.cost_usd, None);
        assert!(empty.by_model.is_empty());
    }

    #[test]
    fn summary_groups_by_provider_model_desc() {
        let store = crate::create_test_store();
        let conn = store.conn().unwrap();
        let now = now_ms();
        for (p, m, input) in [
            ("a", "m", 10),
            ("a", "m", 20),
            ("b", "m", 40),
            ("a", "n", 1),
        ] {
            insert(&conn, &record(now, p, m, input)).unwrap();
        }
        let result = summary(&conn, 0).unwrap();
        assert_eq!(result.by_model.len(), 3);
        assert_eq!(result.by_model[0].provider_id, "b");
        assert_eq!(result.by_model[1].totals.input_tokens, 30);
    }

    #[test]
    fn prune_older_than_removes_old_rows() {
        let store = crate::create_test_store();
        let conn = store.conn().unwrap();
        let now = now_ms();
        insert(&conn, &record(now - 10, "p", "m", 10)).unwrap();
        insert(&conn, &record(now, "p", "m", 20)).unwrap();
        assert_eq!(prune_older_than(&conn, now).unwrap(), 1);
        assert_eq!(summary(&conn, 0).unwrap().totals.input_tokens, 20);
        insert(&conn, &record(now - 366 * 86_400_000, "p", "m", 100)).unwrap();
        assert_eq!(summary(&conn, 0).unwrap().totals.input_tokens, 20);
    }
}
