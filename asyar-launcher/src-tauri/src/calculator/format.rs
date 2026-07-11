//! Number and output formatting shared across the calculator pipeline.

/// Insert thousands separators into a plain unsigned integer string.
pub(crate) fn group_thousands(digits: &str) -> String {
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    let len = digits.len();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (len - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// Format a float for display: thousands separators, up to 6 decimal
/// places, no trailing zeros (`48.3` not `48.300000`).
pub fn format_number(n: f64) -> String {
    let formatted = format!("{n:.6}");
    let (int_part, frac_part) = formatted.split_once('.').unwrap_or((&formatted, ""));
    let (sign, int_digits) = match int_part.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", int_part),
    };
    let frac = frac_part.trim_end_matches('0');
    let grouped = group_thousands(int_digits);
    if frac.is_empty() {
        format!("{sign}{grouped}")
    } else {
        format!("{sign}{grouped}.{frac}")
    }
}

/// Format a monetary amount: thousands separators, exactly 2 decimals.
pub fn format_money(n: f64) -> String {
    let formatted = format!("{n:.2}");
    let (int_part, frac_part) = formatted.split_once('.').unwrap_or((&formatted, "00"));
    let (sign, int_digits) = match int_part.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", int_part),
    };
    format!("{sign}{}.{frac_part}", group_thousands(int_digits))
}

/// Insert thousands separators into every standalone decimal integer part
/// of a fend output string, leaving hex/binary/octal literals and
/// fractional digits untouched. Also swaps fend's `approx.` prefix for `≈`.
pub fn beautify_fend_output(s: &str) -> String {
    let s = match s.strip_prefix("approx. ") {
        Some(rest) => format!("≈ {rest}"),
        None => s.to_string(),
    };

    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len() + 8);
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            let run: String = chars[start..i].iter().collect();
            // Skip grouping for fractional parts and based literals
            // (anything glued to a letter, digit-prefix marker or dot).
            let prev = if start > 0 {
                Some(chars[start - 1])
            } else {
                None
            };
            let skip = matches!(prev, Some(p) if p == '.' || p == '_' || p.is_ascii_alphanumeric());
            if !skip && run.len() >= 4 {
                out.push_str(&group_thousands(&run));
            } else {
                out.push_str(&run);
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_number_basic() {
        assert_eq!(format_number(4.0), "4");
        assert_eq!(format_number(0.5), "0.5");
        assert_eq!(format_number(1234567.0), "1,234,567");
        assert_eq!(format_number(1234.5678), "1,234.5678");
    }

    #[test]
    fn format_number_rounds_long_decimals() {
        assert_eq!(format_number(0.123456789), "0.123457");
        assert_eq!(format_number(-1234.5), "-1,234.5");
    }

    #[test]
    fn format_money_two_decimals() {
        assert_eq!(format_money(48.3), "48.30");
        assert_eq!(format_money(1310000.0), "1,310,000.00");
        assert_eq!(format_money(6.3), "6.30");
    }

    #[test]
    fn beautify_adds_separators_to_plain_numbers() {
        assert_eq!(beautify_fend_output("1609.344 km"), "1,609.344 km");
        assert_eq!(beautify_fend_output("131000 IQD"), "131,000 IQD");
        assert_eq!(beautify_fend_output("255"), "255");
        assert_eq!(beautify_fend_output("1000000"), "1,000,000");
    }

    #[test]
    fn beautify_leaves_based_literals_alone() {
        assert_eq!(beautify_fend_output("0x11111"), "0x11111");
        assert_eq!(beautify_fend_output("0b11111111"), "0b11111111");
        assert_eq!(beautify_fend_output("0o37777"), "0o37777");
    }

    #[test]
    fn beautify_does_not_touch_fraction_digits() {
        assert_eq!(beautify_fend_output("3.14159265"), "3.14159265");
        assert_eq!(beautify_fend_output("12345.67890"), "12,345.67890");
    }

    #[test]
    fn beautify_replaces_approx_prefix() {
        assert_eq!(
            beautify_fend_output("approx. 3.1415926536"),
            "≈ 3.1415926536"
        );
    }
}
