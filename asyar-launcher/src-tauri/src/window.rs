#[cfg(target_os = "macos")]
mod platform {
    use tauri::{Emitter, Manager, Runtime, WebviewWindow};
    use tauri_nspanel::{
        cocoa::{
            appkit::{NSMainMenuWindowLevel, NSView, NSWindowCollectionBehavior},
            base::{id, YES},
            foundation::{NSPoint, NSRect},
        },
        objc::{msg_send, sel, sel_impl},
        panel_delegate, Panel, WebviewWindowExt as PanelWebviewWindowExt,
    };
    use thiserror::Error;

    type TauriError = tauri::Error;

    #[derive(Error, Debug)]
    enum Error {
        #[error("Unable to convert window to panel")]
        Panel,
        #[error("Monitor with cursor not found")]
        MonitorNotFound,
    }

    pub trait WebviewWindowExt {
        fn to_spotlight_panel(&self) -> tauri::Result<Panel>;

        fn center_at_cursor_monitor(&self) -> tauri::Result<()>;
    }

    impl<R: Runtime> WebviewWindowExt for WebviewWindow<R> {
        fn to_spotlight_panel(&self) -> tauri::Result<Panel> {
            // Convert window to panel
            let panel = self
                .to_panel()
                .map_err(|_| TauriError::Anyhow(Error::Panel.into()))?;

            // Set panel level
            panel.set_level(NSMainMenuWindowLevel + 1);

            // Allows the panel to display on the same space as the full screen window
            panel.set_collection_behaviour(
                NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary,
            );

            #[allow(non_upper_case_globals)]
            const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;

            // Ensures the panel cannot activate the App
            panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);

            // Set up a delegate to handle key window events for the panel
            //
            // This delegate listens for two specific events:
            // 1. When the panel becomes the key window
            // 2. When the panel resigns as the key window
            //
            // For each event, it emits a corresponding custom event to the app,
            // allowing other parts of the application to react to these panel state changes.

            let panel_delegate = panel_delegate!(SpotlightPanelDelegate {
                window_did_resign_key,
                window_did_become_key
            });

            let app_handle = self.app_handle().clone();

            let label = self.label().to_string();

            panel_delegate.set_listener(Box::new(move |delegate_name: String| {
                match delegate_name.as_str() {
                    "window_did_become_key" => {
                        let _ = app_handle.emit(format!("{}_panel_did_become_key", label).as_str(), ());
                    }
                    "window_did_resign_key" => {
                        let _ = app_handle.emit(format!("{}_panel_did_resign_key", label).as_str(), ());
                    }
                    _ => (),
                }
            }));

            panel.set_delegate(panel_delegate);

            Ok(panel)
        }

        fn center_at_cursor_monitor(&self) -> tauri::Result<()> {
            let monitor = monitor::get_monitor_with_cursor()
                .ok_or(TauriError::Anyhow(Error::MonitorNotFound.into()))?;

            let monitor_scale_factor = monitor.scale_factor();

            let monitor_size = monitor.size().to_logical::<f64>(monitor_scale_factor);

            let monitor_position = monitor.position().to_logical::<f64>(monitor_scale_factor);

            let window_handle: id = self.ns_window().unwrap() as _;

            let window_frame: NSRect = unsafe { window_handle.frame() };

            let rect = NSRect {
                origin: NSPoint {
                    x: (monitor_position.x + (monitor_size.width / 2.0))
                        - (window_frame.size.width / 2.0),
                    y: (monitor_position.y + (monitor_size.height / 2.0))
                        - (window_frame.size.height / 2.0),
                },
                size: window_frame.size,
            };

            let _: () = unsafe { msg_send![window_handle, setFrame: rect display: YES] };

            Ok(())
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use tauri::{Runtime, WebviewWindow};

    pub trait WebviewWindowExt {
        fn center_at_cursor_monitor(&self) -> tauri::Result<()>;
        /// Set WS_EX_TOOLWINDOW to hide from taskbar/Alt+Tab
        fn setup_spotlight_style(&self) -> tauri::Result<()>;
    }

    impl<R: Runtime> WebviewWindowExt for WebviewWindow<R> {
        fn center_at_cursor_monitor(&self) -> tauri::Result<()> {
            // 1. Get cursor position
            let cursor = self.cursor_position()?;

            // 2. Find monitor containing cursor
            let monitor = self.monitor_from_point(cursor.x, cursor.y)?;

            // Fall back to center() if no monitor found
            let monitor = match monitor {
                Some(m) => m,
                None => return self.center(),
            };

            // 3. Get window size and monitor geometry
            let window_size = self.outer_size()?;
            let monitor_pos = monitor.position();
            let monitor_size = monitor.size();

            // 4. Calculate centered position on that monitor
            let x = monitor_pos.x + (monitor_size.width as i32 / 2) - (window_size.width as i32 / 2);
            let y = monitor_pos.y + (monitor_size.height as i32 / 2) - (window_size.height as i32 / 2);

            // 5. Set position
            self.set_position(tauri::PhysicalPosition::new(x, y))?;

            Ok(())
        }

        fn setup_spotlight_style(&self) -> tauri::Result<()> {
            use windows::Win32::UI::WindowsAndMessaging::{
                GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
            };
            let hwnd = self.hwnd()?;
            unsafe {
                let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_TOOLWINDOW.0 as isize);
            }
            Ok(())
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use tauri::{Runtime, WebviewWindow};

    pub trait WebviewWindowExt {
        fn center_at_cursor_monitor(&self) -> tauri::Result<()>;
        fn setup_spotlight_style(&self) -> tauri::Result<()>;
    }

    impl<R: Runtime> WebviewWindowExt for WebviewWindow<R> {
        fn center_at_cursor_monitor(&self) -> tauri::Result<()> {
            // 1. Get cursor position
            let cursor = self.cursor_position()?;

            // 2. Find monitor containing cursor
            let monitor = self.monitor_from_point(cursor.x, cursor.y)?;

            // Fall back to center() if no monitor found
            let monitor = match monitor {
                Some(m) => m,
                None => return self.center(),
            };

            // 3. Get window size and monitor geometry
            let window_size = self.outer_size()?;
            let monitor_pos = monitor.position();
            let monitor_size = monitor.size();

            // 4. Calculate centered position on that monitor
            let x = monitor_pos.x + (monitor_size.width as i32 / 2) - (window_size.width as i32 / 2);
            let y = monitor_pos.y + (monitor_size.height as i32 / 2) - (window_size.height as i32 / 2);

            // 5. Set position
            self.set_position(tauri::PhysicalPosition::new(x, y))?;

            Ok(())
        }

        fn setup_spotlight_style(&self) -> tauri::Result<()> {
            use gtk::prelude::GtkWindowExt;
            let gtk_window = self.gtk_window()?;
            gtk_window.set_type_hint(gdk::WindowTypeHint::Utility);
            gtk_window.set_skip_taskbar_hint(true);
            gtk_window.set_skip_pager_hint(true);
            Ok(())
        }
    }
}

pub use platform::WebviewWindowExt;
