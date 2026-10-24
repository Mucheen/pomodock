// Pure physical-coordinate geometry, shared by the native commands and tests.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn choose_monitor<T>(current: Option<T>, remembered: Option<T>, fallback: Option<T>, restoring: bool) -> Option<T> {
    if restoring { remembered.or(current).or(fallback) } else { current.or(remembered).or(fallback) }
}

pub fn dock_bounds(area: Bounds, scale: f64, expanded: (f64, f64), ratio: f64, collapsed: bool) -> Bounds {
    let width = (if collapsed { 36.0 } else { expanded.0.min(area.width / scale) } * scale).round();
    let height = (if collapsed { 76.0 } else { expanded.1.min(area.height / scale) } * scale).round();
    let center = area.y + (area.height - 76.0 * scale).max(0.0) * ratio + 38.0 * scale;
    Bounds {
        x: (area.x + area.width - width).round(),
        y: (center - height / 2.0).clamp(area.y, area.y + (area.height - height).max(0.0)).round(),
        width,
        height,
    }
}

pub fn capture_ratio(actual: Bounds, expected: Bounds, area: Bounds, scale: f64, previous: f64) -> f64 {
    let intersects = actual.x < area.x + area.width && actual.x + actual.width > area.x
        && actual.y < area.y + area.height && actual.y + actual.height > area.y;
    // A clamped expanded panel must not move a top/bottom tab on every toggle.
    // Moving horizontally alone should not change that vertical anchor either.
    if !intersects || ((actual.y - expected.y).abs() <= 1.0 && (actual.height - expected.height).abs() <= 1.0) {
        return previous;
    }
    let travel = (area.height - 76.0 * scale).max(0.0);
    if travel == 0.0 { return 0.0; }
    ((actual.y + actual.height / 2.0 - 38.0 * scale - area.y) / travel).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_monitor_wins_over_stale_memory_but_startup_restores_memory() {
        assert_eq!(choose_monitor(Some("B"), Some("A"), Some("A"), false), Some("B"));
        assert_eq!(choose_monitor(Some("B"), Some("A"), Some("A"), true), Some("A"));
        assert_eq!(choose_monitor(Some("B"), None, Some("A"), true), Some("B"));
        assert_eq!(choose_monitor(None, Some("B"), Some("A"), false), Some("B"));
        assert_eq!(choose_monitor(None, None, Some("A"), false), Some("A"));
        assert_eq!(choose_monitor::<&str>(None, None, None, false), None);
    }

    #[test]
    fn moved_window_docks_on_negative_coordinate_hidpi_screen() {
        let area = Bounds { x:-3840.0, y:80.0, width:3840.0, height:2080.0 };
        let expected = dock_bounds(area, 2.0, (392.0,620.0), 0.5, false);
        let actual = Bounds { x:-2800.0, y:300.0, width:784.0, height:1240.0 };
        let ratio = capture_ratio(actual, expected, area, 2.0, 0.5);
        let compact = dock_bounds(area, 2.0, (392.0,620.0), ratio, true);
        assert_eq!(compact, Bounds { x:-72.0, y:844.0, width:72.0, height:152.0 });
        assert_eq!(compact.y + compact.height/2.0, actual.y + actual.height/2.0);
    }

    #[test]
    fn moved_window_docks_on_vertically_stacked_screen() {
        let area = Bounds { x:100.0, y:-1200.0, width:1800.0, height:1100.0 };
        let expected = dock_bounds(area, 1.0, (392.0,620.0), 1.0, false);
        let actual = Bounds { x:1000.0, y:-1000.0, width:392.0, height:620.0 };
        let ratio = capture_ratio(actual, expected, area, 1.0, 1.0);
        assert_eq!(dock_bounds(area, 1.0, (392.0,620.0), ratio, true), Bounds { x:1864.0, y:-728.0, width:36.0, height:76.0 });
    }

    #[test]
    fn clamped_top_and_bottom_anchors_do_not_drift_when_toggled() {
        let area = Bounds { x:0.0, y:40.0, width:1400.0, height:900.0 };
        for scale in [1.0, 1.25, 2.0] {
            for initial in [0.0,1.0] {
                let mut ratio = initial;
                for _ in 0..4 {
                    let expanded = dock_bounds(area, scale, (392.0,620.0), ratio, false);
                    ratio = capture_ratio(expanded, expanded, area, scale, ratio);
                    assert_eq!(ratio, initial);
                }
            }
        }
    }

    #[test]
    fn horizontal_move_preserves_clamped_vertical_anchor() {
        let area = Bounds { x:0.0, y:40.0, width:1400.0, height:900.0 };
        let expected = dock_bounds(area, 1.0, (392.0,620.0), 0.0, false);
        let actual = Bounds { x:100.0, ..expected };
        assert_eq!(capture_ratio(actual, expected, area, 1.0, 0.0), 0.0);
    }

    #[test]
    fn removed_screen_and_tiny_work_area_keep_finite_placement() {
        let area = Bounds { x:0.0, y:40.0, width:1200.0, height:800.0 };
        let expected = dock_bounds(area, 1.0, (392.0,620.0), 0.75, false);
        let offscreen = Bounds { x:-1600.0, y:-100.0, ..expected };
        assert_eq!(capture_ratio(offscreen, expected, area, 1.0, 0.75), 0.75);
        let tiny = Bounds { height:60.0, ..area };
        assert_eq!(capture_ratio(Bounds { y:50.0, ..expected }, expected, tiny, 1.0, 0.75), 0.0);
        assert_eq!(dock_bounds(tiny, 1.0, (392.0,620.0), 0.0, true).y, 40.0);
    }
}
