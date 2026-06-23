//! Pure text-extraction helpers for clipboard markup (HTML/RTF).
//!
//! Ports the algorithms previously duplicated as ad-hoc regexes in the
//! frontend (`clipboardHistoryService.ts`) into Rust, so there is a single
//! place that knows how to turn markup into plain text.

use regex::Regex;
use std::sync::OnceLock;

static STYLE_RE: OnceLock<Regex> = OnceLock::new();
static SCRIPT_RE: OnceLock<Regex> = OnceLock::new();
static TAG_RE: OnceLock<Regex> = OnceLock::new();
static NUMERIC_ENTITY_RE: OnceLock<Regex> = OnceLock::new();
static WHITESPACE_RE: OnceLock<Regex> = OnceLock::new();

fn style_re() -> &'static Regex {
    STYLE_RE.get_or_init(|| Regex::new(r"(?is)<style[^>]*>.*?</style>").unwrap())
}

fn script_re() -> &'static Regex {
    SCRIPT_RE.get_or_init(|| Regex::new(r"(?is)<script[^>]*>.*?</script>").unwrap())
}

fn tag_re() -> &'static Regex {
    TAG_RE.get_or_init(|| Regex::new(r"<[^>]+>").unwrap())
}

fn numeric_entity_re() -> &'static Regex {
    NUMERIC_ENTITY_RE.get_or_init(|| Regex::new(r"(?i)&#\d+;").unwrap())
}

fn whitespace_re() -> &'static Regex {
    WHITESPACE_RE.get_or_init(|| Regex::new(r"\s+").unwrap())
}

/// Strip HTML tags, script/style blocks, and decode common entities.
pub fn strip_html(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }

    let mut text = style_re().replace_all(html, "").into_owned();
    text = script_re().replace_all(&text, "").into_owned();
    text = tag_re().replace_all(&text, " ").into_owned();
    text = text.replace("&nbsp;", " ").replace("&NBSP;", " ");
    text = text.replace("&amp;", "&").replace("&AMP;", "&");
    text = text.replace("&lt;", "<").replace("&LT;", "<");
    text = text.replace("&gt;", ">").replace("&GT;", ">");
    text = text.replace("&quot;", "\"").replace("&QUOT;", "\"");
    text = numeric_entity_re().replace_all(&text, " ").into_owned();
    text = whitespace_re().replace_all(&text, " ").into_owned();
    text.trim().to_string()
}

/// Character mapping for Windows-1252 (standard RTF encoding for 0x80-0x9F).
fn cp1252(byte: u8) -> Option<char> {
    match byte {
        0x80 => Some('\u{20AC}'),
        0x82 => Some('\u{201A}'),
        0x83 => Some('\u{0192}'),
        0x84 => Some('\u{201E}'),
        0x85 => Some('\u{2026}'),
        0x86 => Some('\u{2020}'),
        0x87 => Some('\u{2021}'),
        0x88 => Some('\u{02C6}'),
        0x89 => Some('\u{2030}'),
        0x8A => Some('\u{0160}'),
        0x8B => Some('\u{2039}'),
        0x8C => Some('\u{0152}'),
        0x8E => Some('\u{017D}'),
        0x91 => Some('\u{2018}'),
        0x92 => Some('\u{2019}'),
        0x93 => Some('\u{201C}'),
        0x94 => Some('\u{201D}'),
        0x95 => Some('\u{2022}'),
        0x96 => Some('\u{2013}'),
        0x97 => Some('\u{2014}'),
        0x98 => Some('\u{02DC}'),
        0x99 => Some('\u{2122}'),
        0x9A => Some('\u{0161}'),
        0x9B => Some('\u{203A}'),
        0x9C => Some('\u{0153}'),
        0x9E => Some('\u{017E}'),
        0x9F => Some('\u{0178}'),
        _ => None,
    }
}

fn is_skipped_destination(keyword: &str) -> bool {
    matches!(
        keyword,
        "fonttbl"
            | "colortbl"
            | "expandedcolortbl"
            | "stylesheet"
            | "listtable"
            | "listoverridetable"
            | "rsidtbl"
            | "generator"
            | "info"
            | "filetbl"
            | "revtbl"
            | "themedata"
            | "latentstyles"
            | "datastore"
            | "pict"
            | "header"
            | "headerl"
            | "headerr"
            | "headerf"
            | "footer"
            | "footerl"
            | "footerr"
            | "footerf"
            | "bkmkstart"
            | "bkmkend"
            | "field"
            | "object"
            | "nonesttables"
            | "mmathPr"
            | "wgrffmtfilter"
            | "xmlnstbl"
    )
}

/// Strip RTF control words, metadata groups (font/color tables), and decode
/// escapes, using a brace-aware single-pass scanner so structural text never
/// leaks through.
pub fn strip_rtf(rtf: &str) -> String {
    if rtf.is_empty() {
        return String::new();
    }

    let chars: Vec<char> = rtf.chars().collect();
    let len = chars.len();
    let mut output = String::new();
    let mut i = 0usize;
    let mut depth: i32 = 0;
    let mut skip_until: Vec<i32> = Vec::new();

    let is_alpha = |c: char| c.is_ascii_alphabetic();
    let is_digit = |c: char| c.is_ascii_digit();

    while i < len {
        let ch = chars[i];

        if ch == '{' {
            depth += 1;
            i += 1;
            if i < len && chars[i] == '\\' {
                let mut j = i + 1;
                let mut ignorable = false;
                if j < len && chars[j] == '*' {
                    ignorable = true;
                    j += 1;
                    if j < len && chars[j] == '\\' {
                        j += 1;
                    }
                }
                let start = j;
                let mut k = j;
                while k < len && is_alpha(chars[k]) {
                    k += 1;
                }
                let keyword: String = chars[start..k].iter().collect();
                if ignorable || is_skipped_destination(&keyword) {
                    skip_until.push(depth);
                }
            }
            continue;
        }

        if ch == '}' {
            if let Some(&last) = skip_until.last() {
                if last == depth {
                    skip_until.pop();
                }
            }
            depth -= 1;
            i += 1;
            continue;
        }

        if !skip_until.is_empty() {
            i += 1;
            continue;
        }

        if ch == '\\' {
            i += 1;
            if i >= len {
                break;
            }
            let next = chars[i];

            if next == '{' || next == '}' || next == '\\' {
                output.push(next);
                i += 1;
            } else if next == '\'' {
                let hex: String = chars[i + 1..(i + 3).min(len)].iter().collect();
                if hex.len() == 2 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
                    if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                        if byte < 128 {
                            output.push(byte as char);
                        } else if let Some(mapped) = cp1252(byte) {
                            output.push(mapped);
                        }
                    }
                    i += 3;
                } else {
                    i += 1;
                }
            } else if next == 'u' {
                let mut j = i + 1;
                let mut sign: i32 = 1;
                if j < len && chars[j] == '-' {
                    sign = -1;
                    j += 1;
                }
                let start = j;
                while j < len && is_digit(chars[j]) {
                    j += 1;
                }
                let num_str: String = chars[start..j].iter().collect();
                if !num_str.is_empty() {
                    let code = num_str.parse::<i32>().unwrap_or(0) * sign;
                    let code = (code & 0xFFFF) as u32;
                    if let Some(c) = char::from_u32(code) {
                        output.push(c);
                    }
                    i = j;
                    if i < len && chars[i] == '?' {
                        i += 1;
                    }
                    if i < len {
                        i += 1; // skip fallback char
                    }
                } else {
                    i += 1;
                }
            } else if next == '~' {
                output.push(' ');
                i += 1;
            } else if next == '_' {
                output.push('-');
                i += 1;
            } else if is_alpha(next) {
                let start = i;
                let mut j = i;
                while j < len && is_alpha(chars[j]) {
                    j += 1;
                }
                let keyword: String = chars[start..j].iter().collect();
                if keyword == "par" || keyword == "line" || keyword == "sect" || keyword == "page" {
                    output.push(' ');
                } else if keyword == "tab" {
                    output.push('\t');
                }
                i = j;
                if i < len && chars[i] == '-' {
                    i += 1;
                }
                while i < len && is_digit(chars[i]) {
                    i += 1;
                }
                if i < len && chars[i] == ' ' {
                    i += 1;
                }
            } else {
                i += 1; // skip non-letter extension
            }
        } else {
            output.push(ch);
            i += 1;
        }
    }

    whitespace_re().replace_all(&output, " ").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── strip_html ───────────────────────────────────────────────────────

    #[test]
    fn strips_simple_tags() {
        assert_eq!(strip_html("<p>hello</p>"), "hello");
    }

    #[test]
    fn strips_nested_tags() {
        assert_eq!(
            strip_html("<div><p>hello <b>world</b></p></div>"),
            "hello world"
        );
    }

    #[test]
    fn strips_full_html_documents() {
        let html = "<html><head><meta charset=\"UTF-8\"><style>body{color:red}</style></head><body><p>quarterly report</p></body></html>";
        let result = strip_html(html);
        assert!(result.contains("quarterly report"));
        assert!(!result.contains('<'));
        assert!(!result.contains("color:red"));
    }

    #[test]
    fn strips_script_tags_and_content() {
        assert_eq!(
            strip_html("<p>safe</p><script>alert(\"xss\")</script>"),
            "safe"
        );
    }

    #[test]
    fn strips_style_tags_and_content() {
        assert_eq!(
            strip_html("<style>.a{color:red}</style><p>text</p>"),
            "text"
        );
    }

    #[test]
    fn decodes_common_html_entities() {
        assert_eq!(
            strip_html("a &amp; b &lt; c &gt; d &quot;e&quot;"),
            "a & b < c > d \"e\""
        );
    }

    #[test]
    fn collapses_whitespace_html() {
        assert_eq!(
            strip_html("<p>  hello  </p>  <p>  world  </p>"),
            "hello world"
        );
    }

    #[test]
    fn empty_html_input_is_empty() {
        assert_eq!(strip_html(""), "");
    }

    #[test]
    fn plain_text_html_input_is_unchanged() {
        assert_eq!(strip_html("no tags here"), "no tags here");
    }

    // ── strip_rtf ────────────────────────────────────────────────────────

    #[test]
    fn strips_rtf_control_words() {
        let result = strip_rtf("{\\rtf1\\b hello\\b0 world}");
        assert!(result.contains("hello"));
        assert!(result.contains("world"));
        assert!(!result.contains("\\rtf"));
        assert!(!result.contains("\\b"));
    }

    #[test]
    fn strips_unicode_escape_sequences() {
        assert!(!strip_rtf("\\u8230?").contains("\\u8230"));
    }

    #[test]
    fn strips_braces_and_backslashes() {
        let result = strip_rtf("{\\rtf1 {\\b bold} text}");
        assert!(!result.contains('{'));
        assert!(!result.contains('}'));
    }

    #[test]
    fn collapses_whitespace_rtf() {
        assert_eq!(strip_rtf("{\\rtf1   hello    world  }"), "hello world");
    }

    #[test]
    fn empty_rtf_input_is_empty() {
        assert_eq!(strip_rtf(""), "");
    }

    #[test]
    fn drops_font_table_content() {
        let input =
            "{\\rtf1\\ansi{\\fonttbl\\f0\\fnil\\fcharset0 .SFNSRounded-Regular;}\\f0 hello world}";
        assert_eq!(strip_rtf(input), "hello world");
    }

    #[test]
    fn drops_color_table_content() {
        let input = "{\\rtf1{\\colortbl;\\red255\\green255\\blue255;\\red0\\green0\\blue0;}\\cf2 body text}";
        assert_eq!(strip_rtf(input), "body text");
    }

    #[test]
    fn drops_expandedcolortbl_with_nested_groups_and_labelcolor() {
        let input = "{\\rtf1{\\*\\expandedcolortbl;;\\cssrgb\\c0\\c0\\c0;\\cssrgb\\c0\\c0\\c0\\labelColor;}body}";
        assert_eq!(strip_rtf(input), "body");
    }

    #[test]
    fn decodes_escaped_hex_as_curly_apostrophe() {
        let input = "{\\rtf1 it\\'92s fine}";
        assert_eq!(strip_rtf(input), "it\u{2019}s fine");
    }

    #[test]
    fn decodes_unicode_escape_to_curly_quote() {
        let input = "{\\rtf1 it\\u8217?s fine}";
        let result = strip_rtf(input);
        assert!(result.contains('\u{2019}'));
        assert!(!result.contains("u8217"));
        assert!(!result.contains('?'));
    }

    #[test]
    fn par_becomes_space() {
        let input = "{\\rtf1 line1\\par line2}";
        assert_eq!(strip_rtf(input), "line1 line2");
    }

    #[test]
    fn escaped_literals_braces_and_backslash() {
        let input = "{\\rtf1 a\\{b\\}c\\\\d}";
        assert_eq!(strip_rtf(input), "a{b}c\\d");
    }

    #[test]
    fn full_real_world_textedit_sample() {
        let input = "{\\rtf1\\ansi\\ansicpg1252\\cocoartf2868\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fnil\\fcharset0 .SFNSRounded-Regular;}{\\colortbl;\\red255\\green255\\blue255;\\red0\\green0\\blue0;}{\\*\\expandedcolortbl;;\\cssrgb\\c0\\c0\\c0;\\cssrgb\\c0\\c0\\c0\\labelColor;}\\pard\\pardirnatural\\partightenfactor0\\f0\\fs28 \\cf2 \\expnd0\\expndtw0\\kerning0\\outl0\\strokewidth0 \\strokec2 Fix clipboard history formatting, currently it\\'92s ugly}";
        let result = strip_rtf(input);
        assert_eq!(
            result,
            "Fix clipboard history formatting, currently it\u{2019}s ugly"
        );
        for term in [
            "SFNSRounded",
            "JetBrainsMono",
            "cocoartf",
            "fonttbl",
            "colortbl",
            "labelColor",
            "expandedcolortbl",
            "pard",
            "\\f0",
            "\\fs28",
            "\\cf2",
            "\\'92",
            "\\u8217",
        ] {
            assert!(!result.contains(term), "result should not contain {term}");
        }
    }

    #[test]
    fn unknown_ignorable_destination() {
        let input = "{\\rtf1{\\*\\someunknown junk}real text}";
        assert_eq!(strip_rtf(input), "real text");
    }

    #[test]
    fn plain_text_rtf_input_is_preserved() {
        assert_eq!(strip_rtf("hello world"), "hello world");
    }
}
