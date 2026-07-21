//! Rendering a note to a portable Markdown file. Pure formatting lives here;
//! the save dialog + file write + reveal are in the `note_export` command.

/// `# Title` + blank + body, or just the body when the note has no title.
pub fn note_to_markdown(title: &str, body: &str) -> String {
    if title.trim().is_empty() {
        body.to_string()
    } else {
        format!("# {}\n\n{}", title.trim(), body)
    }
}

/// A filesystem-safe base filename derived from a note title. Strips path
/// separators and reserved characters, collapses whitespace, caps length,
/// and falls back to "note" for empty/blank titles.
pub fn sanitize_filename(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed: String = collapsed.chars().take(80).collect();
    let trimmed = trimmed.trim();
    if trimmed.is_empty() {
        "note".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_prefixes_title_as_h1() {
        assert_eq!(
            note_to_markdown("Groceries", "milk\neggs"),
            "# Groceries\n\nmilk\neggs"
        );
    }

    #[test]
    fn markdown_omits_heading_when_title_blank() {
        assert_eq!(note_to_markdown("   ", "just body"), "just body");
    }

    #[test]
    fn sanitize_strips_path_and_reserved_chars() {
        assert_eq!(sanitize_filename("a/b:c*d?\"e"), "a b c d e");
        assert_eq!(sanitize_filename("  spaced  out  "), "spaced out");
    }

    #[test]
    fn sanitize_falls_back_for_blank() {
        assert_eq!(sanitize_filename(""), "note");
        assert_eq!(sanitize_filename("///"), "note");
    }

    #[test]
    fn sanitize_caps_length() {
        assert!(sanitize_filename(&"x".repeat(200)).chars().count() <= 80);
    }
}
