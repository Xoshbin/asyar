use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};

use crate::error::AppError;
use crate::extensions::discovery::read_manifest;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreatedExtensionSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub icon: Option<String>,
    pub path: String,
}

/// Scan `<base>/<dir>/manifest.json` into summaries. Skips non-directories and
/// dirs whose manifest is missing or invalid. Sorted by name (case-insensitive).
/// Missing base dir returns an empty vec.
pub fn scan_created_extensions(base_dir: &Path) -> Vec<CreatedExtensionSummary> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(base_dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        if let Ok(m) = read_manifest(&manifest_path) {
            out.push(CreatedExtensionSummary {
                id: m.id,
                name: m.name,
                version: m.version,
                description: m.description,
                icon: m.icon,
                path: path.to_string_lossy().into_owned(),
            });
        }
    }
    out.sort_by_key(|s| s.name.to_lowercase());
    out
}

/// Case-insensitive substring match over name, id, and description. An empty
/// (or whitespace-only) query returns every item unchanged.
pub fn filter_created_extensions(
    items: Vec<CreatedExtensionSummary>,
    query: &str,
) -> Vec<CreatedExtensionSummary> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return items;
    }
    items
        .into_iter()
        .filter(|s| {
            s.name.to_lowercase().contains(&q)
                || s.id.to_lowercase().contains(&q)
                || s.description.to_lowercase().contains(&q)
        })
        .collect()
}

fn home_extensions_base<R: Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, AppError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| AppError::Other(format!("could not resolve home dir: {e}")))?;
    Ok(home.join("AsyarExtensions"))
}

#[tauri::command]
pub fn list_created_extensions<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<CreatedExtensionSummary>, AppError> {
    Ok(scan_created_extensions(&home_extensions_base(&app)?))
}

/// Scan `$HOME/AsyarExtensions` and return only the entries matching `query`.
/// Filtering lives in Rust (rust-first); the view renders the result verbatim.
#[tauri::command]
pub fn search_created_extensions<R: Runtime>(
    app: AppHandle<R>,
    query: String,
) -> Result<Vec<CreatedExtensionSummary>, AppError> {
    let items = scan_created_extensions(&home_extensions_base(&app)?);
    Ok(filter_created_extensions(items, &query))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_manifest(dir: &Path, json: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("manifest.json"), json).unwrap();
    }

    // Valid manifests must pass read_manifest (which calls validate_manifest).
    // validate_manifest rejects extensions with no commands unless searchable:true
    // or a background bundle is declared. Each test manifest includes one view
    // command with a component so they satisfy the rule.
    const VALID_B: &str = r#"{
        "id": "com.a.bravo",
        "name": "Bravo",
        "version": "1.0.0",
        "description": "b",
        "icon": "⚡",
        "commands": [{"id": "main", "name": "Main", "mode": "view", "component": "MainView"}]
    }"#;

    const VALID_A: &str = r#"{
        "id": "com.a.alpha",
        "name": "Alpha",
        "version": "2.1.0",
        "description": "a",
        "commands": [{"id": "main", "name": "Main", "mode": "view", "component": "MainView"}]
    }"#;

    #[test]
    fn scans_valid_skips_invalid_sorts_by_name() {
        let tmp = std::env::temp_dir().join(format!("asyar-created-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        write_manifest(&tmp.join("bravo"), VALID_B);
        write_manifest(&tmp.join("alpha"), VALID_A);
        write_manifest(&tmp.join("broken"), "{ not json");
        std::fs::create_dir_all(tmp.join("nomanifest")).unwrap();
        std::fs::write(tmp.join("loose.txt"), "x").unwrap();

        let got = scan_created_extensions(&tmp);
        let names: Vec<&str> = got.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["Alpha", "Bravo"]);
        assert_eq!(got[0].id, "com.a.alpha");
        assert_eq!(got[0].icon, None);
        assert_eq!(got[1].icon, Some("⚡".to_string()));
        assert_eq!(
            got[1].path,
            tmp.join("bravo").to_string_lossy().into_owned()
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn missing_base_dir_yields_empty() {
        let missing = std::env::temp_dir().join("asyar-created-does-not-exist-xyz");
        let _ = std::fs::remove_dir_all(&missing);
        assert!(scan_created_extensions(&missing).is_empty());
    }

    fn summary(id: &str, name: &str, desc: &str) -> CreatedExtensionSummary {
        CreatedExtensionSummary {
            id: id.to_string(),
            name: name.to_string(),
            version: "1.0.0".to_string(),
            description: desc.to_string(),
            icon: None,
            path: format!("/x/{name}"),
        }
    }

    #[test]
    fn filter_empty_query_returns_all() {
        let items = vec![summary("com.a.alpha", "Alpha", "first")];
        assert_eq!(filter_created_extensions(items.clone(), ""), items);
        assert_eq!(filter_created_extensions(items.clone(), "   "), items);
    }

    #[test]
    fn filter_matches_name_id_or_description_case_insensitively() {
        let items = vec![
            summary("com.a.alpha", "Alpha", "first"),
            summary("com.a.bravo", "Bravo", "second tool"),
        ];

        let by_name = filter_created_extensions(items.clone(), "BRAVO");
        assert_eq!(
            by_name.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["com.a.bravo"]
        );

        let by_desc = filter_created_extensions(items.clone(), "second");
        assert_eq!(
            by_desc.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["com.a.bravo"]
        );

        let by_id = filter_created_extensions(items.clone(), "com.a.alpha");
        assert_eq!(
            by_id.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["com.a.alpha"]
        );

        assert!(filter_created_extensions(items, "nonexistent").is_empty());
    }
}
