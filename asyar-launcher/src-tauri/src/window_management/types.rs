use serde::{Deserialize, Serialize};
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WindowBoundsUpdate {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

/// Validates a WindowBoundsUpdate: at least one field must be set, and
/// width/height (if present) must be positive and finite.
pub fn validate_bounds_update(u: &WindowBoundsUpdate) -> Result<(), AppError> {
    if u.x.is_none() && u.y.is_none() && u.width.is_none() && u.height.is_none() {
        return Err(AppError::Validation("At least one of x, y, width, height must be set.".to_string()));
    }
    for (name, val) in [("width", u.width), ("height", u.height)] {
        if let Some(v) = val {
            if !v.is_finite() {
                return Err(AppError::Validation(format!("{name} must be finite")));
            }
            if v <= 0.0 {
                return Err(AppError::Validation(format!("{name} must be positive, got {v}")));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_all_none() {
        let u = WindowBoundsUpdate { x: None, y: None, width: None, height: None };
        assert!(validate_bounds_update(&u).is_err());
    }

    #[test]
    fn accepts_x_only() {
        let u = WindowBoundsUpdate { x: Some(100.0), y: None, width: None, height: None };
        assert!(validate_bounds_update(&u).is_ok());
    }

    #[test]
    fn rejects_zero_width() {
        let u = WindowBoundsUpdate { x: None, y: None, width: Some(0.0), height: None };
        assert!(validate_bounds_update(&u).is_err());
    }

    #[test]
    fn rejects_negative_height() {
        let u = WindowBoundsUpdate { x: None, y: None, width: None, height: Some(-10.0) };
        assert!(validate_bounds_update(&u).is_err());
    }

    #[test]
    fn rejects_nan_width() {
        let u = WindowBoundsUpdate { x: None, y: None, width: Some(f64::NAN), height: None };
        assert!(validate_bounds_update(&u).is_err());
    }

    #[test]
    fn rejects_infinite_height() {
        let u = WindowBoundsUpdate { x: None, y: None, width: None, height: Some(f64::INFINITY) };
        assert!(validate_bounds_update(&u).is_err());
    }

    #[test]
    fn accepts_full_update() {
        let u = WindowBoundsUpdate { x: Some(0.0), y: Some(0.0), width: Some(1280.0), height: Some(800.0) };
        assert!(validate_bounds_update(&u).is_ok());
    }

    #[test]
    fn error_is_validation_variant() {
        let u = WindowBoundsUpdate { x: None, y: None, width: None, height: None };
        let err = validate_bounds_update(&u).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
