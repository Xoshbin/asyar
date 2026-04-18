//! Pure validation for the `StatusBarItem` tree sent by extensions.
//!
//! Enforces the structural invariants the SDK proxy also enforces client-side
//! (defense in depth). Returns `AppError::Validation` on the first violation.

use crate::error::AppError;
use crate::extension_tray::item::StatusBarItem;

/// Maximum submenu nesting depth. A top-level item is depth 1; each submenu
/// level adds one. `4` means top-level plus three levels of submenus.
pub const MAX_DEPTH: usize = 4;

/// Validate a top-level item registered by an extension. The item itself is
/// treated as depth 1; `submenu` children are validated against the nested
/// rules (separator / checked / enabled / depth).
pub fn validate_top_level(item: &StatusBarItem) -> Result<(), AppError> {
    if item.id.trim().is_empty() {
        return Err(AppError::Validation(
            "Status-bar item id must not be empty".into(),
        ));
    }

    if item.separator == Some(true) {
        return Err(AppError::Validation(
            "Top-level status-bar items cannot be separators".into(),
        ));
    }
    if item.checked.is_some() {
        return Err(AppError::Validation(
            "Top-level status-bar items cannot have a checked state".into(),
        ));
    }
    if item.enabled == Some(false) {
        return Err(AppError::Validation(
            "Top-level status-bar items cannot be disabled".into(),
        ));
    }

    let has_icon = item.icon.as_deref().is_some_and(|s| !s.is_empty())
        || item.icon_path.as_deref().is_some_and(|s| !s.is_empty());
    if !has_icon {
        return Err(AppError::Validation(format!(
            "Top-level status-bar item '{}' must provide `icon` or `iconPath`",
            item.id
        )));
    }

    if let Some(children) = &item.submenu {
        validate_siblings(children, 2)?;
    }

    Ok(())
}

fn validate_siblings(items: &[StatusBarItem], depth: usize) -> Result<(), AppError> {
    if depth > MAX_DEPTH {
        return Err(AppError::Validation(format!(
            "Status-bar submenu nested deeper than max depth {MAX_DEPTH}"
        )));
    }
    let mut seen_ids: Vec<&str> = Vec::with_capacity(items.len());
    for child in items {
        validate_child(child, depth)?;
        if child.separator != Some(true) {
            if child.id.trim().is_empty() {
                return Err(AppError::Validation(
                    "Submenu item id must not be empty".into(),
                ));
            }
            if seen_ids.contains(&child.id.as_str()) {
                return Err(AppError::Validation(format!(
                    "Duplicate sibling id '{}' inside submenu",
                    child.id
                )));
            }
            seen_ids.push(child.id.as_str());
        }
    }
    Ok(())
}

fn validate_child(item: &StatusBarItem, depth: usize) -> Result<(), AppError> {
    if item.separator == Some(true) {
        if item.submenu.is_some() {
            return Err(AppError::Validation(
                "Separator rows cannot have a submenu".into(),
            ));
        }
        if item.checked.is_some() {
            return Err(AppError::Validation(
                "Separator rows cannot be checkable".into(),
            ));
        }
        return Ok(());
    }

    if let Some(children) = &item.submenu {
        validate_siblings(children, depth + 1)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn top_with_icon(id: &str) -> StatusBarItem {
        StatusBarItem {
            id: id.to_string(),
            icon: Some("🍅".into()),
            ..StatusBarItem::leaf(id, "text")
        }
    }

    #[test]
    fn top_level_with_icon_only_ok() {
        validate_top_level(&top_with_icon("t1")).unwrap();
    }

    #[test]
    fn top_level_with_icon_path_only_ok() {
        let mut item = StatusBarItem::leaf("t1", "text");
        item.icon_path = Some("asyar-extension://ext/x.png".into());
        validate_top_level(&item).unwrap();
    }

    #[test]
    fn top_level_without_any_icon_rejected() {
        let item = StatusBarItem::leaf("t1", "text");
        let err = validate_top_level(&item).unwrap_err();
        assert!(err.to_string().contains("icon"));
    }

    #[test]
    fn top_level_with_empty_strings_still_rejected() {
        let mut item = StatusBarItem::leaf("t1", "text");
        item.icon = Some(String::new());
        item.icon_path = Some(String::new());
        let err = validate_top_level(&item).unwrap_err();
        assert!(err.to_string().contains("icon"));
    }

    #[test]
    fn top_level_separator_rejected() {
        let mut item = top_with_icon("t1");
        item.separator = Some(true);
        let err = validate_top_level(&item).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("separator"));
    }

    #[test]
    fn top_level_checked_rejected() {
        let mut item = top_with_icon("t1");
        item.checked = Some(true);
        let err = validate_top_level(&item).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("checked"));
    }

    #[test]
    fn top_level_disabled_rejected() {
        let mut item = top_with_icon("t1");
        item.enabled = Some(false);
        let err = validate_top_level(&item).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("disabled"));
    }

    #[test]
    fn top_level_empty_id_rejected() {
        let mut item = top_with_icon("x");
        item.id = "  ".into();
        let err = validate_top_level(&item).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("id"));
    }

    #[test]
    fn child_separator_in_submenu_ok() {
        let mut top = top_with_icon("t1");
        let sep = StatusBarItem {
            separator: Some(true),
            ..StatusBarItem::leaf("sep", "")
        };
        top.submenu = Some(vec![sep]);
        validate_top_level(&top).unwrap();
    }

    #[test]
    fn child_checked_and_disabled_ok() {
        let mut top = top_with_icon("t1");
        let mut child = StatusBarItem::leaf("c1", "Play");
        child.checked = Some(true);
        child.enabled = Some(false);
        top.submenu = Some(vec![child]);
        validate_top_level(&top).unwrap();
    }

    #[test]
    fn duplicate_sibling_ids_rejected() {
        let mut top = top_with_icon("t1");
        top.submenu = Some(vec![
            StatusBarItem::leaf("dup", "A"),
            StatusBarItem::leaf("dup", "B"),
        ]);
        let err = validate_top_level(&top).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("duplicate"));
    }

    #[test]
    fn duplicate_ids_across_siblings_ignore_separators() {
        let mut top = top_with_icon("t1");
        top.submenu = Some(vec![
            StatusBarItem::leaf("a", "A"),
            StatusBarItem {
                separator: Some(true),
                ..StatusBarItem::leaf("", "")
            },
            StatusBarItem::leaf("b", "B"),
        ]);
        validate_top_level(&top).unwrap();
    }

    #[test]
    fn depth_four_accepted() {
        let deep = StatusBarItem {
            submenu: Some(vec![StatusBarItem::leaf("l4", "L4")]),
            ..StatusBarItem::leaf("l3", "L3")
        };
        let level2 = StatusBarItem {
            submenu: Some(vec![deep]),
            ..StatusBarItem::leaf("l2", "L2")
        };
        let mut top = top_with_icon("t1");
        top.submenu = Some(vec![level2]);
        validate_top_level(&top).unwrap();
    }

    #[test]
    fn depth_five_rejected() {
        let deepest = StatusBarItem {
            submenu: Some(vec![StatusBarItem::leaf("l5", "L5")]),
            ..StatusBarItem::leaf("l4", "L4")
        };
        let level3 = StatusBarItem {
            submenu: Some(vec![deepest]),
            ..StatusBarItem::leaf("l3", "L3")
        };
        let level2 = StatusBarItem {
            submenu: Some(vec![level3]),
            ..StatusBarItem::leaf("l2", "L2")
        };
        let mut top = top_with_icon("t1");
        top.submenu = Some(vec![level2]);
        let err = validate_top_level(&top).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("depth"));
    }

    #[test]
    fn empty_child_id_on_non_separator_rejected() {
        let mut top = top_with_icon("t1");
        top.submenu = Some(vec![StatusBarItem::leaf("", "bad")]);
        let err = validate_top_level(&top).unwrap_err();
        assert!(err.to_string().to_lowercase().contains("id"));
    }
}
