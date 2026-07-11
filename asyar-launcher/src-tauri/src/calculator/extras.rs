//! Ratio simplification, base conversion cards, and timespan formatting.

use regex::Regex;
use std::sync::OnceLock;

use super::format::group_thousands;
use super::{CalcKind, CalcResult};

fn gcd(mut a: u128, mut b: u128) -> u128 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a.max(1)
}

fn ratio_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)^ratio\s+of\s+(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)$").unwrap()
    })
}

/// `ratio of 384 to 240` → simplified `8 : 5`.
pub fn evaluate_ratio(query: &str) -> Option<CalcResult> {
    let c = ratio_re().captures(query.trim())?;
    let (a, b): (f64, f64) = (c[1].parse().ok()?, c[2].parse().ok()?);
    if a <= 0.0 || b <= 0.0 {
        return None;
    }
    // Scale decimals up to integers (max 4 decimal places).
    let decimals = [&c[1], &c[2]]
        .iter()
        .map(|s| s.split_once('.').map_or(0, |(_, f)| f.len()))
        .max()
        .unwrap_or(0)
        .min(4);
    let scale = 10u128.pow(decimals as u32);
    let (ia, ib) = (
        (a * scale as f64).round() as u128,
        (b * scale as f64).round() as u128,
    );
    let g = gcd(ia, ib);
    let per_one = a / b;
    let detail = if (per_one - per_one.round()).abs() < 1e-9 {
        format!("{} : 1", per_one.round() as i64)
    } else {
        let mut s = format!("{per_one:.4}");
        while s.ends_with('0') {
            s.pop();
        }
        format!("{s} : 1")
    };
    Some(CalcResult::new(
        format!("{} : {}", ia / g, ib / g),
        detail,
        CalcKind::Ratio,
    ))
}

struct BasePatterns {
    literal: Regex,
    to_base: Regex,
}

fn base_patterns() -> &'static BasePatterns {
    static P: OnceLock<BasePatterns> = OnceLock::new();
    P.get_or_init(|| BasePatterns {
        literal: Regex::new(r"^(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+)$").unwrap(),
        to_base: Regex::new(
            r"(?i)^(0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)\s+(?:to|in|as)\s+(hex|hexadecimal|binary|bin|octal|oct|decimal|dec)$",
        )
        .unwrap(),
    })
}

fn parse_literal(s: &str) -> Option<u128> {
    let lower = s.to_ascii_lowercase();
    if let Some(hex) = lower.strip_prefix("0x") {
        u128::from_str_radix(hex, 16).ok()
    } else if let Some(bin) = lower.strip_prefix("0b") {
        u128::from_str_radix(bin, 2).ok()
    } else if let Some(oct) = lower.strip_prefix("0o") {
        u128::from_str_radix(oct, 8).ok()
    } else {
        s.parse().ok()
    }
}

fn all_bases_detail(n: u128) -> String {
    format!("0b{n:b} · 0o{n:o} · 0x{n:X}")
}

/// Whole-query based literals (`0xff`) and base conversion requests
/// (`255 to hex`, `12 to binary`, `0x2f to decimal`).
pub fn evaluate_bases(query: &str) -> Option<CalcResult> {
    let p = base_patterns();
    let q = query.trim();

    if p.literal.is_match(q) {
        let n = parse_literal(q)?;
        return Some(CalcResult::new(
            group_thousands(&n.to_string()),
            all_bases_detail(n),
            CalcKind::Base,
        ));
    }

    if let Some(c) = p.to_base.captures(q) {
        let n = parse_literal(&c[1])?;
        let value = match c[2].to_ascii_lowercase().as_str() {
            "hex" | "hexadecimal" => format!("0x{n:X}"),
            "binary" | "bin" => format!("0b{n:b}"),
            "octal" | "oct" => format!("0o{n:o}"),
            _ => group_thousands(&n.to_string()),
        };
        return Some(CalcResult::new(value, all_bases_detail(n), CalcKind::Base));
    }

    None
}

fn timespan_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)^(.+?)\s+(?:to|in|as)\s+(?:timespan|hours?\s+and\s+min(?:ute)?s?)$")
            .unwrap()
    })
}

/// Length unit → (factor to inches, short label).
fn inch_unit(token: &str) -> Option<(f64, &'static str)> {
    match token {
        "in" | "inch" | "inches" => Some((1.0, "in")),
        "cm" => Some((1.0 / 2.54, "cm")),
        "mm" => Some((1.0 / 25.4, "mm")),
        "pt" | "point" | "points" => Some((1.0 / 72.0, "pt")),
        _ => None,
    }
}

struct PixelPatterns {
    to_px: Regex,
    from_px: Regex,
}

fn pixel_patterns() -> &'static PixelPatterns {
    static P: OnceLock<PixelPatterns> = OnceLock::new();
    P.get_or_init(|| PixelPatterns {
        to_px: Regex::new(
            r"(?i)^(\d+(?:\.\d+)?)\s*(inches|inch|in|cm|mm|points|point|pt)\s+(?:in|to|as)\s+(?:px|pixels?)\s+at\s+(\d+(?:\.\d+)?)\s*(?:ppi|dpi)$",
        )
        .unwrap(),
        from_px: Regex::new(
            r"(?i)^(\d+(?:\.\d+)?)\s*(?:px|pixels?)\s+(?:in|to|as)\s+(inches|inch|in|cm|mm|points|point|pt)\s+at\s+(\d+(?:\.\d+)?)\s*(?:ppi|dpi)$",
        )
        .unwrap(),
    })
}

/// Design-size conversions: `2 inches in px at 72 ppi` → `144 px`,
/// `144 px in inches at 72 ppi` → `2 in`.
pub fn evaluate_pixels(query: &str) -> Option<CalcResult> {
    use super::format::format_number;
    let p = pixel_patterns();
    let q = query.trim();

    if let Some(c) = p.to_px.captures(q) {
        let v: f64 = c[1].parse().ok()?;
        let (factor, _) = inch_unit(&c[2].to_lowercase())?;
        let ppi: f64 = c[3].parse().ok()?;
        let px = v * factor * ppi;
        return Some(CalcResult::new(
            format!("{} px", format_number(px)),
            format!("at {} ppi", format_number(ppi)),
            CalcKind::Unit,
        ));
    }

    if let Some(c) = p.from_px.captures(q) {
        let px: f64 = c[1].parse().ok()?;
        let (factor, label) = inch_unit(&c[2].to_lowercase())?;
        let ppi: f64 = c[3].parse().ok()?;
        if ppi == 0.0 {
            return None;
        }
        let v = px / ppi / factor;
        return Some(CalcResult::new(
            format!("{} {label}", format_number(v)),
            format!("at {} ppi", format_number(ppi)),
            CalcKind::Unit,
        ));
    }

    None
}

/// If the query asks for a timespan (`145 min to timespan`), return the
/// inner expression to be evaluated to seconds by the engine.
pub fn timespan_inner(query: &str) -> Option<String> {
    timespan_re()
        .captures(query.trim())
        .map(|c| c[1].to_string())
}

/// `8700` seconds → `"2 h 25 min"`. Shows the two largest non-zero units.
pub fn format_seconds(secs: f64) -> String {
    let total = secs.round().abs() as u64;
    if total == 0 {
        return "0 s".to_string();
    }
    const UNITS: [(u64, &str); 4] = [(86400, "d"), (3600, "h"), (60, "min"), (1, "s")];
    let mut parts = Vec::new();
    let mut rest = total;
    for (size, label) in UNITS {
        let n = rest / size;
        rest %= size;
        if n > 0 {
            parts.push(format!("{n} {label}"));
        }
        if parts.len() == 2 {
            break;
        }
    }
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calculator::CalcKind;

    #[test]
    fn ratio_simplifies_by_gcd() {
        let r = evaluate_ratio("ratio of 384 to 240").unwrap();
        assert_eq!(r.value, "8 : 5");
        assert_eq!(r.kind, CalcKind::Ratio);
        assert!(r.detail.contains("1.6"), "detail: {}", r.detail);
    }

    #[test]
    fn ratio_already_reduced() {
        assert_eq!(evaluate_ratio("ratio of 3 to 5").unwrap().value, "3 : 5");
    }

    #[test]
    fn ratio_with_decimals() {
        assert_eq!(evaluate_ratio("ratio of 1.5 to 3").unwrap().value, "1 : 2");
    }

    #[test]
    fn ratio_rejects_other_queries() {
        assert!(evaluate_ratio("ratio").is_none());
        assert!(evaluate_ratio("2+2").is_none());
    }

    #[test]
    fn hex_literal_shows_all_bases() {
        let r = evaluate_bases("0xff").unwrap();
        assert_eq!(r.value, "255");
        assert_eq!(r.kind, CalcKind::Base);
        assert!(r.detail.contains("0b11111111"), "detail: {}", r.detail);
        assert!(r.detail.contains("0o377"), "detail: {}", r.detail);
    }

    #[test]
    fn binary_and_octal_literals() {
        assert_eq!(evaluate_bases("0b1010").unwrap().value, "10");
        assert_eq!(evaluate_bases("0o755").unwrap().value, "493");
    }

    #[test]
    fn decimal_to_base_conversions() {
        assert_eq!(evaluate_bases("255 to hex").unwrap().value, "0xFF");
        assert_eq!(evaluate_bases("12 to binary").unwrap().value, "0b1100");
        assert_eq!(evaluate_bases("12 in bin").unwrap().value, "0b1100");
        assert_eq!(evaluate_bases("8 to octal").unwrap().value, "0o10");
    }

    #[test]
    fn based_literal_to_decimal() {
        assert_eq!(evaluate_bases("0x2f to decimal").unwrap().value, "47");
        assert_eq!(evaluate_bases("0b111 to dec").unwrap().value, "7");
    }

    #[test]
    fn bases_reject_other_queries() {
        assert!(evaluate_bases("hello").is_none());
        assert!(evaluate_bases("2+2").is_none());
        assert!(evaluate_bases("255").is_none());
    }

    #[test]
    fn timespan_extracts_inner_expression() {
        assert_eq!(timespan_inner("145 min to timespan").unwrap(), "145 min");
        assert_eq!(
            timespan_inner("1.5 days + 2 hours as timespan").unwrap(),
            "1.5 days + 2 hours"
        );
        assert!(timespan_inner("145 min to hours").is_none());
    }

    #[test]
    fn timespan_hours_and_minutes_phrasing() {
        assert_eq!(
            timespan_inner("145 minutes as hours and minutes").unwrap(),
            "145 minutes"
        );
        assert_eq!(
            timespan_inner("500 min in hours and mins").unwrap(),
            "500 min"
        );
    }

    #[test]
    fn pixels_at_ppi() {
        let r = evaluate_pixels("2 inches in px at 72 ppi").unwrap();
        assert_eq!(r.value, "144 px");
        assert_eq!(r.kind, CalcKind::Unit);
        assert_eq!(
            evaluate_pixels("1 in to px at 300 dpi").unwrap().value,
            "300 px"
        );
        assert_eq!(
            evaluate_pixels("2.54 cm in px at 100 ppi").unwrap().value,
            "100 px"
        );
    }

    #[test]
    fn pixels_reverse_direction() {
        assert_eq!(
            evaluate_pixels("144 px in inches at 72 ppi").unwrap().value,
            "2 in"
        );
    }

    #[test]
    fn pixels_rejects_other_queries() {
        assert!(evaluate_pixels("2 inches in px").is_none());
        assert!(evaluate_pixels("2+2").is_none());
    }

    #[test]
    fn format_seconds_two_largest_units() {
        assert_eq!(format_seconds(8700.0), "2 h 25 min");
        assert_eq!(format_seconds(90.0), "1 min 30 s");
        assert_eq!(format_seconds(90061.0), "1 d 1 h");
        assert_eq!(format_seconds(45.0), "45 s");
        assert_eq!(format_seconds(3600.0), "1 h");
    }
}
