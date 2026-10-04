#[allow(unused_imports)]
use tauri::{Emitter, Listener, Manager};

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

use crate::extensions::extension_runtime::{ExtensionRuntimeManager, RuntimeConfig};

const LOG_MAX_FILE_SIZE_BYTES: u128 = 2_000_000;
const LOG_FILES_TO_KEEP: usize = 2;

/// Shared application state managed by Tauri's state system.
pub struct AppState {
    /// When `true`, prevents the launcher window from losing keyboard focus.
    pub focus_locked: AtomicBool,
    /// Maps shortcut strings (e.g. `"Alt+Space"`) to the object ID they activate.
    pub user_shortcuts: Mutex<HashMap<String, String>>,
    /// The current global shortcut string used to show/hide the launcher.
    pub launcher_shortcut: Mutex<String>,
    /// When `true`, the text snippet expansion listener is active.
    pub snippets_enabled: AtomicBool,
    /// Tracks whether the launcher window is currently visible.
    pub asyar_visible: AtomicBool,
    /// Mirrors `!isCompactIdle` from the TS side — true whenever the launcher
    /// is in an expanded state the user has committed to (typed query, active
    /// extension view, active context chip, Show More click). Read by the
    /// panel resign handler to decide whether to reset compact geometry on
    /// hide. TS owns the decision because it depends on UI-only state
    /// (navigation stack, context chips); Rust just receives the answer.
    pub launcher_keep_expanded: AtomicBool,
    /// The currently active snippet definitions (keyword → expansion text).
    pub active_snippets: Mutex<HashMap<String, String>>,
    /// Per-extension contributed shortcode → expansion maps, merged into the
    /// active matcher view at lookup time. User-created snippets in
    /// `active_snippets` shadow these on key collision.
    pub contributed_snippets: Mutex<crate::snippets::ContributedSnippets>,
    /// Active trigger characters/delimiters for shortcode miss events.
    pub shortcode_triggers: Mutex<Vec<String>>,
    /// Guards against registering the global event listener more than once.
    pub listener_started: AtomicBool,
    /// Handle to the previously focused window, restored when the launcher hides (Windows only).
    #[cfg(target_os = "windows")]
    pub previous_hwnd: Mutex<isize>,
    /// The X11 window ID of the window active before Asyar was shown (Linux only).
    #[cfg(target_os = "linux")]
    pub linux_prev_window_id: Mutex<u64>,
    /// Set during snippet expansion to suppress the monitor from re-triggering.
    pub is_expanding: AtomicBool,
    /// When the launcher was last revealed. Read by the blur handler on Wayland
    /// to ignore the spurious `Focused(false)` that arrives before the
    /// compositor has granted keyboard focus. See `blur_hide_is_spurious`.
    #[cfg(target_os = "linux")]
    pub launcher_shown_at: Mutex<Option<std::time::Instant>>,
    /// Timestamp of the last user interaction with Asyar.
    /// Used by the auto-update idle restart scheduler.
    pub last_interaction: Mutex<std::time::Instant>,
}

impl AppState {
    pub fn mark_interaction(&self) {
        if let Ok(mut last) = self.last_interaction.lock() {
            *last = std::time::Instant::now();
        }
    }
}

/// How long after a reveal a `Focused(false)` is treated as compositor noise
/// rather than a real click-away.
#[cfg(target_os = "linux")]
pub const BLUR_HIDE_GRACE: std::time::Duration = std::time::Duration::from_millis(250);

/// True when a `Focused(false)` arrived so soon after the reveal that it cannot
/// be a deliberate click-away.
///
/// Wayland has no way for a client to focus itself: `set_focus()` sends an
/// xdg-activation request and returns `Ok(())` whether or not the compositor
/// honours it. Between `show()` and the compositor granting focus, the window
/// is mapped but unfocused, so the blur handler fires and hides the launcher
/// the instant it appears. Under `input:follow_mouse` the compositor may
/// never grant focus at all, because the pointer is still over whatever the
/// user was looking at.
///
/// X11 is unaffected (the grab focuses synchronously) but shares this code
/// path; the grace window is short enough that a real click-away inside it is
/// not humanly reachable.
#[cfg(target_os = "linux")]
pub fn blur_hide_is_spurious(shown_at: Option<std::time::Instant>) -> bool {
    shown_at.is_some_and(|t| t.elapsed() < BLUR_HIDE_GRACE)
}

/// Start the blur grace window. Called from every path that reveals the
/// launcher; a later call simply extends the window.
#[cfg(target_os = "linux")]
pub fn mark_launcher_shown(state: &AppState) {
    if let Ok(mut guard) = state.launcher_shown_at.lock() {
        *guard = Some(std::time::Instant::now());
    }
}

/// Adapts the managed `runtimes::RuntimeManager` to
/// `mcp::transport::RuntimeResolver`. The MCP transport factory is built
/// before `AppHandle` exists (`run()` constructs it ahead of the builder
/// chain), so `app_handle` starts empty and is set once `setup_app` gets a
/// real `AppHandle` — mirrors the old Mutex-based `SidecarPath` wiring, just
/// holding a handle instead of a precomputed path. Every `resolve()` call
/// reads `RuntimeManager` fresh (never caches the resolved path), so a
/// runtime that finishes downloading mid-session is picked up on the very
/// next `connect()` retry.
#[derive(Default)]
pub struct AppRuntimeResolver {
    app_handle: Mutex<Option<tauri::AppHandle>>,
}

impl AppRuntimeResolver {
    pub fn new() -> Self {
        Self {
            app_handle: Mutex::new(None),
        }
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.app_handle.lock().unwrap() = Some(handle);
    }
}

impl mcp::transport::RuntimeResolver for AppRuntimeResolver {
    fn resolve(&self, name: &str) -> Option<std::path::PathBuf> {
        let handle = self.app_handle.lock().unwrap().clone()?;
        let manager = handle.try_state::<runtimes::RuntimeManager>()?;
        manager.resolve(&handle, name)
    }
}

pub mod agents;
pub mod ai;
mod aliases;
pub mod app_events;
pub mod app_updater;
pub mod application;
pub mod auth;
pub mod bootstrap;
pub mod browser;

pub use bootstrap::services::sync_shortcode_triggers;
pub use bootstrap::windows::{
    parse_appearance_theme, parse_show_dock_icon, parse_show_tray_icon, parse_theme_preference_str,
    read_show_dock_icon, read_show_tray_icon, ThemePreference,
};
pub mod calculator;
pub mod clipboard_cache;
pub mod clipboard_capture;
pub mod clipboard_markup;
pub mod clipboard_privacy;
pub mod color_sampler;
pub mod commands;
pub mod crypto;
pub mod deeplink;
pub mod diagnostics;
pub mod error;
pub mod event_bridge;
pub mod event_hub;
pub mod ext_builder;
pub mod extension_tray;
pub mod extensions;
pub mod feedback;
pub mod file_index;
pub mod files_scope;
pub mod fs_watcher;
pub mod hud_window;
pub mod index_events;
mod launcher;
pub mod launcher_placement;
pub mod locale;
pub mod mcp;
pub mod network;
mod notes_export;
pub mod notifications;
pub mod oauth;
pub mod ocr;
pub mod onboarding;
pub mod opener_scope;
pub mod permissions;
pub mod platform;
pub mod power;
pub mod process_manager;
pub mod profile;
pub mod query_history;
pub mod raycast_import;
pub mod runs;
pub mod runtimes;
mod scheduler;
pub mod scripts;
mod search_engine;
pub mod secret_detection;
pub mod selection;
pub mod shell;
pub mod snap_guides;
mod snippets;
pub mod sticky_window;
pub mod storage;
pub mod sync;
pub mod system_actions;
pub mod system_events;
pub mod templating;
pub mod thumbnail;
pub mod timers;
pub mod tray;
pub mod uri_schemes;
pub mod usage;
pub mod walkthrough;
pub mod window_drag;
pub mod window_management;

pub const SPOTLIGHT_LABEL: &str = "main";

/// Pure decision logic for the Linux WebKitGTK DMA-BUF workaround (issue
/// #435): returns the (key, value) env var to set when `is_linux`, or
/// `None` otherwise. Takes `is_linux` as a parameter rather than branching
/// on `cfg!` internally so both branches are unit-testable from any host.
fn linux_webkit_dmabuf_env_var(is_linux: bool) -> Option<(&'static str, &'static str)> {
    if is_linux {
        Some(("WEBKIT_DISABLE_DMABUF_RENDERER", "1"))
    } else {
        None
    }
}

/// Applies the Linux WebKitGTK DMA-BUF workaround, if applicable to the
/// current build target. Must run before the webview is created, so callers
/// invoke this first thing in `main()`.
pub fn apply_linux_webkit_dmabuf_workaround() {
    if let Some((key, value)) = linux_webkit_dmabuf_env_var(cfg!(target_os = "linux")) {
        std::env::set_var(key, value);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "mcp-server" || arg == "--mcp") {
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                eprintln!("[asyar mcp] Failed to create Tokio runtime: {e}");
                std::process::exit(1);
            }
        };

        rt.block_on(async {
            let registry = mcp::server::create_default_mcp_registry();
            if let Err(e) = mcp::server::run_stdio_server(registry).await {
                eprintln!("[asyar mcp] Server exited with error: {e}");
            }
        });
        return;
    }

    // Build the MCP transport factory before entering the builder chain. Its
    // runtime resolver starts with no `AppHandle`; `setup_app` wires the real
    // one in once it's available (see `AppRuntimeResolver`).
    let mcp_runtime_resolver = std::sync::Arc::new(AppRuntimeResolver::new());
    let mcp_factory = std::sync::Arc::new(mcp::MultiTransportFactory::new(
        mcp_runtime_resolver.clone(),
    ));
    let mcp_supervisor = std::sync::Arc::new(mcp::McpSupervisor::new(
        mcp_factory,
        mcp::SupervisorConfig::default(),
    ));
    let launcher_coordinator = std::sync::Arc::new(launcher::LauncherCoordinator::new());
    let single_instance_coordinator = launcher_coordinator.clone();

    let builder = tauri::Builder::default()
        // Single-instance must be the FIRST plugin: it intercepts a second
        // launch before other plugins initialize, and (with the "deep-link"
        // feature) forwards that instance's asyar:// URL argv into on_open_url
        // — the only way a deep link reaches an already-running app on
        // Windows/Linux.
        .plugin(tauri_plugin_single_instance::init(
            move |app, args, _cwd| {
                // A bare re-exec (`asyar` with no URL argv) is a summon request:
                // it is the only way a Wayland compositor can drive the launcher,
                // since the X11 key grab behind tauri-plugin-global-shortcut never
                // sees keystrokes there. Bind a compositor key to the binary and
                // this callback toggles the already-running instance.
                //
                // Skip when argv carries an asyar:// URL — those instances exist to
                // deliver a deep link, and the deep-link handler decides on its own
                // whether to reveal the window (view commands do, background ones
                // do not). Toggling here would fight that, and would *hide* the
                // launcher whenever a deep link arrived while it was open.
                let scheme = deeplink::deep_link_scheme(app);

                // On macOS, tauri-plugin-deep-link's handle_cli_arguments is a no-op
                // because it assumes all macOS deep links arrive via Apple Events.
                // For CLI invocations (`asyar asyar://...` or `asyar-dev://...`),
                // dispatch directly to deeplink::dispatch_url so CLI-based triggers work.
                #[cfg(target_os = "macos")]
                {
                    for arg in &args {
                        if arg.starts_with(&format!("{scheme}://")) {
                            deeplink::dispatch_url(app, scheme, arg);
                        }
                    }
                }

                if let Some(action) = launcher::classify_secondary_launch(&args, scheme) {
                    if let Err(error) = single_instance_coordinator.request(action) {
                        log::warn!("[launcher] failed to queue secondary launch action: {error}");
                    }
                }
            },
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_x::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            // Silence verbose third-party crate logging (the browser-bridge axum
            // server, the WebSocket layer, hyper, the keychain, and the notify
            // file-watcher behind the file index) so a busy companion or a burst
            // of filesystem events does not flood the log with TRACE lines.
            // The file sink keeps two rotated 2 MB files plus the active file,
            // preserving useful diagnostic history with bounded disk usage.
            // Asyar's own logs are unaffected.
            tauri_plugin_log::Builder::new()
                .targets([
                    #[cfg(debug_assertions)]
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .max_file_size(LOG_MAX_FILE_SIZE_BYTES)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(
                    LOG_FILES_TO_KEEP,
                ))
                .level_for("axum", log::LevelFilter::Warn)
                .level_for("hyper", log::LevelFilter::Warn)
                .level_for("hyper_util", log::LevelFilter::Warn)
                .level_for("tower_http", log::LevelFilter::Warn)
                .level_for("tokio_tungstenite", log::LevelFilter::Warn)
                .level_for("tungstenite", log::LevelFilter::Warn)
                .level_for("keyring", log::LevelFilter::Warn)
                .level_for("mio", log::LevelFilter::Warn)
                .level_for("notify", log::LevelFilter::Warn)
                .level_for("notify_debouncer_full", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .register_uri_scheme_protocol("asyar-extension", |ctx, req| {
            uri_schemes::handle_extension_request(ctx.app_handle(), req)
        })
        .register_uri_scheme_protocol("asyar-icon", |ctx, req| {
            uri_schemes::handle_icon_request(ctx.app_handle(), req)
        })
        .register_uri_scheme_protocol("asyar-thumb", |ctx, req| {
            uri_schemes::handle_thumbnail_request(ctx.app_handle(), req)
        })
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    commands::handle_shortcut(app, shortcut, event);
                })
                .build(),
        )
        .manage(extensions::headless::HeadlessRegistry(Mutex::new(
            HashMap::new(),
        )))
        .manage(extensions::ExtensionRegistryState::new())
        .manage(extensions::dynamic_commands::DynamicCommandRegistry::new())
        .manage(permissions::ExtensionPermissionRegistry::new())
        .manage(network::websocket::WebSocketManager::new())
        .manage(auth::state::AuthState::default())
        .manage(auth::api_client::ApiClient::new())
        .manage(oauth::OAuthPendingFlowState::new())
        .manage(deeplink::PendingDeeplinks::default())
        .manage(hud_window::HudState::default())
        .manage(snap_guides::SnapGuidesState::default())
        .manage(shell::ShellProcessRegistry::new())
        .manage(extensions::scheduler::SchedulerState::new())
        .manage(scripts::InlineSchedulerState::new())
        .manage(std::sync::Arc::new(ExtensionRuntimeManager::new(
            RuntimeConfig::default(),
        )))
        .manage(extensions::onboarding_intercept::StashRegistry::default())
        .manage(app_updater::AppUpdaterState::new())
        .manage(scheduler::Scheduler::new())
        .manage(power::PowerRegistry::new(power::default_backend()))
        .manage(std::sync::Arc::new(
            system_actions::SystemActionsState::new(system_actions::default_backend()),
        ))
        .manage(std::sync::Arc::new(system_events::SystemEventsHub::new()))
        .manage(std::sync::Arc::new(app_events::AppEventsHub::new()))
        .manage(std::sync::Arc::new(index_events::IndexEventsHub::new()))
        .manage(std::sync::Arc::new(fs_watcher::FsWatcherRegistry::new()))
        .manage(clipboard_privacy::ClipboardPrivacyState::new())
        .manage(commands::clipboard_privacy::UserDenylist::new())
        .manage(clipboard_capture::ClipboardCaptureManager::default())
        .manage(secret_detection::SecretDetectionState::new())
        .manage::<std::sync::Arc<dyn app_events::AppPresenceQuery>>(std::sync::Arc::from(
            app_events::default_presence_query(),
        ))
        .manage(std::sync::Arc::new(agents::tools::ToolRegistry::new())
            as agents::tools::ToolRegistryState)
        .manage(agents::runner::AgentRunnerState::default())
        .manage(mcp_supervisor)
        .manage(mcp_runtime_resolver)
        .manage(ext_builder::ExtBuilderState::default())
        .manage(calculator::CalculatorState::default())
        .manage(std::sync::Arc::new(
            query_history::QueryHistoryService::default(),
        ))
        .manage(runtimes::RuntimeManager::new())
        .manage(feedback::channel::FeedbackChannelState::default())
        .manage(feedback::PendingCrash::default())
        .manage(locale::LocaleService::new())
        .manage(launcher_coordinator)
        .manage(crate::agents::cache::AgentResponseCache::default())
        .manage(AppState {
            focus_locked: AtomicBool::new(false),
            user_shortcuts: Mutex::new(HashMap::new()),
            launcher_shortcut: Mutex::new(String::from("Alt+Space")),
            snippets_enabled: AtomicBool::new(false),
            asyar_visible: AtomicBool::new(false),
            launcher_keep_expanded: AtomicBool::new(false),
            active_snippets: Mutex::new(HashMap::new()),
            contributed_snippets: Mutex::new(HashMap::new()),
            shortcode_triggers: Mutex::new(vec![":".to_string()]),
            listener_started: AtomicBool::new(false),
            #[cfg(target_os = "windows")]
            previous_hwnd: Mutex::new(0),
            #[cfg(target_os = "linux")]
            linux_prev_window_id: Mutex::new(0),
            is_expanding: AtomicBool::new(false),
            #[cfg(target_os = "linux")]
            launcher_shown_at: Mutex::new(None),
            last_interaction: Mutex::new(std::time::Instant::now()),
        })
        .manage(crate::onboarding::commands::OnboardingCursor::new(cfg!(
            target_os = "macos"
        )))
        .setup(setup_app)
        .invoke_handler(crate::compose_handlers!(
            app_commands,
            window_commands,
            storage_commands,
            search_commands,
            extension_commands,
            system_commands,
            ai_commands,
            browser_and_sync_commands,
        ))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            // Closing a window must NEVER quit Asyar — it lives in the tray and
            // is summoned by hotkey, so windows come and go (sticky notes,
            // settings, onboarding). Tauri's default is to exit once the last
            // window closes; every intentional quit path (tray menu, the Quit
            // command, factory reset) calls `app.exit(0)` instead, which
            // carries an exit code. Only those are allowed through.
            tauri::RunEvent::ExitRequested {
                code: None, api, ..
            } => {
                api.prevent_exit();
            }
            // Clear the run marker on graceful exit so the next launch does not
            // mistake a clean shutdown for a crash.
            tauri::RunEvent::Exit => {
                if let Ok(data_dir) = app_handle.path().app_data_dir() {
                    feedback::crash_reporter::remove_marker(&data_dir);
                }
            }
            _ => {}
        });
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    bootstrap::init(app)?;
    Ok(())
}

#[cfg(all(test, target_os = "linux"))]
mod blur_hide_grace_tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn never_suppresses_when_the_launcher_was_never_shown() {
        assert!(!blur_hide_is_spurious(None));
    }

    #[test]
    fn suppresses_a_blur_that_lands_immediately_after_the_reveal() {
        assert!(blur_hide_is_spurious(Some(Instant::now())));
    }

    #[test]
    fn allows_a_blur_once_the_grace_window_has_elapsed() {
        let long_ago = Instant::now() - (BLUR_HIDE_GRACE + Duration::from_millis(50));
        assert!(!blur_hide_is_spurious(Some(long_ago)));
    }

    #[test]
    fn allows_a_deliberate_click_away_seconds_later() {
        let earlier = Instant::now() - Duration::from_secs(5);
        assert!(!blur_hide_is_spurious(Some(earlier)));
    }
}

#[cfg(test)]
mod panic_hook_tests {
    #[test]
    fn diagnostic_panic_payload_shape() {
        let info_str = "panic at src/foo.rs:1:1: oh no";
        let location = ("src/foo.rs", 1u32);
        let payload = serde_json::json!({
            "source": "rust",
            "kind": "panic",
            "severity": "fatal",
            "retryable": false,
            "context": { "location": format!("{}:{}", location.0, location.1) },
            "developerDetail": info_str,
        });
        assert_eq!(payload["kind"], "panic");
        assert_eq!(payload["severity"], "fatal");
        assert_eq!(payload["context"]["location"], "src/foo.rs:1");
    }
}

#[cfg(test)]
mod link_audit_tests {
    // Issue #345: `liblzma-sys` defaults to pkg-config-based dynamic linking.
    // On macOS CI runners with Homebrew `xz` preinstalled the linker bakes
    // `/opt/homebrew/_/liblzma.5.dylib` into the asyar binary's load commands,
    // crashing the app at launch on end-user Macs that lack that path.
    //
    // Force the vendored static-compile path by enabling the `static` feature
    // on `liblzma-sys` in the workspace manifest.
    #[test]
    fn liblzma_sys_static_feature_is_enabled_in_manifest() {
        let manifest = include_str!("../Cargo.toml");
        let declares_static = manifest.lines().any(|raw| {
            let line = raw.trim();
            line.starts_with("liblzma-sys")
                && line.contains("features")
                && line.contains("\"static\"")
        });
        assert!(
            declares_static,
            "asyar-launcher/src-tauri/Cargo.toml must declare\n\
             \n    liblzma-sys = {{ version = \"0.4\", features = [\"static\"] }}\n\
             \n\
             so vendored xz sources are compiled into the binary instead of \
             dynamic-linking against /opt/homebrew/.../liblzma.5.dylib. See issue #345."
        );
    }
}

#[cfg(test)]
mod log_retention_tests {
    use super::{LOG_FILES_TO_KEEP, LOG_MAX_FILE_SIZE_BYTES};

    #[test]
    fn retains_two_rotated_two_megabyte_log_files() {
        assert_eq!(LOG_MAX_FILE_SIZE_BYTES, 2_000_000);
        assert_eq!(LOG_FILES_TO_KEEP, 2);
    }
}

#[cfg(test)]
mod linux_webkit_dmabuf_workaround_tests {
    use super::linux_webkit_dmabuf_env_var;

    // Issue #435: WebKitGTK's DMA-BUF renderer aborts the WebProcess with
    // "Could not create default EGL display: EGL_BAD_PARAMETER" on some
    // Mesa/GPU driver combos. `is_linux` is taken as a parameter (rather than
    // branching on `cfg!` inside the function) so both branches are
    // unit-testable from any host platform, not just on Linux CI.
    #[test]
    fn requests_dmabuf_disable_on_linux() {
        assert_eq!(
            linux_webkit_dmabuf_env_var(true),
            Some(("WEBKIT_DISABLE_DMABUF_RENDERER", "1"))
        );
    }

    #[test]
    fn does_nothing_on_non_linux() {
        assert_eq!(linux_webkit_dmabuf_env_var(false), None);
    }
}
