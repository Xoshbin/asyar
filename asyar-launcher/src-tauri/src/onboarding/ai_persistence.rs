use serde_json::{json, Value};

/// Returns true if AI onboarding has been completed.
/// Same fail-soft pattern as `parse_onboarding_completed`: missing/malformed → false.
pub fn parse_ai_onboarding_completed(settings: &Value) -> bool {
    settings
        .get("onboarding")
        .and_then(|o| o.get("aiCompleted"))
        .and_then(|c| c.as_bool())
        .unwrap_or(false)
}

/// Returns the input value with `onboarding.aiCompleted` set to `completed`.
/// Creates the `onboarding` object if it doesn't exist.
pub fn set_ai_onboarding_completed(mut settings: Value, completed: bool) -> Value {
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
        .insert("aiCompleted".to_string(), json!(completed));
    settings
}

/// Reads `settings.onboarding.aiCompleted` from `settings.dat`.
/// Returns `false` on any store or parse failure (fail-soft).
pub fn read_ai_onboarding_completed(
    app: &tauri::AppHandle,
) -> Result<bool, crate::error::AppError> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store("settings.dat")
        .map_err(|e| crate::error::AppError::Other(format!("store: {}", e)))?;
    let value = store
        .get("settings")
        .unwrap_or_else(|| serde_json::json!({}));
    Ok(parse_ai_onboarding_completed(&value))
}

/// Writes `settings.onboarding.aiCompleted` to `settings.dat`.
/// Reads current settings, merges the new value, and saves.
pub fn write_ai_onboarding_completed(
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
    let updated = set_ai_onboarding_completed(current, completed);
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
    fn parse_missing_section_returns_false() {
        assert!(!parse_ai_onboarding_completed(&json!({})));
    }

    #[test]
    fn parse_missing_field_returns_false() {
        assert!(!parse_ai_onboarding_completed(&json!({ "onboarding": {} })));
    }

    #[test]
    fn parse_non_bool_returns_false() {
        assert!(!parse_ai_onboarding_completed(
            &json!({ "onboarding": { "aiCompleted": "yes" } })
        ));
    }

    #[test]
    fn parse_true_returns_true() {
        assert!(parse_ai_onboarding_completed(
            &json!({ "onboarding": { "aiCompleted": true } })
        ));
    }

    #[test]
    fn parse_false_returns_false() {
        assert!(!parse_ai_onboarding_completed(
            &json!({ "onboarding": { "aiCompleted": false } })
        ));
    }

    #[test]
    fn set_in_empty_value_creates_section() {
        let updated = set_ai_onboarding_completed(json!({}), true);
        assert_eq!(updated["onboarding"]["aiCompleted"], json!(true));
    }

    #[test]
    fn set_overwrites_existing_field() {
        let updated =
            set_ai_onboarding_completed(json!({ "onboarding": { "aiCompleted": false } }), true);
        assert_eq!(updated["onboarding"]["aiCompleted"], json!(true));
    }

    #[test]
    fn set_preserves_other_onboarding_keys() {
        let updated =
            set_ai_onboarding_completed(json!({ "onboarding": { "completed": true } }), true);
        assert_eq!(updated["onboarding"]["aiCompleted"], json!(true));
        assert_eq!(updated["onboarding"]["completed"], json!(true));
    }
}
