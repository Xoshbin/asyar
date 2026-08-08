//! Thin command wrappers for the walkthrough module. Every one of these
//! delegates straight to `crate::walkthrough::service`; no logic here.

use crate::error::AppError;
use crate::storage::DataStore;
use crate::usage::UsageState;
use crate::walkthrough::registry::WalkthroughState;
use crate::walkthrough::rules::Probes;
use crate::walkthrough::service::{self, WalkthroughSnapshot};
use crate::walkthrough::{WalkthroughTask, WalkthroughTaskDecl};
use std::sync::Arc;
use tauri::State;

/// One extension's contribution, as collected by the frontend from the
/// manifest it already parsed.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkthroughContribution {
    pub extension_id: String,
    pub tasks: Vec<WalkthroughTaskDecl>,
}

fn qualify_all(contributions: Vec<WalkthroughContribution>) -> Vec<WalkthroughTask> {
    contributions
        .into_iter()
        .flat_map(|c| {
            c.tasks
                .iter()
                .map(|t| t.qualify(&c.extension_id))
                .collect::<Vec<_>>()
        })
        .collect()
}

#[tauri::command]
pub async fn sync_walkthrough_tasks(
    contributions: Vec<WalkthroughContribution>,
    probes: Probes,
    data: State<'_, DataStore>,
    usage: State<'_, Arc<UsageState>>,
    walkthrough: State<'_, Arc<WalkthroughState>>,
) -> Result<WalkthroughSnapshot, AppError> {
    service::sync(
        &data,
        &usage,
        &walkthrough,
        qualify_all(contributions),
        probes,
    )
}

#[tauri::command]
pub async fn get_walkthrough(
    data: State<'_, DataStore>,
    usage: State<'_, Arc<UsageState>>,
    walkthrough: State<'_, Arc<WalkthroughState>>,
) -> Result<WalkthroughSnapshot, AppError> {
    service::snapshot(&data, &usage, &walkthrough)
}

#[tauri::command]
pub async fn complete_walkthrough_task(
    task_id: String,
    data: State<'_, DataStore>,
    usage: State<'_, Arc<UsageState>>,
    walkthrough: State<'_, Arc<WalkthroughState>>,
) -> Result<WalkthroughSnapshot, AppError> {
    service::complete_manually(&data, &usage, &walkthrough, &task_id)
}

#[tauri::command]
pub async fn uncomplete_walkthrough_task(
    task_id: String,
    data: State<'_, DataStore>,
    usage: State<'_, Arc<UsageState>>,
    walkthrough: State<'_, Arc<WalkthroughState>>,
) -> Result<WalkthroughSnapshot, AppError> {
    service::uncomplete(&data, &usage, &walkthrough, &task_id)
}

#[tauri::command]
pub async fn complete_all_walkthrough_tasks(
    data: State<'_, DataStore>,
    usage: State<'_, Arc<UsageState>>,
    walkthrough: State<'_, Arc<WalkthroughState>>,
) -> Result<WalkthroughSnapshot, AppError> {
    service::complete_all(&data, &usage, &walkthrough)
}

#[tauri::command]
pub async fn set_walkthrough_dismissed(
    dismissed: bool,
    data: State<'_, DataStore>,
    usage: State<'_, Arc<UsageState>>,
    walkthrough: State<'_, Arc<WalkthroughState>>,
) -> Result<WalkthroughSnapshot, AppError> {
    service::set_dismissed(&data, &usage, &walkthrough, dismissed)
}

#[tauri::command]
pub async fn reset_walkthrough(
    data: State<'_, DataStore>,
    usage: State<'_, Arc<UsageState>>,
    walkthrough: State<'_, Arc<WalkthroughState>>,
) -> Result<WalkthroughSnapshot, AppError> {
    service::reset(&data, &usage, &walkthrough)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::walkthrough::CompletionRule;

    fn decl(id: &str) -> WalkthroughTaskDecl {
        WalkthroughTaskDecl {
            id: id.into(),
            title: "T".into(),
            summary: String::new(),
            body: String::new(),
            icon: None,
            image: None,
            order: 0,
            completion: CompletionRule::Manual,
        }
    }

    #[test]
    fn qualify_all_namespaces_every_contribution() {
        let qualified = qualify_all(vec![
            WalkthroughContribution {
                extension_id: "org.asyar.a".into(),
                tasks: vec![decl("one"), decl("two")],
            },
            WalkthroughContribution {
                extension_id: "org.asyar.b".into(),
                tasks: vec![decl("one")],
            },
        ]);

        let ids: Vec<&str> = qualified.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "wt_org.asyar.a_one",
                "wt_org.asyar.a_two",
                "wt_org.asyar.b_one",
            ]
        );
    }

    #[test]
    fn qualify_all_of_nothing_is_empty() {
        assert!(qualify_all(vec![]).is_empty());
        assert!(qualify_all(vec![WalkthroughContribution {
            extension_id: "org.asyar.a".into(),
            tasks: vec![],
        }])
        .is_empty());
    }

    #[test]
    fn contribution_parses_the_frontend_wire_shape() {
        let json = r#"{"extensionId":"org.asyar.a","tasks":[{"id":"x","title":"X","completion":{"type":"manual"}}]}"#;
        let c: WalkthroughContribution = serde_json::from_str(json).unwrap();
        assert_eq!(c.extension_id, "org.asyar.a");
        assert_eq!(c.tasks.len(), 1);
        assert_eq!(c.tasks[0].id, "x");
    }
}
