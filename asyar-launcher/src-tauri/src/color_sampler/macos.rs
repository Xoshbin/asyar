//! macOS eyedropper via `NSColorSampler` — the system magnifier loupe.
//! Needs NO Screen Recording permission. The API is callback-based and
//! main-thread-only: the sampler object is parked in a main-thread
//! `thread_local` so it stays alive until AppKit fires the handler.

use crate::color_sampler::PickedColor;
use crate::error::AppError;
use block2::RcBlock;
use objc2::rc::Retained;
use objc2_app_kit::{NSColor, NSColorSampler, NSColorSpace};
use std::cell::RefCell;
use std::sync::Mutex;
use tauri::AppHandle;

thread_local! {
    static ACTIVE_SAMPLER: RefCell<Option<Retained<NSColorSampler>>> = const { RefCell::new(None) };
}

pub async fn pick_color(app: &AppHandle) -> Result<Option<PickedColor>, AppError> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Option<PickedColor>, AppError>>();
    // The selection handler is a `Fn` block — a oneshot sender is single-use,
    // so it lives in a take-once slot.
    let slot = Mutex::new(Some(tx));

    app.run_on_main_thread(move || {
        let send = move |result: Result<Option<PickedColor>, AppError>| {
            if let Ok(mut guard) = slot.lock() {
                if let Some(tx) = guard.take() {
                    let _ = tx.send(result);
                }
            }
        };

        if ACTIVE_SAMPLER.with(|s| s.borrow().is_some()) {
            send(Err(AppError::Platform(
                "a screen color pick is already in progress".into(),
            )));
            return;
        }

        let handler = RcBlock::new(move |color: *mut NSColor| {
            let picked = unsafe { color.as_ref() }.and_then(nscolor_to_picked);
            ACTIVE_SAMPLER.with(|s| {
                let _ = s.borrow_mut().take();
            });
            send(Ok(picked));
        });

        let sampler = unsafe { NSColorSampler::new() };
        // Parked BEFORE show so the object outlives this closure; the
        // handler above releases it when AppKit calls back.
        ACTIVE_SAMPLER.with(|s| {
            *s.borrow_mut() = Some(sampler.clone());
        });
        unsafe { sampler.showSamplerWithSelectionHandler(&handler) };
    })
    .map_err(|e| AppError::Platform(format!("failed to reach the main thread: {e}")))?;

    rx.await
        .map_err(|_| AppError::Platform("color sampler closed without a result".into()))?
}

fn nscolor_to_picked(color: &NSColor) -> Option<PickedColor> {
    let srgb = unsafe { NSColorSpace::sRGBColorSpace() };
    let converted = unsafe { color.colorUsingColorSpace(&srgb) }?;
    let (r, g, b) = unsafe {
        (
            converted.redComponent(),
            converted.greenComponent(),
            converted.blueComponent(),
        )
    };
    Some(PickedColor::from_unit_rgb(r, g, b))
}
