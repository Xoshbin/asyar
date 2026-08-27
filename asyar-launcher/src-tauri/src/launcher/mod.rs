mod coordinator;

pub(crate) use coordinator::{LauncherAction, LauncherCoordinator};

pub(crate) fn classify_secondary_launch(args: &[String], scheme: &str) -> Option<LauncherAction> {
    if carries_active_deep_link(args, scheme) {
        None
    } else if requests_show(args) {
        Some(LauncherAction::Show)
    } else {
        Some(LauncherAction::Toggle)
    }
}

pub(crate) fn classify_initial_launch(args: &[String], scheme: &str) -> Option<LauncherAction> {
    if carries_active_deep_link(args, scheme) {
        None
    } else if requests_show(args) {
        Some(LauncherAction::Show)
    } else {
        None
    }
}

fn carries_active_deep_link(args: &[String], scheme: &str) -> bool {
    let prefix = format!("{scheme}://");
    args.iter().any(|arg| arg.starts_with(&prefix))
}

fn requests_show(args: &[String]) -> bool {
    args.iter().any(|arg| arg == "--show-on-start")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_secondary_launch_toggles() {
        let args = vec!["asyar".to_string()];
        assert_eq!(
            classify_secondary_launch(&args, "asyar"),
            Some(LauncherAction::Toggle)
        );
    }

    #[test]
    fn explicit_cold_start_shows() {
        let args = vec!["asyar".to_string(), "--show-on-start".to_string()];
        assert_eq!(
            classify_secondary_launch(&args, "asyar"),
            Some(LauncherAction::Show)
        );
        assert_eq!(
            classify_initial_launch(&args, "asyar"),
            Some(LauncherAction::Show)
        );
    }

    #[test]
    fn production_deep_link_has_no_launcher_action() {
        let args = vec![
            "asyar".to_string(),
            "asyar://extensions/example/run".to_string(),
        ];
        assert_eq!(classify_secondary_launch(&args, "asyar"), None);
    }

    #[test]
    fn development_deep_link_has_no_launcher_action() {
        let args = vec![
            "asyar".to_string(),
            "asyar-dev://extensions/example/run".to_string(),
        ];
        assert_eq!(classify_secondary_launch(&args, "asyar-dev"), None);
    }

    #[test]
    fn show_before_production_deep_link_has_no_launcher_action() {
        let args = vec![
            "asyar".to_string(),
            "--show-on-start".to_string(),
            "asyar://extensions/example/run".to_string(),
        ];
        assert_eq!(classify_secondary_launch(&args, "asyar"), None);
        assert_eq!(classify_initial_launch(&args, "asyar"), None);
    }

    #[test]
    fn production_deep_link_before_show_has_no_launcher_action() {
        let args = vec![
            "asyar".to_string(),
            "asyar://extensions/example/run".to_string(),
            "--show-on-start".to_string(),
        ];
        assert_eq!(classify_secondary_launch(&args, "asyar"), None);
        assert_eq!(classify_initial_launch(&args, "asyar"), None);
    }

    #[test]
    fn development_deep_link_takes_precedence_over_show() {
        let args = vec![
            "asyar".to_string(),
            "--show-on-start".to_string(),
            "asyar-dev://extensions/example/run".to_string(),
        ];
        assert_eq!(classify_secondary_launch(&args, "asyar-dev"), None);
        assert_eq!(classify_initial_launch(&args, "asyar-dev"), None);
    }

    #[test]
    fn ordinary_primary_startup_has_no_launcher_action() {
        let args = vec!["asyar".to_string()];
        assert_eq!(classify_initial_launch(&args, "asyar"), None);
    }

    #[test]
    fn unknown_secondary_argument_preserves_toggle_behavior() {
        let args = vec!["asyar".to_string(), "--unknown".to_string()];
        assert_eq!(
            classify_secondary_launch(&args, "asyar"),
            Some(LauncherAction::Toggle)
        );
        assert_eq!(classify_initial_launch(&args, "asyar"), None);
    }

    #[test]
    fn show_with_unknown_argument_still_shows() {
        let args = vec![
            "asyar".to_string(),
            "--show-on-start".to_string(),
            "--unknown".to_string(),
        ];
        assert_eq!(
            classify_secondary_launch(&args, "asyar"),
            Some(LauncherAction::Show)
        );
        assert_eq!(
            classify_initial_launch(&args, "asyar"),
            Some(LauncherAction::Show)
        );
    }
}
