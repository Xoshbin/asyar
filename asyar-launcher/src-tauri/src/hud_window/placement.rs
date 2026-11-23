/// Work area and pointer in physical desktop pixels, including negative monitor origins.
#[derive(Clone, Debug)]
pub struct Placement {
    pub work: [f64; 4],
    pub scale: f64,
    pub cursor: Option<[f64; 2]>,
}

impl Placement {
    /// Maximum logical window dimensions. Leave room around the card on small displays.
    pub fn limits(&self) -> (f64, f64) {
        let [_, _, width, height] = self.work;
        (
            (width / self.scale - 16.0).clamp(1.0, 576.0),
            (height / self.scale * 0.65).clamp(1.0, 560.0),
        )
    }

    pub fn origin(&self, width: f64, height: f64) -> (i32, i32) {
        let [left, top, screen_width, screen_height] = self.work;
        let width = width * self.scale;
        let height = height * self.scale;
        let right = left + screen_width;
        let bottom = top + screen_height;
        let (x, y) = if let Some([cx, cy]) = self.cursor {
            let gap = 16.0 * self.scale;
            let beside = |point, size, end| {
                if point + gap + size <= end {
                    point + gap
                } else {
                    point - gap - size
                }
            };
            (beside(cx, width, right), beside(cy, height, bottom))
        } else {
            (
                left + (screen_width - width) / 2.0,
                bottom - height - 80.0 * self.scale,
            )
        };
        (
            x.clamp(left, (right - width).max(left)).round() as i32,
            y.clamp(top, (bottom - height).max(top)).round() as i32,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fits_beside_cursor_on_a_scaled_left_hand_monitor() {
        let placement = Placement {
            work: [-2560.0, 0.0, 2560.0, 1400.0],
            scale: 2.0,
            cursor: Some([-10.0, 1390.0]),
        };
        let (x, y) = placement.origin(400.0, 100.0);
        assert_eq!((x, y), (-842, 1158));
    }

    #[test]
    fn default_centers_short_messages_above_the_bottom_edge() {
        let placement = Placement {
            work: [100.0, 20.0, 1000.0, 700.0],
            scale: 1.0,
            cursor: None,
        };
        assert_eq!(placement.origin(200.0, 60.0), (500, 580));
    }
}
