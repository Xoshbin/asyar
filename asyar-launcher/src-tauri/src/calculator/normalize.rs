//! Query normalization: turns loosely-typed natural language into
//! expressions the downstream handlers (and fend) understand.

use regex::Regex;
use std::sync::OnceLock;

/// ISO 4217 codes, mirroring fend's built-in currency identifiers so a
/// lowercased code round-trips into something fend recognizes.
const CURRENCY_CODES: &[&str] = &[
    "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT",
    "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BOV", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD",
    "CAD", "CDF", "CHE", "CHF", "CHW", "CLF", "CLP", "CNY", "COP", "COU", "CRC", "CUC", "CUP",
    "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP",
    "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HRK", "HTG", "HUF", "IDR",
    "ILS", "INR", "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW",
    "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL", "MGA",
    "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MXV", "MYR", "MZN", "NAD",
    "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG",
    "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE",
    "SLL", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP",
    "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD", "USN", "UYI", "UYU", "UYW", "UZS", "VED",
    "VES", "VND", "VUV", "WST", "XAF", "XAG", "XAU", "XCD", "XDR", "XOF", "XPD", "XPF", "XPT",
    "YER", "ZAR", "ZMW", "ZWL",
];

fn is_currency_code(token: &str) -> bool {
    token.len() == 3 && CURRENCY_CODES.iter().any(|c| c.eq_ignore_ascii_case(token))
}

fn symbol_to_code(sym: &str) -> Option<&'static str> {
    match sym {
        "$" => Some("USD"),
        "€" => Some("EUR"),
        "£" => Some("GBP"),
        "¥" => Some("JPY"),
        _ => None,
    }
}

/// Multiply out a `k`/`m`/`b` suffix and render without float noise.
fn expand_suffix(amount: &str, suffix: Option<&str>) -> String {
    let clean = amount.replace(',', "");
    let n: f64 = match clean.parse() {
        Ok(n) => n,
        Err(_) => return clean,
    };
    let factor = match suffix.map(|s| s.to_ascii_lowercase()) {
        Some(s) if s == "k" => 1e3,
        Some(s) if s == "m" => 1e6,
        Some(s) if s == "b" => 1e9,
        _ => 1.0,
    };
    let v = n * factor;
    if v.fract() == 0.0 && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

struct Patterns {
    prefixes: Regex,
    sqrt: Regex,
    cbrt: Regex,
    pow_of: Regex,
    pow_word: Regex,
    times: Regex,
    divided: Regex,
    plus: Regex,
    minus: Regex,
    squared: Regex,
    cubed: Regex,
    half_of: Regex,
    percent_word: Regex,
    sym_amount: Regex,
    code_amount: Regex,
    amount_code: Regex,
    bare_kb: Regex,
    code_token: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        prefixes: Regex::new(
            r"(?i)^(?:what\s+is|what's|whats|how\s+much\s+is|convert|calculate|calc)\s+",
        )
        .unwrap(),
        sqrt: Regex::new(r"(?i)\bsquare\s+root\s+of\s+(.+)$").unwrap(),
        cbrt: Regex::new(r"(?i)\bcube\s+root\s+of\s+(.+)$").unwrap(),
        pow_of: Regex::new(r"(?i)\s+to\s+the\s+power\s+of\s+").unwrap(),
        pow_word: Regex::new(r"(?i)(\d+(?:\.\d+)?)\s+power\s+(\d+(?:\.\d+)?)").unwrap(),
        times: Regex::new(r"(?i)\s+times\s+").unwrap(),
        divided: Regex::new(r"(?i)\s+divided\s+by\s+").unwrap(),
        plus: Regex::new(r"(?i)\s+plus\s+").unwrap(),
        minus: Regex::new(r"(?i)\s+minus\s+").unwrap(),
        squared: Regex::new(r"(?i)(\d+(?:\.\d+)?)\s+squared\b").unwrap(),
        cubed: Regex::new(r"(?i)(\d+(?:\.\d+)?)\s+cubed\b").unwrap(),
        half_of: Regex::new(r"(?i)\bhalf\s+of\s+(.+)$").unwrap(),
        percent_word: Regex::new(r"(?i)(\d+(?:\.\d+)?)\s+percent\b").unwrap(),
        sym_amount: Regex::new(r"([$€£¥])\s*(\d[\d,]*(?:\.\d+)?)([kKmMbB])?\b").unwrap(),
        code_amount: Regex::new(r"(?i)\b([a-z]{3})(\d[\d,]*(?:\.\d+)?)([kmb])?\b").unwrap(),
        amount_code: Regex::new(r"(?i)\b(\d[\d,]*(?:\.\d+)?)([kmb])\s+([a-z]{3})\b").unwrap(),
        bare_kb: Regex::new(r"(?i)\b(\d[\d,]*(?:\.\d+)?)([kb])\b").unwrap(),
        code_token: Regex::new(r"(?i)\b([a-z]{3})\b").unwrap(),
    })
}

/// Normalize a raw query:
/// - strips question scaffolding ("what is …?", "how much is …", "convert …")
/// - rewrites wordy operators ("times", "divided by", "plus", "minus",
///   "power", "square root of", "squared", "half of", …)
/// - moves currency symbols/codes behind the amount (`$100` → `100 USD`)
/// - expands `k`/`m`/`b` amount shorthand (`10k` → `10000`, `$2.5m` →
///   `2500000 USD`) without touching real units like `10km`
/// - uppercases ISO currency codes (`usd` → `USD`)
pub fn normalize(query: &str) -> String {
    let p = patterns();
    let mut s = query.split_whitespace().collect::<Vec<_>>().join(" ");

    // Question scaffolding.
    loop {
        let stripped = p.prefixes.replace(&s, "").into_owned();
        if stripped == s {
            break;
        }
        s = stripped;
    }
    s = s.trim_end_matches(['?', '=', ' ']).to_string();

    // Wordy math.
    s = p.sqrt.replace(&s, "sqrt($1)").into_owned();
    s = p.cbrt.replace(&s, "cbrt($1)").into_owned();
    s = p.pow_of.replace_all(&s, "^").into_owned();
    s = p.pow_word.replace_all(&s, "$1^$2").into_owned();
    s = p.times.replace_all(&s, " * ").into_owned();
    s = p.divided.replace_all(&s, " / ").into_owned();
    s = p.plus.replace_all(&s, " + ").into_owned();
    s = p.minus.replace_all(&s, " - ").into_owned();
    s = p.squared.replace_all(&s, "($1)^2").into_owned();
    s = p.cubed.replace_all(&s, "($1)^3").into_owned();
    s = p.half_of.replace(&s, "($1)/2").into_owned();
    s = p.percent_word.replace_all(&s, "$1%").into_owned();

    // `$100` / `€50` → `100 USD` / `50 EUR`, expanding k/m/b.
    s = p
        .sym_amount
        .replace_all(&s, |c: &regex::Captures| {
            let code = symbol_to_code(&c[1]).unwrap_or("USD");
            let amount = expand_suffix(&c[2], c.get(3).map(|m| m.as_str()));
            format!("{amount} {code}")
        })
        .into_owned();

    // `usd1k` → `1000 USD`.
    s = p
        .code_amount
        .replace_all(&s, |c: &regex::Captures| {
            if is_currency_code(&c[1]) {
                let amount = expand_suffix(&c[2], c.get(3).map(|m| m.as_str()));
                format!("{amount} {}", c[1].to_ascii_uppercase())
            } else {
                c[0].to_string()
            }
        })
        .into_owned();

    // `1m usd` → `1000000 usd` (m only expands next to a currency code).
    s = p
        .amount_code
        .replace_all(&s, |c: &regex::Captures| {
            if is_currency_code(&c[3]) {
                format!("{} {}", expand_suffix(&c[1], Some(&c[2])), &c[3])
            } else {
                c[0].to_string()
            }
        })
        .into_owned();

    // Bare `10k` / `1.2b` (never `m`: that's metres).
    s = p
        .bare_kb
        .replace_all(&s, |c: &regex::Captures| expand_suffix(&c[1], Some(&c[2])))
        .into_owned();

    // Uppercase ISO currency codes.
    s = p
        .code_token
        .replace_all(&s, |c: &regex::Captures| {
            if is_currency_code(&c[1]) {
                c[1].to_ascii_uppercase()
            } else {
                c[1].to_string()
            }
        })
        .into_owned();

    s.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_question_scaffolding() {
        assert_eq!(normalize("What is 20% of 80?"), "20% of 80");
        assert_eq!(normalize("how much is 5 * 3"), "5 * 3");
        assert_eq!(normalize("convert 10 km to miles"), "10 km to miles");
        assert_eq!(normalize("2+2="), "2+2");
    }

    #[test]
    fn rewrites_wordy_math() {
        assert_eq!(normalize("square root of 625"), "sqrt(625)");
        assert_eq!(normalize("cube root of 27"), "cbrt(27)");
        assert_eq!(normalize("2 power 10"), "2^10");
        assert_eq!(normalize("2 to the power of 10"), "2^10");
        assert_eq!(normalize("7 times 8"), "7 * 8");
        assert_eq!(normalize("100 divided by 4"), "100 / 4");
        assert_eq!(normalize("9 plus 3"), "9 + 3");
        assert_eq!(normalize("9 minus 3"), "9 - 3");
        assert_eq!(normalize("5 squared"), "(5)^2");
        assert_eq!(normalize("4 cubed"), "(4)^3");
        assert_eq!(normalize("half of 10"), "(10)/2");
        assert_eq!(normalize("20 percent of 80"), "20% of 80");
    }

    #[test]
    fn moves_currency_symbols_behind_amount() {
        assert_eq!(normalize("$100 in eur"), "100 USD in EUR");
        assert_eq!(normalize("€50 + $20 in gbp"), "50 EUR + 20 USD in GBP");
        assert_eq!(normalize("£9.99"), "9.99 GBP");
    }

    #[test]
    fn uppercases_iso_currency_codes() {
        assert_eq!(normalize("100 usd to iqd"), "100 USD to IQD");
        assert_eq!(normalize("25 usd to eur"), "25 USD to EUR");
    }

    #[test]
    fn expands_amount_shorthand() {
        assert_eq!(normalize("10k"), "10000");
        assert_eq!(normalize("$1k in iqd"), "1000 USD in IQD");
        assert_eq!(normalize("usd1k"), "1000 USD");
        assert_eq!(normalize("$2.5m"), "2500000 USD");
        assert_eq!(normalize("1.2b"), "1200000000");
        assert_eq!(normalize("1m usd to eur"), "1000000 USD to EUR");
    }

    #[test]
    fn does_not_break_real_units() {
        // `10km` must stay kilometres, not become 10000 metres.
        assert_eq!(normalize("10km in miles"), "10km in miles");
        // `5m` alone is metres, not millions.
        assert_eq!(normalize("5m in feet"), "5m in feet");
        // Kelvin with a space stays put.
        assert_eq!(normalize("10 k"), "10 k");
    }

    #[test]
    fn leaves_plain_expressions_alone() {
        assert_eq!(normalize("2+2"), "2+2");
        assert_eq!(normalize("5'10\" to cm"), "5'10\" to cm");
        assert_eq!(normalize("20% off 80"), "20% off 80");
    }
}
