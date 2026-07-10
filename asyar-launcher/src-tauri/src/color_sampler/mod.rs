//! Screen color sampling ("eyedropper") service.
//!
//! Cross-platform `pick_color()` with per-platform impls in sibling modules:
//!
//! ```text
//! pick_color(app)
//!   ├─ macOS:   NSColorSampler        (native loupe, main-thread callback)
//!   ├─ Windows: LL mouse/kbd hooks    (click-to-pick + GetPixel, Esc cancels)
//!   └─ Linux:   XDG portal PickColor  (native loupe; x11rb grab fallback)
//! ```
//!
//! Resolves to `Ok(None)` when the user cancels — cancellation is a normal
//! outcome, not an error.

use crate::error::AppError;
use serde::Serialize;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

/// One sampled screen pixel in sRGB.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PickedColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    /// Lowercase `#rrggbb`.
    pub hex: String,
}

impl PickedColor {
    pub fn from_rgb8(r: u8, g: u8, b: u8) -> Self {
        Self {
            r,
            g,
            b,
            hex: format!("#{r:02x}{g:02x}{b:02x}"),
        }
    }

    /// From components in the 0.0–1.0 range (NSColor, portal `(ddd)` result).
    /// Out-of-range and NaN inputs are clamped.
    pub fn from_unit_rgb(r: f64, g: f64, b: f64) -> Self {
        fn to_u8(v: f64) -> u8 {
            // NaN.clamp() stays NaN, so map it to 0.0 first.
            let v = if v.is_nan() { 0.0 } else { v };
            (v.clamp(0.0, 1.0) * 255.0).round() as u8
        }
        Self::from_rgb8(to_u8(r), to_u8(g), to_u8(b))
    }

    /// From a Win32 GDI `COLORREF` (`0x00BBGGRR`).
    pub fn from_colorref(colorref: u32) -> Self {
        Self::from_rgb8(
            (colorref & 0xFF) as u8,
            ((colorref >> 8) & 0xFF) as u8,
            ((colorref >> 16) & 0xFF) as u8,
        )
    }
}

/// Extract one channel from an X11 ZPixmap pixel given the visual's channel
/// mask, scaled up to 8 bits (handles 16-bit visuals with 5/6-bit channels).
pub fn channel_from_mask(pixel: u32, mask: u32) -> u8 {
    if mask == 0 {
        return 0;
    }
    let raw = (pixel & mask) >> mask.trailing_zeros();
    let max = mask >> mask.trailing_zeros();
    ((raw * 255 + max / 2) / max) as u8
}

/// Show the OS eyedropper and resolve with the picked color, or `None` if
/// the user cancelled.
pub async fn pick_color(app: &tauri::AppHandle) -> Result<Option<PickedColor>, AppError> {
    #[cfg(target_os = "macos")]
    {
        macos::pick_color(app).await
    }
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(windows::pick_color_blocking)
            .await
            .map_err(|e| AppError::Platform(format!("color pick task failed: {e}")))?
    }
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(linux::pick_color_blocking)
            .await
            .map_err(|e| AppError::Platform(format!("color pick task failed: {e}")))?
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = app;
        Err(AppError::Platform(
            "screen color picking is not supported on this platform".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_rgb8_formats_lowercase_zero_padded_hex() {
        let c = PickedColor::from_rgb8(26, 43, 60);
        assert_eq!((c.r, c.g, c.b), (26, 43, 60));
        assert_eq!(c.hex, "#1a2b3c");
        assert_eq!(PickedColor::from_rgb8(0, 0, 0).hex, "#000000");
        assert_eq!(PickedColor::from_rgb8(255, 255, 255).hex, "#ffffff");
        assert_eq!(PickedColor::from_rgb8(1, 2, 3).hex, "#010203");
    }

    #[test]
    fn from_unit_rgb_scales_and_rounds() {
        let c = PickedColor::from_unit_rgb(1.0, 0.0, 0.5);
        assert_eq!((c.r, c.g, c.b), (255, 0, 128)); // 0.5 * 255 = 127.5 → 128
        assert_eq!(c.hex, "#ff0080");
    }

    #[test]
    fn from_unit_rgb_clamps_out_of_range_and_nan() {
        let c = PickedColor::from_unit_rgb(-0.25, 1.5, f64::NAN);
        assert_eq!((c.r, c.g, c.b), (0, 255, 0));
    }

    #[test]
    fn from_colorref_uses_bgr_byte_order() {
        // COLORREF layout is 0x00BBGGRR.
        let c = PickedColor::from_colorref(0x00CC_8811);
        assert_eq!((c.r, c.g, c.b), (0x11, 0x88, 0xCC));
        assert_eq!(c.hex, "#1188cc");
    }

    #[test]
    fn channel_from_mask_extracts_full_byte_channels() {
        assert_eq!(channel_from_mask(0x00FF_0000, 0x00FF_0000), 255);
        assert_eq!(channel_from_mask(0x0012_3456, 0x00FF_0000), 0x12);
        assert_eq!(channel_from_mask(0x0012_3456, 0x0000_FF00), 0x34);
        assert_eq!(channel_from_mask(0x0012_3456, 0x0000_00FF), 0x56);
    }

    #[test]
    fn channel_from_mask_scales_narrow_channels_to_8_bits() {
        // 5-bit red channel of an RGB565 visual: max raw value must map to 255.
        assert_eq!(channel_from_mask(0xF800, 0xF800), 255);
        assert_eq!(channel_from_mask(0x0000, 0xF800), 0);
        // 6-bit green channel: max raw value must also map to 255.
        assert_eq!(channel_from_mask(0x07E0, 0x07E0), 255);
    }

    #[test]
    fn channel_from_mask_zero_mask_is_zero() {
        assert_eq!(channel_from_mask(0xFFFF_FFFF, 0), 0);
    }

    #[test]
    fn picked_color_serializes_camel_case_fields() {
        let v = serde_json::to_value(PickedColor::from_rgb8(1, 2, 3)).unwrap();
        assert_eq!(v["r"], 1);
        assert_eq!(v["g"], 2);
        assert_eq!(v["b"], 3);
        assert_eq!(v["hex"], "#010203");
    }
}
