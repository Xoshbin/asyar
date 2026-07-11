//! Soulver-style percentage phrases fend doesn't understand:
//! discounts, tips, percent-change, and `X ± Y%`.

use regex::Regex;
use std::sync::OnceLock;

use super::format::{format_money, format_number};
use super::{CalcKind, CalcResult};

struct Patterns {
    of: Regex,
    off: Regex,
    tip: Regex,
    plus_minus: Regex,
    what_pct: Regex,
    change: Regex,
    inc_dec: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    const NUM: &str = r"(\d[\d,]*(?:\.\d+)?)";
    P.get_or_init(|| Patterns {
        of: Regex::new(&format!(r"(?i)^{NUM}\s*%\s*of\s+{NUM}$")).unwrap(),
        off: Regex::new(&format!(r"(?i)^{NUM}\s*%\s*off\s+(?:of\s+)?{NUM}$")).unwrap(),
        tip: Regex::new(&format!(r"(?i)^{NUM}\s*%\s*tip\s+on\s+{NUM}$")).unwrap(),
        plus_minus: Regex::new(&format!(r"^{NUM}\s*([+\-])\s*{NUM}\s*%$")).unwrap(),
        what_pct: Regex::new(&format!(
            r"(?i)^{NUM}\s+is\s+what\s+(?:%|percent)\s+of\s+{NUM}$"
        ))
        .unwrap(),
        change: Regex::new(&format!(r"(?i)^%\s*change\s+from\s+{NUM}\s+to\s+{NUM}$")).unwrap(),
        inc_dec: Regex::new(&format!(
            r"(?i)^(increase|decrease)\s+{NUM}\s+by\s+{NUM}\s*%$"
        ))
        .unwrap(),
    })
}

fn num(s: &str) -> Option<f64> {
    s.replace(',', "").parse().ok()
}

/// Percentage with up to 2 decimals, explicit sign: `+20%`, `-16.67%`.
fn format_signed_pct(p: f64) -> String {
    let rounded = (p * 100.0).round() / 100.0;
    let sign = if rounded >= 0.0 { "+" } else { "-" };
    let mut body = format!("{:.2}", rounded.abs());
    while body.ends_with('0') {
        body.pop();
    }
    if body.ends_with('.') {
        body.pop();
    }
    format!("{sign}{body}%")
}

/// Evaluate percentage phrases. Returns `None` when the query isn't one.
pub fn evaluate_percent(query: &str) -> Option<CalcResult> {
    let p = patterns();
    let q = query.trim();

    if let Some(c) = p.of.captures(q) {
        let (pct, base) = (num(&c[1])?, num(&c[2])?);
        let v = base * pct / 100.0;
        return Some(CalcResult::new(
            format_number(v),
            format!("{}% of {}", format_number(pct), format_number(base)),
            CalcKind::Percent,
        ));
    }

    if let Some(c) = p.off.captures(q) {
        let (pct, base) = (num(&c[1])?, num(&c[2])?);
        let saved = base * pct / 100.0;
        return Some(CalcResult::new(
            format_number(base - saved),
            format!("You save {}", format_number(saved)),
            CalcKind::Percent,
        ));
    }

    if let Some(c) = p.tip.captures(q) {
        let (pct, base) = (num(&c[1])?, num(&c[2])?);
        let tip = base * pct / 100.0;
        return Some(CalcResult::new(
            format_money(base + tip),
            format!("Tip: {}", format_money(tip)),
            CalcKind::Percent,
        ));
    }

    if let Some(c) = p.plus_minus.captures(q) {
        let (base, pct) = (num(&c[1])?, num(&c[3])?);
        let delta = base * pct / 100.0;
        let v = if &c[2] == "+" {
            base + delta
        } else {
            base - delta
        };
        return Some(CalcResult::new(
            format_number(v),
            format!(
                "{}% of {} = {}",
                format_number(pct),
                format_number(base),
                format_number(delta)
            ),
            CalcKind::Percent,
        ));
    }

    if let Some(c) = p.what_pct.captures(q) {
        let (part, whole) = (num(&c[1])?, num(&c[2])?);
        if whole == 0.0 {
            return None;
        }
        let pct = part / whole * 100.0;
        return Some(CalcResult::new(
            format!("{}%", format_number(pct)),
            format!("{} of {}", format_number(part), format_number(whole)),
            CalcKind::Percent,
        ));
    }

    if let Some(c) = p.change.captures(q) {
        let (from, to) = (num(&c[1])?, num(&c[2])?);
        if from == 0.0 {
            return None;
        }
        return Some(CalcResult::new(
            format_signed_pct((to - from) / from * 100.0),
            format!("from {} to {}", format_number(from), format_number(to)),
            CalcKind::Percent,
        ));
    }

    if let Some(c) = p.inc_dec.captures(q) {
        let (base, pct) = (num(&c[2])?, num(&c[3])?);
        let delta = base * pct / 100.0;
        let v = if c[1].eq_ignore_ascii_case("increase") {
            base + delta
        } else {
            base - delta
        };
        return Some(CalcResult::new(
            format_number(v),
            format!(
                "{} {} by {}%",
                &c[1],
                format_number(base),
                format_number(pct)
            ),
            CalcKind::Percent,
        ));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_of() {
        let r = evaluate_percent("52% of 900").unwrap();
        assert_eq!(r.value, "468");
        assert_eq!(r.kind, CalcKind::Percent);
    }

    #[test]
    fn percent_off_discount() {
        let r = evaluate_percent("20% off 80").unwrap();
        assert_eq!(r.value, "64");
        assert!(
            r.detail.contains("16"),
            "detail should show savings: {}",
            r.detail
        );
    }

    #[test]
    fn tip_on() {
        let r = evaluate_percent("15% tip on 42").unwrap();
        assert_eq!(r.value, "48.30");
        assert!(
            r.detail.contains("6.30"),
            "detail should show tip: {}",
            r.detail
        );
    }

    #[test]
    fn add_subtract_percent() {
        assert_eq!(evaluate_percent("80 + 20%").unwrap().value, "96");
        assert_eq!(evaluate_percent("80 - 20%").unwrap().value, "64");
    }

    #[test]
    fn what_percent_of() {
        let r = evaluate_percent("12 is what % of 80").unwrap();
        assert_eq!(r.value, "15%");
        let r = evaluate_percent("12 is what percent of 80").unwrap();
        assert_eq!(r.value, "15%");
    }

    #[test]
    fn percent_change() {
        assert_eq!(
            evaluate_percent("% change from 80 to 96").unwrap().value,
            "+20%"
        );
        assert_eq!(
            evaluate_percent("% change from 96 to 80").unwrap().value,
            "-16.67%"
        );
    }

    #[test]
    fn increase_decrease_by_percent() {
        assert_eq!(evaluate_percent("increase 80 by 20%").unwrap().value, "96");
        assert_eq!(evaluate_percent("decrease 80 by 20%").unwrap().value, "64");
    }

    #[test]
    fn handles_thousands_separators_in_input() {
        assert_eq!(evaluate_percent("10% off 1,200").unwrap().value, "1,080");
    }

    #[test]
    fn rejects_non_percent_queries() {
        assert!(evaluate_percent("20% offset").is_none());
        assert!(evaluate_percent("off 80").is_none());
        assert!(evaluate_percent("2+2").is_none());
        assert!(evaluate_percent("100 usd to eur").is_none());
    }
}
