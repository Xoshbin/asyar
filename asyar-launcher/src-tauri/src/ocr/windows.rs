//! Windows implementation of Screen Snippet Capture and Local OCR via Windows.Media.Ocr.

use crate::error::AppError;
use std::path::PathBuf;

/// Captures a screen snippet interactively on Windows.
///
/// Note: Interactive UI snippet capture on Windows requires an interactive overlay or
/// Snipping Tool invocation; currently falls back to platform error until full snippet
/// overlay integration is added. Headless image recognition via `recognize_text` is fully supported.
pub fn capture_screen_snippet() -> Result<Option<PathBuf>, AppError> {
    Err(AppError::Platform(
        "Interactive screen capture snippet is not yet implemented on Windows. Use headless OCR with an image file.".into(),
    ))
}

/// Runs local on-device OCR on image bytes using `Windows.Media.Ocr.OcrEngine`.
///
/// Uses Windows 10/11 built-in offline OCR with user profile languages.
pub fn recognize_text(image_bytes: &[u8]) -> Result<String, AppError> {
    if image_bytes.is_empty() {
        return Ok(String::new());
    }

    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

    let stream = InMemoryRandomAccessStream::new()
        .map_err(|e| AppError::Platform(format!("Failed to create WinRT stream: {e}")))?;

    let writer = DataWriter::CreateDataWriter(&stream)
        .map_err(|e| AppError::Platform(format!("Failed to create WinRT DataWriter: {e}")))?;

    writer
        .WriteBytes(image_bytes)
        .map_err(|e| AppError::Platform(format!("Failed to write bytes to WinRT stream: {e}")))?;

    writer
        .StoreAsync()
        .map_err(|e| AppError::Platform(format!("Failed to store bytes to WinRT stream: {e}")))?
        .join()
        .map_err(|e| AppError::Platform(format!("WinRT StoreAsync failed: {e}")))?;

    writer
        .FlushAsync()
        .map_err(|e| AppError::Platform(format!("Failed to flush WinRT stream: {e}")))?
        .join()
        .map_err(|e| AppError::Platform(format!("WinRT FlushAsync failed: {e}")))?;

    stream
        .Seek(0)
        .map_err(|e| AppError::Platform(format!("Failed to seek WinRT stream: {e}")))?;

    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(|e| AppError::Platform(format!("Failed to create BitmapDecoder: {e}")))?
        .join()
        .map_err(|e| AppError::Platform(format!("WinRT BitmapDecoder::CreateAsync failed: {e}")))?;

    let software_bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|e| AppError::Platform(format!("Failed to get SoftwareBitmap: {e}")))?
        .join()
        .map_err(|e| AppError::Platform(format!("WinRT GetSoftwareBitmapAsync failed: {e}")))?;

    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| AppError::Platform(format!("Failed to initialize OcrEngine: {e}")))?;

    let ocr_result = engine
        .RecognizeAsync(&software_bitmap)
        .map_err(|e| AppError::Platform(format!("Failed to run RecognizeAsync: {e}")))?
        .join()
        .map_err(|e| AppError::Platform(format!("WinRT RecognizeAsync failed: {e}")))?;

    let lines = ocr_result
        .Lines()
        .map_err(|e| AppError::Platform(format!("Failed to get OCR lines: {e}")))?;

    let mut recognized = Vec::new();
    for line in lines {
        if let Ok(line_text) = line.Text() {
            recognized.push(line_text.to_string());
        }
    }

    Ok(recognized.join("\n"))
}
