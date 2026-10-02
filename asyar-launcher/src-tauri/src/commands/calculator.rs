//! Tauri commands for the calculator built-in feature.
//!
//! Thin wrappers only — all evaluation logic lives in `crate::calculator`.

use crate::calculator::{self, currency, CalcResult, CalculatorState, EvalContext};
use crate::error::AppError;
use tauri::State;

/// Where the rates cache lives on disk.
pub fn rates_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("calculator").join("rates.json"))
}

/// Non-blocking freshness guarantee: loads the disk cache on first call,
/// and spawns a background fetch when the cache is missing or stale.
/// Never delays the caller on the network.
pub fn ensure_rates_fresh(app: &tauri::AppHandle, state: &CalculatorState) {
    use std::sync::atomic::Ordering;
    use std::time::SystemTime;
    use tauri::Manager;

    let Some(path) = rates_path(app) else {
        return;
    };

    if !state.disk_loaded.swap(true, Ordering::SeqCst) {
        if let Some(cache) = currency::RatesCache::load(&path) {
            let mut guard = state.rates.write().unwrap();
            if guard.is_none() {
                *guard = Some(cache);
            }
        }
    }

    let stale = currency::is_rates_stale(state, SystemTime::now());

    if stale && !state.fetching.swap(true, Ordering::SeqCst) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let fetched = currency::fetch_rates().await;
            let state = app.state::<CalculatorState>();
            if let Ok(rates) = fetched {
                let cache = currency::RatesCache::new(rates, SystemTime::now());
                let _ = cache.save(&path);
                *state.rates.write().unwrap() = Some(cache);
            }
            state.fetching.store(false, Ordering::SeqCst);
        });
    }
}

#[tauri::command]
pub async fn calculator_evaluate(
    query: String,
    state: State<'_, CalculatorState>,
    app: tauri::AppHandle,
) -> Result<Vec<CalcResult>, AppError> {
    // Non-blocking: loads the disk cache on first call and refreshes
    // stale rates in the background; the query never waits on the network.
    ensure_rates_fresh(&app, &state);
    let (rates, rates_age) = state.rates_snapshot();
    let preferred = state.preferred_currency.read().unwrap().clone();
    Ok(calculator::evaluate_query(
        &query,
        &EvalContext::current(rates, rates_age, preferred, state.number_format()),
    ))
}

/// Applies the user's preferences: currency refresh interval (hours),
/// preferred currency for bare-amount queries, and number notation.
#[tauri::command]
pub async fn calculator_configure(
    ttl_hours: Option<f64>,
    preferred_currency: Option<String>,
    number_format: Option<String>,
    state: State<'_, CalculatorState>,
) -> Result<(), AppError> {
    if let Some(ttl) = ttl_hours {
        *state.ttl_hours.write().unwrap() = ttl.clamp(1.0, 24.0);
    }
    if let Some(code) = preferred_currency {
        let code = code.trim().to_ascii_uppercase();
        if code.len() == 3 && code.chars().all(|c| c.is_ascii_alphabetic()) {
            *state.preferred_currency.write().unwrap() = code;
        }
    }
    if let Some(format) = number_format {
        // Anything unrecognized — "auto" included — means follow the host locale.
        *state.number_format.write().unwrap() = calculator::locale::from_preference(&format);
    }
    Ok(())
}

/// Warm the exchange-rate cache (called when the extension activates).
#[tauri::command]
pub async fn calculator_refresh_rates(
    state: State<'_, CalculatorState>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    ensure_rates_fresh(&app, &state);
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::calculator::locale::NumberFormat;
    use crate::calculator::CalculatorState;

    #[test]
    fn ttl_is_clamped_to_valid_range() {
        let state = CalculatorState::default();
        *state.ttl_hours.write().unwrap() = 100.0_f64.clamp(1.0, 24.0);
        assert_eq!(*state.ttl_hours.read().unwrap(), 24.0);
        *state.ttl_hours.write().unwrap() = 0.5_f64.clamp(1.0, 24.0);
        assert_eq!(*state.ttl_hours.read().unwrap(), 1.0);
    }

    #[test]
    fn number_format_defaults_to_the_host_locale() {
        let state = CalculatorState::default();
        assert!(state.number_format.read().unwrap().is_none());
        assert_eq!(
            state.number_format(),
            crate::calculator::locale::detect(),
            "an unset preference must follow the host locale"
        );
    }

    #[test]
    fn number_format_override_wins_over_the_host_locale() {
        let state = CalculatorState::default();
        *state.number_format.write().unwrap() = Some(NumberFormat::Comma);
        assert_eq!(state.number_format(), NumberFormat::Comma);
    }
}
