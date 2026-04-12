use crate::error::AppError;
use crate::window_management::types::WindowBounds;
#[cfg(target_os = "linux")]
use crate::window_management::types::WindowBoundsUpdate;

/// Parses xdotool getwindowgeometry --shell output.
/// Expected format: lines of KEY=VALUE, e.g. X=100\nY=200\nWIDTH=1280\nHEIGHT=800
/// This function is platform-independent so its tests run on all CI platforms.
pub fn parse_xdotool_geometry(output: &str) -> Result<WindowBounds, AppError> {
    let mut x = None::<f64>;
    let mut y = None::<f64>;
    let mut width = None::<f64>;
    let mut height = None::<f64>;

    for line in output.lines() {
        if let Some((key, val)) = line.split_once('=') {
            let v: f64 = match val.trim().parse() {
                Ok(n) => n,
                Err(_) => return Err(AppError::Platform(
                    format!("xdotool: invalid value for key {:?}: {:?}", key.trim(), val.trim())
                )),
            };
            match key.trim() {
                "X" => x = Some(v),
                "Y" => y = Some(v),
                "WIDTH" => width = Some(v),
                "HEIGHT" => height = Some(v),
                _ => {}
            }
        }
    }

    match (x, y, width, height) {
        (Some(x), Some(y), Some(width), Some(height)) => {
            Ok(WindowBounds { x, y, width, height })
        }
        _ => Err(AppError::Platform(format!(
            "Failed to parse xdotool geometry output: {output:?}"
        ))),
    }
}

#[cfg(target_os = "linux")]
pub fn capture_active_window_id() -> u64 {
    let output = std::process::Command::new("xdotool")
        .arg("getactivewindow")
        .output();
    match output {
        Ok(out) if out.status.success() => {
            std::str::from_utf8(&out.stdout)
                .ok()
                .and_then(|s| s.trim().parse::<u64>().ok())
                .unwrap_or(0)
        }
        _ => 0,
    }
}

#[cfg(target_os = "linux")]
pub fn check_x11(prev_wid: u64) -> Result<(), AppError> {
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        return Err(AppError::Platform(
            "Window management is not supported on Wayland. \
             Start Asyar in an X11/XOrg session.".to_string(),
        ));
    }
    if prev_wid == 0 {
        return Err(AppError::NotFound(
            "No previous window captured. Ensure xdotool is installed \
             (e.g. `apt install xdotool`).".to_string(),
        ));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn get_window_bounds(prev_wid: u64) -> Result<WindowBounds, AppError> {
    check_x11(prev_wid)?;
    let out = std::process::Command::new("xdotool")
        .args(["getwindowgeometry", "--shell", &prev_wid.to_string()])
        .output()
        .map_err(|e| AppError::Platform(format!("xdotool failed: {e}")))?;
    if !out.status.success() {
        return Err(AppError::Platform(
            format!("xdotool getwindowgeometry failed: {}", String::from_utf8_lossy(&out.stderr))
        ));
    }
    parse_xdotool_geometry(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(target_os = "linux")]
pub fn set_window_bounds(prev_wid: u64, update: &WindowBoundsUpdate) -> Result<(), AppError> {
    check_x11(prev_wid)?;
    let current = get_window_bounds(prev_wid)?;
    let wid = prev_wid.to_string();

    if update.x.is_some() || update.y.is_some() {
        let x = update.x.unwrap_or(current.x) as i64;
        let y = update.y.unwrap_or(current.y) as i64;
        let status = std::process::Command::new("xdotool")
            .args(["windowmove", "--sync", &wid, &x.to_string(), &y.to_string()])
            .status()
            .map_err(|e| AppError::Platform(format!("xdotool windowmove failed: {e}")))?;
        if !status.success() {
            return Err(AppError::Platform("xdotool windowmove returned non-zero".to_string()));
        }
    }

    if update.width.is_some() || update.height.is_some() {
        let w = update.width.unwrap_or(current.width) as u64;
        let h = update.height.unwrap_or(current.height) as u64;
        let status = std::process::Command::new("xdotool")
            .args(["windowsize", "--sync", &wid, &w.to_string(), &h.to_string()])
            .status()
            .map_err(|e| AppError::Platform(format!("xdotool windowsize failed: {e}")))?;
        if !status.success() {
            return Err(AppError::Platform("xdotool windowsize returned non-zero".to_string()));
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn set_window_fullscreen(prev_wid: u64, enable: bool) -> Result<(), AppError> {
    check_x11(prev_wid)?;
    let action = if enable { "--add" } else { "--remove" };
    let status = std::process::Command::new("xdotool")
        .args(["windowstate", action, "FULLSCREEN", &prev_wid.to_string()])
        .status()
        .map_err(|e| AppError::Platform(format!("xdotool windowstate failed: {e}")))?;
    if !status.success() {
        return Err(AppError::Platform("xdotool windowstate returned non-zero".to_string()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_geometry_valid_output() {
        let output = "WINDOW=12345678\nX=100\nY=200\nWIDTH=1280\nHEIGHT=800\nSCREEN=0\n";
        let bounds = parse_xdotool_geometry(output).unwrap();
        assert_eq!(bounds.x, 100.0);
        assert_eq!(bounds.y, 200.0);
        assert_eq!(bounds.width, 1280.0);
        assert_eq!(bounds.height, 800.0);
    }

    #[test]
    fn parse_geometry_missing_field_errors() {
        let output = "X=100\nY=200\nWIDTH=1280\n"; // Missing HEIGHT
        assert!(parse_xdotool_geometry(output).is_err());
    }

    #[test]
    fn parse_geometry_empty_errors() {
        assert!(parse_xdotool_geometry("").is_err());
    }

    // These tests use check_x11 which is Linux-only
    #[cfg(target_os = "linux")]
    #[test]
    fn check_x11_rejects_zero_wid_on_x11() {
        std::env::remove_var("WAYLAND_DISPLAY");
        let result = check_x11(0);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::NotFound(_)));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn check_x11_rejects_wayland() {
        std::env::set_var("WAYLAND_DISPLAY", "wayland-0");
        let result = check_x11(12345);
        std::env::remove_var("WAYLAND_DISPLAY");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("Wayland"));
    }
}
