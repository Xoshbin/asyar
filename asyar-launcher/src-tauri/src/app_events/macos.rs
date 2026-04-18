//! macOS app-events watcher.
//!
//! Uses `NSWorkspace.sharedWorkspace.notificationCenter` to observe:
//!
//! - `NSWorkspaceDidLaunchApplicationNotification`    → `AppEvent::Launched`
//! - `NSWorkspaceDidTerminateApplicationNotification` → `AppEvent::Terminated`
//! - `NSWorkspaceDidActivateApplicationNotification`  → `AppEvent::FrontmostChanged`
//!
//! ### Deviation from `system_events/macos.rs`
//!
//! `system_events/macos.rs` was deliberately written with pure IOKit FFI to
//! avoid pulling in `objc2`. That was appropriate because IOKit exposes a
//! rich C API. `NSWorkspace.notificationCenter` is an Objective-C only
//! surface — registering an observer requires either a (1) synthesised
//! Objective-C class with selectors via `objc_allocateClassPair` (~200
//! lines of fragile runtime plumbing) or (2) a closure-carrying
//! `addObserverForName:object:queue:usingBlock:` call.
//!
//! `objc2` + `block2` are **already** in our dependency graph (pulled in
//! transitively by `tauri-nspanel` and `monitor`), so using them here adds
//! no new compile cost and keeps the implementation idiomatic. This
//! deviation is intentional and narrow-scope.

use crate::app_events::{AppEvent, AppEventsHub, AppEventsWatcher, AppPresenceQuery};
use crate::error::AppError;
use block2::Block;
use log::info;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSRunningApplication, NSWorkspace};
use objc2_foundation::{ns_string, NSNotification, NSOperationQueue, NSString};
use std::sync::Arc;

pub struct MacAppWatcher;

impl MacAppWatcher {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MacAppWatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl AppEventsWatcher for MacAppWatcher {
    fn start(&self, hub: Arc<AppEventsHub>) -> Result<(), AppError> {
        register_observer(
            hub.clone(),
            ns_string!("NSWorkspaceDidLaunchApplicationNotification"),
            ObserverKind::Launch,
        );
        register_observer(
            hub.clone(),
            ns_string!("NSWorkspaceDidTerminateApplicationNotification"),
            ObserverKind::Terminate,
        );
        register_observer(
            hub,
            ns_string!("NSWorkspaceDidActivateApplicationNotification"),
            ObserverKind::Activate,
        );
        info!("[app_events/macos] NSWorkspace observers registered");
        Ok(())
    }
}

enum ObserverKind {
    Launch,
    Terminate,
    Activate,
}

fn register_observer(hub: Arc<AppEventsHub>, name: &NSString, kind: ObserverKind) {
    // The block is retained by NSNotificationCenter for the observer
    // lifetime; we leak observer handles (watcher lives for app lifetime).
    let block = block2::RcBlock::new(move |note: std::ptr::NonNull<NSNotification>| {
        let note: &NSNotification = unsafe { note.as_ref() };
        let Some(app) = extract_running_app(note) else {
            return;
        };
        let ev = match kind {
            ObserverKind::Launch => build_launched(&app),
            ObserverKind::Terminate => build_terminated(&app),
            ObserverKind::Activate => build_frontmost(&app),
        };
        if let Some(ev) = ev {
            hub.dispatch(ev);
        }
    });
    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let center = workspace.notificationCenter();
        let main_queue: Option<&NSOperationQueue> = None;
        let obj: Option<&AnyObject> = None;
        let _observer: Retained<objc2::runtime::NSObject> = center
            .addObserverForName_object_queue_usingBlock(
                Some(name),
                obj,
                main_queue,
                &block as &Block<dyn Fn(std::ptr::NonNull<NSNotification>)>,
            );
        // _observer intentionally leaked — watcher is app-lifetime.
        std::mem::forget(_observer);
    }
}

fn extract_running_app(note: &NSNotification) -> Option<Retained<NSRunningApplication>> {
    unsafe {
        let info = note.userInfo()?;
        let key = ns_string!("NSWorkspaceApplicationKey");
        let value = info.objectForKey(key)?;
        // The value is an NSRunningApplication — downcast via raw pointer
        // since objc2 0.5 lacks a safe generic downcast for this binding.
        let ptr = Retained::into_raw(value);
        let running: Retained<NSRunningApplication> = Retained::from_raw(ptr as *mut _)?;
        Some(running)
    }
}

fn nsstring_to_string(s: &NSString) -> String {
    s.to_string()
}

fn ns_opt(s: Option<Retained<NSString>>) -> Option<String> {
    s.map(|v| nsstring_to_string(&v))
}

fn build_launched(app: &NSRunningApplication) -> Option<AppEvent> {
    unsafe {
        let pid = app.processIdentifier() as u32;
        let bundle_id = ns_opt(app.bundleIdentifier());
        let name = ns_opt(app.localizedName()).unwrap_or_else(|| format!("pid-{pid}"));
        let path = app.bundleURL().and_then(|url| url.path()).map(|p| p.to_string());
        Some(AppEvent::Launched {
            pid,
            bundle_id,
            name,
            path,
        })
    }
}

fn build_terminated(app: &NSRunningApplication) -> Option<AppEvent> {
    unsafe {
        let pid = app.processIdentifier() as u32;
        let bundle_id = ns_opt(app.bundleIdentifier());
        let name = ns_opt(app.localizedName()).unwrap_or_else(|| format!("pid-{pid}"));
        Some(AppEvent::Terminated {
            pid,
            bundle_id,
            name,
        })
    }
}

fn build_frontmost(app: &NSRunningApplication) -> Option<AppEvent> {
    unsafe {
        let pid = app.processIdentifier() as u32;
        let bundle_id = ns_opt(app.bundleIdentifier());
        let name = ns_opt(app.localizedName()).unwrap_or_else(|| format!("pid-{pid}"));
        Some(AppEvent::FrontmostChanged {
            pid,
            bundle_id,
            name,
        })
    }
}

pub struct MacPresenceQuery;

impl AppPresenceQuery for MacPresenceQuery {
    fn is_running(&self, bundle_id: &str) -> bool {
        unsafe {
            let workspace = NSWorkspace::sharedWorkspace();
            let apps = workspace.runningApplications();
            for i in 0..apps.count() {
                let app = apps.objectAtIndex(i);
                if let Some(bid) = app.bundleIdentifier() {
                    if nsstring_to_string(&bid) == bundle_id {
                        return true;
                    }
                }
            }
        }
        false
    }
}
