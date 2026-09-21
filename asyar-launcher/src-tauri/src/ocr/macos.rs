//! macOS implementation of Screen Snippet Capture and Local OCR via Apple Vision Framework.

use crate::error::AppError;
use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2_foundation::{NSData, NSString};
use std::path::PathBuf;
use std::process::Command;

#[link(name = "Vision", kind = "framework")]
extern "C" {}

/// Interactively captures a region of the screen using macOS `/usr/sbin/screencapture`.
///
/// Uses `-i` (interactive) and `-r` (no DPI metadata).
/// If the user presses Escape to cancel, `screencapture` exits with non-zero or
/// no file is produced; this returns `Ok(None)`.
pub fn capture_screen_snippet() -> Result<Option<PathBuf>, AppError> {
    let temp_path = std::env::temp_dir().join(format!("asyar_ocr_{}.png", uuid::Uuid::new_v4()));
    let status = Command::new("/usr/sbin/screencapture")
        .args(["-i", "-r", temp_path.to_str().unwrap_or_default()])
        .status();

    match status {
        Ok(s) if s.success() && temp_path.is_file() => {
            if let Ok(metadata) = std::fs::metadata(&temp_path) {
                if metadata.len() > 0 {
                    return Ok(Some(temp_path));
                }
            }
            let _ = std::fs::remove_file(&temp_path);
            Ok(None)
        }
        _ => {
            if temp_path.exists() {
                let _ = std::fs::remove_file(&temp_path);
            }
            Ok(None)
        }
    }
}

/// Ensures the Vision framework bundle is loaded in the current process.
pub fn ensure_vision_loaded() -> Result<(), AppError> {
    if AnyClass::get("VNRecognizeTextRequest").is_some() {
        return Ok(());
    }
    unsafe {
        let bundle_cls = AnyClass::get("NSBundle")
            .ok_or_else(|| AppError::Platform("NSBundle class not available".into()))?;
        let path = NSString::from_str("/System/Library/Frameworks/Vision.framework");
        let bundle: *mut AnyObject = msg_send![bundle_cls, bundleWithPath: &*path];
        if !bundle.is_null() {
            let loaded: Bool = msg_send![bundle, load];
            if !loaded.as_bool() {
                return Err(AppError::Platform("Failed to load Vision.framework".into()));
            }
        }
    }
    if AnyClass::get("VNRecognizeTextRequest").is_some() {
        Ok(())
    } else {
        Err(AppError::Platform(
            "Vision framework VNRecognizeTextRequest not available".into(),
        ))
    }
}

/// Runs Apple's native Vision framework OCR (`VNRecognizeTextRequest`) on image bytes.
///
/// Executes 100% locally and offline via hardware acceleration (Apple Neural Engine / GPU).
/// Uses `VNRequestTextRecognitionLevelAccurate` for highest precision.
pub fn recognize_text(image_bytes: &[u8]) -> Result<String, AppError> {
    if image_bytes.is_empty() {
        return Err(AppError::Platform("Image data is empty".into()));
    }
    ensure_vision_loaded()?;

    unsafe {
        let handler_cls = AnyClass::get("VNImageRequestHandler")
            .ok_or_else(|| AppError::Platform("VNImageRequestHandler class not found".into()))?;
        let req_cls = AnyClass::get("VNRecognizeTextRequest")
            .ok_or_else(|| AppError::Platform("VNRecognizeTextRequest class not found".into()))?;
        let arr_cls = AnyClass::get("NSArray")
            .ok_or_else(|| AppError::Platform("NSArray class not found".into()))?;

        let ns_data = NSData::with_bytes(image_bytes);
        let handler: *mut AnyObject = msg_send![handler_cls, alloc];
        let handler: *mut AnyObject = msg_send![
            handler,
            initWithData: &*ns_data
            options: std::ptr::null::<AnyObject>()
        ];
        if handler.is_null() {
            return Err(AppError::Platform(
                "Failed to create VNImageRequestHandler".into(),
            ));
        }
        let handler = Retained::from_raw(handler)
            .ok_or_else(|| AppError::Platform("Failed to retain VNImageRequestHandler".into()))?;

        let request: *mut AnyObject = msg_send![req_cls, alloc];
        let request: *mut AnyObject = msg_send![request, init];
        if request.is_null() {
            return Err(AppError::Platform(
                "Failed to create VNRecognizeTextRequest".into(),
            ));
        }
        let request = Retained::from_raw(request)
            .ok_or_else(|| AppError::Platform("Failed to retain VNRecognizeTextRequest".into()))?;

        // 0 = VNRequestTextRecognitionLevelAccurate
        let _: () = msg_send![&*request, setRecognitionLevel: 0isize];
        let _: () = msg_send![&*request, setUsesLanguageCorrection: Bool::YES];

        let req_ptr = Retained::as_ptr(&request);
        let requests: *mut AnyObject = msg_send![arr_cls, arrayWithObject: req_ptr];
        if requests.is_null() {
            return Err(AppError::Platform(
                "Failed to create requests NSArray".into(),
            ));
        }

        let mut error: *mut AnyObject = std::ptr::null_mut();
        let success: Bool = msg_send![&*handler, performRequests: requests error: &mut error];
        if !success.as_bool() {
            let err_desc = if !error.is_null() {
                let desc: *mut NSString = msg_send![error, localizedDescription];
                if !desc.is_null() {
                    (&*desc).to_string()
                } else {
                    "unknown error".to_string()
                }
            } else {
                "unknown error".to_string()
            };
            return Err(AppError::Platform(format!(
                "OCR request failed: {err_desc}"
            )));
        }

        let results: *mut AnyObject = msg_send![&*request, results];
        if results.is_null() {
            return Ok(String::new());
        }

        let count: usize = msg_send![results, count];
        let mut lines = Vec::with_capacity(count);
        for i in 0..count {
            let observation: *mut AnyObject = msg_send![results, objectAtIndex: i];
            if observation.is_null() {
                continue;
            }
            let candidates: *mut AnyObject = msg_send![observation, topCandidates: 1usize];
            if candidates.is_null() {
                continue;
            }
            let cand_count: usize = msg_send![candidates, count];
            if cand_count > 0 {
                let cand: *mut AnyObject = msg_send![candidates, objectAtIndex: 0usize];
                if !cand.is_null() {
                    let ns_str: *mut NSString = msg_send![cand, string];
                    if !ns_str.is_null() {
                        let text = (&*ns_str).to_string();
                        if !text.is_empty() {
                            lines.push(text);
                        }
                    }
                }
            }
        }

        Ok(lines.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_bytes_rejected() {
        let err = recognize_text(&[]).expect_err("empty bytes must return error");
        assert!(matches!(err, AppError::Platform(_)));
    }

    #[test]
    fn test_ensure_vision_loaded() {
        ensure_vision_loaded().expect("Vision.framework should load on macOS");
        assert!(AnyClass::get("VNRecognizeTextRequest").is_some());
    }

    #[test]
    fn test_recognize_text_blank_image_returns_empty_string() {
        let img = image::RgbaImage::new(10, 10);
        let mut bytes = Vec::new();
        img.write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .expect("PNG write should succeed");
        let result = recognize_text(&bytes).expect("recognize_text on blank PNG should succeed");
        assert_eq!(result, "");
    }
}
