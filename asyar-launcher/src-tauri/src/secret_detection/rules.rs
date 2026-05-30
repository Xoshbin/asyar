use crate::secret_detection::luhn::is_valid_luhn;
use regex::Regex;
use std::sync::OnceLock;

pub struct DetectorRule {
    pub kind: &'static str,
    pub pattern: &'static str,
    pub description: &'static str,
    /// Optional post-regex validator. When `Some`, a regex match is only
    /// considered a real hit if the validator returns true. Used for
    /// credit-card detection (Luhn) where the regex is permissive but the
    /// algorithmic check separates real numbers from random digit strings.
    pub validator: Option<fn(&str) -> bool>,
}

/// Bundled detector catalog. Each rule's pattern is anchored on word
/// boundaries to avoid mid-token matches. Patterns and length floors are
/// chosen to keep the false-positive rate near zero on plain-English text.
pub const RULES: &[DetectorRule] = &[
    DetectorRule {
        kind: "aws_access_key",
        pattern: r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b",
        description: "AWS access key ID",
        validator: None,
    },
    DetectorRule {
        kind: "github_pat",
        pattern: r"\bghp_[A-Za-z0-9]{36,}\b",
        description: "GitHub personal access token",
        validator: None,
    },
    DetectorRule {
        kind: "github_oauth",
        pattern: r"\bgho_[A-Za-z0-9]{36,}\b",
        description: "GitHub OAuth access token",
        validator: None,
    },
    DetectorRule {
        kind: "github_user_to_server",
        pattern: r"\bghu_[A-Za-z0-9]{36,}\b",
        description: "GitHub user-to-server token",
        validator: None,
    },
    DetectorRule {
        kind: "github_server_to_server",
        pattern: r"\bghs_[A-Za-z0-9]{36,}\b",
        description: "GitHub server-to-server token",
        validator: None,
    },
    DetectorRule {
        kind: "github_refresh",
        pattern: r"\bghr_[A-Za-z0-9]{36,}\b",
        description: "GitHub refresh token",
        validator: None,
    },
    DetectorRule {
        kind: "gitlab_pat",
        pattern: r"\bglpat-[A-Za-z0-9_-]{20,}\b",
        description: "GitLab personal access token",
        validator: None,
    },
    DetectorRule {
        kind: "stripe_live_secret",
        pattern: r"\bsk_live_[A-Za-z0-9]{24,}\b",
        description: "Stripe live secret key",
        validator: None,
    },
    DetectorRule {
        kind: "stripe_restricted",
        pattern: r"\brk_live_[A-Za-z0-9]{24,}\b",
        description: "Stripe restricted key",
        validator: None,
    },
    DetectorRule {
        kind: "slack_token",
        pattern: r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b",
        description: "Slack API token",
        validator: None,
    },
    DetectorRule {
        kind: "anthropic_key",
        pattern: r"\bsk-ant-[A-Za-z0-9_-]{40,}\b",
        description: "Anthropic API key",
        validator: None,
    },
    DetectorRule {
        // OpenAI keys start `sk-` followed by 32+ alphanumeric characters.
        // The `(?-u)` flag turns off Unicode-aware word boundaries so `\b`
        // treats `-` (between `sk` and the body) as a word boundary in the
        // ASCII-only sense — without it, `\bsk-` does NOT match because
        // `sk` and `-` are both non-word for `\b`'s purposes here. We also
        // exclude `sk-ant-` matches (handled by the anthropic rule above)
        // by ordering: the redact function applies rules in order and
        // skips overlaps, so `anthropic_key` always wins on `sk-ant-…`.
        kind: "openai_key",
        pattern: r"\bsk-[A-Za-z0-9_-]{32,}\b",
        description: "OpenAI API key",
        validator: None,
    },
    DetectorRule {
        kind: "pem_private_key",
        pattern: r"-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----",
        description: "PEM-encoded private key",
        validator: None,
    },
    DetectorRule {
        kind: "jwt",
        pattern: r"\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b",
        description: "JSON Web Token",
        validator: None,
    },
    DetectorRule {
        // Permissive regex for digit candidates; Luhn validates.
        kind: "credit_card",
        pattern: r"\b\d(?:[ -]?\d){12,18}\b",
        description: "Credit card number (Luhn-validated)",
        validator: Some(is_valid_luhn),
    },
];

pub struct CompiledRule {
    pub kind: &'static str,
    pub regex: Regex,
    pub validator: Option<fn(&str) -> bool>,
}

static COMPILED: OnceLock<Vec<CompiledRule>> = OnceLock::new();

/// Lazy-compiled rule catalog. Compiling all regexes on first call
/// (~14 patterns) takes single-digit milliseconds; subsequent calls
/// reuse the cached `Vec`.
pub fn compiled_rules() -> &'static [CompiledRule] {
    COMPILED.get_or_init(|| {
        RULES
            .iter()
            .map(|r| CompiledRule {
                kind: r.kind,
                regex: Regex::new(r.pattern)
                    .unwrap_or_else(|e| panic!("rule '{}' regex failed to compile: {e}", r.kind)),
                validator: r.validator,
            })
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn matches(kind: &str, sample: &str) -> bool {
        let rules = compiled_rules();
        let rule = rules
            .iter()
            .find(|r| r.kind == kind)
            .unwrap_or_else(|| panic!("no rule with kind {kind}"));
        let Some(m) = rule.regex.find(sample) else {
            return false;
        };
        if let Some(v) = rule.validator {
            v(m.as_str())
        } else {
            true
        }
    }

    // AKIA / ASIA suffixes are the canonical AWS access key prefixes —
    // preserved as-is in the test names for grep-discoverability.
    #[test]
    #[allow(non_snake_case)]
    fn detects_aws_access_key_AKIA() {
        assert!(matches("aws_access_key", "key=AKIAIOSFODNN7EXAMPLE end"));
    }

    #[test]
    #[allow(non_snake_case)]
    fn detects_aws_access_key_ASIA() {
        assert!(matches("aws_access_key", "ASIAIOSFODNN7EXAMPLE"));
    }

    #[test]
    fn rejects_short_aws_key() {
        assert!(!matches("aws_access_key", "AKIA1234"));
    }

    #[test]
    fn detects_github_pat() {
        assert!(matches(
            "github_pat",
            "token=ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ trailing",
        ));
    }

    #[test]
    fn rejects_short_github_pat() {
        assert!(!matches("github_pat", "ghp_short"));
    }

    #[test]
    fn detects_github_oauth() {
        assert!(matches(
            "github_oauth",
            "gho_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
        ));
    }

    #[test]
    fn detects_github_user_to_server() {
        assert!(matches(
            "github_user_to_server",
            "ghu_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
        ));
    }

    #[test]
    fn detects_github_server_to_server() {
        assert!(matches(
            "github_server_to_server",
            "ghs_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
        ));
    }

    #[test]
    fn detects_github_refresh() {
        assert!(matches(
            "github_refresh",
            "ghr_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ",
        ));
    }

    #[test]
    fn detects_gitlab_pat() {
        assert!(matches(
            "gitlab_pat",
            "GITLAB_TOKEN=glpat-abc_123-XYZ-deadbeef0011",
        ));
    }

    #[test]
    fn detects_stripe_live_secret() {
        assert!(matches(
            "stripe_live_secret",
            &format!("stripe_key={}_{}", "sk_live", "abcdefghijklmnopqrstuvwx"),
        ));
    }

    #[test]
    fn rejects_stripe_test_key() {
        // sk_test_… is a test key — we deliberately don't match it.
        assert!(!matches(
            "stripe_live_secret",
            &format!("{}_{}", "sk_test", "abcdefghijklmnopqrstuvwx"),
        ));
    }

    #[test]
    fn detects_stripe_restricted() {
        assert!(matches(
            "stripe_restricted",
            &format!("{}_{}", "rk_live", "abcdefghijklmnopqrstuvwx"),
        ));
    }

    #[test]
    fn detects_slack_token() {
        assert!(matches(
            "slack_token",
            &format!(
                "{}-{}",
                "xoxb", "12345678901-1234567890-AbCdEfGhIjKlMnOpQrStUvWx"
            ),
        ));
    }

    #[test]
    fn rejects_short_slack_token() {
        assert!(!matches("slack_token", "xoxb-short"));
    }

    #[test]
    fn detects_anthropic_key() {
        let key = format!("sk-ant-api03-{}", "x".repeat(40));
        assert!(matches("anthropic_key", &key));
    }

    #[test]
    fn detects_openai_key() {
        let key = format!("OPENAI_KEY=sk-{}", "x".repeat(40));
        assert!(matches("openai_key", &key));
    }

    #[test]
    fn rejects_too_short_sk_prefix() {
        assert!(!matches("openai_key", "sk-shortvalue"));
    }

    #[test]
    fn detects_pem_private_key_rsa() {
        let pem =
            "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----";
        assert!(matches("pem_private_key", pem));
    }

    #[test]
    fn detects_pem_private_key_openssh() {
        let pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXkt...\n-----END OPENSSH PRIVATE KEY-----";
        assert!(matches("pem_private_key", pem));
    }

    #[test]
    fn detects_jwt_three_segments() {
        let jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        assert!(matches("jwt", jwt));
    }

    #[test]
    fn rejects_two_segment_jwt() {
        let two = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0";
        assert!(!matches("jwt", two));
    }

    #[test]
    fn detects_credit_card_with_luhn_valid() {
        assert!(matches("credit_card", "card 4111111111111111 thanks"));
    }

    #[test]
    fn detects_credit_card_with_dashes() {
        assert!(matches("credit_card", "card 4111-1111-1111-1111 thanks"));
    }

    #[test]
    fn rejects_credit_card_failing_luhn() {
        // Same length as a Visa but does not pass Luhn.
        assert!(!matches("credit_card", "card 1234567812345678 thanks"));
    }

    #[test]
    fn rules_compile_without_panicking() {
        let rules = compiled_rules();
        assert_eq!(rules.len(), RULES.len());
        for r in rules {
            // Smoke test: regex is usable.
            let _ = r.regex.is_match("");
        }
    }
}
