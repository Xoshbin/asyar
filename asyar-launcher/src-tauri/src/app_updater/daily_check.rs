use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const FIRST_CHECK_TODAY_HEADER: &str = "X-First-Check-Today";
pub const FIRST_INSTALL_CHECK_HEADER: &str = "X-First-Install-Check";
pub const OS_VERSION_HEADER: &str = "X-OS-Version";

const STATE_FILE_NAME: &str = "update_check_state.json";

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct DailyCheckState {
    pub last_check_date: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CheckFlags {
    pub first_check_today: bool,
    pub first_install_check: bool,
}

pub fn today_local_date() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

pub fn state_path_for_dir(dir: &Path) -> PathBuf {
    dir.join(STATE_FILE_NAME)
}

/// Inspect the local update-check state without mutating it.
/// No persistent ID is ever stored or read — only the last local date string.
pub fn flags_for_dir(dir: &Path, today: &str) -> CheckFlags {
    let path = state_path_for_dir(dir);
    if !path.exists() {
        return CheckFlags {
            first_check_today: true,
            first_install_check: true,
        };
    }

    let Ok(content) = std::fs::read_to_string(&path) else {
        return CheckFlags {
            first_check_today: true,
            first_install_check: false,
        };
    };

    match serde_json::from_str::<DailyCheckState>(&content) {
        Ok(state) => CheckFlags {
            first_check_today: state.last_check_date != today,
            first_install_check: false,
        },
        Err(_) => CheckFlags {
            first_check_today: true,
            first_install_check: false,
        },
    }
}

pub fn mark_checked_in_dir(dir: &Path, today: &str) -> Result<(), String> {
    let path = state_path_for_dir(dir);
    let state = DailyCheckState {
        last_check_date: today.to_string(),
    };
    let content =
        serde_json::to_string(&state).map_err(|e| format!("serialize daily_check: {e}"))?;
    std::fs::create_dir_all(dir).map_err(|e| format!("create_dir_all for daily_check: {e}"))?;
    std::fs::write(path, content).map_err(|e| format!("write daily_check: {e}"))
}

pub fn flags_for_today(app: &AppHandle, today: &str) -> CheckFlags {
    match app.path().app_data_dir() {
        Ok(dir) => flags_for_dir(&dir, today),
        Err(_) => CheckFlags {
            first_check_today: false,
            first_install_check: false,
        },
    }
}

pub fn mark_checked_today(app: &AppHandle, today: &str) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    mark_checked_in_dir(&dir, today)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn missing_state_file_marks_first_today_and_first_install() {
        let tmp = TempDir::new().unwrap();
        let flags = flags_for_dir(tmp.path(), "2026-11-20");
        assert_eq!(
            flags,
            CheckFlags {
                first_check_today: true,
                first_install_check: true,
            }
        );
    }

    #[test]
    fn mark_checked_suppresses_repeat_same_day() {
        let tmp = TempDir::new().unwrap();
        mark_checked_in_dir(tmp.path(), "2026-11-20").unwrap();

        let same_day = flags_for_dir(tmp.path(), "2026-11-20");
        assert_eq!(
            same_day,
            CheckFlags {
                first_check_today: false,
                first_install_check: false,
            }
        );
    }

    #[test]
    fn next_day_marks_first_today_but_not_first_install() {
        let tmp = TempDir::new().unwrap();
        mark_checked_in_dir(tmp.path(), "2026-11-20").unwrap();

        let next_day = flags_for_dir(tmp.path(), "2026-11-21");
        assert_eq!(
            next_day,
            CheckFlags {
                first_check_today: true,
                first_install_check: false,
            }
        );
    }

    #[test]
    fn corrupt_state_file_recovers_as_first_today_only() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(state_path_for_dir(tmp.path()), "{not-json").unwrap();

        let flags = flags_for_dir(tmp.path(), "2026-11-20");
        assert_eq!(
            flags,
            CheckFlags {
                first_check_today: true,
                first_install_check: false,
            }
        );
    }
}
