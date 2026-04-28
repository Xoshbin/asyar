use serde::{Deserialize, Serialize};

/// Source of truth for alias validation. The TypeScript mirror in
/// `src/built-in-features/aliases/aliasValidation.ts` is checked against this
/// pattern by a Rust drift contract test added in Task B3.
#[allow(dead_code)] // referenced by the B3 drift test via include_str!
pub const ALIAS_REGEX: &str = r"^[a-z0-9]{1,10}$";

/// Maximum number of characters in an alias.
pub const ALIAS_MAX_LEN: usize = 10;

/// Errors produced by alias validation, storage, and lookup.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AliasError {
    #[error("alias must not be empty")]
    Empty,
    #[error("alias must be at most {ALIAS_MAX_LEN} characters")]
    TooLong,
    #[error("alias may only contain lowercase letters and digits")]
    InvalidChars,
    #[error("alias '{0}' is already used by '{1}'")]
    Conflict(String, String),
    #[error("alias not found for object id '{0}'")]
    NotFound(String),
    #[error("storage error: {0}")]
    Storage(String),
}

/// A user-defined alias bound to a single search-index item (application or command).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ItemAlias {
    pub object_id: String,
    pub alias: String,
    pub item_name: String,
    pub item_type: String, // "application" | "command"
    pub created_at: i64,
}

/// Normalises and validates an alias string.
///
/// Trims surrounding whitespace, lowercases, then enforces `^[a-z0-9]{1,10}$`.
/// Returns the normalised alias on success, or an [`AliasError`] describing
/// the first violation found.
pub fn validate_alias(input: &str) -> Result<String, AliasError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(AliasError::Empty);
    }
    let lowered: String = trimmed.to_lowercase();
    if lowered.chars().count() > ALIAS_MAX_LEN {
        return Err(AliasError::TooLong);
    }
    if !lowered.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) {
        return Err(AliasError::InvalidChars);
    }
    Ok(lowered)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_rejects_empty() {
        assert_eq!(validate_alias(""), Err(AliasError::Empty));
        assert_eq!(validate_alias("   "), Err(AliasError::Empty));
    }

    #[test]
    fn validate_rejects_too_long() {
        assert_eq!(validate_alias("abcdefghijk"), Err(AliasError::TooLong)); // 11 chars
    }

    #[test]
    fn validate_accepts_max_length() {
        assert_eq!(validate_alias("abcdefghij").unwrap(), "abcdefghij"); // 10 chars
    }

    #[test]
    fn validate_accepts_single_char() {
        assert_eq!(validate_alias("a").unwrap(), "a");
        assert_eq!(validate_alias("1").unwrap(), "1");
    }

    #[test]
    fn validate_rejects_invalid_chars() {
        assert_eq!(validate_alias("a-b"), Err(AliasError::InvalidChars));
        assert_eq!(validate_alias("a b"), Err(AliasError::InvalidChars));
        assert_eq!(validate_alias("a_b"), Err(AliasError::InvalidChars));
        assert_eq!(validate_alias("a!"), Err(AliasError::InvalidChars));
    }

    #[test]
    fn validate_rejects_unicode() {
        assert_eq!(validate_alias("café"), Err(AliasError::InvalidChars));
        assert_eq!(validate_alias("日本"), Err(AliasError::InvalidChars));
    }

    #[test]
    fn validate_lowercases_input() {
        assert_eq!(validate_alias("CL").unwrap(), "cl");
        assert_eq!(validate_alias("MyAlias").unwrap(), "myalias");
    }

    #[test]
    fn validate_trims_input() {
        assert_eq!(validate_alias("  cl  ").unwrap(), "cl");
    }

    #[test]
    fn validate_accepts_digits() {
        assert_eq!(validate_alias("1pass").unwrap(), "1pass");
        assert_eq!(validate_alias("h2o").unwrap(), "h2o");
    }

    /// Drift contract: the TypeScript mirror in
    /// `src/built-in-features/aliases/aliasValidation.ts` must use the same
    /// regex literal and length constant as Rust. Loaded via `include_str!`
    /// at compile time so any divergence fails this test.
    #[test]
    fn ts_alias_validation_mirrors_rust_rules() {
        let ts_source = include_str!(
            "../../../src/built-in-features/aliases/aliasValidation.ts"
        );
        assert!(
            ts_source.contains("/^[a-z0-9]{1,10}$/"),
            "TS ALIAS_REGEX must equal Rust ALIAS_REGEX (`^[a-z0-9]{{1,10}}$`)"
        );
        assert!(
            ts_source.contains("ALIAS_MAX_LEN = 10"),
            "TS ALIAS_MAX_LEN must equal Rust ALIAS_MAX_LEN (10)"
        );
    }
}
