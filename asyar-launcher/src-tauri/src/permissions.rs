use crate::error::AppError;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

/// Rust-side extension permission registry. Populated by extensionManager.ts at extension
/// load time. Queried by sensitive commands for defense-in-depth enforcement.
///
/// `inner` stores the declared permission *strings* (flag permissions like `network`,
/// `clipboard:read`, `fs:watch`). `args` stores the sidecar value bag for
/// parameterized permissions — currently only `fs:watch` (value: `Array<String>`
/// of glob patterns), but the shape is intentionally generic so future
/// parameterized permissions reuse the same store.
pub struct ExtensionPermissionRegistry {
    pub inner: Mutex<HashMap<String, HashSet<String>>>,
    pub args: Mutex<HashMap<String, HashMap<String, serde_json::Value>>>,
}

impl Default for ExtensionPermissionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ExtensionPermissionRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            args: Mutex::new(HashMap::new()),
        }
    }

    /// Returns Ok(()) if allowed. None caller = system/core call, always allowed.
    pub fn check(
        &self,
        caller_extension_id: &Option<String>,
        required_permission: &str,
    ) -> Result<(), AppError> {
        let Some(id) = caller_extension_id else {
            return Ok(());
        };
        let registry = self.inner.lock().map_err(|_| AppError::Lock)?;
        let permissions = registry.get(id).ok_or_else(|| {
            AppError::Permission(format!(
                "Extension \"{}\" is not registered in the Rust permission registry.",
                id
            ))
        })?;
        if permissions.contains(required_permission) {
            Ok(())
        } else {
            Err(AppError::Permission(format!(
                "Extension \"{}\" requires the \"{}\" permission.",
                id, required_permission
            )))
        }
    }

    /// Register (or replace) an extension's permission set + its arg bag.
    /// Preferred over writing `inner` / `args` directly — keeps both in sync.
    pub fn register(
        &self,
        extension_id: &str,
        permissions: HashSet<String>,
        permission_args: HashMap<String, serde_json::Value>,
    ) {
        if let Ok(mut p) = self.inner.lock() {
            p.insert(extension_id.to_string(), permissions);
        }
        if let Ok(mut a) = self.args.lock() {
            a.insert(extension_id.to_string(), permission_args);
        }
    }

    /// Remove an extension from the registry. Used when the extension is
    /// uninstalled or disabled.
    pub fn unregister(&self, extension_id: &str) {
        if let Ok(mut p) = self.inner.lock() {
            p.remove(extension_id);
        }
        if let Ok(mut a) = self.args.lock() {
            a.remove(extension_id);
        }
    }

    /// Generic arg lookup. Returns a cloned JSON value for the (extension,
    /// permission) pair, or `None` if absent. Callers narrow to the expected
    /// shape (e.g. `fs_watch_patterns` for `Vec<String>`).
    pub fn args_for(&self, extension_id: &str, permission: &str) -> Option<serde_json::Value> {
        let guard = self.args.lock().ok()?;
        guard.get(extension_id)?.get(permission).cloned()
    }

    /// Narrowed typed view of a `string[]` arg bag (the shape shared by
    /// `fs:watch` and `files:read` patterns). Errors if the extension
    /// hasn't declared the permission.
    pub fn string_array_args(
        &self,
        extension_id: &str,
        permission: &str,
    ) -> Result<Vec<String>, AppError> {
        let value = self.args_for(extension_id, permission).ok_or_else(|| {
            AppError::Permission(format!(
                "Extension '{}' has no {} patterns declared in manifest",
                extension_id, permission
            ))
        })?;
        let arr = value.as_array().ok_or_else(|| {
            AppError::Validation(format!(
                "permissionArgs.{} must be an array of strings",
                permission
            ))
        })?;
        arr.iter()
            .map(|v| {
                v.as_str().map(|s| s.to_string()).ok_or_else(|| {
                    AppError::Validation(format!(
                        "permissionArgs.{} entries must be strings",
                        permission
                    ))
                })
            })
            .collect()
    }

    /// Narrowed typed view of `fs:watch` patterns. Errors if the extension
    /// hasn't declared the permission.
    pub fn fs_watch_patterns(&self, extension_id: &str) -> Result<Vec<String>, AppError> {
        self.string_array_args(extension_id, "fs:watch")
    }

    /// Narrowed typed view of `files:read` patterns. Errors if the extension
    /// hasn't declared the permission.
    pub fn files_read_patterns(&self, extension_id: &str) -> Result<Vec<String>, AppError> {
        self.string_array_args(extension_id, "files:read")
    }
}

/// Maps an IPC call type string to the required permission.
/// Returns None if the call type is a core call that doesn't require a permission.
fn get_required_permission(call_type: &str) -> Option<&'static str> {
    match call_type {
        // Clipboard
        "asyar:api:clipboard:readCurrentClipboard" => Some("clipboard:read"),
        "asyar:api:clipboard:getRecentItems" => Some("clipboard:read"),
        "asyar:api:clipboard:writeToClipboard" => Some("clipboard:write"),
        "asyar:api:clipboard:pasteItem" => Some("clipboard:write"),
        "asyar:api:clipboard:simulatePaste" => Some("clipboard:write"),
        "asyar:api:clipboard:toggleItemFavorite" => Some("clipboard:write"),
        "asyar:api:clipboard:deleteItem" => Some("clipboard:write"),
        "asyar:api:clipboard:clearNonFavorites" => Some("clipboard:write"),
        // Notifications
        "asyar:api:feedback:sendBackground" => Some("notifications:send"),
        "asyar:api:feedback:dismissBackground" => Some("notifications:send"),
        "asyar:api:feedback:announce" => Some("feedback:announce"),
        // Raw Tauri invoke
        "asyar:api:invoke" => Some("shell:spawn"),
        // Network
        "asyar:api:network:fetch" => Some("network"),
        // Opener
        "asyar:api:opener:open" => Some("shell:open-url"),
        "asyar:api:fs:showInFileManager" => Some("fs:read"),
        "asyar:api:fs:trash" => Some("fs:write"),
        "asyar:api:shell:spawn" => Some("shell:spawn"),
        "asyar:api:shell:list" => Some("shell:spawn"),
        "asyar:api:shell:attach" => Some("shell:spawn"),
        // Entitlement service — requires subscription read permission
        "asyar:api:entitlements:check" => Some("entitlements:read"),
        "asyar:api:entitlements:getAll" => Some("entitlements:read"),
        // Extension storage
        "asyar:api:storage:get" => Some("storage:read"),
        "asyar:api:storage:set" => Some("storage:write"),
        "asyar:api:storage:delete" => Some("storage:write"),
        "asyar:api:storage:getAll" => Some("storage:read"),
        "asyar:api:storage:clear" => Some("storage:write"),
        // Extension cache
        "asyar:api:cache:get" => Some("cache:read"),
        "asyar:api:cache:set" => Some("cache:write"),
        "asyar:api:cache:delete" => Some("cache:write"),
        "asyar:api:cache:clear" => Some("cache:write"),
        // Screen sampling (eyedropper)
        "asyar:api:screen:pickColor" => Some("screen:pick-color"),
        // Selection
        "asyar:api:selection:getSelectedText" => Some("selection:read"),
        "asyar:api:selection:getSelectedFinderItems" => Some("selection:read"),
        // OAuth PKCE for extensions
        "asyar:api:oauth:authorize" => Some("oauth:use"),
        "asyar:api:oauth:revokeToken" => Some("oauth:use"),
        // Inter-extension command invocation
        "asyar:api:interop:launchCommand" => Some("extension:invoke"),
        // Application Service
        "asyar:api:application:getFrontmostApplication" => Some("application:read"),
        "asyar:api:application:syncApplicationIndex" => Some("application:read"),
        "asyar:api:application:listApplications" => Some("application:read"),
        // Window Management
        "asyar:api:window:getWindowBounds" => Some("window:manage"),
        "asyar:api:window:setWindowBounds" => Some("window:manage"),
        "asyar:api:window:setFullscreen" => Some("window:manage"),
        // Extension Preferences
        "asyar:api:preferences:getAll" => Some("preferences:read"),
        "asyar:api:preferences:set" => Some("preferences:write"),
        "asyar:api:preferences:reset" => Some("preferences:write"),
        // Power inhibitor
        "asyar:api:power:keepAwake" => Some("power:inhibit"),
        "asyar:api:power:release" => Some("power:inhibit"),
        "asyar:api:power:list" => Some("power:inhibit"),
        // Process service (list/kill)
        "asyar:api:process:list" => Some("process:read"),
        "asyar:api:process:kill" => Some("process:kill"),
        // System events (OS sleep/wake/lid/battery push)
        "asyar:api:systemEvents:subscribe" => Some("systemEvents:read"),
        "asyar:api:systemEvents:unsubscribe" => Some("systemEvents:read"),
        // App-presence push events (launched / terminated / frontmost-changed)
        "asyar:api:appEvents:subscribe" => Some("app:frontmost-watch"),
        "asyar:api:appEvents:unsubscribe" => Some("app:frontmost-watch"),
        // Application one-shot query — same permission as the rest of application:*
        "asyar:api:application:isRunning" => Some("application:read"),
        // Persistent one-shot timers (fire even after relaunch).
        "asyar:api:timers:schedule" => Some("timers:schedule"),
        "asyar:api:timers:cancel" => Some("timers:cancel"),
        "asyar:api:timers:list" => Some("timers:list"),
        // Filesystem watcher — patterns are sidecarred in permissionArgs.
        "asyar:api:fsWatcher:create" => Some("fs:watch"),
        "asyar:api:fsWatcher:dispose" => Some("fs:watch"),
        // Snippets — extension contributes shortcodes to the snippets service
        "asyar:api:snippets:registerShortcodes" => Some("snippets:contribute"),
        "asyar:api:snippets:unregisterShortcodes" => Some("snippets:contribute"),
        // Browser bridge — tabs (read = list/inspect, write = act/open/search).
        "asyar:api:browser:listTabs" => Some("browser:tabs.read"),
        "asyar:api:browser:getActiveTab" => Some("browser:tabs.read"),
        "asyar:api:browser:listPairedBrowsers" => Some("browser:tabs.read"),
        "asyar:api:browser:getMostRecentActiveBrowser" => Some("browser:tabs.read"),
        "asyar:api:browser:subscribeTabsChanged" => Some("browser:tabs.read"),
        "asyar:api:browser:unsubscribeTabsChanged" => Some("browser:tabs.read"),
        "asyar:api:browser:activateTab" => Some("browser:tabs.write"),
        "asyar:api:browser:closeTab" => Some("browser:tabs.write"),
        "asyar:api:browser:openUrl" => Some("browser:tabs.write"),
        "asyar:api:browser:searchWeb" => Some("browser:tabs.write"),
        // Browser bridge — bookmarks / history (read from disk).
        "asyar:api:browser:listBookmarks" => Some("browser:bookmarks.read"),
        "asyar:api:browser:searchHistory" => Some("browser:history.read"),
        // Browser bridge — page content (read = snapshot/query, write = act).
        "asyar:api:browser:getCurrentPage" => Some("browser:page.read"),
        "asyar:api:browser:queryPage" => Some("browser:page.read"),
        "asyar:api:browser:subscribePageChanged" => Some("browser:page.read"),
        "asyar:api:browser:unsubscribePageChanged" => Some("browser:page.read"),
        "asyar:api:browser:actOnPage" => Some("browser:page.write"),
        // File search — one permission covers both read methods; the local
        // index is read-only, no separate write surface.
        "asyar:api:files:search" => Some("files:search"),
        "asyar:api:files:status" => Some("files:search"),
        // File content read — separate permission from the index search;
        // scope is in permissionArgs.files:read (glob patterns).
        "asyar:api:files:read" => Some("files:read"),
        // Scoped enumeration and thumbnails ride the same permission and
        // the same declared globs: listing in-scope names and rendering an
        // in-scope file as an icon are both strictly less information than
        // the byte read files:read already grants.
        "asyar:api:files:glob" => Some("files:read"),
        "asyar:api:files:thumbnail" => Some("files:read"),
        // Notes SDK service — third-party extensions can search/read/create/
        // append to the user's Notes (never update-in-place or delete an
        // arbitrary note by id, so a buggy or malicious extension cannot
        // silently corrupt or destroy the user's own notes; see
        // NotesServiceProxy for the full rationale).
        "asyar:api:notes:search" => Some("notes:read"),
        "asyar:api:notes:list" => Some("notes:read"),
        "asyar:api:notes:get" => Some("notes:read"),
        "asyar:api:notes:create" => Some("notes:write"),
        "asyar:api:notes:append" => Some("notes:write"),
        // browser:listAvailableBrowsers / isCompanionInstalled are intentionally
        // permission-free (discovery, low blast radius) → fall through to None.
        // search:rank is intentionally permission-free: the caller supplies its
        // own already-known items and gets back an ordering — no host data is
        // read, nothing is persisted, no cross-extension exposure.
        // clipboard:stripHtml / clipboard:stripRtf are intentionally
        // permission-free for the same reason: the caller supplies its own
        // markup string and gets back plain text — the host clipboard is
        // never read (that's clipboard:read, gated separately), nothing is
        // persisted, no cross-extension exposure.
        // Not in map = core call, always allowed
        _ => None,
    }
}

/// Result of a permission check, returned to the frontend.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PermissionCheckResult {
    pub allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required_permission: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Called by the frontend IPC router to check if an extension is allowed to make a specific call.
/// This is the single enforcement point for extension permissions.
#[tauri::command]
pub fn check_extension_permission(
    extension_id: String,
    call_type: String,
    registry: tauri::State<'_, ExtensionPermissionRegistry>,
) -> PermissionCheckResult {
    let required = match get_required_permission(&call_type) {
        Some(perm) => perm,
        None => {
            // Call type not in map — core call, always allowed
            return PermissionCheckResult {
                allowed: true,
                required_permission: None,
                reason: None,
            };
        }
    };

    let reg = match registry.inner.lock() {
        Ok(r) => r,
        Err(_) => {
            return PermissionCheckResult {
                allowed: false,
                required_permission: Some(required.to_string()),
                reason: Some("Internal error: permission registry lock failed".to_string()),
            };
        }
    };

    let permissions = match reg.get(&extension_id) {
        Some(p) => p,
        None => {
            return PermissionCheckResult {
                allowed: false,
                required_permission: Some(required.to_string()),
                reason: Some(format!(
                    "Extension \"{}\" is not registered in the permission registry.",
                    extension_id
                )),
            };
        }
    };

    if permissions.contains(required) {
        PermissionCheckResult {
            allowed: true,
            required_permission: None,
            reason: None,
        }
    } else {
        PermissionCheckResult {
            allowed: false,
            required_permission: Some(required.to_string()),
            reason: Some(format!(
                "Extension \"{}\" called \"{}\" but did not declare permission \"{}\" in its manifest.json",
                extension_id, call_type, required
            )),
        }
    }
}

/// Outcome of a registration attempt, returned to the frontend loader.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRegistrationResult {
    pub registered: bool,
    pub needs_consent: bool,
}

/// Resolves the declared permission set trusted by `register_extension_permissions`.
/// When the extension is already discovered, its manifest on disk is
/// authoritative and the caller-supplied `permissions`/`permission_args` are
/// ignored entirely — this is what stops a compromised caller from forging a
/// larger permission set than the extension's own manifest declares. The
/// caller-supplied values are only trusted when no discovery record exists.
fn resolve_declared_permissions(
    extensions: &HashMap<String, crate::extensions::ExtensionRecord>,
    extension_id: &str,
    caller_permissions: Vec<String>,
    caller_permission_args: Option<serde_json::Map<String, serde_json::Value>>,
) -> (
    bool,
    Vec<String>,
    serde_json::Map<String, serde_json::Value>,
) {
    match extensions.get(extension_id) {
        Some(record) => (
            record.is_built_in,
            record.manifest.permissions.clone().unwrap_or_default(),
            record.manifest.permission_args.clone().unwrap_or_default(),
        ),
        None => (
            false,
            caller_permissions,
            caller_permission_args.unwrap_or_default(),
        ),
    }
}

/// Called by extensionManager.ts when an extension loads. Stores the extension's
/// declared permission strings + their sidecar arguments so sensitive Rust
/// commands can check them.
///
/// Consent backstop: the declared set only enters the registry when a covering
/// consent record exists (see `extensions::consent`). Otherwise any stale
/// entry is cleared and `needs_consent` is reported, so every gated call fails
/// closed until the user accepts. The declared set is resolved from the
/// discovered manifest when the extension is known — the caller-supplied
/// values are only trusted when no discovery record exists.
#[tauri::command]
pub fn register_extension_permissions(
    app_handle: tauri::AppHandle,
    extension_id: String,
    permissions: Vec<String>,
    permission_args: Option<serde_json::Map<String, serde_json::Value>>,
    registry: tauri::State<'_, ExtensionPermissionRegistry>,
    extensions: tauri::State<'_, crate::extensions::ExtensionRegistryState>,
) -> Result<PermissionRegistrationResult, AppError> {
    if extension_id.trim().is_empty() {
        return Err(AppError::Validation(
            "extension_id cannot be empty".to_string(),
        ));
    }

    let (is_built_in, declared_perms, declared_args) = {
        let reg = extensions.extensions.lock().map_err(|_| AppError::Lock)?;
        resolve_declared_permissions(&reg, &extension_id, permissions, permission_args)
    };

    let consent = crate::extensions::consent::get_consent(&app_handle, &extension_id)?;
    match crate::extensions::consent::registration_decision(
        is_built_in,
        &declared_perms,
        &declared_args,
        consent.as_ref(),
    ) {
        crate::extensions::consent::RegistrationDecision::Register => {
            let perms: HashSet<String> = declared_perms.into_iter().collect();
            let args: HashMap<String, serde_json::Value> = declared_args.into_iter().collect();
            registry.register(&extension_id, perms, args);
            Ok(PermissionRegistrationResult {
                registered: true,
                needs_consent: false,
            })
        }
        crate::extensions::consent::RegistrationDecision::WithholdNeedsConsent => {
            registry.unregister(&extension_id);
            log::warn!(
                "Withholding permission registration for '{}': declared permissions exceed recorded consent",
                extension_id
            );
            Ok(PermissionRegistrationResult {
                registered: false,
                needs_consent: true,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_registry() -> ExtensionPermissionRegistry {
        let reg = ExtensionPermissionRegistry::new();
        let mut inner = reg.inner.lock().unwrap();
        inner.insert("org.asyar.test".to_string(), {
            let mut s = HashSet::new();
            s.insert("network".to_string());
            s.insert("clipboard:read".to_string());
            s
        });
        drop(inner);
        reg
    }

    #[test]
    fn test_get_required_permission_known_call() {
        assert_eq!(
            get_required_permission("asyar:api:network:fetch"),
            Some("network")
        );
    }

    #[test]
    fn test_get_required_permission_unknown_call() {
        assert_eq!(get_required_permission("asyar:api:log:info"), None);
    }

    #[test]
    fn test_get_required_permission_files() {
        assert_eq!(
            get_required_permission("asyar:api:files:search"),
            Some("files:search")
        );
        assert_eq!(
            get_required_permission("asyar:api:files:status"),
            Some("files:search")
        );
        assert_eq!(
            get_required_permission("asyar:api:files:read"),
            Some("files:read")
        );
        assert_eq!(
            get_required_permission("asyar:api:files:glob"),
            Some("files:read")
        );
        assert_eq!(
            get_required_permission("asyar:api:files:thumbnail"),
            Some("files:read")
        );
    }

    #[test]
    fn test_get_required_permission_notes() {
        assert_eq!(
            get_required_permission("asyar:api:notes:search"),
            Some("notes:read")
        );
        assert_eq!(
            get_required_permission("asyar:api:notes:list"),
            Some("notes:read")
        );
        assert_eq!(
            get_required_permission("asyar:api:notes:get"),
            Some("notes:read")
        );
        assert_eq!(
            get_required_permission("asyar:api:notes:create"),
            Some("notes:write")
        );
        assert_eq!(
            get_required_permission("asyar:api:notes:append"),
            Some("notes:write")
        );
    }

    #[test]
    fn test_get_required_permission_process() {
        assert_eq!(
            get_required_permission("asyar:api:process:list"),
            Some("process:read")
        );
        assert_eq!(
            get_required_permission("asyar:api:process:kill"),
            Some("process:kill")
        );
    }

    #[test]
    fn test_browser_calls_require_their_permission() {
        // Regression guard: browser IPC commands MUST be gated. If any returns
        // None it defaults to "core call, always allowed" — letting any extension
        // read tabs/bookmarks/history/page content without declaring permission.
        assert_eq!(
            get_required_permission("asyar:api:browser:listTabs"),
            Some("browser:tabs.read")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:getActiveTab"),
            Some("browser:tabs.read")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:listPairedBrowsers"),
            Some("browser:tabs.read")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:getMostRecentActiveBrowser"),
            Some("browser:tabs.read")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:activateTab"),
            Some("browser:tabs.write")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:closeTab"),
            Some("browser:tabs.write")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:openUrl"),
            Some("browser:tabs.write")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:searchWeb"),
            Some("browser:tabs.write")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:listBookmarks"),
            Some("browser:bookmarks.read")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:searchHistory"),
            Some("browser:history.read")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:getCurrentPage"),
            Some("browser:page.read")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:queryPage"),
            Some("browser:page.read")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:actOnPage"),
            Some("browser:page.write")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:subscribeTabsChanged"),
            Some("browser:tabs.read")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:unsubscribeTabsChanged"),
            Some("browser:tabs.read")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:subscribePageChanged"),
            Some("browser:page.read")
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:unsubscribePageChanged"),
            Some("browser:page.read")
        );
        // Discovery calls are intentionally permission-free (low blast radius).
        assert_eq!(
            get_required_permission("asyar:api:browser:listAvailableBrowsers"),
            None
        );
        assert_eq!(
            get_required_permission("asyar:api:browser:isCompanionInstalled"),
            None
        );
    }

    #[test]
    fn search_rank_is_intentionally_permission_free() {
        // The caller supplies its own already-known items and gets back an
        // ordering — no host data is read, nothing persisted, no
        // cross-extension exposure. See the comment above get_required_permission's
        // fallthrough arm.
        assert_eq!(get_required_permission("asyar:api:search:rank"), None);
    }

    #[test]
    fn clipboard_strip_html_and_strip_rtf_are_intentionally_permission_free() {
        // The caller supplies its own markup string and gets back plain text
        // — the host clipboard is never read, nothing is persisted. See the
        // comment above get_required_permission's fallthrough arm.
        assert_eq!(
            get_required_permission("asyar:api:clipboard:stripHtml"),
            None
        );
        assert_eq!(
            get_required_permission("asyar:api:clipboard:stripRtf"),
            None
        );
    }

    #[test]
    fn test_check_allows_registered_permission() {
        let reg = make_registry();
        assert!(reg
            .check(&Some("org.asyar.test".to_string()), "network")
            .is_ok());
    }

    #[test]
    fn test_check_denies_missing_permission() {
        let reg = make_registry();
        assert!(reg
            .check(&Some("org.asyar.test".to_string()), "notifications:send")
            .is_err());
    }

    #[test]
    fn test_check_allows_core_call() {
        let reg = make_registry();
        assert!(reg.check(&None, "network").is_ok());
    }

    #[test]
    fn test_check_denies_unregistered_extension() {
        let reg = make_registry();
        assert!(reg
            .check(&Some("org.asyar.unknown".to_string()), "network")
            .is_err());
    }

    #[test]
    fn test_get_required_permission_clipboard_write() {
        assert_eq!(
            get_required_permission("asyar:api:clipboard:writeToClipboard"),
            Some("clipboard:write")
        );
    }

    #[test]
    fn only_rare_feedback_announcements_require_permission() {
        assert_eq!(
            get_required_permission("asyar:api:feedback:announce"),
            Some("feedback:announce")
        );
        assert_eq!(get_required_permission("asyar:api:feedback:report"), None);
        assert_eq!(
            get_required_permission("asyar:api:feedback:showProgress"),
            None
        );
        assert_eq!(
            get_required_permission("asyar:api:feedback:sendBackground"),
            Some("notifications:send")
        );
        assert_eq!(
            get_required_permission("asyar:api:feedback:dismissBackground"),
            Some("notifications:send")
        );
    }

    #[test]
    fn fs_show_maps_to_fs_read() {
        assert_eq!(
            get_required_permission("asyar:api:fs:showInFileManager"),
            Some("fs:read")
        );
    }

    #[test]
    fn fs_trash_maps_to_fs_write() {
        assert_eq!(
            get_required_permission("asyar:api:fs:trash"),
            Some("fs:write")
        );
    }

    #[test]
    fn test_interop_service_permission() {
        assert_eq!(
            get_required_permission("asyar:api:interop:launchCommand"),
            Some("extension:invoke")
        );
    }

    #[test]
    fn application_canonical_namespace_permissions_mapped() {
        assert_eq!(
            get_required_permission("asyar:api:application:getFrontmostApplication"),
            Some("application:read")
        );
        assert_eq!(
            get_required_permission("asyar:api:application:syncApplicationIndex"),
            Some("application:read")
        );
        assert_eq!(
            get_required_permission("asyar:api:application:listApplications"),
            Some("application:read")
        );
    }

    #[test]
    fn window_manage_permission_mapped() {
        assert_eq!(
            get_required_permission("asyar:api:window:getWindowBounds"),
            Some("window:manage")
        );
        assert_eq!(
            get_required_permission("asyar:api:window:setWindowBounds"),
            Some("window:manage")
        );
        assert_eq!(
            get_required_permission("asyar:api:window:setFullscreen"),
            Some("window:manage")
        );
    }

    #[test]
    fn preferences_get_all_maps_to_preferences_read() {
        assert_eq!(
            get_required_permission("asyar:api:preferences:getAll"),
            Some("preferences:read")
        );
    }

    #[test]
    fn preferences_set_maps_to_preferences_write() {
        assert_eq!(
            get_required_permission("asyar:api:preferences:set"),
            Some("preferences:write")
        );
    }

    #[test]
    fn preferences_reset_maps_to_preferences_write() {
        assert_eq!(
            get_required_permission("asyar:api:preferences:reset"),
            Some("preferences:write")
        );
    }

    // --- Canonical wire type entries (broker.invoke('shell:spawn')
    //     → broker prepends asyar:api: → wire = asyar:api:shell:spawn)

    #[test]
    fn shell_spawn_wire_type_maps_to_shell_spawn() {
        assert_eq!(
            get_required_permission("asyar:api:shell:spawn"),
            Some("shell:spawn")
        );
    }

    #[test]
    fn shell_list_wire_type_maps_to_shell_spawn() {
        assert_eq!(
            get_required_permission("asyar:api:shell:list"),
            Some("shell:spawn")
        );
    }

    #[test]
    fn shell_attach_wire_type_maps_to_shell_spawn() {
        assert_eq!(
            get_required_permission("asyar:api:shell:attach"),
            Some("shell:spawn")
        );
    }

    #[test]
    fn oauth_authorize_maps_to_oauth_use() {
        assert_eq!(
            get_required_permission("asyar:api:oauth:authorize"),
            Some("oauth:use")
        );
    }

    #[test]
    fn oauth_revoke_token_maps_to_oauth_use() {
        assert_eq!(
            get_required_permission("asyar:api:oauth:revokeToken"),
            Some("oauth:use")
        );
    }

    #[test]
    fn removed_ai_stream_chat_wire_type_is_not_registered() {
        assert_eq!(get_required_permission("asyar:api:ai:streamChat"), None);
    }

    #[test]
    fn entitlements_check_maps_to_entitlements_read() {
        assert_eq!(
            get_required_permission("asyar:api:entitlements:check"),
            Some("entitlements:read")
        );
    }
    #[test]
    fn entitlements_get_all_maps_to_entitlements_read() {
        assert_eq!(
            get_required_permission("asyar:api:entitlements:getAll"),
            Some("entitlements:read")
        );
    }

    /// Proves that the defense-in-depth check in shell_spawn must pass the manifest
    /// permission name ("shell:spawn"), not the IPC wire type, to registry.check().
    #[test]
    fn registry_check_uses_manifest_permission_name_not_ipc_wire_type() {
        let reg = ExtensionPermissionRegistry::new();
        {
            let mut inner = reg.inner.lock().unwrap();
            inner.insert("org.asyar.sdk-playground".to_string(), {
                let mut s = HashSet::new();
                s.insert("shell:spawn".to_string()); // what manifest.json declares
                s
            });
        }
        // Passing the manifest permission name → allowed
        assert!(reg
            .check(&Some("org.asyar.sdk-playground".to_string()), "shell:spawn")
            .is_ok());
        // Passing the IPC wire type → denied (proves shell.rs must NOT use this string)
        assert!(reg
            .check(
                &Some("org.asyar.sdk-playground".to_string()),
                "asyar:api:shell:spawn"
            )
            .is_err());
    }

    #[test]
    fn selection_get_selected_text_maps_to_selection_read() {
        assert_eq!(
            get_required_permission("asyar:api:selection:getSelectedText"),
            Some("selection:read")
        );
    }
    #[test]
    fn selection_get_selected_finder_items_maps_to_selection_read() {
        assert_eq!(
            get_required_permission("asyar:api:selection:getSelectedFinderItems"),
            Some("selection:read")
        );
    }

    #[test]
    fn system_events_subscribe_maps_to_system_events_read() {
        assert_eq!(
            get_required_permission("asyar:api:systemEvents:subscribe"),
            Some("systemEvents:read")
        );
    }
    #[test]
    fn system_events_unsubscribe_maps_to_system_events_read() {
        assert_eq!(
            get_required_permission("asyar:api:systemEvents:unsubscribe"),
            Some("systemEvents:read")
        );
    }

    #[test]
    fn app_events_subscribe_maps_to_frontmost_watch() {
        assert_eq!(
            get_required_permission("asyar:api:appEvents:subscribe"),
            Some("app:frontmost-watch")
        );
    }
    #[test]
    fn app_events_unsubscribe_maps_to_frontmost_watch() {
        assert_eq!(
            get_required_permission("asyar:api:appEvents:unsubscribe"),
            Some("app:frontmost-watch")
        );
    }
    #[test]
    fn application_is_running_maps_to_application_read() {
        assert_eq!(
            get_required_permission("asyar:api:application:isRunning"),
            Some("application:read")
        );
    }

    #[test]
    fn timers_schedule_wire_maps_to_timers_schedule() {
        assert_eq!(
            get_required_permission("asyar:api:timers:schedule"),
            Some("timers:schedule")
        );
    }
    #[test]
    fn timers_cancel_wire_maps_to_timers_cancel() {
        assert_eq!(
            get_required_permission("asyar:api:timers:cancel"),
            Some("timers:cancel")
        );
    }
    #[test]
    fn timers_list_wire_maps_to_timers_list() {
        assert_eq!(
            get_required_permission("asyar:api:timers:list"),
            Some("timers:list")
        );
    }

    // ---- fs:watch wire mappings ----

    #[test]
    fn fs_watcher_create_wire_maps_to_fs_watch() {
        assert_eq!(
            get_required_permission("asyar:api:fsWatcher:create"),
            Some("fs:watch")
        );
    }

    #[test]
    fn fs_watcher_dispose_wire_maps_to_fs_watch() {
        assert_eq!(
            get_required_permission("asyar:api:fsWatcher:dispose"),
            Some("fs:watch")
        );
    }

    // ---- args store ----

    #[test]
    fn args_for_returns_none_when_not_registered() {
        let reg = ExtensionPermissionRegistry::default();
        assert!(reg.args_for("ext.a", "fs:watch").is_none());
    }

    #[test]
    fn args_for_returns_registered_value() {
        let reg = ExtensionPermissionRegistry::default();
        let mut inner_args = HashMap::new();
        inner_args.insert("fs:watch".to_string(), serde_json::json!(["~/foo/**"]));
        reg.register("ext.a", HashSet::from(["fs:watch".to_string()]), inner_args);
        let v = reg.args_for("ext.a", "fs:watch").unwrap();
        assert!(v.is_array());
    }

    #[test]
    fn fs_watch_patterns_returns_registered_strings() {
        let reg = ExtensionPermissionRegistry::default();
        let mut inner_args = HashMap::new();
        inner_args.insert(
            "fs:watch".to_string(),
            serde_json::json!(["~/foo/**", "~/bar/config"]),
        );
        reg.register("ext.a", HashSet::from(["fs:watch".to_string()]), inner_args);
        let patterns = reg.fs_watch_patterns("ext.a").unwrap();
        assert_eq!(
            patterns,
            vec!["~/foo/**".to_string(), "~/bar/config".to_string()]
        );
    }

    #[test]
    fn fs_watch_patterns_errors_when_extension_has_no_args() {
        let reg = ExtensionPermissionRegistry::default();
        reg.register("ext.a", HashSet::new(), HashMap::new());
        assert!(reg.fs_watch_patterns("ext.a").is_err());
    }

    #[test]
    fn fs_watch_patterns_errors_when_extension_not_registered() {
        let reg = ExtensionPermissionRegistry::default();
        assert!(reg.fs_watch_patterns("ext.missing").is_err());
    }

    #[test]
    fn files_read_patterns_returns_registered_strings() {
        let reg = ExtensionPermissionRegistry::default();
        let mut inner_args = HashMap::new();
        inner_args.insert(
            "files:read".to_string(),
            serde_json::json!(["**/steamapps/appmanifest_*.acf"]),
        );
        reg.register(
            "ext.a",
            HashSet::from(["files:read".to_string()]),
            inner_args,
        );
        let patterns = reg.files_read_patterns("ext.a").unwrap();
        assert_eq!(patterns, vec!["**/steamapps/appmanifest_*.acf".to_string()]);
    }

    #[test]
    fn files_read_patterns_errors_when_extension_has_no_args() {
        let reg = ExtensionPermissionRegistry::default();
        reg.register("ext.a", HashSet::new(), HashMap::new());
        assert!(reg.files_read_patterns("ext.a").is_err());
    }

    #[test]
    fn screen_pick_color_maps_to_screen_pick_color() {
        assert_eq!(
            get_required_permission("asyar:api:screen:pickColor"),
            Some("screen:pick-color")
        );
    }

    #[test]
    fn snippets_register_requires_contribute_permission() {
        assert_eq!(
            get_required_permission("asyar:api:snippets:registerShortcodes"),
            Some("snippets:contribute"),
        );
        assert_eq!(
            get_required_permission("asyar:api:snippets:unregisterShortcodes"),
            Some("snippets:contribute"),
        );
    }

    #[test]
    fn unregister_removes_both_perms_and_args() {
        let reg = ExtensionPermissionRegistry::default();
        let mut inner_args = HashMap::new();
        inner_args.insert("fs:watch".to_string(), serde_json::json!(["~/foo"]));
        reg.register("ext.a", HashSet::from(["fs:watch".to_string()]), inner_args);
        reg.unregister("ext.a");
        assert!(reg.check(&Some("ext.a".to_string()), "fs:watch").is_err());
        assert!(reg.args_for("ext.a", "fs:watch").is_none());
    }

    // ---- resolve_declared_permissions (register_extension_permissions'
    // forged-input resistance) ----

    fn make_record(
        id: &str,
        is_built_in: bool,
        permissions: Option<Vec<String>>,
    ) -> crate::extensions::ExtensionRecord {
        crate::extensions::ExtensionRecord {
            manifest: crate::extensions::ExtensionManifest {
                id: id.to_string(),
                name: id.to_string(),
                version: "1.0.0".to_string(),
                description: String::new(),
                author: None,
                extension_type: None,
                background: None,
                searchable: None,
                icon: None,
                commands: vec![],
                permissions,
                permission_args: None,
                min_app_version: None,
                asyar_sdk: None,
                platforms: None,
                preferences: None,
                actions: None,
                onboarding: None,
                tools: None,
                runtimes: None,
            },
            enabled: true,
            is_built_in,
            path: format!("/tmp/{id}"),
            compatibility: crate::extensions::CompatibilityStatus::Unknown,
            first_view_component: None,
        }
    }

    #[test]
    fn register_extension_permissions_ignores_forged_permissions_for_known_extension() {
        let mut extensions = HashMap::new();
        extensions.insert(
            "org.asyar.known".to_string(),
            make_record(
                "org.asyar.known",
                false,
                Some(vec!["clipboard:read".to_string()]),
            ),
        );

        // A compromised caller tries to smuggle a permission its manifest
        // never declared.
        let forged = vec!["shell:spawn".to_string(), "clipboard:read".to_string()];
        let (is_built_in, declared_perms, _declared_args) =
            resolve_declared_permissions(&extensions, "org.asyar.known", forged, None);

        assert!(!is_built_in);
        assert_eq!(declared_perms, vec!["clipboard:read".to_string()]);
    }

    #[test]
    fn resolve_declared_permissions_trusts_caller_when_extension_is_not_discovered() {
        let extensions: HashMap<String, crate::extensions::ExtensionRecord> = HashMap::new();
        let supplied = vec!["network".to_string()];

        let (is_built_in, declared_perms, _declared_args) =
            resolve_declared_permissions(&extensions, "org.asyar.unknown", supplied.clone(), None);

        assert!(!is_built_in);
        assert_eq!(declared_perms, supplied);
    }
}
