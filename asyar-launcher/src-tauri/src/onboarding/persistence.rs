use serde_json::{json, Value};

/// Returns true if onboarding has been completed.
/// Same fail-soft pattern as `parse_launch_view`: missing/malformed → false.
pub fn parse_onboarding_completed(settings: &Value) -> bool {
    settings
        .get("onboarding")
        .and_then(|o| o.get("completed"))
        .and_then(|c| c.as_bool())
        .unwrap_or(false)
}

/// Returns the input value with `onboarding.completed` set to `completed`.
/// Creates the `onboarding` object if it doesn't exist.
pub fn set_onboarding_completed(mut settings: Value, completed: bool) -> Value {
    if !settings.is_object() {
        settings = json!({});
    }
    let obj = settings.as_object_mut().expect("settings must be object");
    let onboarding = obj
        .entry("onboarding".to_string())
        .or_insert_with(|| json!({}));
    if !onboarding.is_object() {
        *onboarding = json!({});
    }
    onboarding
        .as_object_mut()
        .expect("onboarding must be object")
        .insert("completed".to_string(), json!(completed));
    settings
}

/// Reads `settings.onboarding.completed` from `settings.dat`.
/// Mirrors the same call pattern as `read_launch_view` in `lib.rs`.
/// Returns `false` on any store or parse failure (fail-soft).
pub fn read_onboarding_completed(app: &tauri::AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store("settings.dat") else {
        return false;
    };
    let value = store
        .get("settings")
        .unwrap_or_else(|| serde_json::json!({}));
    parse_onboarding_completed(&value)
}

/// Reads `settings.appearance.launchView` from `settings.dat`. Returns
/// `"compact"` only when the persisted value is exactly that; any other
/// shape or value (or store failure) yields `"default"`.
pub fn read_launch_view(app: &tauri::AppHandle) -> &'static str {
    use tauri_plugin_store::StoreExt;
    let Ok(store) = app.store("settings.dat") else {
        return "default";
    };
    let value = store
        .get("settings")
        .unwrap_or_else(|| serde_json::json!({}));
    let is_compact = value
        .get("appearance")
        .and_then(|a| a.get("launchView"))
        .and_then(|v| v.as_str())
        == Some("compact");
    if is_compact {
        "compact"
    } else {
        "default"
    }
}

/// Reads `settings.appearance.activeTheme` from `settings.dat`. Returns
/// `Some(themeId)` if a non-empty string is set, `None` otherwise.
pub fn read_active_theme(app: &tauri::AppHandle) -> Option<String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("settings.dat").ok()?;
    let value = store.get("settings")?;
    value
        .get("appearance")?
        .get("activeTheme")?
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Writes `settings.onboarding.completed` to `settings.dat`.
/// Reads current settings, merges the new value, and saves.
pub fn write_onboarding_completed(
    app: &tauri::AppHandle,
    completed: bool,
) -> Result<(), crate::error::AppError> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store("settings.dat")
        .map_err(|e| crate::error::AppError::Other(format!("store: {}", e)))?;
    let current = store
        .get("settings")
        .unwrap_or_else(|| serde_json::json!({}));
    let updated = set_onboarding_completed(current, completed);
    store.set("settings", updated);
    store
        .save()
        .map_err(|e| crate::error::AppError::Other(format!("store save: {}", e)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_section_returns_false() {
        assert!(!parse_onboarding_completed(&json!({})));
    }

    #[test]
    fn missing_completed_returns_false() {
        assert!(!parse_onboarding_completed(&json!({ "onboarding": {} })));
    }

    #[test]
    fn non_bool_completed_returns_false() {
        assert!(!parse_onboarding_completed(
            &json!({ "onboarding": { "completed": "yes" } })
        ));
    }

    #[test]
    fn true_completed_returns_true() {
        assert!(parse_onboarding_completed(
            &json!({ "onboarding": { "completed": true } })
        ));
    }

    #[test]
    fn set_creates_section_when_missing() {
        let updated = set_onboarding_completed(json!({}), true);
        assert_eq!(updated["onboarding"]["completed"], json!(true));
    }

    #[test]
    fn set_overwrites_existing_value() {
        let updated = set_onboarding_completed(
            json!({ "onboarding": { "completed": false } }),
            true,
        );
        assert_eq!(updated["onboarding"]["completed"], json!(true));
    }

    #[test]
    fn set_preserves_other_top_level_keys() {
        let updated = set_onboarding_completed(
            json!({ "appearance": { "launchView": "compact" } }),
            true,
        );
        assert_eq!(updated["appearance"]["launchView"], json!("compact"));
        assert_eq!(updated["onboarding"]["completed"], json!(true));
    }

    #[test]
    fn read_returns_false_when_settings_dat_missing_path() {
        // Pure unit: parse_* covers parsing; this is the anchor for the
        // Tauri-Store-backed reader added below. Reader/writer themselves
        // are exercised via manual smoke (see Task 18) — there's no easy
        // unit harness for the Store plugin without a Tauri AppHandle.
        assert!(!parse_onboarding_completed(&serde_json::json!({})));
    }
}
