use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub mod crash_reporter;

/// The 3-state crash-report consent, read from settings.dat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrashReportMode {
    Off,
    Ask,
    Auto,
}

/// What to do with a detected crash on next launch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrashAction {
    Ignore,
    Prompt,
    SendSilently,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CrashPayload {
    pub panic: String,
    pub backtrace: String,
    pub log_tail: String,
}

/// User-facing feedback input from the "Send Feedback" view (Flow A).
#[derive(Debug, Clone, Deserialize)]
pub struct FeedbackInput {
    #[serde(rename = "type")]
    pub kind: String,
    pub category: Option<String>,
    pub message: Option<String>,
    pub email: Option<String>,
}

/// The exact JSON body POSTed to /api/feedback.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FeedbackReport {
    #[serde(rename = "type")]
    pub kind: String,
    pub category: Option<String>,
    pub message: Option<String>,
    pub email: Option<String>,
    pub payload: Option<CrashPayload>,
    pub app_version: String,
    pub platform: String,
}

pub fn parse_crash_report_mode(settings_json: &str) -> CrashReportMode {
    let value: serde_json::Value = match serde_json::from_str(settings_json) {
        Ok(v) => v,
        Err(_) => return CrashReportMode::Off,
    };
    match value
        .get("privacy")
        .and_then(|p| p.get("crashReportMode"))
        .and_then(|m| m.as_str())
    {
        Some("ask") => CrashReportMode::Ask,
        Some("auto") => CrashReportMode::Auto,
        _ => CrashReportMode::Off,
    }
}

pub fn decide_crash_action(mode: CrashReportMode, crashed: bool) -> CrashAction {
    if !crashed {
        return CrashAction::Ignore;
    }
    match mode {
        CrashReportMode::Off => CrashAction::Ignore,
        CrashReportMode::Ask => CrashAction::Prompt,
        CrashReportMode::Auto => CrashAction::SendSilently,
    }
}

pub fn trim_log_tail(log: &str, max_bytes: usize) -> String {
    if log.len() <= max_bytes {
        return log.to_string();
    }
    // Keep the last `max_bytes` bytes, snapped to a char boundary.
    let start = log.len() - max_bytes;
    let start = (start..log.len())
        .find(|&i| log.is_char_boundary(i))
        .unwrap_or(log.len());
    log[start..].to_string()
}

pub fn platform_string() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

pub fn build_report(input: FeedbackInput, payload: Option<CrashPayload>) -> FeedbackReport {
    FeedbackReport {
        kind: input.kind,
        category: input.category,
        message: input.message,
        email: input.email,
        payload,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: platform_string(),
    }
}

/// Holds a crash payload awaiting an Ask-mode user decision, surfaced to the
/// frontend banner on demand. Registered as Tauri managed state.
#[derive(Default)]
pub struct PendingCrash(pub Mutex<Option<CrashPayload>>);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mode_from_settings_json() {
        let json = r#"{"privacy":{"crashReportMode":"ask"}}"#;
        assert_eq!(parse_crash_report_mode(json), CrashReportMode::Ask);
    }

    #[test]
    fn defaults_to_off_when_missing_or_invalid() {
        assert_eq!(parse_crash_report_mode("{}"), CrashReportMode::Off);
        assert_eq!(parse_crash_report_mode("not json"), CrashReportMode::Off);
        assert_eq!(
            parse_crash_report_mode(r#"{"privacy":{"crashReportMode":"bogus"}}"#),
            CrashReportMode::Off
        );
    }

    #[test]
    fn gates_crash_action_by_mode_and_crash_flag() {
        assert_eq!(
            decide_crash_action(CrashReportMode::Off, true),
            CrashAction::Ignore
        );
        assert_eq!(
            decide_crash_action(CrashReportMode::Ask, true),
            CrashAction::Prompt
        );
        assert_eq!(
            decide_crash_action(CrashReportMode::Auto, true),
            CrashAction::SendSilently
        );
        assert_eq!(
            decide_crash_action(CrashReportMode::Ask, false),
            CrashAction::Ignore
        );
        // A clean launch never reports, regardless of mode.
        assert_eq!(
            decide_crash_action(CrashReportMode::Auto, false),
            CrashAction::Ignore
        );
        assert_eq!(
            decide_crash_action(CrashReportMode::Off, false),
            CrashAction::Ignore
        );
    }

    #[test]
    fn startup_plan_matches_mode() {
        // The startup wiring composes parse + decide; this pins that contract.
        assert_eq!(
            decide_crash_action(
                parse_crash_report_mode(r#"{"privacy":{"crashReportMode":"auto"}}"#),
                true
            ),
            CrashAction::SendSilently
        );
        assert_eq!(
            decide_crash_action(
                parse_crash_report_mode(r#"{"privacy":{"crashReportMode":"ask"}}"#),
                true
            ),
            CrashAction::Prompt
        );
        assert_eq!(
            decide_crash_action(parse_crash_report_mode("{}"), true),
            CrashAction::Ignore
        );
    }

    #[test]
    fn trims_log_tail_to_the_last_max_bytes() {
        let log = "abcdefghij"; // 10 bytes
        assert_eq!(trim_log_tail(log, 4), "ghij");
        assert_eq!(trim_log_tail(log, 100), "abcdefghij");
    }

    #[test]
    fn trims_log_tail_snaps_past_multibyte_char_boundary() {
        // "😀" is 4 bytes; max_bytes=3 lands inside the only char → "" (never a partial char).
        assert_eq!(trim_log_tail("😀", 3), "");
        // "😀🎉" is 8 bytes; max_bytes=5 snaps forward to the next boundary → "🎉".
        assert_eq!(trim_log_tail("😀🎉", 5), "🎉");
    }

    #[test]
    fn platform_string_is_os_dash_arch() {
        let p = platform_string();
        assert!(p.contains('-'));
    }

    #[test]
    fn builds_a_feedback_report_with_version_and_platform() {
        let input = FeedbackInput {
            kind: "feedback".into(),
            category: Some("idea".into()),
            message: Some("hello".into()),
            email: Some("a@b.com".into()),
        };
        let report = build_report(input, None);
        assert_eq!(report.kind, "feedback");
        assert_eq!(report.category.as_deref(), Some("idea"));
        assert_eq!(report.message.as_deref(), Some("hello"));
        assert_eq!(report.payload, None);
        assert!(!report.app_version.is_empty());
        assert!(report.platform.contains('-'));
    }

    #[test]
    fn builds_a_crash_report_with_payload() {
        let input = FeedbackInput {
            kind: "crash".into(),
            category: None,
            message: None,
            email: None,
        };
        let payload = CrashPayload {
            panic: "boom".into(),
            backtrace: "bt".into(),
            log_tail: "log".into(),
        };
        let report = build_report(input, Some(payload.clone()));
        assert_eq!(report.kind, "crash");
        assert_eq!(report.payload, Some(payload));
    }
}
