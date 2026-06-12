export interface PermissionGateResult {
  allowed: boolean
  requiredPermission?: string
  reason?: string
}

// `asyar:api:searchBar:set` and `asyar:api:searchBar:clear` are intentionally
// absent from PERMISSION_MAP. They are UI capabilities scoped to the calling
// extension's own active view — no security boundary is crossed. Same status
// as host→iframe theme variable injection (also unmapped).
export const PERMISSION_MAP: Record<string, string> = {
  // Real strings discovered in SDK for existing services
  'asyar:api:clipboard:readCurrentClipboard': 'clipboard:read',
  'asyar:api:clipboard:readCurrentText':      'clipboard:read',
  'asyar:api:clipboard:getRecentItems':       'clipboard:read',
  'asyar:api:clipboard:writeToClipboard':     'clipboard:write',
  'asyar:api:clipboard:pasteItem':            'clipboard:write',
  'asyar:api:clipboard:simulatePaste':        'clipboard:write',
  'asyar:api:clipboard:toggleItemFavorite':   'clipboard:write',
  'asyar:api:clipboard:deleteItem':           'clipboard:write',
  'asyar:api:clipboard:clearNonFavorites':    'clipboard:write',
  'asyar:api:notifications:send':             'notifications:send',
  'asyar:api:notifications:dismiss':          'notifications:send',
  'asyar:api:diagnostics:report':             'diagnostics:report',
  'asyar:api:entitlements:check':             'entitlements:read',
  'asyar:api:entitlements:getAll':            'entitlements:read',
  'asyar:api:invoke':                         'shell:spawn', // Safe gate for raw Tauri commands
  'asyar:api:network:fetch':                  'network',
  'asyar:api:opener:open':                    'shell:open-url', // Open a URL in the system browser

  'asyar:api:fs:showInFileManager':          'fs:read',
  'asyar:api:fs:trash':                      'fs:write',
  'asyar:api:shell:spawn':                        'shell:spawn',
  'asyar:api:selection:getSelectedText':                    'selection:read',
  'asyar:api:selection:getSelectedFinderItems':             'selection:read',
  'asyar:api:ai:streamChat':                   'ai:use',
  // OAuth PKCE for extensions
  'asyar:api:oauth:authorize':                    'oauth:use',
  'asyar:api:oauth:revokeToken':                  'oauth:use',
  'asyar:api:interop:launchCommand':        'extension:invoke',
  // Extension cache
  'asyar:api:cache:get':    'cache:read',
  'asyar:api:cache:set':    'cache:write',
  'asyar:api:cache:delete': 'cache:write',
  'asyar:api:cache:clear':  'cache:write',
  // Application Service
  'asyar:api:application:getFrontmostApplication':        'application:read',
  'asyar:api:application:syncApplicationIndex':           'application:read',
  'asyar:api:application:listApplications':               'application:read',
  // Window Management
  'asyar:api:window:getWindowBounds':                  'window:manage',
  'asyar:api:window:setWindowBounds':                  'window:manage',
  'asyar:api:window:setFullscreen':                    'window:manage',
  'asyar:api:window:getMonitors':                      'window:manage',
  'asyar:api:window:applyPreset':                      'window:manage',
  // Extension Preferences
  'asyar:api:preferences:getAll':                      'preferences:read',
  'asyar:api:preferences:set':                         'preferences:write',
  'asyar:api:preferences:reset':                       'preferences:write',
  // Power inhibitor
  'asyar:api:power:keepAwake':                         'power:inhibit',
  'asyar:api:power:release':                           'power:inhibit',
  'asyar:api:power:list':                              'power:inhibit',
  // System events push service
  'asyar:api:systemEvents:subscribe':                  'systemEvents:read',
  'asyar:api:systemEvents:unsubscribe':                'systemEvents:read',
  // App-presence push events (launched / terminated / frontmost-changed)
  'asyar:api:appEvents:subscribe':                     'app:frontmost-watch',
  'asyar:api:appEvents:unsubscribe':                   'app:frontmost-watch',
  // Synchronous isRunning lives on the existing application:* namespace
  'asyar:api:application:isRunning':                   'application:read',
  // Installed-application index push events. Gated by the same
  // `application:read` permission that already protects the data class
  // (listApplications) — watching an event stream doesn't expose more.
  'asyar:api:applicationIndex:subscribe':              'application:read',
  'asyar:api:applicationIndex:unsubscribe':            'application:read',
  // Persistent one-shot timers. Separate permissions per verb so extensions
  // can declare read-only inspection (list) without scheduling authority.
  'asyar:api:timers:schedule':                         'timers:schedule',
  'asyar:api:timers:cancel':                           'timers:cancel',
  'asyar:api:timers:list':                             'timers:list',
  // Filesystem watcher. Pattern scope is in permissionArgs.fs:watch.
  'asyar:api:fsWatcher:create':                        'fs:watch',
  'asyar:api:fsWatcher:dispose':                       'fs:watch',
  // Run tracker — lifecycle events for long-running background tasks.
  'asyar:api:runs:start':                              'runs:track',
  'asyar:api:runs:write':                              'runs:track',
  'asyar:api:runs:done':                               'runs:track',
  'asyar:api:runs:fail':                               'runs:track',
  'asyar:api:runs:cancel':                             'runs:track',
  // Agent tools — register manifest-declared tools so AI agents can call them.
  'asyar:api:tools:registerTool':                      'tools:register',
  'asyar:api:tools:unregisterTool':                    'tools:register',
  'asyar:api:tools:listTools':                         'tools:register',
  // Snippet shortcodes contributed by extensions.
  'asyar:api:snippets:registerShortcodes':             'snippets:contribute',
  'asyar:api:snippets:unregisterShortcodes':           'snippets:contribute',
  'asyar:api:snippets:listLearnedShortcodes':          'snippets:contribute',
  'asyar:api:snippets:promoteLearnedShortcode':        'snippets:contribute',
  'asyar:api:snippets:forgetLearnedShortcode':         'snippets:contribute',
  'asyar:api:snippets:clearLearnedShortcodes':         'snippets:contribute',
  'asyar:api:snippets:setInlineFallbackEnabled':       'snippets:contribute',
  // Browser bridge — bookmarks and history read scopes.
  // listAvailableBrowsers and isCompanionInstalled are intentionally
  // unmapped (permission-free discovery, no security boundary).
  'asyar:api:browser:listBookmarks':                   'browser:bookmarks.read',
  'asyar:api:browser:searchHistory':                   'browser:history.read',
  // Browser bridge — companion tabs (read + write scopes).
  // listPairedBrowsers is paired-discovery and exposes only browser identity,
  // but a paired list is itself sensitive enough to gate behind tabs.read.
  'asyar:api:browser:listTabs':                        'browser:tabs.read',
  'asyar:api:browser:getActiveTab':                    'browser:tabs.read',
  'asyar:api:browser:activateTab':                     'browser:tabs.write',
  'asyar:api:browser:closeTab':                        'browser:tabs.write',
  'asyar:api:browser:openUrl':                         'browser:tabs.write',
  'asyar:api:browser:listPairedBrowsers':              'browser:tabs.read',
  // Browser events push subscription — gated at the subscribe call per kind.
  // Tabs events require `browser:tabs.read` (matches listTabs/getActiveTab);
  // page events require `browser:page.read` (matches getCurrentPage/queryPage).
  // Per-kind wire names + hard-coded eventTypes on the host method prevent a
  // tabs-permitted extension from side-channelling into page events.
  'asyar:api:browser:subscribeTabsChanged':            'browser:tabs.read',
  'asyar:api:browser:unsubscribeTabsChanged':          'browser:tabs.read',
  'asyar:api:browser:subscribePageChanged':            'browser:page.read',
  'asyar:api:browser:unsubscribePageChanged':          'browser:page.read',
  // Browser page methods — getCurrentPage/queryPage gated by browser:page.read;
  // actOnPage requires the separate browser:page.write (write surface).
  'asyar:api:browser:getCurrentPage':                  'browser:page.read',
  'asyar:api:browser:queryPage':                       'browser:page.read',
  'asyar:api:browser:actOnPage':                       'browser:page.write',
  // Browser bridge — command-bar additions. searchWeb opens a tab (tabs.write);
  // getMostRecentActiveBrowser exposes browser identity (tabs.read, like listPairedBrowsers).
  'asyar:api:browser:searchWeb':                       'browser:tabs.write',
  'asyar:api:browser:getMostRecentActiveBrowser':      'browser:tabs.read',
}

/**
 * Check whether an extension is allowed to make a specific API call.
 *
 * @param extensionId  The ID of the calling extension
 * @param callType     The full API call type string from the postMessage
 * @param permissions  The extension's declared permissions from its manifest
 */
export function checkPermission(
  extensionId: string,
  callType: string,
  permissions: string[]
): PermissionGateResult {
  const requiredPermission = PERMISSION_MAP[callType]

  // Call type not in map — it's a core call, always allowed
  if (!requiredPermission) {
    return { allowed: true }
  }

  // Check if the extension declared the required permission
  if (permissions.includes(requiredPermission)) {
    return { allowed: true }
  }

  return {
    allowed: false,
    requiredPermission,
    reason: `Extension "${extensionId}" called "${callType}" but did not declare permission "${requiredPermission}" in its manifest.json`,
  }
}
