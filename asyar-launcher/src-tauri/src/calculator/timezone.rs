//! World-clock queries: `time in tokyo`, `5pm ldn in sf`,
//! `time diff paris`, `time in 4 hours`, `3pm est in pst`.
//!
//! City resolution: a curated alias map (airports, abbreviations,
//! common short names) plus a generic scan of IANA zone identifiers
//! (`kathmandu` → `Asia/Kathmandu`), all DST-correct via chrono-tz.

use chrono::{DateTime, Duration, Offset, TimeZone, Utc};
use chrono_tz::{Tz, TZ_VARIANTS};
use regex::Regex;
use std::sync::OnceLock;

use super::{CalcKind, CalcResult};

/// Curated aliases: abbreviations, airports, and cities whose IANA zone
/// carries a different name.
fn alias_zone(name: &str) -> Option<Tz> {
    use chrono_tz::*;
    Some(match name {
        // Cities without their own IANA identifier
        "sf" | "san francisco" | "sfo" | "silicon valley" | "la" | "lax" | "san diego"
        | "seattle" | "pst" | "pdt" | "pt" => America::Los_Angeles,
        "nyc" | "ny" | "new york city" | "jfk" | "boston" | "miami" | "washington"
        | "washington dc" | "dc" | "est" | "edt" | "et" => America::New_York,
        "cst" | "cdt" | "ct" | "houston" | "dallas" | "austin" => America::Chicago,
        "mst" | "mdt" | "mt" => America::Denver,
        "ldn" | "lon" | "lhr" | "bst" | "uk" => Europe::London,
        "cet" | "cest" | "munich" | "fra" | "frankfurt" | "hamburg" | "cologne" => Europe::Berlin,
        "cdg" => Europe::Paris,
        "ams" => Europe::Amsterdam,
        "ist" | "delhi" | "new delhi" | "mumbai" | "bangalore" | "bengaluru" | "chennai" => {
            Asia::Kolkata
        }
        "jst" | "nrt" | "hnd" | "osaka" | "kyoto" => Asia::Tokyo,
        "kst" | "icn" | "busan" => Asia::Seoul,
        "beijing" | "shenzhen" | "guangzhou" | "pek" => Asia::Shanghai,
        "dxb" | "abu dhabi" => Asia::Dubai,
        "erbil" | "hewler" | "sulaymaniyah" | "duhok" | "mosul" | "basra" | "iraq" => Asia::Baghdad,
        "sin" => Asia::Singapore,
        "hkg" => Asia::Hong_Kong,
        "aest" | "aedt" | "canberra" => Australia::Sydney,
        "hst" | "hawaii" => Pacific::Honolulu,
        "akst" | "akdt" => America::Anchorage,
        "msk" => Europe::Moscow,
        "eet" => Europe::Athens,
        "wet" => Europe::Lisbon,
        "gmt" | "utc" | "zulu" => UTC,
        _ => return None,
    })
}

/// Resolve a human city/zone name to an IANA timezone.
pub fn resolve_zone(name: &str) -> Option<Tz> {
    let n = name
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if n.is_empty() {
        return None;
    }

    if let Some(tz) = alias_zone(&n) {
        return Some(tz);
    }

    // Full IANA name ("asia/tokyo") or last segment ("tokyo", "new york").
    for tz in TZ_VARIANTS {
        let full = tz.name().to_lowercase();
        if full == n {
            return Some(tz);
        }
        if let Some(seg) = full.rsplit('/').next() {
            if seg.replace('_', " ") == n {
                return Some(tz);
            }
        }
    }
    None
}

/// Short display name: `Europe/London` → `London`.
fn zone_display(tz: Tz) -> String {
    tz.name()
        .rsplit('/')
        .next()
        .unwrap_or(tz.name())
        .replace('_', " ")
}

/// `+9`, `+5:45`, `-7:30` at the given instant.
fn offset_display(tz: Tz, at: DateTime<Utc>) -> String {
    let secs = at.with_timezone(&tz).offset().fix().local_minus_utc();
    let sign = if secs < 0 { "-" } else { "+" };
    let abs = secs.abs();
    let (h, m) = (abs / 3600, (abs % 3600) / 60);
    if m == 0 {
        format!("{sign}{h}")
    } else {
        format!("{sign}{h}:{m:02}")
    }
}

fn city_result(tz: Tz, at: DateTime<Utc>) -> CalcResult {
    let t = at.with_timezone(&tz);
    CalcResult::new(
        t.format("%H:%M").to_string(),
        format!(
            "{} · {} (UTC{})",
            t.format("%a, %-d %b"),
            tz.name(),
            offset_display(tz, at)
        ),
        CalcKind::Time,
    )
}

struct Patterns {
    relative: Regex,
    in_city: Regex,
    city_suffix: Regex,
    diff: Regex,
    wall: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        relative: Regex::new(
            r"(?i)^time\s+in\s+(\d+)\s+(hours?|hrs?|minutes?|mins?)(?:\s+in\s+(.+))?$",
        )
        .unwrap(),
        in_city: Regex::new(r"(?i)^time\s+in\s+(.+)$").unwrap(),
        city_suffix: Regex::new(r"(?i)^(.+?)\s+time$").unwrap(),
        diff: Regex::new(r"(?i)^(?:time\s+)?diff\s+(.+)$").unwrap(),
        wall: Regex::new(
            r"(?i)^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+(.+?)(?:\s+(?:in|to)\s+(.+))?$",
        )
        .unwrap(),
    })
}

/// Evaluate a timezone query against an injected clock and local zone.
pub fn evaluate_time(query: &str, now_utc: DateTime<Utc>, local_tz: Tz) -> Option<CalcResult> {
    let p = patterns();
    let q = query.trim();

    // `time in 4 hours [in tokyo]` — relative, must run before city match.
    if let Some(c) = p.relative.captures(q) {
        let n: i64 = c[1].parse().ok()?;
        let unit = c[2].to_lowercase();
        let delta = if unit.starts_with('m') {
            Duration::minutes(n)
        } else {
            Duration::hours(n)
        };
        let tz = match c.get(3) {
            Some(m) => resolve_zone(m.as_str())?,
            None => local_tz,
        };
        let t = (now_utc + delta).with_timezone(&tz);
        return Some(CalcResult::new(
            t.format("%H:%M").to_string(),
            format!("{} · in {}", t.format("%a, %-d %b"), zone_display(tz)),
            CalcKind::Time,
        ));
    }

    if let Some(c) = p.in_city.captures(q) {
        let tz = resolve_zone(&c[1])?;
        return Some(city_result(tz, now_utc));
    }

    if let Some(c) = p.city_suffix.captures(q) {
        if let Some(tz) = resolve_zone(&c[1]) {
            return Some(city_result(tz, now_utc));
        }
        // fall through: not a city ("2+2 time" etc.)
    }

    if let Some(c) = p.diff.captures(q) {
        let tz = resolve_zone(&c[1])?;
        let there = now_utc.with_timezone(&tz).offset().fix().local_minus_utc();
        let here = now_utc
            .with_timezone(&local_tz)
            .offset()
            .fix()
            .local_minus_utc();
        let delta_min = (there - here) / 60;
        let value = if delta_min == 0 {
            "same time".to_string()
        } else {
            let abs = delta_min.abs();
            let (h, m) = (abs / 60, abs % 60);
            let span = if m == 0 {
                format!("{h} h")
            } else {
                format!("{h} h {m} min")
            };
            format!("{span} {}", if delta_min > 0 { "ahead" } else { "behind" })
        };
        return Some(CalcResult::new(
            value,
            format!(
                "{} {} · {} here",
                zone_display(tz),
                now_utc.with_timezone(&tz).format("%H:%M"),
                now_utc.with_timezone(&local_tz).format("%H:%M")
            ),
            CalcKind::Time,
        ));
    }

    if let Some(c) = p.wall.captures(q) {
        // Require am/pm or minutes so `100 usd in eur` never matches.
        if c.get(2).is_none() && c.get(3).is_none() {
            return None;
        }
        let mut hour: u32 = c[1].parse().ok()?;
        let minute: u32 = c.get(2).map_or(Some(0), |m| m.as_str().parse().ok())?;
        if hour > 23 || minute > 59 {
            return None;
        }
        if let Some(ap) = c.get(3) {
            let pm = ap.as_str().eq_ignore_ascii_case("pm");
            if hour > 12 {
                return None;
            }
            hour = match (hour, pm) {
                (12, false) => 0,
                (12, true) => 12,
                (h, true) => h + 12,
                (h, false) => h,
            };
        }
        let src = resolve_zone(&c[4])?;
        let tgt = match c.get(5) {
            Some(m) => resolve_zone(m.as_str())?,
            None => local_tz,
        };
        let src_date = now_utc.with_timezone(&src).date_naive();
        let naive = src_date.and_hms_opt(hour, minute, 0)?;
        let src_dt = src.from_local_datetime(&naive).earliest()?;
        let out = src_dt.with_timezone(&tgt);
        let src_12h = naive.format("%-I:%M %p");
        return Some(CalcResult::new(
            out.format("%H:%M").to_string(),
            format!("{src_12h} {} → {}", zone_display(src), zone_display(tgt)),
            CalcKind::Time,
        ));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calculator::CalcKind;

    // 2026-07-11 12:00 UTC. Local zone for tests: Asia/Baghdad (UTC+3).
    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-07-11T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn eval(q: &str) -> Option<CalcResult> {
        evaluate_time(q, now(), chrono_tz::Asia::Baghdad)
    }

    #[test]
    fn resolves_aliases_and_iana_segments() {
        assert_eq!(resolve_zone("tokyo").unwrap(), chrono_tz::Asia::Tokyo);
        assert_eq!(resolve_zone("sf").unwrap(), chrono_tz::America::Los_Angeles);
        assert_eq!(resolve_zone("ldn").unwrap(), chrono_tz::Europe::London);
        assert_eq!(resolve_zone("nyc").unwrap(), chrono_tz::America::New_York);
        // Generic IANA last-segment match, no alias needed:
        assert_eq!(
            resolve_zone("kathmandu").unwrap(),
            chrono_tz::Asia::Kathmandu
        );
        assert_eq!(
            resolve_zone("new york").unwrap(),
            chrono_tz::America::New_York
        );
        // Abbreviations:
        assert_eq!(
            resolve_zone("pst").unwrap(),
            chrono_tz::America::Los_Angeles
        );
        assert_eq!(resolve_zone("est").unwrap(), chrono_tz::America::New_York);
        assert!(resolve_zone("nowhereville").is_none());
    }

    #[test]
    fn time_in_city() {
        // 12:00 UTC = 21:00 Tokyo (+9, no DST).
        let r = eval("time in tokyo").unwrap();
        assert_eq!(r.value, "21:00");
        assert_eq!(r.kind, CalcKind::Time);
        assert!(r.detail.contains("Tokyo"), "detail: {}", r.detail);
    }

    #[test]
    fn city_time_suffix_form() {
        assert_eq!(eval("tokyo time").unwrap().value, "21:00");
    }

    #[test]
    fn time_in_city_with_odd_offset() {
        // Kathmandu is UTC+5:45 → 17:45.
        assert_eq!(eval("time in kathmandu").unwrap().value, "17:45");
    }

    #[test]
    fn wall_time_conversion_between_cities() {
        // 5pm London (BST, +1) = 16:00 UTC = 09:00 Los Angeles (PDT, -7).
        let r = eval("5pm ldn in sf").unwrap();
        assert_eq!(r.value, "09:00");
        assert!(r.detail.contains("London"), "detail: {}", r.detail);
    }

    #[test]
    fn abbreviation_conversion() {
        // 3pm New York (EDT, -4) = 19:00 UTC = 12:00 Los Angeles (PDT, -7).
        assert_eq!(eval("3pm est in pst").unwrap().value, "12:00");
    }

    #[test]
    fn wall_time_to_local() {
        // 5pm Tokyo (+9) = 08:00 UTC = 11:00 Baghdad (+3).
        assert_eq!(eval("5pm tokyo").unwrap().value, "11:00");
    }

    #[test]
    fn time_diff() {
        // Paris in July is CEST (+2); Baghdad is +3 → Paris is 1 h behind.
        let r = eval("time diff paris").unwrap();
        assert!(r.value.contains("1 h"), "value: {}", r.value);
        assert!(r.value.contains("behind"), "value: {}", r.value);
    }

    #[test]
    fn time_in_n_hours_local() {
        // Local (Baghdad) now is 15:00 → +4 = 19:00.
        assert_eq!(eval("time in 4 hours").unwrap().value, "19:00");
    }

    #[test]
    fn time_in_n_hours_in_city() {
        // Tokyo now is 21:00 → +4 = 01:00 next day.
        assert_eq!(eval("time in 4 hours in tokyo").unwrap().value, "01:00");
    }

    #[test]
    fn rejects_non_time_queries() {
        assert!(eval("time").is_none());
        assert!(eval("timer 10").is_none());
        assert!(eval("2+2").is_none());
        assert!(eval("time in nowhereville").is_none());
    }
}
