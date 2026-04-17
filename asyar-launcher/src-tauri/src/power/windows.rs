//! Windows backend using `SetThreadExecutionState`.
//!
//! `SetThreadExecutionState` is thread-sticky — the flags apply only to the
//! thread that called it. We spawn a dedicated worker thread per token that
//! sets the flag, parks on a channel, and resets to `ES_CONTINUOUS` when
//! signaled. Dropping the handle closes the channel, waking the worker.

use crate::error::AppError;
use crate::power::{PowerBackend, PowerHandle, ResolvedOptions};
use std::sync::mpsc;
use std::thread;
use windows::Win32::System::Power::{
    SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    EXECUTION_STATE,
};

pub struct WindowsPowerBackend;

impl WindowsPowerBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for WindowsPowerBackend {
    fn default() -> Self {
        Self::new()
    }
}

pub struct WindowsThreadHandle {
    signal: Option<mpsc::Sender<()>>,
    join: Option<thread::JoinHandle<()>>,
}

impl PowerHandle for WindowsThreadHandle {}

impl Drop for WindowsThreadHandle {
    fn drop(&mut self) {
        if let Some(tx) = self.signal.take() {
            drop(tx);
        }
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

fn flags_for(opts: ResolvedOptions) -> EXECUTION_STATE {
    let mut state = ES_CONTINUOUS;
    if opts.system {
        state |= ES_SYSTEM_REQUIRED;
    }
    if opts.display {
        state |= ES_DISPLAY_REQUIRED;
    }
    // Windows has no direct "disk idle" inhibitor; system-required is the
    // closest equivalent. If only `disk` is set, fall back to system.
    if !opts.system && !opts.display && opts.disk {
        state |= ES_SYSTEM_REQUIRED;
    }
    // If nothing was set, still inhibit system idle to avoid a silent no-op.
    if state == ES_CONTINUOUS {
        state |= ES_SYSTEM_REQUIRED;
    }
    state
}

impl PowerBackend for WindowsPowerBackend {
    fn inhibit(
        &self,
        _token: &str,
        options: ResolvedOptions,
        _reason: &str,
    ) -> Result<Box<dyn PowerHandle>, AppError> {
        let (signal_tx, signal_rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), AppError>>(1);
        let state = flags_for(options);

        let join = thread::Builder::new()
            .name("asyar-power-inhibitor".into())
            .spawn(move || {
                let applied = unsafe { SetThreadExecutionState(state) };
                if applied == EXECUTION_STATE(0) {
                    let _ = ready_tx.send(Err(AppError::Power(
                        "SetThreadExecutionState returned 0".into(),
                    )));
                    return;
                }
                let _ = ready_tx.send(Ok(()));
                // Park until the sender is dropped (Drop of handle).
                let _ = signal_rx.recv();
                unsafe {
                    SetThreadExecutionState(ES_CONTINUOUS);
                }
            })
            .map_err(|e| {
                AppError::Power(format!("failed to spawn inhibitor thread: {e}"))
            })?;

        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Box::new(WindowsThreadHandle {
                signal: Some(signal_tx),
                join: Some(join),
            })),
            Ok(Err(e)) => Err(e),
            Err(e) => Err(AppError::Power(format!(
                "inhibitor thread died early: {e}"
            ))),
        }
    }
}
