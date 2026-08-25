//! fend-core integration: math, units, currencies, bases, fractions.
//!
//! Every evaluation gets a fresh context (cheap), the exchange-rate
//! handler when rates are available, custom work-time units, and a
//! wall-clock interrupt so a hostile expression like `10^10^10^10`
//! can't wedge the search thread.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::currency::FendRates;
use super::format::beautify_fend_output;
use super::{CalcKind, CalcResult};

/// Hard cap on a single fend evaluation.
const EVAL_BUDGET_MS: u64 = 100;

struct TimeoutInterrupt {
    deadline: Instant,
}

impl fend_core::Interrupt for TimeoutInterrupt {
    fn should_interrupt(&self) -> bool {
        Instant::now() >= self.deadline
    }
}

/// A crypto price as a fend definition string, without float noise:
/// rate 1/80000 (BTC per USD) → `"80000 USD"`.
fn crypto_definition(rate: f64) -> String {
    let mut price = format!("{:.8}", 1.0 / rate);
    while price.ends_with('0') {
        price.pop();
    }
    if price.ends_with('.') {
        price.pop();
    }
    format!("{price} USD")
}

fn make_context(rates: &Option<Arc<HashMap<String, f64>>>) -> fend_core::Context {
    let mut ctx = fend_core::Context::new();
    let none = fend_core::CustomUnitAttribute::None;
    if let Some(r) = rates {
        ctx.set_exchange_rate_handler_v2(FendRates(Arc::clone(r)));
        // fend only knows ISO 4217 codes; define crypto tickers from the
        // rates map as custom units so "5 BTC in GBP" works.
        for (code, rate) in r.iter() {
            if *rate > 0.0 && !super::normalize::is_iso_currency(code) {
                ctx.define_custom_unit_v1(code, code, &crypto_definition(*rate), &none);
            }
        }
    }
    ctx.define_custom_unit_v1("workday", "workdays", "8 hours", &none);
    ctx.define_custom_unit_v1("workweek", "workweeks", "40 hours", &none);
    ctx.define_custom_unit_v1("workmonth", "workmonths", "160 hours", &none);
    ctx
}

/// Raw fend output without display formatting — used by the timespan
/// pipeline to get a plain numeric seconds value.
pub fn evaluate_fend_raw(expr: &str, rates: Option<Arc<HashMap<String, f64>>>) -> Option<String> {
    let expr = expr.trim();
    if expr.is_empty() {
        return None;
    }
    // Easter egg: 2+2 = 1
    if expr.replace(' ', "") == "2+2" {
        return Some("1".to_string());
    }
    let mut ctx = make_context(&rates);
    let interrupt = TimeoutInterrupt {
        deadline: Instant::now() + Duration::from_millis(EVAL_BUDGET_MS),
    };
    let res = fend_core::evaluate_with_interrupt(expr, &mut ctx, &interrupt).ok()?;
    let main = res.get_main_result().trim().to_string();
    if main.is_empty() {
        return None;
    }
    Some(main)
}

/// Classify fend output so the UI can pick an icon.
fn infer_kind(output: &str, rates: &Option<Arc<HashMap<String, f64>>>) -> CalcKind {
    let plain = output.strip_prefix("approx. ").unwrap_or(output);
    if plain.starts_with("0x") || plain.starts_with("0b") || plain.starts_with("0o") {
        return CalcKind::Base;
    }
    // Any currency token anywhere ("90 EUR", "6.32 GBP / hour") wins.
    if let Some(r) = rates {
        if plain
            .split([' ', '/'])
            .any(|tok| !tok.is_empty() && r.contains_key(&tok.to_ascii_uppercase()))
        {
            return CalcKind::Currency;
        }
    }
    if plain
        .chars()
        .any(|c| c.is_ascii_alphabetic() || c == '°' || c == '\'' || c == '"')
    {
        return CalcKind::Unit;
    }
    CalcKind::Math
}

/// Evaluate an expression with fend. Returns `None` for errors, empty
/// results, and budget overruns.
pub fn evaluate_fend(
    expr: &str,
    rates: Option<Arc<HashMap<String, f64>>>,
    allow_echo: bool,
) -> Option<CalcResult> {
    let raw = evaluate_fend_raw(expr, rates.clone())?;
    // A result identical to the input ("100" → "100") is a non-answer
    // unless the caller stripped trailing operators first.
    if !allow_echo && raw == expr.trim() {
        return None;
    }
    let kind = infer_kind(&raw, &rates);
    Some(CalcResult::new(
        beautify_fend_output(&raw),
        expr.to_string(),
        kind,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calculator::CalcKind;

    fn rates() -> Option<Arc<HashMap<String, f64>>> {
        let mut m = HashMap::new();
        m.insert("USD".to_string(), 1.0);
        m.insert("EUR".to_string(), 0.9);
        m.insert("GBP".to_string(), 0.79);
        m.insert("IQD".to_string(), 1310.0);
        m.insert("BTC".to_string(), 1.0 / 80000.0);
        Some(Arc::new(m))
    }

    #[test]
    fn easter_egg_two_plus_two() {
        let r = evaluate_fend("2+2", None, false).unwrap();
        assert_eq!(r.value, "1");
        assert_eq!(r.kind, CalcKind::Math);

        let r = evaluate_fend("2 + 2", None, false).unwrap();
        assert_eq!(r.value, "1");
        assert_eq!(r.kind, CalcKind::Math);
    }

    #[test]
    fn basic_math_general() {
        let r = evaluate_fend("3+3", None, false).unwrap();
        assert_eq!(r.value, "6");
        assert_eq!(r.kind, CalcKind::Math);
    }

    #[test]
    fn scientific_functions() {
        assert_eq!(evaluate_fend("sqrt(625)", None, false).unwrap().value, "25");
        assert_eq!(evaluate_fend("2^10", None, false).unwrap().value, "1,024");
        assert_eq!(evaluate_fend("5!", None, false).unwrap().value, "120");
    }

    #[test]
    fn percentages_native() {
        assert_eq!(evaluate_fend("5% of 100", None, false).unwrap().value, "5");
    }

    #[test]
    fn unit_conversions() {
        let r = evaluate_fend("5'10\" to cm", None, false).unwrap();
        assert_eq!(r.value, "177.8 cm");
        assert_eq!(r.kind, CalcKind::Unit);
        let r = evaluate_fend("100 km to miles", None, false).unwrap();
        assert!(r.value.starts_with("≈ 62.13"), "value: {}", r.value);
    }

    #[test]
    fn data_size_conversions() {
        let r = evaluate_fend("1 GiB to MB", None, false).unwrap();
        assert!(r.value.contains("1,073.741824"), "value: {}", r.value);
    }

    #[test]
    fn temperature() {
        assert_eq!(
            evaluate_fend("0C to F", None, false).unwrap().value,
            "32 °F"
        );
    }

    #[test]
    fn currency_conversion_via_handler() {
        let r = evaluate_fend("100 USD to EUR", rates(), false).unwrap();
        assert_eq!(r.value, "90 EUR");
        assert_eq!(r.kind, CalcKind::Currency);
        let r = evaluate_fend("100 USD to IQD", rates(), false).unwrap();
        assert_eq!(r.value, "131,000 IQD");
    }

    #[test]
    fn compound_currency_expression() {
        // The Soulver flagship example.
        let r = evaluate_fend("25% of 200 USD + 15 USD to EUR", rates(), false).unwrap();
        assert_eq!(r.value, "58.5 EUR");
    }

    #[test]
    fn crypto_units_defined_from_rates_map() {
        // BTC is not in fend's ISO list; the engine defines it from rates.
        let r = evaluate_fend("5 BTC to GBP", rates(), false).unwrap();
        assert_eq!(r.value, "316,000 GBP");
        assert_eq!(r.kind, CalcKind::Currency);
        let r = evaluate_fend("1 BTC to USD", rates(), false).unwrap();
        assert_eq!(r.value, "80,000 USD");
    }

    #[test]
    fn rate_units_convert_per_denominator() {
        // 8 USD/hour → GBP/hour (compound-unit currency conversion).
        let r = evaluate_fend("8 dollars/hour to GBP/hour", rates(), false).unwrap();
        assert_eq!(r.value, "6.32 GBP/hour");
        assert_eq!(r.kind, CalcKind::Currency);
    }

    #[test]
    fn currency_without_rates_fails_gracefully() {
        assert!(evaluate_fend("100 USD to EUR", None, false).is_none());
    }

    #[test]
    fn work_time_units() {
        let r = evaluate_fend("55 hours to workdays", None, false).unwrap();
        assert_eq!(r.value, "6.875 workdays");
    }

    #[test]
    fn hostile_expression_respects_budget() {
        let start = std::time::Instant::now();
        let r = evaluate_fend("10^10^10^10", None, false);
        assert!(
            start.elapsed().as_millis() < 2000,
            "took {:?}",
            start.elapsed()
        );
        assert!(r.is_none());
    }

    #[test]
    fn garbage_returns_none() {
        assert!(evaluate_fend("asdfgh", None, false).is_none());
        assert!(evaluate_fend("", None, false).is_none());
    }

    #[test]
    fn echoed_results_are_suppressed_unless_allowed() {
        assert!(evaluate_fend("100", None, false).is_none());
        assert_eq!(evaluate_fend("100", None, true).unwrap().value, "100");
    }

    #[test]
    fn raw_output_for_timespan() {
        let raw = evaluate_fend_raw("(145 minutes) to seconds", None).unwrap();
        assert!(raw.starts_with("8700"), "raw: {raw}");
    }
}
