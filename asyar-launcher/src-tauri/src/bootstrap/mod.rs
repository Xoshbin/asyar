//! Application bootstrap lifecycle orchestrator.
//!
//! Decomposes host setup into discrete, verified lifecycle phases:
//! 1. Pending factory reset
//! 2. Early platform initialization & coordinator attachment
//! 3. System tray setup
//! 4. Diagnostics, crash reporting, IPC bridge, deep links & notification action registry
//! 5. Native windows creation, panel/vibrancy setup, placement & geometry
//! 6. Keystore & SQLite DataStore initialization
//! 7. Search state initialization backed by DataStore
//! 8. Core services, registries, and schedulers
//! 9. Background FTS indexers (clipboard & notes) & Notes AI tools
//! 10. Window lifecycle listeners (focus/blur, resign, resize, settings hide, global shortcut)
//! 11. Background daemons, watchers, schedulers, and browser bridge
//! 12. Final platform coordination (mark coordinator ready)

pub mod platform;
pub mod search;
pub mod services;
pub mod storage;
pub mod windows;

pub fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Pending factory reset check FIRST
    storage::perform_pending_factory_reset_if_marked(app.handle());

    // 2. Early platform hooks & coordinator attachment
    platform::init_early(app)?;

    // 3. Tray setup
    windows::init_tray(app)?;

    // 4. Diagnostics & crash reporting
    platform::init_diagnostics(app)?;

    // 5. Deep links & notification actions
    platform::init_deeplinks(app)?;

    // 6. Windows creation, vibrancy, placement & geometry seeding
    windows::init_windows(app)?;

    // 7. Keystore & SQLite DataStore initialization
    let data_store = storage::init_storage(app)?;

    // 8. Search state initialization backed by DataStore
    let search_state = search::init_search(app, data_store.clone())?;

    // 9. Core services, registries, and schedulers
    services::init_services(app, &data_store, search_state)?;

    // 10. Background FTS indexers & Notes tools
    storage::init_fts(app, &data_store)?;

    // 11. Window lifecycle listeners & global shortcut
    windows::init_window_listeners(app.handle())?;

    // 12. Background daemons, watchers, and browser bridge
    services::init_daemons(app)?;

    // 13. Mark launcher coordinator ready
    platform::init_late(app)?;

    Ok(())
}
