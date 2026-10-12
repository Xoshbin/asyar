use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD},
    Engine,
};
use zeroize::{Zeroize, Zeroizing};

pub struct Redactor {
    by_first_byte: [Vec<Zeroizing<String>>; 256],
}
impl Redactor {
    pub fn new(secrets: &[&str]) -> Self {
        let mut variants = Vec::new();
        for s in secrets.iter().filter(|s| !s.is_empty()) {
            variants.push(Zeroizing::new((*s).to_string()));
            const STANDARD_URL: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
                .remove(b'-')
                .remove(b'_')
                .remove(b'.')
                .remove(b'~');
            const COMPONENT_URL: &percent_encoding::AsciiSet = &STANDARD_URL
                .remove(b'!')
                .remove(b'\'')
                .remove(b'(')
                .remove(b')')
                .remove(b'*');
            for set in [
                percent_encoding::NON_ALPHANUMERIC,
                STANDARD_URL,
                COMPONENT_URL,
            ] {
                let encoded =
                    Zeroizing::new(percent_encoding::utf8_percent_encode(s, set).to_string());
                variants.push(encoded.clone());
                // Percent hex digits are case-insensitive; keep raw characters intact.
                let mut lower = Zeroizing::new(encoded.as_bytes().to_vec());
                let mut i = 0;
                while i + 2 < lower.len() {
                    if lower[i] == b'%' {
                        lower[i + 1].make_ascii_lowercase();
                        lower[i + 2].make_ascii_lowercase();
                        i += 3;
                    } else {
                        i += 1;
                    }
                }
                variants.push(Zeroizing::new(
                    std::str::from_utf8(&lower).unwrap_or_default().to_owned(),
                ));
            }
            if let Ok(json) = serde_json::to_string(s) {
                let json = Zeroizing::new(json);
                variants.push(Zeroizing::new(json[1..json.len() - 1].to_string()));
            }
            for engine in [&STANDARD, &STANDARD_NO_PAD, &URL_SAFE, &URL_SAFE_NO_PAD] {
                variants.push(Zeroizing::new(engine.encode(s)));
            }
        }
        variants.sort_by_key(|s| std::cmp::Reverse(s.len()));
        variants.dedup();
        let mut by_first_byte = std::array::from_fn(|_| Vec::new());
        for variant in variants {
            by_first_byte[variant.as_bytes()[0] as usize].push(variant);
        }
        Self { by_first_byte }
    }
    pub fn redact_str(&self, input: &str) -> String {
        const MARKER: &str = "[REDACTED]";
        let mut result = String::with_capacity(input.len());
        let mut rest = input;
        while !rest.is_empty() {
            if rest.starts_with(MARKER) {
                result.push_str(MARKER);
                rest = &rest[MARKER.len()..];
            } else if let Some(variant) = self.by_first_byte[rest.as_bytes()[0] as usize]
                .iter()
                .find(|s| rest.starts_with(s.as_str()))
            {
                result.push_str(MARKER);
                rest = &rest[variant.len()..];
            } else {
                let ch = rest.chars().next().expect("nonempty remainder");
                result.push(ch);
                rest = &rest[ch.len_utf8()..];
            }
        }
        result
    }
    pub fn redact_envelope(&self, value: &mut serde_json::Value) {
        match value {
            serde_json::Value::String(s) => {
                let redacted = self.redact_str(s);
                s.zeroize();
                *s = redacted;
            }
            serde_json::Value::Array(a) => {
                for v in a {
                    self.redact_envelope(v);
                }
            }
            serde_json::Value::Object(o) => {
                let old = std::mem::take(o);
                for (mut k, mut v) in old {
                    self.redact_envelope(&mut v);
                    let redacted = self.redact_str(&k);
                    k.zeroize();
                    o.insert(redacted, v);
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_echoes_and_unicode_are_redacted_in_one_pass() {
        let r = Redactor::new(&["abcdefgh", "Bearer abcdefgh"]);
        assert_eq!(
            r.redact_str(&"雪 Bearer abcdefgh abcdefgh ".repeat(4096)),
            "雪 [REDACTED] [REDACTED] ".repeat(4096)
        );
    }
    #[test]
    fn redacts_standard_url_encoding_of_token_punctuation() {
        let r = Redactor::new(&["abc-def_ghi/+"]);
        assert_eq!(r.redact_str("abc-def_ghi%2F%2B"), "[REDACTED]");
    }
    #[test]
    fn replacement_markers_are_not_redacted_again() {
        let r = Redactor::new(&["REDACTED"]);
        let once = r.redact_str("REDACTED");
        assert_eq!(once, "[REDACTED]");
        assert_eq!(r.redact_str(&once), once);
    }
    #[test]
    fn redacts_raw_secret_in_body_and_headers() {
        let mut v = serde_json::json!({"body":"abcdefgh", "headers":{"x-token":"abcdefgh"}});
        Redactor::new(&["abcdefgh"]).redact_envelope(&mut v);
        assert!(!v.to_string().contains("abcdefgh"));
    }
    #[test]
    fn redacts_url_encoded_json_escaped_and_base64_variants() {
        let r = Redactor::new(&["abc/def+ghi\"j"]);
        for s in [
            "abc%2Fdef%2Bghi%22j".to_string(),
            "abc/def+ghi\\\"j".to_string(),
            STANDARD.encode("abc/def+ghi\"j"),
            URL_SAFE_NO_PAD.encode("abc/def+ghi\"j"),
        ] {
            assert_ne!(r.redact_str(&s), s, "{s}");
        }
    }
    #[test]
    fn redacts_full_header_value() {
        assert_eq!(
            Redactor::new(&["abcdefgh", "Bearer abcdefgh"]).redact_str("Bearer abcdefgh"),
            "[REDACTED]"
        );
    }
    #[test]
    fn redaction_is_idempotent() {
        let r = Redactor::new(&["abcdefgh"]);
        let s = r.redact_str("abcdefgh");
        assert_eq!(s, r.redact_str(&s));
    }
}
