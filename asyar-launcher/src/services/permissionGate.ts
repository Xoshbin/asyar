export interface PermissionGateResult {
  allowed: boolean
  requiredPermission?: string
  reason?: string
}

export const PERMISSION_MAP: Record<string, string> = {
  // Real strings discovered in SDK for existing services
  'asyar:api:clipboard:readCurrentClipboard': 'clipboard:read',
  'asyar:api:clipboard:getRecentItems':       'clipboard:read',
  'asyar:api:clipboard:writeToClipboard':     'clipboard:write',
  'asyar:api:clipboard:pasteItem':            'clipboard:write',
  'asyar:api:clipboard:simulatePaste':        'clipboard:write',
  'asyar:api:clipboard:toggleItemFavorite':   'clipboard:write',
  'asyar:api:clipboard:deleteItem':           'clipboard:write',
  'asyar:api:clipboard:clearNonFavorites':    'clipboard:write',
  'asyar:api:notification:notify':            'notifications:send',
  'asyar:api:notification:show':              'notifications:send',
  'asyar:api:invoke':                         'shell:execute', // Safe gate for raw Tauri commands
  'asyar:api:network:fetch':                  'network',

  // Intended future design strings from architecture docs (future-proofing)
  'asyar:service:ClipboardService:read':          'clipboard:read',
  'asyar:service:ClipboardService:write':         'clipboard:write',
  'asyar:service:ClipboardHistoryService:get':    'clipboard:read',
  'asyar:service:NotificationService:show':       'notifications:send',
  'asyar:service:NotificationService:info':       'notifications:send',
  'asyar:service:NotificationService:error':      'notifications:send',
  'asyar:service:StoreService:get':               'store:read',
  'asyar:service:StoreService:set':               'store:write',
  'asyar:service:StoreService:delete':            'store:write',
  'asyar:service:StoreService:list':              'store:read',
  'asyar:service:FileService:read':               'fs:read',
  'asyar:service:FileService:write':              'fs:write',
  'asyar:service:FileService:list':               'fs:read',
  'asyar:service:FileService:delete':             'fs:write',
  'asyar:service:ShellService:execute':           'shell:execute',
  'asyar:service:NetworkService:fetch':           'network',
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
