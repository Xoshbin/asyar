//! Exchange-rate cache: fetch (reqwest), disk persistence, TTL policy,
//! and the fend-core exchange-rate handler.
//!
//! Rates are USD-based, matching fend's expectation that the handler
//! returns "how many units of `currency` per one base unit".

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use super::CalculatorState;

const RATES_URL: &str = "https://api.exchangerate-api.com/v4/latest/USD";
pub const DEFAULT_TTL_HOURS: f64 = 6.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RatesCache {
    pub rates: HashMap<String, f64>,
    pub fetched_at_epoch_secs: u64,
}

impl RatesCache {
    pub fn new(rates: HashMap<String, f64>, now: SystemTime) -> Self {
        Self {
            rates,
            fetched_at_epoch_secs: now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
        }
    }

    /// Age of the cache in seconds at `now`.
    pub fn age_secs(&self, now: SystemTime) -> u64 {
        let now_secs = now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        now_secs.saturating_sub(self.fetched_at_epoch_secs)
    }

    /// Whether the cache is older than `ttl_hours`.
    pub fn is_stale(&self, ttl_hours: f64, now: SystemTime) -> bool {
        self.age_secs(now) as f64 > ttl_hours * 3600.0
    }

    /// Human-readable age: `"3 min"`, `"2 h"`, `"1 d"`.
    pub fn age_human(&self, now: SystemTime) -> String {
        let secs = self.age_secs(now);
        if secs < 60 {
            "just now".to_string()
        } else if secs < 3600 {
            format!("{} min", secs / 60)
        } else if secs < 86400 {
            format!("{} h", secs / 3600)
        } else {
            format!("{} d", secs / 86400)
        }
    }

    pub fn load(path: &Path) -> Option<Self> {
        let bytes = std::fs::read(path).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_vec(self)?)
    }
}

/// fend-core exchange rate handler backed by a rates snapshot.
pub struct FendRates(pub Arc<HashMap<String, f64>>);

impl FendRates {
    /// Units of `currency` per one USD (the base). Errors on unknown codes.
    pub fn rate_for(&self, currency: &str) -> Result<f64, String> {
        self.0
            .get(&currency.to_ascii_uppercase())
            .copied()
            .filter(|r| *r > 0.0)
            .ok_or_else(|| format!("no exchange rate for {currency}"))
    }
}

impl fend_core::ExchangeRateFnV2 for FendRates {
    fn relative_to_base_currency(
        &self,
        currency: &str,
        _options: &fend_core::ExchangeRateFnV2Options,
    ) -> Result<f64, Box<dyn std::error::Error + Send + Sync + 'static>> {
        self.rate_for(currency).map_err(|e| e.into())
    }
}

/// Where the rates cache lives on disk.
pub fn rates_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("calculator").join("rates.json"))
}

/// Non-blocking freshness guarantee: loads the disk cache on first call,
/// and spawns a background fetch when the cache is missing or stale.
/// Never delays the caller on the network.
pub fn ensure_rates_fresh(app: &tauri::AppHandle, state: &CalculatorState) {
    let Some(path) = rates_path(app) else {
        return;
    };

    if !state.disk_loaded.swap(true, Ordering::SeqCst) {
        if let Some(cache) = RatesCache::load(&path) {
            let mut guard = state.rates.write().unwrap();
            if guard.is_none() {
                *guard = Some(cache);
            }
        }
    }

    let ttl = {
        let ttl = *state.ttl_hours.read().unwrap();
        if ttl <= 0.0 {
            DEFAULT_TTL_HOURS
        } else {
            ttl
        }
    };
    let stale = state
        .rates
        .read()
        .unwrap()
        .as_ref()
        .is_none_or(|c| c.is_stale(ttl, SystemTime::now()));

    if stale && !state.fetching.swap(true, Ordering::SeqCst) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let fetched = fetch_rates().await;
            let state = app.state::<CalculatorState>();
            if let Ok(rates) = fetched {
                let cache = RatesCache::new(rates, SystemTime::now());
                let _ = cache.save(&path);
                *state.rates.write().unwrap() = Some(cache);
            }
            state.fetching.store(false, Ordering::SeqCst);
        });
    }
}

/// CoinGecko ids and the currency codes they map to.
const CRYPTO_IDS: &[(&str, &str)] = &[
    ("bitcoin", "BTC"),
    ("ethereum", "ETH"),
    ("binancecoin", "BNB"),
    ("solana", "SOL"),
    ("ripple", "XRP"),
    ("cardano", "ADA"),
    ("dogecoin", "DOGE"),
    ("litecoin", "LTC"),
    ("polkadot", "DOT"),
    ("tron", "TRX"),
    ("chainlink", "LINK"),
    ("bitcoin-cash", "BCH"),
    ("stellar", "XLM"),
    ("tether", "USDT"),
    ("usd-coin", "USDC"),
];

/// Merge a CoinGecko `simple/price` response into a USD-based rates map,
/// storing "units of coin per one USD" like every fiat entry.
pub fn merge_crypto_rates(rates: &mut HashMap<String, f64>, body: &serde_json::Value) {
    for (id, code) in CRYPTO_IDS {
        let price = body
            .get(*id)
            .and_then(|v| v.get("usd"))
            .and_then(|v| v.as_f64());
        if let Some(price) = price {
            if price > 0.0 {
                rates.insert((*code).to_string(), 1.0 / price);
            }
        }
    }
}

/// Fetch fresh USD-based rates.
pub async fn fetch_rates() -> Result<HashMap<String, f64>, String> {
    // CoinGecko rejects requests with no descriptive User-Agent (HTTP 403,
    // but with a *valid* JSON error body — see `fetch_rates_includes_crypto`).
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(concat!(
            "Asyar/",
            env!("CARGO_PKG_VERSION"),
            " (+https://asyar.org)"
        ))
        .build()
        .map_err(|e| e.to_string())?;
    let body: serde_json::Value = client
        .get(RATES_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let rates = body
        .get("rates")
        .and_then(|r| r.as_object())
        .ok_or("malformed rates response")?;
    let mut map: HashMap<String, f64> = rates
        .iter()
        .filter_map(|(k, v)| v.as_f64().map(|f| (k.to_ascii_uppercase(), f)))
        .collect();
    if map.is_empty() {
        return Err("empty rates response".to_string());
    }

    // Crypto prices are best-effort: fiat rates stay usable if this fails.
    let ids: Vec<&str> = CRYPTO_IDS.iter().map(|(id, _)| *id).collect();
    let url = format!(
        "https://api.coingecko.com/api/v3/simple/price?ids={}&vs_currencies=usd",
        ids.join(",")
    );
    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(body) = resp.json::<serde_json::Value>().await {
            merge_crypto_rates(&mut map, &body);
        }
    }

    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_rates() -> HashMap<String, f64> {
        let mut m = HashMap::new();
        m.insert("USD".to_string(), 1.0);
        m.insert("EUR".to_string(), 0.9);
        m.insert("IQD".to_string(), 1310.0);
        m
    }

    /// CoinGecko returns HTTP 403 with a *valid JSON* error body
    /// (`{"status":{"error_code":403,...}}`) when a request has no
    /// descriptive User-Agent — which a bare `reqwest::Client` never
    /// sends. The old code only checked `send()` and `.json()` for
    /// errors, both of which succeed for that 403 body, so crypto rates
    /// silently vanished on every real fetch. Hits the live network;
    /// run manually with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore = "hits the live network — run manually to verify crypto rates actually arrive"]
    async fn fetch_rates_includes_crypto() {
        let rates = fetch_rates().await.expect("fetch_rates should succeed");
        assert!(
            rates.contains_key("USD"),
            "fiat rates should still be present"
        );
        assert!(
            rates.contains_key("BTC"),
            "crypto rates missing — likely the CoinGecko User-Agent 403 regression"
        );
    }

    #[test]
    fn cache_age_and_staleness() {
        let t0 = UNIX_EPOCH + Duration::from_secs(1_000_000);
        let cache = RatesCache::new(sample_rates(), t0);
        assert_eq!(cache.age_secs(t0), 0);
        assert!(!cache.is_stale(6.0, t0 + Duration::from_secs(5 * 3600)));
        assert!(cache.is_stale(6.0, t0 + Duration::from_secs(7 * 3600)));
    }

    #[test]
    fn age_human_formats() {
        let t0 = UNIX_EPOCH + Duration::from_secs(1_000_000);
        let cache = RatesCache::new(sample_rates(), t0);
        assert_eq!(cache.age_human(t0 + Duration::from_secs(180)), "3 min");
        assert_eq!(cache.age_human(t0 + Duration::from_secs(2 * 3600)), "2 h");
        assert_eq!(cache.age_human(t0 + Duration::from_secs(26 * 3600)), "1 d");
    }

    #[test]
    fn save_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("rates.json");
        let t0 = UNIX_EPOCH + Duration::from_secs(1_000_000);
        let cache = RatesCache::new(sample_rates(), t0);
        cache.save(&path).unwrap();
        let loaded = RatesCache::load(&path).unwrap();
        assert_eq!(loaded.fetched_at_epoch_secs, cache.fetched_at_epoch_secs);
        assert_eq!(loaded.rates.get("IQD"), Some(&1310.0));
    }

    #[test]
    fn load_missing_or_corrupt_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(RatesCache::load(&dir.path().join("nope.json")).is_none());
        let bad = dir.path().join("bad.json");
        std::fs::write(&bad, "not json").unwrap();
        assert!(RatesCache::load(&bad).is_none());
    }

    #[test]
    fn crypto_rates_merge_as_units_per_usd() {
        let mut rates = sample_rates();
        let body: serde_json::Value = serde_json::from_str(
            r#"{"bitcoin":{"usd":80000.0},"ethereum":{"usd":2500.0},"junk":{"usd":0.0}}"#,
        )
        .unwrap();
        merge_crypto_rates(&mut rates, &body);
        assert!((rates["BTC"] - 1.0 / 80000.0).abs() < 1e-12);
        assert!((rates["ETH"] - 1.0 / 2500.0).abs() < 1e-12);
        // Fiat entries untouched, zero/unknown prices skipped.
        assert_eq!(rates["IQD"], 1310.0);
        assert!(!rates.contains_key("JUNK"));
    }

    #[test]
    fn fend_handler_returns_units_per_usd() {
        let handler = FendRates(Arc::new(sample_rates()));
        assert_eq!(handler.rate_for("IQD").unwrap(), 1310.0);
        assert_eq!(handler.rate_for("USD").unwrap(), 1.0);
        assert!(handler.rate_for("XXX_UNKNOWN").is_err());
    }
}
