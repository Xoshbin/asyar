//! Tauri commands for the calculator built-in feature.
//!
//! Thin wrappers only — all evaluation logic lives in `crate::calculator`.

use crate::calculator::{self, currency, CalcResult, CalculatorState, EvalContext};
use crate::error::AppError;
use tauri::State;

#[tauri::command]
pub async fn calculator_evaluate(
    query: String,
    state: State<'_, CalculatorState>,
    app: tauri::AppHandle,
) -> Result<Vec<CalcResult>, AppError> {
    // Non-blocking: loads the disk cache on first call and refreshes
    // stale rates in the background; the query never waits on the network.
    currency::ensure_rates_fresh(&app, &state);
    let (rates, rates_age) = state.rates_snapshot();
    let preferred = state.preferred_currency.read().unwrap().clone();
    Ok(calculator::evaluate_query(
        &query,
        &EvalContext::current(rates, rates_age, preferred),
    ))
}

/// Applies the user's preferences: currency refresh interval (hours) and
/// preferred currency for bare-amount queries.
#[tauri::command]
pub async fn calculator_configure(
    ttl_hours: Option<f64>,
    preferred_currency: Option<String>,
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
    Ok(())
}

/// Warm the exchange-rate cache (called when the extension activates).
#[tauri::command]
pub async fn calculator_refresh_rates(
    state: State<'_, CalculatorState>,
    app: tauri::AppHandle,
) -> Result<(), AppError> {
    currency::ensure_rates_fresh(&app, &state);
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::calculator::CalculatorState;

    #[test]
    fn ttl_is_clamped_to_valid_range() {
        let state = CalculatorState::default();
        *state.ttl_hours.write().unwrap() = 100.0_f64.clamp(1.0, 24.0);
        assert_eq!(*state.ttl_hours.read().unwrap(), 24.0);
        *state.ttl_hours.write().unwrap() = 0.5_f64.clamp(1.0, 24.0);
        assert_eq!(*state.ttl_hours.read().unwrap(), 1.0);
    }
}
