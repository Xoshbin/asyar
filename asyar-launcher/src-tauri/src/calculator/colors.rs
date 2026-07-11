//! Color format conversions: hex ↔ rgb ↔ hsl.

use regex::Regex;
use std::sync::OnceLock;

use super::{CalcKind, CalcResult};

#[derive(Clone, Copy, PartialEq)]
enum ColorFormat {
    Hex,
    Rgb,
    Hsl,
}

struct Patterns {
    target: Regex,
    hex: Regex,
    rgb: Regex,
    hsl: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        target: Regex::new(r"(?i)^(.+?)\s+(?:to|in|as)\s+(hex|rgb|hsl)$").unwrap(),
        hex: Regex::new(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$").unwrap(),
        rgb: Regex::new(r"(?i)^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$").unwrap(),
        hsl: Regex::new(
            r"(?i)^hsl\(\s*(\d{1,3}(?:\.\d+)?)\s*,\s*(\d{1,3}(?:\.\d+)?)%\s*,\s*(\d{1,3}(?:\.\d+)?)%\s*\)$",
        )
        .unwrap(),
    })
}

fn parse_color(s: &str) -> Option<((u8, u8, u8), ColorFormat)> {
    let p = patterns();
    if let Some(c) = p.hex.captures(s) {
        let hex = &c[1];
        let expanded: String = if hex.len() == 3 {
            hex.chars().flat_map(|ch| [ch, ch]).collect()
        } else {
            hex.to_string()
        };
        let n = u32::from_str_radix(&expanded, 16).ok()?;
        return Some((((n >> 16) as u8, (n >> 8) as u8, n as u8), ColorFormat::Hex));
    }
    if let Some(c) = p.rgb.captures(s) {
        let parse = |m: &str| -> Option<u8> {
            let v: u32 = m.parse().ok()?;
            (v <= 255).then_some(v as u8)
        };
        return Some((
            (parse(&c[1])?, parse(&c[2])?, parse(&c[3])?),
            ColorFormat::Rgb,
        ));
    }
    if let Some(c) = p.hsl.captures(s) {
        let h: f64 = c[1].parse().ok()?;
        let s_pct: f64 = c[2].parse().ok()?;
        let l_pct: f64 = c[3].parse().ok()?;
        if h >= 360.0 || s_pct > 100.0 || l_pct > 100.0 {
            return None;
        }
        return Some((
            hsl_to_rgb(h, s_pct / 100.0, l_pct / 100.0),
            ColorFormat::Hsl,
        ));
    }
    None
}

fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let (r, g, b) = (r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if max == min {
        return (0.0, 0.0, l);
    }
    let delta = max - min;
    let s = if l > 0.5 {
        delta / (2.0 - max - min)
    } else {
        delta / (max + min)
    };
    let h = if max == r {
        ((g - b) / delta).rem_euclid(6.0)
    } else if max == g {
        (b - r) / delta + 2.0
    } else {
        (r - g) / delta + 4.0
    } * 60.0;
    (h, s, l)
}

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (u8, u8, u8) {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h / 60.0).rem_euclid(2.0) - 1.0).abs());
    let m = l - c / 2.0;
    let (r, g, b) = match h {
        h if h < 60.0 => (c, x, 0.0),
        h if h < 120.0 => (x, c, 0.0),
        h if h < 180.0 => (0.0, c, x),
        h if h < 240.0 => (0.0, x, c),
        h if h < 300.0 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let to_byte = |v: f64| ((v + m) * 255.0).round().clamp(0.0, 255.0) as u8;
    (to_byte(r), to_byte(g), to_byte(b))
}

fn render(rgb: (u8, u8, u8), format: ColorFormat) -> String {
    let (r, g, b) = rgb;
    match format {
        ColorFormat::Hex => format!("#{r:02X}{g:02X}{b:02X}"),
        ColorFormat::Rgb => format!("rgb({r}, {g}, {b})"),
        ColorFormat::Hsl => {
            let (h, s, l) = rgb_to_hsl(r, g, b);
            format!(
                "hsl({}, {}%, {}%)",
                h.round() as i64,
                (s * 100.0).round() as i64,
                (l * 100.0).round() as i64
            )
        }
    }
}

/// Convert between color formats. Accepts `#ff8800`, `#f80`,
/// `rgb(255, 136, 0)`, `hsl(32, 100%, 50%)`, each optionally followed by
/// `to hex|rgb|hsl`.
pub fn evaluate_color(query: &str) -> Option<CalcResult> {
    let p = patterns();
    let q = query.trim();

    let (color_str, target) = match p.target.captures(q) {
        Some(c) => {
            let t = match c[2].to_ascii_lowercase().as_str() {
                "hex" => ColorFormat::Hex,
                "rgb" => ColorFormat::Rgb,
                _ => ColorFormat::Hsl,
            };
            (c[1].to_string(), Some(t))
        }
        None => (q.to_string(), None),
    };

    let (rgb, source_format) = parse_color(&color_str)?;
    // Default: hex shows rgb; rgb/hsl show hex.
    let target = target.unwrap_or(match source_format {
        ColorFormat::Hex => ColorFormat::Rgb,
        _ => ColorFormat::Hex,
    });

    let all = [ColorFormat::Hex, ColorFormat::Rgb, ColorFormat::Hsl];
    let detail = all
        .iter()
        .filter(|f| **f != target)
        .map(|f| render(rgb, *f))
        .collect::<Vec<_>>()
        .join(" · ");

    Some(CalcResult::new(
        render(rgb, target),
        detail,
        CalcKind::Color,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calculator::CalcKind;

    #[test]
    fn hex_defaults_to_rgb() {
        let r = evaluate_color("#ff8800").unwrap();
        assert_eq!(r.value, "rgb(255, 136, 0)");
        assert_eq!(r.kind, CalcKind::Color);
        assert!(
            r.detail.contains("hsl(32, 100%, 50%)"),
            "detail: {}",
            r.detail
        );
    }

    #[test]
    fn short_hex_expands() {
        assert_eq!(evaluate_color("#f80").unwrap().value, "rgb(255, 136, 0)");
    }

    #[test]
    fn hex_to_hsl() {
        assert_eq!(
            evaluate_color("#ff8800 to hsl").unwrap().value,
            "hsl(32, 100%, 50%)"
        );
    }

    #[test]
    fn rgb_defaults_to_hex() {
        let r = evaluate_color("rgb(255, 136, 0)").unwrap();
        assert_eq!(r.value, "#FF8800");
    }

    #[test]
    fn rgb_to_hsl_conversion() {
        assert_eq!(
            evaluate_color("rgb(255,136,0) to hsl").unwrap().value,
            "hsl(32, 100%, 50%)"
        );
    }

    #[test]
    fn hsl_to_hex() {
        assert_eq!(
            evaluate_color("hsl(32, 100%, 50%)").unwrap().value,
            "#FF8800"
        );
    }

    #[test]
    fn pure_colors_roundtrip() {
        assert_eq!(evaluate_color("#000000").unwrap().value, "rgb(0, 0, 0)");
        assert_eq!(
            evaluate_color("#ffffff").unwrap().value,
            "rgb(255, 255, 255)"
        );
        assert_eq!(
            evaluate_color("hsl(0, 100%, 50%)").unwrap().value,
            "#FF0000"
        );
    }

    #[test]
    fn rejects_invalid_colors() {
        assert!(evaluate_color("#xyz").is_none());
        assert!(evaluate_color("#ff88").is_none());
        assert!(evaluate_color("rgb(300, 0, 0)").is_none());
        assert!(evaluate_color("2+2").is_none());
    }
}
