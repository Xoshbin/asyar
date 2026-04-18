//! Production Tauri 2 tray backend.
//!
//! Each top-level `StatusBarItem` becomes a `tauri::tray::TrayIcon` owned by
//! the Tauri app (looked up by id — see [`crate::extension_tray::path`] for
//! the wire format). Menu events and direct-tray clicks are emitted as
//! `asyar:tray-item-click` events with payload `{ extensionId, event: {
//! itemPath, checked? } }` — shaped for the shared push-bridge that fans
//! events out to extension iframes.

use crate::error::AppError;
use crate::extension_tray::icon::{ExtensionDirLookup, IconSpec};
use crate::extension_tray::item::StatusBarItem;
use crate::extension_tray::manager::{TrayBackend, TrayKey};
use crate::extension_tray::path;
use crate::extension_tray::{icon as icon_mod};
use log::{debug, info, warn};
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::image::Image;
use tauri::menu::{
    CheckMenuItemBuilder, IsMenuItem, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem,
    SubmenuBuilder,
};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter};

/// Tauri event name for tray clicks. The push-bridge picks this up and
/// forwards the inner `event` to the owning extension iframe.
pub const TRAY_CLICK_EVENT: &str = "asyar:tray-item-click";

/// Per-leaf state the click handler needs. Keyed by the encoded menu-item id
/// so the handler can route without walking the tree.
#[derive(Debug, Default)]
struct ClickRouter {
    /// Check-item ids → last-known `checked` state (flipped on each click).
    check_state: HashMap<String, bool>,
    /// Tray ids that have a menu attached. A plain tray-icon click that
    /// belongs to one of these auto-opens the menu natively and should not
    /// fan out as an onClick event.
    has_menu: HashMap<String, bool>,
}

pub struct TauriTrayBackend {
    app: AppHandle,
    extension_dirs: Arc<dyn ExtensionDirLookup + Send + Sync>,
    router: Arc<Mutex<ClickRouter>>,
}

impl TauriTrayBackend {
    pub fn new(
        app: AppHandle,
        extension_dirs: Arc<dyn ExtensionDirLookup + Send + Sync>,
    ) -> Self {
        Self {
            app,
            extension_dirs,
            router: Arc::new(Mutex::new(ClickRouter::default())),
        }
    }

    fn tray_id(key: &TrayKey) -> Result<String, AppError> {
        path::encode(&key.0, &[&key.1])
    }
}

impl TrayBackend for TauriTrayBackend {
    fn create(&self, key: &TrayKey, item: &StatusBarItem) -> Result<(), AppError> {
        let tray_id = Self::tray_id(key)?;
        let (menu, new_check_state) = build_menu_for_item(&self.app, key, item)?;
        {
            let mut router = self.router.lock().map_err(|_| AppError::Lock)?;
            replace_check_state_for_tray(&mut router.check_state, &tray_id, new_check_state);
            router.has_menu.insert(tray_id.clone(), menu.is_some());
        }

        let mut builder = TrayIconBuilder::with_id(tray_id.clone());
        if let Some(image) = resolve_icon_image(&self.app, self.extension_dirs.as_ref(), item) {
            builder = builder.icon(image);
        } else if let Some(icon) = item.icon.as_ref().filter(|s| !s.is_empty()) {
            #[cfg(target_os = "macos")]
            {
                builder = builder.title(icon);
            }
            #[cfg(not(target_os = "macos"))]
            {
                builder = builder.icon(blank_image());
                let _ = icon;
            }
        }
        if !item.text.is_empty() {
            builder = builder.tooltip(&item.text);
        }
        if let Some(m) = &menu {
            builder = builder.menu(m);
        }

        let router_for_menu = Arc::clone(&self.router);
        builder = builder.on_menu_event(move |app, event| {
            info!("[extension_tray] on_menu_event: id='{}'", event.id.as_ref());
            dispatch_menu_event(app, &router_for_menu, event.id.as_ref());
        });

        let router_for_tray = Arc::clone(&self.router);
        builder = builder.on_tray_icon_event(move |tray, event| {
            // Match Up state: both Down and Up fire on every left click (see
            // tray-icon 0.21 macOS impl). Up is the "completed click" signal
            // and avoids firing twice if we also matched Down.
            if !is_left_click_up(&event) {
                return;
            }
            let id = tray.id().as_ref().to_string();
            let has_menu = router_for_tray
                .lock()
                .map(|r| r.has_menu.get(&id).copied().unwrap_or(false))
                .unwrap_or(false);
            info!(
                "[extension_tray] on_tray_icon_event: id='{}' has_menu={}",
                id, has_menu
            );
            if !has_menu {
                dispatch_menu_event(tray.app_handle(), &router_for_tray, &id);
            }
        });

        builder
            .build(&self.app)
            .map_err(|e| AppError::Platform(format!("Failed to build tray icon: {e}")))?;
        Ok(())
    }

    fn update(&self, key: &TrayKey, item: &StatusBarItem) -> Result<(), AppError> {
        let tray_id = Self::tray_id(key)?;
        let tray = self
            .app
            .tray_by_id(&tray_id)
            .ok_or_else(|| AppError::NotFound(format!("Tray '{tray_id}' is not registered")))?;

        let (menu, new_check_state) = build_menu_for_item(&self.app, key, item)?;
        {
            let mut router = self.router.lock().map_err(|_| AppError::Lock)?;
            replace_check_state_for_tray(&mut router.check_state, &tray_id, new_check_state);
            router.has_menu.insert(tray_id.clone(), menu.is_some());
        }

        let image = resolve_icon_image(&self.app, self.extension_dirs.as_ref(), item);
        tray.set_icon(image)
            .map_err(|e| AppError::Platform(format!("Failed to set tray icon: {e}")))?;
        #[cfg(target_os = "macos")]
        {
            let title_opt = if item.icon.as_ref().is_some_and(|s| !s.is_empty())
                && item.icon_path.as_ref().is_none_or(|s| s.is_empty())
            {
                item.icon.clone()
            } else {
                None
            };
            tray.set_title(title_opt)
                .map_err(|e| AppError::Platform(format!("Failed to set tray title: {e}")))?;
        }
        let tip: Option<&str> = if item.text.is_empty() { None } else { Some(&item.text) };
        tray.set_tooltip(tip)
            .map_err(|e| AppError::Platform(format!("Failed to set tray tooltip: {e}")))?;
        tray.set_menu(menu)
            .map_err(|e| AppError::Platform(format!("Failed to set tray menu: {e}")))?;
        Ok(())
    }

    fn destroy(&self, key: &TrayKey) -> Result<(), AppError> {
        let tray_id = Self::tray_id(key)?;
        {
            let mut router = self.router.lock().map_err(|_| AppError::Lock)?;
            router
                .check_state
                .retain(|k, _| !id_belongs_to_tray(k, &tray_id));
            router.has_menu.remove(&tray_id);
        }
        self.app.remove_tray_by_id(&tray_id);
        Ok(())
    }
}

fn is_left_click_up(event: &TrayIconEvent) -> bool {
    matches!(
        event,
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        }
    )
}

/// A leaf menu-item id `ext:top:a:b` belongs to tray id `ext:top` iff the
/// tray id is a strict prefix at a segment boundary.
fn id_belongs_to_tray(menu_id: &str, tray_id: &str) -> bool {
    if menu_id == tray_id {
        return true;
    }
    if let Some(rest) = menu_id.strip_prefix(tray_id) {
        return rest.starts_with(path::SEPARATOR);
    }
    false
}

fn replace_check_state_for_tray(
    store: &mut HashMap<String, bool>,
    tray_id: &str,
    replacement: HashMap<String, bool>,
) {
    store.retain(|k, _| !id_belongs_to_tray(k, tray_id));
    store.extend(replacement);
}

fn dispatch_menu_event(app: &AppHandle, router: &Arc<Mutex<ClickRouter>>, menu_id: &str) {
    let (extension_id, item_path) = match path::decode(menu_id) {
        Ok(parts) => parts,
        Err(e) => {
            warn!("[extension_tray] ignoring un-parseable menu id '{menu_id}': {e}");
            return;
        }
    };

    let checked = match router.lock() {
        Ok(mut r) => r.check_state.get_mut(menu_id).map(|prev| {
            *prev = !*prev;
            *prev
        }),
        Err(_) => None,
    };

    let mut event_body = json!({
        "itemPath": item_path,
    });
    if let Some(c) = checked {
        event_body["checked"] = json!(c);
    }

    let payload = json!({
        "extensionId": extension_id,
        "event": event_body,
    });
    info!(
        "[extension_tray] emitting {TRAY_CLICK_EVENT} for ext='{extension_id}' path={item_path:?} checked={checked:?}"
    );
    if let Err(e) = app.emit(TRAY_CLICK_EVENT, payload) {
        warn!("[extension_tray] failed to emit {TRAY_CLICK_EVENT}: {e}");
    }
}

// ── Icon loading ────────────────────────────────────────────────────────────

fn resolve_icon_image(
    _app: &AppHandle,
    lookup: &(dyn ExtensionDirLookup + Send + Sync),
    item: &StatusBarItem,
) -> Option<Image<'static>> {
    let spec = item.icon_path.as_ref().filter(|s| !s.is_empty())?;
    match icon_mod::parse_spec(spec) {
        Ok(IconSpec::Absolute(path)) => load_icon_from_path(&path),
        Ok(IconSpec::Extension { ext_id, rel_path }) => {
            let base = lookup.base_dir(&ext_id)?;
            let candidates = [
                base.join("dist").join(&rel_path),
                base.join(&rel_path),
            ];
            for candidate in &candidates {
                if candidate.exists() {
                    if let Some(img) = load_icon_from_path(candidate) {
                        return Some(img);
                    }
                }
            }
            debug!(
                "[extension_tray] iconPath for '{}' did not resolve under {}",
                item.id,
                base.display()
            );
            None
        }
        Err(e) => {
            warn!(
                "[extension_tray] rejecting iconPath '{}' on item '{}': {}",
                spec, item.id, e
            );
            None
        }
    }
}

fn load_icon_from_path(path: &std::path::Path) -> Option<Image<'static>> {
    match Image::from_path(path) {
        Ok(img) => Some(img),
        Err(e) => {
            warn!(
                "[extension_tray] failed to load icon from {}: {e}",
                path.display()
            );
            None
        }
    }
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn blank_image() -> Image<'static> {
    // 1×1 fully-transparent RGBA — used on Linux/Windows when only an emoji
    // `icon` is supplied, since native trays there need bitmap content.
    Image::new_owned(vec![0, 0, 0, 0], 1, 1)
}

// ── Menu building ───────────────────────────────────────────────────────────

type BuiltMenuItem = Box<dyn IsMenuItem<tauri::Wry>>;
type BuildMenuResult = Result<(Option<Menu<tauri::Wry>>, HashMap<String, bool>), AppError>;

fn build_menu_for_item(app: &AppHandle, key: &TrayKey, item: &StatusBarItem) -> BuildMenuResult {
    let mut check_state = HashMap::new();
    let submenu = match &item.submenu {
        Some(s) if !s.is_empty() => s,
        _ => return Ok((None, check_state)),
    };

    let mut builder = MenuBuilder::new(app);
    let parent_path = vec![key.1.as_str()];
    let mut owned: Vec<BuiltMenuItem> = Vec::with_capacity(submenu.len());
    for child in submenu {
        if let Some(entry) = build_item(app, &key.0, &parent_path, child, &mut check_state)? {
            owned.push(entry);
        }
    }
    for entry in &owned {
        builder = builder.item(entry.as_ref());
    }

    let menu = builder
        .build()
        .map_err(|e| AppError::Platform(format!("Failed to build tray menu: {e}")))?;
    Ok((Some(menu), check_state))
}

fn build_item(
    app: &AppHandle,
    extension_id: &str,
    parent_path: &[&str],
    item: &StatusBarItem,
    check_state: &mut HashMap<String, bool>,
) -> Result<Option<BuiltMenuItem>, AppError> {
    if item.separator == Some(true) {
        let sep = PredefinedMenuItem::separator(app)
            .map_err(|e| AppError::Platform(format!("Failed to build separator: {e}")))?;
        return Ok(Some(Box::new(sep)));
    }

    let mut child_path: Vec<&str> = parent_path.to_vec();
    child_path.push(item.id.as_str());
    let encoded = path::encode(extension_id, &child_path)?;

    let enabled = item.enabled.unwrap_or(true);

    if let Some(children) = &item.submenu {
        if !children.is_empty() {
            let label = format_label(item);
            let mut sub_builder = SubmenuBuilder::with_id(app, encoded, &label).enabled(enabled);
            let mut owned: Vec<BuiltMenuItem> = Vec::with_capacity(children.len());
            for grand in children {
                if let Some(entry) =
                    build_item(app, extension_id, &child_path, grand, check_state)?
                {
                    owned.push(entry);
                }
            }
            for entry in &owned {
                sub_builder = sub_builder.item(entry.as_ref());
            }
            let sub = sub_builder
                .build()
                .map_err(|e| AppError::Platform(format!("Failed to build submenu: {e}")))?;
            return Ok(Some(Box::new(sub)));
        }
    }

    if let Some(checked) = item.checked {
        check_state.insert(encoded.clone(), checked);
        let check = CheckMenuItemBuilder::with_id(encoded, format_label(item))
            .enabled(enabled)
            .checked(checked)
            .build(app)
            .map_err(|e| AppError::Platform(format!("Failed to build check item: {e}")))?;
        return Ok(Some(Box::new(check)));
    }

    let menu_item = MenuItemBuilder::with_id(encoded, format_label(item))
        .enabled(enabled)
        .build(app)
        .map_err(|e| AppError::Platform(format!("Failed to build menu item: {e}")))?;
    Ok(Some(Box::new(menu_item)))
}

fn format_label(item: &StatusBarItem) -> String {
    let icon = item.icon.as_deref().filter(|s| !s.is_empty());
    match (icon, item.text.is_empty()) {
        (Some(i), false) => format!("{i} {}", item.text),
        (Some(i), true) => i.to_string(),
        (None, _) => item.text.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_belongs_to_tray_matches_prefix() {
        assert!(id_belongs_to_tray("ext:top", "ext:top"));
        assert!(id_belongs_to_tray("ext:top:child", "ext:top"));
        assert!(id_belongs_to_tray("ext:top:a:b", "ext:top"));
    }

    #[test]
    fn id_belongs_to_tray_rejects_non_boundary() {
        assert!(!id_belongs_to_tray("ext:top2", "ext:top"));
        assert!(!id_belongs_to_tray("other:top:child", "ext:top"));
        assert!(!id_belongs_to_tray("ext:topping", "ext:top"));
    }

    #[test]
    fn replace_check_state_drops_old_entries_under_prefix() {
        let mut state: HashMap<String, bool> = HashMap::new();
        state.insert("ext:t1".into(), true);
        state.insert("ext:t1:a".into(), false);
        state.insert("ext:t2:a".into(), true);

        let mut replacement = HashMap::new();
        replacement.insert("ext:t1:new".into(), true);

        replace_check_state_for_tray(&mut state, "ext:t1", replacement);
        let mut keys: Vec<&str> = state.keys().map(|s| s.as_str()).collect();
        keys.sort();
        assert_eq!(keys, vec!["ext:t1:new", "ext:t2:a"]);
    }

    #[test]
    fn format_label_combines_icon_and_text() {
        let item = StatusBarItem {
            icon: Some("🍅".into()),
            ..StatusBarItem::leaf("x", "Focus")
        };
        assert_eq!(format_label(&item), "🍅 Focus");
    }

    #[test]
    fn format_label_uses_icon_only_when_text_empty() {
        let item = StatusBarItem {
            icon: Some("🍅".into()),
            ..StatusBarItem::leaf("x", "")
        };
        assert_eq!(format_label(&item), "🍅");
    }

    #[test]
    fn format_label_uses_text_only_when_no_icon() {
        let item = StatusBarItem::leaf("x", "Focus");
        assert_eq!(format_label(&item), "Focus");
    }
}
