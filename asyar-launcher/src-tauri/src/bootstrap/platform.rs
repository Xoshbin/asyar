//! Platform-specific bootstrap module.
//!
//! Handles OS-specific initialization (macOS panel behavior and Dock policy,
//! Linux D-Bus service, single-instance routing, deep links, diagnostics panic hooks,
//! crash reporting, and autostart registration).

use std::sync::Arc;
use tauri::Manager;

pub fn init_early(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let launcher_coordinator = app
        .state::<Arc<crate::launcher::LauncherCoordinator>>()
        .inner()
        .clone();
    launcher_coordinator
        .attach_app(app.handle().clone())
        .map_err(|error| format!("failed to attach launcher coordinator: {error}"))?;

    #[cfg(target_os = "linux")]
    match crate::platform::linux::launcher_dbus::start(
        &app.config().identifier,
        &launcher_coordinator,
    ) {
        Ok(service) => {
            app.manage(service);
        }
        Err(error) => {
            log::warn!("[launcher-dbus] {error}");
        }
    }

    let initial_args = std::env::args().collect::<Vec<_>>();
    if let Some(action) = crate::launcher::classify_initial_launch(
        &initial_args,
        crate::deeplink::deep_link_scheme(app.handle()),
    ) {
        launcher_coordinator
            .request(action)
            .map_err(|error| format!("failed to queue initial launcher action: {error}"))?;
    }

    #[cfg(target_os = "macos")]
    crate::platform::macos::disable_press_and_hold();

    Ok(())
}

pub fn init_diagnostics(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Install a panic hook that emits a `feedback:report` event before the process unwinds.
    {
        let app_handle = app.handle().clone();
        std::panic::set_hook(Box::new(move |info| {
            let location = info
                .location()
                .map(|l| format!("{}:{}", l.file(), l.line()))
                .unwrap_or_else(|| "unknown".into());
            let detail = info.to_string();
            let payload = serde_json::json!({
                "source": "rust",
                "kind": "panic",
                "severity": "fatal",
                "retryable": false,
                "context": { "location": location },
                "developerDetail": detail,
            });
            let _ = tauri::Emitter::emit(&app_handle, "feedback:report", payload);
            log::error!("panic: {info}");
        }));
    }

    // Long-poll IPC bridge: queue Rust->JS events for `bridge_poll`.
    app.manage(Arc::new(crate::event_bridge::EventBridge::default()));

    // Crash-report detection (next launch)
    {
        use tauri_plugin_store::StoreExt;
        let handle = app.handle().clone();

        if let Ok(data_dir) = app.path().app_data_dir() {
            let _ = std::fs::create_dir_all(&data_dir);
            let marker_exists = data_dir
                .join(crate::feedback::crash_reporter::MARKER_FILE)
                .exists();

            if crate::feedback::crash_reporter::crashed_last_run(marker_exists) {
                if let Some((panic_msg, backtrace)) =
                    crate::feedback::crash_reporter::read_and_clear_crash(&data_dir)
                {
                    let log_path = app
                        .path()
                        .app_log_dir()
                        .map(|d| d.join("asyar.log"))
                        .unwrap_or_default();
                    let log_tail =
                        crate::feedback::crash_reporter::read_log_tail(&log_path, 64 * 1024);
                    let payload = crate::feedback::CrashPayload {
                        panic: panic_msg,
                        backtrace,
                        log_tail,
                    };

                    let mode = handle
                        .store("settings.dat")
                        .ok()
                        .and_then(|s| s.get("settings"))
                        .map(|v| crate::feedback::parse_crash_report_mode(&v.to_string()))
                        .unwrap_or(crate::feedback::CrashReportMode::Off);
                    let action = crate::feedback::decide_crash_action(mode, true);
                    log::info!(
                        "crash-report: previous run crashed; mode={mode:?} action={action:?}"
                    );

                    match action {
                        crate::feedback::CrashAction::SendSilently => {
                            let api = (*app.state::<crate::auth::api_client::ApiClient>()).clone();
                            let token = app
                                .state::<crate::auth::state::AuthState>()
                                .token
                                .lock()
                                .ok()
                                .and_then(|t| t.clone());
                            let report = crate::feedback::build_report(
                                crate::feedback::FeedbackInput {
                                    kind: "crash".into(),
                                    category: None,
                                    message: None,
                                    email: None,
                                },
                                Some(payload),
                            );
                            tauri::async_runtime::spawn(async move {
                                match api.submit_feedback(&report, token.as_deref()).await {
                                    Ok(()) => {
                                        log::info!("crash-report: auto-sent crash report")
                                    }
                                    Err(e) => {
                                        log::warn!("crash-report: auto-send failed: {e}")
                                    }
                                }
                            });
                        }
                        crate::feedback::CrashAction::Prompt => {
                            if let Ok(mut slot) =
                                app.state::<crate::feedback::PendingCrash>().0.lock()
                            {
                                *slot = Some(payload);
                                crate::event_bridge::bridge_emit(
                                    &handle,
                                    "crash-report-pending",
                                    true,
                                );
                                log::info!("crash-report: stored pending crash + emitted prompt");
                            }
                        }
                        crate::feedback::CrashAction::Ignore => {
                            log::info!("crash-report: consent is Off — ignoring crash");
                        }
                    }
                } else {
                    log::info!(
                        "crash-report: run marker present but no last_crash.json \
                         (force-quit/kill rather than a panic) — nothing to report"
                    );
                }
            }

            crate::feedback::crash_reporter::write_marker(&data_dir);
            crate::feedback::crash_reporter::install_panic_hook(data_dir);
        }
    }

    Ok(())
}

pub fn init_deeplinks(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Notification-action registry
    {
        let registry = Arc::new(crate::notifications::NotificationActionRegistry::new());
        let backend = crate::notifications::build_default_backend(
            app.handle().clone(),
            Arc::clone(&registry),
        );
        app.manage(registry);
        app.manage(backend);
    }

    // Extension-tray manager
    {
        let lookup: Arc<dyn crate::extension_tray::icon::ExtensionDirLookup + Send + Sync> =
            Arc::new(
                crate::extension_tray::extension_lookup::AppHandleExtensionDirLookup::new(
                    app.handle().clone(),
                ),
            );
        let backend =
            crate::extension_tray::backend::TauriTrayBackend::new(app.handle().clone(), lookup);
        app.manage(crate::extension_tray::ExtensionTrayManager::new(Box::new(
            backend,
        )));
    }

    // Deep link handler
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        let scheme = crate::deeplink::deep_link_scheme(app.handle());

        let handle = app.handle().clone();
        app.deep_link().on_open_url(move |event| {
            for url in event.urls() {
                crate::deeplink::dispatch_url(&handle, scheme, url.as_str());
            }
        });

        match app.deep_link().get_current() {
            Ok(Some(urls)) => {
                let pending = app.state::<crate::deeplink::PendingDeeplinks>();
                for url in urls {
                    pending.push(url.to_string());
                }
            }
            Ok(None) => {}
            Err(err) => log::warn!("[Deeplink] get_current failed: {err}"),
        }
    }

    #[cfg(target_os = "macos")]
    {
        let show_dock = crate::bootstrap::windows::read_show_dock_icon(app.app_handle());
        let policy = if show_dock {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        app.set_activation_policy(policy);
        if show_dock {
            crate::platform::macos::set_dock_icon_image();
        }
    }

    Ok(())
}

pub fn init_autostart(app: &tauri::AppHandle) {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::MacosLauncher;
        use tauri_plugin_autostart::ManagerExt;

        let _ = app.plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ));

        let autostart_manager = app.autolaunch();
        log::info!(
            "current autostart status: {}",
            autostart_manager.is_enabled().unwrap_or(false)
        );
    }
}

pub fn init_late(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let launcher_coordinator = app
        .state::<Arc<crate::launcher::LauncherCoordinator>>()
        .inner()
        .clone();
    launcher_coordinator
        .mark_ready()
        .map_err(|error| format!("failed to mark launcher coordinator ready: {error}"))?;
    Ok(())
}
