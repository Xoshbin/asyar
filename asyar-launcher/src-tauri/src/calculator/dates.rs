//! Natural-language date and time-of-day arithmetic.
//!
//! Handles the Soulver/Raycast-style phrases fend has no concept of:
//! `days until christmas`, `monday in 3 weeks`, `aug 5 + 5`,
//! `3:45pm + 90 minutes`, `next friday`, `in 2 weeks`.

use chrono::{Datelike, Duration, Months, NaiveDate, NaiveTime, Weekday};
use regex::Regex;
use std::sync::OnceLock;

use super::format::group_thousands;
use super::{CalcKind, CalcResult};

/// How to pick a year for a yearless date like `31 mar`.
#[derive(Clone, Copy)]
enum Roll {
    /// Next occurrence (for "until", arithmetic).
    Future,
    /// Most recent occurrence (for "since").
    Past,
}

fn month_from_name(s: &str) -> Option<u32> {
    const MONTHS: [&str; 12] = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
    ];
    let s = s.to_lowercase();
    MONTHS
        .iter()
        .position(|m| *m == s || (s.len() >= 3 && m.starts_with(&s)))
        .map(|i| i as u32 + 1)
}

fn weekday_from_name(s: &str) -> Option<Weekday> {
    match s.to_lowercase().as_str() {
        "monday" | "mon" => Some(Weekday::Mon),
        "tuesday" | "tue" | "tues" => Some(Weekday::Tue),
        "wednesday" | "wed" => Some(Weekday::Wed),
        "thursday" | "thu" | "thur" | "thurs" => Some(Weekday::Thu),
        "friday" | "fri" => Some(Weekday::Fri),
        "saturday" | "sat" => Some(Weekday::Sat),
        "sunday" | "sun" => Some(Weekday::Sun),
        _ => None,
    }
}

/// Well-known fixed-date holidays.
fn holiday(s: &str) -> Option<(u32, u32)> {
    match s {
        "christmas" | "christmas day" | "xmas" => Some((12, 25)),
        "christmas eve" => Some((12, 24)),
        "new year" | "new years" | "new year's" | "new year's day" | "new years day" => {
            Some((1, 1))
        }
        "new year's eve" | "new years eve" => Some((12, 31)),
        "halloween" => Some((10, 31)),
        "valentine's day" | "valentines day" | "valentine's" | "valentines" => Some((2, 14)),
        _ => None,
    }
}

/// Apply year rolling to a yearless month/day.
///
/// Handles Feb 29 specially: it doesn't exist every year, so a naive
/// "just try +1/-1 year" can miss it entirely (most adjacent years
/// aren't leap years). Search up to 4 years in the roll direction for
/// the closest year where the date actually exists.
fn rolled_date(month: u32, day: u32, today: NaiveDate, roll: Roll) -> Option<NaiveDate> {
    let year = today.year();
    for offset in 0..=4 {
        let target_year = match roll {
            Roll::Future => year + offset,
            Roll::Past => year - offset,
        };
        let Some(d) = NaiveDate::from_ymd_opt(target_year, month, day) else {
            continue;
        };
        match roll {
            Roll::Future if d >= today => return Some(d),
            Roll::Past if d <= today => return Some(d),
            _ => {}
        }
    }
    None
}

fn strip_ordinal(s: &str) -> &str {
    s.strip_suffix("st")
        .or_else(|| s.strip_suffix("nd"))
        .or_else(|| s.strip_suffix("rd"))
        .or_else(|| s.strip_suffix("th"))
        .filter(|rest| rest.chars().all(|c| c.is_ascii_digit()) && !rest.is_empty())
        .unwrap_or(s)
}

/// Parse a natural date token: `today`, `2026-08-05`, `aug 5`,
/// `31 march 2027`, `christmas`, `friday`, …
fn parse_date_token(token: &str, today: NaiveDate, roll: Roll) -> Option<NaiveDate> {
    let t = token.trim().to_lowercase();
    let t = t.strip_prefix("the ").unwrap_or(&t).trim().to_string();

    match t.as_str() {
        "today" | "now" => return Some(today),
        "tomorrow" => return today.succ_opt(),
        "yesterday" => return today.pred_opt(),
        _ => {}
    }

    if let Ok(d) = NaiveDate::parse_from_str(&t, "%Y-%m-%d") {
        return Some(d);
    }

    if let Some((m, d)) = holiday(&t) {
        return rolled_date(m, d, today, roll);
    }

    // (next|this|last)? weekday
    {
        let rest = t
            .strip_prefix("next ")
            .or_else(|| t.strip_prefix("this "))
            .unwrap_or(&t);
        if let Some(wd) = weekday_from_name(rest) {
            let ahead = (wd.num_days_from_monday() as i64
                - today.weekday().num_days_from_monday() as i64)
                .rem_euclid(7);
            let ahead = if ahead == 0 { 7 } else { ahead };
            return match roll {
                Roll::Future => Some(today + Duration::days(ahead)),
                Roll::Past => Some(today + Duration::days(ahead) - Duration::days(7)),
            };
        }
    }

    // "aug 5", "5 aug", "march 31 2027", "31 march, 2027"
    let cleaned = t.replace(',', " ");
    let parts: Vec<&str> = cleaned.split_whitespace().collect();
    if parts.len() == 2 || parts.len() == 3 {
        let year: Option<i32> = if parts.len() == 3 {
            Some(parts[2].parse().ok()?)
        } else {
            None
        };
        let (month, day) = if let Some(m) = month_from_name(parts[0]) {
            (m, strip_ordinal(parts[1]).parse::<u32>().ok()?)
        } else {
            let m = month_from_name(parts[1])?;
            (m, strip_ordinal(parts[0]).parse::<u32>().ok()?)
        };
        return match year {
            Some(y) => NaiveDate::from_ymd_opt(y, month, day),
            None => rolled_date(month, day, today, roll),
        };
    }

    None
}

fn fmt_date(d: NaiveDate) -> String {
    d.format("%a, %-d %b %Y").to_string()
}

fn fmt_clock(t: NaiveTime) -> String {
    t.format("%-I:%M %p").to_string()
}

struct Patterns {
    days_until: Regex,
    days_since: Regex,
    days_between: Regex,
    weeks_until: Regex,
    weekday_in_weeks: Regex,
    in_n: Regex,
    n_from_now: Regex,
    n_ago: Regex,
    work_in_year: Regex,
    next_weekday: Regex,
    clock: Regex,
    date_arith: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    const WD: &str = r"monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun";
    P.get_or_init(|| Patterns {
        days_until: Regex::new(r"(?i)^(?:how\s+many\s+)?days\s+(?:until|till|til)\s+(.+)$")
            .unwrap(),
        days_since: Regex::new(r"(?i)^(?:how\s+many\s+)?days\s+since\s+(.+)$").unwrap(),
        days_between: Regex::new(
            r"(?i)^(?:how\s+many\s+)?days\s+between\s+(.+?)\s+and\s+(.+)$",
        )
        .unwrap(),
        weeks_until: Regex::new(r"(?i)^(?:how\s+many\s+)?weeks\s+(?:until|till|til)\s+(.+)$")
            .unwrap(),
        weekday_in_weeks: Regex::new(&format!(r"(?i)^({WD})\s+in\s+(\d+)\s+weeks?$")).unwrap(),
        in_n: Regex::new(r"(?i)^in\s+(\d+)\s+(days?|weeks?|months?|years?)$").unwrap(),
        n_from_now: Regex::new(
            r"(?i)^(\d+)\s+(days?|weeks?|months?|years?)\s+from\s+(?:now|today)$",
        )
        .unwrap(),
        n_ago: Regex::new(r"(?i)^(\d+)\s+(days?|weeks?|months?|years?)\s+ago$").unwrap(),
        work_in_year: Regex::new(r"(?i)^work\s*(?:ing\s*)?(hours|days)\s+in\s+(\d{4})$").unwrap(),
        next_weekday: Regex::new(&format!(r"(?i)^(?:next\s+|this\s+)?({WD})$")).unwrap(),
        clock: Regex::new(
            r"(?i)^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*([+-])\s*(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m)?$",
        )
        .unwrap(),
        date_arith: Regex::new(r"(?i)^(.+?)\s*([+-])\s*(\d+)\s*(days?|weeks?|months?|years?)?$")
            .unwrap(),
    })
}

fn add_units(date: NaiveDate, n: i64, unit: &str) -> Option<NaiveDate> {
    let u = unit.to_lowercase();
    if u.starts_with("day") {
        Some(date + Duration::days(n))
    } else if u.starts_with("week") {
        Some(date + Duration::days(n * 7))
    } else if u.starts_with("month") {
        if n >= 0 {
            date.checked_add_months(Months::new(n as u32))
        } else {
            date.checked_sub_months(Months::new((-n) as u32))
        }
    } else if u.starts_with("year") {
        if n >= 0 {
            date.checked_add_months(Months::new(n as u32 * 12))
        } else {
            date.checked_sub_months(Months::new((-n) as u32 * 12))
        }
    } else {
        None
    }
}

fn date_result(target: NaiveDate, today: NaiveDate) -> CalcResult {
    let n = (target - today).num_days();
    let detail = match n {
        0 => "today".to_string(),
        1 => "tomorrow".to_string(),
        d if d > 0 => format!("in {d} days"),
        d => format!("{} days ago", -d),
    };
    CalcResult::new(fmt_date(target), detail, CalcKind::Date)
}

/// Evaluate a natural-language date/time query against an injected
/// "now" so tests are deterministic.
pub fn evaluate_date(query: &str, today: NaiveDate, _now_time: NaiveTime) -> Option<CalcResult> {
    let p = patterns();
    let q = query.trim();

    if let Some(c) = p.days_until.captures(q) {
        let target = parse_date_token(&c[1], today, Roll::Future)?;
        let n = (target - today).num_days();
        return Some(CalcResult::new(
            format!("{n} days"),
            fmt_date(target),
            CalcKind::Date,
        ));
    }

    if let Some(c) = p.days_since.captures(q) {
        let target = parse_date_token(&c[1], today, Roll::Past)?;
        let n = (today - target).num_days();
        return Some(CalcResult::new(
            format!("{n} days"),
            format!("since {}", fmt_date(target)),
            CalcKind::Date,
        ));
    }

    if let Some(c) = p.days_between.captures(q) {
        let a = parse_date_token(&c[1], today, Roll::Future)?;
        let b = parse_date_token(&c[2], today, Roll::Future)?;
        let n = (b - a).num_days().abs();
        return Some(CalcResult::new(
            format!("{n} days"),
            format!("{} → {}", fmt_date(a), fmt_date(b)),
            CalcKind::Date,
        ));
    }

    if let Some(c) = p.weeks_until.captures(q) {
        let target = parse_date_token(&c[1], today, Roll::Future)?;
        let days = (target - today).num_days();
        let weeks = (days as f64 / 7.0 * 10.0).round() / 10.0;
        let value = if weeks.fract() == 0.0 {
            format!("{} weeks", weeks as i64)
        } else {
            format!("{weeks} weeks")
        };
        return Some(CalcResult::new(value, fmt_date(target), CalcKind::Date));
    }

    if let Some(c) = p.weekday_in_weeks.captures(q) {
        let wd = weekday_from_name(&c[1])?;
        let n: i64 = c[2].parse().ok()?;
        let base = today + Duration::days(n * 7);
        let monday = base - Duration::days(base.weekday().num_days_from_monday() as i64);
        let target = monday + Duration::days(wd.num_days_from_monday() as i64);
        return Some(date_result(target, today));
    }

    if let Some(c) = p.in_n.captures(q) {
        let n: i64 = c[1].parse().ok()?;
        let target = add_units(today, n, &c[2])?;
        return Some(date_result(target, today));
    }

    if let Some(c) = p.n_from_now.captures(q) {
        let n: i64 = c[1].parse().ok()?;
        let target = add_units(today, n, &c[2])?;
        return Some(date_result(target, today));
    }

    if let Some(c) = p.n_ago.captures(q) {
        let n: i64 = c[1].parse().ok()?;
        let target = add_units(today, -n, &c[2])?;
        let mut r = date_result(target, today);
        r.detail = format!("{n} {} ago", c[2].to_lowercase());
        return Some(r);
    }

    if let Some(c) = p.work_in_year.captures(q) {
        let year: i32 = c[2].parse().ok()?;
        let mut workdays: u32 = 0;
        let mut day = NaiveDate::from_ymd_opt(year, 1, 1)?;
        while day.year() == year {
            if !matches!(day.weekday(), Weekday::Sat | Weekday::Sun) {
                workdays += 1;
            }
            day = day.succ_opt()?;
        }
        let (value, detail) = if c[1].eq_ignore_ascii_case("hours") {
            (
                format!("{} h", group_thousands(&(workdays * 8).to_string())),
                format!("{workdays} workdays × 8 h in {year}"),
            )
        } else {
            (
                format!("{workdays} workdays"),
                format!("Mon–Fri days in {year}"),
            )
        };
        return Some(CalcResult::new(value, detail, CalcKind::Date));
    }

    if let Some(c) = p.next_weekday.captures(q) {
        let target = parse_date_token(&c[0], today, Roll::Future)?;
        return Some(date_result(target, today));
    }

    if let Some(c) = p.clock.captures(q) {
        // Require am/pm or minutes so plain math like `2 + 2` is skipped.
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
        let n: i64 = c[5].parse().ok()?;
        let unit_minutes = match c.get(6).map(|m| m.as_str().to_lowercase()) {
            Some(u) if u.starts_with('m') => 1,
            _ => 60,
        };
        let sign = if &c[4] == "+" { 1 } else { -1 };
        let start = hour as i64 * 60 + minute as i64;
        let total = (start + sign * n * unit_minutes).rem_euclid(24 * 60);
        let t = NaiveTime::from_hms_opt((total / 60) as u32, (total % 60) as u32, 0)?;
        return Some(CalcResult::new(
            fmt_clock(t),
            format!(
                "{} {} {} {}",
                c[0][..c[0].find(['+', '-'])?].trim(),
                &c[4],
                n,
                if unit_minutes == 1 { "min" } else { "h" }
            ),
            CalcKind::Time,
        ));
    }

    if let Some(c) = p.date_arith.captures(q) {
        let base = parse_date_token(&c[1], today, Roll::Future)?;
        let n: i64 = c[3].parse().ok()?;
        let n = if &c[2] == "-" { -n } else { n };
        let unit = c.get(4).map_or("days", |m| m.as_str());
        let target = add_units(base, n, unit)?;
        let mut r = date_result(target, today);
        r.detail = format!("{} {} {} {}", fmt_date(base), &c[2], n.abs(), unit);
        return Some(r);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calculator::CalcKind;

    // 2026-07-11 is a Saturday.
    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, 11).unwrap()
    }
    fn now() -> NaiveTime {
        NaiveTime::from_hms_opt(15, 0, 0).unwrap()
    }

    fn eval(q: &str) -> Option<CalcResult> {
        evaluate_date(q, today(), now())
    }

    #[test]
    fn days_until_holiday() {
        let r = eval("days until christmas").unwrap();
        assert_eq!(r.value, "167 days");
        assert_eq!(r.kind, CalcKind::Date);
        assert!(r.detail.contains("25 Dec 2026"), "detail: {}", r.detail);
    }

    #[test]
    fn days_until_rolls_to_next_year_when_passed() {
        let r = eval("days until 31 mar").unwrap();
        assert_eq!(r.value, "263 days");
        assert!(r.detail.contains("31 Mar 2027"), "detail: {}", r.detail);
    }

    #[test]
    fn days_until_synonyms() {
        assert_eq!(eval("days till christmas").unwrap().value, "167 days");
        assert_eq!(
            eval("how many days until christmas").unwrap().value,
            "167 days"
        );
    }

    #[test]
    fn days_since_past_date() {
        assert_eq!(eval("days since 2026-01-01").unwrap().value, "191 days");
    }

    #[test]
    fn days_between_two_dates() {
        assert_eq!(
            eval("days between 2026-01-01 and 2026-12-31")
                .unwrap()
                .value,
            "364 days"
        );
    }

    #[test]
    fn weeks_until() {
        let r = eval("weeks until christmas").unwrap();
        assert_eq!(r.value, "23.9 weeks");
    }

    #[test]
    fn date_plus_days() {
        let r = eval("today + 45 days").unwrap();
        assert!(r.value.contains("25 Aug 2026"), "value: {}", r.value);
    }

    #[test]
    fn bare_number_after_date_means_days() {
        let r = eval("aug 5 + 5").unwrap();
        assert!(r.value.contains("10 Aug 2026"), "value: {}", r.value);
    }

    #[test]
    fn date_minus_weeks() {
        let r = eval("today - 2 weeks").unwrap();
        assert!(r.value.contains("27 Jun 2026"), "value: {}", r.value);
    }

    #[test]
    fn date_plus_months_calendar_aware() {
        let r = eval("2026-01-31 + 1 month").unwrap();
        assert!(r.value.contains("28 Feb 2026"), "value: {}", r.value);
    }

    #[test]
    fn weekday_in_n_weeks() {
        // Week of Aug 1 2026 (Sat); its Monday is Jul 27.
        let r = eval("monday in 3 weeks").unwrap();
        assert!(r.value.contains("27 Jul 2026"), "value: {}", r.value);
    }

    #[test]
    fn next_weekday() {
        let r = eval("next friday").unwrap();
        assert!(r.value.contains("17 Jul 2026"), "value: {}", r.value);
        assert!(r.detail.contains("in 6 days"), "detail: {}", r.detail);
    }

    #[test]
    fn in_n_weeks() {
        let r = eval("in 2 weeks").unwrap();
        assert!(r.value.contains("25 Jul 2026"), "value: {}", r.value);
    }

    #[test]
    fn n_days_from_now() {
        let r = eval("45 days from now").unwrap();
        assert!(r.value.contains("25 Aug 2026"), "value: {}", r.value);
    }

    #[test]
    fn n_units_ago() {
        let r = eval("35 days ago").unwrap();
        assert!(r.value.contains("6 Jun 2026"), "value: {}", r.value);
        assert!(r.detail.contains("35 days ago"), "detail: {}", r.detail);
        let r = eval("2 weeks ago").unwrap();
        assert!(r.value.contains("27 Jun 2026"), "value: {}", r.value);
    }

    #[test]
    fn days_until_feb_29_from_non_leap_year() {
        // 2026 isn't a leap year; the next real Feb 29 is 2028.
        let r = eval("days until feb 29").unwrap();
        assert_eq!(r.value, "598 days");
        assert!(r.detail.contains("29 Feb 2028"), "detail: {}", r.detail);
    }

    #[test]
    fn days_until_feb_29_after_it_passed_in_leap_year() {
        // 2028 is a leap year but Feb 29 already passed; 2029 (the naive
        // "+1 year" guess) isn't a leap year either, so this must keep
        // searching until 2032.
        let today = NaiveDate::from_ymd_opt(2028, 3, 1).unwrap();
        let r = evaluate_date("days until feb 29", today, now()).unwrap();
        assert_eq!(r.value, "1460 days");
        assert!(r.detail.contains("29 Feb 2032"), "detail: {}", r.detail);
    }

    #[test]
    fn work_time_in_year() {
        // 2023 has 260 weekdays → 2,080 work hours at 8 h/day.
        let r = eval("workhours in 2023").unwrap();
        assert_eq!(r.value, "2,080 h");
        assert!(r.detail.contains("260"), "detail: {}", r.detail);
        assert_eq!(eval("workdays in 2023").unwrap().value, "260 workdays");
        assert_eq!(eval("work hours in 2023").unwrap().value, "2,080 h");
    }

    #[test]
    fn clock_time_plus_hours() {
        assert_eq!(eval("3:45pm + 5").unwrap().value, "8:45 PM");
        assert_eq!(eval("3:45pm + 90 minutes").unwrap().value, "5:15 PM");
        assert_eq!(eval("11pm + 2 hours").unwrap().value, "1:00 AM");
    }

    #[test]
    fn rejects_non_date_queries() {
        assert!(eval("days").is_none());
        assert!(eval("until").is_none());
        assert!(eval("2+2").is_none());
        assert!(eval("100 usd to eur").is_none());
    }
}
