//! Natural-language calculator engine.
//!
//! Powers the calculator built-in feature. The pipeline runs cheap
//! specialized handlers (colors, bases, percent phrases, ratios, dates,
//! timezones) before falling back to fend-core for math, unit, and
//! currency expressions. All evaluation lives here in Rust — the TS
//! extension only renders `CalcResult`s.

pub mod colors;
pub mod cooking;
pub mod currency;
pub mod dates;
pub mod engine;
pub mod extras;
pub mod format;
pub mod normalize;
pub mod percent;
pub mod timezone;

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::SystemTime;

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};

/// Category of a calculator answer. Drives icon selection in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum CalcKind {
    Math,
    Unit,
    Currency,
    Date,
    Time,
    Base,
    Color,
    Percent,
    Ratio,
}

/// One calculator answer, ready for display.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CalcResult {
    /// Main display value, e.g. `"177.8 cm"`.
    pub value: String,
    /// Supporting line, e.g. the resolved date or the rate used.
    pub detail: String,
    pub kind: CalcKind,
}

impl CalcResult {
    pub fn new(value: impl Into<String>, detail: impl Into<String>, kind: CalcKind) -> Self {
        Self {
            value: value.into(),
            detail: detail.into(),
            kind,
        }
    }
}

/// Everything time- and rate-dependent the pipeline needs, injected so
/// tests are deterministic.
pub struct EvalContext {
    pub rates: Option<Arc<HashMap<String, f64>>>,
    /// Human-readable age of the rates cache, e.g. `"2 h"`.
    pub rates_age: Option<String>,
    /// Target for bare-amount queries like `50 usd` (user preference).
    pub preferred_currency: String,
    pub today: NaiveDate,
    pub now_time: NaiveTime,
    pub now_utc: DateTime<Utc>,
    pub local_tz: Tz,
}

impl EvalContext {
    /// Build a context from the real clock and the given rates snapshot.
    pub fn current(
        rates: Option<Arc<HashMap<String, f64>>>,
        rates_age: Option<String>,
        preferred_currency: String,
    ) -> Self {
        let local_now = chrono::Local::now();
        let local_tz: Tz = iana_time_zone::get_timezone()
            .ok()
            .and_then(|name| name.parse().ok())
            .unwrap_or(chrono_tz::UTC);
        Self {
            rates,
            rates_age,
            preferred_currency,
            today: local_now.date_naive(),
            now_time: local_now.time(),
            now_utc: Utc::now(),
            local_tz,
        }
    }
}

/// Keyword prefixes that mark a digit-less query as calculator-worthy.
const NL_PREFIXES: &[&str] = &[
    "time",
    "days",
    "weeks",
    "months",
    "next ",
    "this ",
    "today",
    "tomorrow",
    "yesterday",
    "ratio",
    "sqrt",
    "cbrt",
    "pi",
    "diff ",
    "christmas",
    "new year",
    "halloween",
    "valentine",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "rgb(",
    "hsl(",
    "half of",
    "square root",
    "cube root",
    "increase ",
    "decrease ",
    "% change",
];

/// Cheap pre-filter: most launcher queries are app searches, not math.
/// Returns false when the query cannot possibly be a calculation.
pub fn should_attempt(query: &str) -> bool {
    let q = query.trim();
    if q.is_empty() || q.len() > 256 {
        return false;
    }
    if q.chars().any(|c| c.is_ascii_digit()) {
        return true;
    }
    if q.starts_with('#') {
        return true;
    }
    let lower = q.to_lowercase();
    if lower.ends_with(" time") {
        return true;
    }
    NL_PREFIXES.iter().any(|k| lower.starts_with(k))
}

/// Full evaluation pipeline. Returns zero or more display-ready results.
pub fn evaluate_query(raw: &str, ctx: &EvalContext) -> Vec<CalcResult> {
    if !should_attempt(raw) {
        return Vec::new();
    }
    let q = normalize::normalize(raw);
    if q.is_empty() {
        return Vec::new();
    }

    if let Some(r) = colors::evaluate_color(&q) {
        return vec![r];
    }
    if let Some(r) = extras::evaluate_bases(&q) {
        return vec![r];
    }
    if let Some(r) = percent::evaluate_percent(&q) {
        return vec![r];
    }
    if let Some(r) = extras::evaluate_ratio(&q) {
        return vec![r];
    }
    if let Some(r) = cooking::evaluate_cooking(&q) {
        return vec![r];
    }
    if let Some(r) = extras::evaluate_pixels(&q) {
        return vec![r];
    }
    if let Some(r) = dates::evaluate_date(&q, ctx.today, ctx.now_time) {
        return vec![r];
    }
    if let Some(r) = timezone::evaluate_time(&q, ctx.now_utc, ctx.local_tz) {
        return vec![r];
    }
    if let Some(inner) = extras::timespan_inner(&q) {
        if let Some(raw_secs) =
            engine::evaluate_fend_raw(&format!("({inner}) to seconds"), ctx.rates.clone())
        {
            let secs: Option<f64> = raw_secs
                .split_whitespace()
                .next()
                .and_then(|n| n.parse().ok());
            if let Some(secs) = secs {
                return vec![CalcResult::new(
                    extras::format_seconds(secs),
                    inner,
                    CalcKind::Unit,
                )];
            }
        }
        return Vec::new();
    }
    // Bare amount like "50 USD" → convert to the preferred currency.
    if let Some(r) = implicit_currency(&q, ctx) {
        return vec![r];
    }

    // Rate units: "8 USD/hour in GBP" → "8 USD/hour to GBP/hour".
    if let Some(r) = rate_unit_currency(&q, ctx) {
        return vec![r];
    }

    // Mid-typing tolerance: retry with trailing operators stripped so
    // "2+2+" keeps showing 4 while the user types. Echoed results
    // ("100" → "100") are only allowed once something was stripped.
    let mut attempt = q.as_str();
    for _ in 0..3 {
        let allow_echo = attempt != q;
        if let Some(mut r) = engine::evaluate_fend(attempt, ctx.rates.clone(), allow_echo) {
            if r.kind == CalcKind::Currency {
                if let Some(age) = &ctx.rates_age {
                    r.detail = format!("{} · rates {} old", r.detail, age);
                }
            }
            return vec![r];
        }
        let trimmed = attempt.trim_end_matches([' ', '+', '-', '*', '/', '^', '(', ',', '.']);
        if trimmed == attempt || trimmed.is_empty() {
            break;
        }
        attempt = trimmed;
    }

    Vec::new()
}

/// Append a currency's own rate age to the result's detail line.
fn with_rates_age(mut r: CalcResult, ctx: &EvalContext) -> CalcResult {
    if let Some(age) = &ctx.rates_age {
        r.detail = format!("{} · rates {} old", r.detail, age);
    }
    r
}

/// Converting a per-unit rate to another currency keeps the denominator:
/// `8 USD/hour in GBP` becomes `8 USD/hour to GBP/hour`.
fn rate_unit_currency(q: &str, ctx: &EvalContext) -> Option<CalcResult> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r"^(.+?/\s*([a-zA-Z]+))\s+(?:in|to)\s+([A-Z]{3,4})$").unwrap()
    });
    let c = re.captures(q)?;
    let expr = format!("{} to {}/{}", &c[1], &c[3], &c[2]);
    let r = engine::evaluate_fend(&expr, ctx.rates.clone(), false)?;
    Some(with_rates_age(r, ctx))
}

/// `50 USD` (no target) → `50 USD to <preferred>`, when they differ.
fn implicit_currency(q: &str, ctx: &EvalContext) -> Option<CalcResult> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re =
        RE.get_or_init(|| regex::Regex::new(r"^(\d[\d,]*(?:\.\d+)?)\s*([A-Z]{3,4})$").unwrap());
    let c = re.captures(q)?;
    let preferred = ctx.preferred_currency.trim().to_ascii_uppercase();
    if preferred.len() != 3 || c[2] == preferred {
        return None;
    }
    let expr = format!("{} {} to {preferred}", &c[1], &c[2]);
    let mut r = engine::evaluate_fend(&expr, ctx.rates.clone(), false)?;
    if let Some(age) = &ctx.rates_age {
        r.detail = format!("{} · rates {} old", r.detail, age);
    }
    Some(r)
}

/// Managed Tauri state: exchange-rate cache + refresh policy.
pub struct CalculatorState {
    pub rates: RwLock<Option<currency::RatesCache>>,
    /// TTL in hours before a background refresh is triggered.
    pub ttl_hours: RwLock<f64>,
    /// Target currency for bare-amount queries (user preference).
    pub preferred_currency: RwLock<String>,
    /// True while a background fetch is in flight.
    pub fetching: std::sync::atomic::AtomicBool,
    /// True once the disk cache has been loaded.
    pub disk_loaded: std::sync::atomic::AtomicBool,
}

impl Default for CalculatorState {
    fn default() -> Self {
        Self {
            rates: RwLock::new(None),
            ttl_hours: RwLock::new(currency::DEFAULT_TTL_HOURS),
            preferred_currency: RwLock::new("USD".to_string()),
            fetching: std::sync::atomic::AtomicBool::new(false),
            disk_loaded: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

impl CalculatorState {
    /// Snapshot of the current rates map and its human-readable age.
    pub fn rates_snapshot(&self) -> (Option<Arc<HashMap<String, f64>>>, Option<String>) {
        let guard = self.rates.read().unwrap();
        match guard.as_ref() {
            Some(cache) => (
                Some(Arc::new(cache.rates.clone())),
                Some(cache.age_human(SystemTime::now())),
            ),
            None => (None, None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_ctx() -> EvalContext {
        let mut rates = HashMap::new();
        rates.insert("USD".to_string(), 1.0);
        rates.insert("EUR".to_string(), 0.9);
        rates.insert("GBP".to_string(), 0.79);
        rates.insert("IQD".to_string(), 1310.0);
        rates.insert("BTC".to_string(), 1.0 / 80000.0);
        EvalContext {
            rates: Some(Arc::new(rates)),
            rates_age: Some("2 h".to_string()),
            preferred_currency: "IQD".to_string(),
            today: NaiveDate::from_ymd_opt(2026, 7, 11).unwrap(),
            now_time: NaiveTime::from_hms_opt(15, 0, 0).unwrap(),
            now_utc: DateTime::parse_from_rfc3339("2026-07-11T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            local_tz: chrono_tz::Asia::Baghdad,
        }
    }

    #[test]
    fn gate_rejects_app_search_queries() {
        assert!(!should_attempt("safari"));
        assert!(!should_attempt("settings"));
        assert!(!should_attempt("e"));
        assert!(!should_attempt(""));
    }

    #[test]
    fn gate_accepts_calculator_queries() {
        assert!(should_attempt("2+2"));
        assert!(should_attempt("time in tokyo"));
        assert!(should_attempt("days until christmas"));
        assert!(should_attempt("#ff8800"));
        assert!(should_attempt("sqrt(2)"));
        assert!(should_attempt("pi * 2"));
    }

    #[test]
    fn pipeline_basic_math() {
        let res = evaluate_query("2+2", &test_ctx());
        assert_eq!(res[0].value, "4");
        assert_eq!(res[0].kind, CalcKind::Math);
    }

    #[test]
    fn pipeline_percent_off_takes_priority_over_fend() {
        let res = evaluate_query("20% off 80", &test_ctx());
        assert_eq!(res[0].kind, CalcKind::Percent);
        assert_eq!(res[0].value, "64");
    }

    #[test]
    fn pipeline_hex_literal_shows_base_card() {
        let res = evaluate_query("0xff", &test_ctx());
        assert_eq!(res[0].kind, CalcKind::Base);
        assert_eq!(res[0].value, "255");
    }

    #[test]
    fn pipeline_color() {
        let res = evaluate_query("#f80", &test_ctx());
        assert_eq!(res[0].kind, CalcKind::Color);
    }

    #[test]
    fn pipeline_currency_with_shorthand() {
        let res = evaluate_query("$1k in iqd", &test_ctx());
        assert_eq!(res[0].kind, CalcKind::Currency);
        assert!(res[0].value.contains("IQD"), "got: {}", res[0].value);
        assert!(res[0].value.contains("1,310,000"), "got: {}", res[0].value);
    }

    #[test]
    fn pipeline_empty_query_returns_nothing() {
        assert!(evaluate_query("", &test_ctx()).is_empty());
        assert!(evaluate_query("safari", &test_ctx()).is_empty());
    }

    #[test]
    fn pipeline_timespan() {
        let res = evaluate_query("145 min to timespan", &test_ctx());
        assert_eq!(res[0].value, "2 h 25 min");
    }

    #[test]
    fn pipeline_natural_language_math() {
        let res = evaluate_query("square root of 625", &test_ctx());
        assert_eq!(res[0].value, "25");
    }

    #[test]
    fn pipeline_implicit_conversion_to_preferred_currency() {
        // Bare "50 usd" converts to the user's preferred currency (IQD here).
        let res = evaluate_query("50 usd", &test_ctx());
        assert_eq!(res[0].kind, CalcKind::Currency);
        assert!(res[0].value.contains("65,500 IQD"), "got: {}", res[0].value);
        // "$100" gets the same treatment via symbol normalization.
        let res = evaluate_query("$100", &test_ctx());
        assert!(
            res[0].value.contains("131,000 IQD"),
            "got: {}",
            res[0].value
        );
        // Already in the preferred currency → nothing to show.
        assert!(evaluate_query("50 iqd", &test_ctx()).is_empty());
    }

    #[test]
    fn pipeline_crypto_conversion() {
        let res = evaluate_query("5 btc in gbp", &test_ctx());
        assert_eq!(res[0].value, "316,000 GBP");
        assert_eq!(res[0].kind, CalcKind::Currency);
    }

    #[test]
    fn pipeline_rate_unit_conversion() {
        // "in gbp" is rewritten to "to GBP/hour" for per-unit rates.
        let res = evaluate_query("8 dollars/hour in gbp", &test_ctx());
        assert_eq!(res[0].value, "6.32 GBP/hour");
    }

    #[test]
    fn pipeline_cooking_and_pixels() {
        let res = evaluate_query("1 tablespoon of honey in grams", &test_ctx());
        assert_eq!(res[0].value, "21 g");
        let res = evaluate_query("2 inches in px at 72 ppi", &test_ctx());
        assert_eq!(res[0].value, "144 px");
    }

    #[test]
    fn pipeline_wall_time_with_country_and_capitalization() {
        // 8pm Santiago (-4 in July) = 00:00 UTC = 01:00 London (BST).
        let res = evaluate_query("8pm chile in London", &test_ctx());
        assert_eq!(res[0].value, "01:00");
    }

    #[test]
    fn pipeline_timespan_hours_and_minutes() {
        let res = evaluate_query("145 minutes as hours and minutes", &test_ctx());
        assert_eq!(res[0].value, "2 h 25 min");
    }

    #[test]
    fn pipeline_days_ago_and_workhours() {
        let res = evaluate_query("35 days ago", &test_ctx());
        assert_eq!(res[0].kind, CalcKind::Date);
        let res = evaluate_query("workhours in 2023", &test_ctx());
        assert_eq!(res[0].value, "2,080 h");
    }

    #[test]
    fn pipeline_tolerates_trailing_operator_while_typing() {
        // Mid-typing "2+2+" should still show 4, like the old engine did.
        let res = evaluate_query("2+2+", &test_ctx());
        assert_eq!(res[0].value, "4");
        let res = evaluate_query("100 * (", &test_ctx());
        assert_eq!(res[0].value, "100");
    }

    #[test]
    fn state_snapshot_empty_by_default() {
        let state = CalculatorState::default();
        let (rates, age) = state.rates_snapshot();
        assert!(rates.is_none());
        assert!(age.is_none());
    }
}
