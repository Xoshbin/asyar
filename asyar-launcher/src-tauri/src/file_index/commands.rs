//! Thin Tauri command wrappers. All logic lives in `service.rs`,
//! `query.rs`, and `storage::file_search_{selections,pinned}` — commands
//! only extract state, delegate, and map errors, matching the pattern
//! `search_engine::commands` already uses.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::storage::{file_search_pinned, file_search_selections, DataStore};

use super::deep;
use super::file_id;
use super::query::QueryOptions;
use super::ranking::now_seconds;
use super::service::FileIndexState;
use super::snapshot::SNAPSHOT_FILE_NAME;
use super::types::{
    FileHit, FileIndexConfig, FileSearchResponse, FileType, HitSource, IndexStateKind, IndexStatus,
};
use super::walker::HARD_CAP;
use super::watcher::{self, FileIndexWatcherHandle};

pub fn managed_file_index_state<'a, R: tauri::Runtime>(
    app: &'a impl Manager<R>,
) -> tauri::State<'a, Arc<FileIndexState>> {
    app.state::<Arc<FileIndexState>>()
}

#[tauri::command]
pub async fn file_search(
    query: String,
    type_filter: Option<String>,
    limit: Option<u32>,
    state: State<'_, Arc<FileIndexState>>,
) -> Result<FileSearchResponse, String> {
    let opts = QueryOptions {
        type_filter: type_filter.as_deref().and_then(FileType::parse_filter),
        limit: limit.unwrap_or(0) as usize,
        include_hidden: false,
    };
    Ok(state.search(&query, &opts, now_seconds()))
}

#[tauri::command]
pub async fn file_index_status(
    state: State<'_, Arc<FileIndexState>>,
) -> Result<IndexStatus, String> {
    Ok(state.status())
}

/// Resolves the scan roots for a config: user-configured `includeRoots`,
/// or `$HOME` when empty (the default coverage the user chose: whole home
/// minus the built-in exclusions, not a curated folder list).
fn resolve_roots<R: tauri::Runtime>(app: &AppHandle<R>, config: &FileIndexConfig) -> Vec<PathBuf> {
    if !config.include_roots.is_empty() {
        return config.include_roots.iter().map(PathBuf::from).collect();
    }
    app.path().home_dir().map(|h| vec![h]).unwrap_or_default()
}

fn snapshot_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(SNAPSHOT_FILE_NAME))
}

/// Full walker scan + snapshot persist, both off the async thread. Returns
/// the roots and excludes it scanned so `spawn_rebuild` can re-arm the
/// watcher over the same set. Callers check `config().enabled` first.
async fn run_scan_and_snapshot(
    app: &AppHandle,
    state: &Arc<FileIndexState>,
) -> (Vec<PathBuf>, Vec<String>) {
    let cfg = state.config();
    let roots = resolve_roots(app, &cfg);
    let excludes = cfg.exclude_patterns.clone();
    let now = now_seconds();

    let scan_state = state.clone();
    let scan_roots = roots.clone();
    let scan_excludes = excludes.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        scan_state.run_full_scan(scan_roots, scan_excludes, HARD_CAP, now)
    })
    .await;

    if let Some(path) = snapshot_path(app) {
        let save_state = state.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || save_state.save_snapshot(&path)).await;
    }

    (roots, excludes)
}

/// Runs a full rescan off the calling task, saves a snapshot, re-arms the
/// watcher over the new roots, and emits the resulting status. Spawned
/// so the triggering command (`file_index_rebuild` /
/// `file_index_set_config`) returns immediately — a full-`$HOME` walk can
/// take seconds, and the caller (Settings UI, app startup) must not block
/// on it.
///
/// The status flip to `Rescanning` + its status event happen synchronously
/// in the caller (`file_index_rebuild`/`file_index_set_config`), *before*
/// this spawn — otherwise the UI is left showing stale `Ready` data with
/// no indication anything is happening until the scan silently finishes,
/// possibly many seconds later.
fn spawn_rebuild(app: AppHandle, state: Arc<FileIndexState>) {
    tauri::async_runtime::spawn(async move {
        if !state.config().enabled {
            return;
        }
        let (roots, excludes) = run_scan_and_snapshot(&app, &state).await;

        if let Some(handle) = app.try_state::<Arc<FileIndexWatcherHandle>>() {
            let exclusions = watcher::build_exclusion_set(&excludes);
            let on_rescan = make_on_rescan(app.clone(), state.clone());
            handle.rearm(roots, exclusions, state.clone(), on_rescan);
        }

        let _ = app.emit("asyar:file-index-status", state.status());
    });
}

/// Rescan without re-arming: the watcher stays on its current roots. Used
/// to answer the watcher's degraded-window signal, where the roots didn't
/// change — only the index's freshness is in doubt.
fn spawn_rescan(app: AppHandle, state: Arc<FileIndexState>) {
    tauri::async_runtime::spawn(async move {
        if !state.config().enabled {
            return;
        }
        run_scan_and_snapshot(&app, &state).await;
        let _ = app.emit("asyar:file-index-status", state.status());
    });
}

/// `true` when a watcher rescan signal should start a scan now. `Building`
/// and `Rescanning` mean one is already running (stacking a second wastes
/// a full walk); `Disabled` means never.
fn should_start_rescan(state: IndexStateKind) -> bool {
    matches!(state, IndexStateKind::Ready | IndexStateKind::CapReached)
}

/// Handler for the watcher's rescan signal (kernel dropped events, or the
/// coalescer's overflow valve tripped): the index may have missed changes,
/// so answer with the same bounded, exclusion-aware scan a manual rebuild
/// runs — never the watcher-library's unbounded cache walk this replaced.
pub(crate) fn make_on_rescan(
    app: AppHandle,
    state: Arc<FileIndexState>,
) -> impl Fn() + Send + 'static {
    move || {
        if !should_start_rescan(state.status().state) {
            return;
        }
        state.mark_rescanning();
        let _ = app.emit("asyar:file-index-status", state.status());
        spawn_rescan(app.clone(), state.clone());
    }
}

#[tauri::command]
pub async fn file_index_rebuild(
    app: AppHandle,
    state: State<'_, Arc<FileIndexState>>,
) -> Result<(), String> {
    state.mark_rescanning();
    let _ = app.emit("asyar:file-index-status", state.status());
    spawn_rebuild(app, state.inner().clone());
    Ok(())
}

/// Applies a settings change. A root/exclude edit or a disabled→enabled
/// transition triggers a background rebuild; disabling drops the index
/// immediately (via `set_enabled`) and stops the watcher.
#[tauri::command]
pub async fn file_index_set_config(
    config: FileIndexConfig,
    app: AppHandle,
    state: State<'_, Arc<FileIndexState>>,
) -> Result<(), String> {
    let was_enabled = state.config().enabled;
    let roots_changed = state.update_roots_and_excludes(
        config.include_roots.clone(),
        config.exclude_patterns.clone(),
    );
    state.set_enabled(config.enabled);

    if config.enabled && (roots_changed || !was_enabled) {
        state.mark_rescanning();
        let _ = app.emit("asyar:file-index-status", state.status());
        spawn_rebuild(app, state.inner().clone());
    } else if !config.enabled {
        if let Some(handle) = app.try_state::<Arc<FileIndexWatcherHandle>>() {
            handle.rearm(
                Vec::new(),
                watcher::build_exclusion_set(&[]),
                state.inner().clone(),
                || {},
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn file_search_record_selection(
    query: String,
    file_id: String,
    state: State<'_, Arc<FileIndexState>>,
    store: State<'_, DataStore>,
) -> Result<(), String> {
    let now = now_seconds();
    let conn = store.conn().map_err(|e| e.to_string())?;
    file_search_selections::record_selection(&conn, &query, &file_id, now)
        .map_err(|e| e.to_string())?;
    if let Some(id) = file_id::from_hex(&file_id) {
        state.record_selection_in_memory(&query, id, now);
    }
    Ok(())
}

#[tauri::command]
pub async fn file_search_pin(
    file_id: String,
    path: String,
    state: State<'_, Arc<FileIndexState>>,
    store: State<'_, DataStore>,
) -> Result<(), String> {
    let conn = store.conn().map_err(|e| e.to_string())?;
    file_search_pinned::pin(&conn, &file_id, &path, now_seconds()).map_err(|e| e.to_string())?;
    if let Some(id) = file_id::from_hex(&file_id) {
        state.set_pinned_in_memory(id, true);
    }
    Ok(())
}

#[tauri::command]
pub async fn file_search_unpin(
    file_id: String,
    state: State<'_, Arc<FileIndexState>>,
    store: State<'_, DataStore>,
) -> Result<(), String> {
    let conn = store.conn().map_err(|e| e.to_string())?;
    file_search_pinned::unpin(&conn, &file_id).map_err(|e| e.to_string())?;
    if let Some(id) = file_id::from_hex(&file_id) {
        state.set_pinned_in_memory(id, false);
    }
    Ok(())
}

#[tauri::command]
pub async fn file_search_list_pinned(store: State<'_, DataStore>) -> Result<Vec<FileHit>, String> {
    let conn = store.conn().map_err(|e| e.to_string())?;
    let rows = file_search_pinned::list(&conn).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let name = std::path::Path::new(&r.path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| r.path.clone());
            let file_type = std::path::Path::new(&r.path)
                .extension()
                .map(|e| FileType::from_extension(&e.to_string_lossy()))
                .unwrap_or(FileType::Other);
            FileHit {
                file_id: r.file_id,
                name,
                path: r.path,
                file_type,
                is_dir: false,
                modified_at: r.pinned_at,
                score: 0.0,
                pinned: true,
                source: HitSource::Local,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn file_search_clear_history(
    state: State<'_, Arc<FileIndexState>>,
    store: State<'_, DataStore>,
) -> Result<(), String> {
    let conn = store.conn().map_err(|e| e.to_string())?;
    file_search_selections::clear_all(&conn).map_err(|e| e.to_string())?;
    state.clear_learning_in_memory();
    Ok(())
}

#[tauri::command]
pub async fn deep_search_availability() -> Result<Option<String>, String> {
    Ok(deep::provider_for_platform().map(|p| p.id().to_string()))
}

#[tauri::command]
pub async fn deep_search(query: String, limit: Option<u32>) -> Result<Vec<FileHit>, String> {
    let Some(provider) = deep::provider_for_platform() else {
        return Ok(Vec::new());
    };
    let limit = limit.unwrap_or(50) as usize;
    let paths = tauri::async_runtime::spawn_blocking(move || provider.search(&query, limit))
        .await
        .map_err(|e| e.to_string())?;

    Ok(paths
        .into_iter()
        .filter_map(|path| {
            let meta = std::fs::metadata(&path).ok()?;
            let name = path.file_name()?.to_string_lossy().into_owned();
            let ext = path.extension().map(|e| e.to_string_lossy().into_owned());
            let file_type = if meta.is_dir() {
                FileType::Folder
            } else {
                FileType::from_extension(ext.as_deref().unwrap_or(""))
            };
            let modified_at = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            Some(FileHit {
                file_id: file_id::to_hex(file_id::derive_u64(&path)),
                name,
                path: path.to_string_lossy().into_owned(),
                file_type,
                is_dir: meta.is_dir(),
                modified_at,
                score: 0.0,
                pinned: false,
                source: HitSource::Deep,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_index::index::{FileIndex, ScannedEntry};
    use crate::file_index::types::EntryKind;
    use crate::storage::create_test_store;
    use tauri::Manager;

    const NOW: i64 = 100_000_000;

    fn mock_app_with_state(index: FileIndex) -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Arc::new(FileIndexState::with_index(
            FileIndexConfig::default(),
            index,
        )));
        app.manage(create_test_store());
        app
    }

    fn built(paths: &[&str]) -> FileIndex {
        let items = paths
            .iter()
            .map(|p| ScannedEntry {
                path: PathBuf::from(p),
                kind: EntryKind::File,
                mtime: NOW as u32,
                hidden: false,
                placeholder: false,
            })
            .collect();
        FileIndex::build(vec![PathBuf::from("/r")], items, NOW)
    }

    #[test]
    fn resolve_roots_falls_back_to_home_when_empty() {
        let app = mock_app_with_state(FileIndex::empty());
        let roots = resolve_roots(app.handle(), &FileIndexConfig::default());
        assert_eq!(roots.len(), 1, "empty includeRoots ⇒ single $HOME root");
    }

    #[test]
    fn resolve_roots_uses_configured_roots_when_present() {
        let app = mock_app_with_state(FileIndex::empty());
        let cfg = FileIndexConfig {
            include_roots: vec!["/a".to_string(), "/b".to_string()],
            ..Default::default()
        };
        let roots = resolve_roots(app.handle(), &cfg);
        assert_eq!(roots, vec![PathBuf::from("/a"), PathBuf::from("/b")]);
    }

    #[tokio::test]
    async fn file_search_and_status_commands_delegate_to_state() {
        let app = mock_app_with_state(built(&["/r/report.txt"]));
        let state: State<'_, Arc<FileIndexState>> = app.state();
        let r = file_search("report".to_string(), None, None, state.clone())
            .await
            .unwrap();
        assert_eq!(r.hits.len(), 1);
        assert_eq!(r.hits[0].name, "report.txt");

        let status = file_index_status(state).await.unwrap();
        assert_eq!(status.entry_count, 1);
    }

    #[tokio::test]
    async fn record_selection_persists_and_updates_in_memory_cache() {
        let app = mock_app_with_state(built(&["/r/report.txt"]));
        let state: State<'_, Arc<FileIndexState>> = app.state();
        let store: State<'_, DataStore> = app.state();

        let file_id_hex = {
            let r = file_search("report".to_string(), None, None, state.clone())
                .await
                .unwrap();
            r.hits[0].file_id.clone()
        };

        file_search_record_selection(
            "report".to_string(),
            file_id_hex.clone(),
            state.clone(),
            store.clone(),
        )
        .await
        .unwrap();

        let conn = store.conn().unwrap();
        let rows = file_search_selections::load_all(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].file_id, file_id_hex);
        drop(conn);

        let id = file_id::from_hex(&file_id_hex).unwrap();
        assert!(state.learning_boost("report", id, NOW) > 0.0);
    }

    #[tokio::test]
    async fn pin_unpin_and_list_pinned_round_trip() {
        let app = mock_app_with_state(built(&["/r/report.txt"]));
        let state: State<'_, Arc<FileIndexState>> = app.state();
        let store: State<'_, DataStore> = app.state();

        let file_id_hex = {
            let r = file_search("report".to_string(), None, None, state.clone())
                .await
                .unwrap();
            r.hits[0].file_id.clone()
        };

        file_search_pin(
            file_id_hex.clone(),
            "/r/report.txt".to_string(),
            state.clone(),
            store.clone(),
        )
        .await
        .unwrap();

        let id = file_id::from_hex(&file_id_hex).unwrap();
        assert!(state.is_pinned(id));

        let pinned = file_search_list_pinned(store.clone()).await.unwrap();
        assert_eq!(pinned.len(), 1);
        assert_eq!(pinned[0].name, "report.txt");

        file_search_unpin(file_id_hex, state.clone(), store.clone())
            .await
            .unwrap();
        assert!(!state.is_pinned(id));
        assert!(file_search_list_pinned(store).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn clear_history_empties_table_and_memory() {
        let app = mock_app_with_state(built(&["/r/report.txt"]));
        let state: State<'_, Arc<FileIndexState>> = app.state();
        let store: State<'_, DataStore> = app.state();

        let file_id_hex = {
            let r = file_search("report".to_string(), None, None, state.clone())
                .await
                .unwrap();
            r.hits[0].file_id.clone()
        };
        file_search_record_selection(
            "report".to_string(),
            file_id_hex.clone(),
            state.clone(),
            store.clone(),
        )
        .await
        .unwrap();

        file_search_clear_history(state.clone(), store.clone())
            .await
            .unwrap();

        let conn = store.conn().unwrap();
        assert!(file_search_selections::load_all(&conn).unwrap().is_empty());
        drop(conn);
        let id = file_id::from_hex(&file_id_hex).unwrap();
        assert_eq!(state.learning_boost("report", id, NOW), 0.0);
    }

    #[test]
    fn rescan_signal_only_fires_from_stable_states() {
        assert!(should_start_rescan(IndexStateKind::Ready));
        assert!(should_start_rescan(IndexStateKind::CapReached));
        assert!(
            !should_start_rescan(IndexStateKind::Building),
            "startup scan already running"
        );
        assert!(
            !should_start_rescan(IndexStateKind::Rescanning),
            "never stack a second scan on a running one"
        );
        assert!(!should_start_rescan(IndexStateKind::Disabled));
    }

    #[tokio::test]
    async fn deep_search_availability_and_search_do_not_panic() {
        // Whether or not this machine has a deep-search provider available,
        // the commands must complete cleanly.
        let availability = deep_search_availability().await.unwrap();
        let hits = deep_search("__asyar_deep_search_command_test__".to_string(), Some(5))
            .await
            .unwrap();
        assert!(hits.len() <= 5);
        let _ = availability;
    }
}
