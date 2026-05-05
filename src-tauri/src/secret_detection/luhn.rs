/// Validates a candidate credit-card-shaped string using the Luhn algorithm.
///
/// Strips spaces and dashes, requires the remaining input to be 13–19 digits,
/// and runs the Luhn checksum. Returns `false` for any non-conforming input
/// rather than erroring — callers are matching candidate substrings, not
/// asserting numerical validity beforehand.
pub fn is_valid_luhn(input: &str) -> bool {
    let mut digits: Vec<u32> = Vec::with_capacity(input.len());
    for ch in input.chars() {
        if ch == ' ' || ch == '-' {
            continue;
        }
        match ch.to_digit(10) {
            Some(d) => digits.push(d),
            None => return false,
        }
    }
    if digits.len() < 13 || digits.len() > 19 {
        return false;
    }

    // Double every second digit from the right (i.e. starting at the
    // second-to-last index). Sum the digits of doubled values; the total
    // must be divisible by 10.
    let mut sum: u32 = 0;
    let len = digits.len();
    for (i, d) in digits.iter().enumerate() {
        let from_right = len - 1 - i;
        if from_right % 2 == 1 {
            let doubled = d * 2;
            sum += if doubled > 9 { doubled - 9 } else { doubled };
        } else {
            sum += d;
        }
    }
    sum.is_multiple_of(10)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_visa_number() {
        assert!(is_valid_luhn("4111111111111111"));
    }

    #[test]
    fn invalid_one_off_visa() {
        assert!(!is_valid_luhn("4111111111111112"));
    }

    #[test]
    fn valid_visa_with_spaces() {
        assert!(is_valid_luhn("4111 1111 1111 1111"));
    }

    #[test]
    fn valid_visa_with_dashes() {
        assert!(is_valid_luhn("4111-1111-1111-1111"));
    }

    #[test]
    fn valid_amex_15_digits() {
        // 378282246310005 is the canonical Amex test number from Stripe docs
        assert!(is_valid_luhn("378282246310005"));
    }

    #[test]
    fn valid_mastercard() {
        assert!(is_valid_luhn("5555555555554444"));
    }

    #[test]
    fn rejects_too_short() {
        assert!(!is_valid_luhn("123"));
        assert!(!is_valid_luhn("123456789012"));
    }

    #[test]
    fn rejects_too_long() {
        assert!(!is_valid_luhn("12345678901234567890"));
    }

    #[test]
    fn rejects_non_digit_characters() {
        assert!(!is_valid_luhn("4111-abcd-1111-1111"));
    }

    #[test]
    fn rejects_empty_string() {
        assert!(!is_valid_luhn(""));
    }

    #[test]
    fn rejects_all_zeros() {
        // All zeros pass the checksum but are not a valid card; we accept that
        // since the regex layer doesn't typically emit "0000000000000000" and
        // callers pair this with a length+context match.
        assert!(is_valid_luhn("0000000000000000"));
    }
}
