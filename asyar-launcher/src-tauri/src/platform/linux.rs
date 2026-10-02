pub mod desktop_entry;
pub mod environment;
#[cfg(target_os = "linux")]
pub(crate) mod launcher_dbus;

pub use asyar_platform::linux::*;

use tauri::{Runtime, WebviewWindow};

/// Configures GTK hints for a Spotlight-style window on Linux.
pub fn setup_spotlight_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    {
        let gtk_window = window.gtk_window()?;
        asyar_platform::linux::setup_spotlight_gtk_window(&gtk_window);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
    }
    Ok(())
}

/// Presents and focuses the spotlight window on Linux.
pub fn present_and_focus_spotlight_window<R: Runtime>(
    window: &WebviewWindow<R>,
) -> tauri::Result<()> {
    #[cfg(target_os = "linux")]
    {
        let gtk_window = window.gtk_window()?;
        asyar_platform::linux::present_and_focus_spotlight_gtk_window(&gtk_window);
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window.set_focus();
    }
    Ok(())
}
