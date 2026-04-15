export interface PermissionGateResult {
  allowed: boolean
  requiredPermission?: string
  reason?: string
}

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
  'asyar:api:notifications:notify':           'notifications:send',
  'asyar:api:notifications:show':             'notifications:send',
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
  // Extension Preferences
  'asyar:api:preferences:getAll':                      'preferences:read',
  'asyar:api:preferences:set':                         'preferences:write',
  'asyar:api:preferences:reset':                       'preferences:write',
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
