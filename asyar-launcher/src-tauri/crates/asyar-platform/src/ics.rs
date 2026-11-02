#![cfg_attr(not(target_os = "linux"), allow(dead_code))]
//! Plain-Rust iCalendar (`.ics`, RFC 5545) reader/writer and file-backed store.
//!
//! The Linux calendar backend (`linux::calendar`) is a thin path-discovery layer
//! over [`Store`]. Nothing here touches the OS, so the parser and the store's
//! file edits are unit tested on every platform.
//!
//! Scope, deliberately narrow:
//! - `VEVENT` and `VTODO` only; nested components (`VALARM`) are skipped.
//! - Times are read as UTC. A trailing `Z` is exact; floating and `TZID` times
//!   are *interpreted as UTC* because no time-zone database is bundled.
//! - Recurrence (`RRULE`) is not expanded: a recurring event appears once, at
//!   its first occurrence.
//! - Files are edited in place, preserving every line this module does not
//!   change (including its folding and line endings), and written atomically.

use crate::calendar::{
    CalendarEvent, CalendarSource, CreateEventInput, CreateReminderInput, ReminderItem,
    ReminderList,
};
use crate::error::PlatformError;
use std::fs;
use std::path::{Path, PathBuf};

const DAY_MS: i64 = 86_400_000;
const PRODID: &str = "-//Asyar//Calendar//EN";

fn os_err(msg: impl Into<String>) -> PlatformError {
    PlatformError::OsError(msg.into())
}

// ── dates ─────────────────────────────────────────────────────────────────

/// Days since 1970-01-01 for a proleptic Gregorian date.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn digits(s: &str) -> Option<i64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// Parses `YYYYMMDD` or `YYYYMMDDTHHMMSS[Z]` into Unix ms and whether it was a
/// date-only (all-day) value.
pub(crate) fn parse_ics_datetime(value: &str) -> Option<(i64, bool)> {
    let v = value.trim();
    // All slicing below is by byte offset, so reject anything non-ASCII first.
    if !v.is_ascii() {
        return None;
    }
    let date_part = v.get(..8)?;
    let (y, m, d) = (
        digits(&date_part[..4])?,
        digits(&date_part[4..6])?,
        digits(&date_part[6..8])?,
    );
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let day_ms = days_from_civil(y, m, d) * DAY_MS;
    if v.len() == 8 {
        return Some((day_ms, true));
    }
    let rest = v.get(8..)?.strip_prefix('T')?;
    let rest = rest.strip_suffix('Z').unwrap_or(rest);
    if rest.len() != 6 {
        return None;
    }
    let (h, mi, s) = (
        digits(&rest[..2])?,
        digits(&rest[2..4])?,
        digits(&rest[4..6])?,
    );
    if h > 23 || mi > 59 || s > 60 {
        return None;
    }
    Some((day_ms + ((h * 60 + mi) * 60 + s) * 1000, false))
}

fn format_utc(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!(
        "{y:04}{m:02}{d:02}T{:02}{:02}{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn format_date(ms: i64) -> String {
    let (y, m, d) = civil_from_days(ms.div_euclid(DAY_MS));
    format!("{y:04}{m:02}{d:02}")
}

/// `P1D`, `PT1H30M`, `P2W`, optionally signed. Returns milliseconds.
pub(crate) fn parse_duration_ms(value: &str) -> Option<i64> {
    let v = value.trim();
    let (sign, v) = match v.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, v.strip_prefix('+').unwrap_or(v)),
    };
    let mut rest = v.strip_prefix('P')?;
    let mut total = 0_i64;
    let mut in_time = false;
    let mut seen = false;
    while !rest.is_empty() {
        if let Some(r) = rest.strip_prefix('T') {
            in_time = true;
            rest = r;
            continue;
        }
        let end = rest.find(|c: char| !c.is_ascii_digit())?;
        let n: i64 = rest[..end].parse().ok()?;
        let unit = rest[end..].chars().next()?;
        let ms = match (unit, in_time) {
            ('W', false) => 7 * DAY_MS,
            ('D', false) => DAY_MS,
            ('H', true) => 3_600_000,
            ('M', true) => 60_000,
            ('S', true) => 1000,
            _ => return None,
        };
        total += n * ms;
        seen = true;
        rest = &rest[end + unit.len_utf8()..];
    }
    seen.then_some(sign * total)
}

// ── lines ─────────────────────────────────────────────────────────────────

/// One logical (unfolded) content line plus the physical lines it came from.
struct Line {
    phys: Vec<String>,
    text: String,
}

fn detect_eol(content: &str) -> &'static str {
    if content.contains("\r\n") || !content.contains('\n') {
        "\r\n"
    } else {
        "\n"
    }
}

/// RFC 5545 §3.1 line unfolding, keeping the original physical lines so a file
/// can be rewritten without touching lines we did not change.
fn split_lines(content: &str) -> Vec<Line> {
    let mut out: Vec<Line> = Vec::new();
    for phys in content.lines() {
        let continues = phys.starts_with(' ') || phys.starts_with('\t');
        match out.last_mut() {
            Some(last) if continues => {
                last.text.push_str(&phys[1..]);
                last.phys.push(phys.to_string());
            }
            _ => out.push(Line {
                phys: vec![phys.to_string()],
                text: phys.to_string(),
            }),
        }
    }
    out
}

struct Prop {
    name: String,
    params: Vec<(String, String)>,
    value: String,
}

impl Prop {
    fn param(&self, key: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.as_str())
    }
}

fn parse_prop(text: &str) -> Option<Prop> {
    let mut in_quotes = false;
    let colon = text.char_indices().find_map(|(i, c)| match c {
        '"' => {
            in_quotes = !in_quotes;
            None
        }
        ':' if !in_quotes => Some(i),
        _ => None,
    })?;
    let (head, value) = (&text[..colon], &text[colon + 1..]);
    let mut parts = head.split(';');
    let name = parts.next()?.trim().to_ascii_uppercase();
    if name.is_empty() {
        return None;
    }
    let params = parts
        .filter_map(|p| {
            let (k, v) = p.split_once('=')?;
            Some((k.trim().to_string(), v.trim().trim_matches('"').to_string()))
        })
        .collect();
    Some(Prop {
        name,
        params,
        value: value.to_string(),
    })
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') | Some('N') => out.push('\n'),
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\r' => {
                if chars.peek() == Some(&'\n') {
                    chars.next();
                }
                out.push_str("\\n");
            }
            '\n' => out.push_str("\\n"),
            other => out.push(other),
        }
    }
    out
}

/// Folds to at most 75 octets per physical line, never splitting a character.
fn fold(line: &str, eol: &str) -> String {
    let mut out = String::new();
    let mut width = 0;
    let mut limit = 75;
    for c in line.chars() {
        let len = c.len_utf8();
        if width + len > limit {
            out.push_str(eol);
            out.push(' ');
            width = 1;
            limit = 75;
        }
        out.push(c);
        width += len;
    }
    out
}

// ── components ────────────────────────────────────────────────────────────

/// A `VEVENT`/`VTODO` block: its line range and its own (top-level) properties.
struct Block {
    start: usize,
    end: usize,
    props: Vec<(usize, Prop)>,
}

impl Block {
    fn get(&self, name: &str) -> Option<&Prop> {
        self.props.iter().map(|(_, p)| p).find(|p| p.name == name)
    }

    fn text(&self, name: &str) -> Option<String> {
        self.get(name)
            .map(|p| unescape(&p.value))
            .filter(|s| !s.is_empty())
    }
}

fn is_marker(text: &str, marker: &str, kind: &str) -> bool {
    text.trim()
        .strip_prefix(marker)
        .and_then(|r| r.strip_prefix(':'))
        .is_some_and(|r| r.trim().eq_ignore_ascii_case(kind))
}

fn blocks(lines: &[Line], kind: &str) -> Vec<Block> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if !(lines[i].text.len() >= 6 && is_marker(&lines[i].text, "BEGIN", kind)) {
            i += 1;
            continue;
        }
        let mut depth = 0;
        let mut props = Vec::new();
        let mut j = i + 1;
        let mut closed = false;
        while j < lines.len() {
            let t = &lines[j].text;
            let trimmed = t.trim();
            let starts = |prefix: &str| {
                trimmed
                    .get(..prefix.len())
                    .is_some_and(|p| p.eq_ignore_ascii_case(prefix))
            };
            if starts("BEGIN:") {
                depth += 1;
            } else if starts("END:") {
                if depth == 0 {
                    closed = is_marker(t, "END", kind);
                    break;
                }
                depth -= 1;
            } else if depth == 0 {
                if let Some(p) = parse_prop(t) {
                    props.push((j, p));
                }
            }
            j += 1;
        }
        if closed {
            out.push(Block {
                start: i,
                end: j,
                props,
            });
        }
        i = j.max(i) + 1;
    }
    out
}

fn calendar_name(lines: &[Line]) -> Option<String> {
    lines
        .iter()
        .filter_map(|l| parse_prop(&l.text))
        .find(|p| p.name == "X-WR-CALNAME")
        .map(|p| unescape(&p.value))
        .filter(|s| !s.trim().is_empty())
}

fn prop_ms(p: &Prop) -> Option<(i64, bool)> {
    let (ms, date_only) = parse_ics_datetime(&p.value)?;
    let date_only = date_only
        || p.param("VALUE")
            .is_some_and(|v| v.eq_ignore_ascii_case("DATE"));
    Some((ms, date_only))
}

struct EventFields {
    id: String,
    title: String,
    start_at: i64,
    end_at: i64,
    is_all_day: bool,
    location: Option<String>,
    notes: Option<String>,
    url: Option<String>,
}

fn event_fields(block: &Block, fallback_id: &str) -> Option<EventFields> {
    let (start_at, is_all_day) = prop_ms(block.get("DTSTART")?)?;
    let end_at = match block.get("DTEND").and_then(prop_ms) {
        Some((end, _)) => end,
        None => match block
            .get("DURATION")
            .and_then(|p| parse_duration_ms(&p.value))
        {
            Some(d) => start_at + d,
            None if is_all_day => start_at + DAY_MS,
            None => start_at,
        },
    };
    Some(EventFields {
        id: block.text("UID").unwrap_or_else(|| fallback_id.to_string()),
        title: block.text("SUMMARY").unwrap_or_default(),
        start_at,
        end_at: end_at.max(start_at),
        is_all_day,
        location: block.text("LOCATION"),
        notes: block.text("DESCRIPTION"),
        url: block.get("URL").map(|p| p.value.trim().to_string()),
    })
}

struct TodoFields {
    id: String,
    title: String,
    is_completed: bool,
    due_at: Option<i64>,
    priority: i32,
    notes: Option<String>,
}

fn todo_fields(block: &Block, fallback_id: &str) -> TodoFields {
    let completed = block
        .get("STATUS")
        .is_some_and(|p| p.value.trim().eq_ignore_ascii_case("COMPLETED"))
        || block
            .get("PERCENT-COMPLETE")
            .is_some_and(|p| p.value.trim() == "100")
        || block.get("COMPLETED").is_some();
    TodoFields {
        id: block.text("UID").unwrap_or_else(|| fallback_id.to_string()),
        title: block.text("SUMMARY").unwrap_or_default(),
        is_completed: completed,
        due_at: block.get("DUE").and_then(prop_ms).map(|(ms, _)| ms),
        priority: block
            .get("PRIORITY")
            .and_then(|p| p.value.trim().parse::<i32>().ok())
            .map_or(0, |p| p.clamp(0, 9)),
        notes: block.text("DESCRIPTION"),
    }
}

// ── store ─────────────────────────────────────────────────────────────────

/// Where calendars are looked for. Built by the Linux backend from the XDG
/// directories; tests point it at a temp dir.
#[derive(Debug, Clone)]
pub(crate) struct Roots {
    /// Asyar's own directory; `default.ics` is created here on first write.
    pub asyar_dir: PathBuf,
    /// Evolution's system calendar. Listed read-only: Evolution Data Server
    /// owns that file and would not see (or could clobber) our edits.
    pub evolution_file: Option<PathBuf>,
    /// A directory of loose `.ics` files.
    pub shared_dir: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub(crate) struct Source {
    pub path: PathBuf,
    pub title: String,
    pub source_title: Option<String>,
    pub read_only: bool,
}

impl Source {
    fn id(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }

    fn calendar(&self) -> CalendarSource {
        CalendarSource {
            id: self.id(),
            title: self.title.clone(),
            source_title: self.source_title.clone(),
            read_only: self.read_only,
        }
    }

    fn reminder_list(&self) -> ReminderList {
        ReminderList {
            id: self.id(),
            title: self.title.clone(),
            source_title: self.source_title.clone(),
            read_only: self.read_only,
        }
    }
}

pub(crate) struct Store {
    pub roots: Roots,
}

fn ics_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("ics")))
        .collect();
    files.sort();
    files
}

fn file_read_only(path: &Path) -> bool {
    fs::metadata(path)
        .map(|m| m.permissions().readonly())
        .unwrap_or(true)
}

fn read_file(path: &Path) -> Result<String, PlatformError> {
    fs::read_to_string(path).map_err(|e| os_err(format!("could not read {}: {e}", path.display())))
}

/// Atomic replace: write a sibling temp file, then rename over the target.
fn write_file(path: &Path, content: &str) -> Result<(), PlatformError> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)
            .map_err(|e| os_err(format!("could not create {}: {e}", dir.display())))?;
    }
    let tmp = path.with_extension("ics.asyar-tmp");
    fs::write(&tmp, content)
        .map_err(|e| os_err(format!("could not write {}: {e}", tmp.display())))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        os_err(format!("could not update {}: {e}", path.display()))
    })
}

/// Inserts `block` before the final `END:VCALENDAR`, creating the calendar
/// wrapper when the file is empty.
fn insert_block(content: &str, block: &[String]) -> Result<String, PlatformError> {
    let eol = detect_eol(content);
    let folded: String = block
        .iter()
        .map(|l| format!("{}{eol}", fold(l, eol)))
        .collect();
    if content.trim().is_empty() {
        return Ok(format!(
            "BEGIN:VCALENDAR{eol}VERSION:2.0{eol}PRODID:{PRODID}{eol}{folded}END:VCALENDAR{eol}"
        ));
    }
    let lines = split_lines(content);
    let end = lines
        .iter()
        .rposition(|l| is_marker(&l.text, "END", "VCALENDAR"))
        .ok_or_else(|| os_err("not a valid calendar file (no END:VCALENDAR)"))?;
    let mut out = String::with_capacity(content.len() + folded.len());
    for (i, l) in lines.iter().enumerate() {
        if i == end {
            out.push_str(&folded);
        }
        out.push_str(&l.phys.join(eol));
        out.push_str(eol);
    }
    Ok(out)
}

/// Existing content of a file about to be extended. Only a missing file counts
/// as empty: any other failure (permissions, a non-UTF-8 encoding) must abort,
/// or the write would replace the user's calendar with just the new item.
fn read_for_write(path: &Path) -> Result<String, PlatformError> {
    match fs::read_to_string(path) {
        Ok(c) => Ok(c),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(os_err(format!(
            "could not read {} (left unchanged): {e}",
            path.display()
        ))),
    }
}

fn new_uid() -> String {
    format!("{}@asyar", uuid::Uuid::new_v4())
}

impl Store {
    pub(crate) fn new(roots: Roots) -> Self {
        Self { roots }
    }

    fn source_for(&self, path: PathBuf, source_title: Option<String>, read_only: bool) -> Source {
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let title = fs::read_to_string(&path)
            .ok()
            .and_then(|c| calendar_name(&split_lines(&c)))
            .unwrap_or(stem);
        Source {
            path,
            title,
            source_title,
            read_only,
        }
    }

    /// Every calendar file, in priority order: Asyar's own, Evolution, shared.
    pub(crate) fn sources(&self) -> Vec<Source> {
        let mut out = Vec::new();
        for path in ics_files(&self.roots.asyar_dir) {
            let ro = file_read_only(&path);
            out.push(self.source_for(path, Some("Asyar".into()), ro));
        }
        if let Some(path) = self.roots.evolution_file.as_ref().filter(|p| p.is_file()) {
            out.push(self.source_for(path.clone(), Some("Evolution".into()), true));
        }
        if let Some(dir) = &self.roots.shared_dir {
            for path in ics_files(dir) {
                let ro = file_read_only(&path);
                out.push(self.source_for(path, None, ro));
            }
        }
        out
    }

    fn select(&self, ids: Option<&[String]>) -> Result<Vec<Source>, PlatformError> {
        let all = self.sources();
        let Some(ids) = ids.filter(|i| !i.is_empty()) else {
            return Ok(all);
        };
        ids.iter()
            .map(|wanted| {
                all.iter()
                    .find(|s| &s.id() == wanted)
                    .cloned()
                    .ok_or_else(|| os_err(format!("unknown calendar id: {wanted}")))
            })
            .collect()
    }

    /// The file a new item goes into: the named one (must be writable), else
    /// the first writable one, else a fresh `default.ics` in Asyar's directory.
    fn write_target(&self, id: Option<&str>, what: &str) -> Result<PathBuf, PlatformError> {
        let sources = self.sources();
        if let Some(id) = id {
            let src = sources
                .iter()
                .find(|s| s.id() == id)
                .ok_or_else(|| os_err(format!("unknown {what} id: {id}")))?;
            if src.read_only {
                return Err(os_err(format!("that {what} is read-only")));
            }
            return Ok(src.path.clone());
        }
        Ok(sources
            .into_iter()
            .find(|s| !s.read_only)
            .map(|s| s.path)
            .unwrap_or_else(|| self.roots.asyar_dir.join("default.ics")))
    }

    pub(crate) fn list_calendars(&self) -> Vec<CalendarSource> {
        self.sources().iter().map(Source::calendar).collect()
    }

    pub(crate) fn list_reminder_lists(&self) -> Vec<ReminderList> {
        self.sources().iter().map(Source::reminder_list).collect()
    }

    pub(crate) fn list_events(
        &self,
        start_at: i64,
        end_at: i64,
        calendar_ids: Option<&[String]>,
    ) -> Result<Vec<CalendarEvent>, PlatformError> {
        let mut out = Vec::new();
        for src in self.select(calendar_ids)? {
            let content = match read_file(&src.path) {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("[calendar] skipping unreadable calendar: {e}");
                    continue;
                }
            };
            let lines = split_lines(&content);
            for block in blocks(&lines, "VEVENT") {
                let fallback = format!("{}#{}", src.id(), block.start);
                let Some(f) = event_fields(&block, &fallback) else {
                    continue;
                };
                // Overlap; an all-day/zero-length end is exclusive.
                let overlaps =
                    f.start_at <= end_at && (f.end_at > start_at || f.start_at >= start_at);
                if overlaps {
                    out.push(to_event(&src, f));
                }
            }
        }
        out.sort_by_key(|e| e.start_at);
        Ok(out)
    }

    pub(crate) fn create_event(
        &self,
        input: &CreateEventInput,
        now_ms: i64,
    ) -> Result<CalendarEvent, PlatformError> {
        let path = self.write_target(input.calendar_id.as_deref(), "calendar")?;
        let uid = new_uid();
        let mut block = vec![
            "BEGIN:VEVENT".to_string(),
            format!("UID:{uid}"),
            format!("DTSTAMP:{}", format_utc(now_ms)),
        ];
        if input.is_all_day.unwrap_or(false) {
            let start_day = input.start_at.div_euclid(DAY_MS) * DAY_MS;
            let mut end_day = input.end_at.div_euclid(DAY_MS) * DAY_MS;
            if end_day <= start_day {
                end_day = start_day + DAY_MS;
            }
            block.push(format!("DTSTART;VALUE=DATE:{}", format_date(start_day)));
            block.push(format!("DTEND;VALUE=DATE:{}", format_date(end_day)));
        } else {
            block.push(format!("DTSTART:{}", format_utc(input.start_at)));
            block.push(format!("DTEND:{}", format_utc(input.end_at)));
        }
        block.push(format!("SUMMARY:{}", escape(&input.title)));
        if let Some(v) = input.location.as_deref().filter(|v| !v.is_empty()) {
            block.push(format!("LOCATION:{}", escape(v)));
        }
        if let Some(v) = input.notes.as_deref().filter(|v| !v.is_empty()) {
            block.push(format!("DESCRIPTION:{}", escape(v)));
        }
        if let Some(v) = input.url.as_deref().filter(|v| !v.is_empty()) {
            if v.chars().any(char::is_control) {
                return Err(os_err("url must not contain control characters"));
            }
            block.push(format!("URL:{v}"));
        }
        block.push("END:VEVENT".to_string());

        let existing = read_for_write(&path)?;
        write_file(&path, &insert_block(&existing, &block)?)?;

        let src = self.source_for(path, Some("Asyar".into()), false);
        let lines: Vec<Line> = block
            .iter()
            .map(|l| Line {
                phys: vec![l.clone()],
                text: l.clone(),
            })
            .collect();
        let parsed = blocks(&lines, "VEVENT")
            .into_iter()
            .next()
            .and_then(|b| event_fields(&b, &uid))
            .ok_or_else(|| os_err("could not read back the new event"))?;
        Ok(to_event(&src, parsed))
    }

    pub(crate) fn list_reminders(
        &self,
        list_ids: Option<&[String]>,
        include_completed: bool,
    ) -> Result<Vec<ReminderItem>, PlatformError> {
        let mut out = Vec::new();
        for src in self.select(list_ids)? {
            let content = match read_file(&src.path) {
                Ok(c) => c,
                Err(e) => {
                    log::warn!("[calendar] skipping unreadable calendar: {e}");
                    continue;
                }
            };
            let lines = split_lines(&content);
            for block in blocks(&lines, "VTODO") {
                let fallback = format!("{}#{}", src.id(), block.start);
                let f = todo_fields(&block, &fallback);
                if include_completed || !f.is_completed {
                    out.push(to_reminder(&src, f));
                }
            }
        }
        out.sort_by(|a, b| {
            (a.is_completed, a.due_at.is_none(), a.due_at, &a.title).cmp(&(
                b.is_completed,
                b.due_at.is_none(),
                b.due_at,
                &b.title,
            ))
        });
        Ok(out)
    }

    pub(crate) fn create_reminder(
        &self,
        input: &CreateReminderInput,
        now_ms: i64,
    ) -> Result<ReminderItem, PlatformError> {
        let path = self.write_target(input.list_id.as_deref(), "reminder list")?;
        let uid = new_uid();
        let stamp = format_utc(now_ms);
        let mut block = vec![
            "BEGIN:VTODO".to_string(),
            format!("UID:{uid}"),
            format!("DTSTAMP:{stamp}"),
            format!("CREATED:{stamp}"),
            format!("SUMMARY:{}", escape(&input.title)),
            "STATUS:NEEDS-ACTION".to_string(),
        ];
        if let Some(due) = input.due_at {
            block.push(format!("DUE:{}", format_utc(due)));
        }
        if let Some(p) = input.priority.filter(|p| *p > 0) {
            block.push(format!("PRIORITY:{p}"));
        }
        if let Some(v) = input.notes.as_deref().filter(|v| !v.is_empty()) {
            block.push(format!("DESCRIPTION:{}", escape(v)));
        }
        block.push("END:VTODO".to_string());

        let existing = read_for_write(&path)?;
        write_file(&path, &insert_block(&existing, &block)?)?;

        let src = self.source_for(path, Some("Asyar".into()), false);
        let lines: Vec<Line> = block
            .iter()
            .map(|l| Line {
                phys: vec![l.clone()],
                text: l.clone(),
            })
            .collect();
        let todo = blocks(&lines, "VTODO")
            .into_iter()
            .next()
            .map(|b| todo_fields(&b, &uid))
            .ok_or_else(|| os_err("could not read back the new reminder"))?;
        Ok(to_reminder(&src, todo))
    }

    pub(crate) fn set_reminder_completed(
        &self,
        id: &str,
        completed: bool,
        now_ms: i64,
    ) -> Result<ReminderItem, PlatformError> {
        for src in self.sources() {
            let Ok(content) = read_file(&src.path) else {
                continue;
            };
            let lines = split_lines(&content);
            let found = blocks(&lines, "VTODO").into_iter().find(|b| {
                let fallback = format!("{}#{}", src.id(), b.start);
                todo_fields(b, &fallback).id == id
            });
            let Some(block) = found else { continue };
            if src.read_only {
                return Err(os_err("that reminder list is read-only"));
            }

            let eol = detect_eol(&content);
            let stamp = format_utc(now_ms);
            let drop: Vec<usize> = block
                .props
                .iter()
                .filter(|(_, p)| {
                    matches!(
                        p.name.as_str(),
                        "STATUS" | "PERCENT-COMPLETE" | "COMPLETED" | "LAST-MODIFIED"
                    )
                })
                .map(|(i, _)| *i)
                .collect();
            let mut added = vec![format!("LAST-MODIFIED:{stamp}")];
            if completed {
                added.push("STATUS:COMPLETED".into());
                added.push("PERCENT-COMPLETE:100".into());
                added.push(format!("COMPLETED:{stamp}"));
            } else {
                added.push("STATUS:NEEDS-ACTION".into());
            }

            let mut out = String::with_capacity(content.len() + 128);
            for (i, line) in lines.iter().enumerate() {
                if i == block.end {
                    for a in &added {
                        out.push_str(&fold(a, eol));
                        out.push_str(eol);
                    }
                }
                if drop.contains(&i) {
                    continue;
                }
                out.push_str(&line.phys.join(eol));
                out.push_str(eol);
            }
            write_file(&src.path, &out)?;

            let updated = split_lines(&out);
            let todo = blocks(&updated, "VTODO")
                .into_iter()
                .map(|b| todo_fields(&b, ""))
                .find(|t| t.id == id)
                .ok_or_else(|| os_err("could not read back the updated reminder"))?;
            return Ok(to_reminder(&src, todo));
        }
        Err(os_err(format!("unknown reminder id: {id}")))
    }
}

fn to_event(src: &Source, f: EventFields) -> CalendarEvent {
    CalendarEvent {
        id: f.id,
        calendar_id: src.id(),
        calendar_title: src.title.clone(),
        title: f.title,
        start_at: f.start_at,
        end_at: f.end_at,
        is_all_day: f.is_all_day,
        location: f.location,
        notes: f.notes,
        url: f.url,
    }
}

fn to_reminder(src: &Source, f: TodoFields) -> ReminderItem {
    ReminderItem {
        id: f.id,
        list_id: src.id(),
        list_title: src.title.clone(),
        title: f.title,
        is_completed: f.is_completed,
        due_at: f.due_at,
        priority: f.priority,
        notes: f.notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const NOW: i64 = 1_700_000_000_000; // 2023-11-14T22:13:20Z

    fn store(dir: &TempDir) -> Store {
        Store::new(Roots {
            asyar_dir: dir.path().join("asyar"),
            evolution_file: Some(dir.path().join("evolution.ics")),
            shared_dir: Some(dir.path().join("shared")),
        })
    }

    fn ms(s: &str) -> i64 {
        parse_ics_datetime(s).unwrap().0
    }

    #[test]
    fn parses_utc_and_all_day_dates() {
        assert_eq!(parse_ics_datetime("19700101T000000Z"), Some((0, false)));
        assert_eq!(parse_ics_datetime("20231114T221320Z"), Some((NOW, false)));
        assert_eq!(parse_ics_datetime("19700102"), Some((DAY_MS, true)));
        // Floating time is read as UTC.
        assert_eq!(
            parse_ics_datetime("19700101T010000"),
            Some((3_600_000, false))
        );
        assert_eq!(parse_ics_datetime("20231340"), None);
        assert_eq!(parse_ics_datetime("garbage"), None);
        assert_eq!(parse_ics_datetime("20231114T2213Z"), None);
    }

    #[test]
    fn date_formatting_round_trips() {
        assert_eq!(format_utc(NOW), "20231114T221320Z");
        assert_eq!(ms(&format_utc(NOW)), NOW);
        assert_eq!(format_date(DAY_MS), "19700102");
        // Leap day and pre-epoch.
        assert_eq!(ms("20240229T000000Z") / DAY_MS, 19_782);
        assert_eq!(format_utc(-1000), "19691231T235959Z");
    }

    #[test]
    fn parses_durations() {
        assert_eq!(parse_duration_ms("PT1H30M"), Some(5_400_000));
        assert_eq!(parse_duration_ms("P1D"), Some(DAY_MS));
        assert_eq!(parse_duration_ms("P2W"), Some(14 * DAY_MS));
        assert_eq!(parse_duration_ms("-PT15M"), Some(-900_000));
        assert_eq!(parse_duration_ms("P"), None);
        assert_eq!(parse_duration_ms("1H"), None);
    }

    #[test]
    fn unfolds_lines_and_unescapes_text() {
        let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20231114T100000Z\r\n\
                   SUMMARY:Team\\, planning\r\nDESCRIPTION:line one\\nline\r\n  two \\\\ end\r\n\
                   END:VEVENT\r\nEND:VCALENDAR\r\n";
        let lines = split_lines(ics);
        assert_eq!(lines.len(), 8); // description's continuation folded in
        let b = &blocks(&lines, "VEVENT")[0];
        assert_eq!(b.text("SUMMARY").unwrap(), "Team, planning");
        assert_eq!(b.text("DESCRIPTION").unwrap(), "line one\nline two \\ end");
    }

    #[test]
    fn event_fields_cover_all_day_duration_and_defaults() {
        let ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART;VALUE=DATE:20231114\nSUMMARY:Holiday\nEND:VEVENT\n\
                   BEGIN:VEVENT\nUID:y\nDTSTART:20231114T100000Z\nDURATION:PT45M\nSUMMARY:Call\n\
                   BEGIN:VALARM\nTRIGGER:-PT10M\nSUMMARY:ignored\nEND:VALARM\nEND:VEVENT\nEND:VCALENDAR\n";
        let lines = split_lines(ics);
        let bs = blocks(&lines, "VEVENT");
        let holiday = event_fields(&bs[0], "").unwrap();
        assert!(holiday.is_all_day);
        assert_eq!(holiday.end_at - holiday.start_at, DAY_MS);
        let call = event_fields(&bs[1], "").unwrap();
        assert_eq!(call.end_at - call.start_at, 45 * 60_000);
        assert_eq!(call.title, "Call"); // not the VALARM's SUMMARY
    }

    #[test]
    fn parses_vtodo_completion_due_and_priority() {
        let ics = "BEGIN:VCALENDAR\nBEGIN:VTODO\nUID:t1\nSUMMARY:Milk\nDUE:20231115T090000Z\nPRIORITY:1\nEND:VTODO\n\
                   BEGIN:VTODO\nUID:t2\nSUMMARY:Done\nSTATUS:COMPLETED\nEND:VTODO\n\
                   BEGIN:VTODO\nUID:t3\nSUMMARY:Pct\nPERCENT-COMPLETE:100\nEND:VTODO\nEND:VCALENDAR\n";
        let lines = split_lines(ics);
        let todos: Vec<_> = blocks(&lines, "VTODO")
            .iter()
            .map(|b| todo_fields(b, ""))
            .collect();
        assert!(!todos[0].is_completed);
        assert_eq!(todos[0].due_at, Some(ms("20231115T090000Z")));
        assert_eq!(todos[0].priority, 1);
        assert!(todos[1].is_completed && todos[2].is_completed);
    }

    #[test]
    fn folds_long_lines_on_char_boundaries() {
        let line = format!("SUMMARY:{}", "é".repeat(80));
        let folded = fold(&line, "\r\n");
        assert!(folded.split("\r\n").all(|p| p.len() <= 75));
        let unfolded = split_lines(&format!("{folded}\r\n"));
        assert_eq!(unfolded.len(), 1);
        assert_eq!(unfolded[0].text, line);
    }

    #[test]
    fn create_event_creates_default_file_and_lists_back() {
        let dir = TempDir::new().unwrap();
        let s = store(&dir);
        assert!(s.list_calendars().is_empty());

        let created = s
            .create_event(
                &CreateEventInput {
                    calendar_id: None,
                    title: "Lunch, with; team".into(),
                    start_at: NOW,
                    end_at: NOW + 3_600_000,
                    is_all_day: None,
                    location: Some("Café".into()),
                    notes: Some("a\nb".into()),
                    url: Some("https://example.com/x".into()),
                },
                NOW,
            )
            .unwrap();
        assert_eq!(created.title, "Lunch, with; team");
        assert!(created.id.ends_with("@asyar"));

        let default = dir.path().join("asyar/default.ics");
        let text = fs::read_to_string(&default).unwrap();
        assert!(text.starts_with("BEGIN:VCALENDAR\r\n") && text.ends_with("END:VCALENDAR\r\n"));

        let cals = s.list_calendars();
        assert_eq!(cals.len(), 1);
        assert_eq!(cals[0].title, "default");
        assert!(!cals[0].read_only);

        let events = s.list_events(NOW - 1000, NOW + 1000, None).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].location.as_deref(), Some("Café"));
        assert_eq!(events[0].notes.as_deref(), Some("a\nb"));
        assert_eq!(events[0].url.as_deref(), Some("https://example.com/x"));
        assert_eq!(events[0].calendar_id, cals[0].id);

        // A second event appends rather than replacing.
        s.create_event(
            &CreateEventInput {
                calendar_id: Some(cals[0].id.clone()),
                title: "Later".into(),
                start_at: NOW + DAY_MS,
                end_at: NOW + DAY_MS + 1000,
                is_all_day: None,
                location: None,
                notes: None,
                url: None,
            },
            NOW,
        )
        .unwrap();
        assert_eq!(s.list_events(0, NOW + 2 * DAY_MS, None).unwrap().len(), 2);
    }

    #[test]
    fn list_events_filters_by_range_and_calendar() {
        let dir = TempDir::new().unwrap();
        let s = store(&dir);
        fs::create_dir_all(dir.path().join("shared")).unwrap();
        fs::write(
            dir.path().join("shared/work.ics"),
            "BEGIN:VCALENDAR\nX-WR-CALNAME:Work\nBEGIN:VEVENT\nUID:w\nDTSTART:20231114T100000Z\nDTEND:20231114T110000Z\nSUMMARY:W\nEND:VEVENT\nEND:VCALENDAR\n",
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("asyar")).unwrap();
        fs::write(
            dir.path().join("asyar/mine.ics"),
            "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:m\nDTSTART:20231114T100000Z\nDTEND:20231114T110000Z\nSUMMARY:Mine\nEND:VEVENT\nEND:VCALENDAR\n",
        )
        .unwrap();

        let cals = s.list_calendars();
        assert_eq!(cals.len(), 2);
        assert_eq!(cals[0].title, "mine");
        assert_eq!(cals[1].title, "Work");

        let all = s
            .list_events(ms("20231114T000000Z"), ms("20231114T235959Z"), None)
            .unwrap();
        assert_eq!(all.len(), 2);

        let work_only = s
            .list_events(
                ms("20231114T000000Z"),
                ms("20231114T235959Z"),
                Some(&[cals[1].id.clone()]),
            )
            .unwrap();
        assert_eq!(work_only.len(), 1);
        assert_eq!(work_only[0].title, "W");

        // Outside the range, and an event ending exactly at range start.
        assert!(s
            .list_events(ms("20231115T000000Z"), ms("20231116T000000Z"), None)
            .unwrap()
            .is_empty());
        assert!(s
            .list_events(ms("20231114T110000Z"), ms("20231114T120000Z"), None)
            .unwrap()
            .is_empty());

        assert!(s.list_events(0, 1, Some(&["nope".to_string()])).is_err());
    }

    #[test]
    fn all_day_event_round_trips_with_exclusive_end() {
        let dir = TempDir::new().unwrap();
        let s = store(&dir);
        let day = ms("20231114T000000Z");
        let e = s
            .create_event(
                &CreateEventInput {
                    calendar_id: None,
                    title: "Off".into(),
                    start_at: day + 5000,
                    end_at: day + 6000,
                    is_all_day: Some(true),
                    location: None,
                    notes: None,
                    url: None,
                },
                NOW,
            )
            .unwrap();
        assert!(e.is_all_day);
        assert_eq!((e.start_at, e.end_at), (day, day + DAY_MS));
        let text = fs::read_to_string(dir.path().join("asyar/default.ics")).unwrap();
        assert!(text.contains("DTSTART;VALUE=DATE:20231114"));
        assert!(text.contains("DTEND;VALUE=DATE:20231115"));
    }

    #[test]
    fn evolution_calendar_is_listed_but_never_written() {
        let dir = TempDir::new().unwrap();
        let s = store(&dir);
        fs::write(
            dir.path().join("evolution.ics"),
            "BEGIN:VCALENDAR\nBEGIN:VTODO\nUID:evo\nSUMMARY:T\nEND:VTODO\nEND:VCALENDAR\n",
        )
        .unwrap();
        let cals = s.list_calendars();
        assert_eq!(cals[0].source_title.as_deref(), Some("Evolution"));
        assert!(cals[0].read_only);

        // Default target skips it; an explicit target is refused.
        let r = s
            .create_reminder(
                &CreateReminderInput {
                    list_id: Some(cals[0].id.clone()),
                    title: "x".into(),
                    due_at: None,
                    priority: None,
                    notes: None,
                },
                NOW,
            )
            .unwrap_err();
        assert!(r.to_string().contains("read-only"));
        assert!(s.set_reminder_completed("evo", true, NOW).is_err());
        s.create_reminder(
            &CreateReminderInput {
                list_id: None,
                title: "y".into(),
                due_at: None,
                priority: None,
                notes: None,
            },
            NOW,
        )
        .unwrap();
        assert!(dir.path().join("asyar/default.ics").exists());
    }

    #[test]
    fn create_and_toggle_reminder_edits_only_that_block() {
        let dir = TempDir::new().unwrap();
        let s = store(&dir);
        fs::create_dir_all(dir.path().join("asyar")).unwrap();
        let original = "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VTODO\nUID:keep\nSUMMARY:Untouched\nSTATUS:NEEDS-ACTION\nEND:VTODO\nEND:VCALENDAR\n";
        fs::write(dir.path().join("asyar/default.ics"), original).unwrap();

        let r = s
            .create_reminder(
                &CreateReminderInput {
                    list_id: None,
                    title: "Buy milk".into(),
                    due_at: Some(NOW + DAY_MS),
                    priority: Some(5),
                    notes: Some("2%".into()),
                },
                NOW,
            )
            .unwrap();
        assert!(!r.is_completed);
        assert_eq!((r.priority, r.due_at), (5, Some(NOW + DAY_MS)));

        let open = s.list_reminders(None, false).unwrap();
        assert_eq!(open.len(), 2);
        assert_eq!(open[0].title, "Buy milk"); // dated before undated

        let done = s.set_reminder_completed(&r.id, true, NOW + 1000).unwrap();
        assert!(done.is_completed);
        let text = fs::read_to_string(dir.path().join("asyar/default.ics")).unwrap();
        assert!(text.contains("STATUS:COMPLETED\n") && text.contains("PERCENT-COMPLETE:100\n"));
        assert!(text.contains("COMPLETED:20231114T221321Z"));
        // The pre-existing block and the file's LF endings are untouched.
        assert!(text.contains("UID:keep\nSUMMARY:Untouched\nSTATUS:NEEDS-ACTION\nEND:VTODO"));
        assert!(!text.contains('\r'));

        assert_eq!(s.list_reminders(None, false).unwrap().len(), 1);
        assert_eq!(s.list_reminders(None, true).unwrap().len(), 2);

        let undone = s.set_reminder_completed(&r.id, false, NOW + 2000).unwrap();
        assert!(!undone.is_completed);
        let text = fs::read_to_string(dir.path().join("asyar/default.ics")).unwrap();
        assert!(!text.contains("PERCENT-COMPLETE") && !text.contains("COMPLETED:"));
        assert_eq!(text.matches("STATUS:NEEDS-ACTION").count(), 2);

        assert!(s.set_reminder_completed("missing", true, NOW).is_err());
    }

    #[test]
    fn non_ascii_input_does_not_panic_the_parser() {
        assert_eq!(parse_ics_datetime("20231114Té\u{e9}é"), None);
        assert_eq!(parse_ics_datetime("é2023111"), None);
        let ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nDTSTART:20231114T100000Z\n\u{e9}clair\nSUMMARY:x\nEND:VEVENT\nEND:VCALENDAR\n";
        let lines = split_lines(ics);
        assert_eq!(blocks(&lines, "VEVENT").len(), 1);
    }

    #[test]
    fn url_with_newline_cannot_inject_lines() {
        let dir = TempDir::new().unwrap();
        let s = store(&dir);
        let err = s
            .create_event(
                &CreateEventInput {
                    calendar_id: None,
                    title: "x".into(),
                    start_at: 0,
                    end_at: 1,
                    is_all_day: None,
                    location: None,
                    notes: None,
                    url: Some("https://a.example\r\nEND:VEVENT".into()),
                },
                NOW,
            )
            .unwrap_err();
        assert!(err.to_string().contains("control characters"));
        assert!(!dir.path().join("asyar/default.ics").exists());
    }

    #[test]
    fn unreadable_calendar_is_never_overwritten() {
        let dir = TempDir::new().unwrap();
        let s = store(&dir);
        fs::create_dir_all(dir.path().join("asyar")).unwrap();
        // Latin-1 bytes: not valid UTF-8, so read_to_string fails.
        let bytes: &[u8] = b"BEGIN:VCALENDAR\nSUMMARY:caf\xe9\nEND:VCALENDAR\n";
        fs::write(dir.path().join("asyar/latin1.ics"), bytes).unwrap();
        let err = s
            .create_reminder(
                &CreateReminderInput {
                    list_id: None,
                    title: "x".into(),
                    due_at: None,
                    priority: None,
                    notes: None,
                },
                NOW,
            )
            .unwrap_err();
        assert!(err.to_string().contains("left unchanged"));
        assert_eq!(
            fs::read(dir.path().join("asyar/latin1.ics")).unwrap(),
            bytes
        );
    }

    #[test]
    fn rejects_files_that_are_not_calendars() {
        let dir = TempDir::new().unwrap();
        let s = store(&dir);
        fs::create_dir_all(dir.path().join("asyar")).unwrap();
        fs::write(dir.path().join("asyar/bad.ics"), "hello world\n").unwrap();
        let err = s
            .create_event(
                &CreateEventInput {
                    calendar_id: None,
                    title: "x".into(),
                    start_at: 0,
                    end_at: 1,
                    is_all_day: None,
                    location: None,
                    notes: None,
                    url: None,
                },
                NOW,
            )
            .unwrap_err();
        assert!(err.to_string().contains("not a valid calendar"));
        // Untouched.
        assert_eq!(
            fs::read_to_string(dir.path().join("asyar/bad.ics")).unwrap(),
            "hello world\n"
        );
    }
}
