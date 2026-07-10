//! Linux eyedropper.
//!
//! Primary: XDG desktop portal `org.freedesktop.portal.Screenshot.PickColor`
//! — gives the desktop's native magnifier loupe on GNOME/KDE and works on
//! both Wayland and X11. Fallback for X11 sessions without a portal:
//! crosshair pointer grab + 1×1 `GetImage` via x11rb. Pure Wayland without a
//! portal has no sanctioned way to read screen pixels, so the portal error
//! is surfaced as-is there.

use crate::color_sampler::{channel_from_mask, PickedColor};
use crate::error::AppError;
use std::collections::HashMap;

pub fn pick_color_blocking() -> Result<Option<PickedColor>, AppError> {
    match portal_pick() {
        Ok(result) => Ok(result),
        Err(portal_err) => {
            let is_wayland = std::env::var("WAYLAND_DISPLAY").is_ok();
            if is_wayland {
                return Err(portal_err);
            }
            log::debug!("portal PickColor unavailable, falling back to X11 grab: {portal_err}");
            x11_pick()
        }
    }
}

// ── XDG portal ──────────────────────────────────────────────────────────────

fn portal_pick() -> Result<Option<PickedColor>, AppError> {
    use zbus::blocking::{Connection, Proxy};
    use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

    let conn = Connection::session()
        .map_err(|e| AppError::Platform(format!("session bus unreachable: {e}")))?;

    // Predict the Request object path from our unique name + handle_token so
    // we can subscribe to its Response signal BEFORE calling PickColor.
    let unique = conn
        .unique_name()
        .ok_or_else(|| AppError::Platform("session bus connection has no unique name".into()))?
        .as_str()
        .trim_start_matches(':')
        .replace('.', "_");
    let token = format!("asyar_pick_{}", uuid::Uuid::new_v4().simple());
    let predicted_path = format!("/org/freedesktop/portal/desktop/request/{unique}/{token}");

    let request_proxy = Proxy::new(
        &conn,
        "org.freedesktop.portal.Desktop",
        predicted_path.as_str(),
        "org.freedesktop.portal.Request",
    )
    .map_err(|e| AppError::Platform(format!("portal request proxy failed: {e}")))?;
    let mut responses = request_proxy
        .receive_signal("Response")
        .map_err(|e| AppError::Platform(format!("portal Response subscribe failed: {e}")))?;

    let screenshot = Proxy::new(
        &conn,
        "org.freedesktop.portal.Desktop",
        "/org/freedesktop/portal/desktop",
        "org.freedesktop.portal.Screenshot",
    )
    .map_err(|e| AppError::Platform(format!("portal proxy failed: {e}")))?;

    let mut options: HashMap<&str, Value> = HashMap::new();
    options.insert("handle_token", Value::from(token.as_str()));
    let reply = screenshot
        .call_method("PickColor", &("", options))
        .map_err(|e| AppError::Platform(format!("portal PickColor unavailable: {e}")))?;
    let actual_path: OwnedObjectPath = reply
        .body()
        .deserialize()
        .map_err(|e| AppError::Platform(format!("portal PickColor reply malformed: {e}")))?;

    // Pre-0.9 portals ignore handle_token; re-subscribe on the actual path.
    if actual_path.as_str() != predicted_path {
        let fallback_proxy = Proxy::new(
            &conn,
            "org.freedesktop.portal.Desktop",
            actual_path.as_str().to_owned(),
            "org.freedesktop.portal.Request",
        )
        .map_err(|e| AppError::Platform(format!("portal request proxy failed: {e}")))?;
        responses = fallback_proxy
            .receive_signal("Response")
            .map_err(|e| AppError::Platform(format!("portal Response subscribe failed: {e}")))?;
    }

    let msg = responses
        .next()
        .ok_or_else(|| AppError::Platform("portal request closed without a Response".into()))?;
    let (code, results): (u32, HashMap<String, OwnedValue>) = msg
        .body()
        .deserialize()
        .map_err(|e| AppError::Platform(format!("portal Response malformed: {e}")))?;

    match code {
        0 => {
            let color = results.get("color").ok_or_else(|| {
                AppError::Platform("portal Response is missing the color field".into())
            })?;
            parse_portal_color(color).map(Some)
        }
        1 => Ok(None), // user cancelled
        other => Err(AppError::Platform(format!(
            "portal PickColor failed with response code {other}"
        ))),
    }
}

fn parse_portal_color(value: &zbus::zvariant::OwnedValue) -> Result<PickedColor, AppError> {
    use zbus::zvariant::Value;
    if let Value::Structure(s) = &**value {
        let fields = s.fields();
        if let (Some(Value::F64(r)), Some(Value::F64(g)), Some(Value::F64(b))) =
            (fields.first(), fields.get(1), fields.get(2))
        {
            return Ok(PickedColor::from_unit_rgb(*r, *g, *b));
        }
    }
    Err(AppError::Platform(
        "portal color field is not a (ddd) structure".into(),
    ))
}

// ── X11 fallback ────────────────────────────────────────────────────────────

const XC_CROSSHAIR: u16 = 34; // cursor-font glyph
const XK_ESCAPE: u32 = 0xff1b;

fn x11e(context: &str) -> impl Fn(Box<dyn std::error::Error>) -> AppError + '_ {
    move |e| AppError::Platform(format!("X11 {context}: {e}"))
}

fn x11_pick() -> Result<Option<PickedColor>, AppError> {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{ConnectionExt, EventMask, GrabMode, GrabStatus};
    use x11rb::protocol::Event;

    let (conn, screen_num) =
        x11rb::connect(None).map_err(|e| AppError::Platform(format!("X11 connect: {e}")))?;
    let screen = &conn.setup().roots[screen_num];
    let root = screen.root;

    let font = conn.generate_id().map_err(|e| x11e("id alloc")(e.into()))?;
    conn.open_font(font, b"cursor")
        .map_err(|e| x11e("open_font")(e.into()))?;
    let cursor = conn.generate_id().map_err(|e| x11e("id alloc")(e.into()))?;
    conn.create_glyph_cursor(
        cursor,
        font,
        font,
        XC_CROSSHAIR,
        XC_CROSSHAIR + 1,
        0,
        0,
        0,
        0xffff,
        0xffff,
        0xffff,
    )
    .map_err(|e| x11e("create cursor")(e.into()))?;

    let grab = conn
        .grab_pointer(
            false,
            root,
            EventMask::BUTTON_PRESS,
            GrabMode::ASYNC,
            GrabMode::ASYNC,
            x11rb::NONE,
            cursor,
            x11rb::CURRENT_TIME,
        )
        .map_err(|e| x11e("grab_pointer")(e.into()))?
        .reply()
        .map_err(|e| x11e("grab_pointer reply")(e.into()))?;
    if grab.status != GrabStatus::SUCCESS {
        let _ = conn.free_cursor(cursor);
        let _ = conn.close_font(font);
        return Err(AppError::Platform(
            "could not grab the pointer for color picking".into(),
        ));
    }
    // Best-effort — Esc cancel degrades gracefully if another client holds it.
    let _ = conn.grab_keyboard(
        false,
        root,
        x11rb::CURRENT_TIME,
        GrabMode::ASYNC,
        GrabMode::ASYNC,
    );
    conn.flush().map_err(|e| x11e("flush")(e.into()))?;

    let escape_keycode = find_keycode_for_keysym(&conn, XK_ESCAPE);

    let picked = loop {
        let event = conn
            .wait_for_event()
            .map_err(|e| x11e("wait_for_event")(e.into()))?;
        match event {
            Event::ButtonPress(ev) => {
                if ev.detail == 1 {
                    break Some((ev.root_x, ev.root_y));
                }
                break None; // any other button cancels
            }
            Event::KeyPress(ev)
                if escape_keycode.is_none() || Some(ev.detail) == escape_keycode =>
            {
                break None;
            }
            _ => {}
        }
    };

    let _ = conn.ungrab_keyboard(x11rb::CURRENT_TIME);
    let _ = conn.ungrab_pointer(x11rb::CURRENT_TIME);
    let _ = conn.free_cursor(cursor);
    let _ = conn.close_font(font);
    let _ = conn.flush();

    match picked {
        Some((x, y)) => sample_root_pixel(&conn, screen_num, x, y).map(Some),
        None => Ok(None),
    }
}

fn find_keycode_for_keysym(conn: &impl x11rb::connection::Connection, keysym: u32) -> Option<u8> {
    use x11rb::protocol::xproto::ConnectionExt;
    let setup = conn.setup();
    let min = setup.min_keycode;
    let max = setup.max_keycode;
    let mapping = conn
        .get_keyboard_mapping(min, max - min + 1)
        .ok()?
        .reply()
        .ok()?;
    let per = mapping.keysyms_per_keycode as usize;
    if per == 0 {
        return None;
    }
    mapping
        .keysyms
        .chunks(per)
        .position(|chunk| chunk.contains(&keysym))
        .map(|i| min + i as u8)
}

fn sample_root_pixel(
    conn: &impl x11rb::connection::Connection,
    screen_num: usize,
    x: i16,
    y: i16,
) -> Result<PickedColor, AppError> {
    use x11rb::protocol::xproto::{ConnectionExt, ImageFormat, ImageOrder};

    let screen = &conn.setup().roots[screen_num];
    let img = conn
        .get_image(ImageFormat::Z_PIXMAP, screen.root, x, y, 1, 1, u32::MAX)
        .map_err(|e| x11e("get_image")(e.into()))?
        .reply()
        .map_err(|e| x11e("get_image reply")(e.into()))?;

    let lsb_first = conn.setup().image_byte_order == ImageOrder::LSB_FIRST;
    let mut pixel: u32 = 0;
    for (i, byte) in img.data.iter().take(4).enumerate() {
        let shift = if lsb_first { 8 * i } else { 8 * (3 - i) };
        pixel |= (*byte as u32) << shift;
    }
    if !lsb_first {
        // Big-endian packing above assumed 4 bytes; realign shorter pixels.
        pixel >>= 8 * (4usize.saturating_sub(img.data.len().min(4)));
    }

    let visual = screen
        .allowed_depths
        .iter()
        .flat_map(|d| d.visuals.iter())
        .find(|v| v.visual_id == screen.root_visual)
        .ok_or_else(|| AppError::Platform("root visual not found".into()))?;

    Ok(PickedColor::from_rgb8(
        channel_from_mask(pixel, visual.red_mask),
        channel_from_mask(pixel, visual.green_mask),
        channel_from_mask(pixel, visual.blue_mask),
    ))
}
