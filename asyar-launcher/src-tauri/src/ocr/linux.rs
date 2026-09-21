//! Linux screen snippet capture and OCR fallback.

use crate::error::AppError;
use std::path::PathBuf;

pub fn capture_screen_snippet() -> Result<Option<PathBuf>, AppError> {
    Err(AppError::Platform(
        "Screen capture OCR is not yet supported on Linux".into(),
    ))
}

pub fn recognize_text(_bytes: &[u8]) -> Result<String, AppError> {
    Err(AppError::Platform(
        "Screen capture OCR is not yet supported on Linux".into(),
    ))
}
