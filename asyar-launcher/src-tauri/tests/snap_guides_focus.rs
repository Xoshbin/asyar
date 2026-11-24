//! Real Win32/WebView2 regression test; run on an interactive Windows desktop:
//! cargo test --workspace --test snap_guides_focus -- --ignored --test-threads=1

#![cfg(target_os = "windows")]

use asyar_lib::snap_guides::{service, SnapGuidesState};
use std::time::Duration;
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

fn is_foreground(window: &WebviewWindow) -> bool {
    // SAFETY: GetForegroundWindow only reads the active top-level HWND.
    unsafe { GetForegroundWindow() == window.hwnd().unwrap() }
}

#[test]
#[ignore = "requires an interactive Windows desktop and WebView2"]
fn snap_guides_preserve_launcher_focus_across_repeated_drags() {
    let profile = tempfile::tempdir().unwrap();
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().identifier = "org.asyar.snap-focus-test".into();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(SnapGuidesState::default())
        .build(context)
        .unwrap();

    let launcher = WebviewWindowBuilder::new(
        &app,
        "main",
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title("Asyar drag regression test")
    .data_directory(profile.path().join("main"))
    .inner_size(400.0, 160.0)
    .build()
    .unwrap();

    // Use the shipped overlay configuration, including focus:false and
    // focusable:false: neither may be mistaken for a non-activating show.
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let guide_config = config["app"]["windows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|window| window["label"] == service::SNAP_GUIDES_WINDOW_LABEL)
        .unwrap();
    let mut guide_config: tauri::utils::config::WindowConfig =
        serde_json::from_value(guide_config.clone()).unwrap();
    guide_config.url = WebviewUrl::External("about:blank".parse().unwrap());
    let guides = WebviewWindowBuilder::from_config(&app, &guide_config)
        .unwrap()
        .data_directory(profile.path().join("guides"))
        .build()
        .unwrap();
    let other = WebviewWindowBuilder::new(
        &app,
        "other",
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .data_directory(profile.path().join("other"))
    .build()
    .unwrap();
    let handle = app.handle().clone();
    let watchdog = handle.clone();
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    let (result_tx, result_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        if done_rx.recv_timeout(Duration::from_secs(15)).is_err() {
            watchdog.exit(1);
        }
    });
    std::thread::spawn(move || {
        // Run commands off the event thread, as IPC callers do, while Tauri
        // processes real Win32/WebView2 events through its normal event loop.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let settle = || std::thread::sleep(Duration::from_millis(200));
            launcher.set_focus().unwrap();
            settle();
            assert!(
                is_foreground(&launcher),
                "test launcher must start in the foreground"
            );
            let mut observations = Vec::new();
            for _ in 0..2 {
                service::show(&handle, (40.0, 40.0), (500.0, 300.0)).unwrap();
                settle();
                observations.push((guides.is_visible().unwrap(), is_foreground(&launcher)));
                service::hide(&handle).unwrap();
                settle();
                observations.push((guides.is_visible().unwrap(), is_foreground(&launcher)));
            }
            // Real focus transfers must remain possible after dropping.
            other.set_focus().unwrap();
            settle();
            let genuine_blur = is_foreground(&other);
            assert_eq!(
                observations,
                [(true, true), (false, true), (true, true), (false, true)]
            );
            assert!(genuine_blur, "ordinary focus changes must remain possible");
        }));
        let _ = result_tx.send(result);
        let _ = done_tx.send(());
        handle.exit(0);
    });
    app.run_return(|_, _| {});
    match result_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("native window test timed out")
    {
        Ok(()) => {}
        Err(panic) => std::panic::resume_unwind(panic),
    }
}
