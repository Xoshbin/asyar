//! Screen OCR service ("Capture Text from Screen").
//!
//! Provides on-device, privacy-preserving interactive screen snippet capture and
//! local text recognition. Extracted text is checked against Asyar's Layer 2
//! secret redaction engine before being written to the system clipboard and
//! signaled via an Asyar native HUD notification.

use crate::error::AppError;
use crate::AppState;
use std::path::PathBuf;
use tauri::Manager;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

/// Captures a screen snippet interactively, saving it to a temporary image file.
///
/// Returns `Ok(None)` if the user cancelled the capture (e.g. pressed Escape).
pub fn capture_screen_snippet() -> Result<Option<PathBuf>, AppError> {
    #[cfg(target_os = "macos")]
    {
        macos::capture_screen_snippet()
    }
    #[cfg(target_os = "windows")]
    {
        windows::capture_screen_snippet()
    }
    #[cfg(target_os = "linux")]
    {
        linux::capture_screen_snippet()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err(AppError::Platform(
            "Screen capture is not supported on this platform".into(),
        ))
    }
}

/// Runs local on-device OCR on the provided image bytes.
pub fn recognize_text(image_bytes: &[u8]) -> Result<String, AppError> {
    #[cfg(target_os = "macos")]
    {
        macos::recognize_text(image_bytes)
    }
    #[cfg(target_os = "windows")]
    {
        windows::recognize_text(image_bytes)
    }
    #[cfg(target_os = "linux")]
    {
        linux::recognize_text(image_bytes)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = image_bytes;
        Err(AppError::Platform(
            "OCR is not supported on this platform".into(),
        ))
    }
}

/// Result of evaluating OCR text for clipboard copy and HUD messaging.
#[derive(Debug, PartialEq, Eq)]
pub enum OcrEvaluation {
    /// No text was found (or only whitespace). Contains the HUD notification message.
    Empty { hud_message: String },
    /// Text was recognized, redacted, and prepared for clipboard.
    Success {
        redacted_text: String,
        hud_message: String,
    },
}

/// Evaluates raw OCR text: applies secret redaction and determines HUD notification copy.
pub fn evaluate_ocr_text(raw_text: &str) -> OcrEvaluation {
    let trimmed = raw_text.trim();
    if trimmed.is_empty() {
        return OcrEvaluation::Empty {
            hud_message: "No text found in selected area".to_string(),
        };
    }

    let redaction = crate::secret_detection::redact(trimmed);
    let content = redaction.content;

    let hud_message = if !content.contains('\n') && content.chars().count() <= 30 {
        format!("Text copied: \"{}\"", content)
    } else {
        "Text copied to clipboard".to_string()
    };

    OcrEvaluation::Success {
        redacted_text: content,
        hud_message,
    }
}

/// Orchestrates full Screen OCR flow:
/// 1. Hides/parks launcher window
/// 2. Spawns interactive screen capture overlay
/// 3. Runs local OCR on the snippet
/// 4. Cleans up temp files immediately
/// 5. Writes text to clipboard & shows HUD notification
pub async fn capture_screen_text(
    app_handle: &tauri::AppHandle,
    _state: &tauri::State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    // 1. Hide/park launcher on main thread so it is not captured in the screen snippet
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let app_clone = app_handle.clone();
    app_handle
        .run_on_main_thread(move || {
            let app_state = app_clone.state::<AppState>();
            let _ = crate::commands::app::hide(app_clone.clone(), app_state);
            let _ = tx.send(());
        })
        .map_err(|e| AppError::Platform(format!("failed to dispatch hide to main thread: {e}")))?;
    let _ = rx.await;
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // 2. Interactive screen selection
    let snippet_opt = tauri::async_runtime::spawn_blocking(capture_screen_snippet)
        .await
        .map_err(|e| AppError::Platform(format!("screen capture task failed: {e}")))?;

    let temp_path = match snippet_opt? {
        Some(path) => path,
        None => {
            // User cancelled snippet capture (e.g. pressed Escape)
            return Ok(None);
        }
    };

    // 3. Read image bytes and clean up file immediately
    let image_bytes = std::fs::read(&temp_path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        AppError::Io(e)
    })?;
    let _ = std::fs::remove_file(&temp_path);

    // 4. Local on-device OCR
    let raw_text = tauri::async_runtime::spawn_blocking(move || recognize_text(&image_bytes))
        .await
        .map_err(|e| AppError::Platform(format!("OCR task failed: {e}")))??;

    // 5. Evaluate text, secret redaction, clipboard write, and HUD
    match evaluate_ocr_text(&raw_text) {
        OcrEvaluation::Empty { hud_message } => {
            let app_clone = app_handle.clone();
            let _ = app_handle.run_on_main_thread(move || {
                let _ = crate::hud_window::service::show(&app_clone, hud_message, 2000, false);
            });
            Ok(None)
        }
        OcrEvaluation::Success {
            redacted_text,
            hud_message,
        } => {
            // Record secret detection metrics if state is available
            if let Some(sec_state) =
                app_handle.try_state::<crate::secret_detection::SecretDetectionState>()
            {
                let redaction = crate::secret_detection::redact(&redacted_text);
                sec_state.record(&redaction.kinds);
            }

            // Write to system clipboard
            let mut clipboard = arboard::Clipboard::new()
                .map_err(|e| AppError::Platform(format!("failed to open clipboard: {e}")))?;
            clipboard
                .set_text(&redacted_text)
                .map_err(|e| AppError::Platform(format!("failed to write clipboard: {e}")))?;

            // Show HUD notification on main thread
            let app_clone = app_handle.clone();
            let _ = app_handle.run_on_main_thread(move || {
                let _ = crate::hud_window::service::show(&app_clone, hud_message, 2000, false);
            });

            Ok(Some(redacted_text))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_evaluate_empty_or_whitespace_text() {
        let res = evaluate_ocr_text("");
        assert!(matches!(res, OcrEvaluation::Empty { .. }));
        if let OcrEvaluation::Empty { hud_message } = res {
            assert_eq!(hud_message, "No text found in selected area");
        }

        let res2 = evaluate_ocr_text("   \n\t  ");
        assert!(matches!(res2, OcrEvaluation::Empty { .. }));
    }

    #[test]
    fn test_evaluate_plain_text_short_preview() {
        let res = evaluate_ocr_text("Hello World");
        match res {
            OcrEvaluation::Success {
                redacted_text,
                hud_message,
            } => {
                assert_eq!(redacted_text, "Hello World");
                assert_eq!(hud_message, "Text copied: \"Hello World\"");
            }
            _ => panic!("expected Success"),
        }
    }

    #[test]
    fn test_evaluate_multiline_text_standard_hud() {
        let res = evaluate_ocr_text("Line 1\nLine 2\nLine 3");
        match res {
            OcrEvaluation::Success {
                redacted_text,
                hud_message,
            } => {
                assert_eq!(redacted_text, "Line 1\nLine 2\nLine 3");
                assert_eq!(hud_message, "Text copied to clipboard");
            }
            _ => panic!("expected Success"),
        }
    }

    #[test]
    fn test_evaluate_redacts_secrets_in_text() {
        let res = evaluate_ocr_text("API key: AKIAIOSFODNN7EXAMPLE done");
        match res {
            OcrEvaluation::Success {
                redacted_text,
                hud_message,
            } => {
                assert!(redacted_text.contains("[redacted: aws_access_key]"));
                assert!(!redacted_text.contains("AKIAIOSFODNN7EXAMPLE"));
                assert!(hud_message.contains("Text copied"));
            }
            _ => panic!("expected Success"),
        }
    }
}
