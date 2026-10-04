//! Locale normalization and candidate resolution for macOS bundles and Linux desktop entries.

/// A normalized, structured locale representation.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ParsedLocale {
    pub language: String,
    pub script: Option<String>,
    pub region: Option<String>,
    pub variant: Option<String>,
    pub raw: String,
}

impl ParsedLocale {
    pub fn parse(tag: &str) -> Option<Self> {
        let raw = tag.trim();
        if raw.is_empty() {
            return None;
        }

        let (base_and_encoding, modifier) = match raw.split_once('@') {
            Some((b, m)) => (b, Some(m.trim())),
            None => (raw, None),
        };

        let base_tag = match base_and_encoding.split_once('.') {
            Some((b, _)) => b,
            None => base_and_encoding,
        };

        let mut subtags = base_tag.split(['-', '_']).filter(|p| !p.is_empty());
        let language = subtags.next()?;

        if language.len() < 2
            || language.len() > 3
            || !language.chars().all(|c| c.is_ascii_alphabetic())
        {
            return None;
        }
        let language = language.to_ascii_lowercase();

        let mut script = None;
        let mut region = None;
        let mut variant = None;

        for subtag in subtags {
            if subtag.len() == 1 {
                break;
            }

            if script.is_none() && is_script_subtag(subtag) {
                script = Some(to_titlecase(subtag));
            } else if region.is_none() && is_region_subtag(subtag) {
                region = Some(subtag.to_ascii_uppercase());
            } else if variant.is_none() && is_variant_subtag(subtag) {
                variant = Some(subtag.to_ascii_lowercase());
            }
        }

        if script.is_none() {
            if let Some(m) = modifier {
                script = script_from_posix_modifier(m);
            }
        }

        Some(Self {
            language,
            script,
            region,
            variant,
            raw: raw.to_string(),
        })
    }

    pub fn to_bcp47(&self) -> String {
        let mut parts = vec![self.language.clone()];
        if let Some(ref s) = self.script {
            parts.push(s.clone());
        }
        if let Some(ref r) = self.region {
            parts.push(r.clone());
        }
        if let Some(ref v) = self.variant {
            parts.push(v.clone());
        }
        parts.join("-")
    }

    pub fn to_posix(&self) -> String {
        let mut parts = vec![self.language.clone()];
        if let Some(ref s) = self.script {
            parts.push(s.clone());
        }
        if let Some(ref r) = self.region {
            parts.push(r.clone());
        }
        if let Some(ref v) = self.variant {
            parts.push(v.clone());
        }
        parts.join("_")
    }

    pub fn macos_bundle_candidates(&self) -> Vec<String> {
        let mut candidates = Vec::new();
        let lang = &self.language;
        let script = self.script.as_deref();
        let region = self.region.as_deref();

        if let (Some(s), Some(r)) = (script, region) {
            push_both_separators(&mut candidates, &format!("{lang}-{s}-{r}"));
        }
        if let Some(r) = region {
            push_both_separators(&mut candidates, &format!("{lang}-{r}"));
        }
        if let Some(s) = script {
            push_both_separators(&mut candidates, &format!("{lang}-{s}"));
        }
        if let Some(r) = implied_macos_region(lang, script) {
            push_both_separators(&mut candidates, &format!("{lang}-{r}"));
        }
        push_both_separators(&mut candidates, lang);

        candidates
    }

    pub fn desktop_entry_candidates(&self) -> Vec<String> {
        let mut candidates = Vec::new();

        let clean_raw = self.raw.trim();
        if !clean_raw.is_empty() && !candidates.contains(&clean_raw.to_string()) {
            candidates.push(clean_raw.to_string());
        }

        let posix = self.to_posix();
        if !candidates.contains(&posix) {
            candidates.push(posix);
        }

        let bcp47 = self.to_bcp47();
        if !candidates.contains(&bcp47) {
            candidates.push(bcp47);
        }

        let lang = self.language.clone();
        if !candidates.contains(&lang) {
            candidates.push(lang);
        }

        candidates
    }
}

pub fn detect_locale() -> String {
    sys_locale::get_locale().unwrap_or_else(|| "en-US".to_string())
}

fn implied_macos_region(language: &str, script: Option<&str>) -> Option<&'static str> {
    match (language, script) {
        ("zh", Some("Hant")) => Some("TW"),
        ("zh", Some("Hans") | None) => Some("CN"),
        _ => None,
    }
}

fn push_both_separators(candidates: &mut Vec<String>, stem: &str) {
    for candidate in [stem.to_owned(), stem.replace('-', "_")] {
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
}

fn is_script_subtag(s: &str) -> bool {
    s.len() == 4 && s.chars().all(|c| c.is_ascii_alphabetic())
}

fn is_region_subtag(s: &str) -> bool {
    (s.len() == 2 && s.chars().all(|c| c.is_ascii_alphabetic()))
        || (s.len() == 3 && s.chars().all(|c| c.is_ascii_digit()))
}

fn is_variant_subtag(s: &str) -> bool {
    (s.len() >= 5 && s.chars().all(|c| c.is_ascii_alphanumeric()))
        || (s.len() == 4 && s.chars().next().is_some_and(|c| c.is_ascii_digit()))
}

fn to_titlecase(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(first) => {
            let mut res = first.to_ascii_uppercase().to_string();
            res.extend(chars.map(|c| c.to_ascii_lowercase()));
            res
        }
        None => String::new(),
    }
}

fn script_from_posix_modifier(modifier: &str) -> Option<String> {
    match modifier.trim().to_ascii_lowercase().as_str() {
        "latin" => Some("Latn".to_string()),
        "cyrillic" => Some("Cyrl".to_string()),
        "devanagari" => Some("Deva".to_string()),
        "arabic" => Some("Arab".to_string()),
        _ => None,
    }
}
